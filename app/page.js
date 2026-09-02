'use client';
import { useEffect, useMemo, useState } from 'react';
import { airlineForMawb, CONFIGURED_PREFIXES } from '../lib/airlines.js';

const KEY='mayavi_v3_shipments';
function normalize(v=''){const d=String(v).replace(/\D/g,'');return d.length===11?`${d.slice(0,3)}-${d.slice(3)}`:''}
function tone(status=''){const s=status.toUpperCase();if(s.includes('ARRIVED')||s.includes('DELIVERED')||s.includes('DESTINATION'))return'arrived';if(s.includes('DELAY'))return'delayed';if(s.includes('TRANSIT')||s.includes('DEPART'))return'transit';if(s.includes('BOOK'))return'booked';return'checking'}

export default function Page(){
 const [rows,setRows]=useState([]),[mawb,setMawb]=useState(''),[client,setClient]=useState(''),[busy,setBusy]=useState(false),[note,setNote]=useState('');
 useEffect(()=>{try{setRows(JSON.parse(localStorage.getItem(KEY)||'[]'))}catch{}},[]);
 useEffect(()=>{if(typeof window!=='undefined')localStorage.setItem(KEY,JSON.stringify(rows))},[rows]);
 const stats=useMemo(()=>({total:rows.length,arrived:rows.filter(x=>/ARRIVED|DELIVERED|DESTINATION/i.test(x.status)).length,transit:rows.filter(x=>/TRANSIT|DEPART/i.test(x.status)).length,checking:rows.filter(x=>!/ARRIVED|DELIVERED|DESTINATION|TRANSIT|DEPART/i.test(x.status)).length}),[rows]);
 async function track(one){
   const n=normalize(one);if(!n)throw new Error('Enter valid 11-digit MAWB.');
   const res=await fetch('/api/track',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({mawb:n})});
   const data=await res.json();
   if(!data.ok){const err=new Error(data.trackingError||data.apiError||data.error||'Tracking failed');err.payload=data;throw err}
   return {...data.shipment,provider:data.provider||data.shipment?.source||''};
 }
 async function add(){
   const n=normalize(mawb);if(!n){setNote('Please enter valid 11-digit MAWB.');return}
   const airline=airlineForMawb(n);if(!airline){setNote(`Prefix ${n.slice(0,3)} is not mapped yet.`);return}
   setBusy(true);setNote(`Tracking ${n} — ${airline.name}…`);
   try{const s=await track(n);setRows(r=>[{...s,clientName:client,lastChecked:new Date().toISOString()},...r.filter(x=>x.mawb!==n)]);setMawb('');setClient('');setNote(`${n} updated successfully.`)}
   catch(e){const p=e.payload||{};setRows(r=>[{mawb:n,clientName:client,airlineName:airline.name,status:'CHECKING',officialTracker:p.officialTracker||airline.url,trackingError:e.message,lastChecked:new Date().toISOString()},...r.filter(x=>x.mawb!==n)]);setNote(`${e.message}${(p.officialTracker||airline.url)?' — official tracker available in Action.':''}`)}finally{setBusy(false)}
 }
 async function refresh(index){const row=rows[index];setNote(`Refreshing ${row.mawb}…`);try{const s=await track(row.mawb);setRows(r=>r.map((x,i)=>i===index?{...x,...s,clientName:x.clientName,lastChecked:new Date().toISOString(),trackingError:''}:x));setNote(`${row.mawb} refreshed.`)}catch(e){const p=e.payload||{};setRows(r=>r.map((x,i)=>i===index?{...x,officialTracker:p.officialTracker||x.officialTracker,trackingError:e.message,lastChecked:new Date().toISOString()}:x));setNote(e.message)}}
 async function refreshAll(){setBusy(true);for(let i=0;i<rows.length;i++)await refresh(i);setBusy(false)}
 function remove(i){setRows(r=>r.filter((_,x)=>x!==i))}
 return <main>
   <section className="hero"><div><div className="eyebrow">MAYAVI CARGO • V3.4</div><h1>Global MAWB Live Tracker</h1><p>Enter one MAWB. Mayavi identifies the airline, checks global cargo data when configured, then uses dedicated official carrier adapters. If an airline blocks automation, the correct official tracker stays one click away.</p></div><div className="version">LIVE TRACKING</div></section>
   <section className="stats"><div><b>{stats.total}</b><span>Total MAWB</span></div><div><b>{stats.transit}</b><span>In Transit</span></div><div><b>{stats.arrived}</b><span>Arrived</span></div><div><b>{stats.checking}</b><span>Checking</span></div></section>
   <section className="entry"><div><label>MAWB NUMBER</label><input value={mawb} onChange={e=>setMawb(e.target.value)} placeholder="e.g. 020-12345678" onKeyDown={e=>e.key==='Enter'&&add()}/></div><div><label>CLIENT NAME</label><input value={client} onChange={e=>setClient(e.target.value)} placeholder="Optional client name"/></div><button disabled={busy} onClick={add}>{busy?'TRACKING…':'ADD + LIVE TRACK'}</button><button className="secondary" disabled={busy||!rows.length} onClick={refreshAll}>REFRESH ALL</button></section>
   {note&&<div className="note">{note}</div>}
   <section className="tableWrap"><table><thead><tr><th>MAWB</th><th>Client</th><th>Airline</th><th>Origin</th><th>Destination</th><th>Flight</th><th>Bags/Pieces</th><th>Weight</th><th>Arrival Date</th><th>Arrival Time</th><th>Status</th><th>Action</th></tr></thead><tbody>{rows.length?rows.map((r,i)=><tr key={r.mawb}><td><strong>{r.mawb}</strong>{r.trackingError&&<small className="err">{r.trackingError}</small>}</td><td>{r.clientName||'—'}</td><td>{r.airlineName||'—'}</td><td>{r.origin||'—'}</td><td>{r.destination||'—'}</td><td>{r.flightNo||'—'}</td><td>{r.bags||r.pieces||'—'}</td><td>{r.weight?`${r.weight} kg`:'—'}</td><td>{r.arrivalDate||'—'}</td><td>{r.arrivalTime||'—'}</td><td><span className={`badge ${tone(r.status)}`}>{r.status||'CHECKING'}</span></td><td><div className="actions"><button title="Refresh" onClick={()=>refresh(i)}>↻</button>{r.officialTracker&&<a className="trackLink" href={r.officialTracker} target="_blank" rel="noreferrer" title="Open official airline tracker">↗</a>}<button title="Remove" onClick={()=>remove(i)}>×</button></div></td></tr>):<tr><td colSpan="12" className="empty">No MAWB added yet.</td></tr>}</tbody></table></section>
   <footer>{CONFIGURED_PREFIXES.length} airline prefixes mapped • Dedicated official adapters: Lufthansa 020 • Saudia 065 • Cathay 160 • Global API provider ready for remaining carriers</footer>
 </main>
}
