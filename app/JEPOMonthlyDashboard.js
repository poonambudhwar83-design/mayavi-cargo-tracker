'use client';
import {useMemo,useState} from 'react';
import {aggregateJepoMonthly,availableJepoMonths,jepoMonthlyPartner} from '../lib/jepoMonthlySummary.js';
import {jepoTrackingStatusLabel} from '../lib/jepoTrackingState.js';

const box={border:'1px solid #d9e3ef',borderRadius:11,padding:13,background:'#fff',marginTop:10};
const input={padding:'9px 10px',borderRadius:8,border:'1px solid #c0cfe0',background:'#fff',fontSize:12,color:'#20476f'};
const head={padding:9,background:'#eaf2ff',borderBottom:'1px solid #d1deed',position:'sticky',top:0,textAlign:'left',whiteSpace:'nowrap',color:'#204770'};
const cell={padding:'9px 10px',borderBottom:'1px solid #e6ecf3',whiteSpace:'nowrap'};
const count=x=>Number(x||0).toLocaleString('en-IN');
const kg=x=>Number(x||0).toLocaleString('en-IN',{maximumFractionDigits:3});
const date=x=>x?String(x).slice(0,10).split('-').reverse().join('/'):'—';
const monthName=x=>x?new Intl.DateTimeFormat('en-IN',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(x+'-01T00:00:00Z')):'—';
const summaryColumns=['Shipments','Weight (kg)','Delivered','Active','Live Checked','Weight Unavailable'];
const sumRow=r=>[r.shipments,r.weight,r.delivered,r.active,r.checked,r.missingWeight];
const csvEscape=value=>{const s=String(value??'');return '"'+(/^[=+\-@\t\r]/.test(s)?"'"+s:s).replace(/"/g,'""')+'"';};
const csvDownload=(rows,filename)=>{
 const csv='\uFEFF'+rows.map(row=>row.map(csvEscape).join(',')).join('\r\n');
 const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
 const a=document.createElement('a');a.href=url;a.download=filename+'.csv';document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
};
const details=rows=>[['Booking Date','JEPO AWB','JEPO Progress','Progress Date/Time','Tracking Status','Forwarded AWB','Service','Vendor','Partner','Destination','Weight (kg)','Consignee','Delivered Date','Last Checked'],
 ...rows.map(r=>[r.bookingDate||'',r.awb||'',r.liveRemarks||'',r.liveEventWhen||'',jepoTrackingStatusLabel(r),r.carrierAwb||'',r.service||'',r.vendor||'',jepoMonthlyPartner(r),r.destination||'',r.weight??'',r.consignee||'',r.deliveredOn||'',r.checkedAt||''])];
function Matrix({title,rows=[],keyName='label'}){
 return <section style={{...box,flex:'1 1 460px',minWidth:0}}>
  <h3 style={{fontSize:16,margin:'0 0 10px',color:'#20517d'}}>{title}</h3>
  <div style={{maxHeight:320,overflow:'auto'}}>
   <table style={{borderCollapse:'collapse',minWidth:610,width:'100%',fontSize:12}}>
    <thead><tr>{['Group',...summaryColumns].map(h=><th key={h} style={head}>{h}</th>)}</tr></thead>
    <tbody>{rows.map((r,i)=><tr key={r[keyName]||i}>
     {[r[keyName],count(r.shipments),kg(r.weight),count(r.delivered),count(r.active),count(r.checked),count(r.missingWeight)].map((v,j)=><td key={j} style={{...cell,fontWeight:j===0?800:400}}>{v}</td>)}
    </tr>)}
    {!rows.length&&<tr><td colSpan={7} style={cell}>No matching records</td></tr>}
    </tbody>
   </table>
  </div>
 </section>;
}
export default function JEPOMonthlyDashboard({records=[]}){
 const months=useMemo(()=>availableJepoMonths(records),[records]);
 const [selectedMonth,setSelectedMonth]=useState('');
 const [partner,setPartner]=useState('ALL');
 const [busy,setBusy]=useState(false);
 const month=selectedMonth||months[0]||'';
 const report=useMemo(()=>aggregateJepoMonthly(records,{month,partner}),[records,month,partner]);
 const all=useMemo(()=>aggregateJepoMonthly(records),[records]);
 const partners=all.byPartner.map(p=>p.label);
 const history=all.history.filter(r=>partner==='ALL'||r.partner===partner);
 const historyRows=[['Booking Month','Partner',...summaryColumns],...history.map(r=>[r.month,r.partner,...sumRow(r)])];
 const monthRows=[['Booking Date',...summaryColumns],...report.byDay.map(r=>[r.date,...sumRow(r)])];
 const detailRows=details(report.selectedRows);
 const name='jepo-monthly-'+(month||'all')+(partner==='ALL'?'':'-'+partner.toLowerCase().replace(/[^a-z0-9]+/g,'-'));
 async function downloadExcel(){
  if(busy)return;setBusy(true);
  try{
   const ExcelJS=(await import('exceljs')).default;
   const wb=new ExcelJS.Workbook();
   for(const [title,rows] of [['Month Partner History',historyRows],['Day by Day',monthRows],
    ['Partner Summary',[['Partner',...summaryColumns],...report.byPartner.map(r=>[r.label,...sumRow(r)])]],
    ['Country Summary',[['Destination',...summaryColumns],...report.byCountry.map(r=>[r.label,...sumRow(r)])]],
    ['Service Summary',[['Service',...summaryColumns],...report.byService.map(r=>[r.label,...sumRow(r)])]],
    ['AWB Details',detailRows]]){
    const ws=wb.addWorksheet(title);
    ws.columns=rows[0].map((h,i)=>({header:h,key:'f'+i,width:/Progress|Consignee|Destination|Status/.test(h)?29:Math.min(25,Math.max(14,h.length+2))}));
    rows.slice(1).forEach(r=>ws.addRow(r));
    ws.views=[{state:'frozen',xSplit:Math.min(2,rows[0].length),ySplit:1}];
    ws.getRow(1).height=36;
    ws.getRow(1).eachCell(c=>{c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF18549A'}};c.font={color:{argb:'FFFFFFFF'},bold:true};c.alignment={wrapText:true}});
    if(rows.length>1)ws.autoFilter={from:{row:1,column:1},to:{row:rows.length,column:rows[0].length}};
   }
   const buffer=await wb.xlsx.writeBuffer();
   const url=URL.createObjectURL(new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
   const a=document.createElement('a');a.href=url;a.download=name+'.xlsx';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(err){alert('JEPO monthly Excel unavailable: '+(err?.message||err));}finally{setBusy(false);}
 }
 return <section aria-label="JEPO Tracking Monthly Data">
  <div style={{...box,display:'flex',flexWrap:'wrap',gap:12,alignItems:'end',justifyContent:'space-between'}}>
   <div><h2 style={{fontSize:21,color:'#20517d',margin:'0 0 6px'}}>JEPO Tracking — Monthly Data</h2>
    <p style={{fontSize:12,color:'#63748a',margin:0}}>Booking Date month • All saved AWBs • Delivered + Active • FedEx classified from SERVICE; TPL / Overseas from VENDOR</p>
   </div>
   <div style={{display:'flex',flexWrap:'wrap',gap:8,alignItems:'end'}}>
    <label style={{fontSize:12,fontWeight:800}}>Month
     <select aria-label="JEPO monthly booking month" value={month} onChange={e=>setSelectedMonth(e.target.value)} style={{...input,display:'block',marginTop:4}}>
      {months.map(m=><option key={m} value={m}>{monthName(m)}</option>)}
      {!months.length&&<option value="">No saved months</option>}
     </select>
    </label>
    <label style={{fontSize:12,fontWeight:800}}>Partner / Courier
     <select aria-label="JEPO monthly partner filter" value={partner} onChange={e=>setPartner(e.target.value)} style={{...input,display:'block',marginTop:4,maxWidth:210}}>
      <option value="ALL">All Partners</option>{partners.map(p=><option key={p} value={p}>{p}</option>)}
     </select>
    </label>
    <button type="button" style={{...input,cursor:'pointer',fontWeight:800,background:'#eaf1ff'}} disabled={!report.selectedRows.length} onClick={()=>csvDownload(detailRows,name+'-awb-details')}>Download CSV</button>
    <button type="button" style={{...input,cursor:'pointer',fontWeight:800,background:'#eaf1ff'}} disabled={busy||!report.selectedRows.length} onClick={()=>void downloadExcel()}>{busy?'Preparing…':'Download Excel'}</button>
   </div>
  </div>
  <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))',gap:10}}>
   {[['Total AWBs',count(report.grand.shipments)],['Chargeable Load',kg(report.grand.weight)+' kg'],['Delivered',count(report.grand.delivered)],['Active / Pending',count(report.grand.active)],['Live Checked',count(report.grand.checked)],['Missing Weight',count(report.grand.missingWeight)]].map(([label,value])=><div key={label} style={box}>
    <div style={{fontSize:12,color:'#63748a',fontWeight:750}}>{label}</div><strong style={{display:'block',fontSize:19,color:'#20517d',marginTop:5}}>{value}</strong>
   </div>)}
  </div>
  <div style={{display:'flex',gap:12,flexWrap:'wrap'}}>
   <Matrix title="Partner / Courier-wise" rows={report.byPartner}/>
   <Matrix title="Destination / Country-wise" rows={report.byCountry}/>
   <Matrix title="Service-wise" rows={report.byService}/>
  </div>
  <section style={box}>
   <h3 style={{fontSize:16,color:'#20517d',margin:'0 0 9px'}}>Month-by-month Partner History</h3>
   <div style={{maxHeight:390,overflow:'auto'}}>
    <table style={{borderCollapse:'collapse',minWidth:790,width:'100%',fontSize:12}}>
     <thead><tr>{['Month','Partner',...summaryColumns].map(h=><th key={h} style={head}>{h}</th>)}</tr></thead>
     <tbody>{history.map(r=><tr key={r.month+'|'+r.partner}>
      {[monthName(r.month),r.partner,count(r.shipments),kg(r.weight),count(r.delivered),count(r.active),count(r.checked),count(r.missingWeight)].map((v,i)=><td key={i} style={cell}>{v}</td>)}
     </tr>)}</tbody>
    </table>
   </div>
  </section>
  <section style={box}>
   <h3 style={{fontSize:16,color:'#20517d',margin:'0 0 9px'}}>{monthName(month)} • Daily Booking Breakdown</h3>
   <div style={{maxHeight:350,overflow:'auto'}}><table style={{borderCollapse:'collapse',minWidth:680,width:'100%',fontSize:12}}>
    <thead><tr>{['Date',...summaryColumns].map(h=><th key={h} style={head}>{h}</th>)}</tr></thead>
    <tbody>{report.byDay.map(r=><tr key={r.date}>
     {[date(r.date),count(r.shipments),kg(r.weight),count(r.delivered),count(r.active),count(r.checked),count(r.missingWeight)].map((v,i)=><td key={i} style={cell}>{v}</td>)}
    </tr>)}</tbody>
   </table></div>
  </section>
  <section style={box}>
   <h3 style={{fontSize:16,color:'#20517d',margin:'0 0 9px'}}>{monthName(month)} • AWB Details ({report.selectedRows.length})</h3>
   <div style={{maxHeight:520,overflow:'auto'}}><table style={{borderCollapse:'collapse',minWidth:1000,width:'100%',fontSize:12}}>
    <thead><tr>{['Booking Date','AWB','JEPO Progress','Progress Date/Time','Status','Partner','Destination','Weight','Forwarded AWB'].map(h=><th key={h} style={head}>{h}</th>)}</tr></thead>
    <tbody>{report.selectedRows.map(r=><tr key={r.awb}>
     {[date(r.bookingDate),r.awb,r.liveRemarks||'Not verified',r.liveEventWhen||'—',jepoTrackingStatusLabel(r),jepoMonthlyPartner(r),r.destination||'—',r.weight===null?'—':kg(r.weight)+' kg',r.carrierAwb||'—'].map((v,i)=><td key={i} style={{...cell,whiteSpace:i===2?'normal':'nowrap',maxWidth:i===2?280:undefined}}>{v}</td>)}
    </tr>)}
    {!report.selectedRows.length&&<tr><td colSpan={9} style={cell}>No saved AWBs for this month</td></tr>}
    </tbody>
   </table></div>
  </section>
  <p style={{fontSize:12,color:'#61758b',margin:'12px 2px'}}>Monthly totals use the originally saved Booking Date. JEPO verified tracking changes update delivery/status counts, but never move an AWB into another booking month.</p>
 </section>;
}
