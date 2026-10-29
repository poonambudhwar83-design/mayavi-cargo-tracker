import {ledgerAwb} from './importClientLedger.js';
import {clientKey,clientLabel,masterCustomsClearance,masterReceivable} from './importClientReceivables.js';
import {clearedMasterInImportProfit} from './importReceivablesProfitSource.js';
export const MONITOR_START_UTC='2026-10-28T18:30:00.000Z';
export const MONITOR_START_IST='2026-10-29';
const ms=v=>{const x=new Date(v).getTime();return Number.isFinite(x)?x:NaN;};
export function inspectClientLedger({shipments=[],financials=[],parts=[],accounts=[],invoices=[],voided=[]}={}){
  const rates=new Map(financials.map(x=>[ledgerAwb(x.awb),x]));
  const extras=new Map();for(const p of parts){const awb=ledgerAwb(p.awb);if(!extras.has(awb))extras.set(awb,[]);extras.get(awb).push(p);}
  const opened=new Map(accounts.map(a=>[a.client_key,a])), billed=new Map(invoices.map(i=>[ledgerAwb(i.awb),i]));
  const excluded=new Set(voided.map(x=>ledgerAwb(x.awb)));
  const seen=new Set(),missing=[],issues=[];
  let scanned=0,clearedSinceStart=0,skippedDeleted=0;
  for(const shipment of shipments){
    const awb=ledgerAwb(shipment.awb);if(!awb||seen.has(awb))continue;
    seen.add(awb);scanned++;
    const data=shipment.data||{},source=clearedMasterInImportProfit(data,awb);
    if(!source.eligible)continue;
    const clearedAt=masterCustomsClearance(data),clearedTime=ms(clearedAt);
    if(Number.isFinite(clearedTime)?clearedTime<ms(MONITOR_START_UTC):
      (!source.profitArrivalDate||source.profitArrivalDate<MONITOR_START_IST))continue;
    clearedSinceStart++;
    if(excluded.has(awb)){skippedDeleted++;continue;}
    const key=clientKey(clientLabel(data)),mawb=awb.slice(0,3)+'-'+awb.slice(3);
    const amt=masterReceivable(shipment,rates.get(awb)||{},extras.get(awb)||[]);
    const record={awb,mawb,clientKey:key,clearedAt,profitArrivalDate:source.profitArrivalDate,
      rate:amt.rate,weight:amt.weight,extraWeight:amt.extraWeight,amount:amt.amount};
    const problem=(code,message)=>issues.push({...record,id:awb+'|'+code,code,message});
    const invoice=billed.get(awb),account=opened.get(key);
    if(invoice){
      if(invoice.client_key!==key)problem('WRONG_CLIENT','MAWB is billed to a different client. Review required.');
      else if(amt.amount!==null&&Math.abs(Number(invoice.amount)-amt.amount)>.01)
        problem('AMOUNT_CHANGED','Saved charge differs from current Import Profit amount. Review required.');
      continue;
    }
    if(!account){problem('OPENING_NOT_SET','Client opening balance is not configured.');continue;}
    if(Number.isFinite(clearedTime)&&clearedTime<ms(account.started_at))continue;
    if(!Number.isFinite(clearedTime)){problem('CLEARANCE_TIME_MISSING','Profit-cleared master has no reliable clearance timestamp.');continue;}
    if(amt.amount===null){problem('RATE_OR_WEIGHT_MISSING','Rate or master weight is missing in Import Profit Sheet.');continue;}
    missing.push(record);
  }
  return {scanned,clearedSinceStart,skippedDeleted,missing,issues};
}
export async function ensureReconciliationTables(sql){
  await sql`CREATE TABLE IF NOT EXISTS mayavi_import_client_reconciliation_issues (
    issue_id TEXT PRIMARY KEY,awb VARCHAR(11) NOT NULL,client_key TEXT NOT NULL,
    issue_code TEXT NOT NULL,message TEXT NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ)`;
  await sql`CREATE INDEX IF NOT EXISTS mayavi_client_reconciliation_open_idx
    ON mayavi_import_client_reconciliation_issues(client_key,resolved_at)`;
  await sql`CREATE TABLE IF NOT EXISTS mayavi_import_client_reconciliation_runs (
    id INTEGER PRIMARY KEY CHECK(id=1),last_checked_at TIMESTAMPTZ NOT NULL,
    scanned INTEGER NOT NULL DEFAULT 0,cleared INTEGER NOT NULL DEFAULT 0,
    auto_added INTEGER NOT NULL DEFAULT 0,unresolved INTEGER NOT NULL DEFAULT 0)`;
}
export async function reconcileClientLedger(sql){
  await ensureReconciliationTables(sql);
  const [shipments,financials,parts,accounts,invoices,voided]=await Promise.all([
    sql`SELECT awb,data FROM mayavi_shipments WHERE COALESCE(data->>'shipmentType','IMPORT')='IMPORT'`,
    sql`SELECT awb,rate,excess_weight FROM mayavi_import_profit`,
    sql`SELECT awb,part_key,excess_weight FROM mayavi_import_profit_part_duty WHERE excess_weight IS NOT NULL`,
    sql`SELECT client_key,started_at FROM mayavi_import_client_accounts`,
    sql`SELECT awb,client_key,amount FROM mayavi_import_client_invoices`,
    sql`SELECT awb FROM mayavi_import_client_voided_invoices`
  ]);
  const result=inspectClientLedger({shipments,financials,parts,accounts,invoices,voided});
  let added=0;const issues=[...result.issues];
  for(const item of result.missing){
    try{
      const saved=await sql`INSERT INTO mayavi_import_client_invoices
        (awb,client_key,source,cleared_at,recognized_at,weight,excess_weight,rate,amount,created_by)
        SELECT ${item.awb},${item.clientKey},'AUTO',${item.clearedAt}::timestamptz,
          ${item.clearedAt}::timestamptz,${item.weight},${item.extraWeight},${item.rate},
          ${item.amount},'AUTO_RECONCILIATION'
        WHERE EXISTS(SELECT 1 FROM mayavi_import_client_accounts WHERE client_key=${item.clientKey})
          AND NOT EXISTS(SELECT 1 FROM mayavi_import_client_voided_invoices WHERE awb=${item.awb})
        ON CONFLICT(awb) DO NOTHING RETURNING awb`;
      if(saved.length)added++;
    }catch(e){issues.push({...item,id:item.awb+'|AUTO_ADD_FAILED',code:'AUTO_ADD_FAILED',
      message:String(e?.message||e).slice(0,240)});}
  }
  for(const issue of issues){
    const details=JSON.stringify({amount:issue.amount,rate:issue.rate,weight:issue.weight,
      extraWeight:issue.extraWeight,clearedAt:issue.clearedAt,arrival:issue.profitArrivalDate});
    await sql`INSERT INTO mayavi_import_client_reconciliation_issues
      (issue_id,awb,client_key,issue_code,message,details)
      VALUES(${issue.id},${issue.awb},${issue.clientKey},${issue.code},${issue.message},${details}::jsonb)
      ON CONFLICT(issue_id) DO UPDATE SET client_key=EXCLUDED.client_key,
      message=EXCLUDED.message,details=EXCLUDED.details,
      last_seen=NOW(),resolved_at=NULL`;
  }
  const ids=JSON.stringify(issues.map(x=>x.id));
  await sql`UPDATE mayavi_import_client_reconciliation_issues SET resolved_at=NOW()
    WHERE resolved_at IS NULL AND NOT EXISTS(
      SELECT 1 FROM jsonb_array_elements_text(${ids}::jsonb) AS x(value)
      WHERE x.value=mayavi_import_client_reconciliation_issues.issue_id)`;
  await sql`INSERT INTO mayavi_import_client_reconciliation_runs
      (id,last_checked_at,scanned,cleared,auto_added,unresolved)
    VALUES(1,NOW(),${result.scanned},${result.clearedSinceStart},${added},${issues.length})
    ON CONFLICT(id) DO UPDATE SET last_checked_at=EXCLUDED.last_checked_at,
      scanned=EXCLUDED.scanned,cleared=EXCLUDED.cleared,auto_added=EXCLUDED.auto_added,
      unresolved=EXCLUDED.unresolved`;
  return {checkedMasters:result.scanned,clearedSinceStart:result.clearedSinceStart,
    autoAdded:added,openIssues:issues.length,issues:issues.map(x=>({mawb:x.mawb,client:x.clientKey,code:x.code}))};
}
export async function getReconciliationSummary(sql){
  await ensureReconciliationTables(sql);
  const [r,issues]=await Promise.all([
    sql`SELECT last_checked_at,scanned,cleared,auto_added,unresolved
      FROM mayavi_import_client_reconciliation_runs WHERE id=1`,
    sql`SELECT awb,client_key,issue_code,message,details,last_seen
      FROM mayavi_import_client_reconciliation_issues WHERE resolved_at IS NULL
      ORDER BY last_seen DESC LIMIT 200`
  ]);
  const x=r[0]||{};
  return {lastCheckedAt:x.last_checked_at||null,scanned:Number(x.scanned)||0,
    clearedSinceStart:Number(x.cleared)||0,lastAutoAdded:Number(x.auto_added)||0,
    openIssues:Number(x.unresolved)||0,monitoringSince:MONITOR_START_IST,
    frequency:'Every 2 hours (server-side)',
    issues:issues.map(i=>({awb:i.awb,mawb:i.awb.slice(0,3)+'-'+i.awb.slice(3),
      clientKey:i.client_key,code:i.issue_code,message:i.message,details:i.details,
      lastSeen:i.last_seen}))};
}
