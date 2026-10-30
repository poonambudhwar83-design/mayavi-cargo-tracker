import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {monthlyAmount,monthlyImportFigures,sumMonthlyImport,sumMonthlyExport,calculateMonthlyExpenses} from '../lib/monthlyExpenses.js';
import {proteinHandlingRate} from '../lib/importProteinDeduction.js';
import {resolvedExportShipmentCharge} from '../lib/exportShipmentCharge.js';
import {branchPayoutForRecord} from '../lib/branchLoads.js';
import {importFreightRegion,importFreightRate,importTotalCost,importNetProfit,importExcessProfit,importProfitIncludingExcess,importProteinGoodsChargePerBag,importGoodsCharge15Percent,importGrossProfit} from '../lib/importFreightCost.js';
const importUI=readFileSync('app/ImportProfitSheet.js','utf8');
const exportUI=readFileSync('app/ExportProfitSheet.js','utf8');
const api=readFileSync('app/api/monthly-expenses/route.js','utf8');
const ui=readFileSync('app/MonthlyExpensesDashboard.js','utf8');
const dash=readFileSync('app/UnifiedDashboard.js','utf8');
const sourceCalc=(text,begin,end,ctx)=>{
 const start=text.indexOf(begin),finish=text.indexOf(end,start);
 assert.ok(start>0&&finish>start,begin+' must remain present');
 return runInNewContext('('+text.slice(start,finish).trim()+')',ctx);
};
const actualImport=sourceCalc(importUI,'function figures(row={}){','function displayMoney(',{
 dataNumber:v=>v===null||v===undefined||v===''?null:Number(v),
 DRIVER_EXPENSE_PER_MAWB:2600,proteinHandlingRate,
 importFreightRegion,importFreightRate,importTotalCost,importNetProfit,
 importExcessProfit,importProfitIncludingExcess,importProteinGoodsChargePerBag,
 importGoodsCharge15Percent,importGrossProfit,Number,Math,String
});
const examples=[
 {goodsCategory:'HH',origin:'DEL',weight:100,bags:4,totalDuty:1000,rate:500,driverExpense:2600},
 {goodsCategory:'HH',origin:'HKG',weight:100,bags:4,totalDuty:1000,rate:500,driverExpense:2600},
 {goodsCategory:'PROTEIN',origin:'DXB',weight:50,bags:2,totalDuty:1000,rate:500,excessWeight:'5'},
 {goodsCategory:'PROTEIN',origin:'CANADA',weight:75,bags:3,totalDuty:1200,rate:530,allocationRatio:0.5},
 {goodsCategory:'PROTEIN',origin:'JFK',weight:50,bags:3,totalDuty:500,rate:550,allocationRatio:0.5},
 {goodsCategory:'PROTEIN',origin:'GERMANY',weight:90,bags:4,totalDuty:450,rate:700},
 {goodsCategory:'CLOTHES',origin:'DXB',weight:80,bags:2,totalDuty:950,rate:320},
 {goodsCategory:'BATTERY',origin:'HKG',weight:80,bags:2,totalDuty:950,rate:320},
 {goodsCategory:'CLOTHES',origin:'DXB',weight:80,bags:2,totalDuty:'',rate:320},
 {goodsCategory:'PROTEIN',origin:'DXB',weight:80,bags:2,totalDuty:950,rate:''},
 {goodsCategory:'HH',origin:'DEL',weight:0,bags:2,totalDuty:200,rate:320}
];
for(const row of examples){
 const a=actualImport(row),b=monthlyImportFigures(row);
 for(const field of ['profit','grossProfit','goodsCharge15Percent'])
   assert.equal(b[field],a[field],field+' matches for '+row.goodsCategory+'/'+row.origin);
}
const summary=sumMonthlyImport(examples);
const rounded=v=>Math.round(v*100)/100;
assert.equal(summary.grossProfit,rounded(examples.map(actualImport)
 .filter(r=>r.profitPerKg!==null).reduce((sum,r)=>sum+r.grossProfit,0)));
assert.equal(summary.goodsCharge15Percent,rounded(examples.map(actualImport)
 .reduce((sum,r)=>sum+(r.goodsCharge15Percent||0),0)));
const actualExport=sourceCalc(exportUI,'function profitFor(row={}){','function exportCsv(',{resolvedExportShipmentCharge,Number,Math});
const exports=[
 {weight:20,rate:6,shipmentCharge:2600},
 {weight:100,rate:11,shipmentCharge:3000},
 {weight:30,rate:7,shipmentCharge:1500},
 {weight:null,rate:6,shipmentCharge:2600},
 {weight:0,rate:6,shipmentCharge:2600}
];
assert.equal(sumMonthlyExport(exports).grossProfit,
 exports.reduce((sum,r)=>sum+(actualExport(r)||0),0));
