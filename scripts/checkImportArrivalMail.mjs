import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importArrivalOrder, importIstMoment, importMailSixHoursBefore } from '../lib/importEtaTimeline.js';
const row=(awb,date,time,status,mailSent=false)=>({mawb:awb,arrivalDate:date,arrivalTime:time,status,mailSent});
const flights=[
  row('098-32251715','2026-11-02','01:50','ACCEPTED'),
  row('098-30448456','2026-11-01','17:10','MANIFESTED'),
  row('065-11493775','','','IN TRANSIT'),
  row('098-32251704','2026-11-01','16:20','BUILD UP'),
  row('229-18109630','2026-11-01','01:30','DEPARTED'),
  row('065-11493672','2026-11-01','09:45','DEPARTED'),
  row('160-18860310','2026-11-01','00:21','ARRIVED',true),
  row('141-45203152','2026-11-01','13:20','IN TRANSIT'),
];
assert.deepEqual([...flights].sort((a,b)=>importArrivalOrder(a)-importArrivalOrder(b)).map(r=>r.mawb),[
  '160-18860310','229-18109630','065-11493672','141-45203152',
  '098-32251704','098-30448456','098-32251715','065-11493775'
],'Earliest final-destination arrival must be first across carriers and statuses');
assert.equal(importMailSixHoursBefore('2026-11-01','16:20'),'2026-11-01 10:20');
assert.equal(importMailSixHoursBefore('2026-11-01','17:10'),'2026-11-01 11:10');
assert.equal(importMailSixHoursBefore('2026-11-02','01:50'),'2026-11-01 19:50',
  'Mail deadline must roll back to prior IST date');
assert.equal(importMailSixHoursBefore('2026-11-01','01:30'),'2026-10-31 19:30');
assert.equal(importMailSixHoursBefore('2026-11-01',''),'');
assert.equal(importArrivalOrder({_saudiaTransitEta:{date:'2026-11-01',time:'04:45'}}),importIstMoment('2026-11-01','04:45'),'Visible transit ETA can be ordered chronologically but not used as Delhi mail');
assert.equal(importArrivalOrder({_emiratesMasterEta:{date:'2026-11-01',time:'08:30'}}),importIstMoment('2026-11-01','08:30'));
const dash=readFileSync('app/DashboardClient.js','utf8');
const cron=readFileSync('app/api/cron/refresh/route.js','utf8');
assert.ok(dash.includes('const at=arrivalSortTime(a),bt=arrivalSortTime(b);'));
assert.ok(dash.includes('const mailTime=isImportLikeType(shipmentType)?mailTimeFrom(mailArrivalDate,arrivalTime)'));
assert.ok(dash.includes('return direct||safeAirAsia||provisional||'));
assert.ok(dash.includes('return importMailSixHoursBefore(date,time)'));
assert.ok(!dash.includes("if(digits(row.mawb).startsWith('098')&&row.arrivalEstimate===true&&row.arrivalIsActual!==true)return''"),
  'A dated 098 flight ETA must display the -6h Mail deadline');
assert.ok(!dash.includes("if(digits(row.mawb).startsWith('098')&&row.arrivalEstimate===true&&row.arrivalIsActual!==true)return false"),
  'Air India Mail NO should blink when its verified ETA deadline has passed');
assert.ok(cron.includes("function mailTimeFrom(date='',time=''){return importMailSixHoursBefore(date,time)}"));
assert.ok(!cron.includes("!onlyAirIndiaFlightEta?mailTimeFrom"));
assert.ok(dash.includes("if(row._saudiaPendingVirtual===true)return'';"),
  'Unassigned Saudia balance cannot receive an imaginary Mail deadline');
console.log('Arrival order IST and Mail -6h tests passed, including prior-day rollover and all three Air India flights.');


// A customer-requested operational date is displayed but never represents
// a confirmed cargo ETA, physical arrival or mail deadline.
const manualAirIndiaPlan={
  mawb:'098-30448456',status:'PART OFFLOAD • VERIFY',
  operatorPlannedArrivalDate:'2026-11-01',arrivalDate:'',arrivalTime:'',
  arrivalIsActual:false,arrivalVerifiedAbsent:true,offloadedPieces:'6',masterPieces:'41'
};
assert.equal(importArrivalOrder(manualAirIndiaPlan),importIstMoment('2026-11-01','23:59'));
assert.equal(importArrivalOrder({...manualAirIndiaPlan,operatorPlannedArrivalDate:''}),Infinity);
assert.equal(importArrivalOrder({...manualAirIndiaPlan,status:'MANIFESTED'}),Infinity,
  'An outdated operator plan must not override a later actual airline milestone');
assert.equal(importArrivalOrder({...manualAirIndiaPlan,arrivalDate:'2026-11-02',arrivalTime:'01:50',status:'ARRIVED',arrivalIsActual:true}),
  importIstMoment('2026-11-02','01:50'));
assert.equal(importMailSixHoursBefore(manualAirIndiaPlan.arrivalDate,manualAirIndiaPlan.arrivalTime),'');
const manualPlanDashboard=readFileSync('app/DashboardClient.js','utf8');
assert.ok(manualPlanDashboard.includes('OPERATOR PLAN • OFFLOAD NOT CLEARED'),
  'The operator plan must be clearly labeled, never marked ARRIVED');
console.log('Operator-planned Air India offload arrival date appears on the correct day without false cargo arrival or email alerts.');
