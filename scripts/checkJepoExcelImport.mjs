import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {parseJepoExcel,inspectJepoExcel} from '../lib/jepoExcelImport.js';

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
console.log('JEPO Excel detection checks passed for 132 columns, mixed row layouts and booking dates.');