assert.equal(sumMonthlyExport(exports).completed,3);
assert.equal(monthlyAmount('1000.50'),1000.5);
assert.equal(monthlyAmount('-1'),null);
assert.equal(monthlyAmount(''),null);
assert.equal(monthlyAmount('10.111'),null);
assert.deepEqual(calculateMonthlyExpenses({
 importGross:60000,exportGross:40000,jind:20000,karnal:10000,goods15:5000,
 salaryCash:12000,salaryAccount:18000,rent:10000,office:5000
}),{totalIncome:135000,totalSalary:30000,totalExpenses:45000,finalProfit:90000});
assert.equal(calculateMonthlyExpenses({salaryCash:200,salaryAccount:300,rent:400,office:100}).finalProfit,-1000);

assert.deepEqual(calculateMonthlyExpenses({
  importGross:60000,exportGross:40000,jind:20000,karnal:10000,goods15:5000,
  speedPost:16770,salaryCash:12000,salaryAccount:18000,
  rent:10000,office:5000,rooms:2000,misc:1000
}),{totalIncome:151770,totalSalary:30000,totalExpenses:48000,finalProfit:103770});
assert.equal(calculateMonthlyExpenses({speedPost:-500}).finalProfit,-500,
  'EMS loss must reduce, not inflate, overall Final Profit');
assert.ok(api.includes('speedPostProfitTotals(speedPostEntries.map('),
  'Use the same Speed Post profit calculator as its monthly tab');
assert.ok(api.includes('FROM mayavi_speedpost'),
  'Sync the persisted EMS ledger, not manual amount entries');
assert.ok(api.includes("AT TIME ZONE 'Asia/Kolkata'"),
  'Speed Post must use the same original IST entry month');
assert.ok(api.includes('speedPost:speedPostTotals'),
  'Expose pending/profit packet counts to the Admin page');
assert.ok(ui.includes('Speed Post — Net Profit'),
  'Display Speed Post Net Profit as an explicit income line');
assert.ok(ui.includes('record.source.speedPost?.missing>0'),
  'Warn the Admin when not all Speed Post packets have calculable profit');

assert.deepEqual(calculateMonthlyExpenses({
 importGross:60000,exportGross:40000,jind:20000,karnal:10000,goods15:5000,
 salaryCash:12000,salaryAccount:18000,rent:10000,office:5000,rooms:2000,misc:1000
}),{totalIncome:135000,totalSalary:30000,totalExpenses:48000,finalProfit:87000});
// Branch income must match the same derived "Amount Paid to Branch" displayed
// in Branch Loads, including Extra Cost allocation and legacy records.
assert.equal(branchPayoutForRecord({
 amount:12000,paidToJepo:10500,extraCost:0,commodity:'Household Goods'
}),1500);
assert.equal(branchPayoutForRecord({
 amount:12000,paidToJepo:10500,extraCost:1000,
 commodity:'Household and Medicine'
}),1800); // ₹300 to branch; ₹700 to JEPO
assert.equal(branchPayoutForRecord({
 amount:12000,paidToJepo:10500,extraCost:1000,commodity:'Medicine'
}),2500); // Medicine-only extra cost belongs entirely to Branch

assert.ok(api.includes("readSession(request)?.role==='admin'"));
assert.ok(api.includes('GET as getImportProfit')&&api.includes('GET as getExportProfit'));
assert.ok(api.includes('GET as getSalary'));
assert.ok(!api.includes("SUM(amount) FILTER"),'Never add total booking Amount as branch income');
assert.ok(api.includes('branchPayoutForRecord({'),'Use source Branch Loads payout calculator');
assert.ok(api.includes('paidToJepo:row.paid_to_jepo'),'Use paid-to-JEPO amount in branch payout');
assert.ok(api.includes('extraCost:row.extra_cost,bottleCount:row.bottle_count'),
 'Allocate extra cost correctly between JEPO and Branch');
assert.ok(api.includes('payout[branch]=Math.round((payout[branch]+amount)*100)/100'),
 'Sum actual branch payout for each branch, not master booking');
assert.ok(api.includes("record_date>=${month+'-01'}::date"));
assert.ok(api.includes('mayavi_monthly_expenses'));
assert.ok(api.includes('ON CONFLICT(expense_month) DO UPDATE'));
assert.ok(api.includes("searchParams.get('view')==='expenses'"),
  'Independent Rent loading must not depend on Import/Export Profit Sheets');
assert.ok(api.includes('rent,office_expenses,rooms_expenses,misc_expenses'),
  'Read all four saved monthly expense categories');
