import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {parseJepoExcel,inspectJepoExcel} from '../lib/jepoExcelImport.js';
import {parseJepoCustomerMap,normalizeJepoJpCode} from '../lib/jepoCustomerMapping.js';

// 132 columns, scrambled fields, header row is far from A1.
const workbook=new ExcelJS.Workbook();
const sheet=workbook.addWorksheet('JEPO Daily Export');
const columns={awb:117,service:5,vendor:62,consignee:90,destination:23,weight:132,jpCode:71,bookingDate:44};
const headers={awb:'AWB NO.',service:'Service Name',vendor:'VENDOR / NAME',consignee:'Consignee Name',
 destination:'Destination Country',weight:'CHG WT. (KG)',jpCode:'JP-Code',bookingDate:'Book Dt'};
for(const [field,col] of Object.entries(columns))sheet.getRow(8).getCell(col).value=headers[field];
sheet.getRow(9).getCell(columns.awb).value=535271;
sheet.getRow(9).getCell(columns.service).value='FedEx';
sheet.getRow(9).getCell(columns.vendor).value='JEPO';
sheet.getRow(9).getCell(columns.consignee).value='Example Receiver';
sheet.getRow(9).getCell(columns.destination).value='USA';
sheet.getRow(9).getCell(columns.weight).value=3.5;
sheet.getRow(9).getCell(columns.jpCode).value='JP-88';
sheet.getRow(9).getCell(columns.bookingDate).value=new Date(Date.UTC(2026,10,6));
let parsed=parseJepoExcel(workbook);
assert.equal(parsed.sheetName,'JEPO Daily Export');
assert.equal(parsed.headerRow,8);
assert.equal(parsed.records.length,1);
assert.deepEqual(parsed.records[0],{awb:'535271',service:'FedEx',vendor:'JEPO',
 consignee:'Example Receiver',destination:'USA',weight:3.5,jpCode:'JP-88',bookingDate:'2026-11-06'});
for(const [field,col] of Object.entries(columns))assert.equal(parsed.columnMapping[field],col);
assert.equal(inspectJepoExcel(workbook)[0].found,8);

// Sectioned headings: Chargeable on the previous row and Weight below.
const sectioned=new ExcelJS.Workbook();
const s=sectioned.addWorksheet('Sheet 2');
const labels=['Waybill No','Service Type','Courier Partner','Recipient Name','Dest Country',
 'Weight','JP Reference','Booking Date'];
labels.forEach((v,i)=>s.getRow(4).getCell(i+2).value=v);
s.getRow(3).getCell(7).value='Chargeable';
['567890','DHL','Partner','Receiver','UK','4.5','JP-4',45965].forEach((v,i)=>s.getRow(5).getCell(i+2).value=v);
parsed=parseJepoExcel(sectioned);
assert.equal(parsed.columnMapping.weight,7);
assert.equal(parsed.records[0].bookingDate,'2025-11-04'); // Excel serial 45965
assert.equal(parsed.records[0].weight,4.5);

// Spreadsheet with extra status dates must not mistake them for Booking Date.
const twoDates=new ExcelJS.Workbook(),d=twoDates.addWorksheet('Report');
['AWB No','Service','Vendor','Consignee Name','Destination','Chargeable Wt','JP Code','Delivered Date','Booking Date']
 .forEach((v,i)=>d.getRow(2).getCell(i+1).value=v);
['123456','TPL','FedEx','Receiver','Canada',5,'JP18','2026-11-08','2026-11-03']
 .forEach((v,i)=>d.getRow(3).getCell(i+1).value=v);
parsed=parseJepoExcel(twoDates);
assert.equal(parsed.columnMapping.bookingDate,9);
assert.equal(parsed.records[0].bookingDate,'2026-11-03');

// Actual JEPO export: requested labels on ROW 1 with many unrelated fields.
const realHeader=new ExcelJS.Workbook(),actual=realHeader.addWorksheet('JEPO Bulk Export');
const actualPositions={jpCode:2,awb:7,service:15,vendor:24,consignee:41,destination:54,weight:70,bookingDate:85};
const actualLabels={jpCode:'Account Code',awb:'AWB',service:'SERVICE',
 vendor:'VENDOR',consignee:'CONSIGNEE NAME',destination:'DESTINATION',
 weight:'CHARG. WEIGHT',bookingDate:'BOOKING DATE'};
for(const [field,col] of Object.entries(actualPositions))actual.getRow(1).getCell(col).value=actualLabels[field];
for(let col=1;col<=95;col++){
 if(Object.values(actualPositions).includes(col))continue;
 actual.getRow(1).getCell(col).value='Unrelated Extra Field '+col;
}
for(const [field,col] of Object.entries(actualPositions)){
 const fields={jpCode:'JEP001',awb:535271,service:'SELF',vendor:'OVERSEAS LOG.',
  consignee:'TEST CONSIGNEE',destination:'UK',weight:'2.75',bookingDate:'07/11/2026'};
 actual.getRow(2).getCell(col).value=fields[field];
}
parsed=parseJepoExcel(realHeader);
assert.equal(parsed.headerRow,1);
assert.deepEqual(parsed.columnMapping,actualPositions);
assert.deepEqual(parsed.records[0],{awb:'535271',service:'SELF',vendor:'OVERSEAS LOG.',
 consignee:'TEST CONSIGNEE',destination:'UK',weight:2.75,jpCode:'JEP001',bookingDate:'2026-11-07'});
