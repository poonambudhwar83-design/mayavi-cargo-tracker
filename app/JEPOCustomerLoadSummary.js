'use client';
import {useMemo,useState} from 'react';
import {jepoCustomerPeriodSummary,jepoTopCustomers,jepoCustomerAvailableMonths} from '../lib/jepoCustomerLoadSummary.js';

const panel={border:'1px solid #d6e3f1',borderRadius:14,background:'#fff',padding:16};
const button={padding:'8px 12px',border:'1px solid #cadbea',borderRadius:9,fontWeight:800,cursor:'pointer',fontSize:12,color:'#1b4b82',background:'#eaf3ff'};
const input={padding:'8px 10px',border:'1px solid #c5d6e9',borderRadius:8,fontSize:13,color:'#183b64',background:'#fff'};
const header={position:'sticky',top:0,zIndex:1,textAlign:'left',padding:'11px 12px',borderBottom:'2px solid #c0d5eb',background:'#e7f1ff',color:'#204c79',fontSize:12,whiteSpace:'nowrap'};
const cell={padding:'10px 12px',borderBottom:'1px solid #e6edf5',fontSize:12,color:'#284563'};
const weight=v=>Number(v||0).toLocaleString('en-IN',{maximumFractionDigits:3});
const count=v=>Number(v||0).toLocaleString('en-IN');
const date=v=>v?String(v).slice(0,10).split('-').reverse().join('/'):'—';
const formatPeriod=(r,p)=>p==='monthly'?r.periodStart.slice(0,7):p==='weekly'?date(r.periodStart)+' – '+date(r.periodEnd):date(r.periodStart);
const escapeCsv=v=>{const t=String(v??'');return '"'+(/^[=+@\-\t\r]/.test(t)?"'":'')+t.replace(/"/g,'""')+'"';};
const PERIODS=[{value:'daily',label:'Daily'},{value:'weekly',label:'Weekly'},{value:'monthly',label:'Monthly'}];
const topHeaders=['Rank','Customer Name','JP Code(s)','Shipments','Total Weight (kg)','Missing Weight Shipments'];
const periodHeaders=p=>[p==='daily'?'Booking Date':p==='weekly'?'Week (Monday – Sunday)':'Booking Month','JP Code','Customer Name','Total Shipments','Total Weight (kg)','Missing Weight Shipments'];
const topSheet=rows=>rows.map((row,i)=>[i+1,row.customerName,row.jpCodes.join(', '),row.shipments,row.kg,row.missingWeights]);
const periodSheet=(rows,p)=>rows.map(row=>[formatPeriod(row,p),row.jpCode,row.customerName||'Name not mapped',row.shipments,row.kg,row.missingWeights]);
function downloadCsv(headers,rows,filename){
 const csv='\uFEFF'+[headers,...rows].map(row=>row.map(escapeCsv).join(',')).join('\r\n');
 const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob);
 const a=document.createElement('a');a.href=url;a.download=filename+'.csv';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);
}
export default function JEPOCustomerLoadSummary({records=[]}){
 const [period,setPeriod]=useState('daily');
 const [month,setMonth]=useState(''),[search,setSearch]=useState(''),[showAll,setShowAll]=useState(false);
 const [downloading,setDownloading]=useState(false),[exportError,setExportError]=useState('');
 const months=useMemo(()=>jepoCustomerAvailableMonths(records),[records]);
 const validMonth=months.includes(month)?month:'';
 const summary=useMemo(()=>jepoCustomerPeriodSummary(records,{period,month:validMonth,search}),[records,period,validMonth,search]);
 const ranked=useMemo(()=>jepoTopCustomers(records,{month:validMonth,limit:20}),[records,validMonth]);
 const rowsShown=showAll?summary.rows:summary.rows.slice(0,180);
 function exportRows(type){
  const suffix=validMonth||'all_months';
  if(type==='TOP20')downloadCsv(topHeaders,topSheet(ranked.rows),'jepo_top_20_customers_'+suffix);
  else downloadCsv(periodHeaders(period),periodSheet(summary.rows,period),'jepo_jp_code_'+period+'_'+suffix);
 }
 async function downloadExcel(){
  setDownloading(true);setExportError('');
  try{
   const ExcelJS=(await import('exceljs')).default;
   const workbook=new ExcelJS.Workbook();
   const add=(name,headers,rows)=>{
    const sheet=workbook.addWorksheet(name);
    sheet.columns=headers.map((h,i)=>({header:h,key:'c'+i,
     width:/Customer Name/.test(h)?38:/JP Code/.test(h)?24:/Week/.test(h)?30:Math.max(16,Math.min(29,h.length+3))}));
    for(const row of rows)sheet.addRow(row);
    sheet.views=[{state:'frozen',ySplit:1,xSplit:1}];
    sheet.getRow(1).height=35;
    sheet.getRow(1).eachCell(c=>{c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF1C5289'}};c.font={bold:true,color:{argb:'FFFFFFFF'}};c.alignment={wrapText:true,vertical:'middle'};});
    for(let n=2;n<=sheet.rowCount;n++){
     const row=sheet.getRow(n);
     if(n%2===0)row.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF2F7FF'}};
    }
    sheet.autoFilter={from:{row:1,column:1},to:{row:Math.max(1,sheet.rowCount),column:headers.length}};
    const column=headers.findIndex(x=>x==='Total Weight (kg)');
    if(column>=0)sheet.getColumn(column+1).numFmt='#,##0.000';
   };
   add('JP Code '+period[0].toUpperCase()+period.slice(1),periodHeaders(period),periodSheet(summary.rows,period));
   add('Top 20 Customers',topHeaders,topSheet(ranked.rows));
   const buffer=await workbook.xlsx.writeBuffer();
   const url=URL.createObjectURL(new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
   const a=document.createElement('a');a.href=url;a.download='jepo_customer_load_'+period+'_'+(validMonth||'all_months')+'.xlsx';
   document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);
  }catch(e){setExportError('Excel download failed: '+(e?.message||'Please try again.'));}
  finally{setDownloading(false);}
 }
 return <section aria-label="JEPO JP Code Customer Load Summary" style={{padding:'14px 0',color:'#193f68'}}>
  <div style={{...panel,background:'linear-gradient(115deg,#e9f4ff,#f8fbff)',marginBottom:14,borderColor:'#c4dced'}}>
   <div style={{display:'flex',gap:12,flexWrap:'wrap',justifyContent:'space-between',alignItems:'end'}}>
    <div><small style={{fontSize:11,color:'#315e93',fontWeight:900,letterSpacing:1}}>CUSTOMER-WISE REPORT</small>
     <h2 style={{fontSize:22,margin:'5px 0'}}>JP Code • Daily / Weekly / Monthly Load</h2>
     <p style={{fontSize:12,color:'#56728e',margin:0}}>All services and both Active + Delivered included. Based on original Booking Date and Chargeable Weight, each AWB once.</p></div>
    <div style={{display:'flex',alignItems:'end',gap:9,flexWrap:'wrap'}}>
     <label style={{display:'grid',gap:4,fontSize:12,fontWeight:800,color:'#315477'}}>BOOKING MONTH
      <select aria-label="Customer summary booking month" style={input} value={validMonth} onChange={e=>{setMonth(e.target.value);setShowAll(false)}}>
       <option value="">All Months</option>{months.map(m=><option key={m} value={m}>{m}</option>)}
      </select>
     </label>
     <button type="button" style={button} disabled={downloading||(!summary.rows.length&&!ranked.rows.length)}
      onClick={()=>void downloadExcel()}>{downloading?'Preparing Excel…':'Download Excel (Both Reports)'}</button>
    </div>
   </div>
   {exportError&&<p role="alert" style={{color:'#b91c1c'}}>{exportError}</p>}
   <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(145px,1fr))',gap:10,marginTop:14}}>
    {[['Total Load',weight(ranked.allKg)+' kg'],['Total Shipments',count(ranked.allShipments)],
      ['Known Customers',count(ranked.rankedCustomerCount)],['Customer Name Pending',count(ranked.unmappedShipments)]].map(([label,value])=>
      <div key={label} style={{padding:'13px 14px',background:'#fff',border:'1px solid #d5e5f4',borderRadius:10}}>
       <small style={{display:'block',fontSize:11,fontWeight:800,color:'#65809a'}}>{label}</small>
       <strong style={{fontSize:19,display:'block',marginTop:5,color:'#164778'}}>{value}</strong>
      </div>)}
   </div>
  </div>
  <div style={{...panel,marginBottom:14}}>
   <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
    <div><h3 style={{fontSize:17,margin:'0 0 5px'}}>Top 20 Customers by Total Load</h3>
     <p style={{fontSize:12,margin:0,color:'#61758c'}}>Ranked by booked kg (highest first), then shipments. Same customer across several JP Codes is combined.</p></div>
    <button style={button} type="button" disabled={!ranked.rows.length} onClick={()=>exportRows('TOP20')}>Download Top 20 CSV</button>
   </div>
   <div style={{overflowX:'auto',maxHeight:485,border:'1px solid #e0e8f2',borderRadius:9}}>
    <table style={{borderCollapse:'collapse',width:'100%',minWidth:760,fontVariantNumeric:'tabular-nums'}}>
     <thead><tr>{['Rank','Customer Name','JP Codes','Total Shipments','Total Load (kg)'].map(h=><th key={h} style={header}>{h}</th>)}</tr></thead>
     <tbody>{ranked.rows.map((r,i)=><tr key={r.customerName} style={{background:i%2===0?'#fff':'#f8fbff'}}>
      <td style={{...cell,fontWeight:900,color:i<3?'#145d99':'#56718d'}}>{i+1}</td>
      <td style={{...cell,fontWeight:850,color:'#174b7b'}}>{r.customerName}</td>
      <td style={{...cell,maxWidth:330,whiteSpace:'normal',lineHeight:1.5}}>{r.jpCodes.join(' · ')||'—'}</td>
      <td style={cell}><strong>{count(r.shipments)}</strong></td>
      <td style={{...cell,fontWeight:900,color:'#146b87',whiteSpace:'nowrap'}}>{weight(r.kg)} kg</td>
     </tr>)}
     {!ranked.rows.length&&<tr><td colSpan={5} style={{...cell,textAlign:'center',padding:22}}>No customer names mapped in this period.</td></tr>}</tbody>
    </table>
   </div>
   {ranked.unmappedShipments>0&&<p style={{margin:'9px 0 0',fontSize:12,color:'#9b642e'}}>Customer names for {count(ranked.unmappedShipments)} booked shipments are not mapped; these are included in totals and JP Code reporting, but excluded from the named Top 20 ranking.</p>}
  </div>
  <div style={panel}>
   <div style={{display:'flex',gap:11,alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',marginBottom:13}}>
    <div><h3 style={{fontSize:18,margin:'0 0 5px'}}>JP Code-wise Load Breakdown</h3>
     <p style={{fontSize:12,margin:0,color:'#637b96'}}>Every JP Code's number of shipments and kg, grouped by Booking Date.</p></div>
    <div style={{display:'flex',gap:6,flexWrap:'wrap'}} role="group" aria-label="JP Code summary period">
     {PERIODS.map(p=><button type="button" key={p.value} onClick={()=>{setPeriod(p.value);setShowAll(false)}} style={{...button,
      background:p.value===period?'#1b5d9e':'#eaf3ff',color:p.value===period?'#fff':'#245889',borderColor:p.value===period?'#1b5d9e':'#c9dced'}}>{p.label}</button>)}
    </div>
   </div>
   <div style={{display:'flex',alignItems:'end',flexWrap:'wrap',gap:9,marginBottom:10}}>
    <label style={{fontSize:12,fontWeight:800,color:'#3d5d7d',flex:'1 1 210px'}}>SEARCH JP CODE / CUSTOMER
     <input type="search" aria-label="Search JP Code or Customer Name" value={search} onChange={e=>{setSearch(e.target.value);setShowAll(false)}}
      placeholder="e.g. JP2001 or Mahadev" style={{...input,display:'block',marginTop:5,width:'100%',maxWidth:410}}/>
    </label>
    <button type="button" style={button} disabled={!summary.rows.length} onClick={()=>exportRows('PERIOD')}>Download {period[0].toUpperCase()+period.slice(1)} CSV</button>
    <button type="button" style={button} disabled={!search} onClick={()=>{setSearch('');setShowAll(false)}}>Clear Search</button>
   </div>
   <div style={{display:'flex',flexWrap:'wrap',gap:12,fontSize:12,color:'#587490',margin:'0 0 12px'}}>
    <span><b>{count(summary.shipments)}</b> shipments</span><span><b>{weight(summary.kg)}</b> kg</span>
    <span><b>{count(summary.rows.length)}</b> JP Code/period rows</span>
    {summary.missingWeights>0&&<span style={{color:'#9b5617'}}>{count(summary.missingWeights)} shipments missing weight</span>}
   </div>
   <div style={{overflow:'auto',maxHeight:550,border:'1px solid #e1eaf3',borderRadius:10}}>
    <table style={{minWidth:830,width:'100%',borderCollapse:'collapse',fontVariantNumeric:'tabular-nums'}}>
     <thead><tr>{periodHeaders(period).map(h=><th key={h} style={header}>{h}</th>)}</tr></thead>
     <tbody>{rowsShown.map((r,i)=><tr key={r.periodStart+'|'+r.jpCode} style={{background:i%2?'#f7faff':'#fff'}}>
      <td style={{...cell,fontWeight:800,whiteSpace:'nowrap'}}>{formatPeriod(r,period)}</td>
      <td style={{...cell,fontWeight:850,color:'#164c84'}}>{r.jpCode}</td>
      <td style={{...cell,color:r.customerName?'#274966':'#a0621e',fontWeight:r.customerName?700:500}}>{r.customerName||'Name not mapped'}</td>
      <td style={{...cell,fontWeight:800}}>{count(r.shipments)}</td>
      <td style={{...cell,fontWeight:900,color:'#155e82'}}>{weight(r.kg)} kg</td>
      <td style={cell}>{r.missingWeights||'—'}</td>
     </tr>)}
     {!rowsShown.length&&<tr><td colSpan={6} style={{...cell,textAlign:'center',padding:22}}>No JP Code loads for these filters.</td></tr>}
     </tbody>
    </table>
   </div>
   {!showAll&&summary.rows.length>rowsShown.length&&<div style={{marginTop:12,display:'flex',gap:12,alignItems:'center',justifyContent:'center',flexWrap:'wrap'}}>
    <small style={{color:'#64748b'}}>Showing {rowsShown.length} of {summary.rows.length} rows. Download includes all.</small>
    <button type="button" style={button} onClick={()=>setShowAll(true)}>Show All Rows</button>
   </div>}
   <p style={{fontSize:11,color:'#61758e'}}>Weekly periods are Monday–Sunday. A month filter includes only bookings inside that month; boundary weeks may be partial. Unmapped customer names are shown as such, never guessed.</p>
  </div>
 </section>;
}
