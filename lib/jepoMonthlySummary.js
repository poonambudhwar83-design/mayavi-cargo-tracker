import {jepoLoadCountry,jepoLoadVendor,jepoIsFedexService} from './jepoLoadSummary.js';

const validDate=input=>{
 const date=String(input??'').slice(0,10);
 if(!/^20\d{2}-\d{2}-\d{2}$/.test(date))return '';
 const parsed=new Date(date+'T00:00:00Z');
 return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===date?date:'';
};
const empty=label=>({label,shipments:0,weight:0,delivered:0,active:0,checked:0,missingWeight:0});
const inc=(data,r)=>{
 data.shipments++;
 if(r.status==='DELIVERED')data.delivered++;else data.active++;
 if(r.checkedAt)data.checked++;
 const weight=r.weight;
 if(weight===null||weight===undefined||weight===''||!Number.isFinite(Number(weight))||Number(weight)<0)data.missingWeight++;
 else data.weight+=Number(weight);
 return data;
};
const finish=x=>({...x,weight:Math.round((x.weight+Number.EPSILON)*1000)/1000});
const grouped=(map)=>[...map.values()].map(finish).sort((a,b)=>b.shipments-a.shipments||a.label.localeCompare(b.label));
const add=(map,key,row)=>{
 const name=String(key||'Not specified').trim()||'Not specified';
 const current=map.get(name)||empty(name);
 inc(current,row);
 map.set(name,current);
};
export function jepoMonthlyPartner(row={}){
 // FedEx service is booked via ICL; show it as FedEx without double-counting.
 if(jepoIsFedexService(row.service))return'FedEx';
 return jepoLoadVendor(row.vendor)||String(row.vendor||'Not specified').trim()||'Not specified';
}
export function jepoMonthlyCountry(row={}){
 return jepoLoadCountry(row.destination)||String(row.destination||'Other Countries').trim()||'Other Countries';
}
export function availableJepoMonths(rows=[]){
 return [...new Set(rows.map(r=>validDate(r.bookingDate).slice(0,7)).filter(Boolean))].sort().reverse();
}
export function aggregateJepoMonthly(rows=[],{month='',partner='ALL'}={}){
 const totals=empty('JEPO Total'),monthMap=new Map(),partnerMap=new Map(),countryMap=new Map(),serviceMap=new Map(),dateMap=new Map();
 let missingDates=0;
 const selectedRows=[];
 const seen=new Set();
 for(const row of rows){
  const awb=String(row.awb??'').trim();
  if(awb&&seen.has(awb))continue;
  if(awb)seen.add(awb);
  const bookingDate=validDate(row.bookingDate);
  if(!bookingDate){missingDates++;continue;}
  const m=bookingDate.slice(0,7);
  const shipmentPartner=jepoMonthlyPartner(row);
  const summaryKey=m+'|'+shipmentPartner;
  const history=monthMap.get(summaryKey)||{...empty(shipmentPartner),month:m,partner:shipmentPartner};
  inc(history,row);
  monthMap.set(summaryKey,history);
  if(month&&m!==month)continue;
  if(partner!=='ALL'&&shipmentPartner!==partner)continue;
  selectedRows.push(row);
  inc(totals,row);
  add(partnerMap,shipmentPartner,row);
  add(countryMap,jepoMonthlyCountry(row),row);
  add(serviceMap,row.service,row);
  add(dateMap,bookingDate,row);
 }
 const history=[...monthMap.values()].map(finish).sort((a,b)=>b.month.localeCompare(a.month)||a.partner.localeCompare(b.partner));
 return {months:availableJepoMonths(rows),history,grand:finish(totals),byPartner:grouped(partnerMap),byCountry:grouped(countryMap),
  byService:grouped(serviceMap),byDay:[...dateMap.entries()].map(([date,x])=>({date,...finish(x)})).sort((a,b)=>b.date.localeCompare(a.date)),
  selectedRows:selectedRows.sort((a,b)=>String(b.bookingDate||'').localeCompare(String(a.bookingDate||''))||String(a.awb||'').localeCompare(String(b.awb||''))),
  missingDates};
}
