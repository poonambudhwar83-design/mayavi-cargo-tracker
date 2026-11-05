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
  // Saved Audit rows come from Postgres (co_loader); Excel previews use coLoader.
  // X-ray is a charge amount, never a category bag count. Tray is not part of
  // this Export Profit shipment-charge rule.
  const amountColumns=['xray','shift','loader','co_loader'];
  const values=amountColumns.map(col=>String(
    col==='co_loader'?(audit.co_loader??audit.coLoader):audit[col]
  ??'').trim());
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

export const AUDIT_CATEGORY_CODES=['D','T','DT','GC'];
export function exportManualCategoryCodes(row){
  // NULL means a pre-existing manual record from before code-level flags
  // were introduced; protect ALL its values without any migration overwrite.
  if(!row)return [];
  if(row.manual_codes===null||row.manual_codes===undefined)return [...AUDIT_CATEGORY_CODES];
  let value=row.manual_codes;
  if(typeof value==='string'){try{value=JSON.parse(value)}catch{return [...AUDIT_CATEGORY_CODES]}}
  return Array.isArray(value)?value.filter(code=>AUDIT_CATEGORY_CODES.includes(code)):[...AUDIT_CATEGORY_CODES];
}
export function mergeExportAuditBags(saved,imported){
  const manualCodes=exportManualCategoryCodes(saved);
  const manual=new Set(manualCodes);
  const hasAudit=Boolean(imported?.hasBags);
  const fromSaved=saved?{D:Number(saved.d_bags)||0,T:Number(saved.t_bags)||0,DT:Number(saved.dt_bags)||0,GC:Number(saved.gc_bags)||0}:null;
  const categoryBags={};
  const autoBagCodes=[];
  for(const code of AUDIT_CATEGORY_CODES){
    if(manual.has(code)){
      categoryBags[code]=fromSaved?.[code]??0;
    }else if(hasAudit){
      categoryBags[code]=imported.categoryBags[code]??0;
      autoBagCodes.push(code);
    }else{
      categoryBags[code]=fromSaved?.[code]??0;
    }
  }
  return {categoryBags,manualBagCodes:manualCodes,autoBagCodes};
}
