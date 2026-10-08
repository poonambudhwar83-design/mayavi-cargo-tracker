import { trackSaudiaStrong } from './saudiaStrong.js';
import { trackSaudiaViaSal } from './saudiaSalPublic.js';
import { trackSaudiaViaSal as trackSaudiaViaSalBrowser } from './saudiaSal.js';
import { trackSaudia } from './saudia.js';
import { trackFlightScheduleFast } from './flightStatusSnapshot.js';
import { normalizeShipmentTimesToIst } from './exportIst.js';

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
  if(/^(DUS|DIS)$/.test(code)){s.status=Number(s.arrivedPieces||0)>0?'PART ARRIVED':'BOOKED';s.disAfterFow=true;s.arrivalIsActual=false;s.flightNo='';s.flightDate='';if(!Number(s.arrivedPieces||0)){s.arrivalDate='';s.arrivalTime='';}}else if(pending){s.status=isDepartedEvent(s)?'DEPARTED':'IN TRANSIT';s.arrivalIsActual=false;}else if(code==='RCF'&&isDelhiDestination(s)){s.status='ARRIVED';s.arrivalIsActual=true;}else if(code==='ARR'||code==='DLV'){s.status='ARRIVED';s.arrivalIsActual=true;}else if(code==='MAN'||code==='DEP'){s.status='DEPARTED';s.departureIsActual=true;s.arrivalIsActual=false;}else s.status=mapStatus(code,s.status,s.destination);if(isDepartedEvent(s)&&s.arrivalIsActual!==true)s.status='DEPARTED';return s;}
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

  // While SAL is still at RCS, an explicitly assigned flight and shipment Date
  // are planned fields only. This does not create FOW/MAN/DEP or actual arrival.
  if(/^(|BKD|RCS)$/.test(sourceCode(s))&&/^(|BKD|RCS)$/.test(sourceCode(sal))){
    if(!s.flightNo&&sal.flightNo)s.flightNo=sal.flightNo;
    if(!s.arrivalDate&&sal.arrivalDate){s.arrivalDate=sal.arrivalDate;s.arrivalIsActual=false;s.arrivalTimeSource=sal.arrivalTimeSource||'SAL shipment Date (planned arrival)';}
    if(!s.arrivalTime&&sal.arrivalTime){s.arrivalTime=sal.arrivalTime;s.arrivalIsActual=false;s.arrivalTimeSource=sal.arrivalTimeSource||'SAL planned arrival';}
    if(!s.arrivalTime&&sameFlight(s.flightNo,'SV760')&&s.arrivalDate){s.arrivalTime='17:00';s.arrivalIsActual=false;s.arrivalTimeSource='SV760 planned Delhi arrival fallback';}
    if(s.arrivalDate&&s.arrivalTime)s.eta=`${s.arrivalDate}T${s.arrivalTime}:00`;
  }

  // Mayavi display rule: once SAL has assigned the final Delhi flight number,
  // show its scheduled arrival clock even if SAL's event code is still RCS and
  // FOW has not propagated into the chronology API yet. This is planned time only.
  if(!s.arrivalTime&&s.arrivalDate&&sameFlight(s.flightNo,'SV760')){
    s.arrivalTime='17:00';
    s.arrivalIsActual=false;
    s.arrivalTimeSource='SV760 scheduled Delhi arrival (flight assigned)';
    s.eta=`${s.arrivalDate}T${s.arrivalTime}:00`;
  }

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
  s.status='IN TRANSIT';s.arrivalIsActual=false;

  if(flightDest&&flightDest!=='DEL'){
    // A hub-bound FOW is not an estimated arrival in DEL.
    s.arrivalDate='';s.arrivalTime='';s.eta=null;
    s.arrivalTimeSource='';
    return s;
  }
  if(flightDest!=='DEL')return s;

  const pending=(Array.isArray(s.partShipments)?s.partShipments:[])
    .find(p=>p.arrivalIsActual!==true&&sameFlight(p.flightNo,s.flightNo)
      &&/^(IN TRANSIT|DEPARTED)$/.test(String(p.status||'').toUpperCase()));
  const fowFlightDate=normalizeSaudiaDate(pending?.flightDate||s.flightDate||s.plannedFlightDate||s.scheduledFlightDate||'');
  let etaDate=normalizeSaudiaDate(pending?.arrivalDate||fowFlightDate);
  let etaTime=String(pending?.arrivalTime||'').trim();
  let etaSource=pending?.arrivalTimeSource||'SAL FOW Delhi flight date';

  // The public SAL card can include the expected flight arrival time. Only
  // accept the card for the same FLIGHT and operating date, never yesterday's ARR.
  let live=salShipment;
  if(!live){try{live=(await trackSaudiaViaSal(input))?.shipment;}catch{}}
  const sameOperatingDate=!live?.flightDate||!fowFlightDate
    ||normalizeSaudiaDate(live.flightDate)===fowFlightDate;
  if(live&&sameFlight(live.flightNo,s.flightNo)&&sameOperatingDate
    &&!(/^(DIS|DUS)$/.test(sourceCode(live)))){
    if(live.arrivalDate)etaDate=normalizeSaudiaDate(live.arrivalDate)||etaDate;
    if(live.arrivalTime){etaTime=live.arrivalTime;etaSource=live.arrivalTimeSource||'SAL final-flight ETA';}
    if(live.flightStatusUrl)s.flightStatusUrl=live.flightStatusUrl;
  }

  // If SAL only reports FOW and a flight/date, try the published flight
  // schedule. Do not treat a flight's landing as cargo ARR confirmation.
  if(!etaTime&&s.flightNo&&fowFlightDate){
    try{
      const flight=await trackFlightScheduleFast({
        flightNo:s.flightNo,date:fowFlightDate,
        origin:String(pending?.flightOrigin||s.via||'RUH').toUpperCase(),
        destination:'DEL'
      });
      if(flight?.ok&&(flight.arrivalTime||flight.scheduledArrivalTime)){
        const normalized=normalizeShipmentTimesToIst({
          destination:'DEL',
          arrivalDate:flight.arrivalDate||flight.scheduledArrivalDate||fowFlightDate,
          arrivalTime:flight.arrivalTime||flight.scheduledArrivalTime,
          arrivalTimeZone:flight.arrivalTimeZone||flight.scheduledArrivalTimeZone||'LOCAL',
          arrivalTimeSource:flight.arrivalTimeSource||flight.source||'Published flight ETA'
        });
        etaDate=normalized.arrivalDate||etaDate;
        etaTime=normalized.arrivalTime||etaTime;
        etaSource=normalized.arrivalTimeSource||'Published flight ETA';
      }
    }catch{}
  }

  // Retain the existing tentative SV760 timetable fallback when no dated live
  // ETA can be read; clearly label this as an estimate, never an actual arrival.
  if(!etaTime&&sameFlight(s.flightNo,'SV760')&&etaDate){
    etaTime='17:00';
    etaSource='SV760 tentative timetable fallback (unverified)';
  }

  if(etaDate){
    s.arrivalDate=etaDate;
    s.scheduledArrivalDate=etaDate;
  }else{s.arrivalDate='';}
  s.arrivalTime=etaTime;
  s.scheduledArrivalTime=etaTime;
  s.arrivalTimeSource=etaSource;
  s.arrivalTimeZone='IST';
  s.arrivalIsActual=false;
  s.arrivalEstimate=Boolean(etaDate);
  s.eta=etaDate&&etaTime?`${etaDate}T${etaTime}:00`:null;

  // IMPORTANT: pending FOW portion gets its own ETA on its own row.
  // Older arrived parts retain their actual dates and independent Mail flags.
  if(Array.isArray(s.partShipments)){
    s.partShipments=s.partShipments.map(p=>{
      const sameDate=!p.flightDate||!fowFlightDate||normalizeSaudiaDate(p.flightDate)===fowFlightDate;
      if(p.arrivalIsActual===true||!sameFlight(p.flightNo,s.flightNo)||!sameDate)return p;
      return{...p,arrivalDate:etaDate,arrivalTime:etaTime,arrivalIsActual:false,
        arrivalEstimate:Boolean(etaDate),arrivalTimeZone:'IST',
        arrivalTimeSource:etaSource,status:'IN TRANSIT',
        remarks:'FOW — Expected Delhi arrival (not yet confirmed ARR)'};
    });
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