'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

const API='/api/speedpost';
const card={border:'1px solid #dce5f1',borderRadius:14,padding:17,background:'#fff',boxShadow:'0 2px 8px rgba(15,23,42,.04)'};
const btn={border:0,borderRadius:8,padding:'10px 14px',background:'#2258ce',color:'#fff',fontWeight:800,cursor:'pointer'};
const input={width:'100%',boxSizing:'border-box',height:42,border:'1px solid #c8d4e3',borderRadius:8,padding:'7px 11px',fontSize:14};
const th={textAlign:'left',padding:'13px 11px',whiteSpace:'nowrap',color:'#334155',fontSize:12,borderBottom:'1px solid #dce4ef',background:'#f5f8fe'};
const td={padding:'12px 10px',fontSize:12,borderBottom:'1px solid #edf1f6',whiteSpace:'nowrap',verticalAlign:'top'};

function normalizeED(value=''){
  const s=String(value||'').toUpperCase().replace(/\s+|-/g,'');
  return /^ED\d{9}IN$/.test(s)?s:'';
}
function readED(text=''){
  const s=String(text||'').toUpperCase();
  const normalized=s.replace(/[^A-Z0-9]/g,'');
  const candidates=[...normalized.matchAll(/ED[0-9OQILSBZ]{9}I[NM]/g)];
  for(const hit of candidates){
    const mid=hit[0].slice(2,11).replace(/[OQ]/g,'0').replace(/[IL]/g,'1').replace(/S/g,'5').replace(/B/g,'8').replace(/Z/g,'2');
    const candidate='ED'+mid+'IN';
    if(normalizeED(candidate))return candidate;
  }
  return'';
}
function formatValue(value){return value?String(value):'—'}
function field(row,key){
  const val=row?.[key];
  if(!val)return <span style={{color:'#94a3b8'}}>—</span>;
  const retained=Array.isArray(row.retainedFields)&&row.retainedFields.includes(key);
  return <span title={retained?'From last saved verified tracking response':undefined}>{val}{retained&&<small style={{display:'block',color:'#a16207'}}>previous check</small>}</span>;
}

