'use client';
import { useEffect, useMemo, useState } from 'react';
import { airlineForMawb, CONFIGURED_PREFIXES } from '../lib/airlines.js';

const KEY='mayavi_v3_shipments';
const TWO_HOURS=2*60*60*1000;
function normalize(v=''){const d=String(v).replace(/\D/g,'');return d.length===11?`${d.slice(0,3)}-${d.slice(3)}`:''}
function digits(v=''){return String(v).replace(/\D/g,'')}
function pad(v){return String(v).padStart(2,'0')}
function cleanWeight(v=''){return String(v||'').replace(/\s*(kg|kgs|kilograms?)\s*$/i,'').trim()}
function tone(status=''){
  const s=String(status).toUpperCase();
  if(s.includes('DELAY')||s.includes('LATE'))return'delayed';
  if(s.includes('EARLY'))return'early';
  if(s.includes('ARRIVED')||s.includes('DELIVERED')||s.includes('DESTINATION'))return'arrived';
  if(s.includes('TRANSIT')||s.includes('DEPART'))return'transit';
  if(s.includes('BOOK'))return'booked';
  if(s.includes('ON TIME'))return'ontime';
  return'checking';
}
function formatTime12(value=''){
  const s=String(value||'').trim();if(!s)return'';
  if(/\b(?:AM|PM)\b/i.test(s))return s.replace(/\b(am|pm)\b/i,m=>m.toUpperCase());
  const m=s.match(/^(\d{1,2}):([0-5]\d)$/);if(!m)return s;
  const h=Number(m[1]);if(h<0||h>23)return s;
  const suffix=h>=12?'PM':'AM',h12=h%12||12;
  return `${pad(h12)}:${m[2]} ${suffix}`;
}
function dateTimeValue(date='',time=''){
  const dm=String(date).match(/^(\d{4})-(\d{2})-(\d{2})$/),tm=String(time).match(/^(\d{1,2}):(\d{2})/);
  if(!dm||!tm)return null;
  const d=new Date(Number(dm[1]),Number(dm[2])-1,Number(dm[3]),Number(tm[1]),Number(tm[2]),0,0);
  return Number.isFinite(d.getTime())?d:null;
}
function mailTimeFrom(date='',time=''){
  const d=dateTimeValue(date,time);if(!d)return'';
  d.setHours(d.getHours()-5);
  const ds=`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  return `${ds} ${formatTime12(`${pad(d.getHours())}:${pad(d.getMinutes())}`)}`;
}
function decorateTiming(existing={},incoming={}){
  const merged={...existing,...incoming};
  const scheduledArrivalDate=existing.scheduledArrivalDate||incoming.scheduledArrivalDate||existing.arrivalDate||incoming.arrivalDate||'';
  const scheduledArrivalTime=existing.scheduledArrivalTime||incoming.scheduledArrivalTime||existing.arrivalTime||incoming.arrivalTime||'';
  const arrivalDate=incoming.arrivalDate||existing.arrivalDate||'';
  const arrivalTime=incoming.arrivalTime||existing.arrivalTime||'';
  const planned=dateTimeValue(scheduledArrivalDate,scheduledArrivalTime),current=dateTimeValue(arrivalDate,arrivalTime);
  let timingDeltaMinutes=null,timingStatus='';
  if(planned&&current){
    timingDeltaMinutes=Math.round((current-planned)/60000);
    if(timingDeltaMinutes>60)timingStatus='DELAYED';
    else if(timingDeltaMinutes<-60)timingStatus='EARLY';
    else timingStatus='ON TIME';
  }
  let status=incoming.status||existing.status||'TRACKING';
  const arrived=/ARRIVED|DELIVERED|DESTINATION/i.test(status);
  if(timingStatus==='DELAYED')status=arrived?'ARRIVED LATE':'DELAYED';
  else if(timingStatus==='EARLY')status=arrived?'ARRIVED EARLY':'EARLY';
  else if(timingStatus==='ON TIME'&&/^(?:DELAYED|EARLY)$/i.test(status))status='ON TIME';
  return {...merged,scheduledArrivalDate,scheduledArrivalTime,arrivalDate,arrivalTime,timingDeltaMinutes,timingStatus,status,mailTime:mailTimeFrom(arrivalDate,arrivalTime)};
}
function clientStyle(name=''){
  const s=String(name||'').trim();if(!s)return{};
  let h=0;for(let i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))%360;
  return {backgroundColor:`hsl(${h} 75% 92%)`,color:`hsl(${h} 48% 28%)`,borderColor:`hsl(${h} 55% 76%)`};
}
function officialUrl(row={}){
  const n=normalize(row.mawb),airline=airlineForMawb(n);
  if(n.startsWith('514-'))return 'https://airarabia-g9.ibsplc.aero/icargoneoportal/app/main/#/app';
  return airline?.url||row.officialTracker||'';
}
function openOfficial(row={}){
  const n=normalize(row.mawb),url=officialUrl(row);if(!url)return;
  if(n.startsWith('514-')){try{navigator.clipboard?.writeText(digits(n)).catch(()=>{})}catch{}}
  window.open(url,'_blank','noopener,noreferrer');
}
function dbToRow(record={}){
  const d=record.data||{};
  return decorateTiming({}, {...d,
    mawb:normalize(d.mawb||d.awb||record.awb),
    clientName:d.clientName??d.client??'',
    airlineName:d.airlineName??d.airline??'',
    carrierCode:d.carrierCode??d.airlineCode??'',
    flightNo:d.flightNo??d.flight??'',
    pieces:d.pieces??d.bags??'',bags:d.bags??d.pieces??'',weight:cleanWeight(d.weight),
    bookingDate:d.bookingDate||'',
    officialTracker:d.officialTracker||d.sourceUrl||'',
    mailSent:d.mailSent===true,
    lastChecked:d.lastChecked||record.tracking_checked_at||record.updated_at||'',
    _dbUpdatedAt:record.updated_at||''
  });
}
function withoutMeta(row={}){const {_dbUpdatedAt,...clean}=row;return clean}

export default function Page(){
 const [rows,setRows]=useState([]),[mawb,setMawb]=useState(''),[client,setClient]=useState(''),[busy,setBusy]=useState(false),[note,setNote]=useState(''),[loaded,setLoaded]=useState(false),[shared,setShared]=useState(false);
 async function persistRows(list){
   const clean=list.filter(x=>normalize(x?.mawb)).map(withoutMeta);if(!clean.length)return[];
   const res=await fetch('/api/shipments',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({rows:clean})});
   const data=await res.json();if(!data.ok)throw new Error(data.error||'Shared database save failed.');return data.rows||[];
 }
 async function persistRow(row){return persistRows([row])}
 useEffect(()=>{
   let active=true;
   (async()=>{
     let local=[];
     try{local=JSON.parse(localStorage.getItem(KEY)||'[]').map(x=>decorateTiming({}, {...x,mawb:normalize(x?.mawb||x?.awb)})).filter(x=>x.mawb)}catch{}
     try{
       const res=await fetch('/api/shipments',{cache:'no-store'});const data=await res.json();if(!data.ok)throw new Error(data.error||'Shared database unavailable');
       const server=(data.rows||[]).map(dbToRow).filter(x=>x.mawb);const map=new Map(server.map(x=>[digits(x.mawb),x]));const migrate=[];
       for(const l of local){const key=digits(l.mawb),s=map.get(key);if(!s){map.set(key,l);migrate.push(l);continue}const lt=Date.parse(l.lastChecked||0)||0,st=Date.parse(s._dbUpdatedAt||0)||0;if(lt>st){const newer=decorateTiming(s,{...l,mawb:normalize(l.mawb)});map.set(key,newer);migrate.push(newer)}}
       const merged=[...map.values()].sort((a,b)=>(Date.parse(b.lastChecked||b._dbUpdatedAt||0)||0)-(Date.parse(a.lastChecked||a._dbUpdatedAt||0)||0));
       if(!active)return;setRows(merged);setShared(true);setLoaded(true);localStorage.setItem(KEY,JSON.stringify(merged.map(withoutMeta)));
       if(migrate.length)persistRows(migrate).catch(()=>{});
     }catch(e){if(!active)return;setRows(local);setLoaded(true);setShared(false);setNote(`Shared database unavailable — showing this browser backup only. ${e.message||''}`)}
   })();
   return()=>{active=false};
 },[]);
 useEffect(()=>{if(typeof window!=='undefined'&&loaded)localStorage.setItem(KEY,JSON.stringify(rows.map(withoutMeta)))},[rows,loaded]);
 useEffect(()=>{const id=setInterval(()=>window.location.reload(),TWO_HOURS);return()=>clearInterval(id)},[]);
 const stats=useMemo(()=>({total:rows.length,arrived:rows.filter(x=>/ARRIVED|DELIVERED|DESTINATION/i.test(x.status)).length,transit:rows.filter(x=>/TRANSIT|DEPART/i.test(x.status)).length,checking:rows.filter(x=>!/ARRIVED|DELIVERED|DESTINATION|TRANSIT|DEPART/i.test(x.status)).length}),[rows]);
 async function track(one){
   const n=normalize(one);if(!n)throw new Error('Enter valid 11-digit MAWB.');
   const res=await fetch('/api/track',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({mawb:n})});const data=await res.json();
   if(!data.ok){const err=new Error(data.trackingError||data.apiError||data.error||'Tracking failed');err.payload=data;throw err}return {...data.shipment,provider:data.provider||data.shipment?.source||''};
 }
 async function saveAndShow(next,successText){
   setRows(r=>[next,...r.filter(x=>normalize(x.mawb)!==normalize(next.mawb))]);
   try{await persistRow(next);setShared(true);setNote(`${successText} • Saved for everyone.`);return true}catch(e){setShared(false);setNote(`${successText} • Shared save failed: ${e.message||e}`);return false}
 }
 async function add(){
   const n=normalize(mawb);if(!n){setNote('Please enter valid 11-digit MAWB.');return}const airline=airlineForMawb(n);if(!airline){setNote(`Prefix ${n.slice(0,3)} is not mapped yet.`);return}
   setBusy(true);setNote(`Tracking ${n} — ${airline.name}…`);
   try{const s=await track(n);const next=decorateTiming({}, {...s,clientName:client,mailSent:false,lastChecked:new Date().toISOString()});await saveAndShow(next,`${n} updated successfully`);setMawb('');setClient('')}
   catch(e){const p=e.payload||{};const next=decorateTiming({}, {mawb:n,clientName:client,airlineName:airline.name,status:'MANUAL TRACK',officialTracker:airline.url||p.officialTracker,manualHint:p.manualHint||'',trackingError:e.message,mailSent:false,lastChecked:new Date().toISOString()});await saveAndShow(next,`${n} saved; automatic tracking unavailable`);setMawb('');setClient('')}finally{setBusy(false)}
 }
 async function refresh(index){
   const row=rows[index];if(!row)return;setNote(`Refreshing ${row.mawb}…`);
   try{const s=await track(row.mawb);const next=decorateTiming(row,{...s,clientName:row.clientName,mailSent:row.mailSent===true,lastChecked:new Date().toISOString(),trackingError:'',manualHint:''});setRows(r=>r.map((x,i)=>i===index?next:x));try{await persistRow(next);setShared(true);setNote(`${row.mawb} refreshed and shared.`)}catch(e){setShared(false);setNote(`${row.mawb} refreshed locally; shared save failed: ${e.message||e}`)}}
   catch(e){const p=e.payload||{};const next={...row,officialTracker:airlineForMawb(row.mawb)?.url||p.officialTracker||row.officialTracker,manualHint:p.manualHint||row.manualHint,trackingError:e.message,lastChecked:new Date().toISOString()};if(!next.status||/CHECKING|TRACKING/i.test(next.status))next.status='MANUAL TRACK';setRows(r=>r.map((x,i)=>i===index?next:x));try{await persistRow(next);setShared(true)}catch{setShared(false)}setNote(p.manualHint||((p.officialTracker||row.officialTracker)?'Auto unavailable — last verified data retained.':e.message))}
 }
 async function refreshAll(){setBusy(true);for(let i=0;i<rows.length;i++)await refresh(i);setBusy(false)}
 async function setMail(index,value){
   const row=rows[index];if(!row)return;const next={...row,mailSent:value,mailUpdatedAt:new Date().toISOString()};setRows(r=>r.map((x,i)=>i===index?next:x));
   try{await persistRow(next);setShared(true);setNote(`${row.mawb}: Mail marked ${value?'YES':'NO'} and saved.`)}catch(e){setShared(false);setNote(`Mail status save failed: ${e.message||e}`)}
 }
 async function remove(i){
   const row=rows[i];if(!row)return;setNote(`Removing ${row.mawb} from shared tracker…`);
   try{const res=await fetch(`/api/shipments?awb=${encodeURIComponent(row.mawb)}`,{method:'DELETE'});const data=await res.json();if(!data.ok)throw new Error(data.error||'Delete failed');setRows(r=>r.filter((_,x)=>x!==i));setShared(true);setNote(`${row.mawb} removed for everyone.`)}catch(e){setNote(`Could not remove from shared database: ${e.message||e}`)}
 }
 return <main>
   <section className="hero"><div><div className="eyebrow">MAYAVI CARGO • V4.0.1</div><h1>Global MAWB Live Tracker</h1><p>Backend auto-refresh every 2 hours • backend OCR reads shipment details • delay/early status • client colour coding • mail reminder 5 hours before arrival.</p></div><div className="version">{shared?'SHARED DATABASE ✓':'LOCAL BACKUP'}</div></section>
   <section className="stats"><div><b>{stats.total}</b><span>Total MAWB</span></div><div><b>{stats.transit}</b><span>In Transit</span></div><div><b>{stats.arrived}</b><span>Arrived</span></div><div><b>{stats.checking}</b><span>Checking / Manual</span></div></section>
   <section className="entry"><div><label>MAWB NUMBER</label><input value={mawb} onChange={e=>setMawb(e.target.value)} placeholder="e.g. 157-12345678" onKeyDown={e=>e.key==='Enter'&&add()}/></div><div><label>CLIENT NAME</label><input value={client} onChange={e=>setClient(e.target.value)} placeholder="Optional client name"/></div><button disabled={busy} onClick={add}>{busy?'TRACKING…':'ADD + LIVE TRACK'}</button><button className="secondary" disabled={busy||!rows.length} onClick={refreshAll}>REFRESH ALL</button></section>
   {note&&<div className="note">{note}</div>}
   <section className="tableWrap"><table><thead><tr><th>MAWB</th><th>Client</th><th>Airline</th><th>Origin</th><th>Destination</th><th>Flight</th><th>Bags/Pieces</th><th>Weight</th><th>Booking Date</th><th>Arrival Date</th><th>Arrival Time</th><th>Mail Time (-5h)</th><th>Mail</th><th>Status</th><th>Action</th></tr></thead><tbody>{rows.length?rows.map((r,i)=><tr key={`${r.mawb}-${i}`}><td><strong>{r.mawb}</strong>{r.trackingError&&<small className="err">{r.manualHint||'Last auto refresh had an issue'}</small>}</td><td>{r.clientName?<span className="clientChip" style={clientStyle(r.clientName)}>{r.clientName}</span>:'—'}</td><td>{r.airlineName||'—'}</td><td>{r.origin||'—'}</td><td>{r.destination||'—'}</td><td>{r.flightNo||'—'}</td><td>{r.bags||r.pieces||'—'}</td><td>{r.weight?`${r.weight} kg`:'—'}</td><td>{r.bookingDate||'—'}</td><td>{r.arrivalDate||'—'}</td><td>{formatTime12(r.arrivalTime)||'—'}</td><td><strong className="mailTime">{r.mailTime||mailTimeFrom(r.arrivalDate,r.arrivalTime)||'—'}</strong></td><td><div className="mailChoice"><button className={`mailBtn yes ${r.mailSent===true?'selected':''}`} onClick={()=>setMail(i,true)}>YES</button><button className={`mailBtn no ${r.mailSent!==true?'selected':''}`} onClick={()=>setMail(i,false)}>NO</button></div></td><td><span className={`badge ${tone(r.status)}`}>{r.status||'CHECKING'}</span></td><td><div className="actions"><button className="refreshBtn" title="Refresh automatic tracking" onClick={()=>refresh(i)}>REFRESH</button>{officialUrl(r)&&<a className={`trackLink ${r.trackingError?'urgent':''}`} href={officialUrl(r)} target="_blank" rel="noreferrer" onClick={e=>{if(normalize(r.mawb).startsWith('514-')){e.preventDefault();openOfficial(r);setNote(`${digits(r.mawb)} copied. Air Arabia opened.`)}}} title="Open official airline tracking page">{normalize(r.mawb).startsWith('514-')?'COPY + OFFICIAL ↗':'OFFICIAL TRACK ↗'}</a>}<button className="removeBtn" title="Remove" onClick={()=>remove(i)}>×</button></div></td></tr>):<tr><td colSpan="15" className="empty">No MAWB added yet.</td></tr>}</tbody></table></section>
   <footer>{CONFIGURED_PREFIXES.length} airline prefixes mapped • Shared Neon storage • Backend refresh every 2 hours • Backend browser/screenshot OCR • Booking date extraction • Mail time = 5 hours before arrival</footer>
 </main>
}