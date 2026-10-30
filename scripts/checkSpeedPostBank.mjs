import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {speedPostBankDifference,speedPostBankMonthTotals} from '../lib/speedpostBank.js';
const ui=readFileSync('app/SpeedPostDashboard.js','utf8');
const api=readFileSync('app/api/speedpost/bank/route.js','utf8');
const report=readFileSync('lib/speedpostCostReports.js','utf8');
assert.equal(speedPostBankDifference(10000,9500),500);
assert.equal(speedPostBankDifference(10000,12000),-2000,
  'Paying more than the combined cost MUST produce a negative red difference');
assert.equal(speedPostBankDifference(10000,10000),0);
assert.equal(speedPostBankDifference(10000,0),10000,
  'Explicitly saved zero is distinct from missing bank entry');
for(const missing of [undefined,null,'',-1,NaN])
  assert.equal(speedPostBankDifference(10000,missing),null);
assert.equal(speedPostBankDifference(200.25,300.35),-100.10);
const days=[
 {day:'2026-10-29',combined:10000},
 {day:'2026-10-30',combined:5000}
];
const incomplete=speedPostBankMonthTotals(days,{'2026-10-29':12000});
assert.equal(incomplete.bankPaid,12000);
assert.equal(incomplete.pendingDays,1);
assert.equal(incomplete.difference,null,
  'Do not treat a missing daily bank entry as zero in monthly Difference');
const complete=speedPostBankMonthTotals(days,{'2026-10-29':12000,'2026-10-30':4000});
assert.deepEqual(complete,{bankPaid:16000,combinedTotal:15000,bankDays:2,days:2,
  pendingDays:0,difference:-1000});
assert.equal(speedPostBankMonthTotals([],{}).difference,null);
assert.ok(report.includes('timeZone:'));

assert.ok(ui.includes("const canViewProfit=currentUser?.role==='admin';"));
assert.ok(ui.includes('const bankTotals=canViewProfit?speedPostBankMonthTotals('));
assert.ok(ui.includes("if(!canViewProfit||speedPostTab!=='MONTHLY'"),'Only Admin may fetch saved bank records');
assert.ok(ui.includes("if(!canViewProfit||bankSaving"),'Only Admin may save bank records');
assert.ok(ui.includes("...(canViewProfit?['Amount Paid in Bank','Difference','Daily Profit']:[])"),
  'Bank reconciliation only appears in existing Admin Monthly Records');
assert.ok(ui.includes('aria-label={\'Amount Paid in Bank for \'+day}'), 'Each daily entry is independently editable');
assert.ok(ui.includes("onClick={()=>void saveBankPayment(day)}"), 'Individual daily SAVE must work');
assert.ok(ui.includes("bankSavedDay===day?'✓ SAVED':'SAVE'"), 'Show confirmation on each saved date');
assert.ok(ui.includes("const checked=await fetch('/api/speedpost/bank?month='"), 'Verify persisted amount before success');
assert.ok(ui.includes("speedPostBankDifference(t.combined,currentBank[day])"),
  'Daily Difference must subtract saved bank payment from Combined Total');
assert.ok(ui.includes("?'#b91c1c':'#166534'"),'Negative difference must appear in red');
assert.ok(ui.includes("bankTotals?.pendingDays>0"),'Missing bank payments are marked pending');
assert.ok(ui.includes("bankTotals?.difference!==null"),'Only completed bank months display monthly Difference');
assert.ok(!ui.includes('!/^\\\\d{1,9}'),
  'Ensure bank input regex matches digits rather than a backslash');
assert.ok(api.includes("session?.role!=='admin'"),'GET and PATCH are server restricted to admin');
assert.ok(api.includes('entry_day DATE PRIMARY KEY'),'Bank amounts are one per immutable entry date');
assert.ok(api.includes('ON CONFLICT(entry_day) DO UPDATE'),'Correction updates same date, never adds duplicates');
assert.ok(api.includes('bank_paid=EXCLUDED.bank_paid'),'Bank correction must replace, not accumulate amount');
assert.ok(api.includes('RETURNING entry_day::text AS day,bank_paid,updated_at'),'Database confirms saved amount');
assert.ok(api.includes('mayavi_speedpost_bank_daily'),'Bank savings persist separately from shipment records');
assert.ok(!api.includes('UPDATE mayavi_speedpost'),'Never modify tracking, tariff or cost records');
console.log('EMS bank reconciliation passed: signed differences, red overpayment, incomplete months, per-day SAVE, database isolation and Admin-only access.');
