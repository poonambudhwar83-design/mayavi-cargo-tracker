import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {monthlyAmount,calculateMonthlyExpenses} from '../lib/monthlyExpenses.js';
const api=readFileSync('app/api/monthly-expenses/route.js','utf8');
const ui=readFileSync('app/MonthlyExpensesDashboard.js','utf8');
assert.equal(monthlyAmount('0'),0);
assert.equal(monthlyAmount('3500.75'),3500.75);
assert.equal(monthlyAmount('-10'),null);
assert.equal(monthlyAmount('12.567'),null);
const adjust=(total,oldAmount,newAmount)=>Math.round((total-oldAmount+newAmount)*100)/100;
assert.equal(adjust(20000,5000,3000),18000,'Reducing an existing amount deducts only the difference');
assert.equal(adjust(20000,5000,7000),22000,'Increasing an existing amount adds only the difference');
assert.equal(adjust(20000,5000,5000),20000,'Remarks-only changes do not affect totals');
assert.equal(adjust(5000,5000,0),0);
assert.equal(adjust(12500.25,4000.15,4500.20),13000.3);
assert.equal(calculateMonthlyExpenses({importGross:30000,misc:18000}).finalProfit-
             calculateMonthlyExpenses({importGross:30000,misc:20000}).finalProfit,2000);

for(const phrase of [
 "if(field==='edit_misc')","if(!adminOnly(request))",
 "const previousAmount=monthlyAmount(body.previousAmount)",
 "const previousRemarks=String(body.previousRemarks",
 "if(!remarks||remarks.length>120||!previousRemarks||previousRemarks.length>120)",
 'WITH edited AS (','UPDATE mayavi_monthly_misc_entries',
 'SET amount=${amount},remarks=${remarks}',
 'WHERE id=${id}::uuid AND expense_month=${month}',
 'AND amount=${previousAmount} AND remarks=${previousRemarks}',
 'EXISTS(SELECT 1 FROM mayavi_monthly_expenses',
 'SET misc_expenses=mayavi_monthly_expenses.misc_expenses+',
 '(${amount}::numeric-${previousAmount}::numeric)',
 'WHERE expense_month=${month} AND EXISTS(SELECT 1 FROM edited)',
 'SELECT adjusted.misc_expenses AS total,edited.id::text AS id',
 'Refresh the month and try again.'
])assert.ok(api.includes(phrase),'API must implement safe edit: '+phrase);
assert.ok(!api.includes('DELETE FROM mayavi_monthly_misc_entries'));

for(const phrase of [
 'const [editingMisc,setEditingMisc]=useState(null)',
 'const [miscEditBusy,setMiscEditBusy]=useState(false)',
 'function beginMiscEdit(entry)',
 'async function saveMiscEdit()',
 "field:'edit_misc',id:draft.id",
 'previousAmount:draft.previousAmount',
 'previousRemarks:draft.previousRemarks',
 'savedEntry.remarks!==remark||Number(savedEntry.amount)!==Number(raw)',
 'Number(verified.misc)!==Number(updated.value)',
 'setMiscEntries(verified.miscEntries)',
 'setSavedTotals(previous=>({...previous,misc:Number(verified.misc)}))',
 'setRecord(previous=>previous?{...previous,values:{...previous.values,misc:Number(verified.misc)}}:previous)',
 'SAVE CHANGES','>CANCEL</button>','>EDIT</button>',
 'editingMisc?.id===entry.id',
 'Object.values(busy).some(Boolean)||editingMisc||miscEditBusy',
 'disabled={miscEditBusy}',
 'Previously saved Miscellaneous (before Remarks)'
])assert.ok(ui.includes(phrase),'UI must allow verified edit: '+phrase);
console.log('Monthly Misc edit regression passed: optimistic edit and accurate amount delta, legacy preservation.');
