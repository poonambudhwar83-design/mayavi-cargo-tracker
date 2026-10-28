import { neon } from '@neondatabase/serverless';
import {
  clearSessionCookie,
  createSessionToken,
  hashPassword,
  normalizeUsername,
  readSession,
  sessionCookie,
  verifyPassword
} from '../../../lib/mayaviAuth.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';

function connectionString(){
  return process.env.DATABASE_URL||process.env.POSTGRES_URL||process.env.NEON_DATABASE_URL||process.env.DATABASE_URL_UNPOOLED||'';
}
function db(){
  const url=connectionString();
  if(!url)throw new Error('DATABASE_URL is not configured in Vercel.');
  return neon(url);
}
function json(body,status=200,headers={}){
  return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json',...headers}});
}
async function activeSession(request,sql){
  const session=readSession(request);
  if(!session)return null;
  const [user]=await sql`SELECT username,display_name,role,branch_scope,session_version,is_active FROM mayavi_users WHERE lower(username)=${session.username} LIMIT 1`;
  const effectiveRole=user?.branch_scope==='HARYANA'&&user?.username==='haryanaadmin'?'haryana_admin':user?.role;
  if(!user||!user.is_active||effectiveRole!==session.role||Number(user.session_version)!==Number(session.sessionVersion||0))return null;
  return {...session,displayName:user.display_name,branchScope:user.branch_scope||'',sessionVersion:Number(user.session_version)};
}
async function adminSession(request,sql){
  const session=await activeSession(request,sql);
  return session?.role==='admin'?session:null;
}

export async function GET(request){
  try{
    const sql=db(),session=await activeSession(request,sql);
    const users=await sql`SELECT username,display_name,role,branch_scope,password_hash IS NOT NULL AS password_set FROM mayavi_users WHERE is_active=true ORDER BY CASE WHEN role='admin' THEN 0 ELSE 1 END,id`;
    const headers=session?{}:{'set-cookie':clearSessionCookie()};
    return json({ok:true,authenticated:Boolean(session),session,
      users:users.map(u=>({username:u.username,displayName:u.display_name,
        role:u.branch_scope==='HARYANA'&&u.username==='haryanaadmin'?'haryana_admin':u.role==='admin'?'admin':'employee',branchScope:u.branch_scope||'',passwordSet:u.password_set}))},200,headers);
  }catch(e){return json({ok:false,authenticated:false,session:null,error:e?.message||String(e)},503);}
}

