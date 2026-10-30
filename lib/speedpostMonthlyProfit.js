import {uniqueSpeedPostEntries,speedPostEntryDay} from './speedpostCostReports.js';

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
  const explicit=String(row.destinationCountry||row.country||'').trim();
  if(explicit)return explicit;
  const place=String(row.destination||'').trim().toUpperCase();
  const address=String(row.address||row.consigneeAddress||'').toUpperCase();
  const region=String(row.state||row.destinationState||'').toUpperCase();
  const postcode=String(row.postalCode||row.postcode||row.zipCode||'').toUpperCase();
  // Shared names need evidence from recipient country, state or postcode.
  if(/\b(UNITED STATES|USA)\b/.test(address)||/\b(NEW JERSEY|CONNECTICUT|MASSACHUSETTS|MARYLAND|VERMONT)\b/.test(region+' '+address)||
    /\b\d{5}(?:-\d{4})?\b/.test(postcode))return 'USA';
  if(/\b(UNITED KINGDOM|ENGLAND|SCOTLAND|WALES)\b/.test(address)||
    /\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b/.test(postcode))return 'UK';
  const location=place.split(',')[0];
  if(['ESSEX','SOUTHALL','LONDON','HOUNSLOW','ILFORD','BIRMINGHAM','MANCHESTER','SLOUGH','WEMBLEY','HARROW'].includes(location))return 'UK';
  if(['NEW YORK','BOSTON','CHICAGO','LOS ANGELES','HOUSTON','DALLAS','MIAMI','ATLANTA','SEATTLE','SAN FRANCISCO'].includes(location))return 'USA';
  return String(row.destination||'Unknown').trim()||'Unknown';
}
const round=value=>Math.round((value+Number.EPSILON)*100)/100;
export function speedPostSellingRate(country,roundedWeight){
  if(!Number.isInteger(roundedWeight)||roundedWeight<=0)return null;
  if(country==='UK')return roundedWeight<=5?1050:950;
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
    rate===null?'Selling rate not configured for destination':
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

/**
 * Day-wise accounting uses the original Asia/Kolkata ED entry date. Active and
 * delivered records share one ledger and duplicate ED numbers count once.
 * Weight, Tariff and Cash totals use all available values independently.
 * Profit uses only complete UK/USA records whose cost and selling rate exist.
 */
export function speedPostDailySummary(rows=[]){
  const days=new Map();
  for(const row of uniqueSpeedPostEntries(rows)){
    const day=speedPostEntryDay(row);
    if(!days.has(day))days.set(day,{
      date:day,packets:0,actualWeightKg:0,roundedWeightKg:0,knownWeights:0,
      tariff:0,cashCost:0,totalAmount:0,tariffKnown:0,cashKnown:0,
      amountReceived:0,profit:0,profitablePackets:0,pendingProfit:0
    });
    const dayRow=days.get(day);
    const figure=speedPostProfitRow(row);
    dayRow.packets++;
    if(figure.roundedWeight!==null){
      const match=String(row.weight??'').trim().replace(/,/g,'')
        .match(/^(\d+(?:\.\d+)?)\s*(kg|kgs|kgm|kilograms?|g|gm|gms|grams?)$/i);
      if(match){
        const weight=Number(match[1]);
        const kg=match[2].toLowerCase().startsWith('k')?weight:weight/1000;
        dayRow.actualWeightKg=Math.round((dayRow.actualWeightKg+kg)*10000)/10000;
      }
      dayRow.roundedWeightKg+=figure.roundedWeight;
      dayRow.knownWeights++;
    }
    if(figure.tariff!==null){dayRow.tariff=round(dayRow.tariff+figure.tariff);dayRow.tariffKnown++;}
    if(figure.cashCost!==null){dayRow.cashCost=round(dayRow.cashCost+figure.cashCost);dayRow.cashKnown++;}
    // Same combined-cost convention as the existing EMS monthly records:
    // independent known tariff + independent known cash cost.
    dayRow.totalAmount=round(dayRow.tariff+dayRow.cashCost);
    if(figure.profit===null){dayRow.pendingProfit++;continue;}
    dayRow.profitablePackets++;
    dayRow.amountReceived=round(dayRow.amountReceived+figure.amountReceived);
    dayRow.profit=round(dayRow.profit+figure.profit);
  }
  const daily=[...days.values()].sort((a,b)=>b.date.localeCompare(a.date));
  const month={
    date:'MONTH TOTAL',packets:0,actualWeightKg:0,roundedWeightKg:0,knownWeights:0,
    tariff:0,cashCost:0,totalAmount:0,tariffKnown:0,cashKnown:0,
    amountReceived:0,profit:0,profitablePackets:0,pendingProfit:0
  };
  for(const dayRow of daily){
    for(const key of ['packets','roundedWeightKg','knownWeights','tariffKnown','cashKnown','profitablePackets','pendingProfit']){
      month[key]+=dayRow[key];
    }
    for(const key of ['actualWeightKg','tariff','cashCost','totalAmount','amountReceived','profit']){
      month[key]=Math.round((month[key]+dayRow[key])*10000)/10000;
    }
  }
  return {daily,month};
}
