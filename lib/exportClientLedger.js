import {ledgerAwb,ledgerWeight,paise,moneyFromPaise} from './importClientLedger.js';
import {includeExportMasterInProfit,exportProfitRegister} from './exportProfitSource.js';
import {exportProfitHandoverDate} from './profitPeriod.js';

// Keep Export client billing separate from Export Profit and Import receivables.
// EICI is a manually entered rupee AMOUNT per master MAWB, never an assumed rate.
export const exportClientKey=value=>String(value||'').trim().replace(/\s+/g,' ').toUpperCase();
export const exportIsDhl=value=>/\bDHL\b/i.test(String(value||''));
export const exportSplitScheme=value=>value==='2_ACCOUNT_4_CASH'?'2_ACCOUNT_4_CASH':'3_ACCOUNT_3_CASH';
const amount=cents=>moneyFromPaise(cents);
const cents=value=>paise(value);
const valid=number=>Number.isFinite(number)&&number>=0;
export const validEiciAmount=value=>{
  const str=String(value??'').trim();
  if(!/^\d{1,10}(?:\.\d{1,2})?$/.test(str))return null;
  const parsed=Number(str);
  return valid(parsed)?parsed:null;
};
export function buildExportClientLedgerRows(shipments=[],eiciRows=[],splitRows=[],receipts=[],month='',currentMonth=''){
  const eici=new Map(eiciRows.map(row=>[ledgerAwb(row.awb),row.amount===null?null:Number(row.amount)]));
  const splits=new Map(splitRows.map(row=>[exportClientKey(row.client_key),exportSplitScheme(row.scheme)]));
  const received=new Map();
  for(const item of receipts){
    const awb=ledgerAwb(item.awb),mode=String(item.mode||'').toUpperCase();
    if(!awb||!['ACCOUNT','CASH'].includes(mode))continue;
    const prev=received.get(awb)||{ACCOUNT:0,CASH:0};
    prev[mode]+=cents(item.amount);
    received.set(awb,prev);
  }
  const seen=new Set(),rows=[];
  for(const shipment of shipments){
    const awb=ledgerAwb(shipment.awb),d=shipment.data||{};
    if(!awb||seen.has(awb)||String(d.shipmentType||'').toUpperCase()!=='EXPORT'||!includeExportMasterInProfit(d,month,currentMonth))continue;
    seen.add(awb);
    const clientName=String(d.clientName||d.client||'Unassigned Client').trim()||'Unassigned Client';
    const clientKey=exportClientKey(clientName),dhl=exportIsDhl(clientName);
    const scheme=dhl?'DHL':splits.get(clientKey)||'3_ACCOUNT_3_CASH';
    const weight=ledgerWeight(d);
    const accountRate=dhl?19:scheme==='2_ACCOUNT_4_CASH'?2:3;
    const cashRate=dhl?0:scheme==='2_ACCOUNT_4_CASH'?4:3;
    const commissionRate=dhl?8:0;
    const hasEici=eici.has(awb)&&eici.get(awb)!==null;
    const eiciAmount=hasEici?amount(cents(eici.get(awb))):null;
    const eiciGst=hasEici?amount(cents(eiciAmount*0.18)):null;
    const payment=received.get(awb)||{ACCOUNT:0,CASH:0};
    const grossAccount=weight===null?null:amount(cents(accountRate*weight));
    const commission=weight===null?null:amount(cents(commissionRate*weight));
    const netAccount=weight===null?null:amount(cents((accountRate-commissionRate)*weight));
    const cashCharge=weight===null?null:amount(cents(cashRate*weight));
    const accountCharge=weight===null?null:amount(cents(netAccount+(eiciAmount||0)+(eiciGst||0)));
    const totalCharge=weight===null?null:amount(cents(accountCharge+cashCharge));
    const accountReceived=amount(payment.ACCOUNT),cashReceived=amount(payment.CASH);
    rows.push({
      awb,mawb:awb.slice(0,3)+'-'+awb.slice(3),clientName,clientKey,
      register:exportProfitRegister(d),handoverDate:exportProfitHandoverDate(d),
      weight,scheme,accountRate,cashRate,commissionRate,
      grossAccount,commission,netAccount,eiciAmount,eiciGst,
      accountCharge,cashCharge,totalCharge,
      accountReceived,cashReceived,received:amount(payment.ACCOUNT+payment.CASH),
      accountBalance:accountCharge===null?null:amount(cents(accountCharge)-payment.ACCOUNT),
      cashBalance:cashCharge===null?null:amount(cents(cashCharge)-payment.CASH),
      balance:totalCharge===null?null:amount(cents(totalCharge)-payment.ACCOUNT-payment.CASH),
      missingEici:!hasEici
    });
  }
  return rows.sort((a,b)=>a.clientName.localeCompare(b.clientName)||a.mawb.localeCompare(b.mawb));
}
