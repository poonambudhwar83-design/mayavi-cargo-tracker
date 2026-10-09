import { neon } from '@neondatabase/serverless';
import { readSession } from '../../../lib/mayaviAuth.js';
import { speedPostNumber, trackSpeedPost } from '../../../lib/speedpost.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;

function database(){
  const url=process.env.DATABASE_URL||process.env.POSTGRES_URL||process.env.NEON_DATABASE_URL||process.env.DATABASE_URL_UNPOOLED||'';
  if(!url)throw new Error('Mayavi database is unavailable.');
  return neon(url);
}
function json(body,status=200){
  return Response.json(body,{status,headers:{'cache-control':'no-store'}});
}
async function authorized(request,sql){
  const session=readSession(request);
  if(!session)return{ok:false,status:401,error:'Please log in to Mayavi.'};
  const name=String(session.username||'').trim().toLowerCase();
  if(name!=='admin'&&name!=='sonu')return{ok:false,status:403,error:'Speed Post is private to Admin and Sonu.'};
  const users=await sql`SELECT username,role,is_active FROM mayavi_users WHERE lower(username)=lower(${name}) LIMIT 1`;
  const user=users[0];
  if(!user?.is_active||String(user.username).toLowerCase()!==name||(name==='admin'&&user.role!=='admin'))
    return{ok:false,status:403,error:'Speed Post access is not active.'};
  return{ok:true,username:name};
}
function rowToResult(row){
  return {...(row.data||{}),trackingNo:row.tracking_no,createdAt:row.created_at,updatedAt:row.updated_at};
}

export async function GET(request){
  try{
    const sql=database(),auth=await authorized(request,sql);
    if(!auth.ok)return json({ok:false,error:auth.error},auth.status);
    const rows=await sql`SELECT tracking_no,data,created_at,updated_at FROM mayavi_speedpost ORDER BY updated_at DESC LIMIT 300`;
    return json({ok:true,rows:rows.map(rowToResult)});
  }catch(e){return json({ok:false,error:e?.message||'Speed Post records unavailable.'},503)}
}
export async function POST(request){
  try{
    const sql=database(),auth=await authorized(request,sql);
    if(!auth.ok)return json({ok:false,error:auth.error},auth.status);
    const body=await request.json().catch(()=>({}));
    const trackingNo=speedPostNumber(body?.trackingNo||'');
    if(!trackingNo)return json({ok:false,error:'Use an ED + 9 digits + IN tracking number.'},400);
    const result=await trackSpeedPost(trackingNo);
    if(!result.ok)return json({ok:false,error:result.error,trackingUrl:result.trackingUrl},502);
    const old=await sql`SELECT data FROM mayavi_speedpost WHERE tracking_no=${trackingNo} LIMIT 1`;
    const previous=old?.[0]?.data||{};
    const data={...result.shipment,enteredBy:previous.enteredBy||auth.username,
      retainedFields:[],lastChecked:new Date().toISOString()};
    // Keep previously verified fields if absent from the newest third-party response;
    // the client marks these retained values as such, never claiming fresh verification.
    for(const field of ['origin','destination','tariff','bookingDate','weight','articleType','outForDeliveryAt']){
      if(!data[field]&&previous[field]){
        data[field]=previous[field];
        data.retainedFields.push(field);
      }
    }
    const rows=await sql`INSERT INTO mayavi_speedpost (tracking_no,data,created_at,updated_at)
      VALUES (${trackingNo},${JSON.stringify(data)}::jsonb,NOW(),NOW())
      ON CONFLICT (tracking_no) DO UPDATE SET data=EXCLUDED.data, updated_at=NOW()
      RETURNING tracking_no,data,created_at,updated_at`;
    return json({ok:true,row:rowToResult(rows[0])});
  }catch(e){return json({ok:false,error:e?.message||'Speed Post tracking failed.'},503)}
}
export async function DELETE(request){
  try{
    const sql=database(),auth=await authorized(request,sql);
    if(!auth.ok)return json({ok:false,error:auth.error},auth.status);
    const body=await request.json().catch(()=>({}));
    const trackingNo=speedPostNumber(body?.trackingNo||'');
    if(!trackingNo)return json({ok:false,error:'Invalid tracking number.'},400);
    const rows=await sql`DELETE FROM mayavi_speedpost WHERE tracking_no=${trackingNo} RETURNING tracking_no`;
    return json({ok:true,deleted:Boolean(rows.length)});
  }catch(e){return json({ok:false,error:e?.message||'Unable to remove tracking number.'},503)}
}
