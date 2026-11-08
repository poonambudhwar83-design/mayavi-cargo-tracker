'use client';
import {useMemo,useState} from 'react';
import {availableJepoTatMonths,summarizeJepoTat} from '../lib/jepoTatSummary.js';
import {jepoMonthlyPartner} from '../lib/jepoMonthlySummary.js';
import {tatCountryGroup} from '../lib/branchTatSummary.js';

const panel={background:'#fff',border:'1px solid #dae5f1',borderRadius:12,padding:13,marginTop:13,minWidth:0};
const tableHead={padding:'9px 10px',background:'#eaf2ff',color:'#174874',fontSize:12,fontWeight:800,whiteSpace:'nowrap',borderBottom:'1px solid #d1deed',position:'sticky',top:0,textAlign:'left'};
const tableCell={padding:'9px 10px',borderBottom:'1px solid #e6ecf3',fontSize:12,whiteSpace:'nowrap',color:'#314761'};
const control={border:'1px solid #c3d1e3',borderRadius:8,padding:'9px 11px',background:'#fff',fontSize:12,color:'#173b66'};
const fmt=x=>Number(x||0).toLocaleString('en-IN');
const avg=x=>x===null?'—':Number(x).toFixed(1)+' days';
const days=x=>x===null?'—':x+' days';
const prettyMonth=m=>m?new Intl.DateTimeFormat('en-IN',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(m+'-01T00:00:00Z')):'All Months';
const prettyDate=v=>v?String(v).slice(0,10).split('-').reverse().join('/'):'—';
const headers=['Delivered','TAT Verified','Avg TAT','Fastest','Slowest','Missing Date','Invalid Date'];
const metrics=r=>[fmt(r.delivered),fmt(r.verified),avg(r.average),days(r.fastest),days(r.slowest),fmt(r.missingDate),fmt(r.invalidDate)];
const rowFor=r=>[r.delivered,r.verified,r.average??'',r.fastest??'',r.slowest??'',r.missingDate,r.invalidDate];
const csvSafe=value=>{const s=String(value??'');return '"'+(/^[=+\-@\t\r]/.test(s)?"'"+s:s).replace(/"/g,'""')+'"';};
function downloadCsv(data,name){
 const csv='\uFEFF'+data.map(row=>row.map(csvSafe).join(',')).join('\r\n');
 const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
 const a=document.createElement('a');a.href=url;a.download=name+'.csv';document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
}
function GroupTable({title,groupName='Partner',items=[],labelOf=r=>r.label}){
 return <section style={{...panel,flex:'1 1 550px'}}>
  <h3 style={{fontSize:16,margin:'0 0 10px',color:'#184873'}}>{title}</h3>
  <div style={{overflowX:'auto',maxHeight:450}}>
   <table style={{borderCollapse:'separate',borderSpacing:0,minWidth:850,width:'100%'}}><thead><tr>
    {[groupName,...headers].map(h=><th key={h} style={tableHead}>{h}</th>)}
   </tr></thead><tbody>
    {items.map((r,i)=><tr key={labelOf(r)+'|'+i}>
     {[labelOf(r),...metrics(r)].map((v,j)=><td key={j} style={{...tableCell,fontWeight:j===0||j===3?800:400,color:j===6&&r.missingDate?'#9a4a1f':tableCell.color}}>{v}</td>)}
    </tr>)}
    {!items.length&&<tr><td colSpan={8} style={tableCell}>No delivered shipments for selected filters.</td></tr>}
   </tbody></table>
  </div>
 </section>;
}
function PartnerCountryTable({rows=[]}){
 return <section style={panel}>
  <h3 style={{fontSize:16,color:'#184873',margin:'0 0 5px'}}>Courier × Country TAT</h3>
  <p style={{margin:'0 0 11px',fontSize:12,color:'#62748b'}}>FedEx, TPL, Overseas and other couriers • USA, UK, Canada, Australia and Other Countries • averages use only valid delivered dates</p>
  <div style={{overflowX:'auto',maxHeight:570}}>
   <table style={{borderCollapse:'separate',borderSpacing:0,minWidth:940,width:'100%'}}><thead><tr>
    {['Courier / Partner','Destination',...headers].map(h=><th key={h} style={tableHead}>{h}</th>)}
   </tr></thead><tbody>{rows.map(r=><tr key={r.partner+'|'+r.country}>
    {[r.partner,r.country,...metrics(r)].map((v,i)=><td key={i} style={{...tableCell,fontWeight:i<2?800:400,color:i===5?'#155080':tableCell.color}}>{v}</td>)}
   </tr>)}
   {!rows.length&&<tr><td colSpan={9} style={tableCell}>No courier-country data yet.</td></tr>}
   </tbody></table>
  </div>
 </section>;
}
const detailHeaders=['JEPO AWB','Booking Date','Delivery Date','TAT Days','Date Verification','Courier','Country','Service','JEPO Progress'];
const detailValues=r=>[r.awb,r.bookingDate||'',r.deliveredOn||'',r.tatDays??'',r.tatReason,r.partner,r.country,r.service||'',r.liveRemarks||''];
export default function JEPOTatDashboard({records=[]}){
 const months=useMemo(()=>availableJepoTatMonths(records),[records]);
 const [month,setMonth]=useState('');
 const [partner,setPartner]=useState('ALL');
 const [country,setCountry]=useState('ALL');
 const [detailFilter,setDetailFilter]=useState('NEEDS_REVIEW');
 const [busy,setBusy]=useState(false);
 const report=useMemo(()=>summarizeJepoTat(records,{month,partner,country}),[records,month,partner,country]);
 const partners=useMemo(()=>[...new Set(records.map(jepoMonthlyPartner))].sort(),[records]);
 const countries=['USA','UK','Canada','Australia','Other Countries'];
 const detail=report.deliveredRows.filter(r=>detailFilter==='ALL'||(detailFilter==='NEEDS_REVIEW'?r.tatDays===null:r.tatDays!==null));
 const filename='jepo-tat-'+(month||'all-months')+'-'+(partner==='ALL'?'all':partner.toLowerCase().replace(/[^a-z0-9]+/g,'-'));
 const partnerCsv=[['Courier',...headers],...report.byPartner.map(r=>[r.label,...rowFor(r)])];
 const matrixCsv=[['Courier','Destination',...headers],...report.byPartnerCountry.map(r=>[r.partner,r.country,...rowFor(r)])];
 const countryCsv=[['Country',...headers],...report.byCountry.map(r=>[r.label,...rowFor(r)])];
 const serviceCsv=[['Service',...headers],...report.byService.map(r=>[r.label,...rowFor(r)])];
 const awbCsv=[detailHeaders,...report.deliveredRows.map(detailValues)];
 async function excel(){
  if(busy)return;setBusy(true);
  try{
   const ExcelJS=(await import('exceljs')).default;
   const workbook=new ExcelJS.Workbook();
   const sheets=[['Courier Country TAT',matrixCsv],['Courier TAT',partnerCsv],['Country TAT',countryCsv],['Service TAT',serviceCsv],['Delivered AWB TAT',awbCsv]];
   for(const [title,records] of sheets){
    const ws=workbook.addWorksheet(title);
    ws.columns=records[0].map((h,i)=>({header:h,key:'field'+i,width:/Progress/.test(h)?37:/Courier|Country|Service|Verification/.test(h)?25:Math.min(22,Math.max(15,h.length+2))}));
    records.slice(1).forEach(record=>ws.addRow(record));
    ws.views=[{state:'frozen',ySplit:1,xSplit:Math.min(2,records[0].length)}];
    ws.getRow(1).height=36;ws.getRow(1).eachCell(c=>{c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF174A91'}};c.font={bold:true,color:{argb:'FFFFFFFF'}};c.alignment={vertical:'middle',wrapText:true}});
    if(records.length>1)ws.autoFilter={from:{row:1,column:1},to:{row:records.length,column:records[0].length}};
   }
   const file=await workbook.xlsx.writeBuffer();
   const url=URL.createObjectURL(new Blob([file],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
   const a=document.createElement('a');a.href=url;a.download=filename+'.xlsx';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(error){alert('TAT Excel download failed: '+(error?.message||error));}finally{setBusy(false);}
 }
 return <section aria-label="JEPO Delivery TAT Summary">
  <div style={{...panel,display:'flex',flexWrap:'wrap',justifyContent:'space-between',gap:12,alignItems:'end'}}>
   <div>
    <h2 style={{fontSize:20,color:'#184873',margin:'0 0 5px'}}>JEPO Delivery TAT — Verified Summary</h2>
    <p style={{fontSize:12,color:'#5d7187',margin:0}}>TAT = Booking Date to actual JEPO Delivery Date, including both days • No unverified delivery dates included</p>
   </div>
   <div style={{display:'flex',flexWrap:'wrap',gap:8,alignItems:'end'}}>
    <label style={{fontSize:12,fontWeight:750}}>Booking Month
     <select aria-label="TAT booking month" value={month} onChange={e=>setMonth(e.target.value)} style={{...control,display:'block',marginTop:4}}>
      <option value="">All Months</option>{months.map(m=><option key={m} value={m}>{prettyMonth(m)}</option>)}
     </select>
    </label>
    <label style={{fontSize:12,fontWeight:750}}>Courier / Partner
     <select aria-label="TAT courier partner" value={partner} onChange={e=>setPartner(e.target.value)} style={{...control,display:'block',marginTop:4,maxWidth:215}}>
      <option value="ALL">All Couriers</option>{partners.map(p=><option key={p} value={p}>{p}</option>)}
     </select>
    </label>
    <label style={{fontSize:12,fontWeight:750}}>Country
     <select aria-label="TAT country" value={country} onChange={e=>setCountry(e.target.value)} style={{...control,display:'block',marginTop:4}}>
      <option value="ALL">All Countries</option>{countries.map(c=><option key={c} value={c}>{c}</option>)}
     </select>
    </label>
    <button type="button" disabled={!report.overall.delivered} onClick={()=>downloadCsv(matrixCsv,filename+'-courier-country')} style={{...control,fontWeight:800,cursor:'pointer',background:'#eaf2ff'}}>Download CSV</button>
    <button type="button" disabled={busy||!report.overall.delivered} onClick={()=>void excel()} style={{...control,fontWeight:800,cursor:'pointer',background:'#eaf2ff'}}>{busy?'Preparing…':'Download Excel'}</button>
   </div>
  </div>
  <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(135px,1fr))',gap:9}}>
   {[
    ['Delivered AWBs',fmt(report.overall.delivered)],
    ['Verified TAT',fmt(report.overall.verified)],
    ['Average TAT',avg(report.overall.average)],
    ['Fastest',days(report.overall.fastest)],
    ['Slowest',days(report.overall.slowest)],
    ['Delivery Date Missing',fmt(report.overall.missingDate)],
    ['Invalid Date Order',fmt(report.overall.invalidDate)]
   ].map(([label,value])=><div key={label} style={panel}>
    <div style={{fontSize:12,fontWeight:750,color:'#63768c'}}>{label}</div>
    <strong style={{display:'block',fontSize:20,marginTop:6,color:label.includes('Missing')||label.includes('Invalid')?'#a44d22':'#1d4d7e'}}>{value}</strong>
   </div>)}
  </div>
  {(report.overall.missingDate>0||report.overall.invalidDate>0)&&<p style={{background:'#fff7ed',border:'1px solid #fed7aa',color:'#9a4d18',borderRadius:9,padding:11,fontSize:12,margin:'10px 0'}}>
   {report.overall.missingDate} delivered AWBs have no verified delivery date and {report.overall.invalidDate} have delivery dates before booking. Their TAT is excluded, not shown as zero. Use the review table below to see the exact AWBs.
  </p>}
  <PartnerCountryTable rows={report.byPartnerCountry}/>
  <div style={{display:'flex',flexWrap:'wrap',gap:12}}>
   <GroupTable title="Courier-wise TAT" groupName="Courier" items={report.byPartner}/>
   <GroupTable title="Country-wise TAT" groupName="Destination" items={report.byCountry}/>
   <GroupTable title="Service-wise TAT" groupName="Service" items={report.byService}/>
  </div>
  <section style={panel}>
   <div style={{display:'flex',flexWrap:'wrap',justifyContent:'space-between',alignItems:'center',gap:10,marginBottom:10}}>
    <div><h3 style={{fontSize:16,color:'#184873',margin:'0 0 4px'}}>Delivered AWB — TAT Details</h3>
     <p style={{margin:0,color:'#60758c',fontSize:12}}>{detail.length} records in selection • Review missing and invalid dates separately</p>
    </div>
    <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
     <select aria-label="TAT date verification filter" value={detailFilter} onChange={e=>setDetailFilter(e.target.value)} style={control}>
      <option value="NEEDS_REVIEW">Needs Date Review</option><option value="VERIFIED">Verified Date</option><option value="ALL">All Delivered</option>
     </select>
     <button type="button" onClick={()=>downloadCsv([detailHeaders,...detail.map(detailValues)],filename+'-review-details')} disabled={!detail.length} style={{...control,fontWeight:800,cursor:'pointer',background:'#eaf2ff'}}>Export Details CSV</button>
    </div>
   </div>
   <div style={{overflowX:'auto',maxHeight:520}}>
    <table style={{borderCollapse:'separate',borderSpacing:0,minWidth:1000,width:'100%'}}><thead><tr>
     {['JEPO AWB','Booking Date','Delivery Date','TAT','Date Check','Courier','Country','Latest JEPO Progress'].map(h=><th key={h} style={tableHead}>{h}</th>)}
    </tr></thead><tbody>{detail.slice(0,250).map(r=><tr key={r.awb}>
     {[r.awb,prettyDate(r.bookingDate),prettyDate(r.deliveredOn),days(r.tatDays),r.tatReason,r.partner,r.country,r.liveRemarks||'—'].map((v,i)=>
      <td key={i} style={{...tableCell,fontWeight:i===0||i===3?800:400,whiteSpace:i===7?'normal':'nowrap',maxWidth:i===7?280:undefined,color:i===4&&r.tatDays===null?'#a44d22':tableCell.color}}>{v}</td>)}
    </tr>)}
    {!detail.length&&<tr><td colSpan={8} style={tableCell}>No delivered AWBs matching this filter.</td></tr>}
    </tbody></table>
   </div>
   {detail.length>250&&<p style={{fontSize:12,color:'#62768c'}}>First 250 records displayed to keep the page responsive. Export Details CSV or Excel for all {fmt(detail.length)} records.</p>}
  </section>
  <p style={{fontSize:12,color:'#63758b',margin:'12px 2px'}}>All filters apply consistently to totals and tables. Delivered count includes every saved Delivered status; verified TAT averages exclude missing or chronologically invalid delivery dates. No manual date or inferred delivery scan is added.</p>
 </section>;
}
