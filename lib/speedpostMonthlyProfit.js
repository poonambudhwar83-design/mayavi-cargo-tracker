import {uniqueSpeedPostEntries} from './speedpostCostReports.js';

// Reuse the existing EMS billing rule: every started kg is one billed kg.
export function speedPostRoundedWeight(raw){
  const text=String(raw??'').trim().replace(/,/g,'');
  const match=text.match(/^(\d+(?:\.\d+)?)\s*(kg|kgs|kgm|kilograms?|g|gm|gms|grams?)$/i);
  if(!match)return null;
  const weight=Number(match[1]);
  if(!Number.isFinite(weight)||weight<=0)return null;
  const kg=match[2].toLowerCase().startsWith('k')?weight:weight/1000;
  return Math.max(1,Math.ceil(kg-1e-9));
}
export function speedPostTariff(row={}){
  const text=String(row.tariff??'').trim().replace(/[₹,\s]/g,'').replace(/INR/ig,'');
  if(!/^\d+(?:\.\d+)?$/.test(text))return null;
  const value=Number(text);
  return Number.isFinite(value)&&value>=0?value:null;
}
export function speedPostProfitCountry(row={}){
  // Match the tracked destination, never the origin / office.
  const countryText=(String(row.destination||'')+' '+String(row.destinationCountry||row.country||'')).toUpperCase();
  if(/\b(UK|UNITED KINGDOM|ENGLAND|SCOTLAND|WALES|GREAT BRITAIN|GB|LEICESTER|LEICESTERSHIRE)\b/.test(countryText))return 'UK';
  if(/\b(USA|UNITED STATES(?: OF AMERICA)?|US)\b/.test(countryText))return 'USA';
  return String(row.destinationCountry||row.country||row.destination||'Unknown').trim()||'Unknown';
}
const round=value=>Math.round((value+Number.EPSILON)*100)/100;
export function speedPostSellingRate(country,roundedWeight){
  if(!Number.isInteger(roundedWeight)||roundedWeight<=0)return null;
  if(country==='UK')return roundedWeight<=5?1050:roundedWeight<=10?950:null;
  if(country==='USA')return roundedWeight<=5?1300:1200;
  return null;
}
export function speedPostProfitRow(row={}){
  const country=speedPostProfitCountry(row);
  const roundedWeight=speedPostRoundedWeight(row.weight);
  const tariff=speedPostTariff(row);
  const cashCost=roundedWeight===null?null:roundedWeight*150;
  const totalCost=tariff===null||cashCost===null?null:round(tariff+cashCost);
  const costPerKg=totalCost===null?null:totalCost/roundedWeight;
  const rate=speedPostSellingRate(country,roundedWeight);
  const amountReceived=rate===null?null:round(rate*roundedWeight);
  const consultingCost=costPerKg===null?null:round(costPerKg*roundedWeight);
  const packingTransport=roundedWeight===null?null:round(10*roundedWeight);
  const profit=amountReceived===null||consultingCost===null||packingTransport===null
    ?null:round(amountReceived-consultingCost-packingTransport);
  const missing=roundedWeight===null?'Weight not available':
    tariff===null?'Tariff not available':
    rate===null?(country==='UK'&&roundedWeight>10?'UK above 10 kg rate not configured':'Selling rate not configured for destination'):
    '';
  return {country,roundedWeight,tariff,cashCost,totalCost,costPerKg,
    rate,amountReceived,consultingCost,packingTransport,profit,missing};
}
export function speedPostProfitTotals(rows=[]){
  const list=uniqueSpeedPostEntries(rows).map(row=>({...row,...speedPostProfitRow(row)}));
  const totals={packets:list.length,complete:0,missing:0,roundedWeight:0,
    amountReceived:0,consultingCost:0,packingTransport:0,profit:0};
  for(const row of list){
    if(row.profit===null){totals.missing++;continue;}
    totals.complete++;
    totals.roundedWeight+=row.roundedWeight;
    totals.amountReceived=round(totals.amountReceived+row.amountReceived);
    totals.consultingCost=round(totals.consultingCost+row.consultingCost);
    totals.packingTransport=round(totals.packingTransport+row.packingTransport);
    totals.profit=round(totals.profit+row.profit);
  }
  return {rows:list,totals};
}
