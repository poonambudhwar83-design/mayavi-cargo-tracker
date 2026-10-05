import { monthlyDb, snapshotClosedMonths } from '../../../../lib/monthlyArchive.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;

export async function GET(request){
  const secret=process.env.CRON_SECRET;
  if(secret&&request.headers.get('authorization')!==`Bearer ${secret}`)return Response.json({ok:false,error:'Unauthorized'},{status:401});
  try{
    const sql=monthlyDb();
    const result=await snapshotClosedMonths(sql);
    return Response.json({ok:true,...result,message:'Closed-month Import and Export records are safely archived. Existing monthly snapshots are never overwritten.'});
  }catch(e){
    return Response.json({ok:false,error:e?.message||String(e)},{status:503});
  }
}
