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
