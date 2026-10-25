// Offline, client-side Speed Post PDF/XLSX exports.
// Selected saved rows only; exports never trigger tracking, alter statuses,
// contact outside servers, or send recipient details to a third party.
const enc=new TextEncoder();
const xmlEscape=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;')
  .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;')
  .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,' ');
function xlsxCell(value,row,column){
  let n=column+1,letters='';
  while(n){n--;letters=String.fromCharCode(65+n%26)+letters;n=Math.floor(n/26);}
  const address=letters+row;
  if(typeof value==='number'&&Number.isFinite(value))
    return '<c r="'+address+'"><v>'+value+'</v></c>';
  return '<c r="'+address+'" t="inlineStr"><is><t xml:space="preserve">'+xmlEscape(value)+'</t></is></c>';
}
function sheetXml(headers,rows){
  let count=headers.length,col='';while(count){count--;col=String.fromCharCode(65+count%26)+col;count=Math.floor(count/26);}
  const all=[headers,...rows];
  const lines=all.map((values,index)=>
    '<row r="'+(index+1)+'">'+values.map((value,col)=>xlsxCell(value,index+1,col)).join('')+'</row>').join('');
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'+
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'+
    '<sheetData>'+lines+'</sheetData>'+
    '<autoFilter ref="A1:'+col+all.length+'"/>'+
    '</worksheet>';
}
const LE=(n,k)=>{const arr=[];for(let i=0;i<k;i++)arr.push((n>>>(i*8))&255);return arr;};
function crc32(bytes){
  let crc=0xffffffff;
  for(const byte of bytes){crc^=byte;for(let j=0;j<8;j++)crc=crc&1?(crc>>>1)^0xedb88320:crc>>>1;}
  return (crc^0xffffffff)>>>0;
}
function zipFiles(files){
  const body=[],directory=[];let offset=0;
  for(const [name,text] of files){
    const filename=enc.encode(name),data=enc.encode(text),crc=crc32(data);
    const local=new Uint8Array([
      ...LE(0x04034b50,4),...LE(20,2),...LE(0x0800,2),...LE(0,2),...LE(0,2),...LE(0,2),
      ...LE(crc,4),...LE(data.length,4),...LE(data.length,4),
      ...LE(filename.length,2),...LE(0,2),...filename
    ]);
    body.push(local,data);
    directory.push(new Uint8Array([
      ...LE(0x02014b50,4),...LE(20,2),...LE(20,2),...LE(0x0800,2),...LE(0,2),
      ...LE(0,2),...LE(0,2),...LE(crc,4),...LE(data.length,4),
      ...LE(data.length,4),...LE(filename.length,2),...LE(0,2),...LE(0,2),
      ...LE(0,2),...LE(0,2),...LE(0,4),...LE(offset,4),...filename
    ]));
    offset+=local.length+data.length;
  }
  const centralSize=directory.reduce((n,x)=>n+x.length,0);
  const end=new Uint8Array([...LE(0x06054b50,4),...LE(0,2),...LE(0,2),
    ...LE(directory.length,2),...LE(directory.length,2),
    ...LE(centralSize,4),...LE(offset,4),...LE(0,2)]);
  const output=new Uint8Array(offset+centralSize+end.length);
  let at=0;for(const part of [...body,...directory,end]){output.set(part,at);at+=part.length;}
  return output;
}
export function createSpeedPostXlsx(headers,rows){
  if(!rows.length)throw Error('There are no packets in this status filter.');
  const types='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'+
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'+
    '<Default Extension="xml" ContentType="application/xml"/>'+
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'+
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'+
    '</Types>';
  const rels='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
  const workbook='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'+
    '<sheets><sheet name="Speed Post" sheetId="1" r:id="rId1"/></sheets></workbook>';
  const bookRels='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>';
  return zipFiles([
    ['[Content_Types].xml',types],['_rels/.rels',rels],
    ['xl/workbook.xml',workbook],['xl/_rels/workbook.xml.rels',bookRels],
    ['xl/worksheets/sheet1.xml',sheetXml(headers,rows)]
  ]);
}
const W=842,H=595,LEFT=32,TOP=454,ROW_H=24,PER_PAGE=15;
// Financial PDF: 10 columns fit precisely in 778pt landscape.
const pdfCols=[['ED No.',110,17],['Consignee',125,19],['Entry Date',65,11],
  ['Destination',95,16],['Status',83,13],['Weight',53,9],
  ['Tariff',50,9],['Cash',50,9],['Total',53,9],
  ['Delivered at',94,16]];
