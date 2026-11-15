'use client';
import {useEffect,useMemo,useState} from 'react';
import {aggregateBranchMonthly,branchMonths} from '../lib/branchMonthlySummary.js';
import {branchPayoutForRecord,totalJepoForLoad,statusLabel} from '../lib/branchLoads.js';

const fmt=v=>Number(v||0).toLocaleString('en-IN',{maximumFractionDigits:2});
const rupee=v=>'₹'+Number(v||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
const date=v=>v?String(v).split('-').reverse().join('/'):'—';
const monthLabel=v=>v?new Intl.DateTimeFormat('en-IN',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(v+'-01T00:00:00Z')):'All Months';
const cell={padding:'9px 10px',borderBottom:'1px solid #e4ebf4',textAlign:'left',whiteSpace:'nowrap'};
const head={...cell,background:'#eaf2ff',position:'sticky',top:0,color:'#234b79'};
const wrap={background:'#fff',border:'1px solid #d7e3f1',borderRadius:12,padding:13,marginTop:13};
const names=[['loads','Shipments'],['weight','Weight (kg)'],['amount','Amount (₹)'],['received','Received (₹)'],['balance','Balance (₹)'],['paidToJepo','Paid to JEPO (₹)'],['paidToBranch','Paid to Branch (₹)'],['totalJepo','Total JEPO incl. Extras (₹)'],['delivered','Delivered'],['active','Active']];
const formatted=(name,v)=>name==='weight'||name==='loads'||name==='delivered'||name==='active'?fmt(v):rupee(v);
const csvValue=v=>{const s=String(v??'');return '"'+(/^[=+\-@\t\r]/.test(s)?"'"+s:s).replace(/"/g,'""')+'"';};
function fileRows(group,rows){
 const main=[['Month','Branch',...names.map(([,label])=>label)],
   ...group.map(r=>[r.month,r.branch,...names.map(([n])=>r[n])])];
 const details=[['Booking Date','Branch','Tracking No','Service','Destination','Commodity','Weight (kg)','Rate (₹/kg)','Amount (₹)','Received (₹)','Balance (₹)','Paid to JEPO (₹)','Paid to Branch (₹)','Extra Cost (₹)','Total JEPO incl. Extras (₹)','Status','Delivery Date','Remarks'],
   ...rows.map(r=>[r.date,r.branch,r.trackingNo||'',r.service||'',r.destination||'',r.commodity||'',Number(r.weight||0),Number(r.rate||0),Number(r.amount||0),Number(r.received||0),Number(r.balance||0),Number(r.paidToJepo||0),Number(branchPayoutForRecord(r)),Number(r.extraCost||0),Number(totalJepoForLoad(r.paidToJepo,r.commodity,r.extraCost,r.bottleCount,{legacy:true})||0),r.liveStatus||statusLabel(r.status),r.deliveredOn||'',r.remarks||''])];
 return {main,details};
}
function downloadCsv(lines,filename){
 const csv='\uFEFF'+lines.map(line=>line.map(csvValue).join(',')).join('\r\n');
 const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
 const a=document.createElement('a');a.href=url;a.download=filename+'.csv';document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
}
function SummaryTable({title,items,headName='Branch'}){
 return <section style={{...wrap,flex:'1 1 530px',minWidth:0}}>
  <h3 style={{margin:'0 0 10px',fontSize:16,color:'#194875'}}>{title}</h3>
  <div style={{overflowX:'auto',maxHeight:400}}>
   <table style={{borderCollapse:'collapse',fontSize:12,width:'100%'}}><thead><tr>
    {[headName,'Loads','Weight (kg)','Amount','Received','Balance','Paid to JEPO','Paid to Branch'].map(h=><th key={h} style={head}>{h}</th>)}
   </tr></thead><tbody>
    {items.map(r=><tr key={r.label}>
     {[r.label,fmt(r.loads),fmt(r.weight),rupee(r.amount),rupee(r.received),rupee(r.balance),rupee(r.paidToJepo),rupee(r.paidToBranch)].map((v,i)=><td key={i} style={{...cell,fontWeight:i===0?800:400}}>{v}</td>)}
    </tr>)}
    {!items.length&&<tr><td colSpan={8} style={cell}>No matching records</td></tr>}
   </tbody></table>
  </div>
 </section>;
}
export default function BranchMonthlyDashboard({records=[],isAdmin=false,branchFilter='ALL',onBranchChange=()=>{},selectedMonth='',onMonthChange=()=>{},showProfit=false}){
 const [profitSnapshot,setProfitSnapshot]=useState(null);
 const [busy,setBusy]=useState(false);
 const [pdfBusy,setPdfBusy]=useState(false);
 const months=useMemo(()=>branchMonths(records),[records]);
 const month=selectedMonth&&months.includes(selectedMonth)?selectedMonth:months[0]||'';
 const report=useMemo(()=>aggregateBranchMonthly(records,{month}),[records,month]);
 // Profit = booked income minus expenses within the selected month only.
 useEffect(()=>{
  if(!showProfit||!month){setProfitSnapshot(null);return;}
  const controller=new AbortController();
  setProfitSnapshot(null);
  fetch('/api/branch-profit?month='+encodeURIComponent(month),{credentials:'include',cache:'no-store',signal:controller.signal})
   .then(async response=>{
    const result=await response.json();
    if(!response.ok||!result.ok)throw new Error(result.error||'Unable to read monthly profit');
    return result;
   })
   .then(result=>{if(!controller.signal.aborted)setProfitSnapshot({month,incomes:result.incomes||{},expenses:result.expenses||[]});})
   .catch(error=>{if(!controller.signal.aborted)setProfitSnapshot({month,error:error?.message||'Unavailable'});});
  return ()=>controller.abort();
 },[month,showProfit]);
 const selectedBranches=branchFilter==='ALL'?['JIND','KARNAL']:[branchFilter];
 const profitIncome=profitSnapshot?.incomes?selectedBranches.reduce((t,b)=>t+Number(profitSnapshot.incomes[b]||0),0):0;
 const profitExpenses=(profitSnapshot?.expenses||[]).reduce((t,r)=>t+(selectedBranches.includes(r.branch)?Number(r.amount||0):0),0);
 const monthlyProfit=profitIncome-profitExpenses;
 const overall=useMemo(()=>aggregateBranchMonthly(records),[records]);
 const history=overall.history.filter(r=>branchFilter==='ALL'||r.branch===branchFilter);
 const {main,details}=fileRows(history,report.selectedRows);
 const basename='mayavi-'+(branchFilter==='ALL'?'jind-karnal':branchFilter.toLowerCase())+'-monthly-'+(month||'all');
 async function excel(){
  if(busy)return;setBusy(true);
  try{
   const ExcelJS=(await import('exceljs')).default;
   const wb=new ExcelJS.Workbook();
   for(const [name,data] of [['Monthly Totals',main],['Selected Month Details',details]]){
    const ws=wb.addWorksheet(name);
    ws.columns=data[0].map((h,i)=>({header:h,key:'c'+i,width:/Remarks|Commodity|Destination/.test(h)?26:Math.min(25,Math.max(15,h.length+2))}));
    data.slice(1).forEach(row=>ws.addRow(row));
    ws.views=[{state:'frozen',ySplit:1,xSplit:2}];
    ws.getRow(1).height=33;
    ws.getRow(1).eachCell(c=>{c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF18549A'}};c.font={color:{argb:'FFFFFFFF'},bold:true};c.alignment={wrapText:true}});
    if(data.length>1)ws.autoFilter={from:{row:1,column:1},to:{row:data.length,column:data[0].length}};
   }
   const binary=await wb.xlsx.writeBuffer();
   const url=URL.createObjectURL(new Blob([binary],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
   const a=document.createElement('a');a.href=url;a.download=basename+'.xlsx';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(error){alert('Monthly Excel export unavailable: '+(error?.message||error));}finally{setBusy(false);}
 }

 async function pdf(){
  if(pdfBusy||busy||!report.selectedRows.length)return;
  setPdfBusy(true);
  try{
   const {PDFDocument,StandardFonts,rgb}=await import('pdf-lib');
   const document=await PDFDocument.create();
   const regular=await document.embedFont(StandardFonts.Helvetica);
   const bold=await document.embedFont(StandardFonts.HelveticaBold);
   const navy=rgb(0.10,0.29,0.49),text=rgb(0.17,0.24,0.33);
   const pale=rgb(0.91,0.95,1),stripe=rgb(0.97,0.98,1),white=rgb(1,1,1);
   const W=842,H=595,M=29,TABLE_W=784;
   const plain=v=>String(v??'').replace(/₹/g,'Rs. ').replace(/[–—−]/g,'-').replace(/[^\x20-\x7E]/g,' ');
   const amount=v=>'Rs. '+fmt(v);
   let page,y;
   const draw=(value,x,atY,size=8,strong=false,color=text)=>{
    page.drawText(plain(value),{x,y:atY,size,font:strong?bold:regular,color});
   };
   const fit=(value,width,size,strong=false)=>{
    const font=strong?bold:regular;
    const input=plain(value);
    if(font.widthOfTextAtSize(input,size)<=width-7)return input;
    let s=input;
    while(s.length&&font.widthOfTextAtSize(s+'...',size)>width-7)s=s.slice(0,-1);
    return s+'...';
   };
   const newPage=()=>{
    page=document.addPage([W,H]);
    page.drawRectangle({x:0,y:H-12,width:W,height:12,color:navy});
    draw('MAYAVI  /  BRANCH MONTHLY REPORT',M,H-37,15,true,navy);
    draw('Booking month: '+monthLabel(month)+'     Branch: '+(branchFilter==='ALL'?'Jind + Karnal':branchFilter),M,H-55,9);
    page.drawLine({start:{x:M,y:H-65},end:{x:W-M,y:H-65},thickness:0.7,color:pale});
    y=H-86;
   };
   const section=title=>{
    if(y<95)newPage();
    draw(title,M,y,11,true,navy);
    y-=20;
   };
   const table=(title,columns,widths,rows,size=7)=>{
    section(title);
    let needHead=true;
    const heading=()=>{
     page.drawRectangle({x:M,y:y-21,width:TABLE_W,height:21,color:navy});
     let x=M;
     columns.forEach((h,i)=>{draw(fit(h,widths[i],size-0.1,true),x+4,y-14,size-0.1,true,white);x+=widths[i];});
     y-=21;
    };
    const entries=rows.length?rows:[['No matching records',...columns.slice(1).map(()=>'' )]];
    for(let index=0;index<entries.length;index++){
     if(y<49){newPage();section(title+' (continued)');needHead=true;}
     if(needHead){heading();needHead=false;}
     if(index%2===0)page.drawRectangle({x:M,y:y-18,width:TABLE_W,height:18,color:stripe});
     let x=M;
     entries[index].forEach((v,i)=>{
      if(i<widths.length)draw(fit(v,widths[i],size,index===entries.length-1&&String(entries[index][0]).startsWith('MONTH TOTAL')),x+4,y-12,size,false,text);
      x+=widths[i]||0;
     });
     y-=18;
    }
    y-=13;
   };
   newPage();
   const g=report.grand;
   const metric=[
    ['Saved shipments',fmt(g.loads),'Weight (kg)',fmt(g.weight)],
    ['Total amount',amount(g.amount),'Received',amount(g.received)],
    ['Balance',amount(g.balance),'Paid to JEPO (base)',amount(g.paidToJepo)],
    ['Paid to Branch',amount(g.paidToBranch),'JEPO including extras',amount(g.totalJepo)],
    ['Delivered',fmt(g.delivered),'Active',fmt(g.active)]
   ];
   if(showProfit&&profitSnapshot?.month===month&&!profitSnapshot.error){
    metric.push(['Net Profit',amount(monthlyProfit),'','']);
   }
   table('Selected Month Overview',['Metric','Value','Metric','Value'],[185,207,185,207],metric,8);
   const loadRows=report.selectedRows.map(r=>[
    date(r.date),r.branch,r.trackingNo||'',r.service||'',r.destination||'',
    amount(r.amount),amount(r.received),amount(r.balance),
    r.liveStatus||statusLabel(r.status),fmt(r.weight),
    amount(branchPayoutForRecord(r)),
    amount(totalJepoForLoad(r.paidToJepo,r.commodity,r.extraCost,r.bottleCount,{legacy:true}))
   ]);
   loadRows.push([
    'MONTH TOTAL','','', '', '',amount(g.amount),amount(g.received),amount(g.balance),
    fmt(g.loads)+' loads',fmt(g.weight),amount(g.paidToBranch),amount(g.totalJepo)
   ]);
   table('All Saved Loads - '+monthLabel(month),
    ['Booked','Branch','Tracking No','Service','Destination','Amount','Received','Balance','Status','Wt (kg)','To Branch','To JEPO total'],
    [56,42,91,58,68,63,61,61,70,45,78,91],loadRows,6.65);
   const groups=rows=>rows.map(r=>[
    r.label,fmt(r.loads),fmt(r.weight),amount(r.amount),amount(r.received),
    amount(r.balance),amount(r.paidToJepo),amount(r.paidToBranch)
   ]);
   const groupWidths=[142,60,77,102,102,102,99,100];
   const groupHeads=['Name','Loads','Weight kg','Amount','Received','Balance','JEPO Base','Paid to Branch'];
   table('Branch Comparison',groupHeads,groupWidths,groups(report.branches),7.3);
   table('Service-wise Summary',groupHeads,groupWidths,groups(report.byService),7.3);
   table('Destination-wise Summary',groupHeads,groupWidths,groups(report.byCountry),7.3);
   table('Month-by-month History',
    ['Month','Branch','Loads','Weight kg','Amount','Received','Balance','JEPO Base','Paid to Branch'],
    [82,65,53,63,104,104,104,104,105],
    history.map(r=>[monthLabel(r.month),r.branch,fmt(r.loads),fmt(r.weight),amount(r.amount),amount(r.received),amount(r.balance),amount(r.paidToJepo),amount(r.paidToBranch)]),7.3);
   document.getPages().forEach((p,index)=>{
    p.drawLine({start:{x:M,y:33},end:{x:W-M,y:33},thickness:0.5,color:pale});
    p.drawText('Mayavi | Booking-date monthly report | '+monthLabel(month),{x:M,y:19,font:regular,size:8,color:navy});
    p.drawText('Page '+(index+1)+' / '+document.getPageCount(),{x:W-95,y:19,font:regular,size:8,color:navy});
   });
   const bytes=await document.save();
   const url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));
   const a=document.createElement('a');a.href=url;a.download=basename+'.pdf';
   document.body.appendChild(a);a.click();a.remove();
   setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(error){alert('Monthly PDF export unavailable: '+(error?.message||error));}
  finally{setPdfBusy(false);}
 }

 return <section aria-label="Jind and Karnal Monthly Data" style={{margin:'14px 0'}}>
  <div style={{...wrap,display:'flex',gap:12,flexWrap:'wrap',alignItems:'end',justifyContent:'space-between'}}>
   <div><h2 style={{fontSize:21,color:'#1e4c7c',margin:'0 0 6px'}}>Jind &amp; Karnal — Monthly Data</h2>
    <p style={{fontSize:12,color:'#5c7189',margin:0}}>Booking Date month • Active + Delivered • Branch filter respected • Existing records unchanged</p></div>
   <div style={{display:'flex',gap:8,alignItems:'end',flexWrap:'wrap'}}>
    {isAdmin&&<label style={{fontSize:12,fontWeight:750}}>Branch
     <select aria-label="Monthly branch filter" style={{display:'block',marginTop:4,padding:'9px 11px',border:'1px solid #b8c9de',borderRadius:8}} value={branchFilter} onChange={e=>onBranchChange(e.target.value)}>
      <option value="ALL">Jind + Karnal</option><option value="JIND">Jind</option><option value="KARNAL">Karnal</option>
     </select>
    </label>}
    <label style={{fontSize:12,fontWeight:750}}>Booking Month
     <select aria-label="Monthly booking month" style={{display:'block',marginTop:4,padding:'9px 11px',border:'1px solid #b8c9de',borderRadius:8}} value={month} onChange={e=>onMonthChange(e.target.value)}>
      {months.map(m=><option key={m} value={m}>{monthLabel(m)}</option>)}
      {!months.length&&<option value="">No saved months</option>}
     </select>
    </label>
    <button type="button" style={{padding:'9px 12px',background:'#e5efff',borderRadius:8,border:'1px solid #bdcde3',fontWeight:800,cursor:'pointer'}} disabled={!report.selectedRows.length} onClick={()=>downloadCsv(details,basename+'-details')}>Download CSV</button>
    <button type="button" style={{padding:'9px 12px',background:'#e5efff',borderRadius:8,border:'1px solid #bdcde3',fontWeight:800,cursor:'pointer'}} disabled={busy||!report.selectedRows.length} onClick={()=>void excel()}>{busy?'Preparing Excel…':'Download Excel'}</button>
    <button type="button" style={{padding:'9px 12px',background:'#dbf0ff',borderRadius:8,border:'1px solid #8dbbdd',fontWeight:800,cursor:'pointer'}} disabled={busy||pdfBusy||!report.selectedRows.length} onClick={()=>void pdf()}>{pdfBusy?'Preparing PDF…':'Download PDF'}</button>
   </div>
  </div>
  <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(154px,1fr))',gap:9,marginTop:12}}>
   {[['Shipments',fmt(report.grand.loads)],['Weight',fmt(report.grand.weight)+' kg'],['Amount',rupee(report.grand.amount)],['Received',rupee(report.grand.received)],['Balance',rupee(report.grand.balance)],['Paid to JEPO • Base',rupee(report.grand.paidToJepo)],['Total JEPO incl. Extras',rupee(report.grand.totalJepo)],['Paid to Branch',rupee(report.grand.paidToBranch)],['Delivered / Active',fmt(report.grand.delivered)+' / '+fmt(report.grand.active)],...(showProfit&&month?[['Net Profit • '+month,profitSnapshot?.month!==month?'Loading…':profitSnapshot.error?'Unavailable':rupee(monthlyProfit)]]:[])].map(([label,value])=>
    <div key={label} style={wrap}><div style={{fontSize:12,color:'#61748b',fontWeight:750}}>{label}</div><strong style={{display:'block',color:'#194a81',fontSize:18,marginTop:6}}>{value}</strong></div>)}
  </div>
  <section style={wrap} aria-label="All Saved Loads for selected month">
   <h3 style={{margin:'0 0 8px',color:'#194875'}}>{monthLabel(month)} • All Saved Loads ({report.selectedRows.length})</h3>
   <p style={{margin:'0 0 12px',fontSize:12,color:'#60758b'}}>All saved Active + Delivered loads booked in the selected month. The final three columns and bottom row give monthly weight and payouts.</p>
   <div style={{maxHeight:480,overflowX:'auto'}}>
    <table style={{borderCollapse:'collapse',minWidth:1190,width:'100%',fontSize:12}}>
     <thead><tr>{['Booking Date','Branch','Tracking No','Service','Country','Amount','Received','Balance','Status','Weight (kg)','Paid to Branch (₹)','Total Paid to JEPO incl. Extras (₹)'].map(h=><th key={h} style={head}>{h}</th>)}</tr></thead>
     <tbody>{report.selectedRows.map(r=><tr key={r.id}>
      {[date(r.date),r.branch,r.trackingNo||'—',r.service||'—',r.destination||'—',rupee(r.amount),rupee(r.received),rupee(r.balance),r.liveStatus||statusLabel(r.status),fmt(r.weight)+' kg',rupee(branchPayoutForRecord(r)),rupee(totalJepoForLoad(r.paidToJepo,r.commodity,r.extraCost,r.bottleCount,{legacy:true}))].map((v,i)=><td key={i} style={{...cell,fontWeight:i>=9?700:400}}>{v}</td>)}
     </tr>)}
     {!report.selectedRows.length&&<tr><td colSpan={12} style={cell}>No saved loads for this month</td></tr>}
     </tbody>
     <tfoot><tr>
      <td colSpan={9} style={{...head,fontWeight:900,position:'static'}}>MONTH TOTAL • {report.grand.loads} saved loads</td>
      <td style={{...head,fontWeight:900,position:'static'}}>{fmt(report.grand.weight)} kg</td>
      <td style={{...head,fontWeight:900,position:'static'}}>{rupee(report.grand.paidToBranch)}</td>
      <td style={{...head,fontWeight:900,position:'static'}}>{rupee(report.grand.totalJepo)}</td>
     </tr></tfoot>
    </table>
   </div>
  </section>
  <div style={{display:'grid',gridTemplateColumns:'minmax(0,1fr)',gap:12}}>
   <SummaryTable title={monthLabel(month)+' • Branch Comparison'} items={report.branches}/>
   <SummaryTable title="Service-wise Summary" items={report.byService} headName="Service"/>
   <SummaryTable title="Destination-wise Summary" items={report.byCountry} headName="Destination"/>
  </div>
  <section style={wrap}>
   <h3 style={{margin:'0 0 10px',color:'#194875'}}>Month-by-month History</h3>
   <div style={{maxHeight:350,overflowX:'auto'}}>
    <table style={{borderCollapse:'collapse',minWidth:850,width:'100%',fontSize:12}}><thead><tr>
     {['Month','Branch','Shipments','Weight','Amount','Received','Balance','Paid to JEPO','Paid to Branch'].map(v=><th key={v} style={head}>{v}</th>)}
    </tr></thead><tbody>
     {history.map(r=><tr key={r.month+'|'+r.branch}>
      {[monthLabel(r.month),r.branch,fmt(r.loads),fmt(r.weight)+' kg',rupee(r.amount),rupee(r.received),rupee(r.balance),rupee(r.paidToJepo),rupee(r.paidToBranch)].map((v,i)=><td key={i} style={cell}>{v}</td>)}
     </tr>)}
    </tbody></table>
   </div>
  </section>

 </section>;
}
