import {neon} from '@neondatabase/serverless';
import {backfillSavedShipmentDates} from '../../country-analysis/route.js';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;
export async function GET(request){
 const secret=process.env.CRON_SECRET;
 if(!secret||request.headers.get('authorization')!==`Bearer ${secret}`)
   return Response.json({ok:false,error:'Unauthorized'},{status:401});
 try{
  const sql=neon(process.env.DATABASE_URL||process.env.POSTGRES_URL||
    process.env.NEON_DATABASE_URL||process.env.DATABASE_URL_UNPOOLED);
  await sql`ALTER TABLE mayavi_other_country_rows ADD COLUMN IF NOT EXISTS shipment_month VARCHAR(7) NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE mayavi_other_country_rows ADD COLUMN IF NOT EXISTS shipment_date DATE`;
  await backfillSavedShipmentDates(sql);
  const counts=await sql`SELECT u.flow,COALESCE(NULLIF(r.shipment_month,''),u.report_month) AS flight_month,
    COUNT(*)::integer AS rows
    FROM mayavi_other_country_rows r JOIN mayavi_other_country_uploads u ON u.id=r.upload_id
    WHERE u.ready=true AND u.id IN (SELECT DISTINCT ON(flow,report_month) id
      FROM mayavi_other_country_uploads WHERE ready=true ORDER BY flow,report_month,created_at DESC,id DESC)
    GROUP BY u.flow,COALESCE(NULLIF(r.shipment_month,''),u.report_month)
    ORDER BY u.flow,flight_month`;
  console.log('courier_month_backfill_complete',JSON.stringify(counts));
  return Response.json({ok:true,months:counts});
 }catch(error){
   console.error('courier_month_backfill_failed',String(error?.message||error));
   return Response.json({ok:false,error:'Unable to repair stored courier flight months.'},{status:503});
 }
}
