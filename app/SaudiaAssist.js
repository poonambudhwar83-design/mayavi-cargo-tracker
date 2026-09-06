'use client';
import { useState } from 'react';

const back={position:'fixed',inset:0,zIndex:120,background:'rgba(0,0,0,.5)',display:'grid',placeItems:'center',padding:18};
const card={width:'min(520px,100%)',background:'#fff',borderRadius:18,padding:22,boxShadow:'0 18px 55px rgba(0,0,0,.3)'};
const btn={border:'1px solid #cfd7e5',background:'#fff',borderRadius:9,padding:'8px 12px',fontWeight:800,cursor:'pointer',fontSize:12};
function norm(v=''){const d=String(v).replace(/\D/g,'');return d.length===11?`${d.slice(0,3)}-${d.slice(3)}`:''}
function toBase64(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result||''));r.onerror=reject;r.readAsDataURL(file)})}

export default function SaudiaAssist(){
  const [open,setOpen]=useState(false),[mawb,setMawb]=useState(''),[files,setFiles]=useState([]),[busy,setBusy]=useState(false),[note,setNote]=useState('');
  function openOfficial(){const n=norm(mawb);if(!n||!n.startsWith('065-')){setNote('Enter valid Saudia 065 MAWB first.');return}try{navigator.clipboard?.writeText(n.replace(/\D/g,'')).catch(()=>{})}catch{}window.open('https://china.saudiacargo.com/e-services/track-shipment','_blank','noopener,noreferrer');setNote('AWB copied. On Saudia: paste AWB → click arrow → click the red + sign on the shipment card → scroll to the latest/bottom timeline → take screenshot(s).');}
  async function upload(){const n=norm(mawb);if(!n||!n.startsWith('065-')){setNote('Enter valid Saudia 065 MAWB.');return}if(!files.length){setNote('Choose at least one Saudia result screenshot.');return}setBusy(true);setNote('Reading Saudia timeline…');try{const images=[];for(const f of files.slice(0,5))images.push(await toBase64(f));const res=await fetch('/api/saudia-screenshot',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({mawb:n,images})});const data=await res.json();if(!data.ok)throw new Error(data.error||'Saudia screenshot read failed.');const s=data.shipment||{};setNote(`Saved: ${s.status||'TRACKING'}${s.arrivalDate?` • Arrival ${s.arrivalDate}`:''}${s.arrivalTime?` ${s.arrivalTime}`:''}. Refreshing dashboard…`);setTimeout(()=>window.location.reload(),1200)}catch(e){setNote(e.message||'Saudia screenshot read failed.')}finally{setBusy(false)}}
  return <>
    <button style={btn} onClick={()=>{setOpen(true);setNote('')}}>SAUDIA RESULT</button>
    {open&&<div style={back}><section style={card}>
      <div style={{fontSize:12,fontWeight:900,letterSpacing:1.2,color:'#164da3'}}>SAUDIA CARGO • OFFICIAL RESULT</div>
      <h2 style={{margin:'8px 0'}}>Saudia Screenshot Tracking</h2>
      <p style={{marginTop:0,color:'#667085',lineHeight:1.5}}>Saudia uses invisible reCAPTCHA, so the official result must open in the normal browser. Mayavi will read the official result screenshot and save the timeline details.</p>
      <label style={{display:'block',fontSize:11,fontWeight:900,margin:'12px 0 5px'}}>SAUDIA MAWB</label>
      <input value={mawb} onChange={e=>setMawb(e.target.value)} placeholder="065-XXXXXXXX" style={{width:'100%',height:44,border:'1px solid #cbd5e1',borderRadius:9,padding:'0 11px'}}/>
      <button style={{...btn,width:'100%',marginTop:10}} onClick={openOfficial}>COPY AWB + OPEN SAUDIA OFFICIAL ↗</button>
      <div style={{marginTop:12,padding:11,borderRadius:10,background:'#fff7ed',border:'1px solid #fed7aa',fontSize:13,lineHeight:1.5}}><b>Exact steps:</b> AWB → Arrow → <b>red + sign</b> → latest/bottom timeline → screenshot.</div>
      <label style={{display:'block',fontSize:11,fontWeight:900,margin:'14px 0 5px'}}>UPLOAD RESULT SCREENSHOT(S)</label>
      <input type="file" accept="image/*" multiple onChange={e=>setFiles([...e.target.files])}/>
      <small style={{display:'block',marginTop:8,color:'#667085'}}>For long timelines, upload the screenshot showing the latest/bottom segment. You may upload up to 5 screenshots.</small>
      {note&&<div style={{marginTop:12,padding:10,borderRadius:9,background:'#edf4ff',color:'#224d87'}}>{note}</div>}
      <div style={{display:'flex',gap:10,marginTop:16}}><button style={{...btn,flex:1,background:'#164da3',color:'#fff'}} disabled={busy} onClick={upload}>{busy?'READING…':'READ & SAVE'}</button><button style={{...btn,flex:1}} disabled={busy} onClick={()=>setOpen(false)}>CLOSE</button></div>
    </section></div>}
  </>;
}