export async function POST(request){
  try{
    const body=await request.json();
    const action=String(body?.action||'login').toLowerCase();
    if(action==='logout')return json({ok:true,authenticated:false},200,{'set-cookie':clearSessionCookie()});

    if(action==='change_password'){
      const sql=db(),session=await activeSession(request,sql);
      if(!session)return json({ok:false,error:'Please login again before changing your password.'},401);
      const currentPassword=String(body?.currentPassword||'');
      const newPassword=String(body?.newPassword||'');
      if(currentPassword.length<4)return json({ok:false,error:'Enter your current password.'},400);
      if(newPassword.length<(session.branchScope?8:4))return json({ok:false,error:'New password must have at least '+(session.branchScope?8:4)+' characters.'},400);
      if(currentPassword===newPassword)return json({ok:false,error:'New password must be different from the current password.'},400);
      const [user]=await sql`SELECT username,display_name,role,password_salt,password_hash,is_active,branch_scope,session_version FROM mayavi_users WHERE lower(username)=lower(${session.username}) LIMIT 1`;
      if(!user||!user.is_active)return json({ok:false,error:'This user is not enabled for Mayavi Cargo.'},403);
      if(!verifyPassword(currentPassword,user.password_salt,user.password_hash))return json({ok:false,error:'Current password is incorrect.'},403);
      const {salt,hash}=hashPassword(newPassword);
      const [updated]=await sql`UPDATE mayavi_users SET password_salt=${salt},password_hash=${hash},session_version=session_version+1,updated_at=now() WHERE username=${user.username} RETURNING session_version`;
      const token=createSessionToken({username:user.username,displayName:user.display_name,role:user.role,
        branchScope:user.branch_scope,sessionVersion:updated.session_version});
      return json({ok:true,message:'Password changed successfully.'},200,{'set-cookie':sessionCookie(token)});
    }

    if(['admin_set_password','admin_reset_password','admin_force_logout','admin_create_branch_user'].includes(action)){
      const sql=db(),admin=await adminSession(request,sql);
      if(!admin)return json({ok:false,error:'Admin login required.'},403);
      if(action==='admin_create_branch_user'){
        const branch=String(body?.branchScope||'').trim().toUpperCase();
        const newUser=normalizeUsername(body?.employeeUsername||'');
        const displayName=String(body?.displayName||'').trim();
        const pass=String(body?.newPassword||'');
        if(!['JIND','KARNAL'].includes(branch))return json({ok:false,error:'Choose Jind or Karnal branch.'},400);
        if(!/^[a-z][a-z0-9._-]{2,31}$/.test(newUser))return json({ok:false,error:'Username must be 3–32 letters/numbers (dots, underscore or hyphen allowed).'},400);
        if(!displayName||displayName.length>80)return json({ok:false,error:'Enter employee display name (up to 80 characters).'},400);
        if(pass.length<8)return json({ok:false,error:'Employee password must be at least 8 characters.'},400);
        const {salt,hash}=hashPassword(pass);
        const created=await sql`INSERT INTO mayavi_users(username,display_name,role,branch_scope,password_salt,password_hash,is_active)
          VALUES (${newUser},${displayName},'employee',${branch},${salt},${hash},true)
          ON CONFLICT (username) DO NOTHING RETURNING username`;
        if(!created.length)return json({ok:false,error:'Username already exists. Choose another.'},409);
        return json({ok:true,message:displayName+' added to '+branch+'. Give the employee their own password securely.'});
      }
      const targetUsername=normalizeUsername(body?.targetUsername||'');
      if(!targetUsername)return json({ok:false,error:'Select a user.'},400);
      const [target]=await sql`SELECT username,display_name,role,is_active,branch_scope FROM mayavi_users WHERE lower(username)=lower(${targetUsername}) LIMIT 1`;
      if(!target||!target.is_active)return json({ok:false,error:'Selected user is not enabled.'},404);
      if(target.role==='admin')return json({ok:false,error:'Use Change My Password to manage the main Admin password.'},403);
      if(action==='admin_force_logout'){
        if(target.role==='admin')return json({ok:false,error:'Admin accounts cannot be forcibly logged out here.'},403);
        await sql`UPDATE mayavi_users SET session_version=session_version+1,updated_at=now() WHERE username=${target.username}`;
        return json({ok:true,message:target.display_name+' has been forcibly logged out on all devices.'});
      }
      if(action==='admin_reset_password'){
        await sql`UPDATE mayavi_users SET password_salt=NULL,password_hash=NULL,session_version=session_version+1,updated_at=now() WHERE username=${target.username}`;
        const instruction=target.branch_scope?'Admin must set a new password before the employee can log in.':'Employee can choose a fresh password at next login.';
        return json({ok:true,message:target.display_name+': password reset. '+instruction,passwordSet:false});
      }
      const newPassword=String(body?.newPassword||'');
      if(newPassword.length<(target.branch_scope?8:4))return json({ok:false,error:'New password must have at least '+(target.branch_scope?8:4)+' characters.'},400);
      const {salt,hash}=hashPassword(newPassword);
      await sql`UPDATE mayavi_users SET password_salt=${salt},password_hash=${hash},session_version=session_version+1,updated_at=now() WHERE username=${target.username}`;
      return json({ok:true,message:`Password updated for ${target.display_name}. Previous sessions logged out.`,passwordSet:true});
    }

    const username=normalizeUsername(body?.username||body?.name||'');
    const password=String(body?.password||'');
    if(!username)return json({ok:false,error:'Select your name.'},400);
    if(password.length<4)return json({ok:false,error:'Password must be at least 4 characters.'},400);

    const sql=db();
    const [user]=await sql`SELECT username,display_name,role,password_salt,password_hash,is_active,branch_scope,session_version FROM mayavi_users WHERE lower(username)=lower(${username}) LIMIT 1`;
    if(!user||!user.is_active)return json({ok:false,error:'This user is not enabled for Mayavi Cargo.'},403);

    let firstSetup=false;
    if(!user.password_hash){
      // These finance-only branch accounts require the admin to assign the
      // first password. A public first-claim login must not own their ledger.
      if(user.branch_scope)return json({ok:false,error:'Admin must assign your first branch password in Manage User Passwords.'},403);
      const {salt,hash}=hashPassword(password);
      await sql`UPDATE mayavi_users SET password_salt=${salt},password_hash=${hash},updated_at=now() WHERE username=${user.username}`;
      firstSetup=true;
    }else if(!verifyPassword(password,user.password_salt,user.password_hash)){
      return json({ok:false,error:'Incorrect password.'},403);
    }

    const session={username:user.username,displayName:user.display_name,role:user.branch_scope==='HARYANA'&&user.username==='haryanaadmin'?'haryana_admin':user.role==='admin'?'admin':'employee',branchScope:user.branch_scope||'',sessionVersion:Number(user.session_version||0)};
    const token=createSessionToken(session);
    return json({ok:true,authenticated:true,firstSetup,session},200,{'set-cookie':sessionCookie(token)});
  }catch(e){
    return json({ok:false,error:e?.message||String(e)},503);
  }
}
