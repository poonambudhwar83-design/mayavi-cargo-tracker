import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {monthlyAmount,monthlyImportFigures,sumMonthlyImport,sumMonthlyExport,calculateMonthlyExpenses} from '../lib/monthlyExpenses.js';
import {proteinHandlingRate} from '../lib/importProteinDeduction.js';
import {resolvedExportShipmentCharge} from '../lib/exportShipmentCharge.js';
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
assert.ok(api.includes("readSession(request)?.role==='admin'"));
assert.ok(api.includes('GET as getImportProfit')&&api.includes('GET as getExportProfit'));
assert.ok(api.includes('GET as getSalary'));
assert.ok(api.includes("SUM(amount) FILTER (WHERE branch='JIND')"));
assert.ok(api.includes("SUM(amount) FILTER (WHERE branch='KARNAL')"));
assert.ok(api.includes("record_date>=${month+'-01'}::date"));
assert.ok(api.includes('mayavi_monthly_expenses'));
assert.ok(api.includes('ON CONFLICT(expense_month) DO UPDATE'));
for(const label of ['Import Gross Profit','Export Gross Profit','Jind Branch','Karnal Branch',
 'Import — 15% Goods Charge Total','Salary — Cash Paid','Salary — Account Paid','Rent','Office Expenses'])
 assert.ok(ui.includes(label),label+' must be displayed');
assert.ok(ui.includes('metrics.finalProfit'));
assert.ok(ui.includes("saved?'#15803d':'#2056a1'"));
assert.ok(dash.includes("selectedDashboard==='MONTHLY_EXPENSES'"));
assert.ok(dash.includes('>MONTHLY EXPENSES</button>'));
console.log('Monthly Expenses regression passed: Import/Export parity, physical parts, 15%, branch sums, salary, rent, office, final profit and admin controls.');
