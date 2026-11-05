import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {AUDIT_FIELDS,auditMawb,listAuditSheets,parseAuditWorkbook,summarizeAuditRows} from '../lib/auditDataAnalysis.js';
const makeRow=values=>({cellCount:values.length,hasValues:values.some(v=>v!==''&&v!==null&&v!==undefined),getCell(i){return {value:values[i-1]??''}}});
const sheet=(name,values)=>({name,state:'visible',rowCount:values.length,columnCount:values.reduce((m,x)=>Math.max(m,x.length),0),getRow(i){return makeRow(values[i-1]||[])}});
const normal={worksheets:[sheet('Audit',[
 ['Entered By','MAWB No','Weight (kg)','Bags','G&C','T','DT','D','X Ray','Shift','Loader','Co Loader','Remarks'],
 ['Vivek','09812345678',123.5,4,300,12,13,14,'5','Night','Rahul','ABC','urgent'],
 ['Rahul','09812345679',140,6,300,11,14,12,'5','Day','Ramesh','DEF','ignore'],
 ['Vivek','098-12345680',180,5,400,'T: 4',5,6,80,'Morning','Test','Tester','verified'],
 ['Vivek','Total',200,10,'','','','','','','','','']
])]};
const parsed=parseAuditWorkbook(normal);
assert.equal(parsed.rows.length,2,'Only Vivek-entered MAWBs should be included when Entered By exists.');
assert.equal(parsed.rows[0].mawb,'098-12345678');assert.equal(parsed.rows[0].weight,123.5);
assert.equal(parsed.rows[0].bags,4);assert.equal(parsed.rows[0].gc,'300');
assert.equal(parsed.rows[0].t,'12');assert.equal(parsed.rows[0].dt,'13');
assert.equal(parsed.rows[0].d,'14');assert.equal(parsed.rows[0].xray,'5');
assert.equal(parsed.rows[0].shift,'Night');assert.equal(parsed.rows[0].loader,'Rahul');
assert.equal(parsed.rows[0].coLoader,'ABC');assert.equal(parsed.rows[0].remarks,'urgent');
assert.equal(parsed.skipped,2);
assert.equal(auditMawb('098-12345678'),'098-12345678');
assert.equal(auditMawb('not an awb'),'');
assert.equal(summarizeAuditRows(parsed.rows).weight,303.5);
const grouped={worksheets:[sheet('Audit Tracking',[
 ['Audit','Vivek','Vivek','Vivek','Rahul','Rahul','Rahul','Rahul','Rahul','Rahul','Rahul','Rahul'],
 ['Audit','Vivek','Vivek','Vivek','Rahul','Rahul','Rahul','Rahul','Rahul','Rahul','Rahul','Rahul'],
 ['Sr.','MAWB','Weight','Bags','G&C','T','DT','D','X-ray','Shift','Loader','Co-loader'],
 [1,'06511493565',500,15,550,0,0,200,100,2,1,'John'],
 [2,'06511493566',450,12,300,100,200,0,80,1,2,'Roger']
])]};
const groupParsed=parseAuditWorkbook(grouped);
assert.equal(groupParsed.rows.length,2);
assert.equal(groupParsed.rows[0].dt,'0');
assert.equal(groupParsed.rows[0].gc,'550');
assert.equal(groupParsed.rows[0].mawb,'065-11493565');
assert.equal(groupParsed.headerRow,3);
assert.ok(listAuditSheets(grouped)[0].mapping.mawb===2);
const custom={worksheets:[sheet('Custom Excel',[
 ['Vivek ID','Mass','Packets','Rahul GC','Rahul X ray','Notes'],
 ['16012345678',250,8,300,150,'private notes']
])]};
assert.throws(()=>parseAuditWorkbook(custom),/MAWB column/);
const mapped=parseAuditWorkbook(custom,{sheetName:'Custom Excel',headerRow:1,
 mapping:{mawb:1,weight:2,bags:3,gc:4,xray:5,remarks:6}});
assert.equal(mapped.rows[0].gc,'300');assert.equal(mapped.rows[0].weight,250);
const bad={worksheets:[sheet('Audit',[['MAWB','Weight'],['bad',25]])]};
assert.throws(()=>parseAuditWorkbook(bad),/valid MAWB/);
const ui=readFileSync('app/AuditDataAnalysisDashboard.js','utf8');
const api=readFileSync('app/api/audit-data-analysis/route.js','utf8');
const nav=readFileSync('app/UnifiedDashboard.js','utf8');
assert.equal(AUDIT_FIELDS.length,12);
assert.ok(ui.includes('Preview Excel')&&ui.includes('Save this Audit Analysis'));
assert.ok(ui.includes('Download CSV')&&ui.includes('Rahul'));
assert.ok(api.includes("readSession(request)?.role==='admin'"));
assert.ok(api.includes('jsonb_to_recordset')&&api.includes("action==='preview'"));
assert.ok(nav.includes('DATA ANALYSIS')&&nav.includes('AuditDataAnalysisDashboard'));
console.log('Vivek/Rahul Excel Audit parser, two-row headers, manual mapping, saved analysis and admin UI checks passed.');
