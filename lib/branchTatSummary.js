import {dateValid,SERVICES} from './branchLoads.js';

// Count both calendar dates (booking and delivery); never infer an unverified delivery date.
export function inclusiveTatDays(bookingDate,deliveryDate){
  if(!dateValid(bookingDate)||!dateValid(deliveryDate))return null;
  const start=Date.parse(bookingDate+'T00:00:00Z');
  const end=Date.parse(deliveryDate+'T00:00:00Z');
  return end>=start?Math.round((end-start)/86400000)+1:null;
}

const normalizeLabel=value=>String(value||'').trim().replace(/\s+/g,' ')||'Not specified';
const knownServices=new Map(SERVICES.map(service=>[service.toUpperCase(),service]));

export function tatServiceName(value){
  const text=normalizeLabel(value);
  const key=text.toUpperCase().replace(/[.\s-]+/g,'');
  if(key==='FEDEX'||key==='FEDEXEXPRESS')return 'FedEx';
  if(key==='TPL')return 'TPL';
  return knownServices.get(text.toUpperCase())||text;
}
export function tatDestinationName(value){
  const text=normalizeLabel(value);
  const key=text.toUpperCase().replace(/[.\s-]+/g,'');
  if(['UK','UNITEDKINGDOM','GREATBRITAIN'].includes(key))return 'UK';
  if(['USA','US','UNITEDSTATES','UNITEDSTATESOFAMERICA'].includes(key))return 'USA';
  if(['CANADA'].includes(key))return 'Canada';
  if(['AUSTRALIA'].includes(key))return 'Australia';
  return text;
}

function tatGroups(validRecords,nameOf,priority=[]){
  const byName=new Map();
  for(const {row,days} of validRecords){
    const name=nameOf(row);
    const prior=byName.get(name)||{name,count:0,totalDays:0,fastest:null,slowest:null};
    prior.count++;
    prior.totalDays+=days;
    prior.fastest=prior.fastest===null?days:Math.min(prior.fastest,days);
    prior.slowest=prior.slowest===null?days:Math.max(prior.slowest,days);
    byName.set(name,prior);
  }
  for(const name of priority)if(!byName.has(name))byName.set(name,{name,count:0,totalDays:0,fastest:null,slowest:null});
  const groups=[...byName.values()].map(item=>({
    name:item.name,count:item.count,
    averageDays:item.count?Math.round(item.totalDays/item.count*10)/10:null,
    fastest:item.fastest,slowest:item.slowest
  }));
  return groups.sort((a,b)=>{
    const ai=priority.indexOf(a.name),bi=priority.indexOf(b.name);
    if(ai!==-1||bi!==-1)return ai===-1?1:bi===-1?-1:ai-bi;
    return a.name.localeCompare(b.name,'en',{sensitivity:'base'});
  });
}

export function summarizeBranchTat(rows=[]){
  const delivered=rows.filter(row=>row?.status==='DELIVERED');
  const valid=delivered.map(row=>({row,days:inclusiveTatDays(row.date,row.deliveredOn)}))
    .filter(item=>item.days!==null);
  const count=valid.length,daysTotal=valid.reduce((sum,item)=>sum+item.days,0);
  return {
    deliveredCount:delivered.length,
    verifiedCount:count,
    missingDateCount:delivered.length-count,
    averageDays:count?Math.round(daysTotal/count*10)/10:null,
    fastest:count?Math.min(...valid.map(item=>item.days)):null,
    slowest:count?Math.max(...valid.map(item=>item.days)):null,
    byService:tatGroups(valid,row=>tatServiceName(row.service),['FedEx','TPL']),
    byDestination:tatGroups(valid,row=>tatDestinationName(row.destination),['USA','UK','Canada','Australia'])
  };
}
