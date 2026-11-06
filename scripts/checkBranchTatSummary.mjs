import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inclusiveTatDays,summarizeBranchTat,tatServiceName,tatDestinationName,tatCountryGroup} from '../lib/branchTatSummary.js';

assert.equal(inclusiveTatDays('2026-11-05','2026-11-05'),1);
assert.equal(inclusiveTatDays('2026-11-03','2026-11-05'),3);
assert.equal(inclusiveTatDays('2026-10-31','2026-11-02'),3);
assert.equal(inclusiveTatDays('2024-02-28','2024-03-01'),3);
assert.equal(inclusiveTatDays('2026-11-05','2026-11-03'),null);
assert.equal(inclusiveTatDays('2026-02-30','2026-03-02'),null);
assert.equal(inclusiveTatDays('2026-11-03',''),null);
assert.equal(tatServiceName('fed ex'), 'FedEx');
assert.equal(tatServiceName('tpl'),'TPL');
assert.equal(tatDestinationName('United Kingdom'),'UK');
assert.equal(tatDestinationName('U.S.A.'),'USA');
assert.equal(tatServiceName('EMS Speed Post'),'Speed Post');
assert.equal(tatServiceName('SPEED POST'),'Speed Post');
assert.equal(tatCountryGroup('Germany'),'Other Countries');
assert.equal(tatCountryGroup('United Kingdom'),'UK');
const delivered=(branch,service,destination,date,deliveredOn)=>({branch,service,destination,date,deliveredOn,status:'DELIVERED'});
const source=[
  delivered('JIND','FedEx','USA','2026-11-01','2026-11-03'), // 3 days
  delivered('JIND','FEDEX','United States','2026-11-01','2026-11-05'), // 5 days
  delivered('KARNAL','TPL','United Kingdom','2026-11-02','2026-11-05'), // 4 days
  delivered('JIND','TPL','Canada','2026-11-02','2026-11-02'), // 1 day
  delivered('JIND','DHL','Australia','2026-11-01',''), // missing date
  {...delivered('KARNAL','FedEx','Australia','2026-11-02','2026-11-06'),status:'IN_TRANSIT'},
  delivered('KARNAL','Aramex','Germany','2026-11-04','2026-11-02') // invalid chronological order
];
const all=summarizeBranchTat(source);
assert.equal(all.deliveredCount,6);
assert.equal(all.verifiedCount,4);
assert.equal(all.missingDateCount,2);
assert.equal(all.averageDays,3.3);
const fedex=all.byService.find(v=>v.name==='FedEx');
assert.deepEqual(fedex,{name:'FedEx',count:2,averageDays:4,fastest:3,slowest:5});
assert.deepEqual(all.byDestination.slice(0,4).map(v=>v.name),['USA','UK','Canada','Australia']);
assert.equal(all.byDestination[0].averageDays,4);
assert.equal(all.byDestination[1].averageDays,4);
assert.equal(all.byDestination[2].averageDays,1);
assert.equal(all.byDestination[3].averageDays,null);
const jind=summarizeBranchTat(source.filter(r=>r.branch==='JIND'));
assert.equal(jind.verifiedCount,3);
assert.equal(jind.averageDays,3);
const fedexMatrix=all.byServiceCountry.find(service=>service.service==='FedEx');
const fedexUsa=fedexMatrix.countries.find(country=>country.name==='USA');
assert.equal(fedexUsa.count,2);
assert.equal(fedexUsa.averageDays,4);
assert.equal(fedexMatrix.countries.find(country=>country.name==='UK').count,0);
assert.deepEqual(fedexMatrix.countries.slice(0,5).map(country=>country.name),['USA','UK','Australia','Canada','Other Countries']);
const tplMatrix=all.byServiceCountry.find(service=>service.service==='TPL');
assert.equal(tplMatrix.countries.find(country=>country.name==='UK').averageDays,4);
assert.equal(tplMatrix.countries.find(country=>country.name==='Canada').averageDays,1);
assert.equal(all.byServiceCountry.find(service=>service.service==='Speed Post').count,0);
assert.equal(all.byServiceCountry.find(service=>service.service==='Self').count,0);
const grouped=summarizeBranchTat([
  delivered('JIND','EMS Speed Post','USA','2026-11-02','2026-11-04'),
  delivered('JIND','Self','Germany','2026-11-02','2026-11-08'),
  delivered('KARNAL','Self','France','2026-11-02','2026-11-04'),
  delivered('KARNAL','Self','Canada','2026-11-02','2026-11-06'),
  delivered('KARNAL','Speed Post','Australia','2026-11-02','')
]);
assert.equal(grouped.verifiedCount,4);
const speedPost=grouped.byServiceCountry.find(service=>service.service==='Speed Post');
assert.equal(speedPost.countries.find(country=>country.name==='USA').averageDays,3);
assert.equal(speedPost.countries.find(country=>country.name==='Australia').count,0);
const self=grouped.byServiceCountry.find(service=>service.service==='Self');
assert.equal(self.countries.find(country=>country.name==='Other Countries').count,2);
assert.equal(self.countries.find(country=>country.name==='Other Countries').averageDays,5);
assert.equal(self.countries.find(country=>country.name==='Canada').averageDays,5);
assert.equal(grouped.byServiceCountry.reduce((sum,service)=>sum+service.countries.reduce((s,c)=>s+c.count,0),0),grouped.verifiedCount);
const branchLib=readFileSync('lib/branchLoads.js','utf8');
assert.ok(branchLib.includes("'Speed Post'"),'Speed Post must be selectable as a branch service');
const ui=readFileSync('app/BranchLoadsDashboard.js','utf8');
assert.ok(ui.includes("summarizeBranchTat(shown)"), 'TAT must respect branch/search-filtered visible deliveries');
assert.ok(ui.includes("sheet==='DELIVERED'&&<section className={styles.tatSummarySection}"));
assert.ok(ui.includes('Download TAT Summary CSV'));
assert.ok(ui.includes("title:'TAT by Service'")&&ui.includes("title:'TAT by Country'"),'Excel must include summary sheets');
assert.ok(ui.includes('Company × Country-wise TAT'),'Company × country table must be visible');
assert.ok(ui.includes("matrixSheet=workbook.addWorksheet('TAT by Company Country')"),'Company × country Excel tab must be generated');
assert.ok(ui.includes("'Company × Country',service.service,country.name"),'Company × country rows must be in CSV');
console.log('Branch TAT summary: inclusive days, per-company country matrix, missing dates, branch filters and exports verified.');
