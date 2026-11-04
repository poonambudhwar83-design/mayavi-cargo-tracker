import {masterKg,partKg} from './arrivalWeights.js';
import {confirmedPartArrival} from './arrivalWeights.js';
import {importArrivalMonth} from './monthlyArchive.js';

// Pure month-specific adjustment identities: never change the original MAWB,
// its cargo weight, its physical parts or profit-sheet source records.
export function monthlyPartKey(record={}){
  return Number.isInteger(record.archivePartIndex)&&record.archivePartIndex>=0
    ?'part:'+record.archivePartIndex:'master';
}
export function validMonthlyPartKey(value=''){
  return value==='master'||/^part:(0|[1-9]\d{0,3})$/.test(String(value||''));
}
export function archiveOriginalWeight(data={},month='',partKey='master'){
  if(!validMonthlyPartKey(partKey))return null;
  const parts=Array.isArray(data.partShipments)?data.partShipments.filter(Boolean):[];
  if(partKey.startsWith('part:')){
    if(!parts.length)return null;
    const matches=parts.filter(part=>confirmedPartArrival(part)&&
      importArrivalMonth(part.arrivalDate)===month);
    const index=Number(partKey.slice(5));
    const selected=matches[index];
    return selected?partKg(selected.weight):null;
  }
  // A master with physical split parts must be adjusted per arrived part,
  // never as the entire booked MAWB; otherwise the same weight is counted twice.
  if(parts.length)return null;
  const fractional=(data.isPartLoad===true||data.partLoad===true||
    /PART ARRIVED|PART LOAD|PART SHIPMENT/i.test(String(data.status||'')))&&
    String(data.weight||'').includes('/');
  return fractional?partKg(data.weight):masterKg(data);
}
export function normalizedWeightMinus(value,maximum){
  if(value===''||value===null||value===undefined)value=0;
  const n=Number(value),max=Number(maximum);
  if(!Number.isFinite(n)||n<0||!Number.isFinite(max)||max<0||
     Math.round(n*1000)/1000>max+0.00001||!Number.isInteger(n*1000))
    return null;
  return Math.round(n*1000)/1000;
}
export function netArchiveWeight(original,minus=0){
  const gross=Number(original),m=Number(minus);
  return Number.isFinite(gross)&&Number.isFinite(m)&&m>=0
    ?Math.max(0,Math.round((gross-m)*1000)/1000):null;
}
