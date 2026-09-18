import { trackSaudiaStrong } from './saudiaStrong.js';
import { trackSaudiaViaSal } from './saudiaSalPublic.js';
import { trackSaudiaViaSal as trackSaudiaViaSalBrowser } from './saudiaSal.js';
import { trackSaudia } from './saudia.js';

const PUBLIC_URL='https://sal.sa/trackshipment';
const MONTH={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
const pad=v=>String(v).padStart(2,'0');
function normalizeSaudiaDate(value=''){const s=String(value||'').trim().toUpperCase();let m=s.match(/^([0-3]?\d)(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{2}|\d{4})$/);if(m){const y=m[3].length===2?`20${m[3]}`:m[3];return`${y}-${MONTH[m[2]]}-${pad(m[1])}`;}m=s.match(/^(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})$/);if(m)return`${m[1]}-${pad(m[2])}-${pad(m[3])}`;m=s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](20\d{2})$/);if(m)return`${m[3]}-${pad(m[1])}-${pad(m[2])}`;return'';}
function sourceCode(s={}){return String(s.sourceStatus||s.eventCode||s.latestEventCode||'').trim().toUpperCase();}
function isDelhiDestination(s={}){return String(s.destination||'').trim().toUpperCase()==='DEL';}
function hasPendingPartLoad(s={}){const total=Number(s.totalPieces||s.pieces||s.bags||0),arrived=Number(s.arrivedPieces||0),pending=Number(s.pendingPieces||0),status=String(s.status||'').trim().toUpperCase();return s.isPartLoad===true||status==='PART ARRIVED'||pending>0||(total>0&&arrived>0&&arrived<total);}
function isDepartedEvent(s={}){return /^(MAN|DEP)$/.test(sourceCode(s))||s.departureIsActual===true;}
function mapStatus(code='',fallback='TRACKING',destination=''){const s=String(code||'').trim().toUpperCase(),dest=String(destination||'').trim().toUpperCase();if(s==='BKD'||s==='FBL'||s==='RCS')return'BOOKED';if(s==='DLY')return'DELAYED';if(s==='DLV'||s==='ARR')return'ARRIVED';if(s==='RCF'&&dest==='DEL')return'ARRIVED';if(s==='MAN'||s==='DEP')return'DEPARTED';if(s==='FOW'||s==='XXX'||s==='RCF'||s==='FIW')return'IN TRANSIT';return fallback||'TRACKING';}
function normalizeShipment(input={}){const s={...input};const code=sourceCode(s),pending=hasPendingPartLoad(s);const fd=normalizeSaudiaDate(s.flightDate||s.plannedFlightDate||s.scheduledFlightDate||'');if(fd)s.flightDate=fd;const ad=normalizeSaudiaDate(s.arrivalDate||'');if(ad)s.arrivalDate=ad;const bd=normalizeSaudiaDate(s.bookingDate||'');if(bd)s.bookingDate=bd;
  // Strong chronology already resolved FOW/DIS/DEP/ARR and must not be overwritten.
  if(s.source==='SAL complete shipment chronology')return s;
  if(pending){s.status=isDepartedEvent(s)?'DEPARTED':'IN TRANSIT';s.arrivalIsActual=false;}else if(code==='RCF'&&isDelhiDestination(s)){s.status='ARRIVED';s.arrivalIsActual=true;}else if(code==='ARR'||code==='DLV'){s.status='ARRIVED';s.arrivalIsActual=true;}else if(code==='MAN'||code==='DEP'){s.status='DEPARTED';s.departureIsActual=true;s.arrivalIsActual=false;}else s.status=mapStatus(code,s.status,s.destination);if(isDepartedEvent(s)&&s.arrivalIsActual!==true)s.status='DEPARTED';return s;}
function sameFlight(a='',b=''){return String(a||'').replace(/\s+/g,'').toUpperCase()===String(b||'').replace(/\s+/g,'').toUpperCase();}

function backfillStrongSummary(strong={},sal={}){
  const s={...strong};
  const pick=(key,...aliases)=>{
    if(s[key]!==''&&s[key]!==null&&s[key]!==undefined)return;
    for(const name of aliases){
      const value=sal?.[name];
      if(value!==''&&value!==null&&value!==undefined){s[key]=value;return;}
    }
  };

  // SAL complete chronology remains authoritative for flight movement, FOW,
  // part-load, arrival and status. The public SAL parser only fills shipment
  // header/acceptance fields that the chronology payload may omit.
  pick('bookingDate','bookingDate');
  pick('bookingTime','bookingTime');
  pick('bookingDateSource','bookingDateSource');
  pick('origin','origin');
  pick('destination','destination');
  pick('pieces','pieces','bags','totalPieces');
  pick('bags','bags','pieces','totalPieces');
  pick('weight','weight','totalWeight');
  pick('volume','volume');
  pick('totalPieces','totalPieces');
  pick('totalWeight','totalWeight');

  if(!s.pieces&&s.totalPieces)s.pieces=s.totalPieces;
  if(!s.bags&&s.totalPieces)s.bags=s.totalPieces;
  if(!s.weight&&s.totalWeight)s.weight=s.totalWeight;
  return s;
}

