import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const api=readFileSync('app/api/monthly-expenses/route.js','utf8');
const ui=readFileSync('app/MonthlyExpensesDashboard.js','utf8');

assert.ok(api.includes('CREATE TABLE IF NOT EXISTS mayavi_monthly_misc_entries('));
assert.ok(api.includes('remarks VARCHAR(120) NOT NULL'));
assert.ok(api.includes('created_by TEXT NOT NULL'));
assert.ok(api.includes('ORDER BY created_at DESC,id DESC'));
assert.ok(api.includes('miscEntries:miscEntries.map(entry=>('));
assert.ok(api.includes("if(!remarks||remarks.length>120)"));
assert.ok(api.includes('WITH added AS (')&&api.includes('updated AS ('),
  'Ledger entry and total must be saved together atomically');
assert.ok(api.includes('INSERT INTO mayavi_monthly_misc_entries(id,expense_month,amount,remarks,created_by)'));
assert.ok(api.includes('FROM added WHERE TRUE')&&api.includes('FROM updated CROSS JOIN added'));
assert.ok(api.includes('SET misc_expenses=mayavi_monthly_expenses.misc_expenses+EXCLUDED.misc_expenses'),
  'Previously saved Misc total should be preserved and increased');
assert.ok(!api.includes('DELETE FROM mayavi_monthly_expenses'));
assert.ok(ui.includes('const [miscRemark,setMiscRemark]=useState('));
assert.ok(ui.includes('const [miscEntries,setMiscEntries]=useState([])'));
assert.ok(ui.includes('aria-label="Miscellaneous Remarks"'));
assert.ok(ui.includes('placeholder="e.g. SIIB Monthly"'));
assert.ok(ui.includes("key==='misc'?{remarks:remark}:{}"));
assert.ok(ui.includes('verified.miscEntries?.some(entry=>entry.id===result.entry.id'),
  'Verify persisted remark/amount before success');
assert.ok(ui.includes("setMiscRemark('');"),
  'Clear Remarks after saving');
assert.ok(ui.includes('SAVED MISCELLANEOUS ENTRIES'));
assert.ok(ui.includes('Previously saved Miscellaneous (before Remarks)'));
assert.ok(ui.includes('value:savedTotals[head.key]'));
console.log('Monthly Miscellaneous Remarks regression passed: atomic save, ledger, legacy totals, UI.');
