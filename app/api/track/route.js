import { neon } from '@neondatabase/serverless';
import { trackCathay } from '../../../lib/cathay.js';
import { trackBritishEntry } from '../../../lib/britishEntry.js';
import { trackSaudiaDirect } from '../../../lib/saudiaDirect.js';
import { trackTurkish } from '../../../lib/turkish.js';
import { trackLufthansa } from '../../../lib/lufthansa.js';
import { trackQatar } from '../../../lib/qatar.js';
import { trackEmirates } from '../../../lib/emirates.js';
import { trackAirIndia } from '../../../lib/airIndia.js';
import { trackAirArabia } from '../../../lib/airArabia.js';
import { trackOman } from '../../../lib/oman.js';
import { trackKuwait } from '../../../lib/kuwait.js';
import { trackVirgin } from '../../../lib/virgin.js';
import { trackIndigo } from '../../../lib/indigo.js';
import { trackThai } from '../../../lib/thai.js';
import { trackVietnam } from '../../../lib/vietnam.js';
import { trackWithTrackingMore } from '../../../lib/trackingmore.js';
import { trackWithBrowser } from '../../../lib/browserTracker.js';
import { readTrackingScreenshot } from '../../../lib/screenshotOcr.js';
import { normalizeMawb, airlineForMawb, CONFIGURED_PREFIXES } from '../../../lib/airlines.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;
const VERSION='3.9.20';
const MONTH={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
const pad=v=>String(v).padStart(2,'0');

function trackingDbUrl(){
  return process.env.DATABASE_URL||process.env.POSTGRES_URL||process.env.NEON_DATABASE_URL||process.env.DATABASE_URL_UNPOOLED||'';
}
async function persistAirIndiaVirginResult(mawb,shipment={}){
  if(!(mawb.startsWith('098-')||mawb.startsWith('932-')))return{saved:false,skipped:true};
  const url=trackingDbUrl();if(!url)return{saved:false,reason:'NO_DATABASE_URL'};
  const awb=String(mawb).replace(/\D/g,'');
  const sql=neon(url);
  // Tracking refresh owns movement data, but the operator owns Mail YES/NO.
  // Preserve the saved per-part mail choice when fresh tracking rebuilds partShipments.
  let tracked={...shipment};
  if(Array.isArray(tracked.partShipments)){
    const existing=await sql`SELECT data FROM mayavi_shipments WHERE awb=${awb} LIMIT 1`;
    const savedParts=Array.isArray(existing?.[0]?.data?.partShipments)?existing[0].data.partShipments:[];
    tracked.partShipments=tracked.partShipments.map((p,i)=>{
      const id=String(p?.partId||`P${i+1}`);
      const saved=savedParts.find((x,j)=>String(x?.partId||`P${j+1}`)===id)
        ||savedParts.find(x=>String(x?.pieces||'')===String(p?.pieces||'')&&String(x?.weight||'').replace(/,/g,'')===String(p?.weight||'').replace(/,/g,''));
      return saved&&Object.prototype.hasOwnProperty.call(saved,'mailSent')
        ? {...p,mailSent:saved.mailSent===true,mailUpdatedAt:saved.mailUpdatedAt||''}
        : p;
    });
  }
  const patch={...tracked,mawb,lastChecked:new Date().toISOString(),trackingError:'',manualHint:''};
  for(const key of Object.keys(patch)){
    const value=patch[key];
    if(value===''||value===null||value===undefined)delete patch[key];
  }
  const rows=await sql`
    UPDATE mayavi_shipments
    SET data=data || ${JSON.stringify(patch)}::jsonb,
        version=version+1,
        updated_at=now(),
        tracking_checked_at=now()
    WHERE awb=${awb}
    RETURNING awb
  `;
  return{saved:Boolean(rows?.length)};
}

function concrete(s={}){
  return Boolean((s.origin&&s.destination)||s.bags||s.pieces||s.weight||s.flightNo||s.bookingDate||s.arrivalDate||s.arrivalTime);
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
function isFalseArrival(s={}){
  return statusRank(s?.status)>=5&&s?.arrivalIsActual===false;
}
function chooseStatus({api,direct,browser,ocr,cathay}){
  const all=[direct,browser,api,ocr,cathay].filter(Boolean);
  const valid=all.filter(s=>!isFalseArrival(s));
  const arrived=valid.find(s=>statusRank(s.status)>=5);
  if(arrived)return arrived.status;
  if(ocr?.status==='DELAYED'&&ocr?.statusEvidence==='strong')return'DELAYED';
  const browserDelayed=browser?.status==='DELAYED'&&concrete(browser);
  if(browserDelayed)return'DELAYED';
  const reliable=valid.filter(s=>s.status&&s.status!=='TRACKING').sort((a,b)=>statusRank(b.status)-statusRank(a.status));
  return reliable[0]?.status||'TRACKING';
}
function preferredArrival(...candidates){
  const all=candidates.filter(s=>s&&(s.arrivalDate||s.arrivalTime));
  const actual=all.find(s=>s.arrivalIsActual===true);
  const chosen=actual||all[0];
  if(!chosen)return null;
  return {arrivalDate:chosen.arrivalDate||'',arrivalTime:chosen.arrivalTime||'',arrivalIsActual:chosen.arrivalIsActual===true,arrivalTimeSource:chosen.arrivalTimeSource||chosen.source||''};
}
function applyPreferredArrival(base={},...candidates){
  const out={...base};
  const chosen=preferredArrival(...candidates);
  if(!chosen)return out;
  if(chosen.arrivalDate)out.arrivalDate=chosen.arrivalDate;
  if(chosen.arrivalTime)out.arrivalTime=chosen.arrivalTime;
  out.arrivalIsActual=chosen.arrivalIsActual;
  if(chosen.arrivalTimeSource)out.arrivalTimeSource=chosen.arrivalTimeSource;
  return out;
}
function parseBookingDate(text='',fallbackYear=''){
  const s=String(text||'').toUpperCase();
  let m=s.match(/\b(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})\b/);if(m)return`${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m=s.match(/\b(\d{1,2})[-\/.](\d{1,2})[-\/.](20\d{2})\b/);if(m)return`${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  m=s.match(/\b(\d{1,2})[\s\-,]+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s\-,]+(20\d{2})\b/);if(m)return`${m[3]}-${MONTH[m[2]]}-${pad(m[1])}`;
  m=s.match(/\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s\-,]+(\d{1,2})[\s\-,]+(20\d{2})\b/);if(m)return`${m[3]}-${MONTH[m[1]]}-${pad(m[2])}`;
  const year=/^20\d{2}$/.test(String(fallbackYear||''))?String(fallbackYear):'';
  if(year){
    m=s.match(/\b(\d{1,2})[\s\-,]+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\b/);if(m)return`${year}-${MONTH[m[2]]}-${pad(m[1])}`;
    m=s.match(/\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s\-,]+(\d{1,2})\b/);if(m)return`${year}-${MONTH[m[1]]}-${pad(m[2])}`;
  }
  return'';
}
function bookingDateFromOfficialText(text='',arrivalDate=''){
  const flat=String(text||'').replace(/\s+/g,' ').trim();if(!flat)return'';
  const fallbackYear=String(arrivalDate||'').match(/^(20\d{2})/)?.[1]||String(new Date().getUTCFullYear());
  const priorities=[
    /\bBOOKED\b|BOOKING\s+DATE|BOOKED\s+(?:ON|AT)|BOOKING\s+CONFIRMED/ig,
    /\bRCS\b|RECEIVED\s+FROM\s+SHIPPER|\bACCEPTED\b|\bACCEPT\b/ig
  ];
  for(const rx of priorities){
    const matches=[...flat.matchAll(rx)];
    for(const match of matches){
      const at=match.index||0;
      const window=flat.slice(Math.max(0,at-120),Math.min(flat.length,at+360));
      const d=parseBookingDate(window,fallbackYear);if(d)return d;
    }
  }
  return'';
}
function debugText(result={}){
  const d=result?.debug||{};
  return [d.summarySample,d.activitySample,d.panelSample,d.bodySample,d.textSample,d.arrivalEvidence,d.preview,d.sample,d.pageText]
    .filter(Boolean).join(' ');
}

