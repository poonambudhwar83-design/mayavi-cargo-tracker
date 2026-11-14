// Download only the overdue report: no application logo, label, or watermark.
// PDF cells are actual AcroForm text fields. Do not flatten: users can edit
// the values in a PDF editor after download.
import {jepoDaysSinceBooking,jepoOverdueDays} from './jepoOverdue.js';
import {jepoTrackingStatusLabel} from './jepoTrackingState.js';
import {jepoBookingWeekday} from './jepoBookingDay.js';

export const OVERDUE_EXPORT_COLUMNS=[
 {key:'number',label:'#',pdfLabel:'#',width:26},
 {key:'awb',label:'AWB No.',pdfLabel:'AWB No.',width:116},
 {key:'bookingDate',label:'Booking Date / Day',pdfLabel:'Booking / Day',width:75},
 {key:'service',label:'Service',pdfLabel:'Service',width:72},
 {key:'vendor',label:'Vendor',pdfLabel:'Vendor',width:70},
 {key:'destination',label:'Destination',pdfLabel:'Country',width:66},
 {key:'consignee',label:'Consignee Name',pdfLabel:'Consignee',width:97},
 {key:'jpCode',label:'JP Code',pdfLabel:'JP Code',width:72},
 {key:'customerName',label:'Customer Name',pdfLabel:'Customer',width:125},
 {key:'weight',label:'Weight (kg)',pdfLabel:'Weight kg',width:50},
 {key:'status',label:'Tracking Status',pdfLabel:'Status',width:78},
 {key:'ageDays',label:'Days Since Booking',pdfLabel:'Age (days)',width:51},
 {key:'overdueDays',label:'Days Overdue',pdfLabel:'Overdue',width:49},
 {key:'liveRemarks',label:'Progress / Remarks',pdfLabel:'Progress / Remarks',width:170}
];
const number=v=>Number(v||0).toLocaleString('en-IN',{maximumFractionDigits:3});
const displayDate=v=>v?String(v).slice(0,10).split('-').reverse().join('/'):'';
function rowValue(record,key,index,today){
 switch(key){
  case 'number':return index+1;
  case 'bookingDate':return record.bookingDate?displayDate(record.bookingDate)+'\n'+jepoBookingWeekday(record.bookingDate):'';
  case 'weight':return record.weight===null||record.weight===undefined?'':number(record.weight);
  case 'status':return jepoTrackingStatusLabel(record);
  case 'ageDays':return jepoDaysSinceBooking(record.bookingDate,today)??'';
  case 'overdueDays':return jepoOverdueDays(record,today)??'';
  default:return record[key]??'';
 }
}
export function overdueExportData(records=[],today=''){
 return [
  OVERDUE_EXPORT_COLUMNS.map(col=>col.label),
  ...records.map((record,i)=>OVERDUE_EXPORT_COLUMNS.map(col=>rowValue(record,col.key,i,today)))
 ];
}
function download(bytes,type,filename){
 const blob=new Blob([bytes],{type}),url=URL.createObjectURL(blob);
 const a=document.createElement('a');
 a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(url),3000);
}
export async function downloadOverdueExcel(records=[],today=''){
 const ExcelJS=(await import('exceljs')).default;
 const workbook=new ExcelJS.Workbook();
 const sheet=workbook.addWorksheet('Overdue', {views:[{state:'frozen',ySplit:1,xSplit:2}]});
 sheet.columns=OVERDUE_EXPORT_COLUMNS.map(col=>({
  header:col.label,key:col.key,
  width:col.key==='liveRemarks'?44:col.key==='consignee'||col.key==='customerName'?27:Math.max(12,Math.round(col.width/5.7))
 }));
 const data=overdueExportData(records,today);
 for(const values of data.slice(1))sheet.addRow(values);
 const header=sheet.getRow(1);
 header.height=35;
 header.eachCell(cell=>{
  cell.font={bold:true,color:{argb:'FFFFFFFF'},size:11};
  cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF214D7B'}};
  cell.alignment={vertical:'middle',wrapText:true};
  cell.border={bottom:{style:'thin',color:{argb:'FFB5CBE2'}}};
 });
 for(let index=2;index<=sheet.rowCount;index++){
  const row=sheet.getRow(index);
  row.height=39;
  row.eachCell(cell=>{
   cell.alignment={vertical:'middle',wrapText:true};
   cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:index%2?'FFF5F9FE':'FFFFFFFF'}};
   cell.border={bottom:{style:'hair',color:{argb:'FFD6E1EC'}}};
  });
  row.getCell(OVERDUE_EXPORT_COLUMNS.findIndex(col=>col.key==='overdueDays')+1).font={bold:true,color:{argb:'FFB91C1C'}};
 }
 sheet.autoFilter={from:{row:1,column:1},to:{row:Math.max(1,sheet.rowCount),column:OVERDUE_EXPORT_COLUMNS.length}};
 const bytes=await workbook.xlsx.writeBuffer();
 download(bytes,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','overdue_not_delivered_'+today+'.xlsx');
}

