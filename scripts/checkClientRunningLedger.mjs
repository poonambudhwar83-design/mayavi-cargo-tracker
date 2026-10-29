import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {clientKey,istDate,masterCustomsClearance,masterReceivable,settleClientReceivables} from '../lib/importClientReceivables.js';
assert.equal(clientKey('  Sonu   cargo '),'SONU CARGO');
assert.equal(masterCustomsClearance({customsCleared:false}),'');
assert.equal(masterCustomsClearance({customsCleared:true,customsClearedAt:'2026-10-29T04:20:00Z'}),'2026-10-29T04:20:00.000Z');
assert.equal(masterCustomsClearance({partShipments:[
  {partKey:'A',customsCleared:true,customsClearedAt:'2026-10-29T04:00:00Z'},
  {partKey:'B',customsCleared:false}]}),'');
assert.equal(masterCustomsClearance({partShipments:[
  {partKey:'A',customsCleared:true,customsClearedAt:'2026-10-29T04:00:00Z'},
  {partKey:'A',customsCleared:false},{partKey:'B',customsCleared:true,customsClearedAt:'2026-10-30T04:20:00Z'}]}),'2026-10-30T04:20:00.000Z');
const priced=masterReceivable(
  {data:{masterWeight:'800',partShipments:[{partKey:'one',weight:300},{partKey:'two',weight:500}]}},
  {rate:'500',excess_weight:'20'},[{part_key:'one',excess_weight:'10'},{part_key:'one',excess_weight:'10'}]);
assert.equal(priced.weight,800);
assert.equal(priced.extraWeight,30);
assert.equal(priced.billedWeight,830);
assert.equal(priced.amount,415000);
assert.equal(masterReceivable({data:{weight:'100'}},{rate:null}).amount,null);
const invoices=[
  {awb:'06511111111',recognized_at:'2026-10-29T04:10:00Z',amount:400000},
  {awb:'06522222222',recognized_at:'2026-10-29T04:20:00Z',amount:300000},
  {awb:'06533333333',recognized_at:'2026-10-30T04:20:00Z',amount:500000}
];
const payments=[{id:'p1',mode:'ACCOUNT',payment_date:'2026-10-29',amount:2000000,created_at:'2026-10-29T04:40:00Z'}];
const a=settleClientReceivables({amount:1500000,started_at:'2026-10-29T00:00:00Z'},invoices,payments,'2026-10-30');
assert.equal(a.opening.balance,0);
assert.equal(a.opening.received,1500000);
assert.equal(a.invoices[0].balance,0);
assert.equal(a.invoices[0].paymentStatus,'CLEARED');
assert.equal(a.invoices[1].received,100000);
assert.equal(a.invoices[1].balance,200000);
assert.equal(a.invoices[1].paymentStatus,'PART PAID');
assert.equal(a.invoices[2].received,0);
assert.equal(a.totals.outstanding,700000);
assert.equal(a.totals.netBalance,700000);
assert.deepEqual(a.receipts[0].allocations.map(x=>[x.target,x.amount]),
  [['OPENING BALANCE',1500000],['065-11111111',400000],['065-22222222',100000]]);
assert.deepEqual(a.daily.map(x=>[x.date,x.opening,x.newReceivables,x.amountReceived,x.closing]),
  [['2026-10-29',1500000,700000,2000000,200000],['2026-10-30',200000,500000,0,700000]]);
const historical=settleClientReceivables(
  {amount:1612180,started_at:'2026-10-29T02:52:00Z'},[],
  [
    {id:'cash',mode:'CASH',payment_date:'2026-10-29',amount:375000,created_at:'2026-10-29T03:01:00Z'},
    {id:'older-account',mode:'ACCOUNT',payment_date:'2026-10-21',amount:185000,created_at:'2026-10-29T03:10:00Z'}
  ],'2026-10-29'
);
assert.equal(historical.opening.startDate,'2026-10-29');
assert.equal(historical.opening.dailyStartDate,'2026-10-21');
assert.equal(historical.opening.received,560000);
assert.equal(historical.opening.balance,1052180);
assert.equal(historical.daily[0].date,'2026-10-21');
assert.equal(historical.daily[0].amountReceived,185000);
assert.equal(historical.daily[0].closing,1427180);
assert.deepEqual(historical.daily.at(-1),
  {date:'2026-10-29',opening:1427180,newReceivables:0,amountReceived:375000,closing:1052180});
const credit=settleClientReceivables({amount:500,started_at:'2026-10-29T00:00:00Z'},[],
  [{id:'p',mode:'CASH',payment_date:'2026-10-29',amount:700}],'2026-10-29');
assert.equal(credit.opening.balance,0);
assert.equal(credit.totals.credit,200);
assert.equal(credit.totals.netBalance,-200);
const files=['app/api/import-client-receivables/route.js','app/ImportClientReceivables.js','app/ImportClientLedger.js','app/ImportFinanceSection.js'];
for(const f of files)assert.ok(readFileSync(f,'utf8').length>100);
const api=readFileSync(files[0],'utf8'),ui=readFileSync(files[1],'utf8'),old=readFileSync(files[2],'utf8');
assert.ok(api.includes('mayavi_import_client_bulk_receipts'));
assert.ok(api.includes('mayavi_import_client_voided_invoices'));
assert.ok(api.includes("action==='DELETE_INVOICE'"));
assert.ok(api.includes("v.awb=${s.awb}"));
assert.ok(api.includes('profitCustomsCleared'));
assert.ok(api.includes('voidedSet.has(s.awb)'));
assert.ok(api.includes("ON CONFLICT(awb) DO NOTHING"));
assert.ok(api.includes("admin(request)"));
assert.ok(api.includes("action==='OPENING'"));
assert.ok(api.includes("action==='MANUAL'"));
assert.ok(ui.includes('Daily Opening & Closing Balance'));
assert.ok(ui.includes('Remaining Opening Due'));
assert.ok(ui.includes('Receipts Adjusted Against Opening'));
assert.ok(ui.includes('payment saved and verified'));
assert.ok(ui.includes('Recent Amount Received • All Clients'));
assert.ok(ui.includes('paymentFeedback'));
assert.ok(ui.includes('clientAfter?.receipts?.some'));
assert.ok(ui.includes('The entire payment is recorded once'));
assert.ok(api.includes('openingPending'));
assert.ok(api.includes('import_client_receipt_saved'));
assert.ok(!api.includes('Receipt date precedes opening date.'));
assert.ok(ui.includes('Older payment dates are allowed'));
assert.ok(ui.includes('Record Lump-sum Amount Received'));
assert.ok(ui.includes('Active Import Masters'));
assert.ok(ui.includes('Customs Cleared Masters from Import Profit Sheet'));
assert.ok(ui.includes('onClick={()=>void deleteInvoice(i)}'));
assert.ok(ui.includes("action:'DELETE_INVOICE'"));
assert.ok(ui.includes("window.confirm("));
assert.ok(ui.includes('Other clients'));
assert.ok(old.includes('return <ImportClientReceivables'));
console.log('Client running receivables passed: FIFO bulk allocation, partial payment, credit, daily opening, full master clearance, excess weight.');
