import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {speedPostEntryDay,speedPostEntryMonth,uniqueSpeedPostEntries,
  speedPostCostSummary,speedPostGroupByEntryDay,speedPostGroupByEntryMonth
} from '../lib/speedpostCostReports.js';
import {createSpeedPostPdf,createSpeedPostXlsx} from '../lib/speedpostExports.js';

const rows=[
  {trackingNo:'ED111111111IN',createdAt:'2026-10-13T19:30:00Z',
   tariff:'700',weight:'1560 g',status:'Delivered',delivered:true},
  {trackingNo:'ED222222222IN',createdAt:'2026-10-14T13:20:00Z',
   tariff:'400',weight:'800 g',status:'In Transit'},
  {trackingNo:'ED333333333IN',createdAt:'2026-10-22T19:15:00Z',
   tariff:'',weight:'2200 g',status:'Dispatched'},
  {trackingNo:'ED444444444IN',createdAt:'2026-09-30T20:10:00Z',
   tariff:'250',weight:'',status:'Delivered',delivered:true},
  {trackingNo:'ED222222222IN',createdAt:'2026-10-14T13:20:00Z',
   tariff:'400',weight:'800 g',status:'In Transit'}
];
const tariff=row=>row.tariff===''?null:Number(row.tariff);
const cash=row=>{const n=parseFloat(row.weight);return row.weight&&Number.isFinite(n)?
  Math.ceil(n/1000)*150:null;};
assert.equal(speedPostEntryDay(rows[0]),'2026-10-14','Asia/Kolkata date boundary');
assert.equal(speedPostEntryMonth(rows[3]),'2026-10','IST rollover across month boundary');
assert.equal(uniqueSpeedPostEntries(rows).length,4,'An ED is never counted twice');
const days=speedPostGroupByEntryDay(rows);
assert.deepEqual(days.map(([d,r])=>[d,r.length]),[
  ['2026-10-23',1],['2026-10-14',2],['2026-10-01',1]]);
const months=speedPostGroupByEntryMonth(rows);
assert.deepEqual(months.map(([m,r])=>[m,r.length]),[['2026-10',4]]);
const summary=speedPostCostSummary(rows,{tariffOf:tariff,cashOf:cash});
assert.equal(summary.packets,4);
assert.equal(summary.tariff,1350,'sum tariff independently');
assert.equal(summary.cash,900,'sum cash independently');
assert.equal(summary.combined,2250,'combined known amount sum');
assert.equal(summary.completePackets,2,'only paired values form a difference');
assert.equal(summary.difference,650,'700-300 plus 400-150');
assert.equal(summary.tariffMissing,1);
assert.equal(summary.cashMissing,1);
const delivered=rows.filter(x=>x.delivered===true);
assert.equal(speedPostCostSummary(delivered,{tariffOf:tariff,cashOf:cash}).packets,2,
  'compiled Delivered sheet includes different entry dates');
const screen=readFileSync('app/SpeedPostDashboard.js','utf8');
assert.ok(screen.includes("'CORRECT STATUS'"),'Delivered records must clearly label the optional correction action');
assert.ok(!screen.includes("'NOT DELIVERED'"),'Do not show a contradictory NOT DELIVERED action on delivered rows');
assert.ok(screen.includes('Correction action only:'),'Correction must be explicitly described as optional');
assert.ok(screen.includes("if(isDelivered(row))return 'DELIVERED'"),'Delivered packet classification must remain unchanged');
for(const piece of [
  "speedPostGroupByEntryDay(rows)","speedPostGroupByEntryMonth(rows)",
  "speedPostTab==='MONTHLY'","speedPostTab==='DELIVERED'?deliveredRows",
  'ALL ENTRIES • GRAND TOTAL','FILTERED ENTRIES TOTAL',
  "currency(reportTotals.tariff)","currency(reportTotals.cash)",
  "currency(allTotals.combined)","currency(filteredTotals.tariff)",
  "<tfoot>","MONTH TOTAL","TOTAL • {displayedRows.length} ENTRIES"
]){
  assert.ok(screen.includes(piece),'EMS financial dashboard contract: '+piece);
}
const headers=['ED','Tariff','Cash','Total','Difference'];
const xlsx=createSpeedPostXlsx(headers,[['ED111111111IN',700,300,1000,400]]);
assert.ok(xlsx instanceof Uint8Array&&xlsx.length>300,'XLSX bytes');
assert.equal(new TextDecoder().decode(xlsx.slice(0,2)),'PK');
assert.ok(!screen.includes('Tariff − Cash'),'Tariff minus Cash column is removed');
const pdf=createSpeedPostPdf([[
  'ED111111111IN','TEST CONSIGNEE','14/10/2026','UK','Delivered','1560 g',
  '700','300','1000','14/10/2026'
]],'2026-10-14',summary);
const pdfText=new TextDecoder().decode(pdf);
assert.ok(!pdfText.includes('Tariff-Cash'),'PDF must omit deleted difference column');
assert.ok(pdfText.includes('Combined: INR 2250.00'),'PDF financial totals visible');
assert.ok(pdfText.includes('ED111111111IN'),'PDF must include tracked ED');
console.log('EMS date-wise and monthly costs, compiled Delivered, XLSX/PDF financial regression passed');
