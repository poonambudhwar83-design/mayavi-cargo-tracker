import assert from 'node:assert/strict';
import {moneyInput,readLedgerEntry,computeLedger,validEntryDate,cleanAccountText} from '../lib/accountLedger.js';
assert.equal(moneyInput('1,200.50'),'1200.50');
assert.equal(moneyInput(''),'0.00');
assert.throws(()=>moneyInput('-4'),/valid amount/);
assert.throws(()=>moneyInput('3.999'),/valid amount/);
assert.equal(validEntryDate('2026-02-28'),true);
assert.equal(validEntryDate('2026-02-30'),false);
assert.equal(readLedgerEntry({date:'2026-11-04',credit:'120',debit:'',remarks:'Received'}).credit,'120.00');
assert.throws(()=>readLedgerEntry({date:'2026-11-04',credit:'120',debit:'20'}),/either Credit or Debit/);
assert.throws(()=>readLedgerEntry({date:'2026-11-04',credit:'',debit:''}),/either Credit or Debit/);
assert.equal(cleanAccountText('TEST\nACCOUNT'),'TEST ACCOUNT');
const rows=[
  {id:'2',date:'2026-11-02',createdAt:'2026-11-02T01:00:00Z',credit:0,debit:40},
  {id:'1',date:'2026-11-01',createdAt:'2026-11-01T01:00:00Z',credit:100,debit:0},
  {id:'3',date:'2026-11-02',createdAt:'2026-11-02T02:00:00Z',credit:10,debit:0}
];
const output=computeLedger(rows,500);
assert.deepEqual(output.map(e=>e.balance),[600,560,570]);
assert.equal(output[1].date,'2026-11-02');
console.log('Account ledger validation, date order and rolling balance regression checks passed.');
