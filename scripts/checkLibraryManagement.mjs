import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {LIBRARY_DURATIONS,libraryDate,libraryRenewalDue,libraryPaidThrough,
 libraryNextCycleStart,libraryMoney,libraryPayment,libraryRenewalList,libraryRenewalState} from '../lib/libraryManagement.js';

assert.deepEqual(LIBRARY_DURATIONS.map(x=>x.value),['7d','15d','1m','2m','3m','4m','5m','6m']);
assert.equal(libraryDate('2026-11-14'),'2026-11-14');
assert.equal(libraryDate('2026-02-30'),'');
assert.equal(libraryRenewalDue('2026-10-03','1m'),'2026-11-03');
assert.equal(libraryPaidThrough('2026-10-03','1m'),'2026-11-02');
assert.equal(libraryRenewalDue('2026-10-03','2m'),'2026-12-03');
assert.equal(libraryRenewalDue('2026-10-03','3m'),'2027-01-03');
assert.equal(libraryRenewalDue('2026-10-03','7d'),'2026-10-10');
assert.equal(libraryRenewalDue('2026-10-03','15d'),'2026-10-18');
assert.equal(libraryRenewalDue('2026-01-31','1m'),'2026-02-28');
assert.equal(libraryRenewalDue('2024-01-31','1m'),'2024-02-29');
assert.equal(libraryRenewalDue('2026-09-30','6m'),'2027-03-30');
assert.equal(libraryNextCycleStart('2026-11-03','2026-11-14'),'2026-11-14');
assert.equal(libraryNextCycleStart('2026-11-03','2026-11-03'),'2026-11-03');
assert.equal(libraryMoney('11.29'),11.29);
assert.equal(libraryMoney('-4'),null);
assert.equal(libraryMoney('4.0001'),null);
const full=libraryPayment({amount:'1500',paymentKind:'FULL',payMode1:'CASH'});
assert.equal(full.ok,true);
assert.equal(full.pay1,1500);
assert.equal(full.pay2,0);
assert.equal(full.balance,0);
const part=libraryPayment({amount:'1500',paymentKind:'PART',pay1:'500',pay2:'400',payMode1:'ONLINE',payMode2:'CASH'});
assert.equal(part.ok,true);
assert.equal(part.balance,600);
assert.equal(libraryPayment({amount:'1500',paymentKind:'PART',pay1:'1200',pay2:'400',payMode1:'CASH',payMode2:'ONLINE'}).ok,false);
const rows=[
 {id:'a',studentName:'A',dueDate:'2026-11-01',isActive:true},
 {id:'b',studentName:'B',dueDate:'2026-11-14',isActive:true},
 {id:'c',studentName:'C',dueDate:'2026-11-15',isActive:true},
 {id:'d',studentName:'D',dueDate:'2026-10-31',isActive:false}
];
assert.deepEqual(libraryRenewalList(rows,'2026-11-14').map(x=>x.id),['a','b']);
assert.equal(libraryRenewalState('2026-11-01','2026-11-14'),'OVERDUE');
assert.equal(libraryRenewalState('2026-11-14','2026-11-14'),'DUE');
assert.equal(libraryRenewalState('2026-11-15','2026-11-14'),'ACTIVE');
const api=readFileSync('app/api/library-management/route.js','utf8');
const expenseApi=readFileSync('app/api/library-expenses/route.js','utf8');
const ui=readFileSync('app/LibraryDashboard.js','utf8');
const nav=readFileSync('app/UnifiedDashboard.js','utf8');
const sidebar=readFileSync('app/MayaviSidebar.js','utf8');
assert.ok(api.includes('libraryAccessSession(request)'));
assert.ok(api.includes('mayavi_library_students'));
assert.ok(api.includes('mayavi_library_cycles'));
assert.ok(api.includes('mayavi_library_one_active_student_per_seat'));
assert.ok(api.includes('CREATE TABLE IF NOT EXISTS mayavi_library_settings'));
assert.ok(api.includes('ON CONFLICT(id) DO NOTHING'));
assert.ok(api.includes("action==='renew'"));
assert.ok(api.includes('WHERE id=$1::uuid AND due_date=$2::date AND is_active=TRUE'));
assert.ok(api.includes("action==='archive_student'||action==='restore_student'"));
assert.ok(expenseApi.includes('mayavi_library_expenses'));
for(const head of ['Salary','Stationery','Daily Utilities','Rent','Electricity Bill','Misc','Misc for Home'])assert.ok(expenseApi.includes(head));
assert.ok(ui.includes('Without Seat Student Sheet'));
assert.ok(ui.includes('Daily Renewal List'));
assert.ok(ui.includes('Daily Library Expenses'));
assert.ok(ui.includes('Download CSV'));
assert.ok(ui.includes('Fee Payment'));
assert.ok(ui.includes('Payment 2 (₹)'));
assert.ok(nav.includes('<LibraryDashboard'));
assert.ok(sidebar.includes("'LIBRARY_EXPENSES'"));
console.log('Library 225-seat / no-seat registers, calendar renewals, part payments and daily expenses verified.');
