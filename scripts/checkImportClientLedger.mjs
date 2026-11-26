import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ledgerAwb,ledgerWeight,validLedgerDate,validReceiptAmount,buildImportLedgerRows,summarizeImportLedger} from '../lib/importClientLedger.js';

assert.equal(ledgerAwb('065-12345678'),'06512345678');
assert.equal(ledgerAwb('06512345678'),'06512345678');
assert.equal(ledgerAwb('invalid'),'');
assert.equal(validLedgerDate('2026-10-28'),true);
assert.equal(validLedgerDate('2026-02-30'),false);
assert.equal(validLedgerDate('2026-00-01'),false);
assert.equal(validReceiptAmount('1000.00'),1000);
assert.equal(validReceiptAmount('0'),null);
assert.equal(validReceiptAmount('125.123'),null);
assert.equal(validReceiptAmount('-100'),null);
assert.equal(ledgerWeight({masterWeight:'100',partShipments:[
  {partKey:'one',weight:'40'},{partKey:'two',weight:'60'}]}),100);
assert.equal(ledgerWeight({partShipments:[
  {partKey:'one',weight:'40'},{partKey:'one',weight:'40'},
  {partKey:'two',weight:'60'}]}),100);

const shipments=[
  {awb:'06512345678',data:{clientName:'SONU',totalWeight:'100',partShipments:[
    {partKey:'one',weight:'40'},{partKey:'two',weight:'60'}]}},
  {awb:'16012345678',data:{clientName:'Sonu',weight:'25'}},
  {awb:'09812345678',data:{clientName:'ABS',weight:'50'}}
];
const profit=[{awb:'06512345678',rate:'500.0000'},{awb:'16012345678',rate:'100.0000'}];
const receipts=[
  {awb:'06512345678',mode:'CASH',amount:'10000.00'},
  {awb:'06512345678',mode:'ACCOUNT',amount:'15000.00'},
  {awb:'16012345678',mode:'ACCOUNT',amount:'2000.00'}
];
const rows=buildImportLedgerRows(shipments,profit,receipts);
assert.equal(rows.length,3); // physical parts are not additional invoices
const big=rows.find(r=>r.awb==='06512345678');
assert.equal(big.weight,100);
assert.equal(big.rate,500);
assert.equal(big.amount,50000);
assert.equal(big.cashReceived,10000);
assert.equal(big.accountReceived,15000);
assert.equal(big.received,25000);
assert.equal(big.balance,25000);
assert.equal(big.payments,2);
const small=rows.find(r=>r.awb==='16012345678');
assert.equal(small.amount,2500);
assert.equal(small.received,2000);
assert.equal(small.balance,500);
const missing=rows.find(r=>r.awb==='09812345678');
assert.equal(missing.amount,null);
assert.equal(missing.balance,null);
const summary=summarizeImportLedger(rows);
assert.equal(summary.length,2);
const sonu=summary.find(x=>x.clientName.toUpperCase()==='SONU');
assert.deepEqual({mawbs:sonu.mawbs,amount:sonu.amount,cash:sonu.cash,
  account:sonu.account,received:sonu.received,balance:sonu.balance},
  {mawbs:2,amount:52500,cash:10000,account:17000,received:27000,balance:25500});
assert.equal(summary.find(x=>x.clientName==='ABS').unpriced,1);

const nav=readFileSync('app/UnifiedDashboard.js','utf8');
const wrap=readFileSync('app/ImportFinanceSection.js','utf8');
const ui=readFileSync('app/ImportClientLedger.js','utf8');
const route=readFileSync('app/api/import-client-ledger/route.js','utf8');
const css=readFileSync('app/ImportClientLedger.module.css','utf8');
const packageData=JSON.parse(readFileSync('package.json','utf8'));
assert.ok(nav.includes("import ImportFinanceSection from './ImportFinanceSection.js';"));
assert.ok(nav.includes('<ImportFinanceSection/>'));
assert.ok(wrap.includes('<ImportProfitSheet/>'));
assert.ok(!wrap.includes('ImportClientLedger'));
assert.ok(!wrap.includes('Client Ledger • Receivables'));
assert.ok(wrap.includes("'Client Ledger'"));
assert.ok(wrap.includes("'Client Balance'"));
assert.ok(wrap.includes('AbsImportLedger'));
assert.ok(!wrap.includes('/api/import-client-receivables'));
assert.ok(ui.includes('Cash Received'));
assert.ok(ui.includes('Account Received'));
assert.ok(ui.includes('Client-wise Balance'));
assert.ok(ui.includes('MAWB-wise Receivables'));
assert.ok(ui.includes('Payment History'));
assert.ok(ui.includes('Record Cash / Account Payment'));
assert.ok(ui.includes('Balance = Weight × Rate − Total Received'));
assert.ok(ui.includes('clientRequestId:id'));
assert.ok(ui.includes('credentials:'));
assert.ok(route.includes("s?.role==='admin'"));
assert.ok(route.includes('CREATE TABLE IF NOT EXISTS mayavi_import_client_receipts'));
assert.ok(route.includes("mode IN ('CASH','ACCOUNT')"));
assert.ok(route.includes('ON CONFLICT (id) DO NOTHING'));
assert.ok(route.includes('buildImportLedgerRows(shipments,financials,receipts)'));
assert.ok(route.includes("COALESCE(data->>'shipmentType','IMPORT')='IMPORT'"));
assert.ok(route.includes('ledgerWeight(shipments[0].data||{})'));
assert.ok(!route.includes('DELETE FROM mayavi_shipments'));
assert.ok(css.includes('.paymentForm'));
assert.ok(packageData.scripts.prebuild.includes('node scripts/checkImportClientLedger.mjs'));
console.log('Import Client Ledger tests passed: master MAWB once, client balances, dated Cash/Account receipts, saved rates and admin controls.');

const {absLedger,absAutoEligible}=await import('../lib/absImportLedger.js');
const abs=absLedger([{awb:'06512345678',date:'2026-11-20',amount:10000,weight:20,rate:500},{awb:'06512345679',date:'2026-11-21',amount:20000,weight:40,rate:500}],[{id:'1',date:'2026-11-22',mode:'ACCOUNT',amount:25000}]);
assert.equal(abs.totals.balance,5000);
assert.equal(abs.totals.received,25000);
assert.equal(abs.rows.length,3);
assert.equal(absLedger([],[{date:'2026-11-22',mode:'CASH',amount:150}]).totals.advance,150);
assert.equal(absAutoEligible({cleared:true,clearanceDate:'2026-12-03',amount:500},'2026-12-02'),false);
assert.equal(absAutoEligible({cleared:true,clearanceDate:'2026-12-02',amount:500},'2026-12-03'),false);
assert.equal(absAutoEligible({cleared:true,clearanceDate:'2026-12-03',amount:500},'2026-12-03'),true);
assert.equal(absAutoEligible({cleared:true,clearanceDate:'2026-12-03',amount:null},'2026-12-03'),false);
console.log('ABS ledger: lump-sum receipts, net balance, manual cutoff and auto eligibility passed.');
