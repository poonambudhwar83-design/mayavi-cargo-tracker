// Read-only join from approved Audit Analysis uploads into Export Profit.
 // Match BOTH the complete MAWB and normalized client name; never match
 // MAWB-only, partial names, or ambiguous blank clients.
export function normalizedAuditMawb(value=''){
  const digits=String(value??'').replace(/\D/g,'');
  return digits.length===11?digits:'';
}
export function normalizedAuditClient(value=''){
  return String(value??'').trim().replace(/\s+/g,' ').toUpperCase();
}
export function exportAuditKey(mawb,clientName){
  const awb=normalizedAuditMawb(mawb),client=normalizedAuditClient(clientName);
  return awb&&client?awb+'|'+client:'';
}
export function parseAuditBagCount(value){
  const text=String(value??'').trim().replace(/,/g,'').replace(/\s*(?:bags?|pcs|pieces)\s*$/i,'');
  if(!text)return null;
  if(!/^(?:0|[1-9]\d{0,5})(?:\.0+)?$/.test(text))return null;
  const count=Number(text);
  return Number.isSafeInteger(count)&&count<=100000?count:null;
}
export function parseAuditMoney(value){
  const text=String(value??'').trim();
  if(!text)return null;
  const normalized=text.replace(/^(?:INR|RS\.?|₹)\s*/i,'').replace(/,/g,'').trim();
  if(!/^(?:\d+)(?:\.\d{1,2})?$/.test(normalized))return null;
  const money=Number(normalized);
  return Number.isFinite(money)&&money>=0?money:null;
}
export function exportAuditValues(audit={}){
  const byCode={D:'d',T:'t',DT:'dt',GC:'gc'};
  const categoryBags={D:0,T:0,DT:0,GC:0};
  let hasBags=false;
  for(const [code,col] of Object.entries(byCode)){
    const parsed=parseAuditBagCount(audit[col]);
    if(parsed===null)continue;
    categoryBags[code]=parsed;
    hasBags=true;
  }
  // The shipment charge replaces the default only when ALL extra category
  // entries are genuinely empty, not when any contains 0 or invalid text.
  const allBlank=Object.values(byCode).every(col=>String(audit[col]??'').trim()==='');
  const amountColumns=['tray','shift','loader','coLoader'];
  const values=amountColumns.map(col=>String(audit[col]??'').trim());
  const hasAmount=values.some(Boolean);
  const parsed=values.map(parseAuditMoney);
  const allAmountsValid=values.every((v,i)=>!v||parsed[i]!==null);
  const shipmentCharge=allBlank&&hasAmount&&allAmountsValid
    ? Math.round(parsed.reduce((sum,v)=>sum+(v||0),0)*100)/100
    : null;
  return {categoryBags,hasBags,shipmentCharge};
}
export function auditExportIndex(records=[]){
  const index=new Map();
  // Caller orders newest ready upload first, then the latest source row.
  for(const record of records){
    const key=exportAuditKey(record.mawb,record.client_name??record.clientName);
    if(key&&!index.has(key))index.set(key,record);
  }
  return index;
}
