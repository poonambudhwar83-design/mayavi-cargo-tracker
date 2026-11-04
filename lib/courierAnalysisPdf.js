// Dependency-free, paginated landscape A3 PDF export for Mayavi's courier
// and origin analysis. All existing workbook rows remain in the database.
// Sector columns are horizontally paginated in groups of six so nothing is
// silently dropped or made microscopic on wide source workbooks.

const PAGE_W=1191,PAGE_H=842,LEFT=30,TABLE_TOP=695,HEADER_H=32,ROW_H=22,ROWS_PER_PAGE=25;
const MAX_SECTORS=6;
const money=new Intl.NumberFormat('en-IN',{maximumFractionDigits:2,minimumFractionDigits:0});
const asNumber=value=>Number.isFinite(Number(value))?Number(value):0;
const format=value=>money.format(asNumber(value));
const ascii=value=>String(value??'')
  .normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
  .replace(/[\u2010-\u2015]/g,'-').replace(/[\u2018\u2019]/g,"'")
  .replace(/[\u201c\u201d]/g,'"').replace(/[^\x20-\x7e]/g,'?');
const escapeText=text=>ascii(text).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');
const fit=(value,max)=>{const str=ascii(value);return str.length>max?str.slice(0,Math.max(1,max-3))+'...':str;};
const monthName=value=>{
  const [year,month]=String(value||'').split('-').map(Number);
  return year&&month?new Date(Date.UTC(year,month-1,1)).toLocaleString('en-US',{month:'long',year:'numeric'}):String(value||'');
};
const fill=(x,y,w,h,color)=>`q ${color} rg ${x} ${y} ${w} ${h} re f Q\n`;
const line=(x,y,w,color='0.85 0.88 0.92')=>`q ${color} RG 0.5 w ${x} ${y} m ${x+w} ${y} l S Q\n`;
const print=(text,x,y,{size=9,bold=false,color='0.13 0.23 0.38'}={})=>
  `BT /${bold?'F2':'F1'} ${size} Tf ${color} rg 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (${escapeText(text)}) Tj ET\n`;
