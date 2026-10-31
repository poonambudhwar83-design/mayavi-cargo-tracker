import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  speedPostRoundedWeight,speedPostTariff,speedPostProfitCountry,
  speedPostSellingRate,speedPostProfitRow,speedPostProfitTotals,speedPostDailySummary
} from '../lib/speedpostMonthlyProfit.js';
const main=readFileSync('app/SpeedPostDashboard.js','utf8');
const profitUI=readFileSync('app/SpeedPostMonthlyProfit.js','utf8');
const api=readFileSync('app/api/speedpost/route.js','utf8');

assert.equal(speedPostRoundedWeight('4250 g'),5);
assert.equal(speedPostRoundedWeight('5.001 kg'),6);
assert.equal(speedPostRoundedWeight('5000 g'),5);
assert.equal(speedPostRoundedWeight('11050 g'),12);
assert.equal(speedPostRoundedWeight('1,050 g'),2);
assert.equal(speedPostRoundedWeight('1000'),null,'Unknown units must not be guessed');
assert.equal(speedPostRoundedWeight(''),null);
assert.equal(speedPostSellingRate('UK',1),1050);
assert.equal(speedPostSellingRate('UK',5),1050);
assert.equal(speedPostSellingRate('UK',6),950);
assert.equal(speedPostSellingRate('UK',10),950);
assert.equal(speedPostSellingRate('UK',11),950,'UK above 10 kg also uses ₹950/kg');
assert.equal(speedPostSellingRate('UK',70),950);
assert.equal(speedPostSellingRate('USA',5),1300);
assert.equal(speedPostSellingRate('USA',6),1200);
assert.equal(speedPostSellingRate('USA',40),1200);
assert.equal(speedPostSellingRate('CANADA',5),null);
assert.equal(speedPostTariff({tariff:'₹1,000'}),1000);
assert.equal(speedPostTariff({tariff:''}),null,'Unverified tariff is missing, not zero');
assert.equal(speedPostProfitCountry({destination:'Leicester',destinationCountry:'United Kingdom'}),'UK');
assert.equal(speedPostProfitCountry({destination:'New York',destinationCountry:'US'}),'USA');
assert.equal(speedPostProfitCountry({destination:'ESSEX'}),'UK');
assert.equal(speedPostProfitCountry({destination:'SOUTHALL'}),'UK');
assert.equal(speedPostProfitCountry({destination:'ESSEX',state:'Connecticut'}),'USA',
  'US state must override ambiguous city Essex');
assert.equal(speedPostProfitCountry({destination:'ESSEX',destinationCountry:'USA'}),'USA',
  'An explicit country is stronger than a city name');
assert.equal(speedPostProfitCountry({destination:'London',destinationCountry:'Canada'}),'Canada');
assert.equal(speedPostProfitCountry({destination:'BOSTON'}),'USA');

const uk5=speedPostProfitRow({
 trackingNo:'ED111111111IN',destination:'UK',weight:'4250 g',tariff:'₹1,000',createdAt:'2026-10-01T15:00:00Z'
});
assert.equal(uk5.roundedWeight,5);
assert.equal(uk5.rate,1050);
assert.equal(uk5.amountReceived,5250);
assert.equal(uk5.cashCost,750);
assert.equal(uk5.totalCost,1750);
assert.equal(uk5.costPerKg,350,'Cost/kg = total ₹1750 / rounded weight 5 kg');
assert.equal(uk5.consultingCost,1750,'Consulting = ₹350/kg * 5 kg');
assert.equal(uk5.packingTransport,50,'Packing+Transportation = ₹10/kg');
assert.equal(uk5.profit,3450,'Profit = ₹5250 - ₹1750 - ₹50');
const uk12=speedPostProfitRow({trackingNo:'ED222222222IN',destination:'UK',weight:'11.1 kg',tariff:'1500'});
assert.equal(uk12.roundedWeight,12);
assert.equal(uk12.rate,950,'UK above 10 kg per user confirmation');
assert.equal(uk12.amountReceived,11400);
assert.equal(uk12.totalCost,3300,'Tariff ₹1500 + ₹1800 cash');
assert.equal(uk12.costPerKg,275);
assert.equal(uk12.consultingCost,3300);
assert.equal(uk12.packingTransport,120);
assert.equal(uk12.profit,7980);
const usa=speedPostProfitRow({trackingNo:'ED333333333IN',destinationCountry:'USA',weight:'5.1 kg',tariff:'900'});
assert.equal(usa.roundedWeight,6);
assert.equal(usa.rate,1200);
assert.equal(usa.amountReceived,7200);
assert.equal(usa.totalCost,1800);
assert.equal(usa.packingTransport,60);
assert.equal(usa.profit,5340);
const incomplete=speedPostProfitRow({trackingNo:'ED444444444IN',destination:'UK',weight:'4 kg',tariff:''});
assert.equal(incomplete.profit,null,'Missing tariff must not fake a profit');
const other=speedPostProfitRow({trackingNo:'ED555555555IN',destination:'Australia',weight:'2 kg',tariff:'500'});
assert.equal(other.profit,null,'Unknown destination rates must not be invented');

