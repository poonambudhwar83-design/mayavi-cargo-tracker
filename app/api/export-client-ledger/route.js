import {randomUUID} from 'node:crypto';
import {neon} from '@neondatabase/serverless';
import {readSession} from '../../../lib/mayaviAuth.js';
import {ledgerAwb,validLedgerDate,validReceiptAmount} from '../../../lib/importClientLedger.js';
import {exportClientKey,exportIsDhl,exportSplitScheme,validEiciAmount,buildExportClientLedgerRows} from '../../../lib/exportClientLedger.js';
import {selectedProfitMonth,profitMonths,currentProfitMonth} from '../../../lib/profitPeriod.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const reply=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store, private'}});
const session=request=>{const user=readSession(request);return user?.role==='admin'?user:null;};
function db(){
  const url=process.env.DATABASE_URL||process.env.POSTGRES_URL||process.env.NEON_DATABASE_URL||process.env.DATABASE_URL_UNPOOLED||'';
  if(!url)throw Error('Mayavi shared database is not configured.');
  return neon(url);
}
async function ensure(sql){
  await sql`CREATE TABLE IF NOT EXISTS mayavi_export_client_eici(
    awb VARCHAR(11) PRIMARY KEY,amount NUMERIC(16,2) NOT NULL CHECK(amount>=0),
    updated_by TEXT NOT NULL DEFAULT '',updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await sql`CREATE TABLE IF NOT EXISTS mayavi_export_client_split(
    client_key TEXT PRIMARY KEY,scheme TEXT NOT NULL
    CHECK(scheme IN ('3_ACCOUNT_3_CASH','2_ACCOUNT_4_CASH')),
    updated_by TEXT NOT NULL DEFAULT '',updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await sql`CREATE TABLE IF NOT EXISTS mayavi_export_client_receipts(
    id UUID PRIMARY KEY,awb VARCHAR(11) NOT NULL,
    payment_date DATE NOT NULL,mode TEXT NOT NULL CHECK(mode IN ('ACCOUNT','CASH')),
    amount NUMERIC(16,2) NOT NULL CHECK(amount>0),remarks TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await sql`CREATE INDEX IF NOT EXISTS mayavi_export_receipts_awb_date
    ON mayavi_export_client_receipts(awb,payment_date DESC)`;
}
const normalizedReceipt=r=>({
  id:String(r.id),awb:ledgerAwb(r.awb),mawb:ledgerAwb(r.awb).replace(/^(\d{3})(\d{8})$/,'$1-$2'),
  date:String(r.payment_date).slice(0,10),mode:r.mode,amount:Number(r.amount),
  remarks:r.remarks||'',createdBy:r.created_by||'',createdAt:r.created_at
});
async function exportMaster(sql,awb){
  const found=await sql`SELECT awb,data FROM mayavi_shipments WHERE awb=${awb}
    AND UPPER(COALESCE(data->>'shipmentType',''))='EXPORT' LIMIT 1`;
  return found[0]||null;
}
export async function GET(request){
  if(!session(request))return reply({ok:false,error:'Admin authorization required.'},403);
  const month=selectedProfitMonth(new URL(request.url).searchParams.get('month'));
  if(!month)return reply({ok:false,error:'Choose a valid Export month (October 2026 onward).'},400);
  try{
    const sql=db();await ensure(sql);
    const [shipments,eici,splits,receipts]=await Promise.all([
      sql`SELECT awb,data FROM mayavi_shipments
        WHERE UPPER(COALESCE(data->>'shipmentType',''))='EXPORT' ORDER BY updated_at DESC`,
      sql`SELECT awb,amount FROM mayavi_export_client_eici`,
      sql`SELECT client_key,scheme FROM mayavi_export_client_split`,
      sql`SELECT id,awb,to_char(payment_date,'YYYY-MM-DD') AS payment_date,
        mode,amount,remarks,created_by,created_at FROM mayavi_export_client_receipts
        ORDER BY payment_date DESC,created_at DESC LIMIT 25000`
    ]);
    const rows=buildExportClientLedgerRows(shipments,eici,splits,receipts,month,currentProfitMonth());
    const awbs=new Set(rows.map(r=>r.awb));
    return reply({ok:true,month,months:profitMonths(),rows,
      receipts:receipts.filter(p=>awbs.has(ledgerAwb(p.awb))).map(normalizedReceipt)});
  }catch(error){return reply({ok:false,error:error?.message||'Export Client Ledger unavailable.'},503);}
}
export async function PATCH(request){
  const admin=session(request);
  if(!admin)return reply({ok:false,error:'Admin authorization required.'},403);
  try{
    const body=await request.json().catch(()=>({})),sql=db();
    await ensure(sql);
    if(body.action==='EICI'){
      const awb=ledgerAwb(body.awb);
      const value=validEiciAmount(body.amount);
      if(!awb||value===null)return reply({ok:false,error:'Enter a valid MAWB and non-negative EICI amount (max 2 decimals).'},400);
      if(!await exportMaster(sql,awb))return reply({ok:false,error:'Export MAWB not found.'},404);
      await sql`INSERT INTO mayavi_export_client_eici(awb,amount,updated_by)
        VALUES(${awb},${value},${admin.username})
        ON CONFLICT(awb) DO UPDATE SET amount=EXCLUDED.amount,
        updated_at=NOW(),updated_by=EXCLUDED.updated_by`;
      return reply({ok:true,awb,eiciAmount:value,eiciGst:Math.round(value*0.18*100)/100});
    }
    if(body.action==='SPLIT'){
      const key=exportClientKey(body.clientKey),scheme=String(body.scheme||'');
      if(!key||!['3_ACCOUNT_3_CASH','2_ACCOUNT_4_CASH'].includes(scheme))
        return reply({ok:false,error:'Choose a valid client split.'},400);
      const exists=await sql`SELECT 1 FROM mayavi_shipments WHERE
        UPPER(COALESCE(data->>'shipmentType',''))='EXPORT'
        AND UPPER(TRIM(COALESCE(NULLIF(data->>'clientName',''),data->>'client','Unassigned Client')))=${key} LIMIT 1`;
      if(!exists.length)return reply({ok:false,error:'Export client not found.'},404);
      if(exportIsDhl(key))return reply({ok:false,error:'DHL uses a fixed ₹19 account minus ₹8 commission.'},400);
      await sql`INSERT INTO mayavi_export_client_split(client_key,scheme,updated_by)
        VALUES(${key},${scheme},${admin.username})
        ON CONFLICT(client_key) DO UPDATE SET scheme=EXCLUDED.scheme,
        updated_at=NOW(),updated_by=EXCLUDED.updated_by`;
      return reply({ok:true,clientKey:key,scheme:exportSplitScheme(scheme)});
    }
    return reply({ok:false,error:'Unsupported Export ledger update.'},400);
  }catch(error){return reply({ok:false,error:error?.message||'Unable to save Export ledger changes.'},503);}
}
export async function POST(request){
  const admin=session(request);
  if(!admin)return reply({ok:false,error:'Admin authorization required.'},403);
  try{
    const body=await request.json().catch(()=>({}));
    const awb=ledgerAwb(body.awb),date=String(body.date||'').trim();
    const mode=String(body.mode||'').toUpperCase(),amount=validReceiptAmount(body.amount);
    const remarks=String(body.remarks||'').trim().slice(0,500);
    if(!awb||!validLedgerDate(date)||!['ACCOUNT','CASH'].includes(mode)||amount===null)
      return reply({ok:false,error:'Enter a valid MAWB, payment date, Account/Cash mode and positive payment amount.'},400);
    const sql=db();await ensure(sql);
    if(!await exportMaster(sql,awb))return reply({ok:false,error:'Export MAWB not found.'},404);
    const proposed=String(body.clientRequestId||'');
    const id=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(proposed)?proposed:randomUUID();
    await sql`INSERT INTO mayavi_export_client_receipts
      (id,awb,payment_date,mode,amount,remarks,created_by)
      VALUES(${id}::uuid,${awb},${date}::date,${mode},${amount},${remarks},${admin.username})
      ON CONFLICT(id) DO NOTHING`;
    const result=await sql`SELECT id,awb,to_char(payment_date,'YYYY-MM-DD') AS payment_date,mode,
      amount,remarks,created_by,created_at FROM mayavi_export_client_receipts WHERE id=${id}::uuid LIMIT 1`;
    const saved=result[0];
    if(!saved||ledgerAwb(saved.awb)!==awb||String(saved.payment_date)!==date||
      saved.mode!==mode||Number(saved.amount)!==amount||saved.remarks!==remarks)
      return reply({ok:false,error:'Payment request ID already used. Refresh and retry safely.'},409);
    return reply({ok:true,receipt:normalizedReceipt(saved),verifiedInDatabase:true},201);
  }catch(error){return reply({ok:false,error:error?.message||'Unable to save Export receipt.'},503);}
}
export async function DELETE(request){
  if(!session(request))return reply({ok:false,error:'Admin authorization required.'},403);
  try{
    const id=String(new URL(request.url).searchParams.get('id')||'');
    if(!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(id))return reply({ok:false,error:'Invalid payment ID.'},400);
    const sql=db();await ensure(sql);
    const rows=await sql`DELETE FROM mayavi_export_client_receipts WHERE id=${id}::uuid RETURNING id,awb,amount`;
    if(!rows.length)return reply({ok:false,error:'Payment not found.'},404);
    return reply({ok:true,deletedId:String(rows[0].id),awb:ledgerAwb(rows[0].awb),reversedAmount:Number(rows[0].amount)});
  }catch(error){return reply({ok:false,error:error?.message||'Unable to reverse Export receipt.'},503);}
}
