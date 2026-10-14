import assert from 'node:assert/strict';
import {createBookingPendingPdf} from '../lib/speedpostPendingPdf.js';

const entries=Array.from({length:17},(_,i)=>({
  trackingNo:i===0?'ED977952515IN':'ED00000000'+String(i).padStart(2,'0')+'IN',
  consigneeName:i===0?'TEST CONSIGNEE':'Consignee '+i,
  entryDate:'14/10/2026',enteredBy:'admin',
  status:'Pending Tracking',weight:i===0?'5720 g':'-',
  destination:i===0?'Leicester':'Unknown'
}));
const before=JSON.stringify(entries);
const bytes=createBookingPendingPdf(entries,new Date('2026-10-14T03:30:00Z'));
assert.ok(bytes instanceof Uint8Array&&bytes.length>900,'Nonempty PDF bytes');
const pdf=new TextDecoder().decode(bytes);
assert.ok(pdf.startsWith('%PDF-1.4\n'),'PDF signature');
assert.ok(pdf.endsWith('%%EOF\n'),'PDF trailer');
assert.ok(pdf.includes('/Count 2'),'Pagination for over 15 rows');
assert.ok(pdf.includes('ED977952515IN'),'Exact ED present in document');
assert.ok(pdf.includes('5720 g'),'Known saved weight in report');
assert.ok(pdf.includes('BOOKING DATE NOT VERIFIED'),'Missing date not mistaken for unbooked');
assert.ok(pdf.includes('TEST CONSIGNEE'),'Consignee included');
assert.equal(JSON.stringify(entries),before,'PDF generation does not mutate customer data');
const match=pdf.match(/startxref\n([0-9]+)\n%%EOF\n$/);
assert.ok(match,'PDF must contain startxref');
assert.equal(pdf.slice(Number(match[1]),Number(match[1])+4),'xref',
  'Byte offsets must point to PDF xref table');
assert.throws(()=>createBookingPendingPdf([]),/No booking-pending/);
console.log('Speed Post Booking Pending PDF smoke regression passed.');
