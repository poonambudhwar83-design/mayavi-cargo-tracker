import assert from 'node:assert/strict';
import {decodeBankCsv,parseBankCsv} from '../lib/personalAccountsUpload.js';
import {guessAccountSheetHeader,accountRowsFromSheet} from '../lib/personalAccountsCore.js';
const csv='\uFEFF"Transaction Date","Narration","Chq No.","Debit","Credit","Balance","Remarks"\r\n'+
'"2026-11-20","Payment, with comma","000123","1,000.00","","15,000.00","My own note"\r\n'+
'"2026-11-21","Transfer\nwith details","","","500.00","15,500.00","Long ""quoted"" remark"\r\n';
const rows=parseBankCsv(decodeBankCsv(Buffer.from(csv)));
assert.equal(rows.length,3);
assert.equal(rows[1][1],'Payment, with comma');
assert.equal(rows[1][2],'000123');
assert.equal(rows[2][1],'Transfer\nwith details');
assert.equal(rows[2][6],'Long "quoted" remark');
const sheet={sheet:'Bank CSV',rows};
const match=guessAccountSheetHeader(sheet);
assert.equal(match.headerIndex,0);
const ledger=accountRowsFromSheet(sheet,match.headerIndex,match.mapping);
assert.equal(ledger.length,2);
assert.equal(ledger[0].remarks,'My own note');
assert.equal(ledger[0].chequeNo,'000123');
const utf16=Buffer.concat([Buffer.from([0xff,0xfe]),Buffer.from('Date,Details,Debit,Credit,Balance,Remarks\n20/11/2026,Salary,,500,500,Written remark','utf16le')]);
const utfRows=parseBankCsv(decodeBankCsv(utf16));
assert.equal(utfRows.length,2);
assert.equal(utfRows[1][5],'Written remark');
const semi=parseBankCsv('Date;Details;Debit;Credit;Balance;Remarks\n2026-11-20;Food;200;;400;Groceries');
assert.equal(semi[1][5],'Groceries');
const tabs=parseBankCsv('Date\tDetails\tDebit\tCredit\tBalance\tRemarks\n2026-11-20\tFuel\t500\t\t400\tTaxi');
assert.equal(tabs[1][5],'Taxi');
assert.throws(()=>parseBankCsv('a,"unfinished'),/unclosed quoted field/);
console.log('Personal Accounts CSV uploads, pre-existing Remarks, bank headings, UTF-16 and quoted multiline text verified.');
