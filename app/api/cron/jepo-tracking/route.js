import {neon} from '@neondatabase/serverless';
import {ensureJepoTrackingTable,syncJepoTrackingAwbs} from '../../../../lib/jepoTrackingStore.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;
export async function GET(request){
 const secret=process.env.CRON_SECRET;
 if(!secret||request.headers.get('authorization')!=='Bearer '+secret)
  return Response.json({ok:false,error:'Unauthorized.'},{status:401});
 try{
  const url=process.env.DATABASE_URL||process.env.POSTGRES_URL||process.env.NEON_DATABASE_URL||process.env.DATABASE_URL_UNPOOLED;
  if(!url)throw Error('Database unavailable');
  const sql=neon(url);
  await ensureJepoTrackingTable(sql);
  // Oldest checked active AWBs first. This rotates through all queued shipments.
  // Delivered statuses and dates are retained; a transient website failure is non-destructive.
  const candidates=await sql.query("SELECT awb FROM mayavi_jepo_tracking WHERE status<>'DELIVERED' ORDER BY checked_at ASC NULLS FIRST,booking_date ASC NULLS LAST LIMIT 32");
  const result=await syncJepoTrackingAwbs(sql,candidates.map(x=>x.awb),{concurrency:8});
  console.log('jepo_tracking_cron',JSON.stringify({candidates:candidates.length,checked:result.checked,updated:result.updated,failed:result.failed}));
  return Response.json({ok:true,total:candidates.length,checked:result.checked,updated:result.updated,failed:result.failed,pending:result.pending});
 }catch(e){
  console.error('jepo_tracking_cron',String(e?.message||e).slice(0,200));
  return Response.json({ok:false,error:'JEPO tracking sync unavailable.'},{status:503});
 }
}
