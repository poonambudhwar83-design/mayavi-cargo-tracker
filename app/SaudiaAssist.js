'use client';
import {useState} from 'react';

const normalize=v=>{const d=String(v||'').replace(/\D/g,'');return d.length===11?`${d.slice(0,3)}-${d.slice(3)}`:''};
function fileToDataUrl(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result||''));r.onerror=()=>reject(r.error||new Error('Could not read screenshot'));r.readAsDataURL(file);});}

export default function SaudiaAssist(){
  const [open,setOpen]=useState(false),[mawb,setMawb]=useState(''),[file,setFile]=useState(null),[busy,setBusy]=useState(false),[note,setNote]=useState('');
  async function save(){
    const n=normalize(mawb);
    if(!n||!n.startsWith('065-')){setNote('Enter a valid Saudia 065 MAWB.');return;}
    if(!file){setNote('Upload the Saudia result-card screenshot shown after Submit.');return;}
    setBusy(true);setNote('Reading Saudia result card…');
    try{
      const image=await fileToDataUrl(file);
      const res=await fetch('/api/saudia-screenshot',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({mawb:n,images:[image]})});
      const data=await res.json();
      if(!data.ok)throw new Error(data.error||'Could not read Saudia result card.');
      const s=data.shipment||{};
      setNote(`${n}: ${s.destination||'—'} • ${s.bags||s.pieces||'—'} bags • ${s.weight||'—'} kg • ${s.flightNo||'—'} • ${s.status||'—'}`);
      setTimeout(()=>window.location.reload(),900);
    }catch(e){setNote(e.message||String(e));}finally{setBusy(false);}
  }
  const button={border:'1px solid #cfd7e5',background:'#fff',borderRadius:9,padding:'8px 12px',fontWeight:800,cursor:'pointer',fontSize:12};
  const back={position:'fixed',inset:0,zIndex:120,background:'rgba(0,0,0,.5)',display:'flex',alignItems:'center',justifyContent:'center',padding:18};
  const card={width:'min(480px,100%)',background:'#fff',borderRadius:18,padding:22,boxShadow:'0 18px 55px rgba(0,0,0,.28)'};
  const input={width:'100%',boxSizing:'border-box',margin:'6px 0 12px'};
  return <>
    <button type="button" style={button} onClick={()=>{setOpen(true);setNote('')}}>SAUDIA RESULT</button>
    {open&&<div style={back}><section style={card}>
      <div className="eyebrow">SAUDIA • FIRST RESULT CARD</div>
      <h2 style={{margin:'8px 0'}}>Fill Saudia Fields</h2>
      <p style={{marginTop:0}}>After Saudia Submit, upload the screenshot that shows AWB, Destination, Status, Total Pieces, Flight No. and Weight.</p>
      <label>SAUDIA MAWB</label>
      <input style={input} value={mawb} onChange={e=>setMawb(e.target.value)} placeholder="065-11479705"/>
      <label>RESULT-CARD SCREENSHOT</label>
      <input style={input} type="file" accept="image/*" onChange={e=>setFile(e.target.files?.[0]||null)}/>
      {note&&<div className="loginNote" style={{margin:'8px 0'}}>{note}</div>}
      <div style={{display:'flex',gap:10,marginTop:12}}>
        <button disabled={busy} onClick={save} style={{flex:1}}>{busy?'READING…':'READ & FILL MAYAVI'}</button>
        <button disabled={busy} onClick={()=>setOpen(false)} style={{flex:1}}>CLOSE</button>
      </div>
      <small style={{display:'block',marginTop:12}}>Mapping: Total Pieces → Bags • DLV → Arrived • XXX → In Transit • BKD → Booked. Arrival/ETA stays blank for now.</small>
    </section></div>}
  </>;
}
