// Customer master is separate from JEPO shipment imports. A JP / account code
// can belong to many AWBs; never mistake the consignee (receiver) for customer.
const clean=value=>String(value??'').normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
const cellValue=cell=>{
 const value=cell?.value;
 if(value===undefined||value===null)return '';
 if(typeof value==='number'&&Number.isInteger(value)&&/^0{2,}$/.test(cell?.numFmt||''))
  return String(value).padStart(Math.min(20,cell.numFmt.length),'0');
 if(typeof value==='object'){
  if(value instanceof Date)return value.toISOString().slice(0,10);
  if(Array.isArray(value.richText))return value.richText.map(x=>x.text||'').join('');
  return String(value.text??value.result??'').trim();
 }
 return String(value).trim();
};
export const normalizeJepoJpCode=value=>String(value??'').normalize('NFKC').trim().toUpperCase();
const codeHeaders=new Set(['jp code','jpcode','jepo code','je po code','account code','accountcode','jp ref','jp reference','customer code','client code','jp number','jp no']);
const customerHeaders=new Set(['customer name','name of customer','customer','client name','name of client','client','party name','name of party','account name','name of account holder','account holder name','shipper name','shipper','sender name']);
function headerScore(value,kind){
 const text=clean(value);
 if(kind==='code'){
  if(codeHeaders.has(text))return 100;
  if(/^jp\s+code\b/.test(text)||/^account\s+code\b/.test(text))return 75;
  return 0;
 }
 if(customerHeaders.has(text))return text==='customer name'||text==='client name'?110:text==='customer'||text==='client'?95:80;
 if(/^customer name\b/.test(text)||/^client name\b/.test(text))return 75;
 return 0;
}
export function parseJepoCustomerMap(workbook,{headerRow=0}={}){
 const choices=[];
 workbook.eachSheet(sheet=>{
  const columnCount=Math.min(450,Math.max(2,sheet.columnCount||0,sheet.actualColumnCount||0));
  for(let rowNo=1;rowNo<=Math.min(headerRow||40,sheet.rowCount);rowNo++){
   if(headerRow&&rowNo!==headerRow)continue;
   const row=sheet.getRow(rowNo),codes=[],customers=[];
   for(let col=1;col<=columnCount;col++){
    const title=cellValue(row.getCell(col));
    const code=headerScore(title,'code'),customer=headerScore(title,'customer');
    if(code)codes.push({col,title,score:code});
    if(customer)customers.push({col,title,score:customer});
   }
   for(const c of codes)for(const n of customers)if(c.col!==n.col)
    choices.push({sheet,headerRow:rowNo,codeColumn:c.col,customerColumn:n.col,
     jpHeader:c.title,customerHeader:n.title,score:c.score+n.score});
  }
 });
 choices.sort((a,b)=>b.score-a.score||a.headerRow-b.headerRow);
 const best=choices[0];
 if(!best)throw Error('Customer mapping sheet mein JP Code / Account Code aur Customer Name / Client Name headings nahi mile.');
 const records=new Map(),conflicts=[],seenConflicts=new Set();
 let invalid=0,duplicates=0;
 for(let i=best.headerRow+1;i<=Math.min(best.sheet.rowCount,50001);i++){
  const row=best.sheet.getRow(i);
  const code=normalizeJepoJpCode(cellValue(row.getCell(best.codeColumn)));
  const name=cellValue(row.getCell(best.customerColumn)).replace(/\s+/g,' ').trim();
  if(!code&&!name)continue;
  if(!code||!name||code.length>120||name.length>200){invalid++;continue;}
  if(records.has(code)){
   duplicates++;
   if(records.get(code).customerName!==name&&!seenConflicts.has(code)){
    seenConflicts.add(code);
    conflicts.push({jpCode:code,first:records.get(code).customerName,other:name,row:i});
   }
   continue;
  }
  records.set(code,{jpCode:code,customerName:name});
 }
 if(!records.size)throw Error('No valid JP Code + Customer Name pairs found in this file.');
 return {sheetName:best.sheet.name,headerRow:best.headerRow,
  jpHeader:best.jpHeader,customerHeader:best.customerHeader,
  records:[...records.values()],duplicates,invalid,conflicts};
}
