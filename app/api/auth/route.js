import { neon } from '@neondatabase/serverless';
import {
  clearSessionCookie,
  createSessionToken,
  hashPassword,
  normalizeUsername,
  readSession,
  sessionCookie,
  verifyAdminPassword,
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

export async function GET(request){
  const session=readSession(request);
  try{
    const sql=db();
    const users=await sql`SELECT username,display_name,role,password_hash IS NOT NULL AS password_set FROM mayavi_users WHERE is_active=true ORDER BY id`;
    return json({
      ok:true,
      authenticated:Boolean(session),
      session:session||null,
      users:[{username:'admin',displayName:'Admin',role:'admin',passwordSet:true},...users.map(u=>({username:u.username,displayName:u.display_name,role:u.role,passwordSet:u.password_set}))]
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

    const username=normalizeUsername(body?.username||body?.name||'');
    const password=String(body?.password||'');
    if(!username)return json({ok:false,error:'Select your name.'},400);
    if(password.length<4)return json({ok:false,error:'Password must be at least 4 characters.'},400);

    if(username==='admin'){
      if(!verifyAdminPassword(password))return json({ok:false,error:'Incorrect admin password.'},403);
      const session={username:'admin',displayName:'Admin',role:'admin'};
      const token=createSessionToken(session);
      return json({ok:true,authenticated:true,session},200,{'set-cookie':sessionCookie(token)});
    }

    const sql=db();
    const [user]=await sql`SELECT username,display_name,role,password_salt,password_hash,is_active FROM mayavi_users WHERE lower(username)=lower(${username}) LIMIT 1`;
    if(!user||!user.is_active)return json({ok:false,error:'This employee is not enabled for Mayavi Cargo.'},403);

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
