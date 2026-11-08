// JEPO Booking Date = shipment load/allocation date; source of truth is saved
// Excel/CSV fields. No guessed handover dates, weights or destinations.
export const JEPO_LOAD_COUNTRIES=['UK','USA','Canada','Australia'];
export const JEPO_LOAD_VENDORS=['TPL','Overseas'];

const canonical=value=>String(value??'').normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim().replace(/\s+/g,' ');

export function jepoLoadVendor(value){
 const name=canonical(value);
 if(name==='TPL'||name==='T P L'||name==='TRANSIT POINT'||name.startsWith('TRANSIT POINT LOGISTICS')||name==='TRANSIT POINT LOGISTICS PVT LTD')return'TPL';
 if(name==='OVERSEAS'||name==='OVERSEAS LOG'||name.startsWith('OVERSEAS LOGISTICS')||name.startsWith('OVERSEAS LOG '))return'Overseas';
 return null; // Do not accidentally count ICL/other vendors or service names.
}

export function jepoLoadCountry(value){
 const country=canonical(value);
 if(['UK','U K','GB','GBR','GREAT BRITAIN','UNITED KINGDOM','ENGLAND','SCOTLAND','WALES','NORTHERN IRELAND'].includes(country))return'UK';
 if(['USA','U S A','US','U S','UNITED STATES','UNITED STATES OF AMERICA','AMERICA'].includes(country))return'USA';
 if(['CANADA','CA','CAN'].includes(country))return'Canada';
 if(['AUSTRALIA','AUS','AU'].includes(country))return'Australia';
 return null;
}

function validDate(input){
 const str=String(input??'').slice(0,10);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(str))return null;
 const date=new Date(str+'T00:00:00Z');
 return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===str?str:null;
}
function plusDays(dateString,delta){
 const d=new Date(dateString+'T00:00:00Z');
 d.setUTCDate(d.getUTCDate()+delta);
 return d.toISOString().slice(0,10);
}
export function jepoLoadWeek(bookingDate){
 const date=validDate(bookingDate);
 if(!date)return null;
 const d=new Date(date+'T00:00:00Z');
 const sinceMonday=(d.getUTCDay()+6)%7;
 const monday=plusDays(date,-sinceMonday);
 return {start:monday,end:plusDays(monday,6)};
}
function emptyCells(){
 return Object.fromEntries(JEPO_LOAD_COUNTRIES.map(country=>[country,{shipments:0,kg:0}]));
}
function asKg(value){
 if(value===null||value===undefined||value==='')return null;
 const kg=Number(value);
 return Number.isFinite(kg)&&kg>=0?kg:null;
}
function bookDateValue(record){return validDate(record.bookingDate);}

export function jepoLoadAvailableMonths(records=[]){
 const months=new Set();
 for(const record of records){
  if(!jepoLoadVendor(record.vendor)||!jepoLoadCountry(record.destination))continue;
  const date=bookDateValue(record);
  if(date)months.add(date.slice(0,7));
 }
 return [...months].sort().reverse();
}

export function buildJepoLoadSummary(records=[],{period='daily',vendor='ALL',month=''}={}){
 if(!['daily','weekly'].includes(period))throw Error('Unsupported JEPO load period');
 const group=new Map();
 const totalsByVendor=new Map();
 let missingBookingDates=0,missingWeights=0,shipments=0,totalKg=0;
 for(const record of records){
  const actualVendor=jepoLoadVendor(record.vendor);
  const country=jepoLoadCountry(record.destination);
  if(!actualVendor||!country)continue;
  if(vendor!=='ALL'&&actualVendor!==vendor)continue;
  const date=bookDateValue(record);
  if(!date){missingBookingDates++;continue;}
  if(month&&date.slice(0,7)!==month)continue;
  const weight=asKg(record.weight);
  const range=period==='weekly'?jepoLoadWeek(date):{start:date,end:date};
  const key=range.start+'|'+actualVendor;
  let row=group.get(key);
  if(!row){
   row={periodStart:range.start,periodEnd:range.end,vendor:actualVendor,
    countries:emptyCells(),shipments:0,kg:0,missingWeights:0};
   group.set(key,row);
  }
  const cell=row.countries[country];
  cell.shipments++;row.shipments++;shipments++;
  if(weight!==null){cell.kg+=weight;row.kg+=weight;totalKg+=weight;}
  else{row.missingWeights++;missingWeights++;}
  let vendorTotal=totalsByVendor.get(actualVendor);
  if(!vendorTotal){
   vendorTotal={vendor:actualVendor,shipments:0,kg:0,countries:emptyCells(),missingWeights:0};
   totalsByVendor.set(actualVendor,vendorTotal);
  }
  vendorTotal.shipments++;
  vendorTotal.countries[country].shipments++;
  if(weight!==null){vendorTotal.kg+=weight;vendorTotal.countries[country].kg+=weight;}
  else vendorTotal.missingWeights++;
 }
 const rows=[...group.values()].sort((a,b)=>
  b.periodStart.localeCompare(a.periodStart)||
  JEPO_LOAD_VENDORS.indexOf(a.vendor)-JEPO_LOAD_VENDORS.indexOf(b.vendor)
 );
 const vendorTotals=JEPO_LOAD_VENDORS.filter(v=>vendor==='ALL'||vendor===v)
  .map(v=>totalsByVendor.get(v)||{vendor:v,shipments:0,kg:0,countries:emptyCells(),missingWeights:0});
 return {rows,vendorTotals,shipments,kg:totalKg,missingBookingDates,missingWeights};
}