export default function SpeedPostDashboard({currentUser}){
  const [rows,setRows]=useState([]);
  const [trackingNo,setTrackingNo]=useState('');
  const [busy,setBusy]=useState('');
  const [ocrBusy,setOcrBusy]=useState(false);
  const [ocrProgress,setOcrProgress]=useState('');
  const [message,setMessage]=useState('');
  const [loadError,setLoadError]=useState('');
  const [imageName,setImageName]=useState('');
  const fileRef=useRef(null);

  const load=useCallback(async()=>{
    try{
      const response=await fetch(API,{cache:'no-store'});
      const result=await response.json();
      if(!response.ok||!result.ok)throw new Error(result.error||'Cannot load records');
      setRows(result.rows||[]);
      setLoadError('');
    }catch(e){setLoadError(e.message||'Unable to load saved Speed Post records.')}
  },[]);
  useEffect(()=>{load();},[load]);

  const trackOne=useCallback(async(no)=>{
    const id=normalizeED(no);
    if(!id){setMessage('Enter a valid tracking number such as ED977951280IN.');return;}
    setBusy(id);
    setMessage('Checking '+id+' on MySpeedPost; please wait for current details…');
    try{
      const response=await fetch(API,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({trackingNo:id})});
      const result=await response.json();
      if(!response.ok||!result.ok)throw new Error(result.error||'Tracking unavailable');
      setRows(old=>[result.row,...old.filter(r=>r.trackingNo!==id)]);
      setTrackingNo(id);
      setMessage(id+' — latest available third-party tracking details saved. Blank fields were not invented.');
    }catch(e){setMessage(id+' — '+(e.message||'Tracking unavailable')+'. Existing saved data remains unchanged.');}
    finally{setBusy('');}
  },[]);

  async function uploadImage(event){
    const file=event.target.files?.[0];
    if(!file)return;
    setImageName(file.name);setMessage('');
    if(file.size>8*1024*1024){setMessage('Please upload an image below 8 MB.');return;}
    setOcrBusy(true);setOcrProgress('Reading the tracking number from the photo…');
    let worker;
    try{
      const {createWorker}=await import('tesseract.js');
      worker=await createWorker('eng',1,{logger:msg=>{
        if(msg.status==='recognizing text')setOcrProgress('Reading photo: '+Math.round((msg.progress||0)*100)+'%');
      }});
      const result=await worker.recognize(file);
      const found=readED(result?.data?.text||'');
      if(!found){setMessage('ED tracking number could not be read clearly. Please enter/correct it manually and press TRACK & SAVE.');return;}
      setTrackingNo(found);
      setOcrProgress('Tracking '+found+'…');
      await trackOne(found);
    }catch(e){setMessage('Photo OCR could not finish: '+(e?.message||e)+'. You can still enter the ED number manually.');}
    finally{
      try{await worker?.terminate()}catch{}
      setOcrBusy(false);setOcrProgress('');
      if(fileRef.current)fileRef.current.value='';
    }
  }
  async function remove(trackingNoToRemove){
    if(!window.confirm('Remove '+trackingNoToRemove+' from the private Speed Post dashboard?'))return;
    setBusy(trackingNoToRemove);
    try{
      const response=await fetch(API,{method:'DELETE',headers:{'content-type':'application/json'},body:JSON.stringify({trackingNo:trackingNoToRemove})});
      const result=await response.json();
      if(!response.ok||!result.ok)throw new Error(result.error||'Remove failed');
      setRows(old=>old.filter(r=>r.trackingNo!==trackingNoToRemove));
      setMessage(trackingNoToRemove+' removed from private Speed Post records.');
    }catch(e){setMessage(e.message||'Remove failed.')}
    finally{setBusy('');}
  }
  const anythingBusy=Boolean(busy||ocrBusy);
  return <main style={{padding:'18px min(4vw,36px) 35px',background:'#f4f7fc',minHeight:'70vh'}}>
    <section style={{...card,background:'linear-gradient(110deg,#173f91,#2a63c7)',color:'#fff',marginBottom:15}}>
      <div style={{fontSize:11,letterSpacing:1.4,fontWeight:800,opacity:.82}}>MAYAVI • PRIVATE</div>
      <h1 style={{margin:'6px 0 9px',fontSize:24}}>India Speed Post Tracking</h1>
      <p style={{margin:0,fontSize:13}}>Visible to Admin and Sonu only • Photos are read on your device • Separate from Air Cargo MAWBs</p>
    </section>
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,300px),1fr))',gap:14,marginBottom:15}}>
      <section style={card}>
        <div style={{fontWeight:800,marginBottom:9,color:'#163c80'}}>1. Upload receipt / photo</div>
        <input ref={fileRef} type="file" accept="image/*" onChange={uploadImage} disabled={anythingBusy} style={input}/>
        <div style={{color:'#64748b',fontSize:12,marginTop:9}}>OCR automatically finds ED + 9 digits + IN. Photo stays in your browser.</div>
        {imageName&&<div style={{fontSize:11,marginTop:7,color:'#475569'}}>Selected: {imageName}</div>}
        {ocrBusy&&<div role="status" style={{color:'#1d4ed8',fontSize:12,marginTop:8}}>{ocrProgress||'Reading photo…'}</div>}
      </section>
      <section style={card}>
        <div style={{fontWeight:800,marginBottom:9,color:'#163c80'}}>2. Track & save consignment</div>
        <form onSubmit={e=>{e.preventDefault();trackOne(trackingNo);}}>
          <input style={{...input,textTransform:'uppercase',marginBottom:9}} maxLength={18} value={trackingNo} onChange={e=>setTrackingNo(e.target.value.toUpperCase())} placeholder="ED977951280IN"/>
          <button style={{...btn,opacity:anythingBusy?.6:1,width:'100%'}} disabled={anythingBusy} type="submit">{anythingBusy?'WORKING…':'TRACK & SAVE →'}</button>
        </form>
        <div style={{fontSize:11,color:'#64748b',marginTop:9}}>Tracking site: <a href="https://myspeedpost.com/track" target="_blank" rel="noreferrer">MySpeedPost ↗</a> (independent, not official India Post)</div>
      </section>
    </div>
    {(message||loadError)&&<div role="status" style={{...card,marginBottom:14,color:loadError?'#a52a2a':'#1e40af',fontSize:13}}>{loadError||message}</div>}
    <section style={card}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:10,marginBottom:13}}>
        <div><h2 style={{fontSize:18,margin:'0 0 4px'}}>Saved Speed Post Consignments</h2><span style={{color:'#64748b',fontSize:12}}>{rows.length} tracking numbers • {currentUser?.displayName||'Private access'}</span></div>
        <button style={{...btn,background:'#e7eefb',color:'#224f9b'}} onClick={load} disabled={anythingBusy}>RELOAD RECORDS</button>
      </div>
      <div style={{overflowX:'auto'}}>
        <table style={{borderCollapse:'collapse',width:'100%',minWidth:1100}}>
          <thead><tr>{['S.No.','Tracking No.','Origin','Destination','Tariff (INR)','Booking Date','Out for Delivery','Status','Weight','Last Updated','Actions'].map(label=><th key={label} style={th}>{label}</th>)}</tr></thead>
          <tbody>{rows.length?rows.map((r,i)=><tr key={r.trackingNo}>
            <td style={td}>{i+1}</td>
            <td style={td}><strong>{r.trackingNo}</strong></td>
            <td style={td}>{field(r,'origin')}</td>
            <td style={td}>{field(r,'destination')}</td>
            <td style={td}>{r.tariff?<span>₹{field(r,'tariff')}</span>:'—'}</td>
            <td style={td}>{field(r,'bookingDate')}</td>
            <td style={td}>{r.outForDelivery?'YES'+(r.outForDeliveryAt?' • '+r.outForDeliveryAt:''):r.delivered?'COMPLETED':'—'}</td>
            <td style={td}><strong style={{color:/delivered/i.test(r.status||'')?'#15803d':/out for delivery/i.test(r.status||'')?'#1d4ed8':'#334155'}}>{formatValue(r.status)}</strong></td>
            <td style={td}>{field(r,'weight')}</td>
            <td style={td}>{field(r,'lastUpdated')}<small style={{display:'block',color:'#64748b',marginTop:4}}>{r.lastChecked?'Checked '+new Date(r.lastChecked).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}):''}</small></td>
            <td style={td}><div style={{display:'flex',gap:6}}>
              <button type="button" style={{...btn,padding:'7px 9px',fontSize:11}} onClick={()=>trackOne(r.trackingNo)} disabled={anythingBusy}>{busy===r.trackingNo?'…':'REFRESH'}</button>
              <a href={'https://myspeedpost.com/track-ems-speedpost?n='+encodeURIComponent(r.trackingNo)+'&sync=true'} target="_blank" rel="noreferrer" style={{...btn,padding:'8px',fontSize:11,background:'#e4edfa',color:'#1d4ed8',textDecoration:'none'}}>SITE ↗</a>
              <button type="button" style={{...btn,padding:'7px 9px',fontSize:11,background:'#b91c1c'}} onClick={()=>remove(r.trackingNo)} disabled={anythingBusy}>DELETE</button>
            </div></td>
          </tr>):<tr><td colSpan={11} style={{...td,textAlign:'center',padding:28,color:'#64748b'}}>Upload a receipt or enter an ED tracking number to add your first Speed Post consignment.</td></tr>}</tbody>
        </table>
      </div>
      <p style={{fontSize:11,color:'#64748b',marginBottom:0}}>Only fields returned by the tracking site are filled. “Previous check” means that field was retained from an earlier successful check. No unverified rate, origin, destination or weight is invented.</p>
    </section>
  </main>;
}
