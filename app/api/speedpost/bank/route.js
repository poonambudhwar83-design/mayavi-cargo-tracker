import {neon} from '@neondatabase/serverless';
import {readSession} from '../../../../lib/mayaviAuth.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const reply=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store, private'}});
function db(){
  const url=process.env.DATABASE_URL||process.env.POSTGRES_URL||
    process.env.NEON_DATABASE_URL||process.env.DATABASE_URL_UNPOOLED||'';
  if(!url)throw new Error('Mayavi database is not configured.');
  return neon(url);
}
async function ensure(sql){
  // Separate durable ledger: never mutate a shipment or its tariff/cash records.
  await sql`CREATE TABLE IF NOT EXISTS mayavi_speedpost_bank_daily(
    entry_day DATE PRIMARY KEY,
    bank_paid NUMERIC(14,2) NOT NULL CHECK(bank_paid>=0),
    updated_by TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
}
const monthOK=v=>/^\d{4}-(0[1-9]|1[0-2])$/.test(String(v||''));
const dayOK=v=>{
  const text=String(v||'');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(text))return false;
  const date=new Date(text+'T00:00:00.000Z');
  return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===text;
};
export async function GET(request){
  const session=readSession(request);
  if(session?.role!=='admin')return reply({ok:false,error:'Admin authorization required.'},403);
  const month=new URL(request.url).searchParams.get('month');
  if(!monthOK(month))return reply({ok:false,error:'Choose a valid entry month.'},400);
  try{
    const sql=db();await ensure(sql);
    const rows=await sql`SELECT entry_day::text AS day,bank_paid,updated_at
      FROM mayavi_speedpost_bank_daily
      WHERE entry_day >= ${month+'-01'}::date
        AND entry_day < (${month+'-01'}::date + INTERVAL '1 month')
      ORDER BY entry_day DESC`;
    return reply({ok:true,month,rows:rows.map(row=>({
      day:row.day,amount:Number(row.bank_paid),updatedAt:row.updated_at
    }))});
  }catch(error){return reply({ok:false,error:error?.message||'Cannot load saved bank payments.'},503);}
}
export async function PATCH(request){
  const session=readSession(request);
  if(session?.role!=='admin')return reply({ok:false,error:'Admin authorization required.'},403);
  const data=await request.json().catch(()=>({}));
  const day=String(data.day||'');
  const raw=String(data.amount??'').trim();
  if(!dayOK(day))return reply({ok:false,error:'Choose a valid original Speed Post entry date.'},400);
  if(!/^\d{1,9}(?:\.\d{1,2})?$/.test(raw))
    return reply({ok:false,error:'Enter a non-negative bank amount up to 2 decimal places.'},400);
  const amount=Number(raw);
  if(!Number.isFinite(amount)||amount>999999999)
    return reply({ok:false,error:'Bank amount is outside the allowed range.'},400);
  try{
    const sql=db();await ensure(sql);
    // Correction overwrites ONLY this day's bank amount, never adds a duplicate.
    const rows=await sql`INSERT INTO mayavi_speedpost_bank_daily(entry_day,bank_paid,updated_by)
      VALUES(${day}::date,${amount},${session.username})
      ON CONFLICT(entry_day) DO UPDATE SET
        bank_paid=EXCLUDED.bank_paid,updated_by=EXCLUDED.updated_by,updated_at=now()
      RETURNING entry_day::text AS day,bank_paid,updated_at`;
    return reply({ok:true,day:rows[0].day,amount:Number(rows[0].bank_paid),updatedAt:rows[0].updated_at});
  }catch(error){return reply({ok:false,error:error?.message||'Cannot save bank payment.'},503);}
}
