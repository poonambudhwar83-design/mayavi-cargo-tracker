import assert from 'node:assert/strict';
import { parseCountryWorkbook, summarizeCountryRows, bucketFor } from '../lib/countryLoadAnalysis.js';
const row=values=>({
  hasValues:values.some(x=>x!==''&&x!==null&&x!==undefined),
  cellCount:values.length,
  getCell(i){return {value:values[i-1]??''};}
});
const sheet=(name,data)=>({name,state:'visible',rowCount:data.length,getRow(i){return row(data[i-1]||[]);}});
const workbook={worksheets:[sheet('Import loads',[
  ['Courier Name','Weight kg','No of Bags','Country'],
  ['DHL','87 kg',3,'UK'],
  ['DHL',60,2,'UK'],
  ['DHL',70,2,'UK'],
  ['DHL',72,2,'USA'],
  ['FedEx',200,5,'USA'],
  ['Grand Total',489,14,''],
  ['Invalid',100,0,'']
])]};
const parsed=parseCountryWorkbook(workbook);
assert.equal(parsed.rows.length,5);
assert.equal(parsed.skipped,2);
const summary=summarizeCountryRows(parsed.rows),dhl=summary.find(x=>x.courierName==='DHL');
assert.equal(dhl.entries,4);
assert.equal(dhl.totalWeight,289);
assert.equal(dhl.totalBags,9);
assert.equal(dhl.under30,87);
assert.equal(dhl.from30To35,130);
assert.equal(dhl.over35,72);
assert.equal(bucketFor(29.9,1),'under30');
assert.equal(bucketFor(30,1),'from30To35');
assert.equal(bucketFor(35,1),'from30To35');
assert.equal(bucketFor(35.01,1),'over35');
assert.equal(summary.find(x=>x.courierName==='FedEx').over35,200);
const mapped=parseCountryWorkbook({worksheets:[sheet('Other format',[
  ['Logistics Partner','Net Mass','Count','Market'],
  ['Atlas Cargo',120,4,'Canada']
])]}, {courier:'Logistics Partner',weight:'Net Mass',bags:'Count',country:'Market'});
assert.equal(mapped.rows[0].avgBagKg,30);
assert.equal(mapped.rows[0].country,'Canada');
// Actual user-uploaded airline Excel headings observed in production runtime logs.
const actualExcel={worksheets:[sheet('Sheet1',[
  ['Sr','FLT NO','FLT DATE','IGM','MAWBNO','CourierCoName','Bags','Weight','Origin'],
  [1,'AI101','2026-11-04','IGM1','098-12345678','Courier A',10,360,'DXB'],
  [2,'AI101','2026-11-04','IGM1','098-12345679','Courier B',8,280,'JFK'],
  [3,'AI101','2026-11-04','IGM1','098-12345680','Courier A',5,200,'DXB'],
  [4,'AI101','2026-11-04','IGM1','098-12345681','Courier C',2,50,'DEL'],
  [5,'AI101','2026-11-04','IGM1','098-12345682','Courier B',1,20,'JFK']
])]};
const actual=parseCountryWorkbook(actualExcel);
assert.equal(actual.rows.length,5,'Parse actual CourierCoName/Bags/Weight Excel format.');
assert.equal(actual.rows[0].courierName,'Courier A');
assert.equal(actual.rows[0].country,'DXB');
const sorted=summarizeCountryRows(actual.rows);
assert.deepEqual(sorted.map(r=>r.courierName),['Courier A','Courier B','Courier C'],
  'Couriers must sort by total imported kg from highest to lowest.');
assert.deepEqual(sorted.map(r=>r.totalWeight),[560,300,50]);
assert.equal(sorted[0].totalBags,15);
assert.equal(sorted[0].avgBagKg,560/15);
assert.equal(sorted[0].from30To35,0);
assert.equal(sorted[0].over35,560);
assert.equal(sorted[1].from30To35,280);
assert.equal(sorted[1].under30,20);
console.log('Country analysis: real CourierCoName airline Excel format and descending Import totals passed.');
console.log('Country analysis: Import/Export parser, weighted average, bucket boundaries and custom mapping passed.');
