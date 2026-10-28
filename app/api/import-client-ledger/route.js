import {randomUUID} from 'node:crypto';
import {neon} from '@neondatabase/serverless';
import {readSession} from '../../../lib/mayaviAuth.js';
import {ledgerAwb,ledgerWeight,validLedgerDate,validReceiptAmount,buildImportLedgerRows} from '../../../lib/importClientLedger.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const reply=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store, private'}});
function db(){
  const url=process.env.DATABASE_URL||process.env.POSTGRES_URL||
    process.env.NEON_DATABASE_URL||process.env.DATABASE_URL_UNPOOLED||'';
  if(!url)throw new Error('Mayavi shared database is not configured.');
  return neon(url);
}
function adminOnly(request){
  const s=readSession(request);
  return s?.role==='admin'?s:null;
}
async function ensure(sql){
  // Same table definition as Import Profit Sheet, used only if Ledger opens
  // first. This does NOT modify existing saved rates or shipment records.
  await sql`CREATE TABLE IF NOT EXISTS mayavi_import_profit (
    awb VARCHAR(11) PRIMARY KEY,
    total_duty NUMERIC(16,2),
    rate NUMERIC(16,4),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by TEXT NOT NULL DEFAULT '',
    goods_category TEXT,
    goods_charge_override NUMERIC(16,2),
    driver_expense NUMERIC(16,2)
  )`;
  // A separate append-only receipt journal: many dated payments per MAWB.
  await sql`CREATE TABLE IF NOT EXISTS mayavi_import_client_receipts (
    id UUID PRIMARY KEY,
    awb VARCHAR(11) NOT NULL,
    payment_date DATE NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('CASH','ACCOUNT')),
    amount NUMERIC(16,2) NOT NULL CHECK (amount>0),
    remarks TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS mayavi_import_client_receipts_awb_date
    ON mayavi_import_client_receipts(awb,payment_date DESC)`;
}
function normalizeReceipt(r){
  return {id:String(r.id),awb:ledgerAwb(r.awb),
    mawb:String(r.awb).slice(0,3)+'-'+String(r.awb).slice(3),
    date:String(r.payment_date),mode:String(r.mode),amount:Number(r.amount),
    remarks:r.remarks||'',createdBy:r.created_by||'',createdAt:r.created_at||''};
}
export async function GET(request){
  if(!adminOnly(request))return reply({ok:false,error:'Admin authorization required.'},403);
  try{
    const sql=db();await ensure(sql);
    // All import MAWBs, across all months. Part loads must be billed once
    // using original MASTER weight and the matching Import Profit rate.
    const [shipments,financials,receipts]=await Promise.all([
      sql`SELECT awb,data FROM mayavi_shipments
        WHERE COALESCE(data->>'shipmentType','IMPORT')='IMPORT' ORDER BY updated_at DESC`,
      sql`SELECT awb,rate FROM mayavi_import_profit`,
      sql`SELECT id,awb,to_char(payment_date,'YYYY-MM-DD') AS payment_date,mode,
        amount,remarks,created_by,created_at FROM mayavi_import_client_receipts
        ORDER BY payment_date DESC,created_at DESC LIMIT 25000`
    ]);
    const rows=buildImportLedgerRows(shipments,financials,receipts);
    return reply({ok:true,rows,receipts:receipts.map(normalizeReceipt)});
  }catch(error){
    return reply({ok:false,error:error?.message||'Unable to load client ledger.'},503);
  }
}
export async function POST(request){
  const session=adminOnly(request);
  if(!session)return reply({ok:false,error:'Admin authorization required.'},403);
  try{
    const body=await request.json().catch(()=>({}));
    const awb=ledgerAwb(body.awb),date=String(body.date||'').trim();
    const mode=String(body.mode||'').trim().toUpperCase();
    const amount=validReceiptAmount(body.amount);
    const remarks=String(body.remarks||'').trim().slice(0,500);
    if(!awb)return reply({ok:false,error:'Select a valid Import MAWB.'},400);
    if(!validLedgerDate(date))return reply({ok:false,error:'Enter a valid payment date.'},400);
    if(!['CASH','ACCOUNT'].includes(mode))return reply({ok:false,error:'Choose Cash or Account.'},400);
    if(amount===null)return reply({ok:false,error:'Enter a payment amount greater than zero, up to two decimals.'},400);
    const sql=db();await ensure(sql);
    const shipments=await sql`SELECT awb,data FROM mayavi_shipments WHERE awb=${awb}
      AND COALESCE(data->>'shipmentType','IMPORT')='IMPORT' LIMIT 1`;
    if(!shipments.length)return reply({ok:false,error:'Import MAWB not found in the tracker.'},404);
    const rates=await sql`SELECT rate FROM mayavi_import_profit WHERE awb=${awb} LIMIT 1`;
    if(!rates.length||rates[0].rate===null||ledgerWeight(shipments[0].data||{})===null)
      return reply({ok:false,error:'Enter the MAWB Rate and Weight in Import Profit Sheet first.'},400);
    // Reuse a stable browser-generated request ID on network retry to prevent
    // duplicate Cash/Account receipts after a timeout or lost response.
    const id=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(body.clientRequestId||''))
      ?String(body.clientRequestId):randomUUID();
    await sql`INSERT INTO mayavi_import_client_receipts
      (id,awb,payment_date,mode,amount,remarks,created_by)
      VALUES (${id}::uuid,${awb},${date}::date,${mode},${amount},${remarks},${session.username})
      ON CONFLICT (id) DO NOTHING`;
    const result=await sql`SELECT id,awb,to_char(payment_date,'YYYY-MM-DD') AS payment_date,
      mode,amount,remarks,created_by,created_at FROM mayavi_import_client_receipts
      WHERE id=${id}::uuid LIMIT 1`;
    const saved=result[0];
    if(!saved||ledgerAwb(saved.awb)!==awb||String(saved.payment_date)!==date||
       saved.mode!==mode||Number(saved.amount)!==amount||saved.remarks!==remarks)
      return reply({ok:false,error:'Payment request ID already exists for another entry. Refresh and retry.'},409);
    return reply({ok:true,receipt:normalizeReceipt(saved)},201);
  }catch(error){
    return reply({ok:false,error:error?.message||'Could not save the payment.'},503);
  }
}
