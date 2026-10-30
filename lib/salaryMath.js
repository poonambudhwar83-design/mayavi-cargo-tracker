// Simple salary math: no TDS, tax, PF or other deductions.
export function salaryMonth(value){
  const text=String(value||'');
  if(!/^(20\d{2})-(0[1-9]|1[0-2])$/.test(text))return '';
  const year=Number(text.slice(0,4));
  return year>=2020&&year<=2100?text:'';
}
export function salaryAmount(value){
  if(value===null||value===undefined||String(value).trim()==='')return null;
  const s=String(value).trim().replace(/,/g,'');
  if(!/^\d+(?:\.\d{1,2})?$/.test(s))return null;
  const n=Number(s);
  return Number.isFinite(n)&&n>=0&&n<=999999999?Math.round(n*100)/100:null;
}
const cents=n=>Math.round((Number(n)||0)*100);
export function salaryRowTotals(row={}){
  const monthly=salaryAmount(row.salaryAmount),cash=salaryAmount(row.cashPaid),
    account=salaryAmount(row.accountPaid);
  if(monthly===null||cash===null||account===null)return null;
  const paidCents=cents(cash)+cents(account);
  return {monthlySalary:monthly,cash,account,
    totalPaid:paidCents/100,balance:(cents(monthly)-paidCents)/100};
}
export function salaryTotals(rows=[]){
  const total={employees:rows.length,monthlySalary:0,cash:0,account:0,totalPaid:0,balance:0,completed:0};
  for(const row of rows){
    const figures=salaryRowTotals(row);
    if(!figures)continue;
    total.completed++;
    for(const key of ['monthlySalary','cash','account','totalPaid','balance'])
      total[key]=Math.round(total[key]*100+figures[key]*100)/100;
  }
  return total;
}

// Employee's home company is stored once and reused in every salary month.
export const SALARY_COMPANIES=Object.freeze([
  'KCC','PV','PV HYD','CHENNAI','BANGLORE',
  'JEPO DELHI','JEPO KARNAL','JEPO JIND','AIRPORT STAFF'
]);
export function salaryCompany(value){
  const text=String(value??'').trim().toUpperCase().replace(/\s+/g,' ');
  return SALARY_COMPANIES.includes(text)?text:'';
}

// Employee role is independent of company and month-specific salary payments.
export const SALARY_DESIGNATIONS=Object.freeze([
  'AIRPORT STAFF',
  'WAREHOUSE PACKING',
  'BOOKING STAFF',
  'GROUP D',
  'WAREHOUSE MANAGER',
  'OFFICE MANAGER',
  'SENIOR MANAGER',
  'HEAD',
  'DIRECTOR'
]);
export function salaryDesignation(value){
  const normalized=String(value??'').trim().toUpperCase().replace(/\s+/g,' ');
  return SALARY_DESIGNATIONS.includes(normalized)?normalized:'';
}

// Display-only company families. The saved Company Name for each employee is
// never changed, so JEPO Delhi/Karnal/Jind and PV/PV HYD retain their identity.
export const SALARY_COMPANY_GROUPS=Object.freeze([
  {name:'JEPO',companies:['JEPO DELHI','JEPO KARNAL','JEPO JIND']},
  {name:'KCC',companies:['KCC']},
  {name:'PV',companies:['PV','PV HYD']},
  {name:'CHENNAI',companies:['CHENNAI']},
  {name:'BANGLORE',companies:['BANGLORE']},
  {name:'AIRPORT STAFF',companies:['AIRPORT STAFF']}
]);
export function salaryCompanyGroup(company){
  const normalized=String(company??'').trim().toUpperCase();
  return SALARY_COMPANY_GROUPS.find(group=>group.companies.includes(normalized))?.name||'UNASSIGNED';
}
export function salaryCompanyGroups(rows=[],getCompany=row=>row.companyName){
  const grouped=new Map();
  for(const row of rows){
    const company=String(getCompany(row)||'').trim().toUpperCase()||'UNASSIGNED';
    const group=salaryCompanyGroup(company);
    if(!grouped.has(group))grouped.set(group,new Map());
    const companies=grouped.get(group);
    if(!companies.has(company))companies.set(company,[]);
    companies.get(company).push(row);
  }
  return [...grouped].sort(([a],[b])=>{
    const index=x=>SALARY_COMPANY_GROUPS.findIndex(group=>group.name===x);
    const ai=index(a),bi=index(b);
    return (ai<0?999:ai)-(bi<0?999:bi);
  }).map(([name,companies])=>{
    const order=SALARY_COMPANY_GROUPS.find(g=>g.name===name)?.companies||[];
    const parts=[...companies].sort(([a],[b])=>
      (order.indexOf(a)<0?999:order.indexOf(a))-(order.indexOf(b)<0?999:order.indexOf(b))
    ).map(([company,items])=>({name:company,rows:items,totals:salaryTotals(items)}));
    const entries=parts.flatMap(p=>p.rows);
    return {name,companies:parts,totals:salaryTotals(entries)};
  });
}
