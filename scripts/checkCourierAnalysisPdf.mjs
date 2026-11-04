import assert from 'node:assert/strict';
import {createCourierAnalysisPdf} from '../lib/courierAnalysisPdf.js';

// Test month-specific, ordered PDF with many origins & couriers:
// 7 origins * 27 couriers must become 2 sector groups * 2 vertical pages.
const sectors=['HKG','JFK','DOH','DXB','LHR','JED','AUH']
  .map((name,i)=>({name,totalWeight:1000+i*10}));
const rows=Array.from({length:27},(_,i)=>({
  courierName:'Courier '+String(i+1).padStart(2,'0'),
  totalWeight:10000-i*110,
  over35:1500-i*10,
  avgBagKg:38.2,
  sectorLoads:Object.fromEntries(sectors.map((s,j)=>[s.name,10*(i+1)*(j+1)]))
}));
const totals={totalWeight:rows.reduce((a,b)=>a+b.totalWeight,0),
  over35:rows.reduce((a,b)=>a+b.over35,0),avgBagKg:34.2};
const original=structuredClone(rows);
const pdf=createCourierAnalysisPdf({flow:'IMPORT',month:'2026-10',country:'ALL',rows,sectors,totals});
assert.ok(Buffer.isBuffer(pdf));
assert.equal(pdf.subarray(0,8).toString('latin1'),'%PDF-1.4');
assert.ok(pdf.toString('latin1').trimEnd().endsWith('%%EOF'));
const source=pdf.toString('latin1');
assert.match(source,/\/Count 4 >>/);
assert.ok(source.includes('October 2026'),'Selected month must appear in PDF.');
assert.ok(source.includes('HKG'),'HKG sector must be in the PDF.');
assert.ok(source.includes('AUH'),'All continuation sectors must be in the PDF.');
assert.match(source,/GRAND TOTAL/);
assert.match(source,/MORE THAN 35 KG/);
assert.ok(!source.includes('Below 30 kg'));
assert.ok(!source.includes('30-35 kg'));
assert.deepEqual(rows,original,'Generating the PDF must not mutate saved data.');
assert.throws(()=>createCourierAnalysisPdf({flow:'IMPORT',month:'ALL',rows}),/valid report month/);
assert.throws(()=>createCourierAnalysisPdf({flow:'EXPORT',month:'2026-09',rows:[]}),/no saved courier/);
console.log('Courier PDF: header, all sector pages, courier row pages, grand totals, selected month and no hidden columns passed.');