const monthRows=[
 {trackingNo:'ED111111111IN',destination:'UK',weight:'4250 g',tariff:'1000'},
 {trackingNo:'ED222222222IN',destination:'UK',weight:'11.1 kg',tariff:'1500'},
 {trackingNo:'ED333333333IN',destinationCountry:'USA',weight:'5.1 kg',tariff:'900'},
 {trackingNo:'ED444444444IN',destination:'UK',weight:'4 kg',tariff:''},
 {trackingNo:'ED555555555IN',destination:'Australia',weight:'2 kg',tariff:'500'},
 {trackingNo:'ED111111111IN',destination:'UK',weight:'4250 g',tariff:'1000'}
];
const report=speedPostProfitTotals(monthRows);
assert.equal(report.totals.packets,5,'Duplicate ED is counted once');
assert.equal(report.totals.complete,3);
assert.equal(report.totals.missing,2);
assert.equal(report.totals.roundedWeight,23);
assert.equal(report.totals.amountReceived,23850);
assert.equal(report.totals.consultingCost,6850);
assert.equal(report.totals.packingTransport,230);
assert.equal(report.totals.profit,16770);
for(const phrase of [
 "speedPostTab==='PROFIT'",
 'Profit & Costing',
 'rows={monthRows} month={effectiveMonth} entryMonths={entryMonths}',
 'onSelectMonth={setSelectedEntryMonth}',
 'function costPerKg(row){',
 'return speedPostProfitRow(row).costPerKg;',
 'const averageCostPerKg=ratedWeight>0?ratedRows.reduce((sum,r)=>sum+r.totalCost,0)/ratedWeight:null;',
 "speedPostTab==='MONTHLY'?'Monthly Entry Records",
 "speedPostTab==='DELIVERED'?deliveredRows"
]){
 assert.ok(main.includes(phrase),'EMS main dashboard integration: '+phrase);
}
for(const phrase of [
 'UK','Above 5 kg: ₹950/kg','USA','Up to 5 kg: ₹1,300/kg',
 'Cost/kg = Total Cost ÷ Rounded kg','Amount Received',
 'Consulting Cost','Packing + Transport','Profit (₹)',
 'speedPostProfitTotals(rows)','month={effectiveMonth}'
].filter(Boolean)){
 if(phrase==='month={effectiveMonth}')continue;
 assert.ok(profitUI.includes(phrase),'Profit dashboard label '+phrase);
}
assert.ok(profitUI.includes("speedPostEntryDay(row)"),'Monthly tab uses immutable entry date');
assert.ok(api.includes('SELECT tracking_no,data,created_at,updated_at FROM mayavi_speedpost'),
 'Read existing Speed Post records without new tracking writes');
assert.ok(main.includes("const canViewProfit=currentUser?.role==='admin';"),
 'Profit and Daily Summary are Admin-only, not Sonu or other staff');
assert.ok(main.includes("...(canViewProfit?[['PROFIT','Profit & Costing'"),
 'Profit tab must be present in navigation only when the logged-in user is Admin');
assert.ok(main.includes('aria-selected={speedPostTab===id}')&&main.includes('role="tab"'),
 'Each colour-coded Speed Post page is selectable with accessible tab semantics');
assert.ok(main.includes("{canViewProfit&&speedPostTab==='PROFIT'&&<SpeedPostMonthlyProfit"),
 'Profit data component and daily calculations must not render for non-Admin');
