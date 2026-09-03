import { trackCathay } from '../../../lib/cathay.js';
import { trackSaudia } from '../../../lib/saudia.js';
import { trackSaudiaWithBrowser } from '../../../lib/saudiaBrowser.js';
import { trackLufthansa } from '../../../lib/lufthansa.js';
import { trackQatar } from '../../../lib/qatar.js';
import { trackWithTrackingMore } from '../../../lib/trackingmore.js';
import { trackWithBrowser } from '../../../lib/browserTracker.js';
import { trackFlightStatusSnapshot } from '../../../lib/flightStatusSnapshot.js';
import { readTrackingScreenshot } from '../../../lib/screenshotOcr.js';
import { normalizeMawb, airlineForMawb, CONFIGURED_PREFIXES } from '../../../lib/airlines.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
const VERSION='3.9.0';

function concrete(s={}){
  return Boolean((s.origin&&s.destination)||s.bags||s.pieces||s.weight||s.flightNo||s.arrivalDate||s.arrivalTime);
}
function statusRank(status=''){
  const s=String(status).toUpperCase();
  if(s.includes('DELIVER'))return 6;
  if(s.includes('ARRIVED')||s.includes('DESTINATION')||s.includes('LANDED'))return 5;
  if(s.includes('DELAY'))return 4;
  if(s.includes('TRANSIT')||s.includes('DEPART')||s.includes('FLIGHT'))return 3;
  if(s.includes('BOOK')||s.includes('ACCEPT'))return 2;
  return 0;
}
function mergeNonEmpty(base={},next={}){
  const out={...base};
  for(const [k,v] of Object.entries(next||{})){
    if(v!==''&&v!==null&&v!==undefined&&k!=='status')out[k]=v;
  }
  return out;
}
function chooseStatus({api,direct,browser,ocr,cathay}){
  const all=[api,direct,browser,ocr,cathay].filter(Boolean);
  const arrived=all.find(s=>statusRank(s.status)>=5);
  if(arrived)return arrived.status;
  if(ocr?.status==='DELAYED'&&ocr?.statusEvidence==='strong')return'DELAYED';
  const browserDelayed=browser?.status==='DELAYED'&&concrete(browser);
  if(browserDelayed)return'DELAYED';
  const reliable=all.filter(s=>s.status&&s.status!=='TRACKING').sort((a,b)=>statusRank(b.status)-statusRank(a.status));
  return reliable[0]?.status||'TRACKING';
}
function applyArrival(base={},candidate={}){
  const out={...base};if(!candidate)return out;
  if(candidate.arrivalDate&&(candidate.arrivalIsActual||!out.arrivalDate))out.arrivalDate=candidate.arrivalDate;
  if(candidate.arrivalTime&&(candidate.arrivalIsActual||!out.arrivalTime))out.arrivalTime=candidate.arrivalTime;
  if(candidate.arrivalDate||candidate.arrivalTime)out.arrivalIsActual=Boolean(candidate.arrivalIsActual);
  return out;
}

async function dedicatedOfficial(mawb){
  if(mawb.startsWith('020-')) return trackLufthansa(mawb);
  if(mawb.startsWith('065-')) return trackSaudia(mawb);
  if(mawb.startsWith('157-')) return trackQatar(mawb);
  if(mawb.startsWith('160-')) return trackCathay(mawb);
  return {ok:false,skipped:true,reason:'NO DEDICATED OFFICIAL ADAPTER FOR THIS PREFIX'};
}
async function browserOfficial(mawb){
  return mawb.startsWith('065-')?trackSaudiaWithBrowser(mawb):trackWithBrowser(mawb);
}
async function cathayFlightEnrichment(mawb,directResult){
  if(!mawb.startsWith('160-')||!directResult?.ok)return null;
  const s=directResult.shipment||{};
  if(!s.flightNo||!s.origin||!s.destination||!directResult?.debug?.flightDate)return null;
  if((s.status==='ARRIVED'||s.status==='DELIVERED')&&s.arrivalDate&&s.arrivalTime)return null;
  return trackFlightStatusSnapshot({flightNo:s.flightNo,origin:s.origin,destination:s.destination,date:directResult.debug.flightDate});
}

