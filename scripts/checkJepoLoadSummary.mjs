import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 JEPO_LOAD_COUNTRIES,JEPO_FEDEX_COUNTRIES,jepoLoadVendor,jepoLoadCountry,
 jepoLoadWeek,buildJepoLoadSummary,buildJepoFedexDailySummary,
 jepoFedexMonths,jepoLoadAvailableMonths,jepoIsFedexService,
 JEPO_OVERALL_LOAD_GROUPS,jepoOverallLoadMonths,jepoOverallLoadGroup,buildJepoOverallLoadSummary
} from '../lib/jepoLoadSummary.js';

assert.equal(jepoLoadVendor('TRANSIT POINT LOGISTICS PRIVATE LIMITED'),'TPL');
assert.equal(jepoLoadVendor('TPL'),'TPL');
assert.equal(jepoLoadVendor('OVERSEAS'),'Overseas');
assert.equal(jepoLoadVendor('Overseas Log.'),'Overseas');
assert.equal(jepoLoadVendor('INTEGRATED COURIERS AND LOGISTICS'),null);
assert.equal(jepoLoadCountry('United States Of America'),'USA');
assert.equal(jepoLoadCountry('UK'),'UK');
assert.equal(jepoLoadCountry('CANADA'),'Canada');
assert.equal(jepoLoadCountry('Australia'),'Australia');
assert.equal(jepoLoadCountry('Germany'),null);
assert.equal(jepoIsFedexService('EX-DEL-FEDEX'),true);
assert.equal(jepoIsFedexService('EX-DEL-SELF-US'),false);
assert.equal(jepoLoadWeek('2026-11-01').start,'2026-10-26');
assert.equal(jepoLoadWeek('2026-11-01').end,'2026-11-01');
assert.equal(jepoLoadWeek('2026-11-02').start,'2026-11-02');
assert.deepEqual(JEPO_LOAD_COUNTRIES,['UK','USA','Canada','Australia','Other Countries']);
assert.deepEqual(JEPO_FEDEX_COUNTRIES,['UK','USA','Canada','Australia','Other Countries']);

const shipments=[
 {awb:'1',vendor:'TRANSIT POINT LOGISTICS PRIVATE LIMITED',service:'EX-DEL-SELF-UK',destination:'UK',bookingDate:'2026-11-01',weight:5},
 {awb:'2',vendor:'TPL',service:'SELF',destination:'United States Of America',bookingDate:'2026-11-02',weight:4.5},
 {awb:'3',vendor:'OVERSEAS',service:'EX-DEL-SELF-UK',destination:'CANADA',bookingDate:'2026-11-02',weight:7},
 {awb:'4',vendor:'OVERSEAS LOG.',service:'EX-DEL-SELF',destination:'Australia',bookingDate:'2026-11-03',weight:8.5},
 {awb:'5',vendor:'INTEGRATED COURIERS AND LOGISTICS',service:'EX-DEL-FEDEX',destination:'United States Of America',bookingDate:'2026-11-02',weight:10},
 {awb:'6',vendor:'INTEGRATED COURIERS AND LOGISTICS',service:'EX-DEL-FEDEX',destination:'UK',bookingDate:'2026-11-02',weight:1},
 {awb:'7',vendor:'INTEGRATED COURIERS AND LOGISTICS',service:'EX-DEL-FEDEX',destination:'Germany',bookingDate:'2026-11-02',weight:3},
 {awb:'8',vendor:'INTEGRATED COURIERS AND LOGISTICS',service:'EX-DEL-FEDEX',destination:'Canada',bookingDate:'2026-11-03',weight:2},
 {awb:'9',vendor:'INTEGRATED COURIERS AND LOGISTICS',service:'EX-DEL-FEDEX',destination:'Australia',bookingDate:'2026-11-03',weight:4},
 {awb:'10',vendor:'TRANSIT POINT LOGISTICS PRIVATE LIMITED',service:'SELF',destination:'Canada',bookingDate:'',weight:15},
 {awb:'11',vendor:'TRANSIT POINT LOGISTICS PRIVATE LIMITED',service:'SELF',destination:'UK',bookingDate:'2026-11-03',weight:null}
];
const daily=buildJepoLoadSummary(shipments,{period:'daily'});
assert.equal(daily.shipments,10); // ICL FedEx service is now shown as FedEx without adding it to TPL or Overseas
assert.equal(daily.kg,45);
assert.equal(daily.missingBookingDates,1);
assert.equal(daily.missingWeights,1);
assert.equal(daily.rows.find(x=>x.periodStart==='2026-11-02'&&x.vendor==='TPL').countries.USA.kg,4.5);
assert.equal(daily.rows.find(x=>x.periodStart==='2026-11-02'&&x.vendor==='FedEx').countries['Other Countries'].kg,3);
assert.equal(daily.rows.some(x=>x.periodStart==='2026-11-01'&&x.vendor==='FedEx'),false);
assert.deepEqual(daily.vendorTotals.map(x=>x.vendor),['TPL','Overseas','FedEx']);
assert.equal(buildJepoLoadSummary(shipments,{period:'daily',vendor:'DHL'}).rows.length,0);
assert.equal(buildJepoLoadSummary(shipments,{period:'daily',vendor:'DHL'}).vendorTotals.length,0);
assert.equal(daily.rows.find(x=>x.periodStart==='2026-11-03'&&x.vendor==='Overseas').countries.Australia.shipments,1);
assert.deepEqual(jepoLoadAvailableMonths(shipments),['2026-11']);

