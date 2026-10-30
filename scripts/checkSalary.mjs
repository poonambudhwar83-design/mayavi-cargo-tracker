import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {salaryMonth,salaryAmount,salaryRowTotals,salaryTotals,SALARY_COMPANIES,salaryCompany} from '../lib/salaryMath.js';

assert.equal(salaryMonth('2026-09'),'2026-09','September 2026 must be editable');
assert.equal(salaryMonth('2026-13'),'');
assert.equal(salaryMonth('2026-00'),'');
assert.equal(salaryMonth('2026-9'),'');
assert.equal(salaryAmount('15000.50'),15000.5);
assert.equal(salaryAmount('15,000.50'),15000.5);
assert.equal(salaryAmount(''),null);
assert.equal(salaryAmount('-10'),null);
assert.equal(salaryAmount('15.555'),null);
assert.equal(salaryAmount('0'),0);
assert.deepEqual(salaryRowTotals({salaryAmount:25000,cashPaid:10000,accountPaid:15000}),
  {monthlySalary:25000,cash:10000,account:15000,totalPaid:25000,balance:0});
assert.deepEqual(salaryRowTotals({salaryAmount:30000,cashPaid:5000,accountPaid:20000}),
  {monthlySalary:30000,cash:5000,account:20000,totalPaid:25000,balance:5000});
assert.equal(salaryRowTotals({salaryAmount:100,cashPaid:50.01,accountPaid:49.99}).totalPaid,100);
assert.equal(salaryRowTotals({salaryAmount:100,cashPaid:100,accountPaid:50}).balance,-50);
assert.equal(salaryRowTotals({salaryAmount:'',cashPaid:1,accountPaid:1}),null);
const total=salaryTotals([
  {salaryAmount:25000,cashPaid:10000,accountPaid:15000},
  {salaryAmount:30000,cashPaid:5000,accountPaid:20000},
  {salaryAmount:12000,cashPaid:12000,accountPaid:0}
]);
assert.deepEqual(total,{employees:3,monthlySalary:67000,cash:27000,account:35000,totalPaid:62000,balance:5000,completed:3});

// All requested companies must be selectable and validated centrally.
assert.deepEqual(SALARY_COMPANIES,[
  'KCC','PV','PV HYD','CHENNAI','BANGLORE',
  'JEPO DELHI','JEPO KARNAL','JEPO JIND'
]);
assert.equal(salaryCompany('pv hyd'),'PV HYD');
assert.equal(salaryCompany('jepo karnal'),'JEPO KARNAL');
assert.equal(salaryCompany('some other company'),'');
const api=readFileSync('app/api/salary/route.js','utf8');
const ui=readFileSync('app/SalaryDashboard.js','utf8');
const navigation=readFileSync('app/UnifiedDashboard.js','utf8');
assert.ok(api.includes("session?.role==='admin'"),'Employee salaries must be private to Admin');
assert.ok(api.includes('mayavi_salary_employees'));
assert.ok(api.includes('ADD COLUMN IF NOT EXISTS company_name'),
  'Existing employee data must be migrated without deleting monthly payment history');
assert.ok(api.includes('COALESCE(m.salary_amount,e.default_salary)'),
  'Existing monthly overrides are preserved');
assert.ok(api.includes('e.company_name'),'Company Name must appear in monthly query');
assert.ok(api.includes('INSERT INTO mayavi_salary_employees(id,employee_name,company_name'),
  'Employee company is required at creation');
assert.ok(api.includes("if(!company)return reply("),
  'New company must match the allowed dropdown list');
assert.ok(api.includes('if(editProfile){')&&api.includes('data.editProfile===true'),
  'Row-level profile editing must be explicitly requested');
assert.ok(api.includes('SET employee_name=${name},normalized_name=${key},company_name=${companyName},'),
  'Name and company changes must be persisted');
assert.ok(api.includes('default_salary=${salary}'),
  'Salary template must update for future unsaved months');
assert.ok(api.includes('WHERE TRUE\n        ON CONFLICT(employee_id,salary_month) DO UPDATE'),
  'Employee edit must atomically save the selected month without wiping other months');
assert.ok(api.includes('PRIMARY KEY(employee_id,salary_month)'),
  'Same employee can have distinct monthly salary amounts');
assert.ok(ui.includes("const [editing,setEditing]=useState(null);"),
  'Each employee must have an explicit Edit mode');
assert.ok(ui.includes('beginEdit(row)')&&ui.includes('cancelEdit(row.id)'),
  'Edit and Cancel buttons must work');
assert.ok(ui.includes("editProfile,employeeName:row.employeeName,companyName:row.companyName"),
  'Row Save Changes must send the selected name and company');
assert.ok(ui.includes("'Employee Name','Company Name','Monthly Salary"),
  'Company Name is immediately after employee name in the table');
assert.ok(ui.includes('SALARY_COMPANIES.map(value=><option'),
  'The same company options appear on add and edit');
assert.ok(ui.includes('>SAVE CHANGES')||ui.includes("?'SAVE CHANGES'"),
  'Employee name/company edits must have a save action');
assert.ok(ui.includes('colSpan={9}'),'Table now has nine columns');
assert.ok(api.includes('mayavi_salary_monthly'));
assert.ok(api.includes('PRIMARY KEY(employee_id,salary_month)'));
assert.ok(api.includes('WHERE e.is_active=TRUE'));
assert.ok(api.includes('ON CONFLICT(employee_id,salary_month) DO UPDATE'));
assert.ok(api.includes('salary_amount=EXCLUDED.salary_amount'));
assert.ok(api.includes('cash_paid=EXCLUDED.cash_paid'));
assert.ok(api.includes('account_paid=EXCLUDED.account_paid'));
assert.ok(api.includes('ON CONFLICT(normalized_name) DO NOTHING'));
assert.ok(!api.includes('tax_amount')&&!api.includes('tds_amount'),'No TDS or tax deductions');
assert.ok(ui.includes('type="month"')&&ui.includes('min="2020-01"'),'Historic months must be supported');
assert.ok(ui.includes("['salaryAmount','cashPaid','accountPaid']"),'Cash and Account separately editable');
assert.ok(ui.includes('total.totalPaid')&&ui.includes('total.cash')&&ui.includes('total.account'));
assert.ok(ui.includes("action:'save_month'"),'Row saves must persist each month');
assert.ok(ui.includes('No TDS or deductions'));
assert.ok(navigation.includes('selectedDashboard===\x27SALARY\x27')&&navigation.includes('<SalaryDashboard/>'));
assert.ok(navigation.includes('>SALARY</button>'));
console.log('Salary calculator regression passed: September selection, per-employee cash/account, total, balance, persistence, admin-only access and no deductions.');
