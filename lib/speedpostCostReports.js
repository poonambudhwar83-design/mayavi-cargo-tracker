// Speed Post financial reporting: immutable ED entry date (Asia/Kolkata)
// is the reporting key, NOT Booking Date, Delivery Date or last tracking update.
// All totals deduplicate by tracking number. Missing values are never zeros.
const dateParts = new Intl.DateTimeFormat('en-GB',{
  timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'
});
export function speedPostEntryDay(row={}){
  const date=new Date(row.createdAt||row.created_at||'');
  if(!Number.isFinite(date.getTime()))return'UNKNOWN';
  const parts=Object.fromEntries(dateParts.formatToParts(date).map(p=>[p.type,p.value]));
  return [parts.year,parts.month,parts.day].join('-');
}
export function speedPostEntryMonth(row={}){
  const day=speedPostEntryDay(row);
  return day==='UNKNOWN'?'UNKNOWN':day.slice(0,7);
}
export function uniqueSpeedPostEntries(rows=[]){
  const seen=new Set();
  return rows.filter(row=>{
    const id=String(row.trackingNo||row.tracking_no||'').replace(/\s+/g,'').toUpperCase();
    if(!id||seen.has(id))return false;
    seen.add(id);return true;
  });
}
export function speedPostCostSummary(rows=[],{tariffOf=()=>null,cashOf=()=>null}={}){
  const unique=uniqueSpeedPostEntries(rows);
  const result={packets:unique.length,tariff:0,cash:0,combined:0,
    difference:0,completePackets:0,tariffKnown:0,cashKnown:0,
    tariffMissing:0,cashMissing:0};
  for(const row of unique){
    const tariff=tariffOf(row),cash=cashOf(row);
    const hasTariff=typeof tariff==='number'&&Number.isFinite(tariff)&&tariff>=0;
    const hasCash=typeof cash==='number'&&Number.isFinite(cash)&&cash>=0;
    if(hasTariff){result.tariff+=tariff;result.tariffKnown++;}
    else result.tariffMissing++;
    if(hasCash){result.cash+=cash;result.cashKnown++;}
    else result.cashMissing++;
    if(hasTariff&&hasCash){
      result.completePackets++;
      result.difference+=tariff-cash;
    }
  }
  // "Combined" is the sum of independently known Tariff + Cash amounts.
  // A parcel's individual Total/Difference is displayed only when both exist.
  result.combined=result.tariff+result.cash;
  return result;
}
export function speedPostGroupByEntryDay(rows=[]){
  const map=new Map();
  for(const row of uniqueSpeedPostEntries(rows)){
    const key=speedPostEntryDay(row);
    if(!map.has(key))map.set(key,[]);
    map.get(key).push(row);
  }
  return [...map].sort((a,b)=>b[0].localeCompare(a[0]));
}
export function speedPostGroupByEntryMonth(rows=[]){
  const map=new Map();
  for(const row of uniqueSpeedPostEntries(rows)){
    const key=speedPostEntryMonth(row);
    if(!map.has(key))map.set(key,[]);
    map.get(key).push(row);
  }
  return [...map].sort((a,b)=>b[0].localeCompare(a[0]));
}