function enrichMissingStrongMovement(strong={},browser={}){
  const s={...strong};
  const strongCode=sourceCode(s);
  const browserCode=sourceCode(browser);
  // Only repair an incomplete strong chronology that stopped at booking/RCS.
  // If strong already has MAN/FOW/DEP/ARR/RCF/DLV, it stays authoritative.
  if(!/^(|BKD|RCS)$/.test(strongCode))return s;
  if(!/^(MAN|FOW|DEP|ARR|RCF|FIW|DLV)$/.test(browserCode))return s;

  for(const key of ['flightNo','flightDate','flightDestination','airport','arrivalDate','arrivalTime','arrivalTimeSource','flightStatusUrl']){
    const value=browser?.[key];
    if(value!==''&&value!==null&&value!==undefined)s[key]=value;
  }
  s.sourceStatus=browserCode;
  s.latestEventCode=browserCode;
  if(browser?.departureIsActual===true)s.departureIsActual=true;
  if(browser?.arrivalIsActual===true)s.arrivalIsActual=true;
  s.movementBackfillSource='SAL browser scrolled event cards';
  return s;
}

async function applyFowFlightRule(input,shipment={},salShipment=null){
  const s={...shipment};
  if(sourceCode(s)!=='FOW')return s;

  const flightDest=String(s.flightDestination||'').trim().toUpperCase();
  // FOW means the booked flight movement is expected. The cargo is still in transit
  // until SAL provides a destination arrival/RCF event.
  s.status='IN TRANSIT';
  s.arrivalIsActual=false;

  // A FOW leg terminating before Delhi (for example SV1145/SV1173 to RUH)
  // must never populate Delhi arrival columns.
  if(flightDest&&flightDest!=='DEL'){
    s.arrivalDate='';
    s.arrivalTime='';
    s.arrivalTimeSource='';
    s.eta=null;
    return s;
  }

  // For a FOW final leg to Delhi (for example SV760), keep any schedule carried
  // by the SAL chronology and enrich it from the SAL public final-leg reader when
  // the same flight can be verified. Do not mark the cargo ARRIVED while SAL still
  // says FOW; these are expected flight-arrival fields, not cargo RCF confirmation.
  if(flightDest==='DEL'){
    let live=null;
    try{
      live=salShipment||((await trackSaudiaViaSal(input))?.shipment);
      if(live&&sameFlight(live.flightNo,s.flightNo)){
        if(live.arrivalDate)s.arrivalDate=live.arrivalDate;
        if(live.arrivalTime)s.arrivalTime=live.arrivalTime;
        if(live.arrivalTimeSource)s.arrivalTimeSource=live.arrivalTimeSource;
        if(live.flightStatusUrl)s.flightStatusUrl=live.flightStatusUrl;
      }
    }catch{}

    // MAWB-specific SAL FOW is authoritative for the planned operating date.
    // If SAL assigns the final Delhi leg but omits a separate arrival-date field,
    // use that FOW flight date as the expected Delhi arrival date. It is still
    // only planned until ARR/RCF is published.
    const plannedDate=normalizeSaudiaDate(
      s.arrivalDate||s.flightDate||s.plannedFlightDate||s.scheduledFlightDate||
      (live&&sameFlight(live.flightNo,s.flightNo)?(live.arrivalDate||live.flightDate):'')
    );
    if(!s.arrivalDate&&plannedDate){
      s.arrivalDate=plannedDate;
      s.arrivalTimeSource=s.arrivalTimeSource||'SAL FOW final-leg planned date';
    }

    // SV760 is the RUH→DEL final leg. When SAL has assigned SV760 to this MAWB
    // but the card/API omits the clock time, use its Delhi scheduled arrival
    // time as a last-resort fallback. SAL date remains authoritative.
    if(!s.arrivalTime&&sameFlight(s.flightNo,'SV760')){
      s.arrivalTime='17:00';
      s.arrivalTimeSource='SV760 planned Delhi arrival fallback';
    }
    if(s.arrivalDate&&s.arrivalTime)s.eta=`${s.arrivalDate}T${s.arrivalTime}:00`;
    s.arrivalIsActual=false;
  }
  return s;
}

