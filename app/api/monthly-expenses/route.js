import {neon} from '@neondatabase/serverless';
import {randomUUID} from 'node:crypto';
import {readSession} from '../../../lib/mayaviAuth.js';
import {branchPayoutForRecord} from '../../../lib/branchLoads.js';
import {speedPostProfitTotals} from '../../../lib/speedpostMonthlyProfit.js';
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
    rooms_expenses NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK(rooms_expenses>=0),
    misc_expenses NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK(misc_expenses>=0),
    rent_saved_at TIMESTAMPTZ,
    office_saved_at TIMESTAMPTZ,
    rooms_saved_at TIMESTAMPTZ,
    misc_saved_at TIMESTAMPTZ,
    updated_by TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  // Non-destructive migration: all previously saved Rent and Office Expenses stay intact.
  await sql`ALTER TABLE mayavi_monthly_expenses ADD COLUMN IF NOT EXISTS rooms_expenses NUMERIC(14,2) NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE mayavi_monthly_expenses ADD COLUMN IF NOT EXISTS misc_expenses NUMERIC(14,2) NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE mayavi_monthly_expenses ADD COLUMN IF NOT EXISTS rent_saved_at TIMESTAMPTZ`;
  await sql`ALTER TABLE mayavi_monthly_expenses ADD COLUMN IF NOT EXISTS office_saved_at TIMESTAMPTZ`;
  await sql`ALTER TABLE mayavi_monthly_expenses ADD COLUMN IF NOT EXISTS rooms_saved_at TIMESTAMPTZ`;
  await sql`ALTER TABLE mayavi_monthly_expenses ADD COLUMN IF NOT EXISTS misc_saved_at TIMESTAMPTZ`;
  // Itemized Misc remarks preserve a clear reason for every NEW expense.
  // Historic mayavi_monthly_expenses.misc_expenses is not moved or reset.
  await sql`CREATE TABLE IF NOT EXISTS mayavi_monthly_misc_entries(
    id UUID PRIMARY KEY,
    expense_month CHAR(7) NOT NULL,
    amount NUMERIC(14,2) NOT NULL CHECK(amount>=0),
    remarks VARCHAR(120) NOT NULL CHECK(length(trim(remarks))>0),
    created_by TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS mayavi_monthly_misc_entries_month_idx
    ON mayavi_monthly_misc_entries(expense_month,created_at DESC)`;
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
    // Load Rent and Office Expenses independently of Import/Export tracking:
    // these entries must remain editable when an external profit source fails.
    if(new URL(request.url).searchParams.get('view')==='expenses'){
      const saved=await sql`SELECT rent,office_expenses,rooms_expenses,misc_expenses,
          rent_saved_at,office_saved_at,rooms_saved_at,misc_saved_at,updated_at,updated_by
        FROM mayavi_monthly_expenses WHERE expense_month=${month} LIMIT 1`;
      const row=saved[0]||{};
      const miscEntries=await sql`SELECT id::text AS id,remarks,amount,created_by,created_at
        FROM mayavi_monthly_misc_entries
        WHERE expense_month=${month}
        ORDER BY created_at DESC,id DESC`;
      return json({ok:true,month,miscEntries:miscEntries.map(entry=>({
        id:entry.id,remarks:entry.remarks,amount:Number(entry.amount),
        createdBy:entry.created_by,createdAt:entry.created_at
      })),rent:Number(row.rent||0),office:Number(row.office_expenses||0),
        rooms:Number(row.rooms_expenses||0),misc:Number(row.misc_expenses||0),
        savedFields:{
          rent:Boolean(row.rent_saved_at||(!row.rent_saved_at&&row.updated_at&&Number(row.rent||0)!==0)),
          office:Boolean(row.office_saved_at||(!row.office_saved_at&&row.updated_at&&Number(row.office_expenses||0)!==0)),
          rooms:Boolean(row.rooms_saved_at),misc:Boolean(row.misc_saved_at)
        },
        updatedAt:row.updated_at||null,updatedBy:row.updated_by||''});
    }
    // Reuse the same month filters and physical rows as the two live Profit sheets.
    // Reuse Salary API values to avoid counting planned-but-unpaid salaries.
    const internalUrl=(name)=>new Request('https://mayavi.local/api/'+name+'?month='+encodeURIComponent(month),
      {headers:request.headers});
    const [imports,exports,salaries,branches,stored,speedPostEntries]=await Promise.all([
      getImportProfit(internalUrl('import-profit')).then(r=>requireMonthlyApi(r,'Import Profit Sheet')),
      getExportProfit(internalUrl('export-profit')).then(r=>requireMonthlyApi(r,'Export Profit Sheet')),
      getSalary(internalUrl('salary')).then(r=>requireMonthlyApi(r,'Salary page')),
      sql`SELECT branch,amount,paid_to_jepo,paid_to_branch,extra_cost,commodity,bottle_count
        FROM mayavi_branch_loads
        WHERE record_date>=${month+'-01'}::date
          AND record_date<(${month+'-01'}::date+INTERVAL '1 month')`,
      sql`SELECT rent,office_expenses,rooms_expenses,misc_expenses,updated_at,updated_by
        FROM mayavi_monthly_expenses WHERE expense_month=${month} LIMIT 1`,
      // Same source as Speed Post page; month is original India-time ED entry month.
      sql`SELECT tracking_no,data,created_at FROM mayavi_speedpost
        WHERE created_at >= (${month+'-01'}::timestamp AT TIME ZONE 'Asia/Kolkata')
          AND created_at < ((${month+'-01'}::timestamp + INTERVAL '1 month') AT TIME ZONE 'Asia/Kolkata')`
    ]);
    const importTotals=sumMonthlyImport(imports.rows||[]);
    const speedPostTotals=speedPostProfitTotals(speedPostEntries.map(row=>({
      ...row.data,trackingNo:row.tracking_no,createdAt:row.created_at
    }))).totals;
    // Speed Post net profit already deducts Tariff, Cash and ₹10/kg packing.
    const speedPost=speedPostTotals.profit;
    const exportTotals=sumMonthlyExport(exports.rows||[]);
    // Exactly match the Branch Loads page's "Amount Paid to Branch" column.
    // Use the authoritative derived payout, including branch share of Extra Cost
    // and the legacy calculation rules. NEVER sum the total booking amount here.
    const payout={JIND:0,KARNAL:0};
    for(const row of branches){
      const branch=String(row.branch||'').toUpperCase();
      if(!Object.hasOwn(payout,branch))continue;
      const amount=branchPayoutForRecord({
        amount:row.amount,paidToJepo:row.paid_to_jepo,paidToBranch:row.paid_to_branch,
        commodity:row.commodity,extraCost:row.extra_cost,bottleCount:row.bottle_count
      });
      payout[branch]=Math.round((payout[branch]+amount)*100)/100;
    }
    const jind=payout.JIND,karnal=payout.KARNAL;
    const salaryCash=Number(salaries.totals?.cash||0);
    const salaryAccount=Number(salaries.totals?.account||0);
    const rent=Number(stored[0]?.rent||0);
    const office=Number(stored[0]?.office_expenses||0);
    const rooms=Number(stored[0]?.rooms_expenses||0);
    const misc=Number(stored[0]?.misc_expenses||0);
    const results=calculateMonthlyExpenses({
      importGross:importTotals.grossProfit,exportGross:exportTotals.grossProfit,
      jind,karnal,goods15:importTotals.goodsCharge15Percent,speedPost,
      salaryCash,salaryAccount,rent,office,rooms,misc
    });
    return json({ok:true,month,values:{
      importGross:importTotals.grossProfit,exportGross:exportTotals.grossProfit,
      jind,karnal,goods15:importTotals.goodsCharge15Percent,speedPost,
      salaryCash,salaryAccount,salaryBudget:Number(salaries.totals?.monthlySalary||0),
      rent,office,rooms,misc
    },results,
      source:{import:importTotals,export:exportTotals,speedPost:speedPostTotals,salaryEmployees:salaries.rows?.length||0},
      updatedAt:stored[0]?.updated_at||null,updatedBy:stored[0]?.updated_by||''});
  }catch(error){return json({ok:false,error:error?.message||'Unable to load Monthly Expenses & Profit.'},503);}
}
export async function PATCH(request){
  if(!adminOnly(request))return json({ok:false,error:'Admin authorization required.'},403);
  try{
    const body=await request.json().catch(()=>({}));
    const month=selectedProfitMonth(body.month);
    if(!month)return json({ok:false,error:'Choose a valid monthly accounting period.'},400);
    const field=String(body.field||'');
    if(field==='edit_misc'){
      // Optimistic comparison prevents one Admin session from silently
      // replacing a different session's already revised entry.
      const id=String(body.id||'').trim();
      const amount=monthlyAmount(body.value);
      const previousAmount=monthlyAmount(body.previousAmount);
      const remarks=String(body.remarks??'').trim().replace(/\s+/g,' ');
      const previousRemarks=String(body.previousRemarks??'').trim().replace(/\s+/g,' ');
      if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))
        return json({ok:false,error:'Select a valid saved Miscellaneous entry.'},400);
      if(amount===null||previousAmount===null)
        return json({ok:false,error:'Enter a valid non-negative amount (up to 2 decimals).'},400);
      if(!remarks||remarks.length>120||!previousRemarks||previousRemarks.length>120)
        return json({ok:false,error:'Enter valid Miscellaneous Remarks (1–120 characters).'},400);
      const sql=database();await ensure(sql);
      const session=readSession(request);
      // A correction changes only the selected saved entry. Its monthly
      // expense total changes by NEW − OLD (it must never count twice).
      // Both updates happen in the same PostgreSQL statement/transaction.
      const corrected=await sql`WITH edited AS (
        UPDATE mayavi_monthly_misc_entries
          SET amount=${amount},remarks=${remarks}
          WHERE id=${id}::uuid AND expense_month=${month}
            AND amount=${previousAmount} AND remarks=${previousRemarks}
            AND EXISTS(SELECT 1 FROM mayavi_monthly_expenses
              WHERE expense_month=${month})
          RETURNING id,amount,remarks,created_at
      ), adjusted AS (
        UPDATE mayavi_monthly_expenses
          SET misc_expenses=mayavi_monthly_expenses.misc_expenses+
            (${amount}::numeric-${previousAmount}::numeric),
            updated_by=${session.username},updated_at=now(),misc_saved_at=now()
          WHERE expense_month=${month} AND EXISTS(SELECT 1 FROM edited)
          RETURNING misc_expenses
      )
      SELECT adjusted.misc_expenses AS total,edited.id::text AS id,
        edited.amount,edited.remarks,edited.created_at
      FROM edited CROSS JOIN adjusted`;
      if(!corrected.length)
        return json({ok:false,error:'This Miscellaneous entry was changed or is no longer available. Refresh the month and try again.'},409);
      const result=corrected[0];
      return json({ok:true,month,field,value:Number(result.total),
        difference:Math.round((amount-previousAmount)*100)/100,
        entry:{id:result.id,amount:Number(result.amount),remarks:result.remarks,
          createdAt:result.created_at},
        message:'Miscellaneous entry updated for '+month+'.'});
    }
    if(['rent','office','rooms','misc'].includes(field)){
      const amount=monthlyAmount(body.value);
      if(amount===null)return json({ok:false,error:'Enter a valid non-negative amount (up to 2 decimals).'},400);
      const sql=database();await ensure(sql);
      const session=readSession(request);
      let saved;
      // Each Save adds one new expense to the selected month's existing total.
      // Category totals are updated atomically so simultaneous entries are not lost.
      // Saving one category never changes the other categories or historic months.
      if(field==='rent')saved=await sql`INSERT INTO mayavi_monthly_expenses
        (expense_month,rent,rent_saved_at,updated_by)
        VALUES(${month},${amount},now(),${session.username})
        ON CONFLICT(expense_month) DO UPDATE
          SET rent=mayavi_monthly_expenses.rent+EXCLUDED.rent,rent_saved_at=now(),updated_by=EXCLUDED.updated_by,updated_at=now()
        RETURNING rent AS amount`;
      else if(field==='office')saved=await sql`INSERT INTO mayavi_monthly_expenses
        (expense_month,office_expenses,office_saved_at,updated_by)
        VALUES(${month},${amount},now(),${session.username})
        ON CONFLICT(expense_month) DO UPDATE
          SET office_expenses=mayavi_monthly_expenses.office_expenses+EXCLUDED.office_expenses,office_saved_at=now(),updated_by=EXCLUDED.updated_by,updated_at=now()
        RETURNING office_expenses AS amount`;
      else if(field==='rooms')saved=await sql`INSERT INTO mayavi_monthly_expenses
        (expense_month,rooms_expenses,rooms_saved_at,updated_by)
        VALUES(${month},${amount},now(),${session.username})
        ON CONFLICT(expense_month) DO UPDATE
          SET rooms_expenses=mayavi_monthly_expenses.rooms_expenses+EXCLUDED.rooms_expenses,rooms_saved_at=now(),updated_by=EXCLUDED.updated_by,updated_at=now()
        RETURNING rooms_expenses AS amount`;
      else {
        const remarks=String(body.remarks??'').trim().replace(/\s+/g,' ');
        if(!remarks||remarks.length>120)
          return json({ok:false,error:'Enter Miscellaneous Remarks (1–120 characters), e.g. SIIB Monthly.'},400);
        // ONE atomic SQL statement: either the itemized remark AND its amount
        // are saved together, or neither is committed. Other expense heads
        // and historic monthly Misc totals remain untouched.
        const id=randomUUID();
        const result=await sql`WITH added AS (
          INSERT INTO mayavi_monthly_misc_entries(id,expense_month,amount,remarks,created_by)
          VALUES(${id}::uuid,${month},${amount},${remarks},${session.username})
          RETURNING id,remarks,amount,created_at
        ), updated AS (
          INSERT INTO mayavi_monthly_expenses
            (expense_month,misc_expenses,misc_saved_at,updated_by)
          SELECT ${month},added.amount,now(),${session.username}
            FROM added WHERE TRUE
          ON CONFLICT(expense_month) DO UPDATE
            SET misc_expenses=mayavi_monthly_expenses.misc_expenses+EXCLUDED.misc_expenses,misc_saved_at=now(),updated_by=EXCLUDED.updated_by,updated_at=now()
          RETURNING misc_expenses
        )
        SELECT updated.misc_expenses AS amount,added.id::text AS id,
          added.remarks,added.amount AS added,added.created_at
        FROM updated CROSS JOIN added`;
        return json({ok:true,month,field,value:Number(result[0].amount),
          added:amount,entry:{id:result[0].id,remarks:result[0].remarks,
            amount:Number(result[0].added),createdAt:result[0].created_at},
          message:'Miscellaneous expense saved for '+month+'.'});
      }
      return json({ok:true,month,field,value:Number(saved[0].amount),added:amount,
        message:field.toUpperCase()+' expense added for '+month+'.'});
    }
    if(field)return json({ok:false,error:'Invalid monthly expense category.'},400);
    // Backward compatibility for older clients using combined Rent + Office Save.
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
