import {randomUUID} from 'node:crypto';
import {neon} from '@neondatabase/serverless';
import {libraryAccessSession} from '../../../lib/mayaviAuth.js';
import {libraryDate,libraryMoney,libraryTodayIST} from '../../../lib/libraryManagement.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const LIBRARY_EXPENSE_HEADS=['Salary','Stationery','Daily Utilities','Rent','Electricity Bill','Misc','Misc for Home'];
const reply=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store, private'}});
const libraryOnly=request=>libraryAccessSession(request);
const validId=value=>/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(String(value||''));
function sqlClient(){
 const url=process.env.DATABASE_URL||process.env.POSTGRES_URL||process.env.NEON_DATABASE_URL||process.env.DATABASE_URL_UNPOOLED;
 if(!url)throw Error('Mayavi database unavailable.');
 return neon(url);
}
async function ensureTable(sql){
 await sql.query("CREATE TABLE IF NOT EXISTS mayavi_library_expenses(id UUID PRIMARY KEY,expense_date DATE NOT NULL,expense_head TEXT NOT NULL,amount NUMERIC(14,2) NOT NULL CHECK(amount>=0),remarks TEXT NOT NULL DEFAULT '',created_by TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
 await sql.query("CREATE INDEX IF NOT EXISTS mayavi_library_expenses_date_idx ON mayavi_library_expenses(expense_date)");
}
const map=row=>({id:String(row.id),date:row.expense_date,head:row.expense_head,amount:Number(row.amount),remarks:row.remarks||'',createdAt:row.created_at});
function validPayload(body){
 const date=libraryDate(body.date),head=String(body.head||''),amount=libraryMoney(body.amount);
 if(!date)return {error:'Enter a valid expense date.'};
 if(date>libraryTodayIST())return {error:'Future dates cannot be recorded as paid expenses.'};
 if(!LIBRARY_EXPENSE_HEADS.includes(head))return {error:'Select an expense head.'};
 if(amount===null||amount<=0)return {error:'Expense amount must be greater than zero.'};
 return {date,head,amount,remarks:String(body.remarks??'').trim().slice(0,600)};
}
export async function GET(request){
 if(!libraryOnly(request))return reply({ok:false,error:'Admin or Library user only.'},403);
 const month=new URL(request.url).searchParams.get('month');
 if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(String(month||'')))return reply({ok:false,error:'Select a valid month.'},400);
 try{
  const sql=sqlClient();await ensureTable(sql);
  const rows=await sql.query("SELECT id,to_char(expense_date,'YYYY-MM-DD') AS expense_date,expense_head,amount,remarks,created_at FROM mayavi_library_expenses WHERE expense_date >= $1::date AND expense_date < ($1::date + INTERVAL '1 month') ORDER BY expense_date DESC,created_at DESC",[month+'-01']);
  return reply({ok:true,month,heads:LIBRARY_EXPENSE_HEADS,expenses:rows.map(map)});
 }catch(error){
  console.error('library_expenses_get',String(error?.message||error).slice(0,240));
  return reply({ok:false,error:'Library expenses could not load.'},503);
 }
}
export async function POST(request){
 const operator=libraryOnly(request);if(!operator)return reply({ok:false,error:'Admin or Library user only.'},403);
 const body=await request.json().catch(()=>({}));
 const action=String(body.action||'');
 if(!['save','delete'].includes(action))return reply({ok:false,error:'Unknown expense action.'},400);
 try{
  const sql=sqlClient();await ensureTable(sql);
  if(action==='delete'){
   if(!validId(body.id)||body.confirm!==true)return reply({ok:false,error:'Select and confirm the expense to remove.'},400);
   const removed=await sql.query('DELETE FROM mayavi_library_expenses WHERE id=$1::uuid RETURNING id',[body.id]);
   if(!removed.length)return reply({ok:false,error:'Expense no longer exists.'},404);
   return reply({ok:true,message:'Expense deleted.'});
  }
  const values=validPayload(body);
  if(values.error)return reply({ok:false,error:values.error},400);
  const {date,head,amount,remarks}=values;
  if(body.id){
   if(!validId(body.id))return reply({ok:false,error:'Invalid expense record.'},400);
   const saved=await sql.query('UPDATE mayavi_library_expenses SET expense_date=$2::date,expense_head=$3,amount=$4,remarks=$5,updated_at=NOW() WHERE id=$1::uuid RETURNING id',[body.id,date,head,amount,remarks]);
   if(!saved.length)return reply({ok:false,error:'Expense not found.'},404);
   return reply({ok:true,message:'Expense updated.'});
  }
  const id=randomUUID();
  await sql.query('INSERT INTO mayavi_library_expenses(id,expense_date,expense_head,amount,remarks,created_by) VALUES ($1::uuid,$2::date,$3,$4,$5,$6)',[id,date,head,amount,remarks,operator.username||'haryana']);
  return reply({ok:true,id,message:'Library expense saved.'});
 }catch(error){
  console.error('library_expenses_post',String(error?.message||error).slice(0,240));
  return reply({ok:false,error:'Unable to save library expense.'},503);
 }
}
