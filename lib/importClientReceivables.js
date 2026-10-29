import {ledgerAwb,ledgerWeight,paise,moneyFromPaise,validLedgerDate} from './importClientLedger.js';

export const clientKey=v=>String(v||'').trim().replace(/\s+/g,' ').toUpperCase();
export const clientLabel=data=>String(data?.clientName||data?.client||'Unassigned Client').trim()||'Unassigned Client';
export const istDate=value=>{
  const d=new Date(value||Date.now());
  if(!Number.isFinite(d.getTime()))return '';
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
    timeZone:'Asia/Kolkata',day:'2-digit',month:'2-digit',year:'numeric'
  }).formatToParts(d).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
  return p.year+'-'+p.month+'-'+p.day;
};
export const masterCustomsClearance=data=>{
  if(data?.customsCleared===true&&data?.customsClearedAt){
    const at=new Date(data.customsClearedAt);
    if(!Number.isNaN(at.getTime()))return at.toISOString();
  }
  const list=Array.isArray(data?.partShipments)?data.partShipments:[];
  if(!list.length)return '';
  // Every physical part of a split master must clear before master-level billing.
  const parts=new Map();
  for(let i=0;i<list.length;i++){
    const p=list[i];if(!p||p._saudiaPendingVirtual)continue;
    const key=String(p.partKey||p.partId||'').trim()||[p.flightNo,p.flightDate,p.pieces,p.weight].join('|');
    const prev=parts.get(key);
    // A real part may have multiple tracking events. A verified cleared flag
    // is retained for that physical part, never counted as another invoice.
    if(!prev||(!prev.customsCleared&&p.customsCleared))parts.set(key,p);
  }
  if(!parts.size||[...parts.values()].some(p=>p.customsCleared!==true||!p.customsClearedAt))return '';
  const times=[...parts.values()].map(p=>new Date(p.customsClearedAt).getTime());
  if(times.some(t=>!Number.isFinite(t)))return '';
  return new Date(Math.max(...times)).toISOString();
};
const nonneg=value=>{
  if(value===null||value===undefined||String(value).trim()==='')return 0;
  const num=Number(value);
  return Number.isFinite(num)&&num>=0?num:0;
};
export function masterReceivable(shipment={},financial={},partExtras=[]){
  const data=shipment.data||shipment;
  const weight=ledgerWeight(data);
  const rate=financial?.rate===null||financial?.rate===undefined||String(financial.rate).trim()===''
    ?null:Number(financial.rate);
  const validRate=Number.isFinite(rate)&&rate!==null&&rate>=0;
  const seen=new Set();
  let extra=nonneg(financial?.excess_weight);
  for(const p of partExtras||[]){
    const key=String(p.part_key||p.partKey||'');
    if(!key||seen.has(key))continue;
    seen.add(key);
    extra+=nonneg(p.excess_weight);
  }
  return {
    weight,extraWeight:Math.round(extra*10000)/10000,rate:validRate?rate:null,
    billedWeight:weight===null?null:Math.round((weight+extra)*10000)/10000,
    amount:weight===null||!validRate?null:moneyFromPaise(paise((weight+extra)*rate))
  };
}
const cents=value=>Math.round((Number(value)||0)*100);
const amount=value=>moneyFromPaise(value);
const dateInScope=(s,day)=>String(day||'')>=String(s||'');
export function settleClientReceivables(opening={},invoiceRows=[],paymentRows=[],todayDate=istDate()){
  const start=istDate(opening.started_at||opening.startedAt)||todayDate;
  const openingAmount=cents(opening.amount);
  const invoices=(invoiceRows||[]).map(r=>({
    ...r,awb:ledgerAwb(r.awb),mawb:ledgerAwb(r.awb).replace(/^(\d{3})(\d{8})$/,'$1-$2'),
    amount:Number(r.amount),dueCents:cents(r.amount),paidCents:0,
    cashCents:0,accountCents:0,allocations:[],
    eventDate:istDate(r.recognized_at||r.recognizedAt||r.created_at||r.createdAt)
  })).filter(r=>r.awb&&r.dueCents>=0).sort((a,b)=>
    new Date(a.recognized_at||a.recognizedAt||a.created_at||a.createdAt)-new Date(b.recognized_at||b.recognizedAt||b.created_at||b.createdAt)||
    a.awb.localeCompare(b.awb));
  const receipts=(paymentRows||[]).map(r=>({
    ...r,date:String(r.payment_date||r.date||'').slice(0,10),
    amount:Number(r.amount),pendingCents:cents(r.amount),allocations:[]
  })).filter(r=>r.amount>0).sort((a,b)=>a.date.localeCompare(b.date)||
    new Date(a.created_at||a.createdAt)-new Date(b.created_at||b.createdAt)||
    String(a.id).localeCompare(String(b.id)));
  const openingAllocations=[];
  let openingPaid=0,openingCash=0,openingAccount=0,unallocated=0;
  for(const receipt of receipts){
    let left=receipt.pendingCents;
    if(openingPaid<openingAmount){
      const take=Math.min(left,openingAmount-openingPaid);
      if(take>0){
        openingPaid+=take;
        if(String(receipt.mode).toUpperCase()==='CASH')openingCash+=take;
        else openingAccount+=take;
        openingAllocations.push({receiptId:receipt.id,date:receipt.date,mode:receipt.mode,amount:amount(take)});
        receipt.allocations.push({target:'OPENING BALANCE',amount:amount(take)});
        left-=take;
      }
    }
    for(const invoice of invoices){
      if(left<=0)break;
      const toPay=Math.min(left,invoice.dueCents-invoice.paidCents);
      if(toPay<=0)continue;
      invoice.paidCents+=toPay;
      if(String(receipt.mode).toUpperCase()==='CASH')invoice.cashCents+=toPay;
      else invoice.accountCents+=toPay;
      invoice.allocations.push({receiptId:receipt.id,date:receipt.date,mode:receipt.mode,amount:amount(toPay)});
      receipt.allocations.push({target:invoice.mawb,amount:amount(toPay)});
      left-=toPay;
    }
    receipt.pendingCents=left;
    unallocated+=left;
  }
  let invoiceDue=0,invoiceGross=0,invoicePaid=0;
  for(const i of invoices){
    i.received=amount(i.paidCents);i.cashReceived=amount(i.cashCents);
    i.accountReceived=amount(i.accountCents);i.balance=amount(i.dueCents-i.paidCents);
    i.paymentStatus=i.balance===0?'CLEARED':i.received>0?'PART PAID':'PENDING';
    invoiceDue+=i.dueCents-i.paidCents;invoicePaid+=i.paidCents;invoiceGross+=i.dueCents;
    delete i.dueCents;delete i.paidCents;delete i.cashCents;delete i.accountCents;
  }
  const openingOutstanding=openingAmount-openingPaid;
  const totalReceipts=receipts.reduce((v,r)=>v+cents(r.amount),0);
  const remaining=openingOutstanding+invoiceDue;
  const getDay=x=>String(x||'').slice(0,10);
  // Backdated payments are allowed. Extend the daily ledger back to the
  // oldest historical receipt instead of silently excluding it from the
  // daily roll-forward when it predates opening-balance setup.
  const historicalDates=receipts.map(r=>r.date).filter(validLedgerDate);
  const dailyStart=historicalDates.length?[start,...historicalDates].sort()[0]:start;
  const daily=[];
  if(validLedgerDate(dailyStart)&&dailyStart<=todayDate){
    const byDayInvoices=new Map(),byDayPayments=new Map();
    for(const row of invoices){
      const d=row.eventDate||start;
      if(dateInScope(dailyStart,d)&&d<=todayDate)byDayInvoices.set(d,(byDayInvoices.get(d)||0)+cents(row.amount));
    }
    for(const p of receipts){
      if(dateInScope(dailyStart,p.date)&&p.date<=todayDate)byDayPayments.set(p.date,(byDayPayments.get(p.date)||0)+cents(p.amount));
    }
    // Keep daily opening for up to 500 days; no artificial reset at midnight.
    let running=openingAmount;
    const initial=new Date(dailyStart+'T00:00:00Z');
    for(let i=0;i<500;i++){
      const dateValue=new Date(initial.getTime()+i*86400000).toISOString().slice(0,10);
      if(dateValue>todayDate)break;
      const accrued=byDayInvoices.get(dateValue)||0,received=byDayPayments.get(dateValue)||0;
      const beginning=running;running+=accrued-received;
      daily.push({date:dateValue,opening:amount(beginning),newReceivables:amount(accrued),
        amountReceived:amount(received),closing:amount(running)});
    }
  }
  return {
    opening:{...opening,amount:amount(openingAmount),received:amount(openingPaid),
      cashReceived:amount(openingCash),accountReceived:amount(openingAccount),
      balance:amount(openingOutstanding),allocations:openingAllocations,startDate:start,
      dailyStartDate:dailyStart},
    invoices,receipts:receipts.map(r=>({...r,unallocated:amount(r.pendingCents),pendingCents:undefined})),
    daily,totals:{
      opening:amount(openingAmount),openingPending:amount(openingOutstanding),
      newReceivables:amount(invoiceGross),invoiceReceived:amount(invoicePaid),
      receipts:amount(totalReceipts),outstanding:amount(remaining),
      credit:amount(unallocated),netBalance:amount(remaining-unallocated),
      invoiceCount:invoices.length,clearedCount:invoices.filter(x=>x.balance===0).length
    }
  };
}
