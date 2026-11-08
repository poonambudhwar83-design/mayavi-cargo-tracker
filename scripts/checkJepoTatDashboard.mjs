import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  jepoTatService,jepoTatDateReason,jepoTatDays,availableJepoTatMonths,summarizeJepoTat
} from '../lib/jepoTatSummary.js';

assert.equal(jepoTatService('EX-DEL-FEDEX'),'FedEx');
assert.equal(jepoTatService('EX-DEL-SELF-UK-SPL'),'Self — UK');
assert.equal(jepoTatService('EX-DEL-SELF-YYZ-SPL'),'Self — Canada');
assert.equal(jepoTatService('EX-DEL-SELF-US'),'Self — USA');
assert.equal(jepoTatService('EX-DEL-SELFO-AUS-SPL'),'Self — Australia');
assert.equal(jepoTatService('EX-DEL-SELF-EUR-SPL'),'Self — Europe');
assert.equal(jepoTatService('EX-DEL-ARAMEX-AUSTRALIA'),'Aramex');
const records=[
 {awb:'A',bookingDate:'2026-10-30',deliveredOn:'2026-11-04',status:'DELIVERED',service:'EX-DEL-FEDEX',vendor:'INTEGRATED COURIERS AND LOGISTICS',destination:'United States Of America'},
 {awb:'B',bookingDate:'2026-10-31',deliveredOn:'2026-11-04',status:'DELIVERED',service:'EX-DEL-FEDEX',vendor:'INTEGRATED COURIERS AND LOGISTICS',destination:'USA'},
 {awb:'C',bookingDate:'2026-11-01',deliveredOn:'2026-11-03',status:'DELIVERED',service:'EX-DEL-SELF-UK-SPL',vendor:'TRANSIT POINT LOGISTICS PRIVATE LIMITED',destination:'UK'},
 {awb:'D',bookingDate:'2026-11-02',deliveredOn:null,status:'DELIVERED',service:'EX-DEL-SELF-UK-SPL',vendor:'TRANSIT POINT LOGISTICS PRIVATE LIMITED',destination:'UK'},
 {awb:'E',bookingDate:'2026-11-03',deliveredOn:'2026-11-02',status:'DELIVERED',service:'EX-DEL-SELF-EUR-SPL',vendor:'TRANSIT POINT LOGISTICS PRIVATE LIMITED',destination:'Germany'},
 {awb:'F',bookingDate:'2026-11-04',deliveredOn:'2026-11-06',status:'DELIVERED',service:'EX-DEL-SELF',vendor:'OVERSEAS',destination:'CANADA'},
 {awb:'G',bookingDate:'2026-11-04',deliveredOn:null,status:'IN_TRANSIT',service:'EX-DEL-SELF',vendor:'OVERSEAS',destination:'CANADA'},
 {awb:'H',bookingDate:'2026-10-20',deliveredOn:'2026-10-20',status:'DELIVERED',service:'EX-DEL-ARAMEX-AUSTRALIA',vendor:'ECO SHIPPING',destination:'Australia'}
];
assert.equal(jepoTatDays(records[0]),6,'Inclusive booking plus actual delivery dates');
assert.equal(jepoTatDays(records[1]),5);
assert.equal(jepoTatDays(records[2]),3);
assert.equal(jepoTatDays(records[3]),null);
assert.equal(jepoTatDateReason(records[3]),'Missing Delivery Date');
assert.equal(jepoTatDays(records[4]),null);
assert.equal(jepoTatDateReason(records[4]),'Delivery Before Booking');
assert.equal(jepoTatDateReason(records[6]),'Not Delivered');
assert.equal(jepoTatDays(records[7]),1,'Same day delivery is 1 day');
assert.deepEqual(availableJepoTatMonths(records),['2026-11','2026-10']);

const full=summarizeJepoTat(records);
assert.equal(full.totalAwbs,8);
assert.equal(full.active,1);
assert.equal(full.overall.delivered,7);
assert.equal(full.overall.verified,5);
assert.equal(full.overall.missingDate,1);
assert.equal(full.overall.invalidDate,1);
assert.equal(full.overall.totalDays,18);
assert.equal(full.overall.average,3.6);
assert.equal(full.overall.fastest,1);
assert.equal(full.overall.slowest,6);
assert.equal(full.byPartner.find(x=>x.label==='FedEx').verified,2);
assert.equal(full.byPartner.find(x=>x.label==='TPL').delivered,3);
assert.equal(full.byPartner.find(x=>x.label==='Overseas').average,3);
assert.equal(full.byCountry.find(x=>x.label==='USA').delivered,2);
assert.equal(full.byCountry.find(x=>x.label==='Other Countries').invalidDate,1);
assert.equal(full.byPartnerCountry.find(x=>x.partner==='FedEx'&&x.country==='USA').average,5.5);
assert.equal(full.byPartnerCountry.find(x=>x.partner==='TPL'&&x.country==='UK').missingDate,1);
assert.equal(full.deliveredRows[0].tatDays,null,'AWBs requiring date review shown first');

const nov=summarizeJepoTat(records,{month:'2026-11'});
assert.equal(nov.totalAwbs,5);
assert.equal(nov.overall.delivered,4);
assert.equal(nov.overall.verified,2);
assert.equal(nov.overall.missingDate,1);
assert.equal(nov.overall.invalidDate,1);
assert.equal(summarizeJepoTat(records,{partner:'FedEx'}).overall.delivered,2);
assert.equal(summarizeJepoTat(records,{country:'UK'}).overall.delivered,2);
assert.equal(summarizeJepoTat([...records,records[0]]).overall.delivered,7,'Unique JEPO AWB never double counts');
for(const group of [full.byPartner,full.byCountry,full.byService,full.byPartnerCountry]){
 assert.equal(group.reduce((s,r)=>s+r.delivered,0),full.overall.delivered,'Group totals reconcile with delivered count');
 assert.equal(group.reduce((s,r)=>s+r.verified,0),full.overall.verified,'Verified group count reconciles');
}

const ui=readFileSync('app/JEPOTrackingDashboard.js','utf8');
const page=readFileSync('app/JEPOTatDashboard.js','utf8');
const haryana=readFileSync('app/HaryanaAdminDashboard.js','utf8');
assert.ok(ui.includes("tab==='TAT'?<JEPOTatDashboard records={rows}/>"));
assert.ok(ui.includes("['MONTHLY','Monthly Data']"),'Monthly Data remains available');
assert.ok(haryana.includes('<JEPOTrackingDashboard readOnly/>'),'Haryana Admin gets identical read-only TAT');
assert.ok(page.includes('Courier × Country TAT'));
assert.ok(page.includes('Delivery Date Missing'));
assert.ok(page.includes('Invalid Date Order'));
assert.ok(page.includes('Download Excel')&&page.includes('Download CSV'));
assert.ok(page.includes('jepo-tat-'));
assert.ok(page.includes('detail.slice(0,250)'),'Large reports do not lock up the browser');
console.log('JEPO TAT carrier×country, month, verified dates, excluded anomalies, exports and Haryana visibility passed.');
