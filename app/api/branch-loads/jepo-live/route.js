import {neon} from '@neondatabase/serverless';
import {readSession} from '../../../../lib/mayaviAuth.js';
import {syncJepoBranchAwbs} from '../../../../lib/jepoBranchSync.js';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=180;
const response=(o,status=200)=>Response.json(o,{status,headers:{'Cache-Control':'no-store'}});
const database=()=>neon(process.env.DATABASE_URL||process.env.POSTGRES_URL||
  process.env.NEON_DATABASE_URL||process.env.DATABASE_URL_UNPOOLED);
export async function POST(request){
 try{
  const session=readSession(request);
  if(!session)return response({ok:false,error:'Mayavi login required.'},401);
  const sql=database();
  const users=await sql`SELECT username,role,is_active,branch_scope,session_version FROM mayavi_users WHERE lower(username)=${session.username} LIMIT 1`;
  const user=users[0];
  if(!user?.is_active||Number(user.session_version)!==Number(session.sessionVersion||0))
    return response({ok:false,error:'Session no longer active.'},401);
  const admin=user.role==='admin'&&session.role==='admin';
  const haryana=user.username==='haryanaadmin'&&session.role==='haryana_admin'&&user.branch_scope==='HARYANA';
  const branch=String(user.branch_scope||'').toUpperCase();
  if(!admin&&!haryana&&!(user.role==='employee'&&session.role==='employee'&&['JIND','KARNAL'].includes(branch)))
    return response({ok:false,error:'Branch access denied.'},403);
  const body=await request.json().catch(()=>({}));
  const ids=[...new Set((Array.isArray(body.ids)?body.ids:[body.id]).map(v=>String(v||'').trim()))]
    .filter(x=>/^[0-9a-f-]{36}$/i.test(x)).slice(0,8);
  if(!ids.length)return response({ok:false,error:'Select saved JEPO tracking rows to refresh.'},400);
  const awbs=[];
  for(const id of ids){
    const rows=await sql`SELECT id,branch,tracking_no FROM mayavi_branch_loads WHERE id=${id} LIMIT 1`;
    const row=rows[0];
    if(row&&(admin||haryana||row.branch===branch)&&row.tracking_no)awbs.push(row.tracking_no);
  }
  if(!awbs.length)return response({ok:false,error:'No accessible records have JEPO Tracking No.'},404);
  const result=await syncJepoBranchAwbs(sql,awbs);
  return response({ok:true,...result});
 }catch(e){
  console.error('jepo_branch_live_sync',String(e?.message||e));
  return response({ok:false,error:'JEPO tracking temporarily unavailable. Saved statuses were kept.'},503);
 }
}
