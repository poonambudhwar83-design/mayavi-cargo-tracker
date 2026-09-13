import { neon } from '@neondatabase/serverless';
import { readSession } from '../../../lib/mayaviAuth.js';
import { trackIndigo } from '../../../lib/indigo.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;

function connectionString(){
  return process.env.DATABASE_URL||process.env.POSTGRES_URL||process.env.NEON_DATABASE_URL||process.env.DATABASE_URL_UNPOOLED||'';
}
function db(){
  const url=connectionString();
  if(!url)throw new Error('DATABASE_URL is not configured in Vercel.');
  return neon(url);
}
function needsRefresh(data={}){
  const s=String(data.status||'').toUpperCase();
  return !data.bookingDate||!data.origin||!data.destination||!data.flightNo||!data.weight||!data.arrivalDate||!data.arrivalTime||s==='BOOKED'||s==='IN TRANSIT';
}

export async function POST(request){
  try{
    const session=readSession(request);
    if(!session)return Response.json({ok:false,error:'Login required.'},{status:401});
    const sql=db();
    const rows=await sql`SELECT awb,data,updated_at FROM mayavi_shipments WHERE awb LIKE '312%' ORDER BY updated_at DESC LIMIT 40`;
    let checked=0,updated=0;
    const errors=[];
    for(const row of rows){
      const current=row.data||{};
      if(!needsRefresh(current))continue;
      checked++;
      try{
        const result=await trackIndigo(row.awb);
        if(!result?.ok||!result.shipment){errors.push({awb:row.awb,error:result?.reason||'No verified IndiGo result'});continue;}
        const live=result.shipment;
        const merged={...current,...live,mawb:live.mawb||current.mawb||`${row.awb.slice(0,3)}-${row.awb.slice(3)}`,clientName:current.clientName||current.client||'',companyType:current.companyType||'',companyName:current.companyName||'',goodsDescription:current.goodsDescription||'',shipmentType:current.shipmentType==='EXPORT'?'EXPORT':'IMPORT',enteredBy:current.enteredBy||'',enteredByUsername:current.enteredByUsername||'',enteredAt:current.enteredAt||'',mailSent:current.mailSent===true,customsCleared:current.customsCleared===true,masterCopyReceived:current.masterCopyReceived===true,lastChecked:new Date().toISOString(),trackingError:'',manualHint:''};
        await sql`UPDATE mayavi_shipments SET data=${JSON.stringify(merged)}::jsonb, version=version+1, updated_at=now(), tracking_checked_at=now() WHERE awb=${row.awb}`;
        updated++;
      }catch(e){errors.push({awb:row.awb,error:e?.message||String(e)});}
    }
    return Response.json({ok:true,checked,updated,errors});
  }catch(e){
    return Response.json({ok:false,error:e?.message||String(e)},{status:503});
  }
}
