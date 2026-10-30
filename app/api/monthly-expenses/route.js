import {neon} from '@neondatabase/serverless';
import {readSession} from '../../../lib/mayaviAuth.js';
import {selectedProfitMonth} from '../../../lib/profitPeriod.js';
import {GET as getImportProfit} from '../import-profit/route.js';
import {GET as getExportProfit} from '../export-profit/route.js';
import {GET as getSalary} from '../salary/route.js';
import {sumMonthlyImport,sumMonthlyExport,calculateMonthlyExpenses,monthlyAmount} from '../../../lib/monthlyExpenses.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store, private'}});
function adminOnly(request){return readSession(request)?.role==='admin';}
function database(){
  const url=process.env.DATABASE_URL||process.env.POSTGRES_URL||
    process.env.NEON_DATABASE_URL||process.env.DATABASE_URL_UNPOOLED||'';
  if(!url)throw new Error('Mayavi shared database is not configured.');
  return neon(url);
}
async function ensure(sql){
  await sql`CREATE TABLE IF NOT EXISTS mayavi_monthly_expenses(
    expense_month CHAR(7) PRIMARY KEY,
    rent NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK(rent>=0),
    office_expenses NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK(office_expenses>=0),
    updated_by TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
}
async function requireMonthlyApi(response,label){
  const data=await response.json();
  if(!response.ok||!data.ok)throw new Error(label+': '+(data.error||'Unable to load values.'));
  return data;
}
export async function GET(request){
  if(!adminOnly(request))return json({ok:false,error:'Admin authorization required.'},403);
  const month=selectedProfitMonth(new URL(request.url).searchParams.get('month'));
  if(!month)return json({ok:false,error:'Choose a profit month from October 2026 onwards.'},400);
  try{
    const sql=database();
    await ensure(sql);
    // Reuse the same month filters and physical rows as the two live Profit sheets.
    // Reuse Salary API values to avoid counting planned-but-unpaid salaries.
    const internalUrl=(name)=>new Request('https://mayavi.local/api/'+name+'?month='+encodeURIComponent(month),
      {headers:request.headers});
    const [imports,exports,salaries,branches,stored]=await Promise.all([
      getImportProfit(internalUrl('import-profit')).then(r=>requireMonthlyApi(r,'Import Profit Sheet')),
      getExportProfit(internalUrl('export-profit')).then(r=>requireMonthlyApi(r,'Export Profit Sheet')),
      getSalary(internalUrl('salary')).then(r=>requireMonthlyApi(r,'Salary page')),
      sql`SELECT
        COALESCE(SUM(amount) FILTER (WHERE branch='JIND'),0) AS jind,
        COALESCE(SUM(amount) FILTER (WHERE branch='KARNAL'),0) AS karnal
        FROM mayavi_branch_loads
        WHERE record_date>=${month+'-01'}::date
          AND record_date<(${month+'-01'}::date+INTERVAL '1 month')`,
      sql`SELECT rent,office_expenses,updated_at,updated_by
        FROM mayavi_monthly_expenses WHERE expense_month=${month} LIMIT 1`
    ]);
    const importTotals=sumMonthlyImport(imports.rows||[]);
    const exportTotals=sumMonthlyExport(exports.rows||[]);
    const jind=Number(branches[0]?.jind||0),karnal=Number(branches[0]?.karnal||0);
    const salaryCash=Number(salaries.totals?.cash||0);
    const salaryAccount=Number(salaries.totals?.account||0);
    const rent=Number(stored[0]?.rent||0);
    const office=Number(stored[0]?.office_expenses||0);
    const results=calculateMonthlyExpenses({
      importGross:importTotals.grossProfit,exportGross:exportTotals.grossProfit,
      jind,karnal,goods15:importTotals.goodsCharge15Percent,
      salaryCash,salaryAccount,rent,office
    });
    return json({ok:true,month,values:{
      importGross:importTotals.grossProfit,exportGross:exportTotals.grossProfit,
      jind,karnal,goods15:importTotals.goodsCharge15Percent,
      salaryCash,salaryAccount,salaryBudget:Number(salaries.totals?.monthlySalary||0),
      rent,office
    },results,
      source:{import:importTotals,export:exportTotals,salaryEmployees:salaries.rows?.length||0},
      updatedAt:stored[0]?.updated_at||null,updatedBy:stored[0]?.updated_by||''});
  }catch(error){return json({ok:false,error:error?.message||'Unable to load Monthly Expenses & Profit.'},503);}
}
export async function PATCH(request){
  if(!adminOnly(request))return json({ok:false,error:'Admin authorization required.'},403);
  try{
    const body=await request.json().catch(()=>({}));
    const month=selectedProfitMonth(body.month);
    if(!month)return json({ok:false,error:'Choose a valid monthly accounting period.'},400);
    const rent=monthlyAmount(body.rent),office=monthlyAmount(body.office);
    if(rent===null||office===null)
      return json({ok:false,error:'Enter valid non-negative Rent and Office Expenses (up to 2 decimals).'},400);
    const sql=database();await ensure(sql);
    const session=readSession(request);
    const records=await sql`INSERT INTO mayavi_monthly_expenses
      (expense_month,rent,office_expenses,updated_by)
      VALUES(${month},${rent},${office},${session.username})
      ON CONFLICT(expense_month) DO UPDATE
        SET rent=EXCLUDED.rent,office_expenses=EXCLUDED.office_expenses,
            updated_by=EXCLUDED.updated_by,updated_at=now()
      RETURNING rent,office_expenses,updated_at`;
    return json({ok:true,month,rent:Number(records[0].rent),office:Number(records[0].office_expenses),
      updatedAt:records[0].updated_at,message:'Rent and Office Expenses saved for '+month+'.'});
  }catch(error){return json({ok:false,error:error?.message||'Unable to save Monthly Expenses.'},503);}
}
