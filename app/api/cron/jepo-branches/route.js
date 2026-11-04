import {neon} from '@neondatabase/serverless';
import {ensureJepoBranchColumns,syncJepoBranchAwbs} from '../../../../lib/jepoBranchSync.js';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;
export async function GET(request){
 const secret=process.env.CRON_SECRET;
 if(!secret||request.headers.get('authorization')!==`Bearer ${secret}`)
  return Response.json({ok:false,error:'Unauthorized.'},{status:401});
 try{
  const sql=neon(process.env.DATABASE_URL||process.env.POSTGRES_URL||
    process.env.NEON_DATABASE_URL||process.env.DATABASE_URL_UNPOOLED);
  await ensureJepoBranchColumns(sql);
  // Every saved JEPO AWB (including old Delivered rows) participates in
  // this complete pass. The sync function runs eight isolated browser tabs
  // concurrently; a delivered record is never downgraded by a stale scan.
  const candidates=await sql`SELECT UPPER(BTRIM(tracking_no)) AS tracking_no,
      MIN(jepo_live_checked_at) AS last_checked
    FROM mayavi_branch_loads
    WHERE BTRIM(tracking_no)<>''
    GROUP BY UPPER(BTRIM(tracking_no))
    ORDER BY last_checked ASC NULLS FIRST,tracking_no ASC LIMIT 240`;
  const summary=await syncJepoBranchAwbs(sql,candidates.map(x=>x.tracking_no),{concurrency:8});
  console.log('jepo_branch_cron',JSON.stringify({
    total:candidates.length,checked:summary.checked,updated:summary.updated,failed:summary.failed,pending:summary.pending
  }));
  return Response.json({ok:true,total:candidates.length,checked:summary.checked,updated:summary.updated,failed:summary.failed,pending:summary.pending});
 }catch(e){
  console.error('jepo_branch_cron_error',String(e?.message||e));
  return Response.json({ok:false,error:'JEPO branch sync unavailable.'},{status:503});
 }
}
