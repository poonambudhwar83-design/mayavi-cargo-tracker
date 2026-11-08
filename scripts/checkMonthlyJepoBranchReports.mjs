import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {aggregateBranchMonthly,branchMonths} from '../lib/branchMonthlySummary.js';
import {aggregateJepoMonthly,availableJepoMonths,jepoMonthlyPartner,jepoMonthlyCountry} from '../lib/jepoMonthlySummary.js';

const branch=[
 {id:'1',date:'2026-10-31',branch:'JIND',status:'DELIVERED',weight:10,amount:1000,received:1000,balance:0,paidToJepo:800,extraCost:0,commodity:'Documents',service:'FedEx',destination:'UK'},
 {id:'2',date:'2026-11-01',branch:'JIND',status:'AT_JIND_OFFICE',weight:5,amount:1000,received:750,balance:250,paidToJepo:600,extraCost:0,commodity:'Documents',service:'TPL',destination:'Canada'},
 {id:'3',date:'2026-11-02',branch:'KARNAL',status:'DELIVERED',weight:8,amount:1600,received:1600,balance:0,paidToJepo:1200,extraCost:800,commodity:'Household and Medicine',service:'Self',destination:'USA'},
 {id:'4',date:'2026-10-28',branch:'KARNAL',status:'DELIVERED',weight:3,amount:600,received:500,balance:100,paidToJepo:300,extraCost:0,commodity:'Documents',service:'DHL',destination:'Australia'}
];
assert.deepEqual(branchMonths(branch),['2026-11','2026-10']);
const novBranch=aggregateBranchMonthly(branch,{month:'2026-11'});
assert.equal(novBranch.selectedRows.length,2);
assert.equal(novBranch.grand.loads,2);
assert.equal(novBranch.grand.weight,13);
assert.equal(novBranch.grand.amount,2600);
assert.equal(novBranch.grand.received,2350);
assert.equal(novBranch.grand.balance,250);
assert.equal(novBranch.grand.delivered,1);
assert.equal(novBranch.grand.active,1);
assert.equal(novBranch.grand.paidToJepo,1800);
assert.equal(novBranch.grand.paidToBranch,900,'Extra Cost residual 100 to branch plus 400 + 400');
assert.equal(novBranch.grand.totalJepo,2500,'700 from extra cost correctly included as JEPO cash');
assert.equal(novBranch.history.length,4,'Historical months never disappear when current month is selected');
assert.equal(aggregateBranchMonthly(branch.filter(r=>r.branch==='JIND'),{month:'2026-11'}).grand.loads,1);
assert.equal(aggregateBranchMonthly(branch,{month:'2026-10'}).grand.loads,2,'Delivered must stay in original booking month');

const jepo=[
 {awb:'100',bookingDate:'2026-10-31',status:'DELIVERED',checkedAt:'2026-11-08',weight:10,service:'EX-DEL-FEDEX',vendor:'INTEGRATED COURIERS AND LOGISTICS',destination:'UK'},
 {awb:'101',bookingDate:'2026-11-01',status:'PENDING',checkedAt:null,weight:5,service:'EX-DEL-FEDEX',vendor:'INTEGRATED COURIERS AND LOGISTICS',destination:'United States Of America'},
 {awb:'102',bookingDate:'2026-11-02',status:'IN_TRANSIT',checkedAt:'2026-11-08',weight:6.5,service:'EX-DEL-SELF-UK-SPL',vendor:'TRANSIT POINT LOGISTICS PRIVATE LIMITED',destination:'United Kingdom'},
 {awb:'103',bookingDate:'2026-11-02',status:'DELIVERED',checkedAt:'2026-11-08',weight:4,service:'EX-DEL-SELF',vendor:'OVERSEAS',destination:'CANADA'},
 {awb:'104',bookingDate:'2026-11-03',status:'PENDING',checkedAt:null,weight:null,service:'EX-DEL-SELF',vendor:'OTHER VENDOR',destination:'Germany'}
];
assert.deepEqual(availableJepoMonths(jepo),['2026-11','2026-10']);
assert.equal(jepoMonthlyPartner(jepo[0]),'FedEx','FedEx classification by service, not ICL vendor');
assert.equal(jepoMonthlyPartner(jepo[2]),'TPL');
assert.equal(jepoMonthlyPartner(jepo[3]),'Overseas');
assert.equal(jepoMonthlyCountry(jepo[1]),'USA');
assert.equal(jepoMonthlyCountry(jepo[2]),'UK');
const novJepo=aggregateJepoMonthly(jepo,{month:'2026-11'});
assert.equal(novJepo.grand.shipments,4);
assert.equal(novJepo.grand.weight,15.5);
assert.equal(novJepo.grand.delivered,1);
assert.equal(novJepo.grand.active,3);
assert.equal(novJepo.grand.checked,2);
assert.equal(novJepo.grand.missingWeight,1);
assert.equal(novJepo.byDay.find(r=>r.date==='2026-11-02').shipments,2);
assert.equal(novJepo.byCountry.find(r=>r.label==='USA').weight,5);
assert.equal(novJepo.byPartner.find(r=>r.label==='FedEx').shipments,1);
assert.equal(aggregateJepoMonthly(jepo,{month:'2026-11',partner:'TPL'}).grand.shipments,1);
assert.equal(novJepo.history.length,5,'History shows month/partner across all saved records');
assert.equal(aggregateJepoMonthly(jepo,{month:'2026-10'}).grand.delivered,1);
assert.equal(aggregateJepoMonthly([...jepo,jepo[0]],{month:'2026-10'}).grand.shipments,1,'Same AWB never double counted');

const branchUI=readFileSync('app/BranchLoadsDashboard.js','utf8');
const jepoUI=readFileSync('app/JEPOTrackingDashboard.js','utf8');
const haryana=readFileSync('app/HaryanaAdminDashboard.js','utf8');
const branchMonthUI=readFileSync('app/BranchMonthlyDashboard.js','utf8');
const jepoMonthUI=readFileSync('app/JEPOMonthlyDashboard.js','utf8');
assert.ok(branchUI.includes("switchSheet('MONTHLY')"));
assert.ok(branchUI.includes("sheet==='MONTHLY'&&<BranchMonthlyDashboard records={matchingRows}"),'Branch records scoped to signed-in branch and selected filter');
assert.ok(branchUI.includes("sheet!=='SUMMARY'&&sheet!=='MONTHLY'&&<div"),'Do not display old sheet twice over Monthly');
assert.ok(jepoUI.includes("['MONTHLY','Monthly Data']"));
assert.ok(jepoUI.includes("tab==='MONTHLY'?<JEPOMonthlyDashboard records={rows}/>"));
assert.ok(haryana.includes('<BranchLoadsDashboard currentUser={currentUser}/>'));
assert.ok(haryana.includes('<JEPOTrackingDashboard readOnly/>'));
assert.ok(branchMonthUI.includes('Download Excel')&&branchMonthUI.includes('Download CSV'));
assert.ok(jepoMonthUI.includes('Download Excel')&&jepoMonthUI.includes('Download CSV'));
console.log('Jind/Karnal + JEPO monthly booking-date grouping, finance, FedEx partner, exports and Haryana scope tests passed.');
