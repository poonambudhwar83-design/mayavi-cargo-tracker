// JEPO Tracking Excel import: never invent dates, statuses or AWBs.
import {cleanJepoTrackingNo} from './jepoBranchTracking.js';
import {parseJepoDeliveryDate} from './jepoDeliveryDate.js';

export const JEPO_COLUMNS=[
 {key:'awb',title:'AWB No.',aliases:['awb no','awb number','awb','tracking no','tracking number','waybill no','reference no','jepo awb']},
 {key:'service',title:'Service',aliases:['service','service name','courier','service type']},
 {key:'vendor',title:'Vendor',aliases:['vendor','vendor name','courier vendor','forwarder','forwarding agent']},
 {key:'consignee',title:'Consignee Name',aliases:['consignee name','consignee','receiver name','receiver','recipient name']},
 {key:'destination',title:'Destination',aliases:['destination','destination country','country','country name']},
 {key:'weight',title:'Chargeable Weight',aliases:['chargeable weight','chargeable wt','chargeable weight kg','ch wt','ch wt kg','charged weight','billable weight','weight chargeable']},
 {key:'jpCode',title:'JP Code',aliases:['jp code','jpcode','jp ref','jp number','jp no','j p code']},
 {key:'bookingDate',title:'Booking Date',aliases:['booking date','booked date','date of booking','date booked','booking dt','book date','date']}
];
const norm=v=>String(v??'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
const cellText=c=>{
 const v=c?.value;
 if(v===null||v===undefined)return'';
 if(v instanceof Date)return v.toISOString().slice(0,10);
 if(typeof v==='object'){
  if(v.text!==undefined)return String(v.text);
  if(v.result!==undefined)return String(v.result??'');
  if(Array.isArray(v.richText))return v.richText.map(x=>x.text||'').join('');
 }
 return String(c.text??v).trim();
};
function detected(sheet,header){
 const cols={};
 const row=sheet.getRow(header);
 for(let col=1;col<=Math.min(150,Math.max(sheet.columnCount,15));col++){
  const label=norm(cellText(row.getCell(col)));
  if(!label)continue;
  for(const f of JEPO_COLUMNS){
   if(cols[f.key])continue;
   if(f.aliases.some(alias=>label===norm(alias))){cols[f.key]=col;break;}
  }
 }
 return cols;
}
function dateISO(value,cell){
 if(value instanceof Date){
  return Number.isFinite(value.getTime())?value.toISOString().slice(0,10):null;
 }
 if(typeof value==='number'&&value>20000&&value<90000){
  const date=new Date(Date.UTC(1899,11,30)+Math.floor(value)*86400000);
  return date.toISOString().slice(0,10);
 }
 const text=String(value??'').trim();
 if(!text)return null;
 const iso=text.match(/^(20\d{2})-(\d\d)-(\d\d)/);
 const parsed=iso?parseJepoDeliveryDate(iso[0]):parseJepoDeliveryDate(text);
 if(parsed)return parsed;
 const asDate=new Date(text);
 if(/[a-z]{3,}/i.test(text)&&Number.isFinite(asDate.getTime()))
  return asDate.toISOString().slice(0,10);
 return null;
}
const detail=v=>String(v??'').trim().replace(/\s+/g,' ').slice(0,180);
export function parseJepoExcel(workbook,{sheetName='',headerRow=0}={}){
 const matches=[];
 workbook.eachSheet(sheet=>{
  for(let row=1;row<=Math.min(25,sheet.rowCount);row++){
   const mapping=detected(sheet,row);
   matches.push({sheet,headerRow:row,mapping,score:Object.keys(mapping).length});
  }
 });
 matches.sort((a,b)=>b.score-a.score||a.headerRow-b.headerRow);
 const chosen=sheetName?matches.filter(x=>x.sheet.name===sheetName&&(!headerRow||x.headerRow===headerRow))[0]:
  headerRow?matches.find(x=>x.headerRow===headerRow):matches[0];
 if(!chosen||chosen.score<5)throw Error('Excel headings identify nahi hue. AWB No, Booking Date, Service, Vendor, Consignee Name, Destination, Chargeable Weight aur JP Code columns check karein.');
 const required=JEPO_COLUMNS.filter(f=>!chosen.mapping[f.key]);
 if(required.length)throw Error('Missing Excel headings: '+required.map(f=>f.title).join(', '));
 const records=new Map();
 let invalid=0,duplicates=0,missingDates=0;
 for(let i=chosen.headerRow+1;i<=Math.min(chosen.sheet.rowCount,20001);i++){
  const row=chosen.sheet.getRow(i);
  const get=k=>cellText(row.getCell(chosen.mapping[k]));
  const awb=cleanJepoTrackingNo(get('awb'));
  if(!awb){if(JEPO_COLUMNS.some(f=>get(f.key)))invalid++;continue;}
  const dateCell=row.getCell(chosen.mapping.bookingDate);
  const bookingDate=dateISO(dateCell.value,dateCell);
  if(!bookingDate)missingDates++;
  const weightString=get('weight').replace(/,/g,'');
  const weightMatch=weightString.match(/^\s*(\d+(?:\.\d+)?)\s*(?:kg|kgs)?\s*$/i);
  const weight=weightMatch?Number(weightMatch[1]):null;
  const record={awb,service:detail(get('service')),vendor:detail(get('vendor')),
   consignee:detail(get('consignee')),destination:detail(get('destination')),
   weight:weight!==null&&Number.isFinite(weight)&&weight>=0?weight:null,
   jpCode:detail(get('jpCode')),bookingDate};
  if(records.has(awb))duplicates++;
  records.set(awb,record);
 }
 if(!records.size)throw Error('Valid JEPO AWB numbers nahi mile. Excel ka sheet aur headings check karein.');
 return {records:[...records.values()],sheetName:chosen.sheet.name,headerRow:chosen.headerRow,
  columnMapping:chosen.mapping,invalid,duplicates,missingDates};
}
