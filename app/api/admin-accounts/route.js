import { randomUUID } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { readSession } from '../../../lib/mayaviAuth.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const db=()=>{
  const url=process.env.DATABASE_URL||process.env.POSTGRES_URL||process.env.NEON_DATABASE_URL||process.env.DATABASE_URL_UNPOOLED||'';
  if(!url)throw new Error('Mayavi database is unavailable.');
  return neon(url);
};
const reply=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
const clean=(v,max)=>String(v??'').trim().slice(0,max);
const monthOK=v=>/^20\d{2}-(0[1-9]|1[0-2])$/.test(v);
function dateOK(v){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(v))return false;
  const t=Date.parse(v+'T00:00:00Z');
  return Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===v;
}
function moneyToPaise(v){
  const s=String(v??'').trim().replace(/,/g,'');
  if(!/^\d{1,11}(?:\.\d{1,2})?$/.test(s))return null;
  const [whole,cents='']=s.split('.');
  const p=Number(whole)*100+Number((cents+'00').slice(0,2));
  return Number.isSafeInteger(p)&&p<=1000000000000?p:null;
}
const rupees=p=>(p/100).toFixed(2);
async function auth(request,sql){
  const session=readSession(request);
  if(!session)return{error:'Please log in.',status:401};
  if(session.role!=='admin')return{error:'Admin access only.',status:403};
  const users=await sql`SELECT role,is_active FROM mayavi_users WHERE lower(username)=${session.username} LIMIT 1`;
  if(users[0]?.role!=='admin'||!users[0]?.is_active)return{error:'Admin account is not active.',status:403};
  return{session};
}
async function ensure(sql){
  await sql`CREATE TABLE IF NOT EXISTS mayavi_admin_account_ledger (
    id TEXT PRIMARY KEY,
    month_key TEXT NOT NULL,
    data JSONB NOT NULL,
    created_by TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
}
function validate(body){
  const transactionDate=clean(body?.transactionDate,10);
  const entry={
    month:clean(body?.month,7),
    transactionDate,
    accountHolder:clean(body?.accountHolder,200),
    creditPaise:moneyToPaise(body?.credit || '0'),
    debitPaise:moneyToPaise(body?.debit || '0'),
    remarks:clean(body?.remarks,1000)
  };
  if(!monthOK(entry.month)||!dateOK(transactionDate)||transactionDate.slice(0,7)!==entry.month||
      !entry.accountHolder||entry.creditPaise===null||entry.debitPaise===null||
      (entry.creditPaise===0&&entry.debitPaise===0)||
      (entry.creditPaise>0&&entry.debitPaise>0))
    return{error:'Enter account holder, date, and either Credit or Debit (not both).'};
  return{entry};
}
function output(row,balance=0){
  const d=row.data||{};
  return{
    id:row.id,month:d.month||row.month_key,
    transactionDate:d.transactionDate||'',
    accountHolder:d.accountHolder||'',
    credit:rupees(Number(d.creditPaise)||0),
    debit:rupees(Number(d.debitPaise)||0),
    remarks:d.remarks||'',balance:rupees(balance),
    createdAt:row.created_at,updatedAt:row.updated_at
  };
}
async function fetchLedger(sql,month){
  // Running balance is across ALL months, not reset on the selected month.
  const all=await sql`SELECT id,month_key,data,created_at,updated_at
    FROM mayavi_admin_account_ledger
    ORDER BY data->>'transactionDate' ASC, created_at ASC, id ASC LIMIT 10000`;
  const balances=new Map(), rows=[];
  for(const row of all){
    const d=row.data||{},holder=String(d.accountHolder||'').trim();
    const key=holder.toLocaleLowerCase('en-IN');
    const value=(balances.get(key)||0)+(Number(d.creditPaise)||0)-(Number(d.debitPaise)||0);
    balances.set(key,value);
    if(row.month_key===month)rows.push(output(row,value));
  }
  return rows.reverse();
}
async function fetchOne(sql,id){
  const row=await sql`SELECT id,month_key,data,created_at,updated_at FROM mayavi_admin_account_ledger WHERE id=${id} LIMIT 1`;
  return row[0]?output(row[0]):null;
}
export async function GET(request){
  try{
    const sql=db(),a=await auth(request,sql);
    if(a.error)return reply({ok:false,error:a.error},a.status);
    const month=new URL(request.url).searchParams.get('month')||'';
    if(!monthOK(month))return reply({ok:false,error:'Invalid month.'},400);
    await ensure(sql);
    return reply({ok:true,rows:await fetchLedger(sql,month)});
  }catch(e){return reply({ok:false,error:e?.message||'Account ledger unavailable.'},503)}
}
export async function POST(request){
  try{
    const sql=db(),a=await auth(request,sql);
    if(a.error)return reply({ok:false,error:a.error},a.status);
    const {entry,error}=validate(await request.json().catch(()=>({})));
    if(error)return reply({ok:false,error},400);
    await ensure(sql);
    const id=randomUUID(),by=a.session.displayName||a.session.username;
    await sql`INSERT INTO mayavi_admin_account_ledger (id,month_key,data,created_by,updated_by)
      VALUES (${id},${entry.month},${JSON.stringify(entry)}::jsonb,${by},${by})`;
    return reply({ok:true,row:await fetchOne(sql,id)},201);
  }catch(e){return reply({ok:false,error:e?.message||'Save failed.'},503)}
}
export async function PATCH(request){
  try{
    const sql=db(),a=await auth(request,sql);
    if(a.error)return reply({ok:false,error:a.error},a.status);
    const body=await request.json().catch(()=>({});
    const id=clean(body?.id,80);
    if(!/^[0-9a-f-]{36}$/i.test(id))return reply({ok:false,error:'Invalid ID.'},400);
    const {entry,error}=validate(body);
    if(error)return reply({ok:false,error},400);
    await ensure(sql);
    const by=a.session.displayName||a.session.username;
    const rows=await sql`UPDATE mayavi_admin_account_ledger
      SET month_key=${entry.month},data=${JSON.stringify(entry)}::jsonb,updated_by=${by},updated_at=NOW()
      WHERE id=${id} RETURNING id`;
    if(!rows.length)return reply({ok:false,error:'Account transaction not found.'},404);
    return reply({ok:true,row:await fetchOne(sql,id)});
  }catch(e){return reply({ok:false,error:e?.message||'Update failed.'},503)}
}
export async function DELETE(request){
  try{
    const sql=db(),a=await auth(request,sql);
    if(a.error)return reply({ok:false,error:a.error},a.status);
    const id=new URL(request.url).searchParams.get('id')||'';
    if(!/^[0-9a-f-]{36}$/i.test(id))return reply({ok:false,error:'Invalid ID.'},400);
    await ensure(sql);
    const gone=await sql`DELETE FROM mayavi_admin_account_ledger WHERE id=${id} RETURNING id`;
    return gone.length?reply({ok:true}):reply({ok:false,error:'Account transaction not found.'},404);
  }catch(e){return reply({ok:false,error:e?.message||'Delete failed.'},503)}
}
