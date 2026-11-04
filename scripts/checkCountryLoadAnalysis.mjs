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
console.log('Country analysis: Import/Export parser, weighted average, bucket boundaries and custom mapping passed.');
