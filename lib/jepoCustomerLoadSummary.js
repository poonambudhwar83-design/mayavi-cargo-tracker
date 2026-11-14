// Customer-wise JEPO booked load. All services, Active + Delivered; the
// original Booking Date is the only period source (not delivery or scan time).
import {jepoLoadWeek} from './jepoLoadSummary.js';

const cleanCode=value=>String(value??'').normalize('NFKC').trim().toUpperCase();
const cleanName=value=>String(value??'').normalize('NFKC').trim().replace(/\s+/g,' ');
const validDate=value=>{
 const v=String(value??'').slice(0,10);
 if(!/^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(v))return '';
 const date=new Date(v+'T00:00:00Z');
 return !Number.isNaN(date.valueOf())&&date.toISOString().slice(0,10)===v?v:'';
};
const grams=value=>{
 if(value===null||value===undefined||String(value).trim()==='')return null;
 const n=Number(value);
 return Number.isFinite(n)&&n>=0?Math.round(n*1000):null;
};
export const jepoCustomerAvailableMonths=records=>{
 const months=new Set();
 for(const record of records||[]){
  const date=validDate(record.bookingDate);
  if(date)months.add(date.slice(0,7));
 }
 return [...months].sort().reverse();
};
// A duplicated AWB in an input list is never double-counted. (The saved JEPO
// master already enforces uniqueness, but reporting also guards against it.)
function distinctBooked(records=[],month=''){
 const seen=new Set(),valid=[],missingDates=[];
 for(const row of records||[]){
  const awb=String(row?.awb||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
  if(awb&&seen.has(awb))continue;
  if(awb)seen.add(awb);
  const date=validDate(row?.bookingDate);
  if(!date){missingDates.push(row);continue;}
  if(month&&date.slice(0,7)!==month)continue;
  const jpCode=cleanCode(row.jpCode);
  const customerName=cleanName(row.customerName);
  const weightGrams=grams(row.weight);
  valid.push({date,jpCode,customerName,weightGrams,awb});
 }
 return {valid,missingDates};
}
export function jepoCustomerPeriodSummary(records=[],{period='daily',month='',search=''}={}){
 if(!['daily','weekly','monthly'].includes(period))throw Error('Invalid customer summary period');
 const {valid,missingDates}=distinctBooked(records,month);
 const groups=new Map();
 const needle=String(search||'').trim().toLocaleLowerCase('en-IN');
 let shipments=0,totalGrams=0,missingWeights=0,unmappedCodes=0,missingJpCodes=0;
 for(const item of valid){
  if(needle&&!(item.jpCode+' '+item.customerName).toLocaleLowerCase('en-IN').includes(needle))continue;
  const range=period==='weekly'?jepoLoadWeek(item.date):period==='monthly'
   ?{start:item.date.slice(0,7)+'-01',end:item.date.slice(0,7)}
   :{start:item.date,end:item.date};
  const jpCode=item.jpCode||'UNASSIGNED';
  const key=range.start+'|'+jpCode;
  let row=groups.get(key);
  if(!row){row={periodStart:range.start,periodEnd:range.end,jpCode,customerName:item.customerName||'',
   shipments:0,grams:0,missingWeights:0};groups.set(key,row);}
  row.shipments++;shipments++;
  if(!item.jpCode)missingJpCodes++;
  if(!item.customerName)unmappedCodes++;
  if(item.weightGrams===null){row.missingWeights++;missingWeights++;}
  else{row.grams+=item.weightGrams;totalGrams+=item.weightGrams;}
  if(!row.customerName&&item.customerName)row.customerName=item.customerName;
 }
 const rows=[...groups.values()].map(row=>({
  periodStart:row.periodStart,periodEnd:row.periodEnd,jpCode:row.jpCode,
  customerName:row.customerName,shipments:row.shipments,
  kg:row.grams/1000,missingWeights:row.missingWeights
 })).sort((a,b)=>b.periodStart.localeCompare(a.periodStart)||b.kg-a.kg||
  b.shipments-a.shipments||a.jpCode.localeCompare(b.jpCode));
 return {rows,shipments,kg:totalGrams/1000,missingWeights,unmappedCodes,
  missingJpCodes,missingBookingDates:missingDates.length};
}
// Rank real customers by name, merging any JP100x / JP200x / JP300x codes
// assigned to the same company. Unmapped codes remain in period summaries,
// but cannot be accurately ranked as known individual customers.
export function jepoTopCustomers(records=[],{month='',limit=20}={}){
 const {valid,missingDates}=distinctBooked(records,month);
 const groups=new Map();
 let allShipments=0,allGrams=0,unmappedShipments=0,missingWeights=0;
 for(const item of valid){
  allShipments++;
  if(item.weightGrams!==null)allGrams+=item.weightGrams;
  else missingWeights++;
  if(!item.customerName){unmappedShipments++;continue;}
  const key=item.customerName.toLocaleUpperCase('en-IN');
  let row=groups.get(key);
  if(!row){row={name:item.customerName,codes:new Set(),shipments:0,grams:0,missingWeights:0};groups.set(key,row);}
  row.shipments++;
  if(item.jpCode)row.codes.add(item.jpCode);
  if(item.weightGrams===null)row.missingWeights++;
  else row.grams+=item.weightGrams;
 }
 const all=[...groups.values()].map(row=>({customerName:row.name,jpCodes:[...row.codes].sort(),
  shipments:row.shipments,kg:row.grams/1000,missingWeights:row.missingWeights}))
  .sort((a,b)=>b.kg-a.kg||b.shipments-a.shipments||a.customerName.localeCompare(b.customerName));
 const number=Number(limit);
 return {rows:all.slice(0,Number.isSafeInteger(number)&&number>=0?number:20),
  rankedCustomerCount:all.length,allShipments,allKg:allGrams/1000,
  unmappedShipments,missingWeights,missingBookingDates:missingDates.length};
}
