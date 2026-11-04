import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {moneyInput,readLedgerEntry,computeLedger,validEntryDate,cleanAccountText,transactionMode,TRANSACTION_MODES} from '../lib/accountLedger.js';
assert.equal(moneyInput('1,200.50'),'1200.50');
assert.equal(moneyInput(''),'0.00');
assert.throws(()=>moneyInput('-4'),/valid amount/);
assert.throws(()=>moneyInput('3.999'),/valid amount/);
assert.equal(validEntryDate('2026-02-28'),true);
assert.equal(validEntryDate('2026-02-30'),false);
assert.equal(readLedgerEntry({date:'2026-11-04',credit:'120',debit:'',mode:'UPI',remarks:'Received'}).credit,'120.00');
assert.throws(()=>readLedgerEntry({date:'2026-11-04',credit:'120',debit:'20',mode:'CASH'}),/either Credit or Debit/);
assert.throws(()=>readLedgerEntry({date:'2026-11-04',credit:'',debit:'',mode:'CASH'}),/either Credit or Debit/);
assert.equal(cleanAccountText('TEST\nACCOUNT'),'TEST ACCOUNT');
const rows=[
  {id:'2',date:'2026-11-02',createdAt:'2026-11-02T01:00:00Z',credit:0,debit:40},
  {id:'1',date:'2026-11-01',createdAt:'2026-11-01T01:00:00Z',credit:100,debit:0},
  {id:'3',date:'2026-11-02',createdAt:'2026-11-02T02:00:00Z',credit:10,debit:0}
];
const output=computeLedger(rows,500);
assert.deepEqual(output.map(e=>e.balance),[600,560,570]);
assert.equal(output[1].date,'2026-11-02');
assert.ok(TRANSACTION_MODES.includes('ACCOUNT TRANSFER'));
assert.ok(TRANSACTION_MODES.includes('UPI'));
assert.equal(transactionMode('upi'),'UPI');
assert.throws(()=>transactionMode(''),/Mode of Transaction/);
assert.throws(()=>transactionMode('UNKNOWN SOURCE'),/Mode of Transaction/);
assert.equal(readLedgerEntry({date:'2026-11-04',credit:'50',debit:'0',mode:'NEFT',remarks:'Client receipt'}).mode,'NEFT');
const ui=readFileSync('app/AccountDashboard.js','utf8');
const api=readFileSync('app/api/accounts/route.js','utf8');
assert.ok(ui.includes('MODE OF TRANSACTION'),'Transaction mode column must be visible.');
assert.ok(ui.includes('value={entryDraft.mode}'),'Entry form must capture transaction mode.');
assert.ok(ui.includes('value={editDraft.mode}'),'Transactions must allow mode editing.');
assert.ok(api.includes('ALTER TABLE mayavi_bank_entries ADD COLUMN IF NOT EXISTS transaction_mode'),
  'Existing ledger rows must migrate without data deletion.');
assert.ok(api.includes('r.transaction_mode||'), 'Existing and new entry modes must be returned.');
assert.ok(api.includes("'Mode of Transaction'"), 'Excel exports must include transaction mode.');
console.log('Account ledger validation, date order and rolling balance regression checks passed.');
