import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { speedPostEntryDay, speedPostGroupByEntryDay } from '../lib/speedpostCostReports.js';

const dashboard=readFileSync('app/SpeedPostDashboard.js','utf8');
for(const label of [
  "['TRACKING','Add & Scan'",
  "['DAILY','Daily Records'",
  "['ACTIVE','Active ('",
  "['DELIVERED','Delivered ('",
  "['BOOKING_PENDING','Booking Pending ('",
  "['MONTHLY','Monthly Records'",
  "['PROFIT','Profit & Costing'"
]){
  assert.ok(dashboard.includes(label),'EMS dedicated internal page missing: '+label);
}
assert.ok(dashboard.includes("...(canViewProfit?[['PROFIT'"),
  'Only Admin may see the Profit page');
assert.ok(dashboard.includes("const [selectedListDay,setSelectedListDay]=useState('ALL')"),
  'Active, Delivered and Booking Pending must default to all entry dates');
assert.ok(dashboard.includes("const listEntryDays=speedPostGroupByEntryDay(listBaseRows)"),
  'Date dropdown must follow actual original entry days for selected page');
assert.ok(dashboard.includes('aria-label="Choose entry date for current EMS page"'));
assert.ok(dashboard.includes('aria-label="Choose entry date page"'));
assert.ok(dashboard.includes("const [rowSearch,setRowSearch]=useState('')"));
assert.ok(dashboard.includes("aria-label=\"Search ED number, consignee, destination or entered by\""));
assert.ok(dashboard.includes("speedPostTab==='BOOKING_PENDING'?bookingPendingRows:[]"),'Booking Pending uses actual missing-date records');
assert.ok(dashboard.includes("const bookingPendingRows=rows.filter(r=>!String(r.bookingDate||'').trim())"));
assert.ok(dashboard.includes("const [selectedEntryMonth,setSelectedEntryMonth]=useState('LATEST')"),
  'Monthly reporting selection still present');
assert.ok(dashboard.includes("speedPostTab!=='MONTHLY'"),
  'Only the original Monthly Records page may fetch private bank payment amounts');
assert.ok(dashboard.includes("if(!canViewProfit||bankSaving"),
  'Bank payment updates must remain Admin-only');
assert.ok(dashboard.includes("...(canViewProfit?['Amount Paid in Bank','Difference','Daily Profit']:[])"),
  'Admin's day-by-day bank reconciliation and profit must remain');
assert.ok(dashboard.includes('createBookingPendingPdf('),'Booking Pending PDF preserved');
assert.ok(dashboard.includes("return row?.delivered===true"),'Delivered status classification preserved');

// Entry-date grouping in Mayavi always uses immutable createdAt in IST;
// delivery or booking timestamps must never change the day a packet belongs to.
const beforeMidnight={trackingNo:'EDA',createdAt:'2026-10-30T18:29:00.000Z',status:'Delivered',bookingDate:'2026-10-31'};
const afterMidnight={trackingNo:'EDB',createdAt:'2026-10-30T18:31:00.000Z',status:'In Transit',bookingDate:''};
assert.equal(speedPostEntryDay(beforeMidnight),'2026-10-30');
assert.equal(speedPostEntryDay(afterMidnight),'2026-10-31');
assert.deepEqual(speedPostGroupByEntryDay([beforeMidnight,afterMidnight]).map(([day,items])=>[day,items.length]),[
  ['2026-10-31',1],['2026-10-30',1]
]);
console.log('Speed Post navigation passed: 7 internal pages, IST date dropdowns, search, Admin bank/profit, and Booking Pending.');