function pdfSafe(value,max=90){
  let s=String(value??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[\u2010-\u2015]/g,'-').replace(/[\u2018\u2019]/g,"'")
    .replace(/[\u201c\u201d]/g,'"').replace(/[^\x20-\x7e]/g,' ').replace(/\s+/g,' ').trim()||'-';
  if(s.length>max)s=s.slice(0,Math.max(0,max-3))+'...';
  return s.replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');
}
function textAt(value,x,y,size=9,bold=false,max=100){
  return 'BT /F'+(bold?'2':'1')+' '+size+' Tf 1 0 0 1 '+x+' '+y+
    ' Tm ('+pdfSafe(value,max)+') Tj ET';
}
function rect(x,y,w,h,color){return 'q '+color+' rg '+x+' '+y+' '+w+' '+h+' re f Q';}
function pdfPage(rows,page,totalRows,pages,label,generated,totals={}){
  const commands=[rect(0,H-77,W,77,'0.09 0.22 0.45'),
    '1 1 1 rg '+textAt('MAYAVI SPEED POST - '+label.toUpperCase(),LEFT,H-38,16,true,70),
    '0.15 0.22 0.35 rg '+textAt('Generated: '+generated+' IST | Packets: '+totalRows,LEFT,490,9,false,95),
    '0.15 0.22 0.35 rg '+textAt('Tariff: INR '+Number(totals.tariff||0).toFixed(2)+
      ' | Cash: INR '+Number(totals.cash||0).toFixed(2)+
      ' | Combined: INR '+Number(totals.combined||0).toFixed(2),LEFT,473,8.4,true,125),
    rect(LEFT,TOP-5,778,25,'0.88 0.92 0.98')];
  let x=LEFT;
  for(const [title,width] of pdfCols){
    commands.push('0.09 0.18 0.33 rg '+textAt(title,x+3,TOP+4,7.5,true,20));
    x+=width;
  }
  rows.forEach((row,i)=>{
    const y=TOP-5-(i+1)*ROW_H;
    if(i%2===1)commands.push(rect(LEFT,y,778,ROW_H,'0.97 0.98 1'));
    let pos=LEFT;
    pdfCols.forEach(([title,width,max],j)=>{
      commands.push('0.15 0.21 0.30 rg '+textAt(row[j],pos+3,y+9,7.1,j===0,max));
      pos+=width;
    });
  });
  commands.push('0.34 0.42 0.50 rg '+textAt(
    'Status reflects the last saved tracking record. Download is not a live postal confirmation.',
    LEFT,39,8,false,130));
  commands.push(textAt('Page '+(page+1)+' of '+pages,740,39,8,false,30));
  return commands.join('\n')+'\n';
}
export function createSpeedPostPdf(rows,label='All Records',totals={}){
  if(!rows.length)throw Error('There are no packets in this status filter.');
  const generated=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',
    day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date());
  const chunks=[];for(let i=0;i<rows.length;i+=PER_PAGE)chunks.push(rows.slice(i,i+PER_PAGE));
  const objs=[null,'','','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>'];
  const ids=[];
  chunks.forEach((r,i)=>{
    const id=5+i*2,streamId=id+1;
    const stream=pdfPage(r,i,rows.length,chunks.length,label,generated,totals);
    ids.push(id+' 0 R');
    objs[id]='<< /Type /Page /Parent 2 0 R /MediaBox [0 0 '+W+' '+H+
      '] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents '+streamId+' 0 R >>';
    objs[streamId]='<< /Length '+enc.encode(stream).length+' >>\nstream\n'+stream+'endstream';
  });
  objs[1]='<< /Type /Catalog /Pages 2 0 R >>';
  objs[2]='<< /Type /Pages /Count '+chunks.length+' /Kids ['+ids.join(' ')+'] >>';
  let pdf='%PDF-1.4\n';const offsets=[0];
  for(let i=1;i<objs.length;i++){
    offsets[i]=enc.encode(pdf).length;
    pdf+=i+' 0 obj\n'+objs[i]+'\nendobj\n';
  }
  const xref=enc.encode(pdf).length;
  pdf+='xref\n0 '+objs.length+'\n0000000000 65535 f \n';
  for(let i=1;i<objs.length;i++)pdf+=String(offsets[i]).padStart(10,'0')+' 00000 n \n';
  pdf+='trailer\n<< /Size '+objs.length+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n';
  return enc.encode(pdf);
}
