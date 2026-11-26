import {neon} from '@neondatabase/serverless';
import {readSession} from '../../../lib/mayaviAuth.js';
import {ledgerAwb,validLedgerDate,validReceiptAmount} from '../../../lib/importClientLedger.js';
import {istDate} from '../../../lib/importClientReceivables.js';
import {AUTO_FROM,absLedger,ensureAbsLedger,absMasters,insertAbsMasters,syncAbsLedger} from '../../../lib/absImportLedger.js';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const reply=(d,status=200)=>Response.json(d,{status,headers:{'Cache-Control':'no-store, private'}});
const db=()=>neon(process.env.DATABASE_URL||process.env.POSTGRES_URL||process.env.NEON_DATABASE_URL||process.env.DATABASE_URL_UNPOOLED||'');
export async function GET(request){
  if(readSession(request)?.role!=='admin')return reply({ok:false,error:'Admin only'},403);
  try{
    const sql=db();await ensureAbsLedger(sql);
    const masters=await absMasters(sql);await syncAbsLedger(sql,masters);
    const [invoices,receipts]=await Promise.all([
      sql`SELECT awb,to_char(invoice_date,'YYYY-MM-DD') AS date,weight,rate,amount,source,created_at FROM mayavi_abs_ledger_v2_invoices ORDER BY invoice_date,awb`,
      sql`SELECT id,to_char(payment_date,'YYYY-MM-DD') AS date,mode,amount,remarks,created_at FROM mayavi_abs_ledger_v2_receipts ORDER BY payment_date,created_at`
    ]);
    const saved=new Set(invoices.map(i=>i.awb));
    const candidates=masters.filter(m=>m.cleared&&!saved.has(m.awb));
    return reply({ok:true,client:'ABS',today:istDate(),autoFrom:AUTO_FROM,invoices,receipts,candidates,...absLedger(invoices,receipts)});
  }catch(e){return reply({ok:false,error:e?.message||'Unable to load ABS ledger'},503);}
}
export async function POST(request){
  const session=readSession(request);
  if(session?.role!=='admin')return reply({ok:false,error:'Admin only'},403);
  try{
    const body=await request.json(),sql=db();await ensureAbsLedger(sql);
    if(body.action==='IMPORT'){
      if(!Array.isArray(body.awbs)||!body.awbs.length||body.awbs.length>500)return reply({ok:false,error:'Select up to 500 MAWBs'},400);
      const keys=new Set(body.awbs.map(ledgerAwb)),masters=(await absMasters(sql)).filter(m=>keys.has(m.awb)&&m.cleared&&m.amount!==null);
      if(masters.length!==keys.size)return reply({ok:false,error:'Some MAWBs are not fully cleared ABS masters with a saved rate. Refresh and try again.'},400);
      const added=await insertAbsMasters(sql,masters,'MANUAL',session.username||'admin');
      return reply({ok:true,added});
    }
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
