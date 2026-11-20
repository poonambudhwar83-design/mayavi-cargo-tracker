// Aggregate each customer's records inside one selected month.
// Allocation values are computed by the existing master-level engine.
// No database writes or source-row mutations happen here.
const customerKey=s=>String(s||'').trim().replace(/\s+/g,' ').toLocaleLowerCase('en');
const text=v=>String(v??'').trim();
const numeric=v=>{const n=Number(text(v).replace(/[,₹\s]/g,''));return text(v)===''||!Number.isFinite(n)?null:n;};
const displayLabels=set=>[...set].filter(Boolean).join(' • ')||'—';
export function importMonthlyCustomerLedger(rows,calculated){
  const groups=new Map();
  for(const row of rows||[]){
    const name=text(row.customerName)||'Customer not entered';
    const key=customerKey(name);
    if(!groups.has(key))groups.set(key,{
      id:key, customerName:name, origin:new Set(), description:new Set(), masters:new Set(),
      totalWeight:0,totalBags:0,totalProfit:0,validProfitRows:0,pendingProfitRows:0,entries:[]
    });
    const g=groups.get(key);
    if(text(row.origin))g.origin.add(text(row.origin));
    if(text(row.description))g.description.add(text(row.description));
    if(text(row.masterNo))g.masters.add(text(row._batchId||'')+'|'+text(row.masterNo));
    const weight=numeric(row.customerWeight),bags=numeric(row.customerBags);
    if(weight!==null)g.totalWeight+=weight;
    if(bags!==null)g.totalBags+=bags;
    const calc=calculated?.get(row.id);
    const profit=calc?.pl;
    if(typeof profit==='number'&&Number.isFinite(profit)){g.totalProfit+=profit;g.validProfitRows++;}
    else g.pendingProfitRows++;
    g.entries.push({...row,profit:typeof profit==='number'&&Number.isFinite(profit)?profit:null});
  }
  const result=[...groups.values()].map(g=>({
    ...g,originText:displayLabels(g.origin),descriptionText:displayLabels(g.description),
    masterCount:g.masters.size,
    entries:g.entries.sort((a,b)=>String(a.flightDate||'').localeCompare(String(b.flightDate||''))||String(a.masterNo||'').localeCompare(String(b.masterNo||'')))
  }));
  return result.sort((a,b)=>a.customerName.localeCompare(b.customerName,undefined,{sensitivity:'base'}));
}
