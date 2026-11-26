import {neon} from '@neondatabase/serverless';
import {syncAbsLedger} from '../../../../lib/absImportLedger.js';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request){
  const secret=process.env.CRON_SECRET;
  if(!secret||request.headers.get('authorization')!=='Bearer '+secret)return Response.json({ok:false,error:'Unauthorized'},{status:401});
  try{
    const sql=neon(process.env.DATABASE_URL||process.env.POSTGRES_URL||process.env.NEON_DATABASE_URL||process.env.DATABASE_URL_UNPOOLED||'');
    const added=await syncAbsLedger(sql);
    return Response.json({ok:true,added});
  }catch(e){console.error('abs_ledger_sync_failed',e?.message);return Response.json({ok:false,error:'ABS sync failed'},{status:503});}
}