const weekly=buildJepoLoadSummary(shipments,{period:'weekly'});
assert.equal(weekly.rows.find(x=>x.periodStart==='2026-10-26').kg,5);
assert.equal(weekly.rows.find(x=>x.periodStart==='2026-11-02'&&x.vendor==='TPL').kg,4.5);
assert.equal(weekly.rows.find(x=>x.periodStart==='2026-11-02'&&x.vendor==='Overseas').kg,15.5);
assert.equal(weekly.rows.find(x=>x.periodStart==='2026-11-02'&&x.vendor==='FedEx').kg,20);
assert.equal(weekly.rows.some(x=>x.periodStart==='2026-10-26'&&x.vendor==='FedEx'),false);
assert.equal(buildJepoLoadSummary(shipments,{period:'daily',vendor:'TPL'}).shipments,3);
assert.equal(buildJepoLoadSummary(shipments,{period:'daily',month:'2026-10'}).shipments,0);
assert.equal(jepoLoadVendor('Aramax'),'Aramex');
assert.equal(jepoLoadVendor('Aramex Express'),'Aramex');
assert.equal(jepoLoadVendor('DHL EXPRESS'),'DHL');
assert.equal(jepoLoadVendor('ICL','EX-DEL-DHL'),'DHL');
assert.equal(jepoLoadVendor('ICL','EX-DEL-ARAMEX'),'Aramex');
const expanded=[
 {awb:'D1',vendor:'DHL EXPRESS',service:'DHL',destination:'Canada',bookingDate:'2026-11-02',weight:5},
 {awb:'A1',vendor:'ICL',service:'EX-DEL-ARAMAX',destination:'UK',bookingDate:'2026-11-03',weight:4},
 {awb:'F1',vendor:'FedEx',service:'FEDEX',destination:'USA',bookingDate:'2026-11-02',weight:6}
];
const expandedDaily=buildJepoLoadSummary(expanded,{period:'daily'});
assert.deepEqual(expandedDaily.rows.filter(r=>r.periodStart==='2026-11-02').map(r=>r.vendor),['FedEx','DHL']);
assert.deepEqual(expandedDaily.rows.filter(r=>r.periodStart==='2026-11-03').map(r=>r.vendor),['Aramex']);
const expandedWeekly=buildJepoLoadSummary(expanded,{period:'weekly'});
assert.deepEqual(expandedWeekly.rows.map(r=>r.vendor),['FedEx','DHL','Aramex']);
assert.equal(expandedWeekly.shipments,3);
assert.equal(buildJepoLoadSummary(expanded,{period:'weekly',vendor:'TPL'}).rows.length,0);

const fedex=buildJepoFedexDailySummary(shipments);
assert.equal(fedex.shipments,5);
assert.equal(fedex.kg,20);
assert.equal(fedex.rows.find(r=>r.date==='2026-11-02').shipments,3);
assert.equal(fedex.rows.find(r=>r.date==='2026-11-02').countries.USA.kg,10);
assert.equal(fedex.rows.find(r=>r.date==='2026-11-02').countries.UK.kg,1);
assert.equal(fedex.rows.find(r=>r.date==='2026-11-02').countries['Other Countries'].kg,3);
assert.equal(fedex.rows.find(r=>r.date==='2026-11-03').countries.Canada.kg,2);
assert.equal(fedex.rows.find(r=>r.date==='2026-11-03').countries.Australia.kg,4);
assert.deepEqual(jepoFedexMonths(shipments),['2026-11']);
assert.equal(buildJepoFedexDailySummary(shipments,{month:'2026-10'}).shipments,0);

