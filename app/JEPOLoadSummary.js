'use client';
import {useMemo,useState} from 'react';
import {buildJepoLoadSummary,jepoLoadAvailableMonths,JEPO_LOAD_COUNTRIES,JEPO_LOAD_VENDORS} from '../lib/jepoLoadSummary.js';

const formatKg=value=>Number(value||0).toLocaleString('en-IN',{maximumFractionDigits:2});
const formatCount=value=>Number(value||0).toLocaleString('en-IN');
const dateLabel=value=>{
 if(!value)return'—';
 const [year,month,date]=value.split('-');
 return date+'/'+month+'/'+year;
};
const csvSafe=value=>{
 const s=String(value??'');
 const guard=/^[=+\-@\t\r]/.test(s)?"'"+s:s;
 return '"'+guard.replace(/"/g,'""')+'"';
};
const fieldStyle={padding:'9px 11px',border:'1px solid #c4d2e3',borderRadius:8,background:'#fff',fontSize:13,color:'#17365d'};
const panel={background:'#fff',border:'1px solid #d9e3ee',padding:14,borderRadius:12};
function downloadSummary(rows,period,month,vendor){
 const headers=[period==='weekly'?'Week Start':'Booking Date','Week End','Vendor'];
 for(const country of JEPO_LOAD_COUNTRIES)headers.push(country+' Load (kg)',country+' Shipments');
 headers.push('Total Load (kg)','Total Shipments','Unknown Weight Shipments');
 const content=[headers];
 for(const row of rows){
  const line=[row.periodStart,row.periodEnd,row.vendor];
  for(const country of JEPO_LOAD_COUNTRIES)line.push(row.countries[country].kg.toFixed(2),row.countries[country].shipments);
  line.push(row.kg.toFixed(2),row.shipments,row.missingWeights);
  content.push(line);
 }
 const text='\uFEFF'+content.map(row=>row.map(csvSafe).join(',')).join('\r\n');
 const url=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'}));
 const a=document.createElement('a');
 a.href=url;a.download='jepo_'+period+'_load_'+(vendor==='ALL'?'all':vendor.toLowerCase())+'_'+(month||'all')+'.csv';
 document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
}
export default function JEPOLoadSummary({records=[],period='daily'}){
 const [vendor,setVendor]=useState('ALL');
 const [month,setMonth]=useState('');
 const months=useMemo(()=>jepoLoadAvailableMonths(records),[records]);
 const summary=useMemo(()=>buildJepoLoadSummary(records,{period,vendor,month}),[records,period,vendor,month]);
 const isWeekly=period==='weekly';
 return <section aria-label={isWeekly?'JEPO Weekly Load Summary':'JEPO Daily Load Summary'}>
  <div style={{display:'flex',flexWrap:'wrap',gap:12,alignItems:'center',justifyContent:'space-between',margin:'14px 0'}}>
   <div>
    <h2 style={{fontSize:20,margin:'0 0 5px',color:'#1d446e'}}>{isWeekly?'Weekly Load Summary':'Daily Load Summary'}</h2>
    <p style={{margin:0,fontSize:12,color:'#586d85'}}>
     TPL / Overseas / FedEx / DHL / Aramex ka country-wise booked load •
     Date source: JEPO Excel Booking Date • Weight: Chargeable Weight (kg)
     {isWeekly?' • Monday–Sunday weeks':''}
    </p>
   </div>
   <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
    <label style={{fontSize:12,fontWeight:750}}>Vendor
     <select aria-label="Load vendor" value={vendor} onChange={e=>setVendor(e.target.value)} style={{...fieldStyle,display:'block',marginTop:4}}>
      <option value="ALL">All Vendors</option>
      {JEPO_LOAD_VENDORS.map(v=><option key={v} value={v}>{v}</option>)}
     </select>
    </label>
    <label style={{fontSize:12,fontWeight:750}}>Booking Month
     <select aria-label="Load booking month" value={month} onChange={e=>setMonth(e.target.value)} style={{...fieldStyle,display:'block',marginTop:4}}>
      <option value="">All Months</option>
      {months.map(m=><option key={m} value={m}>{m}</option>)}
     </select>
    </label>
    <button disabled={!summary.rows.length} onClick={()=>downloadSummary(summary.rows,period,month,vendor)}
     style={{...fieldStyle,cursor:summary.rows.length?'pointer':'not-allowed',fontWeight:800,background:'#eaf2ff',alignSelf:'end'}}>Download CSV</button>
   </div>
  </div>
  <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(165px,1fr))',gap:10,marginBottom:12}}>
   <div style={panel}>
    <div style={{color:'#5b708b',fontSize:12,fontWeight:750}}>Total Load</div>
    <div style={{fontSize:23,fontWeight:900,color:'#184777'}}>{formatKg(summary.kg)} <small style={{fontSize:13}}>kg</small></div>
   </div>
   <div style={panel}>
    <div style={{color:'#5b708b',fontSize:12,fontWeight:750}}>Total Shipments</div>
    <div style={{fontSize:23,fontWeight:900,color:'#184777'}}>{formatCount(summary.shipments)}</div>
   </div>
   {summary.vendorTotals.map(item=><div key={item.vendor} style={panel}>
    <div style={{color:'#5b708b',fontSize:12,fontWeight:750}}>{item.vendor} Load</div>
    <div style={{fontSize:23,fontWeight:900,color:'#184777'}}>{formatKg(item.kg)} <small style={{fontSize:13}}>kg</small></div>
    <div style={{fontSize:12,color:'#5b708b'}}>{formatCount(item.shipments)} shipments</div>
   </div>)}
  </div>
  <div style={{overflowX:'auto',border:'1px solid #d9e5f1',borderRadius:12,maxHeight:600,background:'#fff'}}>
   <table style={{width:'100%',borderCollapse:'separate',borderSpacing:0,fontSize:12,minWidth:780}}>
    <thead><tr>
     {[isWeekly?'Week (Mon–Sun)':'Booking Date','Vendor',...JEPO_LOAD_COUNTRIES,'Total Load','Total Shipments'].map(label=>
      <th key={label} style={{padding:'12px 9px',textAlign:'left',background:'#e8f1ff',color:'#23476f',borderBottom:'1px solid #cfdeef',position:'sticky',top:0,zIndex:1}}>{label}</th>)}
    </tr></thead>
    <tbody>
     {summary.rows.map((r,index)=><tr key={r.periodStart+'|'+r.vendor} style={{background:index%2?'#f5f9ff':'#fff'}}>
      <td style={{padding:10,whiteSpace:'nowrap',borderBottom:'1px solid #e4ebf3',fontWeight:700}}>
       {dateLabel(r.periodStart)}{isWeekly?<span style={{display:'block',fontSize:11,color:'#708399',fontWeight:500}}>to {dateLabel(r.periodEnd)}</span>:null}
      </td>
      <td style={{padding:10,borderBottom:'1px solid #e4ebf3',fontWeight:800,color:['TPL','FedEx','DHL'].includes(r.vendor)?'#1f5090':'#78439e'}}>{r.vendor}</td>
      {JEPO_LOAD_COUNTRIES.map(country=><td key={country} style={{padding:10,borderBottom:'1px solid #e4ebf3'}}>
       <b style={{whiteSpace:'nowrap'}}>{formatKg(r.countries[country].kg)} kg</b>
       <div style={{fontSize:11,color:'#708399',whiteSpace:'nowrap'}}>{r.countries[country].shipments} shipments</div>
      </td>)}
      <td style={{padding:10,borderBottom:'1px solid #e4ebf3',fontWeight:900,whiteSpace:'nowrap',color:'#174d83'}}>{formatKg(r.kg)} kg</td>
      <td style={{padding:10,borderBottom:'1px solid #e4ebf3',fontWeight:800}}>{formatCount(r.shipments)}</td>
     </tr>)}
     {!summary.rows.length&&<tr><td colSpan={JEPO_LOAD_COUNTRIES.length+4} style={{padding:24,textAlign:'center',color:'#6a7e96'}}>
      No shipments for this vendor in the selected period. Vendors without loads are hidden.
     </td></tr>}
    </tbody>
   </table>
  </div>
  <div style={{display:'flex',flexWrap:'wrap',gap:10,margin:'10px 0',color:'#566a83',fontSize:12}}>
   <span>One saved AWB = one shipment; repeated uploads are not counted twice. Vendors without shipments on a day or week are omitted automatically.</span>
   {summary.missingBookingDates>0&&<strong style={{color:'#9a3412'}}>Missing Booking Dates: {summary.missingBookingDates}</strong>}
   {summary.missingWeights>0&&<strong style={{color:'#9a3412'}}>Missing chargeable weight: {summary.missingWeights} shipments (counted as shipments, kg excluded)</strong>}
   {isWeekly&&month&&<span>Month filter includes only bookings in {month}; weeks crossing month boundaries may be partial.</span>}
  </div>
 </section>;
}
