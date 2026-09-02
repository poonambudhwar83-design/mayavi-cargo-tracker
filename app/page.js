'use client';
import { useEffect, useMemo, useState } from 'react';

const KEY='mayavi_v2_shipments';
const airlineNames={'057':'Air France KLM','065':'Saudia Cargo','098':'Air India Cargo','157':'Qatar Airways Cargo','160':'Cathay Cargo','176':'Emirates SkyCargo','235':'Turkish Cargo'};
function normalize(v=''){const d=String(v).replace(/\D/g,'');return d.length===11?`${d.slice(0,3)}-${d.slice(3)}`:''}
function tone(status=''){const s=status.toUpperCase();if(s.includes('ARRIVED')||s.includes('DELIVERED')||s.includes('DESTINATION'))return'arrived';if(s.includes('DELAY'))return'delayed';if(s.includes('TRANSIT')||s.includes('DEPART'))return'transit';if(s.includes('BOOK'))return'booked';return'checking'}

export default function Page(){
 const [rows,setRows]=useState([]),[mawb,setMawb]=useState(''),[client,setClient]=useState(''),[busy,setBusy]=useState(false),[note,setNote]=useState('');
 useEffect(()=>{try{setRows(JSON.parse(localStorage.getItem(KEY)||'[]'))}catch{}},[]);
 useEffect(()=>{if(typeof window!=='undefined')localStorage.setItem(KEY,JSON.stringify(rows))},[rows]);
 const stats=useMemo(()=>({total:rows.length,arrived:rows.filter(x=>/ARRIVED|DELIVERED|DESTINATION/i.test(x.status)).length,transit:rows.filter(x=>/TRANSIT|DEPART/i.test(x.status)).length,checking:rows.filter(x=>!/ARRIVED|DELIVERED|DESTINATION|TRANSIT|DEPART/i.test(x.status)).length}),[rows]);
 async function track(one){
   const n=normalize(one); if(!n)throw new Error('Enter valid 11-digit MAWB.');
   const res=await fetch('/api/track',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({mawb:n})});
   const data=await res.json(); if(!data.ok)throw new Error(data.trackingError||data.error||'Tracking failed'); return data.shipment;
 }
 async function add(){
   const n=normalize(mawb);if(!n){setNote('Please enter valid 11-digit MAWB.');return}setBusy(true);setNote(`Tracking ${n} from official airline website…`);
   try{const s=await track(n);setRows(r=>[{...s,clientName:client,lastChecked:new Date().toISOString()},...r.filter(x=>x.mawb!==n)]);setMawb('');setClient('');setNote(`${n} updated successfully.`)}catch(e){const prefix=n.slice(0,3);setRows(r=>[{mawb:n,clientName:client,airlineName:airlineNames[prefix]||'',status:'CHECKING',trackingError:e.message,lastChecked:new Date().toISOString()},...r.filter(x=>x.mawb!==n)]);setNote(e.message)}finally{setBusy(false)}
 }
 async function refresh(index){const row=rows[index];setNote(`Refreshing ${row.mawb}…`);try{const s=await track(row.mawb);setRows(r=>r.map((x,i)=>i===index?{...x,...s,clientName:x.clientName,lastChecked:new Date().toISOString(),trackingError:''}:x));setNote(`${row.mawb} refreshed.`)}catch(e){setRows(r=>r.map((x,i)=>i===index?{...x,trackingError:e.message,lastChecked:new Date().toISOString()}:x));setNote(e.message)}}
 async function refreshAll(){setBusy(true);for(let i=0;i<rows.length;i++)await refresh(i);setBusy(false)}
 function remove(i){setRows(r=>r.filter((_,x)=>x!==i))}
 return <main>
   <section className="hero"><div><div className="eyebrow">MAYAVI CARGO • V2</div><h1>MAWB Live Tracker</h1><p>Official-airline-first tracking. Enter one MAWB and the carrier is identified automatically from its prefix.</p></div><div className="version">CLEAN BUILD</div></section>
   <section className="stats"><div><b>{stats.total}</b><span>Total MAWB</span></div><div><b>{stats.transit}</b><span>In Transit</span></div><div><b>{stats.arrived}</b><span>Arrived</span></div><div><b>{stats.checking}</b><span>Checking</span></div></section>
   <section className="entry"><div><label>MAWB NUMBER</label><input value={mawb} onChange={e=>setMawb(e.target.value)} placeholder="235-12345678" onKeyDown={e=>e.key==='Enter'&&add()}/></div><div><label>CLIENT NAME</label><input value={client} onChange={e=>setClient(e.target.value)} placeholder="Optional client name"/></div><button disabled={busy} onClick={add}>{busy?'TRACKING…':'ADD + LIVE TRACK'}</button><button className="secondary" disabled={busy||!rows.length} onClick={refreshAll}>REFRESH ALL</button></section>
   {note&&<div className="note">{note}</div>}
   <section className="tableWrap"><table><thead><tr><th>MAWB</th><th>Client</th><th>Airline</th><th>Origin</th><th>Destination</th><th>Flight</th><th>Bags</th><th>Weight</th><th>Arrival Date</th><th>Arrival Time</th><th>Status</th><th>Action</th></tr></thead><tbody>{rows.length?rows.map((r,i)=><tr key={r.mawb}><td><strong>{r.mawb}</strong>{r.trackingError&&<small className="err">{r.trackingError}</small>}</td><td>{r.clientName||'—'}</td><td>{r.airlineName||'—'}</td><td>{r.origin||'—'}</td><td>{r.destination||'—'}</td><td>{r.flightNo||'—'}</td><td>{r.bags||r.pieces||'—'}</td><td>{r.weight?`${r.weight} kg`:'—'}</td><td>{r.arrivalDate||'—'}</td><td>{r.arrivalTime||'—'}</td><td><span className={`badge ${tone(r.status)}`}>{r.status||'CHECKING'}</span></td><td><div className="actions"><button onClick={()=>refresh(i)}>↻</button><button onClick={()=>remove(i)}>×</button></div></td></tr>):<tr><td colSpan="12" className="empty">No MAWB added yet.</td></tr>}</tbody></table></section>
   <footer>V2 carrier adapters active: Turkish 235 • Emirates 176 • Cathay 160 • Qatar 157 • Saudia 065 • Air France 057 • Air India 098</footer>
 </main>
}
