'use client';
import { useState } from 'react';

const back={position:'fixed',inset:0,zIndex:120,background:'rgba(0,0,0,.5)',display:'grid',placeItems:'center',padding:18,overflowY:'auto'};
const card={width:'min(540px,100%)',maxHeight:'90vh',overflowY:'auto',background:'#fff',borderRadius:18,padding:22,boxShadow:'0 18px 55px rgba(0,0,0,.3)',position:'relative'};
const btn={border:'1px solid #cfd7e5',background:'#fff',borderRadius:9,padding:'8px 12px',fontWeight:800,cursor:'pointer',fontSize:12};
const closeBtn={position:'sticky',top:0,float:'right',zIndex:2,width:34,height:34,border:'1px solid #d0d5dd',borderRadius:999,background:'#fff',fontWeight:900,cursor:'pointer'};
const inputStyle={width:'100%',height:44,border:'1px solid #cbd5e1',borderRadius:9,padding:'0 11px',boxSizing:'border-box'};
function norm(v=''){const d=String(v).replace(/\D/g,'');return d.length===11?`${d.slice(0,3)}-${d.slice(3)}`:''}
function toBase64(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result||''));r.onerror=reject;r.readAsDataURL(file)})}

export default function SaudiaAssist(){
  const [open,setOpen]=useState(false),[mawb,setMawb]=useState(''),[clientName,setClientName]=useState(''),[shipmentType,setShipmentType]=useState('IMPORT'),[files,setFiles]=useState([]),[busy,setBusy]=useState(false),[note,setNote]=useState('');
  function openOfficial(){
    const n=norm(mawb);if(!n||!n.startsWith('065-')){setNote('Enter valid Saudia 065 MAWB first.');return}
    try{navigator.clipboard?.writeText(n.replace(/\D/g,'')).catch(()=>{})}catch{}
    window.open('https://china.saudiacargo.com/e-services/track-shipment','_blank','noopener,noreferrer');
    setNote('AWB copied. On Saudia: first translate page to English → paste AWB → Arrow → More Information → take screenshot → return here and upload it.');
  }
  async function upload(){
    const n=norm(mawb);if(!n||!n.startsWith('065-')){setNote('Enter valid Saudia 065 MAWB.');return}
    if(!String(clientName).trim()){setNote('Client Name is mandatory.');return}
    if(!files.length){setNote('Choose the screenshot taken after opening More Information.');return}
    setBusy(true);setNote('Reading Saudia More Information screenshot…');
    try{
      const images=[];for(const f of files.slice(0,5))images.push(await toBase64(f));
      const res=await fetch('/api/saudia-screenshot',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({mawb:n,clientName:String(clientName).trim(),shipmentType,images})});
      const data=await res.json();if(!data.ok)throw new Error(data.error||'Saudia screenshot read failed.');
      const s=data.shipment||{};
      setNote(`Saved to Mayavi: ${s.status||'TRACKING'}${s.destination?` • ${s.destination}`:''}${s.bags?` • ${s.bags} bags`:''}${s.weight?` • ${s.weight} kg`:''}${s.bookingDate?` • Booking ${s.bookingDate}`:''}${s.arrivalDate?` • Arrival ${s.arrivalDate}`:''}${s.arrivalTime?` ${s.arrivalTime}`:''}. Refreshing dashboard…`);
      setTimeout(()=>window.location.reload(),1400);
    }catch(e){setNote(e.message||'Saudia screenshot read failed.')}finally{setBusy(false)}
  }
  return <>
    <button style={btn} onClick={()=>{setOpen(true);setNote('')}}>SAUDIA RESULT</button>
    {open&&<div style={back} onMouseDown={e=>{if(e.target===e.currentTarget)setOpen(false)}}><section style={card}>
      <button aria-label="Close Saudia window" title="Close" style={closeBtn} disabled={busy} onClick={()=>setOpen(false)}>×</button>
      <div style={{fontSize:12,fontWeight:900,letterSpacing:1.2,color:'#164da3'}}>SAUDIA CARGO • OFFICIAL RESULT</div>
      <h2 style={{margin:'8px 0'}}>Saudia Screenshot Tracking</h2>
      <p style={{marginTop:0,color:'#667085',lineHeight:1.5}}>Use the normal Saudia browser result. Mayavi reads the screenshot taken only after <b>More Information</b> is open and saves the verified fields.</p>

      <label style={{display:'block',fontSize:11,fontWeight:900,margin:'12px 0 5px'}}>SAUDIA MAWB</label>
      <input value={mawb} onChange={e=>setMawb(e.target.value)} placeholder="065-XXXXXXXX" style={inputStyle}/>
      <label style={{display:'block',fontSize:11,fontWeight:900,margin:'12px 0 5px'}}>CLIENT NAME *</label>
      <input value={clientName} onChange={e=>setClientName(e.target.value)} placeholder="Mandatory client name" style={inputStyle}/>
      <label style={{display:'block',fontSize:11,fontWeight:900,margin:'12px 0 5px'}}>SHIPMENT TYPE</label>
      <select value={shipmentType} onChange={e=>setShipmentType(e.target.value)} style={inputStyle}><option value="IMPORT">IMPORT</option><option value="EXPORT">EXPORT</option></select>

      <button style={{...btn,width:'100%',marginTop:12}} onClick={openOfficial}>COPY AWB + OPEN SAUDIA OFFICIAL ↗</button>
      <div style={{marginTop:12,padding:11,borderRadius:10,background:'#fff7ed',border:'1px solid #fed7aa',fontSize:13,lineHeight:1.65}}>
        <b>Exact flow:</b><br/>
        1. Open Saudia link<br/>
        2. Translate page into <b>English</b><br/>
        3. Fill AWB<br/>
        4. Click <b>Arrow</b><br/>
        5. Click <b>More Information</b><br/>
        6. Take screenshot<br/>
        7. Upload screenshot here → Mayavi fills the tracker
      </div>

      <label style={{display:'block',fontSize:11,fontWeight:900,margin:'14px 0 5px'}}>UPLOAD MORE INFORMATION SCREENSHOT</label>
      <input type="file" accept="image/*" multiple onChange={e=>setFiles([...e.target.files])}/>
      <small style={{display:'block',marginTop:8,color:'#667085',lineHeight:1.45}}>Mayavi reads: right-side <b>State</b> for status, <b>Total number of pieces</b> as Bags, left-side <b>Weight</b>, Segment 1 date as Booking Date, Destination, and Arrival Date/Time when shown. If arrival time is not shown, it stays blank.</small>
      {note&&<div style={{marginTop:12,padding:10,borderRadius:9,background:'#edf4ff',color:'#224d87'}}>{note}</div>}
      <div style={{display:'flex',gap:10,marginTop:16}}><button style={{...btn,flex:1,background:'#164da3',color:'#fff'}} disabled={busy} onClick={upload}>{busy?'READING…':'READ & SAVE TO MAYAVI'}</button><button style={{...btn,flex:1}} disabled={busy} onClick={()=>setOpen(false)}>CLOSE</button></div>
    </section></div>}
  </>;
}