async function handle(mawb){
  const airline=airlineForMawb(mawb);
  if(!airline)return Response.json({ok:false,error:`Airline prefix ${mawb.slice(0,3)} is not mapped yet.`},{status:422});

  // Every MAWB is checked against its airline page. API/direct adapters are supporting sources,
  // never the sole final source when an official browser capture is possible.
  const [apiSettled,directSettled,browserSettled]=await Promise.allSettled([
    trackWithTrackingMore(mawb,airline),dedicatedOfficial(mawb),browserOfficial(mawb)
  ]);
  const apiResult=apiSettled.status==='fulfilled'?apiSettled.value:{ok:false,reason:apiSettled.reason?.message||'API FAILED'};
  const directResult=directSettled.status==='fulfilled'?directSettled.value:{ok:false,reason:directSettled.reason?.message||'DIRECT ADAPTER FAILED'};
  const browserResult=browserSettled.status==='fulfilled'?browserSettled.value:{ok:false,reason:browserSettled.reason?.message||'BROWSER FAILED'};

  let cathayResult=null;
  if(directResult?.ok&&mawb.startsWith('160-'))cathayResult=await cathayFlightEnrichment(mawb,directResult);

  // OCR is automatic when the captured page is visually richer than the DOM, or when a DELAYED
  // status needs proof. This prevents generic page text from turning an arrived shipment into DELAYED.
  let ocrResult=null;
  const browserShipment=browserResult?.shipment||{};
  const needsOcr=Boolean(browserResult?.screenshotBase64)&&(!concrete(browserShipment)||browserShipment.status==='DELAYED'||browserShipment.status==='TRACKING');
  if(needsOcr){
    ocrResult=await readTrackingScreenshot({mawb,screenshotBase64:browserResult.screenshotBase64});
  }

  const api=apiResult?.ok?apiResult.shipment:null;
  const direct=directResult?.ok?directResult.shipment:null;
  const browser=browserResult?.ok?browserShipment:null;
  const ocr=ocrResult?.ok?ocrResult.shipment:null;
  const cathay=cathayResult?.ok?{...direct,status:cathayResult.status||direct?.status,arrivalDate:cathayResult.arrivalDate||direct?.arrivalDate,arrivalTime:cathayResult.arrivalTime||direct?.arrivalTime,arrivalIsActual:Boolean(cathayResult.arrivalIsActual),source:`${direct?.source||'Cathay'} + ${cathayResult.source}`} : null;

  let shipment={mawb,carrierCode:airline.iata||'',airlineName:airline.name||'',officialTracker:airline.url||''};
  // Core cargo facts: provider/direct first, then browser/screenshot fills missing/visible fields.
  if(api)shipment=mergeNonEmpty(shipment,api);
  if(direct)shipment=mergeNonEmpty(shipment,direct);
  if(browser)shipment=mergeNonEmpty(shipment,browser);
  if(ocr)shipment=mergeNonEmpty(shipment,ocr);
  if(cathay)shipment=mergeNonEmpty(shipment,cathay);

  // Actual arrival evidence from the captured page/screenshot wins over ETA or older provider data.
  shipment=applyArrival(shipment,api);
  shipment=applyArrival(shipment,direct);
  shipment=applyArrival(shipment,cathay);
  shipment=applyArrival(shipment,browser);
  shipment=applyArrival(shipment,ocr);
  shipment.status=chooseStatus({api,direct,browser,ocr,cathay});
  shipment.source=[direct?.source,api?.source,browser?.source,ocr?.source,cathayResult?.source].filter(Boolean).join(' + ')||'Official tracking verification';

  const verifiedStatus=shipment.status&&shipment.status!=='TRACKING';
  const hasUseful=concrete(shipment)||(verifiedStatus&&(ocr?.statusEvidence==='strong'||statusRank(shipment.status)>=5));
  if(hasUseful){
    console.log('mawb_tracking_result',mawb,'OK','SCREENSHOT_VERIFIED',shipment.status,'shot',Boolean(browserResult?.screenshotBase64),'ocr',Boolean(ocrResult?.ok));
    return Response.json({
      ok:true,version:VERSION,provider:'Official page + screenshot verified',shipment,
      screenshotCaptured:Boolean(browserResult?.screenshotBase64),
      screenshotVerified:Boolean(browserResult?.screenshotBase64),
      screenshotOcrUsed:Boolean(ocrResult?.ok),
      verification:{
        officialPage:browserResult?.debug?.url||browserResult?.officialTracker||airline.url||'',
        browserStage:browserResult?.debug?.stage||'',
        browserClicked:browserResult?.debug?.clicked||'',
        ocrStatusEvidence:ocr?.statusEvidence||'',
        ocrSnippet:ocr?.screenshotSnippet||'',
        cathayFlightScreenshot:Boolean(cathayResult?.screenshotBase64)
      },
      debug:{api:apiResult?.debug||null,direct:directResult?.debug||null,browser:browserResult?.debug||null,ocr:ocrResult?.debug||null}
    });
  }

  const apiConfigured=Boolean(process.env.TRACKINGMORE_API_KEY);
  const trackingError=ocrResult?.reason||browserResult?.reason||directResult?.reason||apiResult?.reason||'NO VERIFIED SHIPMENT DATA';
  console.log('mawb_tracking_result',mawb,'FAIL',trackingError);
  return Response.json({
    ok:false,version:VERSION,mawb,airline,trackingError,
    apiError:apiResult?.reason||'',directAdapterError:directResult?.reason||'',browserError:browserResult?.reason||'',screenshotOcrError:ocrResult?.reason||'',
    apiConfigured,requiredSecret:apiConfigured?null:'TRACKINGMORE_API_KEY',
    officialTracker:browserResult?.officialTracker||directResult?.officialTracker||airline.url||null,
    manualHint:directResult?.manualHint||null,
    screenshotCaptured:Boolean(browserResult?.screenshotBase64),screenshotVerified:Boolean(browserResult?.screenshotBase64),
    debug:{browser:browserResult?.debug||null,ocr:ocrResult?.debug||null}
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
    mode:'Every MAWB → official airline page → automatic screenshot → verified extraction → shared tracker save',
    apiProvider:'TrackingMore Air Cargo',apiConfigured:Boolean(process.env.TRACKINGMORE_API_KEY),
    dedicatedAdapters:['020 Lufthansa','065 Saudia translated segment browser','157 Qatar','160 Cathay'],
    automaticBrowserCapture:true,automaticScreenshotVerification:true,screenshotOcrFallback:true,
    carrierCount:CONFIGURED_PREFIXES.length,configuredPrefixes:CONFIGURED_PREFIXES
  });
  const mawb=normalizeMawb(q);if(!mawb)return Response.json({ok:false,error:'Enter a valid 11-digit MAWB.'},{status:400});
  return handle(mawb);
}
