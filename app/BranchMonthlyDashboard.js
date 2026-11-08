'use client';
import {useMemo,useState} from 'react';
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
export default function BranchMonthlyDashboard({records=[],isAdmin=false,branchFilter='ALL',onBranchChange=()=>{}}){
 const [selectedMonth,setSelectedMonth]=useState('');
 const [busy,setBusy]=useState(false);
 const months=useMemo(()=>branchMonths(records),[records]);
 const month=selectedMonth||months[0]||'';
 const report=useMemo(()=>aggregateBranchMonthly(records,{month}),[records,month]);
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
     <select aria-label="Monthly booking month" style={{display:'block',marginTop:4,padding:'9px 11px',border:'1px solid #b8c9de',borderRadius:8}} value={month} onChange={e=>setSelectedMonth(e.target.value)}>
      {months.map(m=><option key={m} value={m}>{monthLabel(m)}</option>)}
      {!months.length&&<option value="">No saved months</option>}
     </select>
    </label>
    <button type="button" style={{padding:'9px 12px',background:'#e5efff',borderRadius:8,border:'1px solid #bdcde3',fontWeight:800,cursor:'pointer'}} disabled={!report.selectedRows.length} onClick={()=>downloadCsv(details,basename+'-details')}>Download CSV</button>
    <button type="button" style={{padding:'9px 12px',background:'#e5efff',borderRadius:8,border:'1px solid #bdcde3',fontWeight:800,cursor:'pointer'}} disabled={busy||!report.selectedRows.length} onClick={()=>void excel()}>{busy?'Preparing Excel…':'Download Excel'}</button>
   </div>
  </div>
  <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(154px,1fr))',gap:9,marginTop:12}}>
   {[['Shipments',fmt(report.grand.loads)],['Weight',fmt(report.grand.weight)+' kg'],['Amount',rupee(report.grand.amount)],['Received',rupee(report.grand.received)],['Balance',rupee(report.grand.balance)],['Paid to JEPO',rupee(report.grand.paidToJepo)],['Paid to Branch',rupee(report.grand.paidToBranch)],['Delivered / Active',fmt(report.grand.delivered)+' / '+fmt(report.grand.active)]].map(([label,value])=>
    <div key={label} style={wrap}><div style={{fontSize:12,color:'#61748b',fontWeight:750}}>{label}</div><strong style={{display:'block',color:'#194a81',fontSize:18,marginTop:6}}>{value}</strong></div>)}
  </div>
  <div style={{display:'flex',flexWrap:'wrap',gap:12}}>
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
  <section style={wrap}>
   <h3 style={{margin:'0 0 10px',color:'#194875'}}>{monthLabel(month)} • All Saved Loads ({report.selectedRows.length})</h3>
   <div style={{maxHeight:450,overflowX:'auto'}}>
    <table style={{borderCollapse:'collapse',minWidth:1100,width:'100%',fontSize:12}}>
     <thead><tr>{['Booking Date','Branch','Tracking No','Service','Country','Weight','Amount','Received','Balance','Paid to JEPO','Paid to Branch','Status'].map(h=><th key={h} style={head}>{h}</th>)}</tr></thead>
     <tbody>{report.selectedRows.map(r=><tr key={r.id}>
      {[date(r.date),r.branch,r.trackingNo||'—',r.service||'—',r.destination||'—',fmt(r.weight)+' kg',rupee(r.amount),rupee(r.received),rupee(r.balance),rupee(r.paidToJepo),rupee(branchPayoutForRecord(r)),r.liveStatus||statusLabel(r.status)].map((v,i)=><td key={i} style={cell}>{v}</td>)}
     </tr>)}
     {!report.selectedRows.length&&<tr><td colSpan={12} style={cell}>No saved loads for this month</td></tr>}
     </tbody></table>
   </div>
  </section>
 </section>;
}
