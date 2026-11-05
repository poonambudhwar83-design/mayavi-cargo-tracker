'use client';
import {useEffect,useMemo,useState} from 'react';
import {AUDIT_FIELDS} from '../lib/auditDataAnalysis.js';

const moneyNumber=new Intl.NumberFormat('en-IN',{maximumFractionDigits:3});
const surface={background:'#fff',border:'1px solid #dbe5f1',borderRadius:13,padding:16};
const button={padding:'10px 15px',borderRadius:9,border:'1px solid #b7cbe6',background:'#fff',color:'#183965',fontWeight:800,cursor:'pointer'};
const field={padding:'9px 10px',borderRadius:8,border:'1px solid #bfcede',background:'#fff',maxWidth:'100%',fontSize:13};
const headings=['MAWB','Weight (kg)','Bags','G&C','T','DT','D','X-ray','Shift','Loader','Co-loader','Remarks'];
const keys=['mawb','weight','bags','gc','t','dt','d','xray','shift','loader','coLoader','remarks'];
const MAPPING_FIELDS=[{key:'enteredBy',label:'Audit — Entered By (optional Vivek filter)'},...AUDIT_FIELDS];
function csvDownload(rows,fileName='mayavi_audit_analysis'){
 const lines=[headings,...rows.map(r=>keys.map(k=>r[k]??''))];
 const csv=lines.map(line=>line.map(v=>{
  const plain=String(v??''),safe=/^[=+\-@\t\r]/.test(plain)?"'"+plain:plain;
  return '"'+safe.replace(/"/g,'""')+'"';
 }).join(',')).join('\r\n');
 const a=document.createElement('a'),url=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}));
 a.href=url;a.download=fileName.replace(/[^a-zA-Z0-9_-]/g,'_')+'.csv';
 document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
}
export default function AuditDataAnalysisDashboard(){
 const [file,setFile]=useState(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const [preview,setPreview]=useState(null),[sheetName,setSheetName]=useState(''),[headerRow,setHeaderRow]=useState(1),[mapping,setMapping]=useState({});
 const [dirty,setDirty]=useState(false),[saved,setSaved]=useState({uploads:[],rows:[],totals:{},selectedId:null});
 const [selectedUpload,setSelectedUpload]=useState(''),[query,setQuery]=useState(''),[onlyMissing,setOnlyMissing]=useState(false);
 async function load(upload=''){
  try{
   const res=await fetch('/api/audit-data-analysis'+(upload?'?upload='+encodeURIComponent(upload):''),{credentials:'include',cache:'no-store'});
   const data=await res.json();if(!res.ok||!data.ok)throw Error(data.error||'Could not load Audit analysis');
   setSaved(data);setSelectedUpload(data.selectedId||'');
  }catch(e){setMessage(e.message||'Audit analysis unavailable.');}
 }
 useEffect(()=>{void load()},[]);
 function selectSheet(next){
  const s=preview?.sheets?.find(x=>x.name===next);
  setSheetName(next);setHeaderRow(s?.headerRow||1);setMapping(s?.mapping||{});setDirty(true);
 }
 async function submit(action){
  if(!file){setMessage('Pehle .xlsx file select karein.');return;}
  if(action==='save'&&(!preview||dirty||preview.warning||!preview.preview?.length)){setMessage('Pehle updated column mapping ka preview check karein.');return;}
  setBusy(true);setMessage('');
  try{
   const form=new FormData();form.append('file',file);form.append('action',action);
   if(sheetName)form.append('sheetName',sheetName);
   form.append('headerRow',String(sheetName?headerRow||1:0));
   form.append('mapping',JSON.stringify(mapping));
   const response=await fetch('/api/audit-data-analysis',{method:'POST',body:form,credentials:'include'});
   const data=await response.json();
   if(!response.ok||!data.ok)throw Error(data.error||'Excel processing failed');
   if(action==='preview'){
    setPreview(data);setSheetName(data.selectedSheet||'');setHeaderRow(data.headerRow||1);setMapping(data.mapping||{});
    setDirty(false);setMessage(data.warning?'Review columns: '+data.warning:'Preview ready. Vivek aur Rahul fields verify karke Save karein.');
   }else{
    setMessage(data.message||'Audit data saved.');
    setPreview(null);setFile(null);setMapping({});setSheetName('');setDirty(false);
    const inp=document.getElementById('mayavi-audit-file');if(inp)inp.value='';
    await load(data.uploadId);
   }
  }catch(e){setMessage(e.message||'Excel upload failed.');}
  finally{setBusy(false);}
 }
 const rows=useMemo(()=> (saved.rows||[]).filter(r=>
  (!query||[r.mawb,r.gc,r.t,r.dt,r.d,r.xray,r.shift,r.loader,r.coLoader,r.remarks].join(' ').toLowerCase().includes(query.trim().toLowerCase()))&&
  (!onlyMissing||r.weight===null||r.bags===null||!['gc','t','dt','d','xray','shift','loader','coLoader','remarks'].some(k=>r[k]))
 ),[saved.rows,query,onlyMissing]);
 const sheet=preview?.sheets?.find(s=>s.name===sheetName)||preview?.sheets?.[0];
 const metrics=saved.totals||{};
 return <main style={{background:'#f4f7fc',minHeight:'85vh',padding:'20px clamp(12px,3vw,32px)',color:'#14263d'}}>
  <div style={{maxWidth:1600,margin:'0 auto'}}>
   <div style={{marginBottom:18}}>
    <small style={{color:'#2d5ca6',letterSpacing:1.3,fontWeight:900}}>MAYAVI • ADMIN ONLY • EXCEL ANALYSIS</small>
    <h1 style={{fontSize:26,margin:'6px 0'}}>Data Analysis — Audit (Vivek / Rahul)</h1>
    <p style={{margin:0,color:'#52677f'}}>Vivek: entered MAWB, weight &amp; bags • Rahul: G&amp;C, T, DT, D, X-ray, shift, loader, co-loader &amp; remarks. Independent from Profit Sheets.</p>
   </div>
   <section style={surface}>
    <div style={{display:'flex',alignItems:'end',justifyContent:'space-between',gap:16,flexWrap:'wrap'}}>
     <div><h2 style={{margin:'0 0 7px',fontSize:19}}>1. Upload Audit Excel</h2><p style={{margin:0,color:'#5b6f86',fontSize:12}}>Upload .xlsx (up to 5 MB), preview the detected columns, then save. Existing analyses stay available.</p></div>
     <div style={{display:'flex',alignItems:'center',gap:9,flexWrap:'wrap'}}>
      <input type="file" id="mayavi-audit-file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
       onChange={e=>{setFile(e.target.files?.[0]||null);setPreview(null);setSheetName('');setMapping({});setHeaderRow(1);setDirty(false);setMessage('')}}
       style={{...field,maxWidth:320}}/>
      <button style={{...button,background:'#1e55a3',color:'#fff'}} disabled={!file||busy} onClick={()=>void submit('preview')}>
       {busy?'Processing…':'Preview Excel'}</button>
     </div>
    </div>
    {message&&<p role="status" style={{padding:10,background:'#edf4ff',borderRadius:9,color:'#17427b',margin:'13px 0 0'}}>{message}</p>}
   </section>
   {preview&&<section style={{...surface,marginTop:14}}>
    <h2 style={{margin:'0 0 12px',fontSize:18}}>2. Review &amp; map Excel columns</h2>
    <div style={{display:'flex',gap:12,flexWrap:'wrap',alignItems:'end',marginBottom:12}}>
     <label style={{fontSize:12,fontWeight:800}}>Excel sheet
      <select value={sheetName} onChange={e=>selectSheet(e.target.value)} style={{...field,display:'block',minWidth:175,marginTop:5}}>
       {(preview.sheets||[]).map(s=><option key={s.name} value={s.name}>{s.name} ({s.rowCount} rows)</option>)}
      </select>
     </label>
     <label style={{fontSize:12,fontWeight:800}}>Heading row
      <input type="number" min="1" max="100" value={headerRow} onChange={e=>{setHeaderRow(Number(e.target.value));setDirty(true)}} style={{...field,display:'block',width:85,marginTop:5}}/>
     </label>
     <button style={button} disabled={busy} onClick={()=>void submit('preview')}>Check selected columns</button>
    </div>
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))',gap:9}}>
     {MAPPING_FIELDS.map(f=><label key={f.key} style={{fontSize:12,fontWeight:800,color:'#344d6b'}}>
      {f.label}{f.key==='mawb'&&<span style={{color:'#c33139'}}> *</span>}
      <select aria-label={f.label+' Excel column'} value={mapping[f.key]||''}
        onChange={e=>{setMapping(prev=>({...prev,[f.key]:Number(e.target.value)||0}));setDirty(true)}}
        style={{...field,display:'block',width:'100%',marginTop:4,fontWeight:500}}>
       <option value="">Not found / Ignore</option>
       {(sheet?.columns||[]).map(c=><option key={c.column} value={c.column}>{c.label}</option>)}
      </select>
     </label>)}
    </div>
    {preview.warning&&<p style={{color:'#ae3d2b',fontWeight:700,fontSize:12}}>{preview.warning}</p>}
    {preview.totals&&<p style={{color:'#48617c',fontSize:12}}>Detected: {preview.totals.rows} rows · {preview.totals.uniqueMawbs} unique MAWBs · {preview.skipped||0} skipped · {preview.duplicates||0} duplicates.</p>}
    {preview.preview?.length>0&&<div style={{overflowX:'auto',margin:'10px 0',borderRadius:8,border:'1px solid #d9e5f1'}}>
     <table style={{borderCollapse:'collapse',fontSize:12,whiteSpace:'nowrap',width:'100%'}}>
      <thead><tr>{headings.map(h=><th key={h} style={{padding:'9px',background:'#e7effb',textAlign:'left'}}>{h}</th>)}</tr></thead>
      <tbody>{preview.preview.map((r,i)=><tr key={i}>{keys.map(k=><td key={k} style={{borderTop:'1px solid #edf2f7',padding:'8px'}}>{r[k]??'—'}</td>)}</tr>)}</tbody>
     </table>
    </div>}
    <button onClick={()=>void submit('save')} disabled={busy||dirty||!preview.preview?.length||!!preview.warning}
     style={{...button,background:'#14715b',color:'#fff',opacity:busy||dirty||!preview.preview?.length||preview.warning?.length?0.55:1}}>Save this Audit Analysis</button>
    {dirty&&<small style={{marginLeft:12,color:'#a26117'}}>Mapping changed — please Check selected columns before saving.</small>}
   </section>}
   <section style={{...surface,marginTop:14}}>
    <div style={{display:'flex',alignItems:'end',justifyContent:'space-between',gap:12,flexWrap:'wrap'}}>
     <div><h2 style={{fontSize:19,margin:'0 0 5px'}}>3. Saved Audit Analysis</h2>
      <label style={{fontSize:12,color:'#5f738a'}}>Uploaded workbook
       <select value={selectedUpload} onChange={e=>{setSelectedUpload(e.target.value);void load(e.target.value)}} style={{...field,display:'block',minWidth:250,marginTop:4}}>
        {!saved.uploads?.length&&<option value="">No uploads yet</option>}
        {(saved.uploads||[]).map(u=><option key={u.id} value={u.id}>{u.fileName} • {u.sheetName} • {new Date(u.createdAt).toLocaleDateString('en-IN')}</option>)}
       </select>
      </label></div>
     <button style={{...button,background:'#e5eefb'}} disabled={!rows.length} onClick={()=>csvDownload(rows,'mayavi_audit_vivek_rahul')}>Download CSV</button>
    </div>
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))',gap:10,margin:'16px 0'}}>
     {[
      ['Excel rows',metrics.rows||0],['Unique MAWBs',metrics.uniqueMawbs||0],
      ['Total Weight',moneyNumber.format(metrics.weight||0)+' kg'],
      ['Total Bags',moneyNumber.format(metrics.bags||0)],
      ['Rahul entries',metrics.withRahul||0]
     ].map(([title,value])=><div key={title} style={{background:'#f0f6ff',borderRadius:10,padding:12}}>
      <small style={{display:'block',color:'#536b89'}}>{title}</small>
      <strong style={{fontSize:21,color:'#1c426e'}}>{value}</strong></div>)}
    </div>
    <div style={{display:'flex',gap:12,alignItems:'center',flexWrap:'wrap',marginBottom:11}}>
     <input aria-label="Search MAWB or Rahul remarks" type="search" value={query} onChange={e=>setQuery(e.target.value)}
      placeholder="Search MAWB, Rahul values, remarks..." style={{...field,minWidth:260}}/>
     <label style={{fontSize:12,color:'#4a6078',display:'flex',alignItems:'center',gap:7}}>
      <input type="checkbox" checked={onlyMissing} onChange={e=>setOnlyMissing(e.target.checked)}/> Needs review (missing details)
     </label>
     <small style={{color:'#5a6d82',marginLeft:'auto'}}>{rows.length} displayed records</small>
    </div>
    <div style={{overflowX:'auto',border:'1px solid #dce6f2',borderRadius:9,maxHeight:620}}>
     <table style={{borderCollapse:'separate',borderSpacing:0,width:'100%',fontSize:12,whiteSpace:'nowrap'}}>
      <thead><tr>{['Excel row',...headings].map(h=><th key={h}
       style={{position:'sticky',top:0,zIndex:1,padding:'10px 9px',textAlign:'left',background:'#eaf1fe',borderBottom:'1px solid #d1dfef'}}>{h}</th>)}</tr></thead>
      <tbody>{rows.map((r,i)=><tr key={(r.sourceRow||i)+'-'+i} style={{background:i%2===0?'#fff':'#f8fbff'}}>
       <td style={{padding:'9px',borderBottom:'1px solid #eaf0f7',color:'#61748c'}}>{r.sourceRow}</td>
       {keys.map(k=><td key={k} style={{padding:'9px',borderBottom:'1px solid #eaf0f7',
        fontWeight:k==='mawb'?850:500,color:k==='mawb'?'#1c5699':'#35465c',maxWidth:k==='remarks'?320:180,
        whiteSpace:k==='remarks'?'normal':'nowrap'}}>{r[k]===null||r[k]===''?'—':r[k]}</td>)}
      </tr>)}
       {!rows.length&&<tr><td colSpan={13} style={{padding:24,textAlign:'center',color:'#61758f'}}>
        {saved.uploads?.length?'No matching Audit records.':'Upload an Audit Excel file to start.'}</td></tr>}
      </tbody>
     </table>
    </div>
    <p style={{fontSize:12,color:'#62748d',marginBottom:0}}>Source values are kept as entered in Excel, without assuming whether Rahul’s figures are charges or counts. No Profit Sheet calculations are modified.</p>
   </section>
  </div>
 </main>;
}
