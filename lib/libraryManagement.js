// Pure calendar-date and fee calculations for Mayavi Library.
// Dates are YYYY-MM-DD and are interpreted as calendar days, not timestamps.
export const LIBRARY_DURATIONS=Object.freeze([
 {value:'7d',label:'7 Days'},{value:'15d',label:'15 Days'},
 ...Array.from({length:6},(_,i)=>({value:(i+1)+'m',label:(i+1)+' Month'+(i?'s':'')}))
]);
export const LIBRARY_DURATION_VALUES=new Set(LIBRARY_DURATIONS.map(x=>x.value));
export const libraryTodayIST=()=>new Date(Date.now()+330*60000).toISOString().slice(0,10);
export function libraryDate(value){
 const s=String(value??'');
 if(!/^20\d{2}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(s))return '';
 const d=new Date(s+'T00:00:00Z');
 return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===s?s:'';
}
const iso=d=>d.toISOString().slice(0,10);
export function libraryAddDays(date,days){
 const valid=libraryDate(date);if(!valid||!Number.isSafeInteger(days))return '';
 const d=new Date(valid+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+days);
 return iso(d);
}
export function libraryRenewalDue(start,duration){
 const date=libraryDate(start);if(!date||!LIBRARY_DURATION_VALUES.has(duration))return '';
 if(duration.endsWith('d'))return libraryAddDays(date,Number(duration.slice(0,-1)));
 const months=Number(duration.slice(0,-1));
 const d=new Date(date+'T00:00:00Z');
 const originalDay=d.getUTCDate();
 const first=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+months,1));
 const last=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate();
 first.setUTCDate(Math.min(originalDay,last));
 return iso(first);
}
export function libraryPaidThrough(start,duration){
 const due=libraryRenewalDue(start,duration);
 return due?libraryAddDays(due,-1):'';
}
export function libraryNextCycleStart(dueDate,renewOn){
 const due=libraryDate(dueDate),on=libraryDate(renewOn);
 if(!on)return '';
 return due&&due>on?due:on;
}
export const libraryPaymentMode=v=>['CASH','ONLINE'].includes(v)?v:'';
export const libraryPaymentKind=v=>['FULL','PART'].includes(v)?v:'';
export function libraryMoney(value){
 if(value===null||value===undefined||value==='')return null;
 const n=Number(value);
 return Number.isFinite(n)&&n>=0&&n<=10000000&&Math.abs(Math.round(n*100)-n*100)<1e-7?Math.round(n*100)/100:null;
}
export function libraryPayment({amount,paymentKind,pay1,pay2,payMode1,payMode2}={}){
 const fee=libraryMoney(amount),kind=libraryPaymentKind(paymentKind),mode1=libraryPaymentMode(payMode1);
 if(fee===null||!kind||!mode1)return {ok:false,error:'Enter valid fee, payment type and Cash/Online mode.'};
 if(kind==='FULL')return {ok:true,amount:fee,paymentKind:kind,pay1:fee,pay2:0,payMode1:mode1,payMode2:'',balance:0};
 const first=libraryMoney(pay1??0),second=libraryMoney(pay2??0);
 if(first===null||second===null||first+second>fee+.001)
  return {ok:false,error:'Part payments must be valid and not exceed the fee.'};
 const mode2=second>0?libraryPaymentMode(payMode2):'';
 if(second>0&&!mode2)return {ok:false,error:'Choose Cash or Online for the second payment.'};
 return {ok:true,amount:fee,paymentKind:kind,pay1:first,pay2:second,payMode1:mode1,payMode2:mode2,balance:Math.round((fee-first-second)*100)/100};
}
export function libraryRenewalState(dueDate,today=libraryTodayIST()){
 if(!libraryDate(dueDate)||!libraryDate(today))return 'UNKNOWN';
 return dueDate<today?'OVERDUE':dueDate===today?'DUE':'ACTIVE';
}
export function libraryRenewalList(rows=[],today=libraryTodayIST()){
 return rows.filter(row=>row.isActive!==false&&libraryDate(row.dueDate)&&row.dueDate<=today)
  .sort((a,b)=>a.dueDate.localeCompare(b.dueDate)||String(a.studentName).localeCompare(String(b.studentName)));
}