const page=readFileSync('app/JEPOTrackingDashboard.js','utf8');
const partners=readFileSync('app/JEPOLoadSummary.js','utf8');
const fedexUI=readFileSync('app/JEPOFedexLoadSummary.js','utf8');
assert.ok(page.includes("['DAILY','Daily Load']")&&page.includes("['WEEKLY','Weekly Load']"));
assert.ok(page.includes('<JEPOLoadSummary records={rows} period="weekly"/>'));
assert.ok(page.includes('<JEPOFedexLoadSummary records={rows}/>'));
assert.ok(partners.includes('Download CSV'));
assert.ok(fedexUI.includes('Download FedEx CSV'));

const extra=[
 ...shipments,
 {awb:'12',vendor:'UNLISTED LAST MILE',service:'CUSTOM',destination:'Germany',bookingDate:'2026-11-02',weight:9.25},
 {awb:'13',vendor:'INTEGRATED COURIERS AND LOGISTICS',service:'LOCAL OTHER',destination:'USA',bookingDate:'2026-11-03',weight:2},
 {...shipments[1]}, // Repeated AWB must count once.
 {awb:'INVALID',vendor:'TPL',service:'SELF',bookingDate:'2026-11-32',weight:900}
];
const allDaily=buildJepoOverallLoadSummary(extra,{period:'daily'});
const allWeekly=buildJepoOverallLoadSummary(extra,{period:'weekly'});
const allMonthly=buildJepoOverallLoadSummary(extra,{period:'monthly'});
assert.equal(allDaily.shipments,12,'All TPL, Overseas, FedEx and unknown services included once per AWB');
assert.equal(allDaily.kg,56.25,'All booked service weights reconcile including unknown vendors');
assert.equal(allDaily.missingWeights,1);
assert.equal(allDaily.missingBookingDates,2);
assert.deepEqual(allDaily.rows.map(x=>x.periodStart),['2026-11-03','2026-11-02','2026-11-01']);
assert.equal(allDaily.rows.find(r=>r.periodStart==='2026-11-02').kg,34.75);
assert.equal(allDaily.rows.find(r=>r.periodStart==='2026-11-02').byService['Other Services'].kg,9.25);
assert.equal(allWeekly.rows.find(r=>r.periodStart==='2026-11-02').kg,51.25);
assert.deepEqual(allMonthly.rows.map(r=>r.periodStart),['2026-11-01']);
assert.equal(allMonthly.rows[0].kg,56.25);
assert.equal(allMonthly.rows[0].shipments,12);
assert.deepEqual(jepoOverallLoadMonths(extra),['2026-11']);
assert.equal(jepoOverallLoadGroup({vendor:'ICL',service:'EX-DEL-FEDEX'}),'FedEx');
assert.equal(jepoOverallLoadGroup({vendor:'random business',service:'unknown'}),'Other Services');
assert.deepEqual(JEPO_OVERALL_LOAD_GROUPS,['TPL','Overseas','FedEx','DHL','Aramex','Other Services']);
assert.equal(buildJepoOverallLoadSummary(extra,{period:'monthly',month:'2026-10'}).shipments,0);
assert.ok(page.includes("['MONTHLY_LOAD','Monthly Load']"));
assert.ok(page.includes('<JEPOOverallLoadSummary records={rows} period="daily"/>'));
assert.ok(page.includes('<JEPOOverallLoadSummary records={rows} period="weekly"/>'));
assert.ok(page.includes('<JEPOOverallLoadSummary records={rows} period="monthly"/>'));
const allServicesUI=readFileSync('app/JEPOOverallLoadSummary.js','utf8');
assert.ok(allServicesUI.includes('All Services Total Load'));
assert.ok(allServicesUI.includes('Export All Services CSV'));
assert.ok(allServicesUI.includes('JEPO_OVERALL_LOAD_GROUPS.map'));
console.log('JEPO all-service daily, weekly and monthly load totals, unknown couriers, unique AWBs and exports passed.');

console.log('JEPO Daily and weekly load regression for TPL, Overseas, FedEx, DHL and Aramex passed.');
