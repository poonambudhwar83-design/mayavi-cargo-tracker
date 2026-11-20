// Shared by the Personal Accounts editor, the import flow and regression tests.
// Keep exactly the seven columns requested; Remarks is editable and saved.
export const PERSONAL_ACCOUNT_FIELDS=[
  {key:'date',label:'Date',aliases:['date','transaction date','txn date','value date','posting date','date of transaction','transaction dt','txn dt','date of txn','tran date','trn date','transactiondate']},
  {key:'details',label:'Details',aliases:['details','particulars','description','narration','transaction description','transaction details','transaction particulars','transaction narration','narrative','remarks / particulars','transaction particulars / narration','transaction info','transaction remarks','description / narration','particulars / narration']},
  {key:'chequeNo',label:'Cheque No.',aliases:['cheque no','cheque number','chq no','chq number','chq ref no','chq/ref no','chq / ref no','cheque ref no','chq ref number','cheque / ref no','cheque / ref number','check no','instrument no','instrument number','reference no','reference number','ref no','ref number','cheque no / ref no','cheque / reference','cheque no / reference no']},
  {key:'debit',label:'Debit',aliases:['debit','debit amount','debit (inr)','withdrawal','withdrawals','withdrawal amt','withdrawal amount','withdrawal amt (inr)','dr amount','amount dr','paid amount','debit rs','withdrawal amount (rs)']},
  {key:'credit',label:'Credit',aliases:['credit','credit amount','credit (inr)','deposit','deposits','deposit amt','deposit amount','deposit amt (inr)','cr amount','amount cr','received amount','credit rs','deposit amount (rs)']},
  {key:'balance',label:'Balance',aliases:['balance','running balance','closing balance','available balance','account balance','balance inr','balance (inr)','bal amount','closing bal','balance amt']},
  {key:'remarks',label:'Remarks',aliases:['remarks','remark','notes','comments','note','remark / note','customer remarks','user remarks','additional remarks','additional details','transaction note','transaction notes','excel cell notes']}
];
export const PERSONAL_ACCOUNT_KEYS=PERSONAL_ACCOUNT_FIELDS.map(x=>x.key);
export const normalizeAccountHeader=value=>String(value??'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'');
export function detectAccountHeaders(row){
  const cells=(row||[]).map(normalizeAccountHeader),used=new Set(),mapping={};
  for(const f of PERSONAL_ACCOUNT_FIELDS){
    const aliases=f.aliases.map(normalizeAccountHeader);
    let index=cells.findIndex((h,i)=>h&&!used.has(i)&&aliases.includes(h));
    if(index<0)index=cells.findIndex((h,i)=>h&&!used.has(i)&&aliases.some(a=>a.length>=5&&(h.startsWith(a)||h.endsWith(a))));
    if(index>=0){mapping[f.key]=String(index);used.add(index);}
  }
  return mapping;
}
export function guessAccountSheetHeader(sheet){
  let best={headerIndex:0,mapping:{},score:-1};
  for(let i=0;i<Math.min(sheet?.rows?.length||0,90);i++){
    const mapping=detectAccountHeaders(sheet.rows[i]);
    const score=['date','details','debit','credit','balance'].reduce((n,k)=>n+(mapping[k]!==undefined?2:0),0)+
      ['chequeNo','remarks'].reduce((n,k)=>n+(mapping[k]!==undefined?1:0),0);
    // Prefer a real transaction header with several matched columns, not a decorative title line.
    if(score>best.score)best={headerIndex:i,mapping,score};
  }
  return best;
}
export function accountRowsFromSheet(sheet,headerIndex,mapping){
  if(!sheet?.rows||!mapping||mapping.date===undefined&&mapping.details===undefined)throw Error('Map at least the Date or Details column before importing.');
  const result=[];
  for(let i=headerIndex+1;i<sheet.rows.length;i++){
    const source=sheet.rows[i]||[];
    const record={id:'excel-row-'+String(i+1)};
    for(const key of PERSONAL_ACCOUNT_KEYS){
      const col=mapping[key];
      record[key]=col===undefined||col===''?'':String(source[Number(col)]??'').trim();
    }
    if(!PERSONAL_ACCOUNT_KEYS.some(key=>record[key]!==''))continue;
    result.push(record);
  }
  return result;
}
export function numericAccountAmount(value){
  const source=String(value??'').trim();
  if(!source)return null;
  // Preserve nonnumeric bank ledger text; never convert cheque numbers.
  const negative=/^\(.*\)$/.test(source);
  const cleaned=source.replace(/[₹$£,\s]/g,'').replace(/[()]/g,'');
  if(!/^[+-]?\d+(?:\.\d+)?$/.test(cleaned))return null;
  const n=Number(cleaned);
  return Number.isFinite(n)?(negative?-Math.abs(n):n):null;
}
export function isValidAccountSaveRow(r){
  return Boolean(r&&PERSONAL_ACCOUNT_KEYS.some(k=>String(r[k]??'').trim()!==''));
}
