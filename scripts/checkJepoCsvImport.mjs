import assert from 'node:assert/strict';
import {csvAsJepoWorkbook,parseJepoCsv} from '../lib/jepoCsvImport.js';
import {parseJepoExcel} from '../lib/jepoExcelImport.js';

// Real JEPO CSV: Row 1 headings, direct export (not .xlsx), comma inside consignee.
const headings=['ACCOUNT CODE','AWB','SERVICE','VENDOR','CONSIGNEE NAME','DESTINATION','CHARG. WEIGHT','BOOKING DATE','OTHER'];
const rows=[
 headings.join(','),
 'JP001,535271,FEDEX,TPL,"Jane, Smith",UK,3.5,07/11/2026,"irrelevant, field"',
 'JP002,535272,SELF,OVERSEAS LOG.,"Mr. Test",USA,5,08/11/2026,"line 1',
 'line 2"'
];
let csv='\uFEFF'+rows.join('\r\n');
let workbook=csvAsJepoWorkbook(Buffer.from(csv,'utf8'),'Agent Statement.csv');
let parsed=parseJepoExcel(workbook,{headerRow:1});
assert.equal(parsed.headerRow,1);
assert.equal(parsed.missingFields.length,0);
assert.equal(parsed.records.length,2);
assert.deepEqual(parsed.records[0],{
 awb:'535271',service:'FEDEX',vendor:'TPL',consignee:'Jane, Smith',
 destination:'UK',weight:3.5,jpCode:'JP001',bookingDate:'2026-11-07'
});
assert.equal(parsed.records[1].awb,'535272');
assert.equal(parsed.records[1].vendor,'OVERSEAS LOG.');
assert.equal(parsed.records[1].bookingDate,'2026-11-08');

// Repeated AWB in the same uploaded CSV is acknowledged with source row numbers.
const repeated=csv+'\r\nJP001,535271,FEDEX,TPL,"Jane, Smith",UK,3.5,07/11/2026,repeat\r\n';
parsed=parseJepoExcel(csvAsJepoWorkbook(Buffer.from(repeated,'utf8'),'repeat.csv'),{headerRow:1});
assert.equal(parsed.records.length,2);
assert.equal(parsed.duplicates,1);
assert.equal(parsed.repeatedUniqueCount,1);
assert.deepEqual(parsed.repeatedAwbs[0],{awb:'535271',firstRow:2,rows:[2,4],count:2});

// Excel's explicit sep=; export with six known fields must preserve missing date.
csv='sep=;\r\nACCOUNT CODE;AWB;SERVICE;VENDOR;CONSIGNEE NAME;CHARG. WEIGHT\r\n'
 +'JP003;535273;ARAMEX;ICL;"Test; Receiver";6.25\r\n';
workbook=csvAsJepoWorkbook(Buffer.from(csv,'utf8'),'Agent.csv');
parsed=parseJepoExcel(workbook,{headerRow:1});
assert.equal(parsed.records[0].consignee,'Test; Receiver');
assert.equal(parsed.records[0].service,'ARAMEX');
assert.equal(parsed.records[0].jpCode,'JP003');
assert.deepEqual(parsed.missingFields,['Destination','Booking Date']);
assert.equal(parsed.records[0].bookingDate,null);

// Tab delimited UTF-16LE export.
csv='ACCOUNT CODE\tAWB\tSERVICE\tVENDOR\tCONSIGNEE NAME\tDESTINATION\tCHARG. WEIGHT\tBOOKING DATE\r\n'
 +'JP004\t535274\tFEDEX\tTPL\tJane Doe\tCanada\t2.5\t07/11/2026\r\n';
const utf16=Buffer.concat([Buffer.from([0xff,0xfe]),Buffer.from(csv,'utf16le')]);
parsed=parseJepoExcel(csvAsJepoWorkbook(utf16,'tab.csv'),{headerRow:1});
assert.equal(parsed.records[0].destination,'Canada');
assert.equal(parsed.records[0].bookingDate,'2026-11-07');

// No silent accept of a broken one-column export.
assert.throws(()=>parseJepoCsv('AWB\n535271'),/multiple columns/);
console.log('JEPO CSV: direct .csv, quoted commas/newlines, semicolon, UTF-16 and Row 1 mappings passed.');
