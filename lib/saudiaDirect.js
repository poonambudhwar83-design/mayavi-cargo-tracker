import { trackSaudiaViaTrackingMorePublic } from './saudiaTrackingMorePublic.js';
import { trackSaudiaViaChina } from './saudiaChina.js';
import { trackSaudiaViaSal } from './saudiaSalPublic.js';
import { trackSaudiaViaConnect } from './saudiaConnect.js';
import { trackSaudiaDirect as trackSaudiaDirectV6 } from './saudiaDirectV6.js';

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

function isDelhiDestination(shipment={}){return String(shipment.destination||'').trim().toUpperCase()==='DEL';}
function hasPendingPartLoad(shipment={}){
  const total=Number(shipment.totalPieces||shipment.pieces||shipment.bags||0),arrived=Number(shipment.arrivedPieces||0),pending=Number(shipment.pendingPieces||0);
  const status=String(shipment.status||'').trim().toUpperCase();
  return shipment.isPartLoad===true||status==='PART ARRIVED'||pending>0||(total>0&&arrived>0&&arrived<total);
}
function sourceCode(s={}){return String(s.sourceStatus||s.eventCode||s.latestEventCode||'').trim().toUpperCase();}
function isDepartedEvent(s={}){return /^(MAN|DEP)$/.test(sourceCode(s))||s.departureIsActual===true;}

function mapSaudiaStatus(code='',fallback='TRACKING',destination=''){
  const s=String(code||'').trim().toUpperCase(),dest=String(destination||'').trim().toUpperCase();
  if(s==='BKD'||s==='FBL'||s==='RCS')return'BOOKED';
  if(s==='DLY')return'DELAYED';
  if(s==='DLV'||s==='ARR')return'ARRIVED';
  if(s==='RCF'&&dest==='DEL')return'ARRIVED';
  if(s==='MAN'||s==='DEP')return'DEPARTED';
  if(s==='FOW'||s==='XXX'||s==='RCF'||s==='FIW')return'IN TRANSIT';
  return fallback||'TRACKING';
}

function applyFlightPlan(shipment={}){
  const out={...shipment};
  const flightDate=normalizeSaudiaDate(out.flightDate||out.plannedFlightDate||out.scheduledFlightDate||'');
  if(flightDate){out.flightDate=flightDate;if(out.arrivalIsActual!==true&&!out.arrivalDate)out.arrivalDate=flightDate;}
  if(out.arrivalIsActual!==true&&!out.arrivalTime){out.arrivalTime=out.etaTime||out.scheduledArrivalTime||out.plannedArrivalTime||'';}
  if(isDepartedEvent(out)&&out.arrivalIsActual!==true){out.status='DEPARTED';out.departureIsActual=true;}
  return out;
}

function normalizeResult(result){
  if(!result?.ok||!result?.shipment)return result;
  let shipment={...result.shipment};
  const current=String(shipment.status||'').trim().toUpperCase(),code=sourceCode(shipment),del=isDelhiDestination(shipment),partPending=hasPendingPartLoad(shipment);
  if(partPending){shipment.status=isDepartedEvent(shipment)?'DEPARTED':'IN TRANSIT';shipment.arrivalIsActual=false;}
  else if(code==='RCF'&&del){shipment.status='ARRIVED';shipment.arrivalIsActual=true;}
  else if(code==='ARR'||code==='DLV'){shipment.status='ARRIVED';shipment.arrivalIsActual=true;}
  else if(code==='MAN'||code==='DEP'){shipment.status='DEPARTED';shipment.departureIsActual=true;shipment.arrivalIsActual=false;}
  else if(/^(FOW|XXX|RCF|FIW)$/.test(code))shipment.status='IN TRANSIT';
  else if(current==='IN TRANSIT')shipment.status='IN TRANSIT';
  else shipment.status=mapSaudiaStatus(code,shipment.status,shipment.destination);
  shipment=applyFlightPlan(shipment);
  return {...result,shipment};
}