export async function trackSaudiaDirect(input){
  // 1) SAL complete chronology: reads every Parts/Events record returned for the AWB.
  // This is the data equivalent of scrolling through the entire SAL timeline to its end;
  // it never stops merely because a latest date, FOW, DEP or ARR has appeared.
  let strong;try{strong=await trackSaudiaStrong(input);}catch(e){strong={ok:false,reason:e?.message||'SAL FULL CHRONOLOGY FAILED'};}
  if(strong?.ok&&strong?.shipment){
    // Strong chronology gives the correct event/FOW/part-load sequence, but SAL
    // may expose booking/header fields only in the broader public response.
    // Read that response once and fill only missing summary fields.
    let salSummary;try{salSummary=await trackSaudiaViaSal(input);}catch{}
    let shipment=normalizeShipment(strong.shipment);
    if(salSummary?.ok&&salSummary?.shipment){
      shipment=backfillStrongSummary(shipment,salSummary.shipment);
    }

    // Sometimes SAL's API exposes only the RCS header while the website shows
    // later FOW/flight cards further down the page. In that specific case,
    // scroll the public page and recover the missing movement without replacing
    // an already-complete strong chronology.
    let salBrowserMovement=null;
    if(/^(|BKD|RCS)$/.test(sourceCode(shipment))){
      try{salBrowserMovement=await trackSaudiaViaSalBrowser(input);}catch{}
      if(salBrowserMovement?.ok&&salBrowserMovement?.shipment){
        shipment=backfillStrongSummary(shipment,salBrowserMovement.shipment);
        shipment=enrichMissingStrongMovement(shipment,salBrowserMovement.shipment);
      }
    }else if(!salSummary?.ok){
      try{salSummary=await trackSaudiaViaSalBrowser(input);}catch{}
      if(salSummary?.ok&&salSummary?.shipment)shipment=backfillStrongSummary(shipment,salSummary.shipment);
    }

    const fowSource=salBrowserMovement?.shipment||salSummary?.shipment||null;
    shipment=await applyFowFlightRule(input,shipment,fowSource);
    return{...strong,shipment,officialTracker:PUBLIC_URL,debug:{...(strong.debug||{}),sourceSelection:'SAL_FULL_CHRONOLOGY_PRIMARY',summaryBackfill:Boolean((salSummary?.ok&&salSummary?.shipment)||(salBrowserMovement?.ok&&salBrowserMovement?.shipment)),summaryBackfillSource:salSummary?.shipment?.source||salBrowserMovement?.shipment?.source||'',movementBackfill:Boolean(salBrowserMovement?.ok&&salBrowserMovement?.shipment&&shipment.movementBackfillSource),movementBackfillSource:shipment.movementBackfillSource||'',fowFlightRule:true}};
  }

  // 2) SAL API parser remains fallback. If the API returns no timeline/header
  // data for this AWB, read the same SAL public tracking page in a browser.
  let sal;try{sal=await trackSaudiaViaSal(input);}catch(e){sal={ok:false,reason:e?.message||'SAL SOURCE FAILED'};}
  if(sal?.ok&&sal?.shipment)return{...sal,shipment:normalizeShipment(sal.shipment),officialTracker:PUBLIC_URL,debug:{...(sal.debug||{}),sourceSelection:'SAL_PUBLIC_FALLBACK',strongReason:strong?.reason||''}};
  let salBrowser;try{salBrowser=await trackSaudiaViaSalBrowser(input);}catch(e){salBrowser={ok:false,reason:e?.message||'SAL BROWSER SOURCE FAILED'};}
  if(salBrowser?.ok&&salBrowser?.shipment){
    let browserShipment=normalizeShipment(salBrowser.shipment);
    browserShipment=await applyFowFlightRule(input,browserShipment,salBrowser.shipment);
    return{...salBrowser,shipment:browserShipment,officialTracker:PUBLIC_URL,debug:{...(salBrowser.debug||{}),sourceSelection:'SAL_BROWSER_FALLBACK',strongReason:strong?.reason||'',salReason:sal?.reason||'',fowFlightRule:true}};
  }

  // 3) Existing Saudia public source remains last fallback. No other airline is changed.
  let official;try{official=await trackSaudia(input);}catch(e){official={ok:false,reason:e?.message||'SAUDIA PUBLIC SOURCE FAILED'};}
  if(official?.ok&&official?.shipment)return{...official,shipment:normalizeShipment(official.shipment),officialTracker:PUBLIC_URL,debug:{...(official.debug||{}),sourceSelection:'OFFICIAL_PUBLIC_AUTOMATIC_FALLBACK',strongReason:strong?.reason||'',salReason:sal?.reason||''}};
  return{ok:false,reason:'SAUDIA AUTOMATIC SOURCES HAVE NO READABLE DATA YET',officialTracker:PUBLIC_URL,debug:{sourceSelection:'AUTO_ONLY_NO_DATA',strongReason:strong?.reason||'',salReason:sal?.reason||'',salBrowserReason:salBrowser?.reason||'',officialReason:official?.reason||''}};
}