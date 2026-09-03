import { trackCathay } from '../../../lib/cathay.js';
import { trackSaudia } from '../../../lib/saudia.js';
import { trackLufthansa } from '../../../lib/lufthansa.js';
import { trackQatar } from '../../../lib/qatar.js';
import { trackWithTrackingMore } from '../../../lib/trackingmore.js';
import { normalizeMawb, airlineForMawb, CONFIGURED_PREFIXES } from '../../../lib/airlines.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=30;
const VERSION='3.6.0';

function hasRealShipmentData(s={}){
  return Boolean((s.origin&&s.destination)||s.bags||s.pieces||s.weight||s.flightNo||s.arrivalDate||s.arrivalTime||(s.status&&s.status!=='TRACKING'));
}

async function dedicatedOfficial(mawb){
  if(mawb.startsWith('020-')) return trackLufthansa(mawb);
  if(mawb.startsWith('065-')) return trackSaudia(mawb);
  if(mawb.startsWith('157-')) return trackQatar(mawb);
  if(mawb.startsWith('160-')) return trackCathay(mawb);
  return {ok:false,skipped:true,reason:'NO DEDICATED OFFICIAL ADAPTER FOR THIS PREFIX'};
}

async function handle(mawb){
  const airline=airlineForMawb(mawb);
  if(!airline)return Response.json({ok:false,error:`Airline prefix ${mawb.slice(0,3)} is not mapped yet.`},{status:422});

  const apiResult=await trackWithTrackingMore(mawb,airline);
  if(apiResult.ok&&hasRealShipmentData(apiResult.shipment)){
    console.log('mawb_tracking_result',mawb,'OK','TRACKINGMORE');
    return Response.json({ok:true,version:VERSION,provider:'TrackingMore Air Cargo API',shipment:apiResult.shipment,debug:apiResult.debug});
  }

  const directResult=await dedicatedOfficial(mawb);
  if(directResult.ok&&hasRealShipmentData(directResult.shipment)){
    console.log('mawb_tracking_result',mawb,'OK','DIRECT_OFFICIAL',directResult?.debug?.source||'');
    return Response.json({ok:true,version:VERSION,provider:'Official direct adapter',shipment:directResult.shipment,apiFallbackReason:apiResult?.reason||'',debug:directResult.debug});
  }

  const apiConfigured=Boolean(process.env.TRACKINGMORE_API_KEY);
  const trackingError=!directResult?.skipped
    ? (directResult?.reason||apiResult?.reason||'NO VERIFIED SHIPMENT DATA')
    : (!apiConfigured?'GLOBAL AIR-CARGO API KEY NOT CONFIGURED':(apiResult?.reason||'NO VERIFIED SHIPMENT DATA'));
  console.log('mawb_tracking_result',mawb,'FAIL',trackingError,directResult?.debug?.stage||'');
  return Response.json({
    ok:false,version:VERSION,mawb,airline,trackingError,
    apiError:apiResult?.reason||'',directAdapterError:directResult?.reason||'',
    apiConfigured,requiredSecret:apiConfigured?null:'TRACKINGMORE_API_KEY',
    officialTracker:directResult?.officialTracker||airline.url||null,
    manualHint:directResult?.manualHint||null,debug:directResult?.debug||null
  },{status:503});
}

export async function POST(request){
  let body={};try{body=await request.json()}catch{return Response.json({ok:false,error:'Invalid request body.'},{status:400})}
  const mawb=normalizeMawb(body?.mawb);if(!mawb)return Response.json({ok:false,error:'Enter a valid 11-digit MAWB.'},{status:400});
  return handle(mawb);
}

export async function GET(request){
  const q=new URL(request.url).searchParams.get('mawb');
  if(!q)return Response.json({
    ok:true,version:VERSION,
    mode:'Global API → direct carrier adapter → official link/screenshot OCR fallback',
    apiProvider:'TrackingMore Air Cargo',apiConfigured:Boolean(process.env.TRACKINGMORE_API_KEY),
    dedicatedAdapters:['020 Lufthansa','065 Saudia','157 Qatar official fallback','160 Cathay terminal + flight arrival'],
    screenshotOcr:true,carrierCount:CONFIGURED_PREFIXES.length,configuredPrefixes:CONFIGURED_PREFIXES
  });
  const mawb=normalizeMawb(q);if(!mawb)return Response.json({ok:false,error:'Enter a valid 11-digit MAWB.'},{status:400});
  return handle(mawb);
}
