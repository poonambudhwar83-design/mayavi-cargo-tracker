'use client';
import { useEffect, useMemo, useState } from 'react';
import { airlineForMawb, CONFIGURED_PREFIXES } from '../lib/airlines.js';

const KEY='mayavi_v3_shipments';
const TWO_HOURS=2*60*60*1000;
function normalize(v=''){const d=String(v).replace(/\D/g,'');return d.length===11?`${d.slice(0,3)}-${d.slice(3)}`:''}
function digits(v=''){return String(v).replace(/\D/g,'')}
function pad(v){return String(v).padStart(2,'0')}
function cleanWeight(v=''){return String(v||'').replace(/\s*(kg|kgs|kilograms?)\s*$/i,'').trim()}
function formatTime12(value=''){
  const s=String(value||'').trim();if(!s)return'';
  if(/\b(?:AM|PM)\b/i.test(s))return s.replace(/\b(am|pm)\b/i,m=>m.toUpperCase());
  const m=s.match(/^(\d{1,2}):([0-5]\d)$/);if(!m)return s;
  const h=Number(m[1]);if(h<0||h>23)return s;
  return `${pad(h%12||12)}:${m[2]} ${h>=12?'PM':'AM'}`;
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
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${formatTime12(`${pad(d.getHours())}:${pad(d.getMinutes())}`)}`;
}
function businessStatus(raw='',timingStatus=''){
  const s=String(raw||'').toUpperCase();
  if(timingStatus==='EARLY'||s.includes('EARLY'))return'EARLY ARRIVAL';
  if(timingStatus==='DELAYED'||s.includes('DELAY')||s.includes('LATE'))return'DELAYED';
  if(s.includes('ARRIVED')||s.includes('DELIVER')||s.includes('DESTINATION')||s.includes('LANDED'))return'ARRIVED';
  return'BOOKED';
}
function tone(status=''){
  const s=String(status).toUpperCase();
  if(s.includes('DELAY'))return'delayed';
  if(s.includes('EARLY'))return'early';
  if(s.includes('ARRIVED'))return'arrived';
  return'booked';
}
function decorateTiming(existing={},incoming={}){
  const merged={...existing,...incoming};
  const shipmentType=merged.shipmentType==='EXPORT'?'EXPORT':'IMPORT';
  const scheduledArrivalDate=existing.scheduledArrivalDate||incoming.scheduledArrivalDate||existing.arrivalDate||incoming.arrivalDate||'';
  const scheduledArrivalTime=existing.scheduledArrivalTime||incoming.scheduledArrivalTime||existing.arrivalTime||incoming.arrivalTime||'';
  const arrivalDate=incoming.arrivalDate||existing.arrivalDate||'';
  const arrivalTime=incoming.arrivalTime||existing.arrivalTime||'';
  const planned=dateTimeValue(scheduledArrivalDate,scheduledArrivalTime),current=dateTimeValue(arrivalDate,arrivalTime);
  let timingDeltaMinutes=null,timingStatus='';
  if(planned&&current){
    timingDeltaMinutes=Math.round((current-planned)/60000);
    timingStatus=timingDeltaMinutes>60?'DELAYED':timingDeltaMinutes<-60?'EARLY':'ON TIME';
  }
  const status=businessStatus(incoming.status||existing.status||'',timingStatus);
  const mailTime=shipmentType==='IMPORT'?mailTimeFrom(arrivalDate,arrivalTime):'';
  const mailSent=shipmentType==='IMPORT'?merged.mailSent===true:undefined;
  return {...merged,shipmentType,scheduledArrivalDate,scheduledArrivalTime,arrivalDate,arrivalTime,timingDeltaMinutes,timingStatus,status,mailTime,mailSent};
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
    mawb:normalize(d.mawb||d.awb||record.awb),clientName:d.clientName??d.client??'',
    airlineName:d.airlineName??d.airline??'',carrierCode:d.carrierCode??d.airlineCode??'',
    flightNo:d.flightNo??d.flight??'',pieces:d.pieces??d.bags??'',bags:d.bags??d.pieces??'',weight:cleanWeight(d.weight),
    bookingDate:d.bookingDate||'',shipmentType:d.shipmentType==='EXPORT'?'EXPORT':'IMPORT',officialTracker:d.officialTracker||d.sourceUrl||'',
    mailSent:d.shipmentType==='EXPORT'?undefined:d.mailSent===true,lastChecked:d.lastChecked||record.tracking_checked_at||record.updated_at||'',_dbUpdatedAt:record.updated_at||''
  });
}
function withoutMeta(row={}){const {_dbUpdatedAt,...clean}=row;return clean}

export default function DashboardClient({isAdmin=false}){
  const [rows,setRows]=useState([]),[mawb,setMawb]=useState(''),[client,setClient]=useState(''),[busy,setBusy]=useState(false),[note,setNote]=useState(''),[loaded,setLoaded]=useState(false),[shared,setShared]=useState(false),[activeTab,setActiveTab]=useState('IMPORT'),[adminKey,setAdminKey]=useState('');
  async function persistRows(list){
    const clean=list.filter(x=>normalize(x?.mawb)).map(withoutMeta);if(!clean.length)return[];
    const res=await fetch('/api/shipments',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({rows:clean})});
    const data=await res.json();if(!data.ok)throw new Error(data.error||'Shared database save failed.');return data.rows||[];
  }
  async function persistRow(row){return persistRows([row])}
  useEffect(()=>{
    if(isAdmin){try{setAdminKey(sessionStorage.getItem('mayavi_admin_key')||'')}catch{}}
    let active=true;
    (async()=>{
      let local=[];
      try{local=JSON.parse(localStorage.getItem(KEY)||'[]').map(x=>decorateTiming({}, {...x,mawb:normalize(x?.mawb||x?.awb),shipmentType:x?.shipmentType==='EXPORT'?'EXPORT':'IMPORT'})).filter(x=>x.mawb)}catch{}
      try{
        const res=await fetch('/api/shipments',{cache:'no-store'});const data=await res.json();if(!data.ok)throw new Error(data.error||'Shared database unavailable');
        const server=(data.rows||[]).map(dbToRow).filter(x=>x.mawb);const map=new Map(server.map(x=>[digits(x.mawb),x]));const migrate=[];
        for(const l of local){const key=digits(l.mawb),s=map.get(key);if(!s){map.set(key,l);migrate.push(l);continue}const lt=Date.parse(l.lastChecked||0)||0,st=Date.parse(s._dbUpdatedAt||0)||0;if(lt>st){const newer=decorateTiming(s,{...l,mawb:normalize(l.mawb)});map.set(key,newer);migrate.push(newer)}}
        const merged=[...map.values()].sort((a,b)=>(Date.parse(b.lastChecked||b._dbUpdatedAt||0)||0)-(Date.parse(a.lastChecked||a._dbUpdatedAt||0)||0));
        if(!active)return;setRows(merged);setShared(true);setLoaded(true);localStorage.setItem(KEY,JSON.stringify(merged.map(withoutMeta)));if(migrate.length)persistRows(migrate).catch(()=>{});
      }catch(e){if(!active)return;setRows(local);setLoaded(true);setShared(false);setNote(`Shared database unavailable — showing this browser backup only. ${e.message||''}`)}
    })();
    return()=>{active=false};
  },[isAdmin]);
  useEffect(()=>{if(typeof window!=='undefined'&&loaded)localStorage.setItem(KEY,JSON.stringify(rows.map(withoutMeta)))},[rows,loaded]);
  useEffect(()=>{const id=setInterval(()=>window.location.reload(),TWO_HOURS);return()=>clearInterval(id)},[]);
  const visibleRows=useMemo(()=>rows.filter(r=>(r.shipmentType==='EXPORT'?'EXPORT':'IMPORT')===activeTab),[rows,activeTab]);
  const stats=useMemo(()=>({total:visibleRows.length,booked:visibleRows.filter(x=>x.status==='BOOKED').length,arrived:visibleRows.filter(x=>x.status==='ARRIVED').length,attention:visibleRows.filter(x=>x.status==='DELAYED'||x.status==='EARLY ARRIVAL').length}),[visibleRows]);
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
    const existing=rows.find(x=>normalize(x.mawb)===n);if(existing){setNote(`${n} is already fixed in ${existing.shipmentType||'IMPORT'} dashboard. Admin can move it if required.`);return}
    setBusy(true);setNote(`Tracking ${n} — ${airline.name}…`);
    try{const s=await track(n);const next=decorateTiming({}, {...s,shipmentType:activeTab,clientName:client,mailSent:activeTab==='IMPORT'?false:undefined,lastChecked:new Date().toISOString()});await saveAndShow(next,`${n} added to ${activeTab}`);setMawb('');setClient('')}
    catch(e){const p=e.payload||{};const next=decorateTiming({}, {mawb:n,shipmentType:activeTab,clientName:client,airlineName:airline.name,status:'BOOKED',officialTracker:airline.url||p.officialTracker,manualHint:p.manualHint||'',trackingError:e.message,mailSent:activeTab==='IMPORT'?false:undefined,lastChecked:new Date().toISOString()});await saveAndShow(next,`${n} added to ${activeTab}; backend will retry automatically`);setMawb('');setClient('')}finally{setBusy(false)}
  }
  async function refreshByMawb(value){
    const index=rows.findIndex(x=>normalize(x.mawb)===normalize(value)),row=rows[index];if(!row)return;setNote(`Refreshing ${row.mawb}…`);
    try{const s=await track(row.mawb);const next=decorateTiming(row,{...s,shipmentType:row.shipmentType,clientName:row.clientName,mailSent:row.shipmentType==='IMPORT'?row.mailSent===true:undefined,lastChecked:new Date().toISOString(),trackingError:'',manualHint:''});setRows(r=>r.map((x,i)=>i===index?next:x));await persistRow(next);setShared(true);setNote(`${row.mawb} refreshed and shared.`)}
    catch(e){const p=e.payload||{};const next=decorateTiming(row,{status:row.status||'BOOKED',officialTracker:airlineForMawb(row.mawb)?.url||p.officialTracker||row.officialTracker,manualHint:p.manualHint||row.manualHint,trackingError:e.message,lastChecked:new Date().toISOString()});setRows(r=>r.map((x,i)=>i===index?next:x));try{await persistRow(next);setShared(true)}catch{setShared(false)}setNote('Auto refresh had an issue; last verified details and status were retained.')}
  }
  async function refreshAll(){setBusy(true);for(const r of visibleRows)await refreshByMawb(r.mawb);setBusy(false)}
  async function setMail(value,sent){
    const index=rows.findIndex(x=>normalize(x.mawb)===normalize(value)),row=rows[index];if(!row||row.shipmentType==='EXPORT')return;
    const next={...row,mailSent:sent,mailUpdatedAt:new Date().toISOString()};setRows(r=>r.map((x,i)=>i===index?next:x));
    try{await persistRow(next);setShared(true);setNote(`${row.mawb}: Mail marked ${sent?'YES':'NO'} and saved.`)}catch(e){setShared(false);setNote(`Mail status save failed: ${e.message||e}`)}
  }
  async function moveShipment(value){
    if(!isAdmin)return;const index=rows.findIndex(x=>normalize(x.mawb)===normalize(value)),row=rows[index];if(!row)return;
    const target=row.shipmentType==='EXPORT'?'IMPORT':'EXPORT';
    const next=decorateTiming(row,{...row,shipmentType:target,mailSent:target==='IMPORT'?false:undefined,mailUpdatedAt:target==='IMPORT'?row.mailUpdatedAt:undefined,lastChecked:row.lastChecked||new Date().toISOString()});
    setRows(r=>r.map((x,i)=>i===index?next:x));
    try{await persistRow(next);setShared(true);setNote(`${row.mawb} moved to ${target}.`)}catch(e){setShared(false);setNote(`Could not move shipment: ${e.message||e}`)}
  }
  async function remove(value){
    if(!isAdmin)return;const index=rows.findIndex(x=>normalize(x.mawb)===normalize(value)),row=rows[index];if(!row)return;
    if(!adminKey){setNote('Admin key is required to delete a MAWB.');return}if(!window.confirm(`Delete ${row.mawb} from the shared tracker?`))return;
    try{const res=await fetch(`/api/shipments?awb=${encodeURIComponent(row.mawb)}`,{method:'DELETE',headers:{'x-mayavi-admin-key':adminKey}});const data=await res.json();if(!data.ok)throw new Error(data.error||'Delete failed');setRows(r=>r.filter((_,i)=>i!==index));setShared(true);setNote(`${row.mawb} deleted by admin.`)}catch(e){setNote(`Delete blocked: ${e.message||e}`)}
  }
  function updateAdminKey(v){setAdminKey(v);try{sessionStorage.setItem('mayavi_admin_key',v)}catch{}}
  return <main>
    <section className="hero"><div><div className="eyebrow">MAYAVI CARGO • V4.1.1 • {isAdmin?'ADMIN':'EMPLOYEE'}</div><h1>{isAdmin?'Admin MAWB Dashboard':'Employee MAWB Dashboard'}</h1><p>Backend refresh every 2 hours • backend OCR reads shipment and booking details • separate Import/Export data • mail controls are available only in Import.</p></div><div className="version">{isAdmin?'ADMIN CONTROL':'EMPLOYEE ACCESS'} • {shared?'SHARED ✓':'LOCAL'}</div></section>
    {isAdmin&&<section className="adminBar"><div><b>ADMIN SAFETY</b><span>Only admin can delete MAWBs. Enter your private admin key for delete actions.</span></div><input type="password" value={adminKey} onChange={e=>updateAdminKey(e.target.value)} placeholder="Admin key" autoComplete="off"/></section>}
    <section className="typeTabs"><button className={activeTab==='IMPORT'?'active':''} onClick={()=>setActiveTab('IMPORT')}>IMPORT</button><button className={activeTab==='EXPORT'?'active':''} onClick={()=>setActiveTab('EXPORT')}>EXPORT</button></section>
    <section className="stats"><div><b>{stats.total}</b><span>{activeTab} MAWB</span></div><div><b>{stats.booked}</b><span>Booked</span></div><div><b>{stats.arrived}</b><span>Arrived</span></div><div><b>{stats.attention}</b><span>Delayed / Early</span></div></section>
    <section className="entry"><div><label>{activeTab} MAWB NUMBER</label><input value={mawb} onChange={e=>setMawb(e.target.value)} placeholder="e.g. 157-12345678" onKeyDown={e=>e.key==='Enter'&&add()}/></div><div><label>CLIENT NAME</label><input value={client} onChange={e=>setClient(e.target.value)} placeholder="Optional client name"/></div><button disabled={busy} onClick={add}>{busy?'TRACKING…':`ADD TO ${activeTab}`}</button><button className="secondary" disabled={busy||!visibleRows.length} onClick={refreshAll}>REFRESH {activeTab}</button></section>
    {note&&<div className="note">{note}</div>}
    <section className="tableWrap"><table><thead><tr><th>MAWB</th><th>Client</th><th>Airline</th><th>Origin</th><th>Destination</th><th>Flight</th><th>Bags/Pieces</th><th>Weight</th><th>Booking Date</th><th>Arrival Date</th><th>Arrival Time</th>{activeTab==='IMPORT'&&<><th>Mail Time (-5h)</th><th>Mail</th></>}<th>Status</th><th>Action</th></tr></thead><tbody>{visibleRows.length?visibleRows.map(r=><tr key={r.mawb}><td><strong>{r.mawb}</strong>{r.trackingError&&<small className="err">Backend will retry automatically</small>}</td><td>{r.clientName?<span className="clientChip" style={clientStyle(r.clientName)}>{r.clientName}</span>:'—'}</td><td>{r.airlineName||'—'}</td><td>{r.origin||'—'}</td><td>{r.destination||'—'}</td><td>{r.flightNo||'—'}</td><td>{r.bags||r.pieces||'—'}</td><td>{r.weight?`${r.weight} kg`:'—'}</td><td>{r.bookingDate||'—'}</td><td>{r.arrivalDate||'—'}</td><td>{formatTime12(r.arrivalTime)||'—'}</td>{activeTab==='IMPORT'&&<><td><strong className="mailTime">{r.mailTime||mailTimeFrom(r.arrivalDate,r.arrivalTime)||'—'}</strong></td><td><div className="mailChoice"><button className={`mailBtn yes ${r.mailSent===true?'selected':''}`} onClick={()=>setMail(r.mawb,true)}>YES</button><button className={`mailBtn no ${r.mailSent!==true?'selected':''}`} onClick={()=>setMail(r.mawb,false)}>NO</button></div></td></>}<td><span className={`badge ${tone(r.status)}`}>{businessStatus(r.status,r.timingStatus)}</span></td><td><div className="actions"><button className="refreshBtn" onClick={()=>refreshByMawb(r.mawb)}>REFRESH</button>{officialUrl(r)&&<a className={`trackLink ${r.trackingError?'urgent':''}`} href={officialUrl(r)} target="_blank" rel="noreferrer" onClick={e=>{if(normalize(r.mawb).startsWith('514-')){e.preventDefault();openOfficial(r);setNote(`${digits(r.mawb)} copied. Air Arabia opened.`)}}}>{normalize(r.mawb).startsWith('514-')?'COPY + OFFICIAL ↗':'OFFICIAL TRACK ↗'}</a>}{isAdmin&&<button className="moveBtn" onClick={()=>moveShipment(r.mawb)}>MOVE TO {activeTab==='IMPORT'?'EXPORT':'IMPORT'}</button>}{isAdmin&&<button className="removeBtn" onClick={()=>remove(r.mawb)}>DELETE</button>}</div></td></tr>):<tr><td colSpan={activeTab==='IMPORT'?15:13} className="empty">No {activeTab.toLowerCase()} MAWB added yet.</td></tr>}</tbody></table></section>
    <footer>{CONFIGURED_PREFIXES.length} airline prefixes • Shared Neon storage • Backend OCR active • Booking date from OCR • Import mail reminder only • 2-hour backend refresh • Employee MAWBs cannot be deleted • Admin-only delete protection</footer>
  </main>
}
