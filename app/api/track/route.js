import { trackCathay } from '../../../lib/cathay.js';
import { trackSaudia } from '../../../lib/saudia.js';
import { trackSaudiaWithBrowser } from '../../../lib/saudiaBrowser.js';
import { trackLufthansa } from '../../../lib/lufthansa.js';
import { trackQatar } from '../../../lib/qatar.js';
import { trackWithTrackingMore } from '../../../lib/trackingmore.js';
import { trackWithBrowser } from '../../../lib/browserTracker.js';
import { trackFlightStatusSnapshot } from '../../../lib/flightStatusSnapshot.js';
import { normalizeMawb, airlineForMawb, CONFIGURED_PREFIXES } from '../../../lib/airlines.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
const VERSION='3.7.3';

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

async function enrichCathayFromScreenshot(mawb,directResult){
  if(!mawb.startsWith('160-')||!directResult?.ok)return null;
  const s=directResult.shipment||{};
  if(!s.flightNo||!s.origin||!s.destination||!directResult?.debug?.flightDate)return null;
  if((s.status==='ARRIVED'||s.status==='DELIVERED')&&s.arrivalDate&&s.arrivalTime)return null;
  return trackFlightStatusSnapshot({flightNo:s.flightNo,origin:s.origin,destination:s.destination,date:directResult.debug.flightDate});
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
    let shipment={...directResult.shipment};
    let screenshotResult=null;
    if(mawb.startsWith('160-')){
      screenshotResult=await enrichCathayFromScreenshot(mawb,directResult);
      if(screenshotResult?.ok){
        shipment={
          ...shipment,
          status:screenshotResult.status||shipment.status,
          arrivalDate:screenshotResult.arrivalDate||shipment.arrivalDate,
          arrivalTime:screenshotResult.arrivalTime||shipment.arrivalTime,
          arrivalIsActual:Boolean(screenshotResult.arrivalIsActual),
          source:`${shipment.source} + ${screenshotResult.source}`
        };
      }
    }
    console.log('mawb_tracking_result',mawb,'OK','DIRECT_OFFICIAL',directResult?.debug?.source||'',screenshotResult?.ok?'SCREENSHOT_ENRICHED':'');
    return Response.json({
      ok:true,version:VERSION,
      provider:screenshotResult?.ok?'Official cargo data + flight-status screenshot':'Official direct adapter',
      shipment,
      screenshotCaptured:Boolean(screenshotResult?.screenshotBase64),
      screenshotEnrichment:screenshotResult?{ok:Boolean(screenshotResult.ok),reason:screenshotResult.reason||'',source:screenshotResult.source||'',url:screenshotResult.url||'',debug:screenshotResult.debug||null}:null,
      apiFallbackReason:apiResult?.reason||'',debug:directResult.debug
    });
  }

  let browserResult;
  if(mawb.startsWith('065-')) browserResult=await trackSaudiaWithBrowser(mawb);
  else browserResult=await trackWithBrowser(mawb);

  if(browserResult.ok&&hasRealShipmentData(browserResult.shipment)){
    console.log('mawb_tracking_result',mawb,'OK',mawb.startsWith('065-')?'SAUDIA_SEGMENT_BROWSER':'OFFICIAL_BROWSER_CAPTURE');
    return Response.json({
      ok:true,version:VERSION,
      provider:mawb.startsWith('065-')?'Saudia segment browser (translated to English)':'Official airline browser capture',
      shipment:browserResult.shipment,
      screenshotCaptured:Boolean(browserResult.screenshotBase64),debug:browserResult.debug
    });
  }

  const apiConfigured=Boolean(process.env.TRACKINGMORE_API_KEY);
  const trackingError=browserResult?.reason||directResult?.reason||apiResult?.reason||'NO VERIFIED SHIPMENT DATA';
  console.log('mawb_tracking_result',mawb,'FAIL',trackingError,browserResult?.debug?.stage||directResult?.debug?.stage||'');
  return Response.json({
    ok:false,version:VERSION,mawb,airline,trackingError,
    apiError:apiResult?.reason||'',directAdapterError:directResult?.reason||'',browserError:browserResult?.reason||'',
    apiConfigured,requiredSecret:apiConfigured?null:'TRACKINGMORE_API_KEY',
    officialTracker:browserResult?.officialTracker||directResult?.officialTracker||airline.url||null,
    manualHint:directResult?.manualHint||null,
    screenshotCaptured:Boolean(browserResult?.screenshotBase64),
    debug:browserResult?.debug||directResult?.debug||null
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
    mode:'Global API → direct adapter → automatic browser/screenshot enrichment → manual link only if blocked',
    apiProvider:'TrackingMore Air Cargo',apiConfigured:Boolean(process.env.TRACKINGMORE_API_KEY),
    dedicatedAdapters:['020 Lufthansa','065 Saudia translated segment browser','157 Qatar','160 Cathay'],
    automaticBrowserCapture:true,screenshotOcrFallback:true,
    carrierCount:CONFIGURED_PREFIXES.length,configuredPrefixes:CONFIGURED_PREFIXES
  });
  const mawb=normalizeMawb(q);if(!mawb)return Response.json({ok:false,error:'Enter a valid 11-digit MAWB.'},{status:400});
  return handle(mawb);
}