function eventEpoch(shipment={}){
  for(const value of [shipment.latestEventDateTime,shipment.eventDateTime,shipment.flightDate,shipment.arrivalDate,shipment.bookingDate].filter(Boolean)){
    const t=Date.parse(String(normalizeSaudiaDate(value)||value));if(Number.isFinite(t))return t;
  }return 0;
}
function isActiveMovement(s={}){return hasPendingPartLoad(s)||isDepartedEvent(s)||/^(FOW|XXX|RCF|FIW)$/.test(sourceCode(s))||['IN TRANSIT','DEPARTED'].includes(String(s.status||'').toUpperCase());}
function isTerminalMovement(s={}){return !hasPendingPartLoad(s)&&['ARRIVED','DELIVERED'].includes(String(s.status||'').toUpperCase());}

function chooseFreshest(results=[]){
  const good=results.filter(r=>r?.ok&&r?.shipment);if(!good.length)return null;
  good.sort((a,b)=>eventEpoch(b.shipment)-eventEpoch(a.shipment));
  const newest=good[0];
  const active=good.filter(r=>isActiveMovement(r.shipment)).sort((a,b)=>eventEpoch(b.shipment)-eventEpoch(a.shipment))[0];
  const terminal=good.filter(r=>isTerminalMovement(r.shipment)).sort((a,b)=>eventEpoch(b.shipment)-eventEpoch(a.shipment))[0];
  if(active&&(!terminal||eventEpoch(active.shipment)>=eventEpoch(terminal.shipment)))return active;
  return newest;
}

function enrichFlightPlan(chosen,results=[]){
  if(!chosen?.ok||!chosen?.shipment)return chosen;
  let shipment={...chosen.shipment};
  const candidates=results.filter(r=>r?.ok&&r?.shipment).sort((a,b)=>eventEpoch(b.shipment)-eventEpoch(a.shipment));
  const flight=String(shipment.flightNo||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
  const donor=candidates.find(r=>{const f=String(r.shipment.flightNo||'').toUpperCase().replace(/[^A-Z0-9]/g,'');return flight&&f===flight&&(r.shipment.flightDate||r.shipment.arrivalDate||r.shipment.arrivalTime||r.shipment.etaTime||r.shipment.scheduledArrivalTime);})||candidates.find(r=>r.shipment.flightDate&&r.shipment.flightNo);
  if(donor){
    const d=donor.shipment;
    if(!shipment.flightNo)shipment.flightNo=d.flightNo;
    if(!shipment.flightDate)shipment.flightDate=d.flightDate||d.plannedFlightDate||d.scheduledFlightDate;
    if(!shipment.arrivalDate)shipment.arrivalDate=d.arrivalDate||normalizeSaudiaDate(d.flightDate||'');
    if(!shipment.arrivalTime)shipment.arrivalTime=d.arrivalTime||d.etaTime||d.scheduledArrivalTime||d.plannedArrivalTime||'';
    if(isDepartedEvent(d)){shipment.sourceStatus=sourceCode(d);shipment.status='DEPARTED';shipment.departureIsActual=true;shipment.arrivalIsActual=false;}
  }
  return {...chosen,shipment:applyFlightPlan(shipment)};
}

export async function trackSaudiaDirect(input){
  const settled=await Promise.allSettled([trackSaudiaViaSal(input),trackSaudiaViaTrackingMorePublic(input),trackSaudiaViaChina(input),trackSaudiaViaConnect(input),trackSaudiaDirectV6(input)]);
  const all=settled.map(x=>normalizeResult(x.status==='fulfilled'?x.value:{ok:false,reason:x.reason?.message||'SOURCE FAILED'}));
  let chosen=enrichFlightPlan(chooseFreshest(all),all);
  if(chosen?.ok&&chosen?.shipment)return {...chosen,debug:{...(chosen.debug||{}),sourceSelection:'LATEST_OPERATIONAL_MOVEMENT',candidates:all.filter(r=>r?.ok&&r?.shipment).map(r=>({source:r.shipment.source||'',status:r.shipment.status||'',sourceStatus:sourceCode(r.shipment),flightNo:r.shipment.flightNo||'',flightDate:r.shipment.flightDate||'',arrivalDate:r.shipment.arrivalDate||'',arrivalTime:r.shipment.arrivalTime||''}))}};
  return chosen||{ok:false,reason:'SAUDIA TRACKING FAILED'};
}
