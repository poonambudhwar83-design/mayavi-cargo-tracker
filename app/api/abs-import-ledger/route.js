import {neon} from '@neondatabase/serverless';
import {readSession} from '../../../lib/mayaviAuth.js';
import {validLedgerDate,validReceiptAmount} from '../../../lib/importClientLedger.js';
import {istDate} from '../../../lib/importClientReceivables.js';
import {AUTO_FROM,absNewClearance,absLedger,ensureAbsLedger,fillAbsSavedBags,absMasters,syncAbsLedger} from '../../../lib/absImportLedger.js';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const reply=(d,status=200)=>Response.json(d,{status,headers:{'Cache-Control':'no-store, private'}});
const db=()=>neon(process.env.DATABASE_URL||process.env.POSTGRES_URL||process.env.NEON_DATABASE_URL||process.env.DATABASE_URL_UNPOOLED||'');
export async function GET(request){
  if(readSession(request)?.role!=='admin')return reply({ok:false,error:'Admin only'},403);
  try{
    const sql=db();await ensureAbsLedger(sql);
    const masters=await absMasters(sql);await syncAbsLedger(sql,masters);
    const [savedInvoices,receipts]=await Promise.all([
      sql`SELECT awb,awb AS entry_key,'' AS part_label,to_char(invoice_date,'YYYY-MM-DD') AS date,weight,bags,rate,amount,source,created_at FROM mayavi_abs_ledger_v2_invoices
        UNION ALL SELECT awb,entry_key,part_label,to_char(invoice_date,'YYYY-MM-DD'),weight,bags,rate,amount,source,created_at FROM mayavi_abs_ledger_v2_parts ORDER BY date,awb,entry_key`,
      sql`SELECT id,to_char(payment_date,'YYYY-MM-DD') AS date,mode,amount,remarks,created_at FROM mayavi_abs_ledger_v2_receipts ORDER BY payment_date,created_at`
    ]);
    const invoices=await fillAbsSavedBags(sql,savedInvoices);
    const saved=new Set(invoices.map(i=>i.entry_key));
    const candidates=masters.filter(m=>absNewClearance(m)&&!saved.has(m.entryKey));
    return reply({ok:true,client:'ABS',today:istDate(),autoFrom:AUTO_FROM,invoices,receipts,candidates,...absLedger(invoices,receipts)});
  }catch(e){return reply({ok:false,error:e?.message||'Unable to load ABS ledger'},503);}
}
export async function POST(request){
  const session=readSession(request);
  if(session?.role!=='admin')return reply({ok:false,error:'Admin only'},403);
  try{
    const body=await request.json(),sql=db();await ensureAbsLedger(sql);
    if(body.action==='IMPORT')return reply({ok:false,error:'Manual historical imports are closed. New customs-cleared entries are imported automatically.'},400);
    if(body.action==='RECEIPT'){
      const id=String(body.id||''),date=String(body.date||''),mode=String(body.mode||''),amount=validReceiptAmount(body.amount),remarks=String(body.remarks||'').trim().slice(0,500);
      if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)||!validLedgerDate(date)||date>istDate()||!['CASH','ACCOUNT'].includes(mode)||amount===null)return reply({ok:false,error:'Enter valid payment date, amount and mode.'},400);
      await sql`INSERT INTO mayavi_abs_ledger_v2_receipts (id,payment_date,mode,amount,remarks,created_by)
        VALUES (${id}::uuid,${date}::date,${mode},${amount},${remarks},${session.username||'admin'}) ON CONFLICT(id) DO NOTHING`;
      const [saved]=await sql`SELECT id,amount,mode,to_char(payment_date,'YYYY-MM-DD') AS date,remarks FROM mayavi_abs_ledger_v2_receipts WHERE id=${id}::uuid`;
      if(!saved||Number(saved.amount)!==amount||saved.mode!==mode||saved.date!==date||saved.remarks!==remarks)return reply({ok:false,error:'Receipt could not be verified. Refresh before retrying.'},409);
      return reply({ok:true,id});
    }
    return reply({ok:false,error:'Unknown action'},400);
  }catch(e){return reply({ok:false,error:e?.message||'Unable to save ABS ledger'},503);}
}
