'use client';
import {useEffect,useMemo,useState} from 'react';
import {inclusiveTatDays} from '../lib/branchTatSummary.js';
import JEPOLoadSummary from './JEPOLoadSummary.js';
import JEPOFedexLoadSummary from './JEPOFedexLoadSummary.js';
import JEPOMonthlyDashboard from './JEPOMonthlyDashboard.js';
import JEPOTatDashboard from './JEPOTatDashboard.js';
import {jepoTrackingState,jepoTrackingStatusLabel,sortJepoActiveRecords} from '../lib/jepoTrackingState.js';

const API='/api/jepo-tracking';
const panel={background:'#fff',border:'1px solid #d9e3ee',borderRadius:13,padding:16,marginTop:14};
const control={padding:'9px 12px',border:'1px solid #b8cadd',borderRadius:8,background:'#fff',color:'#17365d',fontSize:13};
const button={...control,cursor:'pointer',fontWeight:800};
const columns=[
 ['awb','AWB No.'],['liveRemarks','JEPO Progress'],['liveEventWhen','Progress Date/Time'],
 ['status','Tracking Status'],['carrierAwb','Forwarded AWB'],
 ['bookingDate','Booking Date'],['service','Service'],['vendor','Vendor'],['consignee','Consignee Name'],
 ['destination','Destination'],['weight','Chargeable Weight (kg)'],['jpCode','JEPO Code (Account Code)'],
 ['deliveredOn','Delivered Date'],['tat','TAT (days)'],['checkedAt','Last Checked']
];
const day=v=>v?String(v).slice(0,10).split('-').reverse().join('/'):'—';
const tatValue=r=>inclusiveTatDays(r.bookingDate,r.deliveredOn);
const number=v=>Number(v||0).toLocaleString('en-IN',{maximumFractionDigits:2});
const isDelivered=r=>r.status==='DELIVERED';
function csvEscape(value){
 const s=String(value??'');
 const guarded=/^[=+\-@\t\r]/.test(s)?"'"+s:s;
 return '"'+guarded.replace(/"/g,'""')+'"';
}
function downloadCsv(rows,name){
 const headers=columns.map(c=>c[1]);
 const lines=[headers,...rows.map(row=>columns.map(([k])=>k==='tat'?tatValue(row)??'':row[k]??''))];
 const body=lines.map(line=>line.map(csvEscape).join(',')).join('\r\n');
 const url=URL.createObjectURL(new Blob(['\ufeff'+body],{type:'text/csv;charset=utf-8'}));
 const a=document.createElement('a');a.href=url;a.download=name+'.csv';
 document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
}
function downloadDuplicateCsv(rows){
 const headers=['AWB','Duplicate Occurrences','Repeated in Excel','Already Saved Repeats','Uploads with Duplicates','Excel Rows (Last Upload)','Last File','Acknowledged By','Last Acknowledged At','Record Status'];
 const data=rows.map(r=>[r.awb,r.count,r.fileRepeats,r.alreadySavedRepeats,r.uploadEvents,r.excelRows,r.file,r.acknowledgedBy,r.acknowledgedAt,r.inTracking?(r.trackingStatus||'Active'):'Deleted']);
 const body=[headers,...data].map(line=>line.map(csvEscape).join(',')).join('\r\n');
 const url=URL.createObjectURL(new Blob(['\ufeff'+body],{type:'text/csv;charset=utf-8'}));
 const a=document.createElement('a');a.href=url;a.download='jepo_duplicate_awbs.csv';
 document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
}
export default function JEPOTrackingDashboard({readOnly=false}){
 const [rows,setRows]=useState([]),[duplicateRows,setDuplicateRows]=useState([]),[busy,setBusy]=useState(false),[fetching,setFetching]=useState(false);
 const [message,setMessage]=useState(''),[file,setFile]=useState(null),[preview,setPreview]=useState(null),[duplicateNotice,setDuplicateNotice]=useState(null);
 const [duplicatesAcknowledged,setDuplicatesAcknowledged]=useState(false),[historicalMode,setHistoricalMode]=useState(false),[deleteTarget,setDeleteTarget]=useState(null);
 const [tab,setTab]=useState('ACTIVE'),[search,setSearch]=useState(''),[service,setService]=useState(''),[destination,setDestination]=useState(''),[trackingStage,setTrackingStage]=useState('ALL');
 const [lastLoad,setLastLoad]=useState(null);
 async function load(showError=true){
  setFetching(true);
  try{
   const res=await fetch(API,{cache:'no-store',credentials:'include'});
   const data=await res.json();if(!res.ok||!data.ok)throw Error(data.error||'Unable to load.');
   setRows(data.rows||[]);setDuplicateRows(data.duplicateRows||[]);setLastLoad(new Date());
  }catch(e){if(showError)setMessage(e.message||'JEPO records unavailable.');}
  finally{setFetching(false);}
 }
 useEffect(()=>{void load();const timer=setInterval(()=>{if(document.visibilityState!=='hidden')void load(false)},120000);return()=>clearInterval(timer)},[]);
 async function upload(action){
  if(!file){setMessage('Pehle JEPO .csv ya .xlsx file select karein.');return;}
  setBusy(true);setMessage('');
  try{
   const requestAction=historicalMode?(action==='preview'?'historical-preview':'historical-save'):action;
   const form=new FormData();form.append('file',file);form.append('action',requestAction);form.append('acknowledgeDuplicates',String(duplicatesAcknowledged));
   const res=await fetch(API,{method:'POST',body:form,credentials:'include'});
   const data=await res.json();if(!res.ok||!data.ok)throw Error(data.error||'Excel upload failed.');
   if(action==='preview'){
    setPreview(data);setDuplicateNotice(null);setDuplicatesAcknowledged(false);
    setMessage(data.alreadyScanned?'This original CSV / Excel has already been scanned. Duplicate counts were not added twice.':historicalMode?'Historical preview ready: check repeated AWBs from this file and previously scanned original files. Confirm to save only duplicate audit.':'Preview ready: Excel headings aur repeated AWB acknowledgement check karke Save karein.');
   }else{
    setMessage(historicalMode?(data.alreadyScanned?'This file was already scanned; no duplicates were counted twice.':'Historical scan completed: '+number(data.recordedDuplicates)+' duplicate AWB numbers recorded. Tracking data was not changed.'):'Saved '+number(data.saved)+' AWBs. '+data.invalid+' invalid rows, '+data.duplicates+' duplicate entries in file, '+data.missingDates+' rows without valid booking date.'+(data.missingFields?.length?' Missing columns: '+data.missingFields.join(', ')+'.':'')+' Live tracking will start in the next scheduled refresh; you can also refresh selected AWBs now.');
    setDuplicateNotice(data);setPreview(null);setDuplicatesAcknowledged(false);setFile(null);await load(false);
    if(historicalMode)setTab('DUPLICATES');
    const input=document.getElementById('jepo-upload');if(input)input.value='';
   }
  }catch(e){setMessage(e.message||'Excel upload failed.');}finally{setBusy(false);}
 }
 async function deleteAwb(){
  if(!deleteTarget?.awb)return;
  const awb=deleteTarget.awb;
  setBusy(true);setMessage('');
  try{
   const res=await fetch(API,{method:'DELETE',headers:{'content-type':'application/json'},credentials:'include',body:JSON.stringify({awb,confirm:true})});
   const data=await res.json();if(!res.ok||!data.ok)throw Error(data.error||'AWB delete failed.');
   setDeleteTarget(null);
   setMessage('Deleted JEPO AWB '+awb+' from Active / Delivered and summaries.');
   await load(false);
  }catch(e){setMessage(e.message||'Could not delete AWB.');}
  finally{setBusy(false);}
 }
 async function refresh(awbs){
  if(!awbs?.length)return;
  setBusy(true);setMessage('Checking JEPO live tracking for '+awbs.length+' AWB(s)…');
  try{
   const res=await fetch(API,{method:'PATCH',headers:{'content-type':'application/json'},credentials:'include',body:JSON.stringify({awbs})});
   const data=await res.json();if(!res.ok||!data.ok)throw Error(data.error||'Tracking not available.');
   setMessage('JEPO checked: '+data.checked+' • Updated: '+data.updated+' • Errors: '+data.failed+'. Previous verified details are preserved.');
   await load(false);
  }catch(e){setMessage(e.message||'Tracking request failed.');}
  finally{setBusy(false);}
 }
 const active=useMemo(()=>sortJepoActiveRecords(rows.filter(r=>!isDelivered(r))),[rows]);
 const delivered=useMemo(()=>rows.filter(isDelivered).sort((a,b)=>
  String(b.deliveredOn||'').localeCompare(String(a.deliveredOn||''))||String(b.bookingDate||'').localeCompare(String(a.bookingDate||''))),[rows]);
 const source=tab==='DELIVERED'?delivered:active;
 const services=useMemo(()=>[...new Set(rows.map(x=>x.service).filter(Boolean))].sort(),[rows]);
 const destinations=useMemo(()=>[...new Set(rows.map(x=>x.destination).filter(Boolean))].sort(),[rows]);
 const visible=useMemo(()=>source.filter(r=>{
  const needle=search.trim().toLowerCase();
  return (!needle||[r.awb,r.service,r.vendor,r.consignee,r.destination,r.jpCode,r.carrierAwb,r.liveStatus].join(' ').toLowerCase().includes(needle))
   &&(!service||r.service===service)&&(!destination||r.destination===destination)
   &&(tab!=='ACTIVE'||trackingStage==='ALL'||jepoTrackingState(r)===trackingStage);
 }),[source,search,service,destination,trackingStage,tab]);
 const duplicateVisible=useMemo(()=>duplicateRows.filter(r=>[r.awb,r.file,r.acknowledgedBy].join(' ').toLowerCase().includes(search.trim().toLowerCase())),[duplicateRows,search]);
 const valid=useMemo(()=>delivered.map(tatValue).filter(v=>v!==null),[delivered]);
 const avg=valid.length?Math.round(valid.reduce((a,b)=>a+b,0)/valid.length*10)/10:null;
 const awaiting=rows.filter(r=>jepoTrackingState(r)==='AWAITING_FIRST_CHECK').length;
 const retryNeeded=rows.filter(r=>jepoTrackingState(r)==='RETRY_NEEDED').length;
 const metrics=[
  ['All JEPO AWBs',rows.length],['Active',active.length],['Delivered',delivered.length],['Duplicate AWBs',duplicateRows.length],
  ['Awaiting First Check',awaiting],['Retry Needed',retryNeeded],
  ['Verified TAT',valid.length],['Average Delivered TAT',avg===null?'—':avg+' days']
 ];
 return <main style={{background:'#f4f7fc',minHeight:'85vh',padding:'18px clamp(12px,3vw,30px)',color:'#193452'}}>
  <div style={{maxWidth:1750,margin:'0 auto'}}>
   <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,flexWrap:'wrap'}}>
    <div><small style={{letterSpacing:1,fontWeight:800,color:'#3366a7'}}>MAYAVI • JEPO EXPRESS</small>
     <h1 style={{margin:'4px 0 6px',fontSize:26}}>JEPO Tracking</h1>
     <p style={{margin:0,color:'#597089',fontSize:13}}>Excel import • Direct JEPO website tracking • Active / Delivered sheets • Booking-to-delivery TAT</p>
    </div>
    <button style={button} disabled={fetching||busy} onClick={()=>void load()}>{fetching?'Loading…':'Reload Saved Data'}</button>
   </div>
   {readOnly&&<p style={{margin:'12px 0',padding:11,background:'#eff6ff',borderRadius:9,color:'#1d4e89',fontSize:13,fontWeight:800}}>Haryana Admin • JEPO Tracking read-only view • Active, Delivered, Daily Load, Weekly Load and TAT Summary</p>}
   {!readOnly&&<section style={panel}>
    <h2 style={{fontSize:17,margin:'0 0 10px'}}>{historicalMode?'Restore Historical Duplicate AWBs':'Import JEPO CSV / Excel'}</h2>
    <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:12}}>
     <button style={{...button,background:!historicalMode?'#205ca1':'#eef4fa',color:!historicalMode?'#fff':'#23466a'}} disabled={busy} onClick={()=>{setHistoricalMode(false);setFile(null);setPreview(null);setDuplicateNotice(null);setDuplicatesAcknowledged(false);setMessage('');const el=document.getElementById('jepo-upload');if(el)el.value='';}}>Upload New AWBs</button>
     <button style={{...button,background:historicalMode?'#205ca1':'#eef4fa',color:historicalMode?'#fff':'#23466a'}} disabled={busy} onClick={()=>{setHistoricalMode(true);setFile(null);setPreview(null);setDuplicateNotice(null);setDuplicatesAcknowledged(false);setMessage('');const el=document.getElementById('jepo-upload');if(el)el.value='';}}>Scan Old CSV for Duplicates</button>
    </div>
    {historicalMode&&<p style={{fontSize:13,padding:10,background:'#fff7ed',color:'#854d0e',borderRadius:8,marginBottom:12}}>To restore previously unrecorded duplicates, select an original JEPO CSV / Excel file. This scan checks repeated AWBs within the file and across other original files scanned in this mode. It <b>does not add, edit, delete or retrack shipments</b>. Each exact original file is counted only once. Original source files are needed because saved tracking rows contain unique AWBs only.</p>}
    <div style={{display:'flex',flexWrap:'wrap',gap:9,alignItems:'center'}}>
     <input id="jepo-upload" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" style={{...control,maxWidth:'100%'}} onChange={e=>{setFile(e.target.files?.[0]||null);setPreview(null);setDuplicateNotice(null);setDuplicatesAcknowledged(false);setMessage('')}}/>
     <button style={{...button,background:'#e6f0ff'}} onClick={()=>void upload('preview')} disabled={!file||busy}>1. {historicalMode?'Preview Old CSV':'Preview Excel'}</button>
     <button style={{...button,background:'#166b56',color:'#fff'}} onClick={()=>void upload('save')} disabled={!preview||!file||busy||Boolean(preview?.alreadyScanned)||(Boolean((preview?.duplicates||0)+(preview?.previouslySavedCount||0))&&!duplicatesAcknowledged)}>2. {historicalMode?'Save Duplicate Audit Only':'Save AWBs'}</button>
    </div>
    {!historicalMode&&<p style={{margin:'10px 0 0',fontSize:12,color:'#61748b'}}>Supports <b>.csv</b> (JEPO downloaded export) and <b>.xlsx</b>. CSV Row 1 headings: Account Code → JEPO Code; AWB → AWB No.; CHARG. WEIGHT → Chargeable Weight. Columns: AWB No. · Service · Vendor · Consignee Name · Destination · Chargeable Weight · JP Code · Booking Date. Uploading the same AWB again updates its Excel information without creating a second row or wiping the last verified delivery status.</p>}
    {message&&<p role="status" style={{padding:10,borderRadius:8,background:'#ecf3ff',color:'#174477',fontSize:13,marginBottom:0}}>{message}</p>}
    {(preview||duplicateNotice)&&<div style={{marginTop:12}}>
     {preview&&<strong>Preview: {preview.total} unique AWBs · {preview.sheetName} · heading row {preview.headerRow}{historicalMode?' · Historical scan only':''}</strong>}
     {preview?.alreadyScanned&&<p style={{color:'#9a3412',fontWeight:800}}>This exact file has already been scanned. Select another original file to check for older duplicates.</p>}
     {preview&&<div style={{display:'flex',flexWrap:'wrap',gap:7,margin:'10px 0'}}>
      {[
       ['awb','AWB No.'],['service','Service'],['vendor','Vendor'],['consignee','Consignee Name'],
       ['destination','Destination'],['weight','Chargeable Weight'],['jpCode','JP Code'],['bookingDate','Booking Date']
      ].map(([field,label])=><div key={field} style={{padding:'7px 10px',borderRadius:8,background:'#f0f7ff',border:'1px solid #d4e3f5',fontSize:12}}>
       <b>{label}</b> → {preview.columnMatches?.[field]?.heading||'Not found'} <span style={{color:'#64748b'}}>(Excel column {preview.mapping?.[field]||'?'})</span>
      </div>)}
     </div>}
     {preview&&<p style={{fontSize:12,color:'#5e738a'}}>Invalid rows: {preview.invalid} · Duplicate Excel AWBs: {preview.duplicates} · Missing booking dates: {preview.missingDates}</p>}
    {(preview||duplicateNotice)&&((preview||duplicateNotice).duplicates>0||(preview||duplicateNotice).previouslySavedCount>0)&&<div style={{background:'#f3e8ff',color:'#5b21b6',padding:'12px 14px',borderRadius:10,border:'2px solid #a78bfa',margin:'12px 0',fontSize:13}}>
      <strong>Duplicate AWB Acknowledgement</strong>
      <p style={{margin:'5px 0 8px'}}>Same file mein {number((preview||duplicateNotice).duplicates||0)} repeated entries (unique repeated AWBs: {(preview||duplicateNotice).repeatedUniqueCount||0}).
       {historicalMode?' Previously scanned original source files mein ':' Pehle se saved JEPO Tracking mein '}{(preview||duplicateNotice).previouslySavedCount||0} AWBs match hue. {historicalMode?'Only the duplicate audit is saved; existing live shipment data stays unchanged.':'Duplicate row nahi banegi; purana live tracking aur Delivered status safe rahega.'}</p>
      {((preview||duplicateNotice).repeatedAwbs||[]).length>0&&<div style={{maxHeight:120,overflowY:'auto',borderTop:'1px solid #c4b5fd',paddingTop:7}}>
       {((preview||duplicateNotice).repeatedAwbs||[]).slice(0,40).map(item=><span key={item.awb} style={{display:'inline-block',padding:'4px 8px',background:'#ede9fe',borderRadius:7,margin:3,fontWeight:750}}>
        {item.awb} × {item.count} (Excel row {item.rows?.join(', ')||item.firstRow})
       </span>)}
      </div>}
      {((preview||duplicateNotice).previouslySavedAwbs||[]).length>0&&<div style={{marginTop:7,fontSize:12}}>{historicalMode?'Previously scanned source AWBs':'Already saved AWBs'} (first 25): {((preview||duplicateNotice).previouslySavedAwbs||[]).slice(0,25).join(', ')}</div>}
      {preview&&<label style={{display:'flex',alignItems:'flex-start',gap:8,marginTop:12,padding:'9px 10px',background:'#fff',borderRadius:8,cursor:'pointer',fontWeight:700}}>
       <input type="checkbox" checked={duplicatesAcknowledged} onChange={e=>setDuplicatesAcknowledged(e.target.checked)} style={{width:18,height:18,accentColor:'#7c3aed',flexShrink:0}}/>
       {historicalMode?'I acknowledge these repeated AWBs in the original source file(s). Save only duplicate history; do not change any tracked shipments.':'I acknowledge these repeated / already saved AWB numbers. Save will update existing Excel details without adding duplicate shipments or removing verified tracking.'}
      </label>}
     </div>}
    {preview?.missingFields?.length>0&&<p style={{fontSize:13,fontWeight:800,color:'#9a3412',background:'#fff7ed',padding:10,borderRadius:8}}>
     Excel mein identify nahi hue: {preview.missingFields.join(', ')}. Baaki AWB records load ho sakte hain; missing values blank rahengi. Booking Date missing ho to TAT calculate nahi hoga.
    </p>}
     {preview&&<div style={{overflowX:'auto',maxHeight:275}}>
      <table style={{borderCollapse:'collapse',whiteSpace:'nowrap',fontSize:12}}>
       <thead><tr>{['AWB','Service','Vendor','Consignee','Destination','Weight','JEPO Code','Booking Date'].map(h=><th key={h} style={{padding:8,background:'#eaf2ff',textAlign:'left'}}>{h}</th>)}</tr></thead>
       <tbody>{(preview.preview||[]).map(r=><tr key={r.awb}>{[r.awb,r.service,r.vendor,r.consignee,r.destination,r.weight,r.jpCode,day(r.bookingDate)].map((v,i)=><td key={i} style={{padding:8,borderBottom:'1px solid #edf0f5'}}>{v??'—'}</td>)}</tr>)}</tbody>
      </table>
     </div>}
    </div>}
   </section>}
   {!readOnly&&deleteTarget&&<div role="alertdialog" aria-label="Confirm JEPO AWB deletion" style={{...panel,border:'2px solid #dc2626',background:'#fff7f7'}}>
    <strong style={{color:'#9f1239'}}>Delete JEPO AWB {deleteTarget.awb}?</strong>
    <p style={{fontSize:13,margin:'8px 0'}}>Consignee: {deleteTarget.consignee||'—'}. This removes the shipment from Active, Delivered, monthly reports and TAT summaries. This cannot be undone.</p>
    <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
     <button style={button} disabled={busy} onClick={()=>setDeleteTarget(null)}>Cancel — keep AWB</button>
     <button style={{...button,background:'#b91c1c',color:'#fff'}} disabled={busy} onClick={()=>void deleteAwb()}>{busy?'Deleting…':'Confirm Delete'}</button>
    </div>
   </div>}
   <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:10,marginTop:14}}>
    {metrics.map(([label,value])=><div key={label} style={{background:'#fff',border:'1px solid #dce7f3',padding:13,borderRadius:12}}>
     <div style={{color:'#5c718b',fontSize:12,fontWeight:700}}>{label}</div>
     <div style={{fontSize:23,fontWeight:900,color:'#1b477a',marginTop:4}}>{value}</div>
    </div>)}
   </div>
   <section style={panel}>
    <div style={{display:'flex',gap:9,flexWrap:'wrap',alignItems:'center'}}>
     {[['ACTIVE','Active ('+active.length+')'],['DELIVERED','Delivered ('+delivered.length+')'],['DUPLICATES','Duplicate AWBs ('+duplicateRows.length+')'],['DAILY','Daily Load'],['WEEKLY','Weekly Load'],['MONTHLY','Monthly Data'],['TAT','TAT Summary']].map(([id,label])=>
      <button key={id} onClick={()=>{setTab(id);if(id==='DUPLICATES')setSearch('')}} style={{...button,background:tab===id?'#205ca1':'#eef4fa',color:tab===id?'#fff':'#224466'}}>{label}</button>)}
     <small style={{marginLeft:'auto',color:'#718095'}}>{lastLoad?'Updated '+lastLoad.toLocaleTimeString('en-IN'):' '}</small>
    </div>
    {tab==='DUPLICATES'?<div style={{marginTop:14}}>
     <p style={{fontSize:13,color:'#576b85',margin:'0 0 10px'}}>Duplicate AWBs acknowledged during saved Excel / CSV imports are recorded here permanently. Counts include repeated Excel rows and AWBs already saved before an import. Only one shipment is kept per AWB; tracking status and delivered data stay intact. Historical duplicates from older imports need a scan of the original source file(s); unique shipment records alone cannot show which original rows repeated.</p>
     <div style={{display:'flex',alignItems:'center',gap:9,flexWrap:'wrap',marginBottom:12}}>
      <input aria-label="Search duplicate JEPO AWB" placeholder="Search duplicate AWB, file or acknowledger…" style={{...control,flex:'1 1 220px'}} value={search} onChange={e=>setSearch(e.target.value)}/>
      <button style={button} disabled={!duplicateVisible.length} onClick={()=>downloadDuplicateCsv(duplicateVisible)}>Export Duplicate CSV</button>
     </div>
     <p style={{fontSize:12,color:'#687d93'}}>{duplicateVisible.length} duplicate AWB numbers • Most recently acknowledged first • Deleting a shipment does not erase its duplicate audit history.</p>
     <div style={{overflowX:'auto',border:'1px solid #d8e5f2',borderRadius:10,maxHeight:650}}>
      <table style={{borderCollapse:'separate',borderSpacing:0,fontSize:12,whiteSpace:'nowrap',width:'100%'}}>
       <thead><tr>{['#','AWB No.','Repeat Occurrences','Repeated in Excel','Already Saved Repeats','Duplicate Uploads','Excel Rows (Last Upload)','Last File','Acknowledged By','Last Acknowledged','Record','Action'].map(h=><th key={h} style={{background:'#efeaff',position:'sticky',top:0,zIndex:1,textAlign:'left',padding:'10px 9px',borderBottom:'1px solid #d7c7fb'}}>{h}</th>)}</tr></thead>
       <tbody>{duplicateVisible.map((r,i)=><tr key={r.awb} style={{background:i%2?'#faf7ff':'white'}}>
        {[i+1,r.awb,r.count,r.fileRepeats,r.alreadySavedRepeats,r.uploadEvents,r.excelRows||'—',r.file||'—',r.acknowledgedBy||'—',r.acknowledgedAt?new Date(r.acknowledgedAt).toLocaleString('en-IN',{hour12:false}):'—',r.inTracking?(r.trackingStatus==='DELIVERED'?'Delivered':'Active'):'Deleted'].map((v,j)=><td key={j} style={{padding:9,borderBottom:'1px solid #e9eef5',fontWeight:j===1?800:400}}>{v}</td>)}
        <td style={{padding:8,borderBottom:'1px solid #e9eef5'}}>{r.inTracking?<button style={{...button,padding:'5px 9px'}} onClick={()=>{setSearch(r.awb);setTab(r.trackingStatus==='DELIVERED'?'DELIVERED':'ACTIVE')}}>View AWB</button>:'Audit only'}</td>
       </tr>)}
       {!duplicateVisible.length&&<tr><td colSpan={12} style={{padding:20,color:'#637891',textAlign:'center'}}>No duplicate AWB audit records have been saved yet. Earlier JEPO Tracking imports kept one row per AWB, so prior repeats cannot be inferred from the saved records. Use “Scan Old CSV for Duplicates” above with the original JEPO export file(s) to restore their duplicate history without changing shipments.</td></tr>}
       </tbody>
      </table>
     </div>
    </div>:tab==='DAILY'?<><JEPOLoadSummary records={rows} period="daily"/><JEPOFedexLoadSummary records={rows}/></>:tab==='WEEKLY'?<JEPOLoadSummary records={rows} period="weekly"/>:tab==='MONTHLY'?<JEPOMonthlyDashboard records={rows}/>:tab==='TAT'?<JEPOTatDashboard records={rows}/>:<>
     <div style={{display:'flex',gap:9,flexWrap:'wrap',margin:'14px 0',alignItems:'center'}}>
      <input aria-label="Search JEPO AWB" placeholder="Search AWB, consignee, vendor, JP code…" style={{...control,flex:'1 1 240px',minWidth:170}} value={search} onChange={e=>setSearch(e.target.value)}/>
      <select aria-label="Filter Service" value={service} onChange={e=>setService(e.target.value)} style={control}><option value="">All Services</option>{services.map(s=><option key={s}>{s}</option>)}</select>
      <select aria-label="Filter Destination" value={destination} onChange={e=>setDestination(e.target.value)} style={control}><option value="">All Destinations</option>{destinations.map(s=><option key={s}>{s}</option>)}</select>
      {tab==='ACTIVE'&&<select aria-label="Filter Tracking Progress" value={trackingStage} onChange={e=>setTrackingStage(e.target.value)} style={control}>
       <option value="ALL">All Tracking States</option><option value="RETRY_NEEDED">Retry Needed</option>
       <option value="LIVE_UPDATED">Live Updated</option><option value="PROGRESS_ONLY">JEPO Progress Available</option><option value="AWAITING_FIRST_CHECK">Awaiting First Check</option>
      </select>}
      <button style={button} disabled={!visible.length} onClick={()=>downloadCsv(visible,tab==='DELIVERED'?'jepo_delivered':'jepo_active')}>Export CSV</button>
      {tab==='ACTIVE'&&!readOnly&&<button style={{...button,background:'#dceaff',color:'#205ca1'}} disabled={busy||!visible.length} onClick={()=>void refresh(visible.slice(0,8).map(r=>r.awb))}>Track Next 8 AWBs</button>}
     </div>
     <p style={{fontSize:12,color:'#61738a'}}>{visible.length} records • JEPO live checks every 2 minutes, up to 100 AWBs per batch • Awaiting First Check means not yet processed; Retry Needed means no verified status from the last website check. These are queue labels, not shipment statuses.</p>
     <div style={{overflowX:'auto',border:'1px solid #d8e5f2',borderRadius:10,maxHeight:650}}>
      <table style={{borderCollapse:'separate',borderSpacing:0,fontSize:12,whiteSpace:'nowrap',width:'100%'}}>
       <thead><tr>{['#',...columns.map(c=>c[1]),...(!readOnly?['Actions']:[])].map(h=><th key={h} style={{background:'#e8f1ff',position:'sticky',top:0,zIndex:1,textAlign:'left',padding:'10px 9px',borderBottom:'1px solid #cdddeb'}}>{h}</th>)}</tr></thead>
       <tbody>{visible.map((r,i)=><tr key={r.awb} style={{background:i%2?'#f7fbff':'white'}}>
        <td style={{padding:9,borderBottom:'1px solid #e9eef5'}}>{i+1}</td>
        {columns.map(([key])=>{
         let v=key==='tat'?tatValue(r):r[key];
         if(['bookingDate','deliveredOn'].includes(key))v=day(v);
         if(key==='checkedAt')v=v?new Date(v).toLocaleString('en-IN',{hour12:false}):'—';
         if(key==='status')v=jepoTrackingStatusLabel(r);
         if(key==='liveRemarks'&&!v)v=jepoTrackingState(r)==='AWAITING_FIRST_CHECK'?'Not checked yet':'JEPO progress not verified';
         return <td key={key} title={key==='liveRemarks'?r.trackingError||r.liveRemarks||'':''} style={{padding:9,maxWidth:key==='liveRemarks'?330:200,minWidth:key==='liveRemarks'?190:undefined,whiteSpace:key==='liveRemarks'?'normal':'nowrap',overflow:key==='liveRemarks'?'visible':'hidden',textOverflow:key==='liveRemarks'?'clip':'ellipsis',borderBottom:'1px solid #e9eef5',color:key==='status'?(isDelivered(r)?'#12704d':jepoTrackingState(r)==='RETRY_NEEDED'?'#a3411c':jepoTrackingState(r)==='AWAITING_FIRST_CHECK'?'#7c5999':'#2c5785'):'#354c64',fontWeight:key==='awb'||key==='status'?800:400}}>
          {v===null||v===undefined||v===''?'—':key==='tat'?v+' d':v}{key==='status'&&r.trackingError?' ⚠':''}
         </td>;
        })}
        {!readOnly&&<td style={{padding:8,borderBottom:'1px solid #e9eef5'}}>
         <div style={{display:'flex',alignItems:'center',gap:6}}>
          <button style={{...button,padding:'5px 9px'}} disabled={busy} onClick={()=>void refresh([r.awb])}>Track</button>
          <button aria-label={'Delete JEPO AWB '+r.awb} style={{...button,padding:'5px 9px',color:'#b91c1c',borderColor:'#f5baba',background:'#fff1f2'}} disabled={busy} onClick={()=>setDeleteTarget({awb:r.awb,consignee:r.consignee})}>Delete</button>
         </div>
        </td>}
       </tr>)}
       {!visible.length&&<tr><td colSpan={columns.length+(readOnly?1:2)} style={{padding:20,textAlign:'center',color:'#637891'}}>No AWBs in this sheet yet. Upload Excel to begin.</td></tr>}
       </tbody>
      </table>
     </div>
    </>}
   </section>
  </div>
 </main>;
}