async function dedicatedOfficial(mawb){
  if(mawb.startsWith('020-')) return trackLufthansa(mawb);
  if(mawb.startsWith('065-')) return {ok:false,skipped:true,reason:'SAUDIA USES DEEP DIRECT TRACK-SHIPMENT READER'};
  if(mawb.startsWith('098-')) return trackAirIndia(mawb);
  if(mawb.startsWith('125-')) return trackBritishEntry(mawb);
  if(mawb.startsWith('157-')) return trackQatar(mawb);
  if(mawb.startsWith('160-')) return trackCathay(mawb);
  if(mawb.startsWith('176-')) return trackEmirates(mawb);
  if(mawb.startsWith('217-')) return trackThai(mawb);
  if(mawb.startsWith('229-')) return trackKuwait(mawb);
  if(mawb.startsWith('235-')) return trackTurkish(mawb);
  if(mawb.startsWith('312-')) return trackIndigo(mawb);
  if(mawb.startsWith('514-')) return trackAirArabia(mawb);
  if(mawb.startsWith('738-')) return trackVietnam(mawb);
  if(mawb.startsWith('910-')) return trackOman(mawb);
  if(mawb.startsWith('932-')){
    let result=await trackVirgin(mawb);
    if(!result?.ok&&/ETXTBSY|EBUSY/i.test(String(result?.reason||''))){
      await new Promise(resolve=>setTimeout(resolve,650));
      result=await trackVirgin(mawb);
    }
    return result;
  }
  return {ok:false,skipped:true,reason:'NO DEDICATED OFFICIAL ADAPTER FOR THIS PREFIX'};
}
async function browserOfficial(mawb){
  if(mawb.startsWith('125-')) return {ok:false,skipped:true,reason:'BRITISH AIRWAYS USES DEDICATED IAG TRACK AND TRACE ADAPTER'};
  if(mawb.startsWith('157-')) return {ok:false,skipped:true,reason:'QATAR USES DEDICATED OFFICIAL BROWSER ADAPTER'};
  if(mawb.startsWith('160-')) return {ok:false,skipped:true,reason:'CATHAY USES FAST DEDICATED TERMINAL ADAPTER'};
  if(mawb.startsWith('176-')) return {ok:false,skipped:true,reason:'EMIRATES USES DEDICATED ESKYCARGO LIVE PAGE ADAPTER'};
  if(mawb.startsWith('098-')) return {ok:false,skipped:true,reason:'AIR INDIA USES DEDICATED CARGO PORTAL ADAPTER'};
  if(mawb.startsWith('217-')) return {ok:false,skipped:true,reason:'THAI CARGO USES DEDICATED CHORUS PUBLIC TRACKER'};
  if(mawb.startsWith('229-')) return {ok:false,skipped:true,reason:'KUWAIT AIRWAYS USES DEDICATED DETAILS TABLE ADAPTER'};
  if(mawb.startsWith('235-')) return {ok:false,skipped:true,reason:'TURKISH CARGO USES DEDICATED OFFICIAL TRACKER'};
  if(mawb.startsWith('312-')) return {ok:false,skipped:true,reason:'INDIGO USES DEDICATED SMARTKARGO FORM ADAPTER'};
  if(mawb.startsWith('514-')) return {ok:false,skipped:true,reason:'AIR ARABIA USES DEDICATED DETAILS-SCREEN ADAPTER'};
  if(mawb.startsWith('738-')) return {ok:false,skipped:true,reason:'VIETNAM AIRLINES USES CHAMP TRACK & TRACE DEDICATED ADAPTER'};
  if(mawb.startsWith('910-')) return {ok:false,skipped:true,reason:'OMAN AIR CARGO USES DEDICATED OFFICIAL TRACKER'};
  if(mawb.startsWith('932-')) return {ok:false,skipped:true,reason:'VIRGIN ATLANTIC USES DEDICATED TRACK CARGO ADAPTER'};
  return mawb.startsWith('065-')?trackSaudiaDirect(mawb):trackWithBrowser(mawb);
}

