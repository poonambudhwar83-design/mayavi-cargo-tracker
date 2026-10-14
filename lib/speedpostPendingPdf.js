// Client-side PDF export for Speed Post records with no verified booking date.
// Does not call tracking sites, read private credentials, or mutate shipments.
const PAGE_W=842;
const PAGE_H=595;
const LEFT=42;
const TOP=451;
const ROW_H=26;
const ROWS_PER_PAGE=15;
const COLUMNS=[['ED No.',230,35],['Consignee Name',285,43],['Status',243,35]];
const utf8=new TextEncoder();
function safe(value,maxLength=100){
  const text=String(value??'').normalize('NFKD')
    .replace(/[\u0300-\u036f]/g,'').replace(/[\u2010-\u2015]/g,'-')
    .replace(/[\u2018\u2019]/g,"'").replace(/[\u201c\u201d]/g,'"')
    .replace(/[^\x20-\x7E]/g,' ').replace(/\s+/g,' ').trim()||'-';
  const clipped=text.length>maxLength?text.slice(0,Math.max(0,maxLength-3))+'...':text;
  return clipped.replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');
}
function at(text,x,y,size=9,bold=false,max=110){
  return 'BT /F'+(bold?'2':'1')+' '+size+' Tf 1 0 0 1 '+
    x+' '+y+' Tm ('+safe(text,max)+') Tj ET';
}
function rectangle(x,y,w,h,color){
  return 'q '+color+' rg '+x+' '+y+' '+w+' '+h+' re f Q';
}
function pdfPage(items,index,total,count,created){
  const content=[];
  content.push(rectangle(0,PAGE_H-77,PAGE_W,77,'0.09 0.22 0.45'));
  content.push('1 1 1 rg '+at('PENDING DETAILS OF SPEED POST',LEFT,PAGE_H-39,17,true));
  content.push('0.15 0.22 0.35 rg '+at(
    'Saved ED records where the booking date is missing (not proof of non-booking).',
    LEFT,494,10,false,120));
  content.push(at('Generated: '+created+'    Records: '+count,LEFT,480,9,false,120));
  content.push(rectangle(LEFT,TOP-5,758,24,'0.88 0.92 0.98'));
  let x=LEFT;
  for(const [label,width] of COLUMNS){
    content.push('0.09 0.18 0.33 rg '+at(label,x+5,TOP+4,9,true,23));
    x+=width;
  }
  items.forEach((row,i)=>{
    const y=TOP-5-(i+1)*ROW_H;
    if(i%2===1)content.push(rectangle(LEFT,y,758,ROW_H,'0.97 0.98 1'));
    const vals=[row.trackingNo,row.consigneeName,row.status];
    let offset=LEFT;
    COLUMNS.forEach(([_,width,maxChars],j)=>{
      content.push('0.15 0.21 0.30 rg '+at(vals[j]||'-',offset+5,y+10,8.7,j===0,maxChars));
      offset+=width;
    });
    content.push('0.88 0.9 0.93 RG 0.4 w '+LEFT+' '+y+' m 800 '+y+' l S');
  });
  content.push('0.36 0.41 0.49 rg '+at(
    'Pending booking verification - check against the official postal receipt.',
    LEFT,41,8,false,125));
  content.push(at('Page '+(index+1)+' of '+total,739,41,8,false,30));
  return content.join('\n')+'\n';
}
export function createBookingPendingPdf(rows,generatedAt=new Date()){
  if(!Array.isArray(rows)||!rows.length)throw new Error('No booking-pending records to export.');
  const created=new Intl.DateTimeFormat('en-GB',{
    timeZone:'Asia/Kolkata',day:'2-digit',month:'short',year:'numeric',
    hour:'2-digit',minute:'2-digit',hour12:true
  }).format(generatedAt)+' IST';
  const pages=[];
  for(let i=0;i<rows.length;i+=ROWS_PER_PAGE){
    pages.push(rows.slice(i,i+ROWS_PER_PAGE));
  }
  const objects=[null,'', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>'];
  const ids=[];
  pages.forEach((subset,index)=>{
    const pageId=5+2*index,streamId=pageId+1;
    ids.push(pageId+' 0 R');
    const stream=pdfPage(subset,index,pages.length,rows.length,created);
    objects[pageId]='<< /Type /Page /Parent 2 0 R /MediaBox [0 0 '+PAGE_W+' '+PAGE_H+
      '] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents '+streamId+' 0 R >>';
    objects[streamId]='<< /Length '+utf8.encode(stream).length+' >>\nstream\n'+stream+'endstream';
  });
  objects[1]='<< /Type /Catalog /Pages 2 0 R >>';
  objects[2]='<< /Type /Pages /Count '+pages.length+' /Kids ['+ids.join(' ')+'] >>';
  let pdf='%PDF-1.4\n';
  const offsets=[0];
  for(let n=1;n<objects.length;n++){
    offsets[n]=utf8.encode(pdf).length;
    pdf+=n+' 0 obj\n'+objects[n]+'\nendobj\n';
  }
  const xref=utf8.encode(pdf).length;
  pdf+='xref\n0 '+objects.length+'\n0000000000 65535 f \n';
  for(let n=1;n<objects.length;n++)
    pdf+=String(offsets[n]).padStart(10,'0')+' 00000 n \n';
  pdf+='trailer\n<< /Size '+objects.length+' /Root 1 0 R >>\nstartxref\n'+xref+
    '\n%%EOF\n';
  return utf8.encode(pdf);
}
