'use client';
import { useEffect,useState } from 'react';

export default function AirIndiaPrefilledPage(){
  const [awb,setAwb]=useState('');
  const [result,setResult]=useState(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  useEffect(()=>{
    const digits=new URLSearchParams(window.location.search).get('mawb')?.replace(/\D/g,'')||'';
    if(/^098\d{8}$/.test(digits))setAwb(digits);
    else setError('A valid 11-digit Air India MAWB is required.');
  },[]);
  useEffect(()=>{
    if(!/^098\d{8}$/.test(awb))return;
    let cancelled=false;
    setBusy(true);
    fetch('/api/track?mawb='+encodeURIComponent(awb),{cache:'no-store'})
      .then(async response=>{const data=await response.json();if(!response.ok||!data.ok)throw Error(data.trackingError||data.error||'Air India live tracking unavailable');return data.shipment;})
      .then(data=>{if(!cancelled)setResult(data)})
      .catch(e=>{if(!cancelled)setError(String(e.message||e))})
      .finally(()=>{if(!cancelled)setBusy(false)});
    return()=>{cancelled=true};
  },[awb]);
  const official='https://aicargoportal.airindia.com/icargoneoportal/app/main/#/app';
  return <main style={{maxWidth:780,margin:'36px auto',padding:24,fontFamily:'Arial,sans-serif',color:'#172337'}}>
    <h1>Air India Cargo — MAWB Tracking</h1>
    <p>MAWB is automatically filled from Mayavi and live tracking is retrieved from the existing Air India tracking adapter.</p>
    <label htmlFor="mawb" style={{fontWeight:700}}>AWB Number</label>
    <input id="mawb" value={awb} readOnly style={{display:'block',width:'100%',boxSizing:'border-box',padding:14,fontSize:20,fontWeight:700,marginTop:8,border:'1px solid #b8c2d2',borderRadius:9}}/>
    {busy&&<p role="status">Reading Air India official tracking details…</p>}
    {error&&<p role="alert" style={{color:'#b91c1c'}}>{error}</p>}
    {result&&<section style={{padding:18,marginTop:20,border:'1px solid #ccd5df',borderRadius:10}}>
      <h2>Live shipment details</h2>
      <dl style={{display:'grid',gridTemplateColumns:'150px 1fr',gap:10}}>
        {Object.entries({Status:result.status,Origin:result.origin,Destination:result.destination,Flight:result.flightNo,'Bags / Pieces':result.bags||result.pieces,Weight:result.weight?' '+result.weight+' kg':'','Arrival Date':result.arrivalDate,'Arrival Time':result.arrivalTime}).map(([label,value])=><div key={label} style={{display:'contents'}}><dt style={{fontWeight:700}}>{label}</dt><dd style={{margin:0}}>{value||'—'}</dd></div>)}
      </dl>
    </section>}
    <div style={{marginTop:22,display:'flex',gap:12,flexWrap:'wrap'}}>
      <button onClick={()=>navigator.clipboard?.writeText(awb)} style={{padding:'12px 16px',cursor:'pointer'}}>Copy MAWB</button>
      <a href={official} target="_blank" rel="noopener noreferrer" style={{padding:'12px 16px',background:'#154fb2',borderRadius:8,color:'#fff',textDecoration:'none'}}>Open Air India Official Portal</a>
    </div>
    <p style={{fontSize:12,color:'#64748b',marginTop:16}}>This is a Mayavi prefilled tracking view, not an Air India website form. The official portal may still require manual entry.</p>
  </main>;
}