async function handle(mawb){
  const airline=airlineForMawb(mawb);
  if(!airline)return Response.json({ok:false,error:`Airline prefix ${mawb.slice(0,3)} is not mapped yet.`},{status:422});

  const airArabiaOfficialOnly=mawb.startsWith('514-');
  const airIndiaFastPath=mawb.startsWith('098-');
  const britishFastPath=mawb.startsWith('125-');
  const qatarFastPath=mawb.startsWith('157-');
  const cathayFastPath=mawb.startsWith('160-');
  const saudiaFastPath=mawb.startsWith('065-');
  const thaiFastPath=mawb.startsWith('217-');
  const kuwaitFastPath=mawb.startsWith('229-');
  const turkishFastPath=mawb.startsWith('235-');
  const indigoFastPath=mawb.startsWith('312-');
  const omanFastPath=mawb.startsWith('910-');
  const vietnamFastPath=mawb.startsWith('738-');
  const virginFastPath=mawb.startsWith('932-');
  const skipGenericApi=airArabiaOfficialOnly||airIndiaFastPath||britishFastPath||qatarFastPath||cathayFastPath||saudiaFastPath||thaiFastPath||kuwaitFastPath||turkishFastPath||indigoFastPath||omanFastPath||vietnamFastPath||virginFastPath;
  const [apiSettled,directSettled,browserSettled]=await Promise.allSettled([
    skipGenericApi?Promise.resolve({ok:false,skipped:true,reason:britishFastPath?'BRITISH AIRWAYS IAG TRACK AND TRACE ADAPTER IS PRIMARY':airIndiaFastPath?'AIR INDIA DEDICATED CARGO PORTAL ADAPTER IS PRIMARY':qatarFastPath?'QATAR DEDICATED OFFICIAL BROWSER ADAPTER IS PRIMARY':thaiFastPath?'THAI CARGO CHORUS PUBLIC TRACKER IS PRIMARY':kuwaitFastPath?'KUWAIT AIRWAYS DEDICATED DETAILS TABLE ADAPTER IS PRIMARY':turkishFastPath?'TURKISH CARGO DEDICATED OFFICIAL TRACKER IS PRIMARY':indigoFastPath?'INDIGO DEDICATED SMARTKARGO FORM ADAPTER IS PRIMARY':saudiaFastPath?'SAUDIA DEEP DIRECT TRACK-SHIPMENT IS PRIMARY':cathayFastPath?'CATHAY FAST PATH USES OFFICIAL TERMINAL ONLY':omanFastPath?'OMAN AIR CARGO DEDICATED OFFICIAL TRACKER IS PRIMARY':virginFastPath?'VIRGIN ATLANTIC DEDICATED TRACK CARGO ADAPTER IS PRIMARY':'AIR ARABIA OFFICIAL DETAILS-SCREEN FLOW IS PRIMARY'}):trackWithTrackingMore(mawb,airline),
    dedicatedOfficial(mawb),browserOfficial(mawb)
  ]);
  const apiResult=apiSettled.status==='fulfilled'?apiSettled.value:{ok:false,reason:apiSettled.reason?.message||'API FAILED'};
  const directResult=directSettled.status==='fulfilled'?directSettled.value:{ok:false,reason:directSettled.reason?.message||'DIRECT ADAPTER FAILED'};
  const browserResult=browserSettled.status==='fulfilled'?browserSettled.value:{ok:false,reason:browserSettled.reason?.message||'BROWSER FAILED'};

  const cathayResult=null;
  let ocrResult=null;
  const browserShipment=browserResult?.shipment||{};
  const skipGenericOcr=mawb.startsWith('065-')||mawb.startsWith('098-')||mawb.startsWith('125-')||mawb.startsWith('157-')||mawb.startsWith('160-')||mawb.startsWith('176-')||mawb.startsWith('217-')||mawb.startsWith('229-')||mawb.startsWith('235-')||mawb.startsWith('312-')||mawb.startsWith('514-')||mawb.startsWith('738-')||mawb.startsWith('910-')||mawb.startsWith('932-');
  const needsOcr=!skipGenericOcr&&Boolean(browserResult?.screenshotBase64)&&(!concrete(browserShipment)||!browserShipment.bookingDate||browserShipment.status==='DELAYED'||browserShipment.status==='TRACKING');
  if(needsOcr)ocrResult=await readTrackingScreenshot({mawb,screenshotBase64:browserResult.screenshotBase64});

  const api=apiResult?.ok?apiResult.shipment:null;
  const direct=directResult?.ok?directResult.shipment:null;
  const browser=browserResult?.ok?browserShipment:null;
  const ocr=ocrResult?.ok?ocrResult.shipment:null;
  const cathay=null;

  let shipment={mawb,carrierCode:airline.iata||'',airlineName:airline.name||'',officialTracker:airline.url||''};
  if(api)shipment=mergeNonEmpty(shipment,api);
  if(direct)shipment=mergeNonEmpty(shipment,direct);
  if(browser)shipment=mergeNonEmpty(shipment,browser);
  if(ocr)shipment=mergeNonEmpty(shipment,ocr);

  shipment=applyPreferredArrival(shipment,direct,browser,api,ocr);
  // Preserve Air India split-load display fields from the dedicated Activity View
  // adapter. Generic merging/arrival selection must not collapse 20/33 back to 33.
  if(airIndiaFastPath&&direct){
    for(const k of ['bags','pieces','weight','masterPieces','masterWeight','arrivedPieces','arrivedWeight','arrivedPiecesDisplay','arrivedWeightDisplay','departedPieces','departedWeight','remainingPieces','remainingWeight','nextFlightNo','nextFlightDate','nextPieces','nextWeight','partShipments','remarks']){
      if(direct[k]!==''&&direct[k]!==null&&direct[k]!==undefined)shipment[k]=direct[k];
    }
  }
  if(!shipment.bookingDate){
    const officialText=[debugText(directResult),debugText(browserResult),debugText(apiResult)].filter(Boolean).join(' ');
    const derivedBookingDate=bookingDateFromOfficialText(officialText,shipment.arrivalDate);
    if(derivedBookingDate){shipment.bookingDate=derivedBookingDate;shipment.bookingDateSource='Official Booked/Accepted/RCS event';}
  }
  shipment.status=chooseStatus({api,direct,browser,ocr,cathay});
  shipment.source=[direct?.source,api?.source,browser?.source,ocr?.source].filter(Boolean).join(' + ')||'Official tracking verification';

  const verifiedStatus=shipment.status&&shipment.status!=='TRACKING';
  const directScreenshot=Boolean(directResult?.screenshotCaptured);
  const directOcr=Boolean(directResult?.screenshotOcrUsed);
  const screenshotCaptured=Boolean(browserResult?.screenshotBase64)||directScreenshot;
  const screenshotVerified=Boolean(browserResult?.screenshotBase64)||Boolean(directResult?.screenshotVerified);
  const screenshotOcrUsed=Boolean(ocrResult?.ok)||directOcr;
  const hasUseful=concrete(shipment)||(verifiedStatus&&(ocr?.statusEvidence==='strong'||statusRank(shipment.status)>=5||directOcr||directScreenshot||Boolean(browser)||Boolean(direct)));
  if(hasUseful){
    let serverSaved=false;
    if(airIndiaFastPath||virginFastPath){
      try{serverSaved=(await persistAirIndiaVirginResult(mawb,shipment)).saved===true;}
      catch(e){console.log('mobile_tracking_save_error',mawb,e?.message||String(e));}
    }
    console.log('mawb_tracking_result',mawb,'OK','SCREENSHOT_VERIFIED',shipment.status,'shot',screenshotCaptured,'ocr',screenshotOcrUsed,'bookingDate',shipment.bookingDate||'','arrival',shipment.arrivalDate||'',shipment.arrivalTime||'','parts',Array.isArray(shipment.partShipments)?shipment.partShipments.length:0,'serverSaved',serverSaved);
    const provider=mawb.startsWith('065-')?'Saudia Cargo deep direct track-shipment':mawb.startsWith('098-')?'Air India Cargo Portal':mawb.startsWith('125-')?'British Airways / IAG Cargo official Track & Trace':mawb.startsWith('157-')?'Qatar Cargo dedicated official browser':mawb.startsWith('160-')?'Cathay Cargo Terminal official tracking':mawb.startsWith('176-')?'Emirates eSkyCargo live page':mawb.startsWith('217-')?'THAI Cargo CHORUS public tracking':mawb.startsWith('229-')?'Kuwait Airways Cargo official tracking':mawb.startsWith('235-')?'Turkish Cargo official tracking':mawb.startsWith('312-')?'IndiGo CarGo SmartKargo official form':mawb.startsWith('514-')?'Air Arabia Cargo details-screen screenshot':mawb.startsWith('910-')?'Oman Air Cargo dedicated official tracker':mawb.startsWith('738-')?'Vietnam Airlines CHAMP Track & Trace':mawb.startsWith('932-')?'Virgin Atlantic Cargo Track Cargo':'Official page + screenshot verified';
    return Response.json({ok:true,version:VERSION,provider,shipment,serverSaved,screenshotCaptured,screenshotVerified,screenshotOcrUsed,verification:{officialPage:browserResult?.officialTracker||direct?.officialTracker||airline.url||'',browserStage:browserResult?.debug?.stage||directResult?.debug?.stage||'',browserClicked:browserResult?.debug?.attempts?.[0]?.clicked||browserResult?.debug?.setup?.mode||browserResult?.debug?.clicked||directResult?.debug?.nextClicked||'',ocrStatusEvidence:ocr?.statusEvidence||'',ocrSnippet:ocr?.screenshotSnippet||'',bookingDateSource:shipment.bookingDateSource||'',emiratesShipmentId:mawb.startsWith('176-')?(directResult?.debug?.shipmentId||''):'',cathayFlightScreenshot:false,airArabiaNextClicked:mawb.startsWith('514-')?(directResult?.debug?.nextClicked||''):''},debug:{api:apiResult?.debug||null,direct:directResult?.debug||null,browser:browserResult?.debug||null,ocr:ocrResult?.debug||null}});
  }

  const apiConfigured=Boolean(process.env.TRACKINGMORE_API_KEY);
  const trackingError=directResult?.reason||browserResult?.reason||ocrResult?.reason||apiResult?.reason||'NO VERIFIED SHIPMENT DATA';
  console.log('mawb_tracking_result',mawb,'FAIL',trackingError);
  return Response.json({ok:false,version:VERSION,mawb,airline,trackingError,apiError:apiResult?.reason||'',directAdapterError:directResult?.reason||'',browserError:browserResult?.reason||'',screenshotOcrError:ocrResult?.reason||'',apiConfigured,requiredSecret:apiConfigured?null:'TRACKINGMORE_API_KEY',officialTracker:directResult?.officialTracker||browserResult?.officialTracker||airline.url||null,manualHint:directResult?.manualHint||null,screenshotCaptured,screenshotVerified,debug:{direct:directResult?.debug||null,browser:browserResult?.debug||null,ocr:ocrResult?.debug||null}},{status:503});
}

