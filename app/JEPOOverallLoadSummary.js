'use client';
import {useMemo,useState} from 'react';
import {
 JEPO_OVERALL_LOAD_GROUPS,buildJepoOverallLoadSummary,jepoOverallLoadMonths
} from '../lib/jepoLoadSummary.js';

const kg=v=>Number(v||0).toLocaleString('en-IN',{maximumFractionDigits:2});
const count=v=>Number(v||0).toLocaleString('en-IN');
const date=v=>v?String(v).slice(0,10).split('-').reverse().join('/'):'—';
const csvSafe=v=>{
 const raw=String(v??''),safe=/^[=+\-@\t\r]/.test(raw)?"'"+raw:raw;
 return '"'+safe.replace(/"/g,'""')+'"';
};
const box={padding:'11px 13px',border:'1px solid #cbdced',borderRadius:9,background:'#fff'};
const input={padding:'9px 11px',background:'#fff',border:'1px solid #c6d5e5',borderRadius:8,color:'#24456a'};
function csvDownload(rows,period,month){
 const columns=[period==='daily'?'Booking Date':period==='weekly'?'Week Start':'Booking Month',
  ...(period==='weekly'?['Week End']:[]),
  ...JEPO_OVERALL_LOAD_GROUPS.map(v=>v+' (kg)'),'All Services Total (kg)','Total Packets','Missing Weight Packets'];
 const lines=[columns,...rows.map(row=>[
  period==='monthly'?row.periodStart.slice(0,7):row.periodStart,
  ...(period==='weekly'?[row.periodEnd]:[]),
  ...JEPO_OVERALL_LOAD_GROUPS.map(service=>row.byService[service].kg.toFixed(2)),
  row.kg.toFixed(2),row.shipments,row.missingWeights
 ])];
 const csv='\uFEFF'+lines.map(r=>r.map(csvSafe).join(',')).join('\r\n');
 const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob);
 const a=document.createElement('a');a.href=url;
 a.download='jepo_all_services_'+period+'_'+(month||'all_months')+'.csv';
 document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
}
export default function JEPOOverallLoadSummary({records=[],period='daily'}){
 const [month,setMonth]=useState('');
 const months=useMemo(()=>jepoOverallLoadMonths(records),[records]);
 const selectedMonth=months.includes(month)?month:'';
 const summary=useMemo(()=>buildJepoOverallLoadSummary(records,{period,month:selectedMonth}),
  [records,period,selectedMonth]);
 const label=period==='daily'?'Daily':period==='weekly'?'Weekly':'Monthly';
 return <section aria-label={'JEPO All Services '+label+' Total Load'}
  style={{border:'1px solid #b8d4e9',background:'#f1f8ff',borderRadius:12,padding:14,margin:'14px 0'}}>
  <div style={{display:'flex',flexWrap:'wrap',alignItems:'end',justifyContent:'space-between',gap:10}}>
   <div>
    <h2 style={{fontSize:19,margin:'0 0 5px',color:'#194777'}}>JEPO {label} • All Services Total Load</h2>
    <p style={{fontSize:12,margin:0,color:'#56708b'}}>
     All vendors and services included — TPL, Overseas, FedEx, DHL, Aramex and Others.
     Based on original Booking Date and saved Chargeable Weight; one AWB counted once.
     {period==='weekly'?' Weeks run Monday–Sunday.':''}
    </p>
   </div>
   <div style={{display:'flex',flexWrap:'wrap',alignItems:'end',gap:8}}>
    <label style={{fontSize:12,fontWeight:800,color:'#2d5074'}}>Booking Month
     <select aria-label={'All Services '+label+' booking month'} value={selectedMonth}
      onChange={e=>setMonth(e.target.value)} style={{...input,display:'block',marginTop:4}}>
      <option value="">All Months</option>
      {months.map(m=><option key={m} value={m}>{m}</option>)}
     </select>
    </label>
    <button type="button" disabled={!summary.rows.length}
     onClick={()=>csvDownload(summary.rows,period,selectedMonth)}
     style={{...input,cursor:summary.rows.length?'pointer':'not-allowed',background:'#dfeeff',fontWeight:800}}>Export All Services CSV</button>
   </div>
  </div>
  <div style={{display:'flex',gap:9,flexWrap:'wrap',margin:'12px 0'}}>
   <div style={{...box,flex:'1 1 170px',borderLeft:'4px solid #1d70bb'}}>
    <small style={{display:'block',fontWeight:800,color:'#5a7089'}}>JEPO TOTAL LOAD • ALL SERVICES</small>
    <strong style={{fontSize:24,color:'#14588e'}}>{kg(summary.kg)} kg</strong>
   </div>
   <div style={{...box,flex:'1 1 120px'}}>
    <small style={{display:'block',fontWeight:800,color:'#5a7089'}}>TOTAL PACKETS</small>
    <strong style={{fontSize:24,color:'#14588e'}}>{count(summary.shipments)}</strong>
   </div>
   <div style={{...box,flex:'1 1 130px'}}>
    <small style={{display:'block',fontWeight:800,color:'#5a7089'}}>BOOKING PERIODS</small>
    <strong style={{fontSize:24,color:'#14588e'}}>{count(summary.rows.length)}</strong>
   </div>
   {summary.missingWeights>0&&<div style={{...box,flex:'1 1 140px'}}>
    <small style={{display:'block',fontWeight:800,color:'#a24c20'}}>WEIGHT NOT PROVIDED</small>
    <strong style={{fontSize:24,color:'#a24c20'}}>{count(summary.missingWeights)}</strong>
   </div>}
  </div>
  <div style={{overflowX:'auto',maxHeight:510,border:'1px solid #c9dbea',borderRadius:10,background:'#fff'}}>
   <table style={{width:'100%',minWidth:950,fontSize:12,borderCollapse:'collapse',fontVariantNumeric:'tabular-nums'}}>
    <thead><tr>
     {[period==='daily'?'Booking Date':period==='weekly'?'Week (Mon–Sun)':'Booking Month',
       ...JEPO_OVERALL_LOAD_GROUPS,'All Services Total','Packets','Weight Missing'].map(h=>
       <th key={h} style={{position:'sticky',top:0,zIndex:1,padding:'10px 9px',textAlign:'left',whiteSpace:'nowrap',color:'#194876',background:'#ddecfc',borderBottom:'2px solid #b9d6ed'}}>{h}</th>)}
    </tr></thead>
    <tbody>{summary.rows.map((row,i)=><tr key={row.periodStart} style={{background:i%2?'#f6faff':'#fff'}}>
     <td style={{padding:10,borderBottom:'1px solid #e3edf6',whiteSpace:'nowrap',fontWeight:800,color:'#225c8d'}}>
      {period==='monthly'?row.periodStart.slice(0,7):date(row.periodStart)}
      {period==='weekly'&&<small style={{display:'block',marginTop:3,fontWeight:500}}>to {date(row.periodEnd)}</small>}
     </td>
     {JEPO_OVERALL_LOAD_GROUPS.map(group=><td key={group}
      style={{padding:10,borderBottom:'1px solid #e3edf6',whiteSpace:'nowrap'}}>
      <strong>{kg(row.byService[group].kg)}</strong><small style={{display:'block',fontSize:10,color:'#7a8da1'}}>{row.byService[group].shipments} packets</small>
     </td>)}
     <td style={{padding:10,borderBottom:'1px solid #c4dced',background:'#e7f4ff',color:'#155d91',fontWeight:900,whiteSpace:'nowrap'}}>{kg(row.kg)} kg</td>
     <td style={{padding:10,borderBottom:'1px solid #e3edf6',fontWeight:800}}>{count(row.shipments)}</td>
     <td style={{padding:10,borderBottom:'1px solid #e3edf6',color:row.missingWeights?'#a24c20':'#637b95'}}>{row.missingWeights||'—'}</td>
    </tr>)}
    {!summary.rows.length&&<tr><td colSpan={JEPO_OVERALL_LOAD_GROUPS.length+4} style={{padding:22,textAlign:'center'}}>No bookings with a valid Booking Date for the selected period.</td></tr>}
    </tbody>
   </table>
  </div>
  <p style={{margin:'8px 0 0',fontSize:11,color:'#5d7088'}}>
   Total includes all couriers, including unnamed/other services; zero-load dates are not shown.
   {summary.missingBookingDates>0?' '+summary.missingBookingDates+' packets have no valid Booking Date and cannot be assigned to a period.':''}
   {period==='weekly'&&selectedMonth?' The month filter counts only bookings within that month, even for boundary-crossing weeks.':''}
  </p>
 </section>;
}