assert.ok(!main.includes('loading={loading}'),
 'Monthly Profit tab cannot reference an undefined loading variable and crash the client.');
assert.ok(main.includes('onSelectMonth={setSelectedEntryMonth} historyIncomplete={historyIncomplete}/>}'),
 'Profit tab can render with only defined parent properties.');
assert.ok(!main.includes("speedPostTab==='PROFIT'?monthRows:dayRows"),
 'Do not accidentally alter the daily tracking sheet');
console.log('EMS Monthly Profit passed: rounded weights, UK/USA rate thresholds, 12kg UK, cost/kg, consulting, packing, net profit, missing inputs, monthly UI.');

const entriesByDay=[
  {trackingNo:'ED010000001IN',createdAt:'2026-10-14T22:00:00Z',destination:'UK',weight:'4250 g',tariff:'1000',status:'Delivered'},
  {trackingNo:'ED010000002IN',createdAt:'2026-10-15T03:00:00Z',destination:'UK',weight:'11.1 kg',tariff:'1500'},
  {trackingNo:'ED010000003IN',createdAt:'2026-10-16T00:30:00Z',destination:'USA',weight:'5.1 kg',tariff:'900'},
  {trackingNo:'ED010000004IN',createdAt:'2026-10-16T10:30:00Z',destination:'UK',weight:'4 kg',tariff:''},
  {trackingNo:'ED010000005IN',createdAt:'2026-10-16T11:00:00Z',destination:'Australia',weight:'2 kg',tariff:'500'},
  {trackingNo:'ED010000001IN',createdAt:'2026-10-14T22:00:00Z',destination:'UK',weight:'4250 g',tariff:'1000'}
];
const byDate=speedPostDailySummary(entriesByDay);
assert.deepEqual(byDate.daily.map(x=>[x.date,x.packets]),[['2026-10-16',3],['2026-10-15',2]]);
const first=byDate.daily[1],second=byDate.daily[0];
assert.equal(first.actualWeightKg,15.35);
assert.equal(first.roundedWeightKg,17);
assert.equal(first.tariff,2500);
assert.equal(first.cashCost,2550);
assert.equal(first.totalAmount,5050);
assert.equal(first.profit,11430);
assert.equal(second.actualWeightKg,11.1);
assert.equal(second.roundedWeightKg,12);
assert.equal(second.tariff,1400);
assert.equal(second.cashCost,1800);
assert.equal(second.totalAmount,3200);
assert.equal(second.profit,5340);
assert.equal(second.pendingProfit,2);
assert.equal(byDate.month.packets,5);
assert.equal(byDate.month.actualWeightKg,26.45);
assert.equal(byDate.month.roundedWeightKg,29);
assert.equal(byDate.month.tariff,3900);
assert.equal(byDate.month.cashCost,4350);
assert.equal(byDate.month.totalAmount,8250);
assert.equal(byDate.month.amountReceived,23850);
assert.equal(byDate.month.profit,16770);
assert.equal(byDate.month.profitablePackets,3);
assert.equal(byDate.month.pendingProfit,2);
assert.ok(!profitUI.includes('DAILY SUMMARY'),
  'Do not add a separate daily summary in the Profit tab.');
assert.ok(!profitUI.includes('speedPostDailySummary(rows)'),
  'The daily breakdown belongs in existing Monthly Records only.');
assert.ok(main.includes('const monthProfit=canViewProfit?speedPostDailySummary(monthRows):null;'),
  'Only Admin may calculate daily profit within Monthly Records.');
assert.ok(main.includes("...(canViewProfit?['Amount Paid in Bank','Difference','Daily Profit']:[])"),
  'Daily Profit and the added bank reconciliation columns in Monthly Records must be Admin-only.');
assert.ok(main.includes('dailyProfitByDate.get(day)?.profitablePackets'),
  'The existing Monthly Records rows must show daily profit.');
assert.ok(main.includes('monthProfit?.month.profitablePackets'),
  'The existing Monthly Records footer must include monthly total profit.');
assert.ok(main.includes('dailyProfitByDate.get(day)?.pendingProfit'),
  'Incomplete tariff/rate entries must not fake a full daily profit.');

console.log('EMS Daily Summary regression passed for IST date, weight, tariff, cash, combined, profit.');
