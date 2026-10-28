import {masterKg,partKg} from './arrivalWeights.js';

export const ledgerAwb=value=>{
  const digits=String(value??'').replace(/\D/g,'');
  return digits.length===11?digits:'';
};
export const paise=value=>Math.round((Number(value)||0)*100);
export const moneyFromPaise=value=>Math.round(Number(value)||0)/100;
export function ledgerWeight(data={}){
  const master=masterKg(data);
  if(master!==null)return master;
  // Fallback only if a master weight is missing; do not add parts to a
  // known master as that double-counts a multi-flight MAWB.
  const seen=new Set();
  let total=0;
  for(const part of Array.isArray(data.partShipments)?data.partShipments:[]){
    if(!part||part._saudiaPendingVirtual)continue;
    const key=String(part.partKey||part.partId||'').trim()||[
      part.flightNo||'',part.flightDate||part.departureDate||'',
      part.pieces||part.bags||'',part.weight||''
    ].join('|');
    if(seen.has(key))continue;
    seen.add(key);
    total+=partKg(part.weight)||0;
  }
  return total>0?total:null;
}
export function validLedgerDate(value){
  if(!/^20\d{2}-\d{2}-\d{2}$/.test(String(value||'')))return false;
  const d=new Date(value+'T00:00:00Z');
  return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===value;
}
export function validReceiptAmount(value){
  const str=String(value??'').trim();
  if(!/^\d{1,10}(?:\.\d{1,2})?$/.test(str))return null;
  const cents=paise(str);
  return Number.isSafeInteger(cents)&&cents>0?moneyFromPaise(cents):null;
}
// Build one invoice per master MAWB. A part shipment never becomes a second
// invoice. The rate is read from saved Import Profit Sheet financial inputs.
export function buildImportLedgerRows(shipments=[],profitRows=[],receipts=[]){
  const financials=new Map(profitRows.map(p=>[ledgerAwb(p.awb),p]));
  const received=new Map();
  for(const p of receipts){
    const awb=ledgerAwb(p.awb);
    if(!awb)continue;
    const prev=received.get(awb)||{cash:0,account:0,count:0};
    const mode=String(p.mode||'').toUpperCase();
    const amount=paise(p.amount);
    if(mode==='CASH')prev.cash+=amount;
    else if(mode==='ACCOUNT')prev.account+=amount;
    prev.count++;
    received.set(awb,prev);
  }
  const seen=new Set(),rows=[];
  for(const shipment of shipments){
    const awb=ledgerAwb(shipment.awb);
    if(!awb||seen.has(awb))continue;
    seen.add(awb);
    const d=shipment.data||{},w=ledgerWeight(d),raw=financials.get(awb)?.rate;
    const rate=raw===null||raw===undefined||String(raw).trim()===''?null:Number(raw);
    const validRate=rate!==null&&Number.isFinite(rate)&&rate>=0;
    const invoicePaise=w!==null&&validRate?paise(w*rate):null;
    const payments=received.get(awb)||{cash:0,account:0,count:0};
    const totalReceived=payments.cash+payments.account;
    rows.push({
      awb,mawb:awb.slice(0,3)+'-'+awb.slice(3),
      clientName:String(d.clientName||d.client||'Unassigned Client').trim()||'Unassigned Client',
      weight:w,rate:validRate?rate:null,
      amount:invoicePaise===null?null:moneyFromPaise(invoicePaise),
      cashReceived:moneyFromPaise(payments.cash),
      accountReceived:moneyFromPaise(payments.account),
      received:moneyFromPaise(totalReceived),
      balance:invoicePaise===null?null:moneyFromPaise(invoicePaise-totalReceived),
      payments:payments.count
    });
  }
  return rows.sort((a,b)=>a.clientName.localeCompare(b.clientName)||a.mawb.localeCompare(b.mawb));
}
export function summarizeImportLedger(rows=[]){
  const byClient=new Map();
  for(const row of rows){
    const label=String(row.clientName||'Unassigned Client').trim()||'Unassigned Client';
    const key=label.toUpperCase();
    const p=byClient.get(key)||{clientName:label,mawbs:0,unpriced:0,amountPaise:0,cashPaise:0,accountPaise:0,receivedPaise:0,balancePaise:0};
    p.mawbs++;
    if(row.amount===null)p.unpriced++;
    else p.amountPaise+=paise(row.amount);
    p.cashPaise+=paise(row.cashReceived);
    p.accountPaise+=paise(row.accountReceived);
    p.receivedPaise+=paise(row.received);
    if(row.balance!==null)p.balancePaise+=paise(row.balance);
    byClient.set(key,p);
  }
  return [...byClient.values()].map(p=>({
    clientName:p.clientName,mawbs:p.mawbs,unpriced:p.unpriced,
    amount:moneyFromPaise(p.amountPaise),
    cash:moneyFromPaise(p.cashPaise),
    account:moneyFromPaise(p.accountPaise),
    received:moneyFromPaise(p.receivedPaise),
    balance:moneyFromPaise(p.balancePaise)
  })).sort((a,b)=>a.clientName.localeCompare(b.clientName));
}