assert.equal(inspectJepoExcel(realHeader)[0].headerRow,1);
// Confirm SERVICE and VENDOR are not accidentally swapped.
actual.getRow(3).getCell(actualPositions.awb).value='535272';
actual.getRow(3).getCell(actualPositions.service).value='FEDEX';
actual.getRow(3).getCell(actualPositions.vendor).value='TPL';
actual.getRow(3).getCell(actualPositions.jpCode).value='JEP002';
actual.getRow(3).getCell(actualPositions.consignee).value='ANOTHER CONSIGNEE';
actual.getRow(3).getCell(actualPositions.weight).value=5;
actual.getRow(3).getCell(actualPositions.destination).value='USA';
actual.getRow(3).getCell(actualPositions.bookingDate).value='08/11/2026';
parsed=parseJepoExcel(realHeader);
assert.equal(parsed.records[1].service,'FEDEX');
assert.equal(parsed.records[1].vendor,'TPL');
assert.equal(parsed.records[1].jpCode,'JEP002');


// Six-column JEPO export must still import the AWB rather than hiding all data.
const partial=new ExcelJS.Workbook(),p=partial.addWorksheet('Actual Row 1');
['ACCOUNT CODE','AWB','SERVICE','VENDOR','CONSIGNEE NAME','CHARG. WEIGHT'].forEach((h,i)=>p.getRow(1).getCell(i+1).value=h);
['ACC002','123456','ARAMEX','ICL','Sample Receiver','6.25'].forEach((v,i)=>p.getRow(2).getCell(i+1).value=v);
parsed=parseJepoExcel(partial);
assert.deepEqual(parsed.missingFields,['Destination','Booking Date']);
assert.deepEqual(parsed.records,[{awb:'123456',service:'ARAMEX',vendor:'ICL',
 consignee:'Sample Receiver',destination:'',weight:6.25,jpCode:'ACC002',bookingDate:null}]);


const goodsWorkbook=new ExcelJS.Workbook();
const goodsSheet=goodsWorkbook.addWorksheet('Goods import');
['AWB No','Service','Vendor','Consignee Name','Destination','Chargeable Weight','JP Code','Booking Date','Description of Goods'].forEach((h,i)=>goodsSheet.getCell(1,i+1).value=h);
['99887766','FedEx','ICL','Sample','UK',8,'JP-001','01/11/2026','Books and clothes'].forEach((v,i)=>goodsSheet.getCell(2,i+1).value=v);
const withGoods=parseJepoExcel(goodsWorkbook);
assert.equal(withGoods.columnMapping.goodsDescription,9);
assert.equal(withGoods.records[0].goodsDescription,'Books and clothes');
assert.equal(withGoods.records[0].bookingDate,'2026-11-01');
assert.ok(!withGoods.missingFields.includes('Goods Description'));
console.log('JEPO optional Goods Description mapping verified for new Excel/CSV imports.');

// A separate customer master has NO AWB column. It must match JP codes, never
// use consignee names as customer names, and reject conflicting duplicates.
const customerMaster=new ExcelJS.Workbook();
const customers=customerMaster.addWorksheet('Customer Master');
customers.getRow(3).getCell(4).value='ACCOUNT CODE';
customers.getRow(3).getCell(9).value='Customer Name';
customers.getRow(3).getCell(15).value='Consignee Name';
customers.getRow(4).getCell(4).value='JEP001';
customers.getRow(4).getCell(9).value='Alpha Shipper';
customers.getRow(4).getCell(15).value='Different Receiver';
customers.getRow(5).getCell(4).value='jep002';
customers.getRow(5).getCell(9).value='Beta Shipper';
customers.getRow(6).getCell(4).value='JEP001';
customers.getRow(6).getCell(9).value='Alpha Shipper';
let mapped=parseJepoCustomerMap(customerMaster);
assert.equal(mapped.headerRow,3);
assert.equal(mapped.records.length,2);
assert.equal(mapped.duplicates,1);
assert.equal(mapped.conflicts.length,0);
assert.deepEqual(mapped.records,[{jpCode:'JEP001',customerName:'Alpha Shipper'},{jpCode:'JEP002',customerName:'Beta Shipper'}]);
assert.equal(normalizeJepoJpCode(' jep002 '),'JEP002');
customers.getRow(7).getCell(4).value='JEP001';
customers.getRow(7).getCell(9).value='Conflicting Shipper';
mapped=parseJepoCustomerMap(customerMaster);
assert.equal(mapped.conflicts.length,1);
assert.equal(mapped.conflicts[0].jpCode,'JEP001');
const customerRoute=(await import('node:fs')).readFileSync('app/api/jepo-tracking/route.js','utf8');
assert.ok(customerRoute.includes("action==='preview_customers'||action==='save_customers'"));
assert.ok(customerRoute.includes("CREATE TABLE IF NOT EXISTS mayavi_jepo_customer_codes"));
assert.ok(customerRoute.includes("ON CONFLICT (jp_code) DO UPDATE"));
assert.ok(customerRoute.includes("customerName:customers.get(normalizeJepoJpCode(row.jp_code))"));
console.log('JEPO customer master mapped by JP Code, excludes consignee, rejects conflicts.');

console.log('JEPO Excel detection checks passed for 132 columns, mixed row layouts and booking dates.');
