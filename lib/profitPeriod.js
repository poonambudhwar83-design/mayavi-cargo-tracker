import { importArrivalMonth, istMonthKey } from './monthlyArchive.js';
import { confirmedPartArrival } from './arrivalWeights.js';

// Profit accounting starts in October 2026, with a separate sheet each month.
export const FIRST_PROFIT_MONTH='2026-10';

export function currentProfitMonth(){return istMonthKey(new Date())}

export function profitMonths(){
  const current=currentProfitMonth();
  const months=[];
  for(let year=2026,month=10;year*12+month<=Number(current.slice(0,4))*12+Number(current.slice(5));month++){
    if(month>12){year++;month=1}
    months.push(String(year)+'-'+String(month).padStart(2,'0'));
  }
  return months;
}
export function selectedProfitMonth(raw){
  const chosen=String(raw||'').trim()||currentProfitMonth();
  if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(chosen)||chosen<FIRST_PROFIT_MONTH||chosen>currentProfitMonth())
    return null;
  return chosen;
}
function hasArrived(record={}){
  if(record.arrivalEstimate===true||record._saudiaPendingVirtual===true)return false;
  if(record.arrivalIsActual===true||record.customsCleared===true)return true;
  const status=String(record.status||record.sourceStatus||'').toUpperCase();
  return /\b(?:ARRIVED|DELIVERED|RECEIVED|PART ARRIVED)\b/.test(status)&&
    !/OFFLOAD|DISCREP|CANCEL|PENDING|EXPECTED|ESTIMAT/.test(status);
}
// For split shipments a confirmed arrival in this month qualifies the master
// once; the existing profit formula still uses the whole MAWB master weight.
export function importProfitArrivalDate(data={},month=''){
  const parts=Array.isArray(data.partShipments)?data.partShipments:[];
  const arrivedParts=parts.filter(p=>p&&
    importArrivalMonth(p.arrivalDate)===month&&
    (confirmedPartArrival(p)||hasArrived(p)));
  if(arrivedParts.length){
    return String(arrivedParts.map(p=>p.arrivalDate).sort()[0]);
  }
  if(importArrivalMonth(data.arrivalDate)===month&&hasArrived(data))
    return String(data.arrivalDate);
  return '';
}
function validIsoDate(value=''){
  const raw=String(value||'').trim();
  let m=raw.match(/^(20\d{2})-(\d{2})-(\d{2})(?:\D|$)/);
  if(!m){
    const dmy=raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](20\d{2})(?:\D|$)/);
    if(dmy)m=[raw,dmy[3],String(dmy[2]).padStart(2,'0'),String(dmy[1]).padStart(2,'0')];
  }
  if(!m)return '';
  const date=m[1]+'-'+m[2]+'-'+m[3];
  const v=new Date(Date.UTC(+m[1],+m[2]-1,+m[3]));
  return v.toISOString().slice(0,10)===date?date:'';
}
function validTime(value=''){
  const text=String(value||'').trim();
  const found=text.match(/^(\d{1,2}):([0-5]\d)(?::\d\d)?\s*(AM|PM)?$/i);
  if(!found)return'';
  let hour=Number(found[1]);
  if(found[3]){
    if(hour<1||hour>12)return'';
    hour=hour%12+(found[3].toUpperCase()==='PM'?12:0);
  }
  if(hour>23)return'';
  return String(hour).padStart(2,'0')+':'+found[2];
}
// The tracker displays the scheduled handover deadline 5 hours before
// export departure. A handover action timestamp is only a fallback when no
// scheduled deadline exists.
export function exportProfitHandoverDate(data={}){
  const explicit=validIsoDate(data.handoverTime||'');
  if(explicit)return explicit;
  const departure=validIsoDate(data.departureDate||data.flightDate||'');
  const time=validTime(data.departureTime||'');
  if(departure&&time){
    const base=new Date(departure+'T'+time+':00Z');
    if(Number.isFinite(base.getTime()))
      return new Date(base.getTime()-5*60*60*1000).toISOString().slice(0,10);
  }
  if(data.handoverDone===true&&data.handoverUpdatedAt){
    const d=new Date(data.handoverUpdatedAt);
    if(Number.isFinite(d.getTime())){
      const p=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d);
      const get=type=>p.find(x=>x.type===type)?.value||'';
      return get('year')+'-'+get('month')+'-'+get('day');
    }
  }
  return '';
}
export function exportProfitHandoverMonth(data={}){
  return importArrivalMonth(exportProfitHandoverDate(data));
}
export function exportRateForCompany(name=''){
  const company=String(name||'').toUpperCase().trim();
  if(/\bDHL\b/.test(company))return 11;
  if(/\bOVERSEAS\b/.test(company))return 7;
  return 6;
}
