import {inclusiveTatDays,tatCountryGroup} from './branchTatSummary.js';
import {jepoMonthlyPartner} from './jepoMonthlySummary.js';

const validDate=value=>{
 const str=String(value??'').slice(0,10);
 if(!/^20\d{2}-\d{2}-\d{2}$/.test(str))return '';
 const d=new Date(str+'T00:00:00Z');
 return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===str?str:'';
};
const knownCountries=['USA','UK','Canada','Australia','Other Countries'];

export function jepoTatService(value){
 const name=String(value||'').trim().toUpperCase().replace(/\s+/g,' ');
 if(!name)return 'Not specified';
 if(name.includes('FEDEX'))return 'FedEx';
 if(name.includes('ARAMEX'))return 'Aramex';
 if(/(?:^|-)JEPO(?:-|$)/.test(name))return 'JEPO';
 if(name.includes('SPEED')&&name.includes('POST'))return 'Speed Post';
 if(name.includes('SELFO')||name.includes('SELF')){
  if(/(?:^|-)UK(?:-|$)/.test(name))return 'Self — UK';
  if(/(?:^|-)US(?:-|$)/.test(name))return 'Self — USA';
  if(/(?:^|-)YYZ(?:-|$)/.test(name))return 'Self — Canada';
  if(/(?:^|-)AUS(?:-|$)/.test(name))return 'Self — Australia';
  if(/(?:^|-)NZ(?:-|$)/.test(name))return 'Self — New Zealand';
  if(/(?:^|-)EUR(?:-|$)|(?:^|-)EUROPE(?:-|$)/.test(name))return 'Self — Europe';
  if(/(?:^|-)DXB(?:-|$)/.test(name))return 'Self — Dubai';
  return 'Self — Other';
 }
 return String(value).trim();
}

export function jepoTatDateReason(row={}){
 if(row.status!=='DELIVERED')return 'Not Delivered';
 const booked=validDate(row.bookingDate);
 const delivered=validDate(row.deliveredOn);
 if(!booked)return 'Missing Booking Date';
 if(!delivered)return 'Missing Delivery Date';
 if(delivered<booked)return 'Delivery Before Booking';
 return 'Verified';
}
export function jepoTatDays(row={}){
 return jepoTatDateReason(row)==='Verified'?inclusiveTatDays(validDate(row.bookingDate),validDate(row.deliveredOn)):null;
}
const blank=label=>({label,delivered:0,verified:0,missingDate:0,invalidDate:0,totalDays:0,fastest:null,slowest:null,average:null});
const sum=(record,row)=>{
 record.delivered++;
 const days=jepoTatDays(row);
 if(days===null){
  if(jepoTatDateReason(row)==='Delivery Before Booking')record.invalidDate++;
  else record.missingDate++;
 }else{
  record.verified++;record.totalDays+=days;
  record.fastest=record.fastest===null?days:Math.min(record.fastest,days);
  record.slowest=record.slowest===null?days:Math.max(record.slowest,days);
 }
 return record;
};
const finish=r=>({...r,average:r.verified?Math.round(r.totalDays/r.verified*10)/10:null});
const mapGroup=(map,label,row)=>{
 const item=map.get(label)||blank(label);
 sum(item,row);map.set(label,item);
};
const sorted=map=>[...map.values()].map(finish).sort((a,b)=>b.delivered-a.delivered||a.label.localeCompare(b.label));

export function availableJepoTatMonths(rows=[]){
 return [...new Set(rows.map(x=>validDate(x.bookingDate).slice(0,7)).filter(Boolean))].sort().reverse();
}

export function summarizeJepoTat(rows=[],{month='',partner='ALL',country='ALL'}={}){
 const total=blank('All Delivered');
 const vendors=new Map(),countries=new Map(),services=new Map(),matrix=new Map();
 const deliveredRows=[];
 let totalAwbs=0,active=0;
 const seen=new Set();
 for(const row of rows){
  const awb=String(row.awb||'').trim();
  if(awb&&seen.has(awb))continue;
  if(awb)seen.add(awb);
  if(month&&validDate(row.bookingDate).slice(0,7)!==month)continue;
  const partnerName=jepoMonthlyPartner(row);
  const countryName=tatCountryGroup(row.destination);
  if(partner!=='ALL'&&partnerName!==partner)continue;
  if(country!=='ALL'&&countryName!==country)continue;
  totalAwbs++;
  if(row.status!=='DELIVERED'){active++;continue;}
  deliveredRows.push(row);
  sum(total,row);
  mapGroup(vendors,partnerName,row);
  mapGroup(countries,countryName,row);
  mapGroup(services,jepoTatService(row.service),row);
  mapGroup(matrix,partnerName+'|'+countryName,row);
 }
 const partners=sorted(vendors);
 const byCountry=sorted(countries).sort((a,b)=>knownCountries.indexOf(a.label)-knownCountries.indexOf(b.label));
 const byService=sorted(services);
 const byPartnerCountry=sorted(matrix).map(x=>{
  const [partner,country]=x.label.split('|');
  return {...x,partner,country};
 }).sort((a,b)=>a.partner.localeCompare(b.partner)||knownCountries.indexOf(a.country)-knownCountries.indexOf(b.country));
 const selected=deliveredRows.map(row=>({...row,tatDays:jepoTatDays(row),tatReason:jepoTatDateReason(row),
  partner:jepoMonthlyPartner(row),country:tatCountryGroup(row.destination),serviceLabel:jepoTatService(row.service)}))
  .sort((a,b)=>(a.tatDays===null?0:1)-(b.tatDays===null?0:1)
   ||String(b.bookingDate||'').localeCompare(String(a.bookingDate||''))||String(a.awb||'').localeCompare(String(b.awb||'')));
 return {totalAwbs,active,overall:finish(total),byPartner:partners,byCountry,byService,byPartnerCountry,
  deliveredRows:selected};
}