assert.ok(ui.includes("view=expenses"),
  'Client must load Rent independently even during profit-source failures');
assert.ok(ui.includes('SAVED TO DATABASE'),
  'Successful Rent saving needs explicit persisted confirmation');
assert.ok(ui.includes('Number(verified[key])!==Number(result.value)'),
  'Do not claim any expense saved without category-specific database verification');
assert.ok(ui.includes('busy[key]||loading||!month)return;'),
  'Expense saving must not be blocked by missing Import/Export profit data');
assert.ok(ui.includes('Unsaved changes'),
  'Each expense entry must show an unsaved state on edit');
assert.ok(ui.includes('expenseHeads.map(head=><div key={head.key}'),
  'Each of the four expense categories has its own entry box');
assert.ok(ui.includes('onClick={()=>void saveExpense(head.key)}'),
  'Each expense category has its own SAVE button');
assert.ok(ui.includes("saved[head.key]?'#15803d':'#2056a1'"),
  'Successful SAVE turns only its corresponding button green');
assert.ok(api.includes("if(['rent','office','rooms','misc'].includes(field))"),
  'API supports 4 independent saves');
assert.ok(api.includes('SET rent=mayavi_monthly_expenses.rent+EXCLUDED.rent,rent_saved_at=now()'),'Rent has independent save');
assert.ok(api.includes('SET office_expenses=mayavi_monthly_expenses.office_expenses+EXCLUDED.office_expenses,office_saved_at=now()'),'Office Expenses has independent save');
assert.ok(api.includes('SET rooms_expenses=mayavi_monthly_expenses.rooms_expenses+EXCLUDED.rooms_expenses,rooms_saved_at=now()'),'Rooms Expenses has independent save');
assert.ok(api.includes('SET misc_expenses=mayavi_monthly_expenses.misc_expenses+EXCLUDED.misc_expenses,misc_saved_at=now()'),'Misc has independent save');
assert.ok(api.includes('ADD COLUMN IF NOT EXISTS rooms_expenses'),'New Rooms head migrated without erasing old expenses');
assert.ok(api.includes('ADD COLUMN IF NOT EXISTS misc_expenses'),'New Misc head migrated without erasing old expenses');


for(const label of ['Import Gross Profit','Export Gross Profit','Jind Branch — Amount Paid to Branch','Karnal Branch — Amount Paid to Branch',
 'Import — 15% Goods Charge Total','Salary — Cash Paid','Salary — Account Paid','Rent','Office Expenses','Rooms Expenses','Miscellaneous'])
 assert.ok(ui.includes(label),label+' must be displayed');
// Saving an expense must clear the input while keeping previously saved
// totals in the month and never clearing the other three active draft entries.
assert.ok(ui.includes("const initialExpenses={rent:'',office:'',rooms:'',misc:''}"),
 'Every expense input starts empty, even when monthly totals already exist.');
assert.ok(ui.includes('setDrafts({...initialExpenses});'),
 'Loading or re-opening the month must show empty entry boxes.');
assert.ok(ui.includes("setDrafts(previous=>({...previous,[key]:''}))"),
 'After successful database confirmation only the saved input clears.');
assert.ok(ui.includes('setSavedTotals(previous=>({...previous,[key]:Number(verified[key])}))'),
 'Saved monthly totals must remain visible and account for submitted expenses.');
assert.ok(ui.includes('value:savedTotals[head.key]'),
 'Expenses table must use saved totals, not cleared entry boxes.');
assert.ok(ui.includes('calculateMonthlyExpenses({...record.values,...savedTotals})'),
 'Final Profit must be based on persisted amounts, not unsaved input drafts.');
assert.ok(ui.includes('Saved this month: {show(savedTotals[head.key])}'),
 'Monthly saved totals should be distinct from entry fields.');
assert.ok(ui.includes('Enter amount to add'),
 'A cleared field is ready for a new expense entry.');
for(const [field,col] of [['rent','rent'],['office','office_expenses'],
  ['rooms','rooms_expenses'],['misc','misc_expenses']]){
  assert.ok(api.includes('SET '+col+'=mayavi_monthly_expenses.'+col+'+EXCLUDED.'+col),
    field+' Save must accumulate a new entry atomically, not replace prior expenses.');
}
assert.ok(ui.includes('metrics.finalProfit'));
assert.ok(ui.includes("saved[head.key]?'#15803d':'#2056a1'"));
assert.ok(dash.includes("selectedDashboard==='MONTHLY_EXPENSES'"));
assert.ok(dash.includes('>MONTHLY EXPENSES</button>'));
console.log('Monthly Expenses regression passed: Import/Export parity, physical parts, 15%, branch sums, salary, rent, office, final profit and admin controls.');
