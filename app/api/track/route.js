import { trackMawb } from '../../../lib/tracker.js';
import { normalizeMawb, airlineForMawb } from '../../../lib/airlines.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;

function hasRealShipmentData(s={}){
  return Boolean((s.origin&&s.destination)||s.bags||s.pieces||s.weight||s.flightNo||s.arrivalDate||s.arrivalTime||(s.status&&s.status!=='TRACKING'));
}

async function handle(mawb){
  const airline=airlineForMawb(mawb); const result=await trackMawb(mawb);
  if(result.ok&&hasRealShipmentData(result.shipment))return Response.json({ok:true,provider:'Official airline website',airlinePrimary:true,noPaidApi:true,shipment:result.shipment,debug:result.debug});
  const reason=result.ok?'NO VERIFIED SHIPMENT DATA RETURNED':result.reason;
  return Response.json({ok:false,provider:'Official airline website',airlinePrimary:true,noPaidApi:true,mawb,airline,trackingError:reason,debug:result.debug},{status:result.notFound?404:502});
}

export async function POST(request){
  let body={}; try{body=await request.json()}catch{return Response.json({ok:false,error:'Invalid request body.'},{status:400})}
  const mawb=normalizeMawb(body?.mawb); if(!mawb)return Response.json({ok:false,error:'Enter a valid 11-digit MAWB.'},{status:400});
  return handle(mawb);
}

export async function GET(request){
  const q=new URL(request.url).searchParams.get('mawb');
  if(!q)return Response.json({ok:true,version:'2.2',mode:'MAWB prefix → official airline adapter',configuredPrefixes:['057','065','098','157','160','176','235']});
  const mawb=normalizeMawb(q); if(!mawb)return Response.json({ok:false,error:'Enter a valid 11-digit MAWB.'},{status:400});
  return handle(mawb);
}
