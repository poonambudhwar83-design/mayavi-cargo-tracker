import {neon} from '@neondatabase/serverless';
import {reconcileClientLedger} from '../../../../lib/clientLedgerReconcile.js';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=120;
// This server-side reconciliation runs even when no one has Mayavi open.
// Cron requests require the Vercel CRON_SECRET, never a public token.
export async function GET(request){
  const secret=process.env.CRON_SECRET;
  if(!secret||request.headers.get('authorization')!=='Bearer '+secret)
    return Response.json({ok:false,error:'Unauthorized'},{status:401});
  const connection=process.env.DATABASE_URL||process.env.POSTGRES_URL||
    process.env.NEON_DATABASE_URL||process.env.DATABASE_URL_UNPOOLED||'';
  if(!connection)return Response.json({ok:false,error:'Database unavailable'},{status:503});
  try{
    const result=await reconcileClientLedger(neon(connection));
    console.info('client_ledger_two_hour_reconciliation',JSON.stringify(result));
    return Response.json({ok:true,...result},{headers:{'Cache-Control':'no-store'}});
  }catch(e){
    console.error('client_ledger_reconciliation_failed',String(e?.message||e));
    return Response.json({ok:false,error:'Ledger reconciliation failed'},{status:503});
  }
}
