import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {jepoCustomerAvailableMonths,jepoCustomerPeriodSummary,jepoTopCustomers} from '../lib/jepoCustomerLoadSummary.js';
const shipments=[
 {awb:'AWB1',bookingDate:'2026-11-02',jpCode:'JP1001',customerName:'MAHADEV LOGISTICS',weight:4,service:'SELF'},
 {awb:'AWB2',bookingDate:'2026-11-03',jpCode:'JP2001',customerName:'MAHADEV LOGISTICS',weight:6,service:'DHL'},
 {awb:'AWB3',bookingDate:'2026-11-03',jpCode:'JP1002',customerName:'Other Customer',weight:3,service:'FEDEX'},
 {awb:'AWB4',bookingDate:'2026-11-05',jpCode:'JP1002',customerName:'Other Customer',weight:8,service:'TPL'},
 {awb:'AWB5',bookingDate:'2026-11-01',jpCode:'JP1003',customerName:'',weight:5},
 {awb:'AWB6',bookingDate:'2026-11-03',jpCode:'',customerName:'',weight:null},
 {awb:'AWB7',bookingDate:'2026-11-04',jpCode:'JP1004',customerName:'Tiny Shipment',weight:null},
 {awb:'AWB1',bookingDate:'2026-11-02',jpCode:'JP1001',customerName:'MAHADEV LOGISTICS',weight:4},
 {awb:'INVALID',bookingDate:'2026-11-32',jpCode:'JP1004',customerName:'Tiny Shipment',weight:700}
];
assert.deepEqual(jepoCustomerAvailableMonths(shipments),['2026-11']);
const daily=jepoCustomerPeriodSummary(shipments,{period:'daily'});
assert.equal(daily.shipments,7,'Each AWB counts once, invalid dates ignored');
assert.equal(daily.kg,26,'Unmapped and all services still included in total kg');
assert.equal(daily.missingWeights,2);
assert.equal(daily.unmappedCodes,2);
assert.equal(daily.missingJpCodes,1);
assert.equal(daily.missingBookingDates,1);
assert.equal(daily.rows.find(r=>r.jpCode==='JP1001').kg,4);
assert.equal(daily.rows.find(r=>r.jpCode==='JP2001').kg,6);
assert.equal(daily.rows.find(r=>r.jpCode==='UNASSIGNED').shipments,1);
const weekly=jepoCustomerPeriodSummary(shipments,{period:'weekly'});
assert.equal(weekly.rows.filter(r=>r.jpCode==='JP1002')[0].shipments,2);
assert.ok(weekly.rows.every(r=>['2026-11-02','2026-10-26'].includes(r.periodStart)));
const monthly=jepoCustomerPeriodSummary(shipments,{period:'monthly'});
assert.equal(monthly.rows.find(r=>r.jpCode==='JP1002').kg,11);
assert.equal(monthly.rows.length,6);
assert.ok(monthly.rows.every(r=>r.periodStart==='2026-11-01'));
assert.equal(jepoCustomerPeriodSummary(shipments,{period:'monthly',month:'2026-10'}).shipments,0);
assert.equal(jepoCustomerPeriodSummary(shipments,{period:'daily',search:'mahadev'}).shipments,2);
assert.equal(jepoCustomerPeriodSummary(shipments,{period:'daily',search:'JP1002'}).shipments,2);
assert.throws(()=>jepoCustomerPeriodSummary(shipments,{period:'yearly'}));
const top=jepoTopCustomers(shipments,{limit:20});
assert.equal(top.allShipments,7);
assert.equal(top.allKg,26);
assert.equal(top.unmappedShipments,2);
assert.equal(top.rankedCustomerCount,3);
assert.deepEqual(top.rows.map(x=>[x.customerName,x.shipments,x.kg]),[
 ['Other Customer',2,11],['MAHADEV LOGISTICS',2,10],['Tiny Shipment',1,0]
]);
assert.deepEqual(top.rows[1].jpCodes,['JP1001','JP2001'],'Customer is combined across three sets of JP codes');
assert.equal(jepoTopCustomers(shipments,{limit:1}).rows.length,1);
assert.equal(jepoTopCustomers(shipments,{month:'2026-10'}).allShipments,0);
const ui=readFileSync('app/JEPOCustomerLoadSummary.js','utf8');
const dashboard=readFileSync('app/JEPOTrackingDashboard.js','utf8');
assert.ok(ui.includes('Top 20 Customers by Total Load'));
assert.ok(ui.includes('JP Code-wise Load Breakdown'));
assert.ok(ui.includes("value:'weekly',label:'Weekly'"));
assert.ok(ui.includes("value:'monthly',label:'Monthly'"));
assert.ok(ui.includes('Download Excel (Both Reports)'));
assert.ok(ui.includes('Download Top 20 CSV'));
assert.ok(ui.includes('Download {period[0].toUpperCase()+period.slice(1)} CSV'));
assert.ok(dashboard.includes("['CUSTOMER_LOAD','JP Code Customer Load']"));
assert.ok(dashboard.includes('tab===\'CUSTOMER_LOAD\'?<JEPOCustomerLoadSummary records={rows}/>'));
console.log('JEPO JP-Code daily/weekly/monthly, customer Top 20 by weight, Excel/CSV exports and no duplicate AWBs verified.');
