import {ledgerAwb,paise,moneyFromPaise} from './importClientLedger.js';
import {clientKey,clientLabel,istDate,masterCustomsClearance,masterReceivable} from './importClientReceivables.js';
import {physicalImportProfitRows} from './importProfitPhysicalRows.js';

export const AUTO_FROM='2026-12-03';
export function absAutoEligible(m,today=istDate()){
  return today>=AUTO_FROM && m.cleared && m.clearanceDate>=AUTO_FROM && m.amount!==null;
}
export function absLedger(invoices=[],receipts=[]){
  const events=[...invoices.map(i=>({date:i.date,type:'MAWB',reference:i.awb,partLabel:i.part_label||'',bags:i.bags==null?null:Number(i.bags),weight:Number(i.weight),rate:Number(i.rate),debit:Number(i.amount),credit:0,source:i.source,createdAt:i.created_at})),
    ...receipts.map(r=>({date:r.date,type:'PAYMENT',reference:r.mode,remarks:r.remarks,id:r.id,debit:0,credit:Number(r.amount),createdAt:r.created_at}))];
  events.sort((a,b)=>a.date.localeCompare(b.date)||((a.type==='MAWB'?0:1)-(b.type==='MAWB'?0:1))||String(a.createdAt||'').localeCompare(String(b.createdAt||''))||String(a.reference).localeCompare(String(b.reference)));
  let due=0,paid=0,weight=0,cash=0,account=0,bags=0,missingBags=0;
  const rows=events.map(e=>{due+=paise(e.debit);paid+=paise(e.credit);return {...e,balance:moneyFromPaise(due-paid)};});
  for(const i of invoices){weight+=Number(i.weight)||0;if(i.bags==null)missingBags++;else bags+=Number(i.bags)||0;}
  for(const r of receipts){if(r.mode==='CASH')cash+=paise(r.amount);else account+=paise(r.amount);}
  return {rows,totals:{billed:moneyFromPaise(due),received:moneyFromPaise(paid),balance:moneyFromPaise(due-paid),outstanding:moneyFromPaise(Math.max(0,due-paid)),advance:moneyFromPaise(Math.max(0,paid-due)),cash:moneyFromPaise(cash),account:moneyFromPaise(account),weight,bags,missingBags,mawbs:new Set(invoices.map(i=>i.awb)).size}};
}
export async function ensureAbsLedger(sql){
  await sql`CREATE TABLE IF NOT EXISTS mayavi_abs_ledger_v2_invoices (
    awb VARCHAR(11) PRIMARY KEY, invoice_date DATE NOT NULL, weight NUMERIC(16,4) NOT NULL,
    rate NUMERIC(16,4) NOT NULL, amount NUMERIC(16,2) NOT NULL CHECK(amount>=0),
    source TEXT NOT NULL CHECK(source IN ('MANUAL','AUTO')), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by TEXT NOT NULL DEFAULT '')`;
  await sql`CREATE TABLE IF NOT EXISTS mayavi_abs_ledger_v2_parts (
    entry_key TEXT PRIMARY KEY, awb VARCHAR(11) NOT NULL, part_label TEXT NOT NULL,
    invoice_date DATE NOT NULL, weight NUMERIC(16,4) NOT NULL, rate NUMERIC(16,4) NOT NULL,
    amount NUMERIC(16,2) NOT NULL CHECK(amount>=0), source TEXT NOT NULL CHECK(source IN ('MANUAL','AUTO')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), created_by TEXT NOT NULL DEFAULT '')`;
  await sql`ALTER TABLE mayavi_abs_ledger_v2_invoices ADD COLUMN IF NOT EXISTS bags NUMERIC(16,4)`;
  await sql`ALTER TABLE mayavi_abs_ledger_v2_parts ADD COLUMN IF NOT EXISTS bags NUMERIC(16,4)`;
  await sql`CREATE INDEX IF NOT EXISTS mayavi_abs_ledger_v2_parts_awb ON mayavi_abs_ledger_v2_parts(awb)`;
  await sql`CREATE TABLE IF NOT EXISTS mayavi_abs_ledger_v2_receipts (
    id UUID PRIMARY KEY, payment_date DATE NOT NULL, mode TEXT NOT NULL CHECK(mode IN ('CASH','ACCOUNT')),
    amount NUMERIC(16,2) NOT NULL CHECK(amount>0), remarks TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), created_by TEXT NOT NULL DEFAULT '')`;
}
// Use exactly the physical part keys of Import Profit Sheet. A blank arrival
// is not a reason to exclude a genuinely cleared part with a recorded clearance.
export function absShipmentEntries(s,financial={},extras=[]){
  const awb=ledgerAwb(s.awb),d=s.data||{},physical=physicalImportProfitRows(d,awb);
  const m=masterReceivable(s,financial,[]),split=physical.some(p=>p.rowKey!==awb);
  if(!split){
    const p=physical[0],at=masterCustomsClearance(d);
    return p&&!p.isActiveMaster&&at?[{awb,entryKey:awb,partLabel:'',arrivalDate:p.arrivalDate,clearanceDate:istDate(at),cleared:true,bags:p.bags,weight:m.billedWeight,rate:m.rate,amount:m.amount}]:[];
  }
  const byPart=new Map(extras.map(p=>[p.part_key,Number(p.excess_weight)||0]));
  return physical.filter(p=>!p.isActiveMaster&&!p._saudiaPendingVirtual&&p.customsClearedAt).map(p=>{
    const weight=p.weight===null?null:Math.round((p.weight+(byPart.get(p.rowKey)||0))*10000)/10000;
    return {awb,entryKey:p.rowKey,partLabel:p.partLabel,arrivalDate:p.arrivalDate,clearanceDate:istDate(p.customsClearedAt),cleared:true,bags:p.bags,weight,rate:m.rate,amount:weight===null||m.rate===null?null:moneyFromPaise(paise(weight*m.rate))};
  });
}
// Read the actual full master count for legacy invoices; never substitute
// the number of already arrived bags for a split shipment's master total.
export function absFullBags(d={},awb=''){
  for(const v of [d.totalPieces,d.masterPieces,d.totalBags,d.masterBags,d.bags,d.pieces]){
    const raw=String(v??'').split('/').at(-1).replace(/,/g,'').trim();
    if(/^\d+(?:\+\d+)*$/.test(raw)){
      const n=raw.split('+').reduce((s,x)=>s+Number(x),0);
      if(Number.isSafeInteger(n)&&n>0)return n;
    }
  }
  const physical=physicalImportProfitRows(d,awb);
  return physical.length===1&&physical[0].rowKey===awb?physical[0].bags:null;
}
export async function fillAbsSavedBags(sql,invoices){
  const missing=invoices.filter(i=>i.bags==null);
  if(!missing.length)return invoices;
  const ids=[...new Set(missing.map(i=>i.awb))];
  const shipments=await sql`SELECT awb,data FROM mayavi_shipments WHERE awb=ANY(${ids}::text[])`;
  const byAwb=new Map(shipments.map(s=>[s.awb,s.data||{}]));
  return invoices.map(i=>{
    if(i.bags!=null)return i;
    const d=byAwb.get(i.awb);
    if(!d)return i;
    const bags=i.entry_key===i.awb?absFullBags(d,i.awb):physicalImportProfitRows(d,i.awb).find(p=>p.rowKey===i.entry_key)?.bags;
    return {...i,bags:bags??null};
  });
}
export async function absMasters(sql){
  const [shipments,finance,extras,full,paidParts]=await Promise.all([
    sql`SELECT awb,data FROM mayavi_shipments WHERE COALESCE(data->>'shipmentType','IMPORT')='IMPORT'
      AND UPPER(TRIM(COALESCE(NULLIF(data->>'clientName',''),data->>'client','')))='ABS'`,
    sql`SELECT awb,rate,excess_weight FROM mayavi_import_profit`,
    sql`SELECT awb,part_key,excess_weight FROM mayavi_import_profit_part_duty WHERE excess_weight IS NOT NULL`,
    sql`SELECT awb FROM mayavi_abs_ledger_v2_invoices`,
    sql`SELECT awb,entry_key FROM mayavi_abs_ledger_v2_parts`
  ]);
  const rates=new Map(finance.map(x=>[ledgerAwb(x.awb),x])),parts=new Map(),seen=new Set(),masters=[];
  const fullSet=new Set(full.map(x=>x.awb)),paidByAwb=new Map();
  for(const p of paidParts){if(!paidByAwb.has(p.awb))paidByAwb.set(p.awb,[]);paidByAwb.get(p.awb).push(p.entry_key);}
  for(const p of extras){const key=ledgerAwb(p.awb);if(!parts.has(key))parts.set(key,[]);parts.get(key).push(p);}
  for(const s of shipments){
    const awb=ledgerAwb(s.awb),d=s.data||{};
    if(!awb||seen.has(awb)||fullSet.has(awb)||clientKey(clientLabel(d))!=='ABS')continue;
    seen.add(awb);
    const entries=absShipmentEntries(s,rates.get(awb)||{},parts.get(awb)||[]);
    const paid=paidByAwb.get(awb)||[];
    // If a tracker later collapses or rekeys already billed physical parts, do
    // not silently create a full-master or replacement invoice.
    const keys=new Set(entries.map(m=>m.entryKey));
    if(paid.some(k=>!keys.has(k)))continue;
    masters.push(...entries.filter(m=>!paid.includes(m.entryKey)));
  }
  return masters.sort((a,b)=>b.clearanceDate.localeCompare(a.clearanceDate)||a.awb.localeCompare(b.awb)||a.entryKey.localeCompare(b.entryKey));
}
export async function insertAbsMasters(sql,masters,source,user){
  let added=0;
  for(const m of masters){
    if(!m.cleared||!m.clearanceDate||m.amount===null)continue;
    const saved=m.entryKey===m.awb
      ?await sql`INSERT INTO mayavi_abs_ledger_v2_invoices
        (awb,invoice_date,weight,bags,rate,amount,source,created_by)
        SELECT ${m.awb},${m.clearanceDate}::date,${m.weight},${m.bags??null},${m.rate},${m.amount},${source},${user}
        WHERE NOT EXISTS (SELECT 1 FROM mayavi_abs_ledger_v2_parts WHERE awb=${m.awb})
        ON CONFLICT(awb) DO NOTHING RETURNING awb`
      :await sql`INSERT INTO mayavi_abs_ledger_v2_parts
        (entry_key,awb,part_label,invoice_date,weight,bags,rate,amount,source,created_by)
        SELECT ${m.entryKey},${m.awb},${m.partLabel},${m.clearanceDate}::date,${m.weight},${m.bags??null},${m.rate},${m.amount},${source},${user}
        WHERE NOT EXISTS (SELECT 1 FROM mayavi_abs_ledger_v2_invoices WHERE awb=${m.awb})
        ON CONFLICT(entry_key) DO NOTHING RETURNING awb`;
    added+=saved.length;
  }
  return added;
}
export async function syncAbsLedger(sql,masters=null,today=istDate()){
  if(today<AUTO_FROM)return 0;
  await ensureAbsLedger(sql);
  return insertAbsMasters(sql,(masters||await absMasters(sql)).filter(m=>absAutoEligible(m,today)),'AUTO','AUTO');
}
