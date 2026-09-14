import { trackSaudiaViaSal } from './saudiaSalPublic.js';

const PUBLIC_URL='https://saudiacargo.com/en/digital-services?tab=trackShipment';
const MONTH={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
const pad=v=>String(v).padStart(2,'0');

function normalizeSaudiaDate(value=''){
  const s=String(value||'').trim().toUpperCase();
  let m=s.match(/^([0-3]?\d)(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{2}|\d{4})$/);
  if(m){const y=m[3].length===2?`20${m[3]}`:m[3];return `${y}-${MONTH[m[2]]}-${pad(m[1])}`;}
  m=s.match(/^(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})$/);
  if(m)return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  return '';
}

function sourceCode(s={}){return String(s.sourceStatus||s.eventCode||s.latestEventCode||'').trim().toUpperCase();}
function isDelhiDestination(s={}){return String(s.destination||'').trim().toUpperCase()==='DEL';}
function hasPendingPartLoad(s={}){
  const total=Number(s.totalPieces||s.pieces||s.bags||0),arrived=Number(s.arrivedPieces||0),pending=Number(s.pendingPieces||0);
  const status=String(s.status||'').trim().toUpperCase();
  return s.isPartLoad===true||status==='PART ARRIVED'||pending>0||(total>0&&arrived>0&&arrived<total);
}
function isDepartedEvent(s={}){return /^(MAN|DEP)$/.test(sourceCode(s))||s.departureIsActual===true;}
function mapStatus(code='',fallback='TRACKING',destination=''){
  const s=String(code||'').trim().toUpperCase(),dest=String(destination||'').trim().toUpperCase();
  if(s==='BKD'||s==='FBL'||s==='RCS')return'BOOKED';
  if(s==='DLY')return'DELAYED';
  if(s==='DLV'||s==='ARR')return'ARRIVED';
  if(s==='RCF'&&dest==='DEL')return'ARRIVED';
  if(s==='MAN'||s==='DEP')return'DEPARTED';
  if(s==='FOW'||s==='XXX'||s==='RCF'||s==='FIW')return'IN TRANSIT';
  return fallback||'TRACKING';
}
function normalizeShipment(input={}){
  const s={...input};
  const code=sourceCode(s),pending=hasPendingPartLoad(s);
  const fd=normalizeSaudiaDate(s.flightDate||s.plannedFlightDate||s.scheduledFlightDate||'');
  if(fd)s.flightDate=fd;
  if(pending){s.status=isDepartedEvent(s)?'DEPARTED':'IN TRANSIT';s.arrivalIsActual=false;}
  else if(code==='RCF'&&isDelhiDestination(s)){s.status='ARRIVED';s.arrivalIsActual=true;}
  else if(code==='ARR'||code==='DLV'){s.status='ARRIVED';s.arrivalIsActual=true;}
  else if(code==='MAN'||code==='DEP'){s.status='DEPARTED';s.departureIsActual=true;s.arrivalIsActual=false;}
  else s.status=mapStatus(code,s.status,s.destination);
  if(isDepartedEvent(s)&&s.arrivalIsActual!==true)s.status='DEPARTED';
  return s;
}

export async function trackSaudiaDirect(input){
  // SAL is the reliable automatic operational source. It often becomes complete
  // once the shipment starts moving / arrives, so use it first and return fast.
  let sal;
  try{sal=await trackSaudiaViaSal(input);}catch(e){sal={ok:false,reason:e?.message||'SAL SOURCE FAILED'};}
  if(sal?.ok&&sal?.shipment){
    return {...sal,shipment:normalizeShipment(sal.shipment),officialTracker:PUBLIC_URL,debug:{...(sal.debug||{}),sourceSelection:'SAL_PRIMARY'}};
  }

  // The official public Saudia tracker requires an interactive CAPTCHA token.
  // Mayavi must not bypass it. Staff can solve it in the official tab and the
  // Saudia Live Capture control reads/saves the visible result into Mayavi.
  return {
    ok:false,
    reason:'SAUDIA_PUBLIC_CAPTCHA_REQUIRED',
    officialTracker:PUBLIC_URL,
    manualHint:'Open the official Saudia tracker, enter the 065 AWB and solve CAPTCHA manually. Then use SAUDIA LIVE CAPTURE in Mayavi; the visible result will be read and saved automatically.',
    debug:{sourceSelection:'SAL_EMPTY_OFFICIAL_MANUAL_FALLBACK',salReason:sal?.reason||'SAL HAS NO OPERATIONAL DATA FOR THIS AWB'}
  };
}
