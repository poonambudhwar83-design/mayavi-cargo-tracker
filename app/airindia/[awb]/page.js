'use client';
import {useEffect,useState} from 'react';
import {useParams} from 'next/navigation';

const AIR_INDIA_URL='https://cargo.airindia.com/in/en/track-shipment.html';
const card={background:'#fff',padding:20,borderRadius:14,border:'1px solid #dbe3ef',marginTop:16};
const action={border:'1px solid #cbd5e1',borderRadius:8,padding:'10px 13px',background:'#fff',color:'#1d4ed8',fontWeight:800,textDecoration:'none',display:'inline-block',cursor:'pointer',fontSize:13};
const show=value=>String(value??'').trim()||'—';

export default function AirIndiaOneClickPage(){
  const params=useParams();
  const number=String(params?.awb||'').replace(/\D/g,'');
  const mawb=/^098\d{8}$/.test(number)?`098-${number.slice(3)}`:'';
  const [reload,setReload]=useState(0);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const [data,setData]=useState(null);
  useEffect(()=>{
    if(!mawb)return;
    const controller=new AbortController();
    (async()=>{
      setLoading(true);setError('');setData(null);
      try{
        const res=await fetch(`/api/track?mawb=${encodeURIComponent(mawb)}`,{cache:'no-store',credentials:'include',signal:controller.signal});
        const json=await res.json();
        if(!res.ok||!json.ok)throw new Error(json.trackingError||json.error||'Air India live tracking unavailable');
        if(!controller.signal.aborted)setData(json);
      }catch(e){if(!controller.signal.aborted)setError(e?.message||'Could not reach the official tracking reader.');}
      finally{if(!controller.signal.aborted)setLoading(false);}
    })();
    return()=>controller.abort();
  },[mawb,reload]);
  const s=data?.shipment;
  const info=s?[
    ['Status',s.status],['Booking Date',s.bookingDate],['Origin',s.origin],['Destination',s.destination],
    ['Flight',s.flightNo],['Bags / Pieces',s.bags||s.pieces],['Weight (kg)',s.weight],
    ['Departure Date',s.departureDate||s.flightDate],['Departure Time (IST)',s.departureTime],
    ['Arrival Date',s.arrivalDate],['Arrival Time (IST)',s.arrivalTime],
    ['Scheduled Arrival Date',s.scheduledArrivalDate],['Scheduled Arrival Time (IST)',s.scheduledArrivalTime],
    ['Last Checked',s.lastChecked]
  ]:[];
  return <main style={{background:'#f3f6fb',minHeight:'100vh',padding:'clamp(16px,4vw,40px)',fontFamily:'Arial,sans-serif',color:'#1e293b'}}>
    <div style={{maxWidth:930,margin:'auto'}}>
      <a href="/" style={action}>← Back to Mayavi</a>
      <h1>Air India Cargo · One-Click Tracking</h1>
      <p style={{lineHeight:1.5,color:'#475569'}}>Mayavi automatically enters this MAWB into its official Air India tracking reader and displays the live result here. This is a Mayavi view, not the Air India website.</p>
      <section style={card}>
        <div style={{fontSize:12,color:'#64748b',fontWeight:800}}>MAWB</div>
        <h2 style={{fontSize:28,margin:'8px 0 14px'}}>{mawb||'Invalid Air India MAWB'}</h2>
        <div style={{display:'flex',flexWrap:'wrap',gap:8}}>
          <button disabled={!mawb||loading} onClick={()=>setReload(v=>v+1)} style={{...action,background:'#1d4ed8',color:'#fff',opacity:loading?0.7:1}}>{loading?'Reading Air India…':'Refresh live tracking'}</button>
          <button disabled={!mawb} style={action} onClick={()=>{if(mawb)navigator.clipboard?.writeText(number).catch(()=>{});}}>Copy MAWB</button>
          <a href={AIR_INDIA_URL} target="_blank" rel="noopener noreferrer" style={action}>Air India official website ↗</a>
        </div>
        {loading&&<p role="status">Retrieving current shipment details from the airline's live portal. This can take some time.</p>}
        {error&&<p role="alert" style={{color:'#b91c1c'}}>{error}. You can also open the official website above.</p>}
        {!mawb&&<p style={{color:'#b91c1c'}}>Air India MAWB must start with 098 and contain eleven digits.</p>}
      </section>
      {s&&<section style={card}>
        <h2 style={{marginTop:0}}>Shipment tracking details</h2>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(165px,1fr))',gap:10}}>
          {info.map(([label,value])=><div key={label} style={{background:'#f8fafc',border:'1px solid #e2e8f0',borderRadius:8,padding:12,overflowWrap:'anywhere'}}>
            <div style={{fontSize:11,fontWeight:800,color:'#64748b',marginBottom:6}}>{label}</div>
            <strong>{show(value)}</strong>
          </div>)}
        </div>
        {Array.isArray(s.partShipments)&&s.partShipments.length>0&&<div style={{marginTop:16}}>
          <h3>Part shipment updates</h3>
          {s.partShipments.map((part,i)=><p key={part.partId||i}>Part {i+1}: {show(part.pieces)} pieces, {show(part.weight)} kg • Flight {show(part.flightNo)} • Arrival {show(part.arrivalDate)} {show(part.arrivalTime)}</p>)}
        </div>}
        <p style={{fontSize:12,color:'#64748b'}}>Source: {show(data.provider||'Air India official tracking reader')}. A scheduled arrival is not proof of physical arrival.</p>
      </section>}
    </div>
  </main>;
}
