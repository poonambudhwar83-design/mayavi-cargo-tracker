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
async function adminSession(request){
  const session=readSession(request);
  if(!session||session.role!=='admin')return null;
  return session;
}

export async function GET(request){
  const session=readSession(request);
  try{
    const sql=db();
    const users=await sql`SELECT username,display_name,role,password_hash IS NOT NULL AS password_set FROM mayavi_users WHERE is_active=true ORDER BY CASE WHEN role='admin' THEN 0 ELSE 1 END,id`;
    return json({
      ok:true,
      authenticated:Boolean(session),
      session:session||null,
      users:users.map(u=>({username:u.username,displayName:u.display_name,role:u.role==='admin'?'admin':'employee',passwordSet:u.password_set}))
    });
  }catch(e){
    return json({ok:false,authenticated:Boolean(session),session:session||null,error:e?.message||String(e)},503);
  }
}

export async function POST(request){
  try{
    const body=await request.json();
    const action=String(body?.action||'login').toLowerCase();
    if(action==='logout')return json({ok:true,authenticated:false},200,{'set-cookie':clearSessionCookie()});

    if(action==='change_password'){
      const session=readSession(request);
      if(!session)return json({ok:false,error:'Please login again before changing your password.'},401);
      const currentPassword=String(body?.currentPassword||'');
      const newPassword=String(body?.newPassword||'');
      if(currentPassword.length<4)return json({ok:false,error:'Enter your current password.'},400);
      if(newPassword.length<4)return json({ok:false,error:'New password must be at least 4 characters.'},400);
      if(currentPassword===newPassword)return json({ok:false,error:'New password must be different from the current password.'},400);
      const sql=db();
      const [user]=await sql`SELECT username,display_name,role,password_salt,password_hash,is_active FROM mayavi_users WHERE lower(username)=lower(${session.username}) LIMIT 1`;
      if(!user||!user.is_active)return json({ok:false,error:'This user is not enabled for Mayavi Cargo.'},403);
      if(!verifyPassword(currentPassword,user.password_salt,user.password_hash))return json({ok:false,error:'Current password is incorrect.'},403);
      const {salt,hash}=hashPassword(newPassword);
      await sql`UPDATE mayavi_users SET password_salt=${salt},password_hash=${hash},updated_at=now() WHERE username=${user.username}`;
      return json({ok:true,message:'Password changed successfully.'});
    }

    if(action==='admin_set_password'||action==='admin_reset_password'){
      const admin=await adminSession(request);
      if(!admin)return json({ok:false,error:'Admin login required.'},403);
      const targetUsername=normalizeUsername(body?.targetUsername||'');
      if(!targetUsername)return json({ok:false,error:'Select a user.'},400);
      const sql=db();
      const [target]=await sql`SELECT username,display_name,role,is_active FROM mayavi_users WHERE lower(username)=lower(${targetUsername}) LIMIT 1`;
      if(!target||!target.is_active)return json({ok:false,error:'Selected user is not enabled.'},404);
      if(target.role==='admin'&&target.username!==admin.username)return json({ok:false,error:'Another admin account cannot be changed here.'},403);
      if(action==='admin_reset_password'){
        await sql`UPDATE mayavi_users SET password_salt=NULL,password_hash=NULL,updated_at=now() WHERE username=${target.username}`;
        return json({ok:true,message:`${target.display_name} can set a fresh password on next login.`,passwordSet:false});
      }
      const newPassword=String(body?.newPassword||'');
      if(newPassword.length<4)return json({ok:false,error:'New password must be at least 4 characters.'},400);
      const {salt,hash}=hashPassword(newPassword);
      await sql`UPDATE mayavi_users SET password_salt=${salt},password_hash=${hash},updated_at=now() WHERE username=${target.username}`;
      return json({ok:true,message:`Password updated for ${target.display_name}.`,passwordSet:true});
    }

    const username=normalizeUsername(body?.username||body?.name||'');
    const password=String(body?.password||'');
    if(!username)return json({ok:false,error:'Select your name.'},400);
    if(password.length<4)return json({ok:false,error:'Password must be at least 4 characters.'},400);

    const sql=db();
    const [user]=await sql`SELECT username,display_name,role,password_salt,password_hash,is_active FROM mayavi_users WHERE lower(username)=lower(${username}) LIMIT 1`;
    if(!user||!user.is_active)return json({ok:false,error:'This user is not enabled for Mayavi Cargo.'},403);

    let firstSetup=false;
    if(!user.password_hash){
      const {salt,hash}=hashPassword(password);
      await sql`UPDATE mayavi_users SET password_salt=${salt},password_hash=${hash},updated_at=now() WHERE username=${user.username}`;
      firstSetup=true;
    }else if(!verifyPassword(password,user.password_salt,user.password_hash)){
      return json({ok:false,error:'Incorrect password.'},403);
    }

    const session={username:user.username,displayName:user.display_name,role:user.role==='admin'?'admin':'employee'};
    const token=createSessionToken(session);
    return json({ok:true,authenticated:true,firstSetup,session},200,{'set-cookie':sessionCookie(token)});
  }catch(e){
    return json({ok:false,error:e?.message||String(e)},503);
  }
}
