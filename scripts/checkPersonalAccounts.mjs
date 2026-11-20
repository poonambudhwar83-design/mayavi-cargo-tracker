import assert from 'node:assert/strict';
import {PERSONAL_ACCOUNT_FIELDS,PERSONAL_ACCOUNT_KEYS,guessAccountSheetHeader,accountRowsFromSheet,numericAccountAmount,isValidAccountSaveRow} from '../lib/personalAccountsCore.js';
assert.deepEqual(PERSONAL_ACCOUNT_KEYS,['date','details','chequeNo','debit','credit','balance','remarks']);
assert.deepEqual(PERSONAL_ACCOUNT_FIELDS.map(x=>x.label),['Date','Details','Cheque No.','Debit','Credit','Balance','Remarks']);
const sheet={sheet:'Bank Statement',rows:[
  ['Statement period: 01-11-2026 to 30-11-2026'],
  ['Txn Date','Narration','Chq No.','Withdrawals','Deposits','Closing Balance','Notes'],
  ['2026-11-01','Grocery','000123','1,250.00','','10,750.00','Household'],
  ['2026-11-02','Salary','','','50,000.00','60,750.00',''],
  ['2026-11-03','Bank fee','','50','','60,700','Check this'],
  ['','','','','','','']
]};
const detected=guessAccountSheetHeader(sheet);
assert.equal(detected.headerIndex,1);
assert.deepEqual(detected.mapping,{date:'0',details:'1',chequeNo:'2',debit:'3',credit:'4',balance:'5',remarks:'6'});
const rows=accountRowsFromSheet(sheet,detected.headerIndex,detected.mapping);
assert.equal(rows.length,3);
assert.equal(rows[0].chequeNo,'000123');
assert.equal(rows[0].remarks,'Household');
assert.equal(rows[1].credit,'50,000.00');
assert.equal(rows[2].balance,'60,700');
assert.equal(rows[0].id,'excel-row-3');
assert.equal(numericAccountAmount('₹1,250.00'),1250);
assert.equal(numericAccountAmount('(1,250.50)'),-1250.5);
assert.equal(numericAccountAmount('50,000.00'),50000);
assert.equal(numericAccountAmount('Balance carried'),null);
assert.ok(isValidAccountSaveRow(rows[0]));
assert.equal(isValidAccountSaveRow({date:'',details:'',chequeNo:'',debit:'',credit:'',balance:'',remarks:''}),false);
assert.throws(()=>accountRowsFromSheet(sheet,1,{}));
const extendedSheet={sheet:'Bank Detailed',rows:[
  ['Bank statement heading'],
  ['Transaction Date','Transaction Particulars','Chq./Ref.No.','Withdrawal Amt (INR)','Deposit Amt (INR)','Balance (INR)','Transaction Remarks'],
  ['2026-11-09','Online NEFT','001299','1499.00','','200500','Paid to family'],
  ['2026-11-10','ATM','003221','500.00','','200000','']
],cellNotes:['','','Approved on phone','Please verify beneficiary']};
const extendedMapping=guessAccountSheetHeader(extendedSheet);
assert.equal(extendedMapping.headerIndex,1);
assert.deepEqual(extendedMapping.mapping,{date:'0',details:'1',chequeNo:'2',debit:'3',credit:'4',balance:'5',remarks:'6'});
const extendedRows=accountRowsFromSheet(extendedSheet,extendedMapping.headerIndex,extendedMapping.mapping);
assert.equal(extendedRows.length,2);
assert.equal(extendedRows[0].chequeNo,'001299');
assert.equal(extendedRows[0].remarks,'Paid to family | Approved on phone');
assert.equal(extendedRows[1].remarks,'Please verify beneficiary');
// Missing Remarks header still imports Excel notes as editable Remarks.
const notesOnly={sheet:'No remarks column',rows:[
 ['Txn Date','Narration','Debit','Credit','Balance'],
 ['2026-11-11','Transfer','250','','12300']
],cellNotes:['','Personal note in a cell']};
const notesMapping=guessAccountSheetHeader(notesOnly);
assert.equal(accountRowsFromSheet(notesOnly,0,notesMapping.mapping)[0].remarks,'Personal note in a cell');
console.log('Personal Accounts mapping, prewritten Remarks, Excel notes, bank header variants and amounts verified.');
