import {ledgerAwb,paise,moneyFromPaise} from './importClientLedger.js';
import {clientKey,clientLabel,istDate,masterCustomsClearance,masterReceivable} from './importClientReceivables.js';
import {clearedMasterInImportProfit} from './importReceivablesProfitSource.js';

export const AUTO_FROM='2026-12-03';
export function absAutoEligible(m,today=istDate()){
  return today>=AUTO_FROM && m.cleared && m.clearanceDate>=AUTO_FROM && m.amount!==null;
}
export function absLedger(invoices=[],receipts=[]){
  const events=[...invoices.map(i=>({date:i.date,type:'MAWB',reference:i.awb,weight:Number(i.weight),rate:Number(i.rate),debit:Number(i.amount),credit:0,source:i.source,createdAt:i.created_at})),
    ...receipts.map(r=>({date:r.date,type:'PAYMENT',reference:r.mode,remarks:r.remarks,id:r.id,debit:0,credit:Number(r.amount),createdAt:r.created_at}))];
  events.sort((a,b)=>a.date.localeCompare(b.date)||((a.type==='MAWB'?0:1)-(b.type==='MAWB'?0:1))||String(a.createdAt||'').localeCompare(String(b.createdAt||''))||String(a.reference).localeCompare(String(b.reference)));
  let due=0,paid=0,weight=0,cash=0,account=0;
  const rows=events.map(e=>{due+=paise(e.debit);paid+=paise(e.credit);return {...e,balance:moneyFromPaise(due-paid)};});
  for(const i of invoices)weight+=Number(i.weight)||0;
  for(const r of receipts){if(r.mode==='CASH')cash+=paise(r.amount);else account+=paise(r.amount);}
  return {rows,totals:{billed:moneyFromPaise(due),received:moneyFromPaise(paid),balance:moneyFromPaise(due-paid),outstanding:moneyFromPaise(Math.max(0,due-paid)),advance:moneyFromPaise(Math.max(0,paid-due)),cash:moneyFromPaise(cash),account:moneyFromPaise(account),weight,mawbs:invoices.length}};
}
export async function ensureAbsLedger(sql){
  await sql`CREATE TABLE IF NOT EXISTS mayavi_abs_ledger_v2_invoices (
    awb VARCHAR(11) PRIMARY KEY, invoice_date DATE NOT NULL, weight NUMERIC(16,4) NOT NULL,
    rate NUMERIC(16,4) NOT NULL, amount NUMERIC(16,2) NOT NULL CHECK(amount>=0),
    source TEXT NOT NULL CHECK(source IN ('MANUAL','AUTO')), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by TEXT NOT NULL DEFAULT '')`;
  await sql`CREATE TABLE IF NOT EXISTS mayavi_abs_ledger_v2_receipts (
    id UUID PRIMARY KEY, payment_date DATE NOT NULL, mode TEXT NOT NULL CHECK(mode IN ('CASH','ACCOUNT')),
    amount NUMERIC(16,2) NOT NULL CHECK(amount>0), remarks TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), created_by TEXT NOT NULL DEFAULT '')`;
}
export async function absMasters(sql){
  const [shipments,finance,extras]=await Promise.all([
    sql`SELECT awb,data FROM mayavi_shipments WHERE COALESCE(data->>'shipmentType','IMPORT')='IMPORT'
      AND UPPER(TRIM(COALESCE(NULLIF(data->>'clientName',''),data->>'client','')))='ABS'`,
    sql`SELECT awb,rate,excess_weight FROM mayavi_import_profit`,
    sql`SELECT awb,part_key,excess_weight FROM mayavi_import_profit_part_duty WHERE excess_weight IS NOT NULL`
  ]);
  const rates=new Map(finance.map(x=>[ledgerAwb(x.awb),x])),parts=new Map(),seen=new Set(),masters=[];
  for(const p of extras){const key=ledgerAwb(p.awb);if(!parts.has(key))parts.set(key,[]);parts.get(key).push(p);}
  for(const s of shipments){
    const awb=ledgerAwb(s.awb),d=s.data||{};
    if(!awb||seen.has(awb)||clientKey(clientLabel(d))!=='ABS')continue;
    seen.add(awb);
    const at=masterCustomsClearance(d),profit=clearedMasterInImportProfit(d,awb);
    const m=masterReceivable(s,rates.get(awb)||{},parts.get(awb)||[]);
    masters.push({awb,arrivalDate:profit.profitArrivalDate,clearanceDate:at?istDate(at):'',cleared:!!at&&profit.eligible,weight:m.billedWeight,rate:m.rate,amount:m.amount});
  }
  return masters.sort((a,b)=>b.clearanceDate.localeCompare(a.clearanceDate)||a.awb.localeCompare(b.awb));
}
export async function insertAbsMasters(sql,masters,source,user){
  let added=0;
  for(const m of masters){
    if(!m.cleared||!m.clearanceDate||m.amount===null)continue;
    const saved=await sql`INSERT INTO mayavi_abs_ledger_v2_invoices
      (awb,invoice_date,weight,rate,amount,source,created_by)
      VALUES (${m.awb},${m.clearanceDate}::date,${m.weight},${m.rate},${m.amount},${source},${user})
      ON CONFLICT(awb) DO NOTHING RETURNING awb`;
    added+=saved.length;
  }
  return added;
}
export async function syncAbsLedger(sql,masters=null,today=istDate()){
  if(today<AUTO_FROM)return 0;
  await ensureAbsLedger(sql);
  return insertAbsMasters(sql,(masters||await absMasters(sql)).filter(m=>absAutoEligible(m,today)),'AUTO','AUTO');
}
