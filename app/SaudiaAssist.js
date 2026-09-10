'use client';
import {useState} from 'react';

const normalize=v=>{const d=String(v||'').replace(/\D/g,'');return d.length===11?`${d.slice(0,3)}-${d.slice(3)}`:''};
function fileToDataUrl(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result||''));r.onerror=()=>reject(r.error||new Error('Could not read screenshot'));r.readAsDataURL(file);});}

export default function SaudiaAssist(){
  const [open,setOpen]=useState(false),[mawb,setMawb]=useState(''),[clientName,setClientName]=useState(''),[file,setFile]=useState(null),[busy,setBusy]=useState(false),[note,setNote]=useState('');
  async function save(){
    const n=normalize(mawb);
    if(!n||!n.startsWith('065-')){setNote('Enter a valid Saudia 065 MAWB.');return;}
    if(!file){setNote('Upload the Saudia result-card screenshot shown after Submit.');return;}
    setBusy(true);setNote('Reading Saudia result card…');
    try{
      const image=await fileToDataUrl(file);
      const res=await fetch('/api/saudia-screenshot',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({mawb:n,clientName:clientName.trim(),images:[image]})});
      const data=await res.json();
      if(!data.ok)throw new Error(data.error||'Could not read Saudia result card.');
      const s=data.shipment||{};
      setNote(`${n}: ${s.destination||'—'} • ${s.bags||s.pieces||'—'} bags • ${s.weight||'—'} kg • ${s.flightNo||'—'} • ${s.flightDate||'—'} • ${s.status||'—'}`);
      setTimeout(()=>window.location.reload(),1100);
    }catch(e){setNote(e.message||String(e));}finally{setBusy(false);}
  }
  const button={border:'1px solid #cfd7e5',background:'#fff',borderRadius:9,padding:'8px 12px',fontWeight:800,cursor:'pointer',fontSize:12};
  const back={position:'fixed',inset:0,zIndex:120,background:'rgba(0,0,0,.5)',display:'flex',alignItems:'center',justifyContent:'center',padding:18};
  const card={width:'min(500px,100%)',background:'#fff',borderRadius:18,padding:22,boxShadow:'0 18px 55px rgba(0,0,0,.28)'};
  const input={width:'100%',boxSizing:'border-box',margin:'6px 0 12px'};
  return <>
    <button type="button" style={button} onClick={()=>{setOpen(true);setNote('')}}>SAUDIA RESULT</button>
    {open&&<div style={back}><section style={card}>
      <div className="eyebrow">SAUDIA CARGO • VERIFIED RESULT</div>
      <h2 style={{margin:'8px 0'}}>Fill Saudia Fields</h2>
      <p style={{marginTop:0}}>Open Saudia tracking, enter the AWB and press Submit. Then upload the result-card screenshot here. Mayavi will fill Status, Destination, Pieces/Bags, Weight, Flight No. and Flight Date.</p>
      <button type="button" onClick={()=>window.open('https://saudiacargo.com/en/digital-services?tab=trackShipment','_blank','noopener,noreferrer')} style={{...button,marginBottom:12}}>OPEN SAUDIA TRACKING</button>
      <label>SAUDIA MAWB</label>
      <input style={input} value={mawb} onChange={e=>setMawb(e.target.value)} placeholder="065-39009725"/>
      <label>CLIENT NAME <span style={{fontWeight:400}}>(only needed if MAWB is not already in Mayavi)</span></label>
      <input style={input} value={clientName} onChange={e=>setClientName(e.target.value)} placeholder="Client name"/>
      <label>RESULT-CARD SCREENSHOT</label>
      <input style={input} type="file" accept="image/*" onChange={e=>setFile(e.target.files?.[0]||null)}/>
      {note&&<div className="loginNote" style={{margin:'8px 0'}}>{note}</div>}
      <div style={{display:'flex',gap:10,marginTop:12}}>
        <button disabled={busy} onClick={save} style={{flex:1}}>{busy?'READING…':'READ & FILL MAYAVI'}</button>
        <button disabled={busy} onClick={()=>setOpen(false)} style={{flex:1}}>CLOSE</button>
      </div>
      <small style={{display:'block',marginTop:12}}>Status mapping: BKD → BOOKED • DLV → ARRIVED • XXX → IN TRANSIT. Flight No. and Flight Date are saved with the shipment.</small>
    </section></div>}
  </>;
}