function columnLayout(sectors){
  return [
    {key:'courier',label:'COURIER NAME',width:260},
    {key:'total',label:'TOTAL LOAD (KG)',width:100},
    {key:'from35To40',label:'35-40 KG',width:98},
    {key:'above40',label:'MORE THAN 40 KG',width:110},
    ...sectors.map(sector=>({key:'sector',sector:sector.name,label:sector.name+' (KG)',width:94})),
    {key:'average',label:'AVG KG/BAG',width:95}
  ];
}
function cellValue(row,column){
  switch(column.key){
    case 'courier':return row.courierName||'';
    case 'total':return format(row.totalWeight);
    case 'from35To40':return format(row.from35To40);
    case 'above40':return format(row.over40);
    case 'sector':return format(row.sectorLoads?.[column.sector]||0);
    case 'average':return format(row.avgBagKg);
    default:return '';
  }
}
function totalValue(totals,sectorTotals,column){
  switch(column.key){
    case 'courier':return 'GRAND TOTAL';
    case 'total':return format(totals.totalWeight);
    case 'from35To40':return format(totals.from35To40);
    case 'above40':return format(totals.over40);
    case 'sector':return format(sectorTotals[column.sector]||0);
    case 'average':return format(totals.avgBagKg);
    default:return '';
  }
}
function drawCells(columns,y,values,{head=false,total=false,stripe=false}={}){
  let result='',x=LEFT;
  const height=head?HEADER_H:ROW_H;
  if(head)result+=fill(LEFT,y-height,columns.reduce((n,c)=>n+c.width,0),height,'0.13 0.26 0.46');
  else if(total)result+=fill(LEFT,y-height,columns.reduce((n,c)=>n+c.width,0),height,'0.82 0.88 0.96');
  else if(stripe)result+=fill(LEFT,y-height,columns.reduce((n,c)=>n+c.width,0),height,'0.96 0.975 0.99');
  for(let i=0;i<columns.length;i++){
    const column=columns[i];
    const max=Math.floor((column.width-(i===0?14:11))/(head?5.1:5.05));
    const value=fit(values[i],max);
    // Numeric values use fixed-width appearance with indentation; sector
    // names stay left-aligned and do not collide with adjacent columns.
    const tx=x+6;
    result+=print(value,tx,y-(head?20:14),{size:head?9:9.5,bold:head||total||i===0||column.key==='total',
      color:head?'1 1 1':(total?'0.09 0.22 0.4':'0.12 0.21 0.34')});
    x+=column.width;
  }
  result+=line(LEFT,y-height,columns.reduce((n,c)=>n+c.width,0));
  return result;
}
function pdfObjects(contents){
  // PDF 1.4 with Helvetica standard fonts; all output is ASCII so byte
  // offsets and stream lengths are stable. No browser, fonts, or network.
  const objs=[null,
    '<< /Type /Catalog /Pages 2 0 R >>',
    '',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'];
  const ids=[];
  for(const contentsText of contents){
    const pageId=objs.length,streamId=pageId+1;
    ids.push(pageId);
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${streamId} 0 R >>`);
    objs.push(`<< /Length ${Buffer.byteLength(contentsText,'latin1')} >>\nstream\n${contentsText}endstream`);
  }
  objs[2]=`<< /Type /Pages /Kids [${ids.map(id=>id+' 0 R').join(' ')}] /Count ${ids.length} >>`;
  let out='%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets=[0];
  for(let i=1;i<objs.length;i++){
    offsets[i]=Buffer.byteLength(out,'latin1');
    out+=`${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xrefOffset=Buffer.byteLength(out,'latin1');
  out+=`xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for(let i=1;i<objs.length;i++)out+=String(offsets[i]).padStart(10,'0')+' 00000 n \n';
  out+=`trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(out,'latin1');
}
export function createCourierAnalysisPdf({flow,month,country='ALL',rows=[],sectors=[],totals={}}={}){
  if(!['IMPORT','EXPORT'].includes(flow))throw Error('Choose Import or Export for the PDF.');
  if(!/^(20\d\d)-(0[1-9]|1[0-2])$/.test(String(month)))throw Error('Select a valid report month.');
  if(!rows.length)throw Error('There is no saved courier analysis for this month.');
  const sorted=[...rows].sort((a,b)=>asNumber(b.totalWeight)-asNumber(a.totalWeight)||
    String(a.courierName).localeCompare(String(b.courierName)));
  const groups=[];
  for(let i=0;i<sectors.length;i+=MAX_SECTORS)groups.push(sectors.slice(i,i+MAX_SECTORS));
  if(!groups.length)groups.push([]);
  const rowPages=Math.ceil(sorted.length/ROWS_PER_PAGE),totalPages=rowPages*groups.length;
  const sectorTotals=Object.fromEntries(sectors.map(s=>[s.name,asNumber(s.totalWeight)]));
  const pages=[];
  for(let groupIndex=0;groupIndex<groups.length;groupIndex++){
    const group=groups[groupIndex],columns=columnLayout(group);
    for(let rowPage=0;rowPage<rowPages;rowPage++){
      const slice=sorted.slice(rowPage*ROWS_PER_PAGE,(rowPage+1)*ROWS_PER_PAGE);
      const pageNo=pages.length+1;
      let canvas=fill(0,0,PAGE_W,PAGE_H,'1 1 1');
      canvas+=fill(0,770,PAGE_W,72,'0.07 0.17 0.32');
      canvas+=print(`SUMMARY ${monthName(month).toUpperCase()} ${flow}`,LEFT,805,{bold:true,size:19,color:'1 1 1'});
      canvas+=print(`COURIER & ORIGIN LOAD ANALYSIS  |  ${country==='ALL'?'ALL ORIGINS':'ORIGIN '+country}`,LEFT,782,{bold:true,size:11,color:'0.81 0.9 1'});
      canvas+=print('Couriers ordered by total load: highest to lowest',LEFT,741,{bold:true,size:11});
      canvas+=print(`Sector columns ${groupIndex*MAX_SECTORS+1}-${Math.min(sectors.length,(groupIndex+1)*MAX_SECTORS)} of ${sectors.length||0} | sector group ${groupIndex+1}/${groups.length}`,LEFT,720,{size:9.5,color:'0.36 0.43 0.55'});
      canvas+=drawCells(columns,TABLE_TOP,columns.map(col=>col.label),{head:true});
      for(let ri=0;ri<slice.length;ri++){
        canvas+=drawCells(columns,TABLE_TOP-HEADER_H-ri*ROW_H,columns.map(col=>cellValue(slice[ri],col)),{stripe:ri%2===1});
      }
      const bottom=TABLE_TOP-HEADER_H-slice.length*ROW_H;
      // The grand total represents the entire month, never just this page's
      // courier rows. It is repeated on all vertical continuation pages.
      canvas+=drawCells(columns,bottom,columns.map(col=>totalValue(totals,sectorTotals,col)),{total:true});
      canvas+=print('35-40 kg: weight / bags > 35 and <= 40; over 40 kg: weight / bags > 40; average = total kg / bags.',LEFT,66,{size:9,color:'0.37 0.43 0.52'});
      canvas+=line(LEFT,53,PAGE_W-LEFT*2);
      canvas+=print(`Rows ${rowPage*ROWS_PER_PAGE+1}-${Math.min(sorted.length,(rowPage+1)*ROWS_PER_PAGE)} of ${sorted.length} | Page ${pageNo} of ${totalPages}`,LEFT,35,{size:9,color:'0.38 0.45 0.56'});
      pages.push(canvas);
    }
  }
  return pdfObjects(pages);
}
