import { trackMawb } from '../../../lib/tracker.js';
import { trackTurkish } from '../../../lib/turkish.js';
import { trackWithTrackingMore } from '../../../lib/trackingmore.js';
import { normalizeMawb, airlineForMawb, CONFIGURED_PREFIXES } from '../../../lib/airlines.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;

function hasRealShipmentData(s={}){
  return Boolean((s.origin&&s.destination)||s.bags||s.pieces||s.weight||s.flightNo||s.arrivalDate||s.arrivalTime||(s.status&&s.status!=='TRACKING'));
}

function timeoutResult(ms){
  return new Promise(resolve=>setTimeout(()=>resolve({ok:false,reason:`OFFICIAL TRACKER TIMEOUT AFTER ${Math.round(ms/1000)}S`,debug:{stage:'TIMEOUT'}}),ms));
}

async function officialFallback(mawb){
  const task=mawb.startsWith('235-')?trackTurkish(mawb):trackMawb(mawb);
  return Promise.race([task,timeoutResult(22000)]);
}

async function handle(mawb){
  const airline=airlineForMawb(mawb);
  if(!airline)return Response.json({ok:false,error:`Airline prefix ${mawb.slice(0,3)} is not mapped yet.`},{status:422});

  // V3 strategy: global air-cargo API first. Official carrier website is a time-capped fallback.
  const apiResult=await trackWithTrackingMore(mawb,airline);
  if(apiResult.ok&&hasRealShipmentData(apiResult.shipment)){
    console.log('mawb_tracking_result',mawb,'OK','TRACKINGMORE');
    return Response.json({ok:true,version:'3.1',provider:'TrackingMore Air Cargo API',apiPrimary:true,officialFallback:true,shipment:apiResult.shipment,debug:apiResult.debug});
  }

  const officialResult=await officialFallback(mawb);
  console.log('mawb_tracking_result',mawb,officialResult?.ok?'OK':'FAIL','OFFICIAL',officialResult?.reason||'',officialResult?.debug?.stage||'',apiResult?.reason||'');
  if(officialResult.ok&&hasRealShipmentData(officialResult.shipment)){
    return Response.json({ok:true,version:'3.1',provider:'Official airline website',apiPrimary:true,apiFallbackReason:apiResult?.reason||'',shipment:officialResult.shipment,debug:officialResult.debug});
  }

  const reason=officialResult.ok?'NO VERIFIED SHIPMENT DATA RETURNED':officialResult.reason;
  return Response.json({
    ok:false,
    version:'3.1',
    mawb,
    airline,
    trackingError:reason,
    apiFallbackError:apiResult?.reason||'',
    apiConfigured:Boolean(process.env.TRACKINGMORE_API_KEY),
    requiredSecret:process.env.TRACKINGMORE_API_KEY?null:'TRACKINGMORE_API_KEY',
    debug:officialResult.debug
  },{status:officialResult.notFound?404:502});
}

export async function POST(request){
  let body={};try{body=await request.json()}catch{return Response.json({ok:false,error:'Invalid request body.'},{status:400})}
  const mawb=normalizeMawb(body?.mawb);if(!mawb)return Response.json({ok:false,error:'Enter a valid 11-digit MAWB.'},{status:400});
  return handle(mawb);
}

export async function GET(request){
  const q=new URL(request.url).searchParams.get('mawb');
  if(!q)return Response.json({
    ok:true,
    version:'3.1',
    mode:'Global air-cargo API first → time-capped official airline fallback',
    apiProvider:'TrackingMore Air Cargo',
    apiConfigured:Boolean(process.env.TRACKINGMORE_API_KEY),
    carrierCount:CONFIGURED_PREFIXES.length,
    configuredPrefixes:CONFIGURED_PREFIXES
  });
  const mawb=normalizeMawb(q);if(!mawb)return Response.json({ok:false,error:'Enter a valid 11-digit MAWB.'},{status:400});
  return handle(mawb);
}