export async function POST(request){
  let body={};try{body=await request.json()}catch{return Response.json({ok:false,error:'Invalid request body.'},{status:400})}
  const mawb=normalizeMawb(body?.mawb);if(!mawb)return Response.json({ok:false,error:'Enter a valid 11-digit MAWB.'},{status:400});
  return handle(mawb);
}

export async function GET(request){
  const q=new URL(request.url).searchParams.get('mawb');
  if(!q)return Response.json({ok:true,version:VERSION,mode:'Every MAWB → official airline page → automatic extraction → shared tracker save',apiProvider:'TrackingMore Air Cargo',apiConfigured:Boolean(process.env.TRACKINGMORE_API_KEY),dedicatedAdapters:['020 Lufthansa','065 Saudia deep direct track-shipment','098 Air India Cargo Portal','125 British Airways / IAG Cargo','157 Qatar dedicated official browser','160 Cathay fast terminal','176 Emirates eSkyCargo live page','217 THAI Cargo CHORUS public tracking','229 Kuwait Airways Cargo details table','235 Turkish Cargo official tracking','312 IndiGo SmartKargo form','514 Air Arabia Cargo details-screen screenshot','738 Vietnam Airlines CHAMP Track & Trace','910 Oman Air Cargo dedicated official tracker','932 Virgin Atlantic Track Cargo'],automaticBrowserCapture:true,automaticScreenshotVerification:true,screenshotOcrFallback:true,bookingDateOcr:true,bookingDateEventBackfill:true,carrierCount:CONFIGURED_PREFIXES.length,configuredPrefixes:CONFIGURED_PREFIXES});
  const mawb=normalizeMawb(q);if(!mawb)return Response.json({ok:false,error:'Enter a valid 11-digit MAWB.'},{status:400});
  return handle(mawb);
}
