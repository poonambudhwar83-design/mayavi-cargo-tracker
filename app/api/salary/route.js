import { randomUUID } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { readSession } from '../../../lib/mayaviAuth.js';
import { salaryMonth, salaryAmount, salaryTotals } from '../../../lib/salaryMath.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const reply=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store, private'}});
function adminOnly(request){const session=readSession(request);return session?.role==='admin'?session:null;}
function sqlClient(){
  const url=process.env.DATABASE_URL||process.env.POSTGRES_URL||
    process.env.NEON_DATABASE_URL||process.env.DATABASE_URL_UNPOOLED||'';
  if(!url)throw new Error('Mayavi shared database is not configured.');
  return neon(url);
}
async function ensure(sql){
  await sql`CREATE TABLE IF NOT EXISTS mayavi_salary_employees(
    id UUID PRIMARY KEY,
    employee_name TEXT NOT NULL,
    normalized_name TEXT NOT NULL UNIQUE,
    default_salary NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK(default_salary>=0),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS mayavi_salary_monthly(
    employee_id UUID NOT NULL REFERENCES mayavi_salary_employees(id),
    salary_month CHAR(7) NOT NULL CHECK(salary_month ~ '^[0-9]{4}-[0-9]{2}$'),
    salary_amount NUMERIC(14,2) NOT NULL CHECK(salary_amount>=0),
    cash_paid NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK(cash_paid>=0),
    account_paid NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK(account_paid>=0),
    updated_by TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY(employee_id,salary_month)
  )`;
}
function normalizedEmployee(value){return String(value||'').trim().replace(/\s+/g,' ');}
export async function GET(request){
  if(!adminOnly(request))return reply({ok:false,error:'Admin authorization required.'},403);
  const month=salaryMonth(new URL(request.url).searchParams.get('month'));
  if(!month)return reply({ok:false,error:'Enter a valid salary month.'},400);
  try{
    const sql=sqlClient();await ensure(sql);
    const entries=await sql`SELECT e.id,e.employee_name,
        COALESCE(m.salary_amount,e.default_salary) AS salary_amount,
        COALESCE(m.cash_paid,0) AS cash_paid,
        COALESCE(m.account_paid,0) AS account_paid,
        m.updated_at, m.updated_by
      FROM mayavi_salary_employees e
      LEFT JOIN mayavi_salary_monthly m ON m.employee_id=e.id AND m.salary_month=${month}
      WHERE e.is_active=TRUE
      ORDER BY lower(e.employee_name),e.id`;
    const rows=entries.map(row=>({
      id:String(row.id),employeeName:row.employee_name,
      salaryAmount:Number(row.salary_amount),cashPaid:Number(row.cash_paid),
      accountPaid:Number(row.account_paid),updatedAt:row.updated_at||null,updatedBy:row.updated_by||''
    }));
    return reply({ok:true,month,rows,totals:salaryTotals(rows)});
  }catch(error){return reply({ok:false,error:error?.message||'Could not load Salary page.'},503);}
}
export async function POST(request){
  const admin=adminOnly(request);
  if(!admin)return reply({ok:false,error:'Admin authorization required.'},403);
  try{
    const data=await request.json().catch(()=>({}));
    const action=String(data.action||'');
    const sql=sqlClient();await ensure(sql);
    if(action==='add_employee'){
      const name=normalizedEmployee(data.employeeName);
      if(name.length<2||name.length>100)return reply({ok:false,error:'Enter an employee name (2–100 characters).'},400);
      const amount=salaryAmount(data.salaryAmount);
      if(amount===null)return reply({ok:false,error:'Enter a valid monthly salary (₹0 or more).'},400);
      const id=randomUUID(),key=name.toLocaleLowerCase('en-IN');
      const created=await sql`INSERT INTO mayavi_salary_employees(id,employee_name,normalized_name,default_salary)
        VALUES(${id}::uuid,${name},${key},${amount})
        ON CONFLICT(normalized_name) DO NOTHING RETURNING id,employee_name`;
      if(!created.length)return reply({ok:false,error:'This employee is already added.'},409);
      return reply({ok:true,message:name+' added to the Salary page.',id});
    }
    if(action==='save_month'){
      const id=String(data.employeeId||'');
      const month=salaryMonth(data.month);
      if(!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(id)||!month)
        return reply({ok:false,error:'Select a valid employee and salary month.'},400);
      const salary=salaryAmount(data.salaryAmount);
      const cash=salaryAmount(data.cashPaid);
      const account=salaryAmount(data.accountPaid);
      if(salary===null||cash===null||account===null)
        return reply({ok:false,error:'Enter valid non-negative rupee amounts (up to 2 decimals).'},400);
      const matching=await sql`SELECT id,employee_name FROM mayavi_salary_employees
        WHERE id=${id}::uuid AND is_active=TRUE LIMIT 1`;
      if(!matching.length)return reply({ok:false,error:'Employee was not found.'},404);
      await sql`INSERT INTO mayavi_salary_monthly(employee_id,salary_month,salary_amount,cash_paid,account_paid,updated_by)
        VALUES (${id}::uuid,${month},${salary},${cash},${account},${admin.username})
        ON CONFLICT(employee_id,salary_month) DO UPDATE
        SET salary_amount=EXCLUDED.salary_amount,cash_paid=EXCLUDED.cash_paid,
            account_paid=EXCLUDED.account_paid,updated_by=EXCLUDED.updated_by,updated_at=now()`;
      return reply({ok:true,message:matching[0].employee_name+' salary saved for '+month,
        row:{id,employeeName:matching[0].employee_name,salaryAmount:salary,cashPaid:cash,accountPaid:account}});
    }
    return reply({ok:false,error:'Invalid salary action.'},400);
  }catch(error){return reply({ok:false,error:error?.message||'Unable to save salary details.'},503);}
}
