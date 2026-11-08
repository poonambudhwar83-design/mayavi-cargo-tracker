'use client';
import {useMemo,useState} from 'react';
import {buildJepoFedexDailySummary,jepoFedexMonths,JEPO_FEDEX_COUNTRIES} from '../lib/jepoLoadSummary.js';

const formatCount=v=>Number(v||0).toLocaleString('en-IN');
const formatKg=v=>Number(v||0).toLocaleString('en-IN',{maximumFractionDigits:2});
const formatDate=v=>String(v||'').split('-').reverse().join('/')||'—';
const inputStyle={borderRadius:8,padding:'9px 11px',border:'1px solid #b9cadd',background:'#fff',color:'#193d67',fontSize:13};
function downloadFedex(rows,month){
 const headings=['Booking Date',...JEPO_FEDEX_COUNTRIES.flatMap(country=>[country+' kg',country+' Shipments']),'Total kg','Total Shipments'];
 const entries=[headings,...rows.map(row=>[
  row.date,...JEPO_FEDEX_COUNTRIES.flatMap(country=>[row.countries[country].kg.toFixed(2),row.countries[country].shipments]),
  row.kg.toFixed(2),row.shipments
 ])];
 const escape=value=>{
  const s=String(value??'');
  const safe=/^[=+\-@\t\r]/.test(s)?"'"+s:s;
  return '"'+safe.replace(/"/g,'""')+'"';
 };
 const csv='\uFEFF'+entries.map(line=>line.map(escape).join(',')).join('\r\n');
 const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
 const a=document.createElement('a');a.href=url;a.download='jepo_fedex_daily_load_'+(month||'all')+'.csv';
 document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
}
export default function JEPOFedexLoadSummary({records=[]}){
 const [month,setMonth]=useState('');
 const months=useMemo(()=>jepoFedexMonths(records),[records]);
 const report=useMemo(()=>buildJepoFedexDailySummary(records,{month}),[records,month]);
 return <section aria-label="JEPO FedEx Daily Load" style={{marginTop:25,borderTop:'2px solid #d7e4f4',paddingTop:16}}>
  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,flexWrap:'wrap',marginBottom:12}}>
   <div>
    <h2 style={{fontSize:19,margin:'0 0 5px',color:'#214f87'}}>FedEx — Daily Country-wise Load</h2>
    <p style={{fontSize:12,color:'#586d85',margin:0}}>Source: JEPO Excel SERVICE = FedEx / EX-DEL-FEDEX. Grouping: Booking Date and Chargeable Weight (kg). Vendor ICL is not counted as TPL or Overseas.</p>
   </div>
   <div style={{display:'flex',alignItems:'end',gap:9,flexWrap:'wrap'}}>
    <label style={{fontSize:12,fontWeight:750,color:'#37526d'}}>Booking Month
     <select aria-label="FedEx booking month" value={month} onChange={e=>setMonth(e.target.value)} style={{...inputStyle,display:'block',marginTop:4}}>
      <option value="">All Months</option>
      {months.map(m=><option key={m} value={m}>{m}</option>)}
     </select>
    </label>
    <button disabled={!report.rows.length} onClick={()=>downloadFedex(report.rows,month)} style={{...inputStyle,fontWeight:800,background:'#eaf2ff',cursor:report.rows.length?'pointer':'not-allowed'}}>Download FedEx CSV</button>
   </div>
  </div>
  <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))',gap:9,marginBottom:12}}>
   <div style={{padding:12,border:'1px solid #d7e4ef',borderRadius:10,background:'#f0f6ff'}}>
    <div style={{color:'#526e8a',fontSize:12,fontWeight:700}}>FedEx Total Load</div>
    <div style={{fontWeight:900,color:'#174a86',fontSize:22}}>{formatKg(report.kg)} kg</div>
    <div style={{fontSize:12,color:'#526e8a'}}>{formatCount(report.shipments)} shipments</div>
   </div>
   {JEPO_FEDEX_COUNTRIES.map(country=><div key={country} style={{padding:12,border:'1px solid #d7e4ef',borderRadius:10,background:'#fff'}}>
    <div style={{fontSize:12,color:'#526e8a',fontWeight:700}}>{country}</div>
    <div style={{fontWeight:900,fontSize:19,color:'#174a86'}}>{formatKg(report.totals[country].kg)} kg</div>
    <div style={{fontSize:12,color:'#526e8a'}}>{formatCount(report.totals[country].shipments)} shipments</div>
   </div>)}
  </div>
  <div style={{overflowX:'auto',maxHeight:520,border:'1px solid #d8e5f1',borderRadius:10}}>
   <table style={{borderCollapse:'separate',borderSpacing:0,width:'100%',fontSize:12,minWidth:890}}>
    <thead><tr>{['Booking Date',...JEPO_FEDEX_COUNTRIES,'Total Load','Total Shipments'].map(title=>
     <th key={title} style={{textAlign:'left',background:'#e8f1ff',color:'#23476f',position:'sticky',top:0,zIndex:1,padding:'12px 9px',borderBottom:'1px solid #cfdeef'}}>{title}</th>)}</tr></thead>
    <tbody>
     {report.rows.map((row,index)=><tr key={row.date} style={{background:index%2?'#f5f9ff':'#fff'}}>
      <td style={{padding:10,borderBottom:'1px solid #e6edf5',fontWeight:800,whiteSpace:'nowrap'}}>{formatDate(row.date)}</td>
      {JEPO_FEDEX_COUNTRIES.map(country=><td key={country} style={{padding:10,borderBottom:'1px solid #e6edf5'}}>
       <b style={{whiteSpace:'nowrap'}}>{formatKg(row.countries[country].kg)} kg</b>
       <div style={{fontSize:11,color:'#6b7c90',whiteSpace:'nowrap'}}>{row.countries[country].shipments} shipments</div>
      </td>)}
      <td style={{padding:10,borderBottom:'1px solid #e6edf5',fontWeight:900,color:'#174a86',whiteSpace:'nowrap'}}>{formatKg(row.kg)} kg</td>
      <td style={{padding:10,borderBottom:'1px solid #e6edf5',fontWeight:900}}>{formatCount(row.shipments)}</td>
     </tr>)}
     {!report.rows.length&&<tr><td colSpan={JEPO_FEDEX_COUNTRIES.length+3} style={{padding:24,textAlign:'center',color:'#637891'}}>No FedEx shipments for selected month.</td></tr>}
    </tbody>
   </table>
  </div>
  <p style={{fontSize:12,color:'#62758d',marginTop:9}}>Other Countries ensures the FedEx grand total includes all booked destinations; each saved AWB is counted once.
   {report.missingBookingDates>0?' Missing Booking Dates: '+report.missingBookingDates+'.':''}
   {report.missingWeights>0?' Missing Weight: '+report.missingWeights+' shipments.':''}
  </p>
 </section>;
}
