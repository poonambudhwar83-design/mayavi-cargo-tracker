'use client';

import {useMemo,useState} from 'react';
import {jepoTodayIst,jepoDaysSinceBooking,jepoOverdueDays,jepoIsOutForDelivery} from '../lib/jepoOverdue.js';
import {LOAD_STATUSES,statusLabel} from '../lib/branchLoads.js';

// Match JEPO Tracking: older than 30 completed days, still not delivered.
// This is a live view of existing branch loads, never a second saved copy.
const age=(row,today)=>jepoDaysSinceBooking(row.date,today);
const overdue=(row,today)=>jepoOverdueDays({...row,bookingDate:row.date},today);
const isOFD=row=>jepoIsOutForDelivery(row);
const dateLabel=value=>/^\d{4}-\d{2}-\d{2}$/.test(String(value||''))?String(value).split('-').reverse().join('/'):'—';
const safeCsv=value=>{
 const s=String(value??'');
 return '"'+(/^[=+\-@\t\r]/.test(s)?"'"+s:s).replace(/"/g,'""')+'"';
};
const button={border:'1px solid #b9c9df',borderRadius:8,background:'#fff',color:'#21446d',fontWeight:750,padding:'9px 12px',fontSize:12,cursor:'pointer'};
const head={textAlign:'left',padding:'10px 9px',background:'#fbe9d7',color:'#78350f',position:'sticky',top:0,fontSize:12,whiteSpace:'nowrap'};
const cell={padding:'9px',borderBottom:'1px solid #e5ebf3',verticalAlign:'middle',fontSize:12};

export default function BranchOverdueDashboard({rows=[],branchFilter='ALL',busy=false,onEdit=()=>{},onStatusChange=()=>{},onRefresh=()=>{}}){
 const [query,setQuery]=useState('');
 const [exporting,setExporting]=useState('');
 const [error,setError]=useState('');
 const today=jepoTodayIst();
 const overdueRows=useMemo(()=>rows.filter(row=>overdue(row,today)!==null).sort((a,b)=>
   Number(isOFD(b))-Number(isOFD(a))
   ||overdue(b,today)-overdue(a,today)
   ||String(a.date||'').localeCompare(String(b.date||''))
   ||String(a.trackingNo||a.id||'').localeCompare(String(b.trackingNo||b.id||''))
 ),[rows,today]);
 const visible=useMemo(()=>overdueRows.filter(row=>
   [row.trackingNo,row.branch,row.destination,row.service,row.commodity,row.status,row.liveStatus,row.liveRemarks,row.remarks].join(' ').toLowerCase().includes(query.trim().toLowerCase())
 ),[overdueRows,query]);
 const outForDelivery=overdueRows.filter(isOFD).length;
 const counts={JIND:overdueRows.filter(r=>r.branch==='JIND').length,KARNAL:overdueRows.filter(r=>r.branch==='KARNAL').length};
 const filename='mayavi-'+(branchFilter==='ALL'?'jind-karnal':branchFilter.toLowerCase())+'-overdue-not-delivered-'+today;
 const labels=['Branch','Booking Date','Booking Day','JEPO Tracking No.','Service','Destination','Commodity','Weight (kg)','Status','JEPO Live Status','JEPO Live Remarks','Days Since Booking','Days Overdue','Follow-up Remarks'];
 const rowValues=r=>[
   r.branch||'',r.date||'',
   /^\d{4}-\d{2}-\d{2}$/.test(String(r.date||''))?new Intl.DateTimeFormat('en-IN',{weekday:'long',timeZone:'UTC'}).format(new Date(r.date+'T00:00:00Z')):'',
   r.trackingNo||'',r.service||'',r.destination||'',r.commodity||'',Number(r.weight||0),
   statusLabel(r.status),r.liveStatus||'',r.liveRemarks||'',age(r,today)??'',overdue(r,today)??'',r.remarks||''
 ];
 function csv(){
   const data=[labels,...visible.map(rowValues)].map(line=>line.map(safeCsv).join(',')).join('\r\n');
   const url=URL.createObjectURL(new Blob(['\ufeff'+data],{type:'text/csv;charset=utf-8'}));
   const anchor=document.createElement('a');
   anchor.href=url;anchor.download=filename+'.csv';anchor.click();
   setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 async function downloadExcel(){
  if(exporting)return;
  setError('');setExporting('Excel');
  try{
   const ExcelJS=(await import('exceljs')).default;
   const workbook=new ExcelJS.Workbook();
   workbook.creator='Mayavi Cargo / JEPO Express';
   const sheet=workbook.addWorksheet('Overdue - Not Delivered');
   sheet.columns=labels.map((label,i)=>({header:label,key:'f'+i,width:i===10||i===13?42:i===3?26:i===9?27:Math.max(15,Math.min(23,label.length+3))}));
   for(const row of visible){
    sheet.addRow(rowValues(row).map(v=>typeof v==='string'&&/^[=+\-@]/.test(v)?"'"+v:v));
   }
   sheet.getRow(1).height=34;
   sheet.getRow(1).eachCell(c=>{c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF944217'}};c.font={bold:true,color:{argb:'FFFFFFFF'}};c.alignment={vertical:'middle',wrapText:true};});
   sheet.views=[{state:'frozen',ySplit:1,xSplit:4}];
   if(visible.length)sheet.autoFilter={from:{row:1,column:1},to:{row:visible.length+1,column:labels.length}};
   for(let i=2;i<=visible.length+1;i++){
    const row=sheet.getRow(i);
    if(isOFD(visible[i-2]))row.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFFFF0E1'}};
   }
   const buffer=await workbook.xlsx.writeBuffer();
   const url=URL.createObjectURL(new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
   const anchor=document.createElement('a');anchor.href=url;anchor.download=filename+'.xlsx';anchor.click();
   setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(e){setError('Excel export failed: '+(e?.message||'Please try again.'));}
  finally{setExporting('');}
 }
 async function downloadPdf(){
  if(exporting)return;
  setError('');setExporting('PDF');
  try{
   const {PDFDocument,StandardFonts,rgb}=await import('pdf-lib');
   const pdf=await PDFDocument.create();
   const font=await pdf.embedFont(StandardFonts.Helvetica);
   const bold=await pdf.embedFont(StandardFonts.HelveticaBold);
   const widths=[54,68,112,72,70,105,56,156];
   const keys=r=>[r.branch||'',dateLabel(r.date),r.trackingNo||'—',r.service||'—',r.destination||'—',r.liveStatus||statusLabel(r.status),String(overdue(r,today)??''),r.remarks||r.liveRemarks||'—'];
   const headers=['Branch','Booked','JEPO Tracking','Service','Destination','Current Status','Late (d)','Remarks / Follow-up'];
   const usable=v=>String(v??'').replace(/[^\x20-\x7E]/g,'?');
   const shorten=(v,maxWidth,size=7)=>{let s=usable(v);while(s.length&&font.widthOfTextAtSize(s,size)>maxWidth-8)s=s.slice(0,-1);return s;};
   const x0=24,top=550,bottom=44,rowH=24;
   let page=null,y=top,number=0;
   const startPage=()=>{
    page=pdf.addPage([842,595]);number++;
    page.drawText('MAYAVI | JIND & KARNAL OVERDUE PACKETS',{x:x0,y:565,size:13,font:bold,color:rgb(.42,.19,.07)});
    page.drawText('Not delivered after 30 days | As of '+today+' IST | Branch: '+branchFilter,{x:x0,y:548,size:8,font,color:rgb(.30,.35,.43)});
    y=525;
    page.drawRectangle({x:x0,y:y-6,width:widths.reduce((a,b)=>a+b,0),height:21,color:rgb(.94,.86,.75)});
    let x=x0;headers.forEach((h,i)=>{page.drawText(shorten(h,widths[i],7),{x:x+4,y:y+1,size:7,font:bold,color:rgb(.35,.20,.10)});x+=widths[i];});
    y-=rowH;
   };
   startPage();
   for(const [index,r] of visible.entries()){
    if(y<bottom+rowH)startPage();
    if(index%2===0)page.drawRectangle({x:x0,y:y-6,width:widths.reduce((a,b)=>a+b,0),height:rowH,color:rgb(.97,.98,1)});
    let x=x0;keys(r).forEach((v,i)=>{page.drawText(shorten(v,widths[i],7),{x:x+4,y:y+2,size:7,font,color:rgb(.1,.19,.28)});x+=widths[i];});
    y-=rowH;
   }
   for(const [i,p] of pdf.getPages().entries()){
    p.drawText('Generated from saved Mayavi branch records | Page '+(i+1)+' of '+number,{x:x0,y:19,size:8,font,color:rgb(.42,.46,.52)});
   }
   const bytes=await pdf.save();
   const url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));
   const a=document.createElement('a');a.href=url;a.download=filename+'.pdf';a.click();
   setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(e){setError('PDF export failed: '+(e?.message||'Please try again.'));}
  finally{setExporting('');}
 }
 return <section aria-label="Overdue branch packets" style={{margin:'12px 0 18px',padding:14,borderRadius:12,background:'#fff',border:'1px solid #f1d2af'}}>
   <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'center',flexWrap:'wrap'}}>
     <div>
       <h2 style={{margin:'0 0 4px',fontSize:19,color:'#8a3e12'}}>Overdue Packets — Not Delivered</h2>
       <p style={{margin:0,color:'#765139',fontSize:12}}>JEPO Tracking jaisa rule: booking ke 30 din poore hone ke baad bhi undelivered packets. Out for Delivery sabse upar; phir sabse zyada overdue days.</p>
     </div>
     <div style={{display:'flex',gap:7,flexWrap:'wrap',fontSize:12}}>
       <strong style={{padding:'7px 10px',borderRadius:7,background:'#fff0de',color:'#92400e'}}>{overdueRows.length} Overdue</strong>
       <strong style={{padding:'7px 10px',borderRadius:7,background:'#eaf3ff',color:'#1d4e89'}}>{outForDelivery} Out for Delivery</strong>
       {branchFilter==='ALL'&&<><span style={{padding:'7px 10px'}}>Jind: <b>{counts.JIND}</b></span><span style={{padding:'7px 10px'}}>Karnal: <b>{counts.KARNAL}</b></span></>}
     </div>
   </div>
   <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',margin:'14px 0'}}>
     <input aria-label="Search overdue branch packets" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search AWB, service, destination, remarks..." style={{flex:'1 1 240px',minWidth:0,maxWidth:380,border:'1px solid #b9c9df',borderRadius:8,padding:'10px 12px',fontSize:13}}/>
     <button type="button" style={button} onClick={onRefresh} disabled={busy}>Refresh</button>
     <button type="button" style={button} onClick={csv} disabled={!visible.length||Boolean(exporting)}>CSV</button>
     <button type="button" style={button} onClick={()=>void downloadExcel()} disabled={!visible.length||Boolean(exporting)}>{exporting==='Excel'?'Exporting…':'Excel'}</button>
     <button type="button" style={button} onClick={()=>void downloadPdf()} disabled={!visible.length||Boolean(exporting)}>{exporting==='PDF'?'Exporting…':'PDF'}</button>
   </div>
   {error&&<p role="alert" style={{color:'#991b1b'}}>{error}</p>}
   <div style={{overflowX:'auto',borderRadius:8,border:'1px solid #e2e8f0'}}>
     <table style={{borderCollapse:'collapse',width:'100%',minWidth:1280}}>
       <thead><tr>{['Branch','Booking Date','JEPO Tracking No.','Destination','Service','Weight (kg)','Current Status','JEPO Live Progress','Days Since Booking','Days Overdue','Follow-up Remarks','Actions'].map(h=><th key={h} style={head}>{h}</th>)}</tr></thead>
       <tbody>
         {visible.map(row=><tr key={row.id} style={{background:isOFD(row)?'#fff6ea':'#fff'}}>
           <td style={cell}><b>{row.branch}</b></td>
           <td style={cell}><b>{dateLabel(row.date)}</b></td>
           <td style={cell}><b>{row.trackingNo||'—'}</b></td>
           <td style={cell}>{row.destination||'—'}</td>
           <td style={cell}>{row.service||'—'}</td>
           <td style={cell}>{row.weight||'—'}</td>
           <td style={cell}>
             {isOFD(row)&&<small style={{display:'block',color:'#b45309',fontWeight:850}}>OUT FOR DELIVERY</small>}
             <select aria-label={'Update status for '+(row.trackingNo||row.id)} value={row.status||''} disabled={busy} onChange={e=>onStatusChange(row,e.target.value)} style={{maxWidth:180,padding:7,border:'1px solid #d3dfef',borderRadius:6,background:'#fff'}}>
               {LOAD_STATUSES.map(v=><option key={v} value={v}>{statusLabel(v)}</option>)}
             </select>
           </td>
           <td style={{...cell,maxWidth:220,whiteSpace:'normal'}}>{row.liveStatus&&<strong style={{display:'block'}}>{row.liveStatus}</strong>}{row.liveRemarks||'—'}</td>
           <td style={{...cell,fontWeight:800,textAlign:'center'}}>{age(row,today)} days</td>
           <td style={{...cell,color:'#b91c1c',fontWeight:900,textAlign:'center'}}>{overdue(row,today)} days</td>
           <td style={{...cell,maxWidth:230,whiteSpace:'normal'}}>{row.remarks||'—'}</td>
           <td style={cell}><button type="button" style={button} disabled={busy} onClick={()=>onEdit(row)}>Edit / Remarks</button></td>
         </tr>)}
         {!visible.length&&<tr><td colSpan={12} style={{padding:25,textAlign:'center',color:'#64748b'}}>{overdueRows.length?'No overdue packets match your search.':'No undelivered packets older than 30 days for this branch.'}</td></tr>}
       </tbody>
     </table>
   </div>
   <p style={{fontSize:11,color:'#64748b',margin:'9px 0 0'}}>As of {dateLabel(today)} (IST). Missing/invalid booking dates and delivered packets are excluded. Updating a packet to Delivered removes it from this list automatically; the original saved record remains in Delivered.</p>
 </section>;
}
