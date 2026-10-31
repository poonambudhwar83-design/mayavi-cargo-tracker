import {randomUUID} from 'node:crypto';
import {neon} from '@neondatabase/serverless';
import {readSession} from '../../../lib/mayaviAuth.js';
import {dateValid,totalBranchForLoad} from '../../../lib/branchLoads.js';
import {selectedProfitMonth} from '../../../lib/profitPeriod.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const reply=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
const categories=['SALARY','RENT','ELECTRICITY','PETROL','PAPER','STATIONERY','MISC'];
function database(){
  const url=process.env.DATABASE_URL||process.env.POSTGRES_URL||process.env.NEON_DATABASE_URL||process.env.DATABASE_URL_UNPOOLED||'';
  if(!url)throw new Error('Mayavi shared database is not configured.');
  return neon(url);
}
async function adminOnly(request,sql){
  const session=readSession(request);
  if(session?.role!=='admin')return null;
  const [user]=await sql`SELECT username,role,is_active,branch_scope,session_version FROM mayavi_users WHERE lower(username)=${session.username} LIMIT 1`;
  if(!user||user.role!=='admin'||!user.is_active||user.branch_scope==='HARYANA'||Number(user.session_version)!==Number(session.sessionVersion||0))return null;
  return session;
}
async function ensure(sql){
  await sql`CREATE TABLE IF NOT EXISTS mayavi_branch_expenses(
    id UUID PRIMARY KEY,
    branch TEXT NOT NULL CHECK(branch IN ('JIND','KARNAL')),
    expense_date DATE NOT NULL,
    category TEXT NOT NULL CHECK(category IN ('SALARY','RENT','ELECTRICITY','PETROL','PAPER','STATIONERY','MISC')),
    description VARCHAR(160) NOT NULL DEFAULT '',
    amount NUMERIC(14,2) NOT NULL CHECK(amount>=0),
    created_by TEXT NOT NULL DEFAULT '',
    updated_by TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS mayavi_branch_expenses_month_idx ON mayavi_branch_expenses(branch,expense_date DESC)`;
}
function parseEntry(raw={}){
  const branch=String(raw.branch||'').toUpperCase().trim();
  const date=String(raw.date||'').trim();
  const category=String(raw.category||'').toUpperCase().trim();
  const description=String(raw.description||'').trim().replace(/\s+/g,' ').slice(0,160);
  const rawAmount=String(raw.amount??'').trim();
  if(!['JIND','KARNAL'].includes(branch))return {error:'Choose Jind or Karnal.'};
  if(!dateValid(date))return {error:'Enter a valid expense date.'};
  if(!selectedProfitMonth(date.slice(0,7)))return {error:'Choose an expense date from October 2026 through the current month.'};
  if(!categories.includes(category))return {error:'Select an expense head.'};
  if(!/^(?:0|[1-9]\d{0,10})(?:\.\d{1,2})?$/.test(rawAmount)||!Number.isFinite(Number(rawAmount))||Number(rawAmount)<=0)return {error:'Enter an expense amount greater than zero, with up to two decimals.'};
  if((category==='SALARY'||category==='MISC')&&!description)return {error:category==='SALARY'?'Enter the worker name.':'Enter a miscellaneous expense description.'};
  return {entry:{branch,date,category,description,amount:Number(rawAmount)}};
}
function sumMoney(a,b){return Math.round((Number(a||0)+Number(b||0)+Number.EPSILON)*100)/100;}
function viewExpense(row){return {
  id:row.id,branch:row.branch,date:row.expense_date,category:row.category,
  description:row.description,amount:Number(row.amount),
  createdBy:row.created_by,updatedBy:row.updated_by,updatedAt:row.updated_at
};}
async function getData(sql,month){
  const incomes={JIND:0,KARNAL:0};
  // Booked branch share, not cash received. Include all loads regardless of delivery status.
  // Apply the same legacy-compatible commodity/extra-cost formula used by the load page.
  const loads=await sql`SELECT branch,amount,paid_to_jepo,paid_to_branch,commodity,extra_cost,bottle_count
    FROM mayavi_branch_loads WHERE record_date>=${month+'-01'}::date
      AND record_date<(${month+'-01'}::date+INTERVAL '1 month')`;
  for(const load of loads){
    if(!Object.hasOwn(incomes,load.branch))continue;
    const calculated=totalBranchForLoad(load.amount,load.paid_to_jepo,load.commodity,load.extra_cost,load.bottle_count,{legacy:true});
    const amount=calculated===null?Number(load.paid_to_branch||0):calculated;
    incomes[load.branch]=sumMoney(incomes[load.branch],amount);
  }
  const saved=await sql`SELECT id::text AS id,branch,to_char(expense_date,'YYYY-MM-DD') AS expense_date,
    category,description,amount,created_by,updated_by,updated_at
    FROM mayavi_branch_expenses WHERE expense_date>=${month+'-01'}::date
    AND expense_date<(${month+'-01'}::date+INTERVAL '1 month')
    ORDER BY expense_date DESC,created_at DESC,id DESC`;
  return {incomes,expenses:saved.map(viewExpense)};
}
export async function GET(request){
  try{
    const sql=database();
    if(!await adminOnly(request,sql))return reply({ok:false,error:'Only the main Admin can view Branch Profit & Loss.'},403);
    const month=selectedProfitMonth(new URL(request.url).searchParams.get('month'));
    if(!month)return reply({ok:false,error:'Select a month from October 2026 onwards.'},400);
    await ensure(sql);
    return reply({ok:true,month,...await getData(sql,month)});
  }catch(e){return reply({ok:false,error:e?.message||'Unable to load branch profit.'},503);}
}
export async function POST(request){
  try{
    const sql=database(),admin=await adminOnly(request,sql);
    if(!admin)return reply({ok:false,error:'Only the main Admin can save branch expenses.'},403);
    const parsed=parseEntry(await request.json());
    if(parsed.error)return reply({ok:false,error:parsed.error},400);
    await ensure(sql);
    const {branch,date,category,description,amount}=parsed.entry;
    const id=randomUUID();
    await sql`INSERT INTO mayavi_branch_expenses(id,branch,expense_date,category,description,amount,created_by,updated_by)
      VALUES (${id}::uuid,${branch},${date}::date,${category},${description},${amount},${admin.username},${admin.username})`;
    return reply({ok:true,id});
  }catch(e){return reply({ok:false,error:e?.message||'Unable to save expense.'},503);}
}
export async function PATCH(request){
  try{
    const sql=database(),admin=await adminOnly(request,sql);
    if(!admin)return reply({ok:false,error:'Only the main Admin can edit branch expenses.'},403);
    const body=await request.json(),id=String(body.id||'');
    if(!/^[0-9a-f-]{36}$/i.test(id))return reply({ok:false,error:'Invalid expense entry.'},400);
    const parsed=parseEntry(body);
    if(parsed.error)return reply({ok:false,error:parsed.error},400);
    await ensure(sql);
    const {branch,date,category,description,amount}=parsed.entry;
    const changed=await sql`UPDATE mayavi_branch_expenses
      SET branch=${branch},expense_date=${date}::date,category=${category},
        description=${description},amount=${amount},updated_by=${admin.username},updated_at=now()
      WHERE id=${id}::uuid RETURNING id`;
    return changed.length?reply({ok:true,id}):reply({ok:false,error:'Expense not found.'},404);
  }catch(e){return reply({ok:false,error:e?.message||'Unable to edit expense.'},503);}
}
export async function DELETE(request){
  try{
    const sql=database(),admin=await adminOnly(request,sql);
    if(!admin)return reply({ok:false,error:'Only the main Admin can delete branch expenses.'},403);
    const id=String(new URL(request.url).searchParams.get('id')||'');
    if(!/^[0-9a-f-]{36}$/i.test(id))return reply({ok:false,error:'Invalid expense entry.'},400);
    await ensure(sql);
    const changed=await sql`DELETE FROM mayavi_branch_expenses WHERE id=${id}::uuid RETURNING id`;
    return changed.length?reply({ok:true,id}):reply({ok:false,error:'Expense not found.'},404);
  }catch(e){return reply({ok:false,error:e?.message||'Unable to delete expense.'},503);}
}
