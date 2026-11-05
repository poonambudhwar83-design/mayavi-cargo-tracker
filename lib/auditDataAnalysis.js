// Excel "Audit" / Vivek / Rahul extraction. Read-only against all cargo and profit data.
export const AUDIT_FIELDS=[
 {key:'mawb',label:'Vivek — Entered MAWB'},
 {key:'weight',label:'Weight (kg)'},
 {key:'bags',label:'Bags'},
 {key:'clientName',label:'Rahul — Client Name (fallback Excel BN)'},
 {key:'gc',label:'Rahul — G&C'},
 {key:'t',label:'Rahul — T'},
 {key:'dt',label:'Rahul — DT'},
 {key:'d',label:'Rahul — D'},
 {key:'xray',label:'Rahul — X-ray'},
 {key:'tray',label:'Rahul — Tray Amount'},
 {key:'shift',label:'Rahul — Shift'},
 {key:'loader',label:'Rahul — Loader'},
 {key:'coLoader',label:'Rahul — Co-loader'},
 {key:'remarks',label:'Rahul — Remarks'}
];
const stripped=value=>String(value??'').trim().replace(/\s+/g,' ');
export function auditKey(value){return stripped(value).toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').trim();}
export function auditCellValue(cell){
 let v=cell?.value;
 if(v&&typeof v==='object'&&!(v instanceof Date)){
  if(Object.prototype.hasOwnProperty.call(v,'result'))v=v.result;
  else if(Object.prototype.hasOwnProperty.call(v,'text'))v=v.text;
  else if(Array.isArray(v.richText))v=v.richText.map(x=>x.text||'').join('');
  else if(Object.hasOwn(v,'hyperlink'))v=v.text||'';
  else v='';
 }
 return v??'';
}
export function auditMawb(input){
 const digits=stripped(input).replace(/\D/g,'');
 if(digits.length!==11)return '';
 return digits.slice(0,3)+'-'+digits.slice(3);
}
function numberValue(value){
 const txt=stripped(value).replace(/,/g,'').replace(/\s*(?:kg|kgs|pieces|pcs|bags)\s*$/i,'');
 if(!txt||!/^[-+]?\d+(?:\.\d+)?$/.test(txt))return null;
 const n=Number(txt);
 return Number.isFinite(n)&&n>=0?n:null;
}
function headerMatches(field,raw){
 const k=auditKey(raw);
 if(!k)return false;
 if(field==='mawb')return /\bmawb\b|master airway|master awb|master air waybill|\bawb\s*(?:no|number)\b/.test(k);
 if(field==='weight')return /\bweight\b|\bwt\b|\bkg\b/.test(k);
 if(field==='bags')return /\bbags?\b|\bpieces\b|\bpcs\b|\bpackages\b/.test(k);
 if(field==='clientName')return /\b(?:client|customer|party)\s*(?:name)?\b|\bconsignee\s*name\b/.test(k);
 if(field==='gc')return /\bg\s*(?:and)?\s*c\b|\bgc\b|\bg\s*and\s*c\b/.test(k);
 if(field==='dt')return /^(?:dt|d t)$/.test(k)||/\brahul\s+(?:dt|d t)\b/.test(k);
 if(field==='d')return k==='d'||/\brahul\s+d\b/.test(k)&&!/\brahul\s+d\s*t\b/.test(k);
 if(field==='t')return k==='t'||/\brahul\s+t\b/.test(k);
 if(field==='xray')return /\bx\s*ray\b|\bxray\b|\bscreening\b/.test(k);
 if(field==='tray')return /\btrays?\b/.test(k);
 if(field==='shift')return /\bshift\b/.test(k);
 if(field==='coLoader')return /\bco\s*loader\b|\bco\s*loading\b|\bcoloader\b/.test(k);
 if(field==='loader')return /\bloader\b|\bloading\b/.test(k)&&!/\bco\s*loader\b/.test(k);
 if(field==='remarks')return /\bremarks?\b|\bcomments?\b|\bnotes?\b/.test(k);
 if(field==='enteredBy')return /\bentered\s*by\b|\bentry\s*by\b|\bcreated\s*by\b/.test(k);
 return false;
}
function sheetAt(workbook,name){return workbook.worksheets.find(s=>s.name===name);}
function candidateRows(sheet){
 const maxCol=Math.min(150,Math.max(15,sheet.columnCount||0,...Array.from({length:Math.min(sheet.rowCount,12)},(_,i)=>sheet.getRow(i+1).cellCount||0)));
 const result=[];
 for(let hr=1;hr<=Math.min(30,sheet.rowCount);hr++){
  const headers=Array.from({length:maxCol},(_,i)=>stripped(auditCellValue(sheet.getRow(hr).getCell(i+1))));
  const candidates={};
  const quality={};
  for(let col=1;col<=maxCol;col++){
   const curr=headers[col-1]||'';
   if(!curr)continue;
   const prev=[hr>=2?stripped(auditCellValue(sheet.getRow(hr-1).getCell(col))):'',
               hr>=3?stripped(auditCellValue(sheet.getRow(hr-2).getCell(col))):''];
   for(const field of [...AUDIT_FIELDS.map(x=>x.key),'enteredBy']){
    if(!headerMatches(field,curr))continue;
    const context=[sheet.name,...prev,curr].join(' ').toLowerCase();
    const expectedOwner=field==='mawb'||field==='weight'||field==='bags'?'vivek':'rahul';
    const ownerBoost=context.includes(expectedOwner)?4:0;
    const auditBoost=field==='mawb'&&/\baudit\b/i.test(context)?2:0;
    const score=10+ownerBoost+auditBoost+(field==='mawb'&&/\bmawb\b/i.test(curr)?2:0);
    if(!quality[field]||score>quality[field]){quality[field]=score;candidates[field]=col;}
   }
  }
  const found=AUDIT_FIELDS.filter(x=>candidates[x.key]).length;
  const score=found*5+(candidates.mawb?60:0)+(candidates.weight?12:0)+(candidates.bags?12:0)+
   (candidates.gc?5:0)+(candidates.xray?3:0)+(candidates.remarks?2:0)+
   (/\baudit\b/i.test(sheet.name)?3:0);
  result.push({headerRow:hr,columns:candidates,found,score,headers});
 }
 return result.sort((a,b)=>b.score-a.score||b.found-a.found||a.headerRow-b.headerRow);
}
function excelLetter(i){
 let text='';for(let x=i;x>0;x=Math.floor((x-1)/26))text=String.fromCharCode(65+(x-1)%26)+text;return text;
}
export function listAuditSheets(workbook){
 return workbook.worksheets.filter(s=>s.state!=='veryHidden'&&s.rowCount>1).map(sheet=>{
  const best=candidateRows(sheet)[0]||{headerRow:1,columns:{},headers:[],score:0};
  const headers=best.headers.map((h,i)=>({column:i+1,label:excelLetter(i+1)+' — '+(h||'Column '+(i+1))}))
    .filter((x,i)=>best.headers[i]||Object.values(best.columns).includes(x.column));
  // BN must be selectable even if the workbook leaves its heading blank.
  if(!headers.some(h=>h.column===66))headers.push({column:66,label:'BN — Client Name (fallback)'});
  headers.sort((a,b)=>a.column-b.column);
  return {name:sheet.name,headerRow:best.headerRow,mapping:best.columns,columns:headers,
    score:best.score,found:Object.keys(best.columns).length,rowCount:sheet.rowCount};
 }).sort((a,b)=>b.score-a.score);
}
export function parseAuditWorkbook(workbook,opts={}){
 const available=listAuditSheets(workbook);
 const selected=opts.sheetName?available.find(s=>s.name===opts.sheetName):available[0];
 if(!selected)throw Error('Excel mein data wali koi sheet nahi mili.');
 const sheet=sheetAt(workbook,selected.name);
 const headerRow=Number.isInteger(Number(opts.headerRow))&&Number(opts.headerRow)>=1&&Number(opts.headerRow)<=Math.min(100,sheet.rowCount)
  ?Number(opts.headerRow):selected.headerRow;
 const maxCol=Math.max(sheet.columnCount||0,150);
 const chosen={...selected.mapping};
 // Excel BN is column 66: fallback when Rahul's named client column is absent.
 // It can also be explicitly selected by the user through manual mapping.
 if(!chosen.clientName)chosen.clientName=66;
 for(const field of AUDIT_FIELDS.map(x=>x.key).concat('enteredBy')){
  if(!opts.mapping||!Object.hasOwn(opts.mapping,field))continue;
  const v=Number(opts.mapping[field]);
  if(v===0){delete chosen[field];continue;}
  if(!Number.isSafeInteger(v)||v<1||v>maxCol)throw Error('Invalid Excel column for '+field);
  chosen[field]=v;
 }
 if(!chosen.mawb)throw Error('Vivek MAWB column select karein. Excel mein woh heading auto-detect nahi hui.');
 const records=[],seen=new Map();let skipped=0,duplicates=0;
 for(let rn=headerRow+1;rn<=sheet.rowCount;rn++){
  const row=sheet.getRow(rn);if(!row.hasValues)continue;
  const val=k=>chosen[k]?auditCellValue(row.getCell(chosen[k])):'';
  const mawb=auditMawb(val('mawb'));
  if(!mawb){skipped++;continue;}
  if(chosen.enteredBy){const who=auditKey(val('enteredBy'));if(who&&!/\bvivek\b/.test(who)){skipped++;continue;}}
  const weight=numberValue(val('weight'));const rawBags=numberValue(val('bags'));
  const bags=rawBags!==null&&Number.isInteger(rawBags)?rawBags:null;
  // Give Rahul's Client Name heading priority. If that cell is empty or
  // the heading could not be detected, use the actual Excel BN column.
  const clientName=stripped(val('clientName')||auditCellValue(row.getCell(66))).slice(0,180);
  const rec={mawb,weight,bags,clientName,sourceRow:rn,sheetName:selected.name};
  for(const field of ['gc','t','dt','d','xray','tray','shift','loader','coLoader','remarks']){
   const raw=val(field);
   rec[field]=stripped(raw).slice(0,500);
  }
  if(seen.has(mawb)){duplicates++;}else seen.set(mawb,true);
  records.push(rec);
  if(records.length>10000)throw Error('10,000 se zyada records hain; Excel ko chhoti files mein upload karein.');
 }
 if(!records.length)throw Error('Vivek MAWB column mein 11-digit valid MAWB nahi mila. Header/column mapping check karein.');
 return {sheetName:selected.name,headerRow,mapping:chosen,rows:records,skipped,duplicates,
  columns:selected.columns,availableSheets:available};
}
export function summarizeAuditRows(rows=[]){
 const mawb=new Set();let weight=0,bags=0,withRahul=0;
 for(const r of rows){if(r.mawb)mawb.add(r.mawb);weight+=Number(r.weight)||0;bags+=Number(r.bags)||0;
  if(['gc','t','dt','d','xray','tray','shift','loader','coLoader','remarks'].some(k=>String(r[k]||'').trim()))withRahul++;}
 return {rows:rows.length,uniqueMawbs:mawb.size,weight:Math.round(weight*1000)/1000,bags,withRahul};
}
