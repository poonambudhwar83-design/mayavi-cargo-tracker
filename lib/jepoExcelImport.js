// JEPO Express export: locate required fields even across wide, multi-line,
 // merged, renamed or re-ordered Excel headings. Never guess shipment statuses.
import {cleanJepoTrackingNo} from './jepoBranchTracking.js';
import {parseJepoDeliveryDate} from './jepoDeliveryDate.js';

export const JEPO_COLUMNS=[
 {key:'awb',title:'AWB No.',aliases:['awb no','awb number','awb','awb #','air waybill','airway bill','airwaybill','tracking number','tracking no','tracking id','tracking #','consignment number','consignment no','waybill number','waybill no','jepo awb','shipment awb','reference no','reference number']},
 {key:'service',title:'Service',aliases:['service','service name','service type','courier service','shipment service','service provider','carrier service','shipping service','product service']},
 {key:'vendor',title:'Vendor',aliases:['vendor','vendor name','courier vendor','forwarding vendor','forwarder','shipping partner','courier partner','courier company','carrier','carrier name','courier','agent','vendor code','service vendor']},
 {key:'consignee',title:'Consignee Name',aliases:['consignee name','consignee','consignee full name','receiver name','receiver','recipient name','recipient','ship to name','delivery to name','customer name','consignee details']},
 {key:'destination',title:'Destination',aliases:['destination','destination country','destination country name','dest','dest country','country','country name','to country','delivery country','shipment destination']},
 {key:'weight',title:'Chargeable Weight',aliases:['chargeable weight','chargeable wt','chargeable wgt','chargeable weight kg','chargeable wt kg','ch wt','ch wt kg','chg wt','chg weight','chrg wt','charg wt','charg weight','chargable weight','chargable wt','chrg weight','chargeable kg','charged weight','charge wt','billable weight','billable wt','billed weight','cw kg','chargeableweight','chargeable wt kgs']},
 {key:'jpCode',title:'JP Code',aliases:['jp code','jpcode','jp ref','jp reference','jp reference code','jp number','jp no','jp id','j p code','j p no','jpcode number','account code','accountcode','account cd','account no','account number','account reference']},
 {key:'bookingDate',title:'Booking Date',aliases:['booking date','booked date','date of booking','date booked','booking dt','book date','booked on','bookingdate','date of shipment','shipment booked date','shipment date','entry date','book dt','booking time','booking date time','booking datetime']}
];
const clean=v=>String(v??'').normalize('NFKC').replace(/([a-z])([A-Z])/g,'$1 $2').replace(/[\u200b-\u200d\ufeff]/g,' ').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
const fieldText=v=>{
 if(v===null||v===undefined)return'';
 if(v instanceof Date)return v.toISOString().slice(0,10);
 if(typeof v==='object'){
  if(Array.isArray(v.richText))return v.richText.map(x=>x.text||'').join(' ');
  if(v.result!==undefined)return fieldText(v.result);
  if(v.text!==undefined)return String(v.text);
  if(v.hyperlink!==undefined)return String(v.text||'');
  if(v.formula!==undefined)return String(v.result??'');
 }
 return String(v).trim();
};
function cellText(cell){
 const value=cell?.value;
 if(value===null||value===undefined)return'';
 if(value instanceof Date)return value.toISOString().slice(0,10);
 if(typeof value==='object')return fieldText(value);
 // Excel number format 000000 stores the formatted AWB as 1234 in ExcelJS.
 if(typeof value==='number'&&Number.isInteger(value)&&/^0{4,}$/.test(cell?.numFmt||''))
  return String(value).padStart(Math.min(cell.numFmt.length,18),'0');
 return String(value).trim();
}
const isNegated=(field,t)=>(
 field==='bookingDate'&&/\b(deliver|delivered|arrival|expected|eta|dispatch|updated|modified|pod|return|rto|pickup|pick up|scan|manifest)\b/.test(t)||
 field==='awb'&&/\b(fwd|forwarded|carrier|vendor|return|rto|old)\b/.test(t)||
 field==='weight'&&/\b(volumetric|volume|gross|actual|net|dead|dimensional)\b/.test(t)||
 field==='service'&&/\b(charge|rate|cost|price|tax|amount|fee)\b/.test(t)||
 field==='vendor'&&/\b(phone|mobile|contact|email|address|amount|rate|cost|charge)\b/.test(t)||
 field==='consignee'&&/\b(phone|mobile|contact|email|address|pincode|postal|city|state|country)\b/.test(t)||
 field==='destination'&&/\b(pin|zip|postal|address|state|city|port|airport)\b/.test(t)||
 field==='jpCode'&&/\b(date|amount|rate|weight|status)\b/.test(t)
);
function score(field,label){
 const t=clean(label),f=JEPO_COLUMNS.find(x=>x.key===field);
 if(!t||!f||isNegated(field,t))return 0;
 const aliases=f.aliases.map(clean);
 if(aliases.includes(t))return 120;
 let best=0;
 for(const a of aliases){
  // e.g. 'Shipment Details / AWB No.' or 'Billable Weight (Kgs)'.
  if(a.length>=6&&(t.startsWith(a+' ')||t.endsWith(' '+a)||t.includes(' '+a+' ')))
   best=Math.max(best,95-Math.max(0,t.split(' ').length-a.split(' ').length)*2);
 }
 const tokens=new Set(t.split(' '));
 const has=x=>tokens.has(x);
 const any=(...x)=>x.some(has);
 if(field==='awb'&&any('awb','waybill','tracking','consignment'))
  best=Math.max(best,any('no','number','id','reference')?103:80);
 if(field==='jpCode'&&(has('jp')||has('jpcode')||(has('j')&&has('p'))||(has('account')&&any('code','cd','number','no'))))
  best=Math.max(best,any('code','number','no','reference','ref','id')?108:72);
 if(field==='bookingDate'&&(any('book','booking','booked')&&any('date','dt','time','on')))
  best=Math.max(best,107);
 if(field==='bookingDate'&&t==='date')best=Math.max(best,26); // last-resort ONLY
 if(field==='consignee'&&any('consignee','receiver','recipient'))best=Math.max(best,any('name','details')?104:92);
 if(field==='destination'&&any('destination','dest'))best=Math.max(best,any('country','name')?104:86);
 if(field==='destination'&&t==='country')best=Math.max(best,45);
 if(field==='weight'&&((any('chargeable','charged','chargable','charg','billable','billed','chg','chrg')&&any('weight','wt','wgt'))||t==='cw'))
  best=Math.max(best,105);
 if(field==='service'&&has('service'))best=Math.max(best,any('name','type','provider')?101:89);
 if(field==='vendor'&&any('vendor','forwarder','carrier'))best=Math.max(best,any('name','partner')?103:88);
 return best;
}
const rowText=(sheet,row,column)=>cellText(sheet.getRow(row).getCell(column));
function headerCandidates(sheet,headerRow,column){
 const current=rowText(sheet,headerRow,column);
 if(!current)return[];
 const labels=[{label:current,firstRow:headerRow}];
 if(headerRow>1){
  const above=rowText(sheet,headerRow-1,column);
  if(above&&clean(above)!==clean(current))
   labels.push({label:above+' '+current,firstRow:headerRow-1});
 }
 if(headerRow<sheet.rowCount){
  const below=rowText(sheet,headerRow+1,column);
  if(below&&clean(below)!==clean(current))
   labels.push({label:current+' '+below,firstRow:headerRow});
 }
 return labels;
}
function chooseMapping(sheet,headerRow,manual={}){
 const candidates=[];
 const maxCol=Math.min(Math.max(sheet.columnCount||0,sheet.actualColumnCount||0,30),450);
 for(let col=1;col<=maxCol;col++){
  for(const entry of headerCandidates(sheet,headerRow,col)){
   for(const f of JEPO_COLUMNS){
    const match=score(f.key,entry.label);
    if(match>0)candidates.push({field:f.key,col,label:entry.label,score:match,firstRow:entry.firstRow});
   }
  }
 }
 candidates.sort((a,b)=>b.score-a.score||a.col-b.col);
 const mapping={},matched={},occupied=new Set();
 const manuallySet=Object.entries(manual||{}).filter(([k,v])=>JEPO_COLUMNS.some(x=>x.key===k)&&Number.isInteger(Number(v))&&Number(v)>0&&Number(v)<=maxCol);
 for(const [field,value] of manuallySet){
  const col=Number(value);
  if(occupied.has(col))continue;
  const entry=candidates.find(x=>x.field===field&&x.col===col);
  mapping[field]=col;occupied.add(col);
  matched[field]={column:col,heading:entry?.label||rowText(sheet,headerRow,col),score:entry?.score||0,manual:true};
 }
 for(const candidate of candidates){
  if(mapping[candidate.field]||occupied.has(candidate.col))continue;
  mapping[candidate.field]=candidate.col;occupied.add(candidate.col);
  matched[candidate.field]={column:candidate.col,heading:candidate.label,score:candidate.score,manual:false};
 }
 const fields=Object.keys(mapping).length;
 const strength=Object.values(matched).reduce((n,x)=>n+x.score,0);
 return {mapping,matched,fields,strength,headerRow,sheet};
}
const validate=(y,m,d)=>{
 y=Number(y);m=Number(m);d=Number(d);
 if(y<2000||y>2100||m<1||m>12||d<1||d>31)return null;
 const date=new Date(Date.UTC(y,m-1,d));
 return date.getUTCFullYear()===y&&date.getUTCMonth()+1===m&&date.getUTCDate()===d?date.toISOString().slice(0,10):null;
};
function dateISO(value){
 if(value instanceof Date)return Number.isFinite(value.getTime())?validate(value.getUTCFullYear(),value.getUTCMonth()+1,value.getUTCDate()):null;
 if(typeof value==='object'&&value!==null)return dateISO(value.result??value.text??'');
 if(typeof value==='number'&&value>20000&&value<90000){
  const d=new Date(Date.UTC(1899,11,30)+Math.floor(value)*86400000);
  return validate(d.getUTCFullYear(),d.getUTCMonth()+1,d.getUTCDate());
 }
 const text=String(value??'').trim();
 if(!text)return null;
 if(/^\d{5}$/.test(text))return dateISO(Number(text));
 let m=text.match(/^(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})/);
 if(m)return validate(m[1],m[2],m[3]);
 m=text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2}|\d{2})(?:\b|\s)/);
 if(m)return validate(m[3].length===2?2000+Number(m[3]):m[3],m[2],m[1]); // India DD/MM/YYYY
 const exact=parseJepoDeliveryDate(text);
 if(exact)return exact;
 const named=text.match(/^(\d{1,2})[-\s/.]+([a-z]{3,9})[-\s/.,]+(\d{2}|\d{4})/i);
 if(named){
  const months={jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
  return validate(named[3].length===2?2000+Number(named[3]):named[3],months[named[2].slice(0,3).toLowerCase()],named[1]);
 }
 return null;
}
const detail=v=>String(v??'').trim().replace(/\s+/g,' ').slice(0,180);
function readRecords(chosen){
 const sheet=chosen.sheet;
 const records=new Map();
 let invalid=0,duplicates=0,missingDates=0;
 const required=JEPO_COLUMNS.filter(f=>!chosen.mapping[f.key]);
 if(required.length)throw Error('Required Excel columns not identified: '+required.map(f=>f.title).join(', ')+'. Column headings or correct sheet check karein.');
 for(let i=chosen.headerRow+1;i<=Math.min(sheet.rowCount,50001);i++){
  const row=sheet.getRow(i);
  const getCell=k=>row.getCell(chosen.mapping[k]);
  const get=k=>cellText(getCell(k));
  const rawAwb=get('awb').replace(/[, \t]/g,'').replace(/\.0$/,'').replace(/^'/,'');
  const awb=cleanJepoTrackingNo(rawAwb);
  if(!awb||!/\d/.test(awb)){
   if(JEPO_COLUMNS.some(f=>get(f.key)))invalid++;
   continue;
  }
  const bookingCell=getCell('bookingDate');
  const bookingDate=dateISO(bookingCell.value??bookingCell.text);
  if(!bookingDate)missingDates++;
  const wt=get('weight').replace(/,/g,'').trim();
  const weightMatch=wt.match(/^(\d+(?:\.\d+)?)\s*(?:kg|kgs|kilograms?)?$/i);
  const weight=weightMatch?Number(weightMatch[1]):null;
  const record={awb,service:detail(get('service')),vendor:detail(get('vendor')),consignee:detail(get('consignee')),
    destination:detail(get('destination')),weight:Number.isFinite(weight)?weight:null,
    jpCode:detail(get('jpCode')),bookingDate};
  if(records.has(awb))duplicates++;
  records.set(awb,record);
 }
 if(!records.size)throw Error('Selected AWB column mein valid tracking numbers nahi mile. Excel ke column mapping ko check karein.');
 return {records:[...records.values()],sheetName:sheet.name,headerRow:chosen.headerRow,
  columnMapping:chosen.mapping,columnMatches:chosen.matched,invalid,duplicates,missingDates};
}
export function parseJepoExcel(workbook,{sheetName='',headerRow=0,mapping={}}={}){
 const choices=[];
 workbook.eachSheet(sheet=>{
  if(sheetName&&sheet.name!==sheetName)return;
  const max=Math.min(sheet.rowCount,100);
  for(let row=1;row<=max;row++){
   if(headerRow&&row!==headerRow)continue;
   const choice=chooseMapping(sheet,row,mapping);
   if(choice.fields>=2)choices.push(choice);
  }
 });
 choices.sort((a,b)=>b.fields-a.fields||b.strength-a.strength||a.headerRow-b.headerRow);
 const chosen=choices[0];
 if(!chosen||chosen.fields<5)throw Error('JEPO Excel headings automatically detect nahi hue. Excel mein correct sheet aur AWB No, Service, Vendor, Consignee, Destination, Chargeable Weight, JP Code, Booking Date headings check karein.');
 // Avoid treating vague generic Date column as a confirmed booking date when
 // the workbook also contains delivery/scan dates.
 if(chosen.matched.bookingDate?.score<=26&&Object.keys(chosen.mapping).length<8)
  throw Error('Booking Date column reliably identify nahi hua; use a named Booking Date / Book Dt heading.');
 return readRecords(chosen);
}
export function inspectJepoExcel(workbook){
 const sheets=[];
 workbook.eachSheet(sheet=>{
  const choices=[];
  for(let row=1;row<=Math.min(sheet.rowCount,100);row++)choices.push(chooseMapping(sheet,row));
  choices.sort((a,b)=>b.fields-a.fields||b.strength-a.strength||a.headerRow-b.headerRow);
  const selected=choices[0]||{mapping:{},matched:{},headerRow:1,fields:0};
  sheets.push({name:sheet.name,rowCount:sheet.rowCount,headerRow:selected.headerRow,
   mapping:selected.mapping,matches:selected.matched,found:selected.fields});
 });
 return sheets;
}
