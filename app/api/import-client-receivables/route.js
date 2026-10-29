import {randomUUID} from 'node:crypto';
import {neon} from '@neondatabase/serverless';
import {readSession} from '../../../lib/mayaviAuth.js';
import {ledgerAwb,validLedgerDate,validReceiptAmount} from '../../../lib/importClientLedger.js';
import {clientKey,clientLabel,istDate,masterCustomsClearance,masterReceivable,settleClientReceivables} from '../../../lib/importClientReceivables.js';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const reply=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store, private'}});
const admin=req=>{const s=readSession(req);return s?.role==='admin'?s:null;};
const db=()=>neon(process.env.DATABASE_URL||process.env.POSTGRES_URL||process.env.NEON_DATABASE_URL||process.env.DATABASE_URL_UNPOOLED||'');
async function ensure(sql){
  await sql`CREATE TABLE IF NOT EXISTS mayavi_import_client_accounts (
    client_key TEXT PRIMARY KEY,display_name TEXT NOT NULL,
    opening_amount NUMERIC(16,2) NOT NULL CHECK(opening_amount>=0),
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by TEXT NOT NULL DEFAULT '')`;
  await sql`CREATE TABLE IF NOT EXISTS mayavi_import_client_invoices (
    awb VARCHAR(11) PRIMARY KEY,client_key TEXT NOT NULL REFERENCES mayavi_import_client_accounts(client_key),
    source TEXT NOT NULL CHECK(source IN ('AUTO','MANUAL')),cleared_at TIMESTAMPTZ NOT NULL,
    recognized_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    weight NUMERIC(16,4) NOT NULL,excess_weight NUMERIC(16,4) NOT NULL DEFAULT 0,
    rate NUMERIC(16,4) NOT NULL,amount NUMERIC(16,2) NOT NULL CHECK(amount>=0),
    acknowledged_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by TEXT NOT NULL DEFAULT '')`;
  await sql`CREATE INDEX IF NOT EXISTS mayavi_client_invoice_order ON mayavi_import_client_invoices(client_key,recognized_at,awb)`;
  await sql`CREATE TABLE IF NOT EXISTS mayavi_import_client_bulk_receipts (
    id UUID PRIMARY KEY,client_key TEXT NOT NULL REFERENCES mayavi_import_client_accounts(client_key),
    payment_date DATE NOT NULL,mode TEXT NOT NULL CHECK(mode IN ('CASH','ACCOUNT')),
    amount NUMERIC(16,2) NOT NULL CHECK(amount>0),remarks TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await sql`CREATE INDEX IF NOT EXISTS mayavi_client_bulk_receipts_order ON mayavi_import_client_bulk_receipts(client_key,payment_date,created_at)`;
}
async function inputs(sql){
  const [shipments,financials,partExtras,accounts]=await Promise.all([
    sql`SELECT awb,data FROM mayavi_shipments WHERE COALESCE(data->>'shipmentType','IMPORT')='IMPORT' ORDER BY updated_at DESC`,
    sql`SELECT awb,rate,excess_weight FROM mayavi_import_profit`,
    sql`SELECT awb,part_key,excess_weight FROM mayavi_import_profit_part_duty WHERE excess_weight IS NOT NULL`,
    sql`SELECT client_key,display_name,opening_amount,started_at,updated_at FROM mayavi_import_client_accounts`
  ]);
  const rates=new Map(financials.map(x=>[ledgerAwb(x.awb),x])),extras=new Map();
  for(const p of partExtras){const awb=ledgerAwb(p.awb);if(!extras.has(awb))extras.set(awb,[]);extras.get(awb).push(p);}
  const masters=shipments.map(s=>{const awb=ledgerAwb(s.awb),d=s.data||{};return {
    awb,mawb:awb.slice(0,3)+'-'+awb.slice(3),
    clientName:clientLabel(d),clientKey:clientKey(clientLabel(d)),
    clearedAt:masterCustomsClearance(d),
    ...masterReceivable(s,rates.get(awb)||{},extras.get(awb)||[])}
  }).filter(s=>s.awb);
  return {masters,accounts,opened:new Map(accounts.map(a=>[a.client_key,a]))};
}
async function sync(sql,masters,opened){
  let count=0;
  for(const s of masters){
    const a=opened.get(s.clientKey);
    if(!a||!s.clearedAt||new Date(s.clearedAt)<new Date(a.started_at)||s.amount===null)continue;
    const [saved]=await sql`INSERT INTO mayavi_import_client_invoices
      (awb,client_key,source,cleared_at,recognized_at,weight,excess_weight,rate,amount,created_by)
      VALUES (${s.awb},${s.clientKey},'AUTO',${s.clearedAt}::timestamptz,
        ${s.clearedAt}::timestamptz,${s.weight},${s.extraWeight},${s.rate},${s.amount},'AUTO')
      ON CONFLICT(awb) DO NOTHING RETURNING awb`;
    if(saved)count++;
  }
  return count;
}
const invoice=x=>({awb:x.awb,clientKey:x.client_key,source:x.source,
  clearedAt:x.cleared_at,recognized_at:x.recognized_at,weight:Number(x.weight),
  extraWeight:Number(x.excess_weight),billedWeight:Number(x.weight)+Number(x.excess_weight),
  rate:Number(x.rate),amount:Number(x.amount),acknowledged:Boolean(x.acknowledged_at)});
const payment=x=>({id:String(x.id),clientKey:x.client_key,date:String(x.payment_date).slice(0,10),
  mode:x.mode,amount:Number(x.amount),remarks:x.remarks||'',createdBy:x.created_by||'',created_at:x.created_at});
export async function GET(request){
  if(!admin(request))return reply({ok:false,error:'Admin authorization required.'},403);
  try{
    const sql=db();await ensure(sql);
    const {masters,accounts,opened}=await inputs(sql),added=await sync(sql,masters,opened);
    const [rawInvoices,rawReceipts,oldReceipts]=await Promise.all([
      sql`SELECT awb,client_key,source,cleared_at,recognized_at,weight,excess_weight,
        rate,amount,acknowledged_at FROM mayavi_import_client_invoices ORDER BY recognized_at,awb`,
      sql`SELECT id,client_key,to_char(payment_date,'YYYY-MM-DD') AS payment_date,
        mode,amount,remarks,created_by,created_at FROM mayavi_import_client_bulk_receipts
        ORDER BY payment_date,created_at,id`,
      sql`SELECT awb,to_char(payment_date,'YYYY-MM-DD') AS date,mode,amount,remarks
        FROM mayavi_import_client_receipts ORDER BY payment_date DESC LIMIT 100`
    ]);
    const invoices=rawInvoices.map(invoice),receipts=rawReceipts.map(payment);
    const names=new Map(masters.map(m=>[m.clientKey,m.clientName]));
    for(const a of accounts)names.set(a.client_key,a.display_name);
    const billed=new Set(invoices.map(i=>i.awb)),today=istDate();
    const clients=[...names].map(([key,name])=>{
      const a=opened.get(key),invoiceRows=invoices.filter(i=>i.clientKey===key);
      const account=a?settleClientReceivables({amount:a.opening_amount,
        started_at:a.started_at,displayName:a.display_name,updatedAt:a.updated_at},
        invoiceRows,receipts.filter(p=>p.clientKey===key),today):null;
      const active=masters.filter(s=>s.clientKey===key&&!s.clearedAt);
      const historical=masters.filter(s=>s.clientKey===key&&s.clearedAt&&!billed.has(s.awb));
      return {key,name,hasOpening:Boolean(a),opening:account?.opening||null,
        totals:account?.totals||null,daily:account?.daily||[],invoices:account?.invoices||[],
        receipts:account?.receipts||[],active,historical,
        pendingRate:historical.filter(s=>a&&new Date(s.clearedAt)>=new Date(a.started_at)&&s.amount===null),
        activeEstimated:active.reduce((n,s)=>n+(s.amount||0),0),
        unread:invoiceRows.filter(i=>i.source==='AUTO'&&!i.acknowledged).length};
    }).sort((a,b)=>a.name.localeCompare(b.name));
    return reply({ok:true,clients,newClearedMasters:added,
      unread:clients.reduce((n,c)=>n+c.unread,0),
      legacyReceipts:oldReceipts.map(x=>({...x,amount:Number(x.amount)})),
      lastUpdated:new Date().toISOString()});
  }catch(e){return reply({ok:false,error:e?.message||'Client receivables unavailable.'},503);}
}
export async function POST(request){
  const user=admin(request);
  if(!user)return reply({ok:false,error:'Admin authorization required.'},403);
  try{
    const body=await request.json().catch(()=>({})),action=String(body.action||'').toUpperCase(),sql=db();
    await ensure(sql);
    if(action==='OPENING'){
      const key=clientKey(body.client),value=String(body.amount??'').trim(),
        amount=/^\d{1,12}(?:\.\d{1,2})?$/.test(value)?Number(value):NaN;
      if(!key||key.length>150||!Number.isFinite(amount)||amount<0)
        return reply({ok:false,error:'Choose a client and enter a non-negative opening amount.'},400);
      const [known]=await sql`SELECT data FROM mayavi_shipments WHERE
        UPPER(TRIM(COALESCE(NULLIF(data->>'clientName',''),data->>'client','Unassigned Client')))=${key}
        AND COALESCE(data->>'shipmentType','IMPORT')='IMPORT' LIMIT 1`;
      if(!known)return reply({ok:false,error:'Client not found in Import Masters.'},404);
      const [saved]=await sql`INSERT INTO mayavi_import_client_accounts
        (client_key,display_name,opening_amount,updated_by)
        VALUES (${key},${clientLabel(known.data||{})},${amount},${user.username})
        ON CONFLICT(client_key) DO UPDATE SET opening_amount=EXCLUDED.opening_amount,
          updated_at=NOW(),updated_by=EXCLUDED.updated_by
        RETURNING client_key,opening_amount,started_at`;
      return reply({ok:true,account:saved});
    }
    if(action==='RECEIPT'){
      const key=clientKey(body.client),mode=String(body.mode||'').toUpperCase(),
        sum=validReceiptAmount(body.amount),date=String(body.date||''),remarks=String(body.remarks||'').trim().slice(0,500);
      if(!key||sum===null||!validLedgerDate(date)||!['CASH','ACCOUNT'].includes(mode))
        return reply({ok:false,error:'Enter client, valid date, mode and positive received amount.'},400);
      const [a]=await sql`SELECT started_at FROM mayavi_import_client_accounts WHERE client_key=${key} LIMIT 1`;
      if(!a)return reply({ok:false,error:'Save opening balance first.'},409);
      if(date<istDate(a.started_at))return reply({ok:false,error:'Receipt date precedes opening date.'},400);
      const requestId=String(body.clientRequestId||'');
      const id=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)
        ?requestId:randomUUID();
      await sql`INSERT INTO mayavi_import_client_bulk_receipts
        (id,client_key,payment_date,mode,amount,remarks,created_by)
        VALUES (${id}::uuid,${key},${date}::date,${mode},${sum},${remarks},${user.username})
        ON CONFLICT(id) DO NOTHING`;
      const [saved]=await sql`SELECT id,client_key,to_char(payment_date,'YYYY-MM-DD') AS payment_date,
        mode,amount,remarks,created_by,created_at FROM mayavi_import_client_bulk_receipts WHERE id=${id}::uuid LIMIT 1`;
      if(!saved||saved.client_key!==key||saved.payment_date!==date||saved.mode!==mode||
        Number(saved.amount)!==sum||saved.remarks!==remarks)
        return reply({ok:false,error:'Receipt request ID already used. Refresh first.'},409);
      const [balance]=await sql`SELECT a.opening_amount,
        COALESCE(SUM(p.amount),0) AS total_received
        FROM mayavi_import_client_accounts a
        LEFT JOIN mayavi_import_client_bulk_receipts p ON p.client_key=a.client_key
        WHERE a.client_key=${key} GROUP BY a.opening_amount`;
      const openingPending=Math.max(0,Number(balance?.opening_amount||0)-Number(balance?.total_received||0));
      console.info('import_client_receipt_saved',JSON.stringify({client:key,mode,receiptId:id}));
      return reply({ok:true,receipt:payment(saved),openingPending,
        verifiedInDatabase:true},201);
    }
    if(action==='MANUAL'){
      const awb=ledgerAwb(body.awb);
      if(!awb)return reply({ok:false,error:'Enter valid 11-digit MAWB.'},400);
      const {masters,opened}=await inputs(sql),s=masters.find(r=>r.awb===awb);
      if(!s)return reply({ok:false,error:'Import MAWB not found.'},404);
      if(!s.clearedAt)return reply({ok:false,error:'MAWB is still Active; it will be billed after Customs Clear.'},409);
      if(!opened.has(s.clientKey))return reply({ok:false,error:'Save this client’s opening balance first.'},409);
      if(s.amount===null)return reply({ok:false,error:'Enter Weight and Rate in Import Profit Sheet first.'},409);
      const [created]=await sql`INSERT INTO mayavi_import_client_invoices
        (awb,client_key,source,cleared_at,recognized_at,weight,excess_weight,
          rate,amount,acknowledged_at,created_by)
        VALUES (${awb},${s.clientKey},'MANUAL',${s.clearedAt}::timestamptz,
          NOW(),${s.weight},${s.extraWeight},${s.rate},${s.amount},NOW(),${user.username})
        ON CONFLICT(awb) DO NOTHING RETURNING awb`;
      if(!created)return reply({ok:false,error:'MAWB already included in ledger.'},409);
      return reply({ok:true,mawb:s.mawb,amount:s.amount},201);
    }
    if(action==='ACKNOWLEDGE'){
      const key=clientKey(body.client);if(!key)return reply({ok:false,error:'Choose a client.'},400);
      const saved=await sql`UPDATE mayavi_import_client_invoices SET acknowledged_at=NOW()
        WHERE client_key=${key} AND source='AUTO' AND acknowledged_at IS NULL RETURNING awb`;
      return reply({ok:true,acknowledged:saved.length});
    }
    return reply({ok:false,error:'Unknown ledger action.'},400);
  }catch(e){
    console.error('import_client_ledger_save_failed',e?.message||String(e));
    return reply({ok:false,error:e?.message||'Could not save client ledger.'},503);
  }
}
