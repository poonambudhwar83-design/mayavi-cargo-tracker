import {branchPayoutForRecord,totalJepoForLoad} from './branchLoads.js';

const moneyRound=x=>Math.round((x+Number.EPSILON)*100)/100;
const validMonthDate=d=>{
 const text=String(d??'').slice(0,10);
 if(!/^20\d{2}-\d{2}-\d{2}$/.test(text))return '';
 const parsed=new Date(text+'T00:00:00Z');
 return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===text?text:'';
};
const number=x=>{const n=Number(x??0);return Number.isFinite(n)?n:0;};
const empty=(label='')=>({label,loads:0,delivered:0,active:0,weight:0,amount:0,received:0,balance:0,paidToJepo:0,paidToBranch:0,totalJepo:0,extraCost:0});
const apply=(totals,row)=>{
 totals.loads++;
 totals[row.status==='DELIVERED'?'delivered':'active']++;
 totals.weight+=number(row.weight);
 totals.amount+=number(row.amount);
 totals.received+=number(row.received);
 totals.balance+=number(row.balance);
 totals.paidToJepo+=number(row.paidToJepo);
 totals.paidToBranch+=number(branchPayoutForRecord(row));
 totals.totalJepo+=number(totalJepoForLoad(row.paidToJepo,row.commodity,row.extraCost,row.bottleCount,{legacy:true}));
 totals.extraCost+=number(row.extraCost);
 return totals;
};
const finish=t=>({
 ...t,
 weight:Math.round((t.weight+Number.EPSILON)*1000)/1000,
 amount:moneyRound(t.amount),
 received:moneyRound(t.received),
 balance:moneyRound(t.balance),
 paidToJepo:moneyRound(t.paidToJepo),
 paidToBranch:moneyRound(t.paidToBranch),
 totalJepo:moneyRound(t.totalJepo),
 extraCost:moneyRound(t.extraCost)
});
export function branchMonths(rows=[]){
 return [...new Set(rows.map(r=>validMonthDate(r.date).slice(0,7)).filter(Boolean))].sort().reverse();
}

// Each existing saved load counts once in its *booking month*, even after it
// moves to Delivered. Month, branch and destination are not inferred from
// delivered_on or updated_at, and older financial records are never changed.
export function aggregateBranchMonthly(rows=[],{month=''}={}){
 const branchMap=new Map(),monthMap=new Map(),serviceMap=new Map(),countryMap=new Map();
 const selected=[];
 const grand=empty('All Branches');
 let missingDates=0;
 for(const row of rows){
  const date=validMonthDate(row.date);
  if(!date){missingDates++;continue;}
  const bookingMonth=date.slice(0,7);
  const historyKey=bookingMonth+'|'+row.branch;
  const history=monthMap.get(historyKey)||{...empty(row.branch),month:bookingMonth,branch:row.branch};
  apply(history,row);monthMap.set(historyKey,history);
  if(month&&bookingMonth!==month)continue;
  selected.push(row);
  apply(grand,row);
  const b=branchMap.get(row.branch)||empty(row.branch);apply(b,row);branchMap.set(row.branch,b);
  const service=String(row.service||'Not specified').trim()||'Not specified';
  const svc=serviceMap.get(service)||empty(service);apply(svc,row);serviceMap.set(service,svc);
  const country=String(row.destination||'Not specified').trim()||'Not specified';
  const dst=countryMap.get(country)||empty(country);apply(dst,row);countryMap.set(country,dst);
 }
 const ordered=(map)=>[...map.values()].map(finish).sort((a,b)=>b.loads-a.loads||a.label.localeCompare(b.label));
 const history=[...monthMap.values()].map(finish).sort((a,b)=>
  b.month.localeCompare(a.month)||a.branch.localeCompare(b.branch));
 return {months:branchMonths(rows),selectedRows:selected.sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))||String(a.id||'').localeCompare(String(b.id||''))),
  grand:finish(grand),branches:ordered(branchMap),byService:ordered(serviceMap),byCountry:ordered(countryMap),
  history,missingDates};
}
