import {neon} from '@neondatabase/serverless';
import {readSession} from '../../../lib/mayaviAuth.js';
import {randomUUID} from 'node:crypto';
import {validateExpense,monthRange,indiaDate,expenseSummary} from '../../../lib/personalDailyExpenses.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const reply=(b,status=200)=>Response.json(b,{status,headers:{'Cache-Control':'private, no-store'}});
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
async function access(request){
 const s=readSession(request);if(s?.role!=='admin')return null;
 const db=process.env.DATABASE_URL||process.env.POSTGRES_URL||process.env.NEON_DATABASE_URL||process.env.DATABASE_URL_UNPOOLED;if(!db)throw Error('Database unavailable');
 const sql=neon(db),[u]=await sql`SELECT role,session_version,is_active FROM mayavi_users WHERE lower(username)=${s.username} LIMIT 1`;
 if(!u?.is_active||u.role!=='admin'||Number(u.session_version)!==Number(s.sessionVersion||0))return null;
 await sql`CREATE TABLE IF NOT EXISTS mayavi_personal_daily_expenses (id uuid PRIMARY KEY, owner text NOT NULL, expense_date date NOT NULL, category text NOT NULL, payment_mode text NOT NULL, details text NOT NULL DEFAULT '', remarks text NOT NULL DEFAULT '', paise bigint NOT NULL CHECK(paise>0), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`;
 await sql`CREATE INDEX IF NOT EXISTS mayavi_personal_expenses_owner_date ON mayavi_personal_daily_expenses(owner,expense_date DESC)`;
 return {sql,owner:s.username};
}
export async function GET(request){try{const a=await access(request);if(!a)return reply({ok:false,error:'Admin login required'},403);const month=new URL(request.url).searchParams.get('month')||indiaDate().slice(0,7),range=monthRange(month);if(!range)return reply({ok:false,error:'Invalid month'},400);const rows=(await a.sql`SELECT id,expense_date::text AS date,category,payment_mode AS mode,details,remarks,paise FROM mayavi_personal_daily_expenses WHERE owner=${a.owner} AND expense_date>=${range[0]}::date AND expense_date<${range[1]}::date ORDER BY expense_date DESC,created_at DESC,id`).map(r=>({...r,paise:Number(r.paise)}));return reply({ok:true,rows,month,summary:expenseSummary(rows)});}catch{return reply({ok:false,error:'Personal expense storage unavailable'},503);}}
export async function POST(request){try{const a=await access(request);if(!a)return reply({ok:false,error:'Admin login required'},403);const b=await request.json().catch(()=>null),v=validateExpense(b);if(!v)return reply({ok:false,error:'Enter valid date, category, amount and payment mode'},400);const id=b.id||randomUUID();if(!uuid.test(id))return reply({ok:false,error:'Invalid ID'},400);const rows=b.id?await a.sql`UPDATE mayavi_personal_daily_expenses SET expense_date=${v.date}::date,category=${v.category},payment_mode=${v.mode},details=${v.details},remarks=${v.remarks},paise=${v.paise},updated_at=now() WHERE id=${id}::uuid AND owner=${a.owner} RETURNING id`:await a.sql`INSERT INTO mayavi_personal_daily_expenses(id,owner,expense_date,category,payment_mode,details,remarks,paise) VALUES(${id}::uuid,${a.owner},${v.date}::date,${v.category},${v.mode},${v.details},${v.remarks},${v.paise}) RETURNING id`;return rows.length?reply({ok:true,id}):reply({ok:false,error:'Expense not found'},404);}catch{return reply({ok:false,error:'Expense could not be saved'},503);}}
export async function DELETE(request){try{const a=await access(request);if(!a)return reply({ok:false,error:'Admin login required'},403);const id=new URL(request.url).searchParams.get('id')||'';if(!uuid.test(id))return reply({ok:false,error:'Invalid ID'},400);const rows=await a.sql`DELETE FROM mayavi_personal_daily_expenses WHERE id=${id}::uuid AND owner=${a.owner} RETURNING id`;return rows.length?reply({ok:true}):reply({ok:false,error:'Expense not found'},404);}catch{return reply({ok:false,error:'Expense could not be deleted'},503);}}
