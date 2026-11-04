// Pure helpers used by the Account page and its regression tests.
// Bank account numbers are TEXT, not numeric: leading zeros must never disappear.
export function moneyInput(value){
  const str=String(value??'').trim().replace(/,/g,'');
  if(!str)return '0.00';
  if(!/^(?:0|[1-9]\d{0,12})(?:\.\d{1,2})?$/.test(str))
    throw Error('Enter a valid amount with up to two decimal places.');
  return Number(str).toFixed(2);
}
export function cleanAccountText(value,max=120){
  return String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().replace(/\s+/g,' ').slice(0,max);
}
export function validEntryDate(value){
  const str=String(value??'');
  if(!/^(20\d{2})-(0[1-9]|1[0-2])-([0-3]\d)$/.test(str))return false;
  const [y,m,d]=str.split('-').map(Number);
  const valueDate=new Date(Date.UTC(y,m-1,d));
  return valueDate.getUTCFullYear()===y&&valueDate.getUTCMonth()+1===m&&valueDate.getUTCDate()===d;
}
export const TRANSACTION_MODES=['CASH','ACCOUNT TRANSFER','UPI','NEFT','RTGS','IMPS','CHEQUE','CARD','OTHER'];
export function transactionMode(value){
  const normalized=cleanAccountText(value,60).toUpperCase();
  if(!TRANSACTION_MODES.includes(normalized))
    throw Error('Select a valid Mode of Transaction.');
  return normalized;
}
export function readLedgerEntry(data={}){
  if(!validEntryDate(data.date))throw Error('Select a valid transaction date.');
  const credit=moneyInput(data.credit),debit=moneyInput(data.debit);
  if((Number(credit)>0)===(Number(debit)>0))
    throw Error('Fill either Credit or Debit (one positive amount per row).');
  const mode=transactionMode(data.mode);
  const remarks=cleanAccountText(data.remarks,500);
  return {date:data.date,credit,debit,mode,remarks};
}
export function computeLedger(rows=[],openingBalance=0){
  const ordered=[...rows].sort((a,b)=>String(a.date).localeCompare(String(b.date))||
    String(a.createdAt||'').localeCompare(String(b.createdAt||''))||String(a.id||'').localeCompare(String(b.id||'')));
  let balance=Number(openingBalance)||0;
  return ordered.map(row=>{
    balance=Math.round((balance+Number(row.credit||0)-Number(row.debit||0))*100)/100;
    return {...row,balance};
  });
}