const pdfText=value=>String(value??'').normalize('NFKD')
 .replace(/[\u2010-\u2015]/g,'-').replace(/[\u2018\u2019]/g,"'")
 .replace(/[\u201C\u201D]/g,'"').replace(/[^\x20-\x7e\n]/g,' ');
export async function createOverdueEditablePdfBytes(records=[],today=''){
 const {PDFDocument,StandardFonts,rgb}=await import('pdf-lib');
 const document=await PDFDocument.create();
 document.setTitle('Overdue - Not Delivered');
 const regular=await document.embedFont(StandardFonts.Helvetica);
 const bold=await document.embedFont(StandardFonts.HelveticaBold);
 const form=document.getForm();
 const W=1190,H=842,LEFT=25,TOP=750,HEADER_H=27,ROW_H=35,PER_PAGE=19;
 const pages=Math.max(1,Math.ceil(records.length/PER_PAGE));
 for(let pageIndex=0;pageIndex<pages;pageIndex++){
  const page=document.addPage([W,H]);
  page.drawText('OVERDUE - NOT DELIVERED',{x:LEFT,y:800,size:18,font:bold,color:rgb(.12,.27,.45)});
  page.drawText('As of: '+displayDate(today)+'  |  Total packets: '+records.length,{
   x:LEFT,y:775,size:11,font:regular,color:rgb(.28,.38,.49)
  });
  let headingX=LEFT;
  page.drawRectangle({x:LEFT,y:TOP-HEADER_H,width:OVERDUE_EXPORT_COLUMNS.reduce((sum,col)=>sum+col.width,0),height:HEADER_H,
   color:rgb(.13,.29,.47)});
  for(const col of OVERDUE_EXPORT_COLUMNS){
   page.drawText(col.pdfLabel,{x:headingX+3,y:TOP-18,size:8,font:bold,color:rgb(1,1,1)});
   headingX+=col.width;
  }
  const slice=records.slice(pageIndex*PER_PAGE,(pageIndex+1)*PER_PAGE);
  for(let rowIndex=0;rowIndex<slice.length;rowIndex++){
   const row=slice[rowIndex];
   const y=TOP-HEADER_H-(rowIndex+1)*ROW_H;
   let x=LEFT;
   const shade=rowIndex%2?rgb(.963,.980,.996):rgb(1,1,1);
   for(const col of OVERDUE_EXPORT_COLUMNS){
    const globalRow=pageIndex*PER_PAGE+rowIndex;
    const value=pdfText(rowValue(row,col.key,globalRow,today));
    const field=form.createTextField('r'+(globalRow+1)+'_'+col.key);
    field.setText(value);
    if(['bookingDate','liveRemarks','consignee','customerName'].includes(col.key))field.enableMultiline();
    field.addToPage(page,{
     x:x+1,y:y+1,width:col.width-2,height:ROW_H-2,
     font:regular,
     textColor:col.key==='overdueDays'?rgb(.68,.14,.14):rgb(.12,.23,.35),
     backgroundColor:shade,
     borderColor:rgb(.82,.87,.92),borderWidth:.4
    });
    field.setFontSize(['bookingDate','liveRemarks','consignee','customerName'].includes(col.key)?7:8);
    field.updateAppearances(regular);
    x+=col.width;
   }
  }
  page.drawText('Page '+(pageIndex+1)+' of '+pages,{
   x:W-112,y:20,size:9,font:regular,color:rgb(.4,.47,.55)
  });
 }
 // AcroForm text fields stay editable; never call form.flatten().
 return document.save();
}
export async function downloadOverdueEditablePdf(records=[],today=''){
 const bytes=await createOverdueEditablePdfBytes(records,today);
 download(bytes,'application/pdf','overdue_not_delivered_'+today+'.pdf');
}
