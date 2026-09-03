'use client';
import { useEffect, useMemo, useState } from 'react';
import { airlineForMawb, CONFIGURED_PREFIXES } from '../lib/airlines.js';

const KEY='mayavi_v3_shipments';
function normalize(v=''){const d=String(v).replace(/\D/g,'');return d.length===11?`${d.slice(0,3)}-${d.slice(3)}`:''}
function tone(status=''){const s=status.toUpperCase();if(s.includes('ARRIVED')||s.includes('DELIVERED')||s.includes('DESTINATION'))return'arrived';if(s.includes('DELAY'))return'delayed';if(s.includes('TRANSIT')||s.includes('DEPART'))return'transit';if(s.includes('BOOK'))return'booked';return'checking'}
function firstMatch(s,rx){return (String(s).match(rx)||[])[1]||''}
function pad(v){return String(v).padStart(2,'0')}
const MONTHS={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
function parseDate(segment=''){
  const s=String(segment).toUpperCase();
  let m=s.match(/(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})/);if(m)return`${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m=s.match(/(\d{1,2})[-\/.](\d{1,2})[-\/.](20\d{2})/);if(m)return`${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  m=s.match(/(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s+(20\d{2})/);if(m)return`${m[3]}-${MONTHS[m[2]]}-${pad(m[1])}`;
  m=s.match(/(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s+(\d{1,2}),?\s+(20\d{2})/);if(m)return`${m[3]}-${MONTHS[m[1]]}-${pad(m[2])}`;
  return'';
}
function parseTime(segment=''){const m=String(segment).match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);return m?`${pad(m[1])}:${m[2]}`:''}
function statusFromText(text=''){
  const s=String(text).toUpperCase();
  if(/\bDLV\b|DELIVERED/.test(s))return'DELIVERED';
  if(/\bRCF\b|RECEIVED FROM FLIGHT|\bARRIVED\b|\bARRIVAL COMPLETED\b|\bLANDED\b/.test(s))return'ARRIVED';
  if(/DELAY|LATE|OFFLOAD|SHORT SHIP|EXCEPTION/.test(s))return'DELAYED';
  if(/\bDEP\b|DEPARTED|IN TRANSIT|AIRBORNE/.test(s))return'IN TRANSIT';
  if(/\bRCS\b|BOOKED|ACCEPTED|RECEIVED FROM SHIPPER/.test(s))return'BOOKED';
  return'';
}
function parseScreenshotText(text,row){
  const raw=String(text||'');const flat=raw.replace(/\s+/g,' ').trim();const upper=flat.toUpperCase();
  const airline=airlineForMawb(row.mawb)||{};const iata=String(airline.iata||'').toUpperCase();
  let origin='',destination='';
  let route=upper.match(/\bORIGIN\b\s*[:\-]?\s*([A-Z]{3})\b[\s\S]{0,100}?\bDESTINATION\b\s*[:\-]?\s*([A-Z]{3})\b/)
    ||upper.match(/\bFROM\b\s*[:\-]?\s*([A-Z]{3})\b[\s\S]{0,100}?\bTO\b\s*[:\-]?\s*([A-Z]{3})\b/)
    ||upper.match(/\b([A-Z]{3})\s*(?:→|->|—|-)\s*([A-Z]{3})\b/);
  if(route){origin=route[1];destination=route[2];}
  const pieces=firstMatch(flat,/(?:Pieces?|Pcs?|No\.?\s*of\s*Pieces|Piece Count)\s*[:\-]?\s*(\d{1,6})/i)||firstMatch(flat,/\b(\d{1,6})\s*(?:PCS|PIECES?)\b/i);
  const weight=(firstMatch(flat,/(?:Gross\s*Weight|Chargeable\s*Weight|Weight)\s*[:\-]?\s*([\d,.]+)\s*(?:KG|KGS)?/i)||firstMatch(flat,/\b([\d,.]+)\s*(?:KG|KGS)\b/i)).replace(/,/g,'');
  let flightNo='';if(iata){const esc=iata.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');const fm=upper.match(new RegExp(`\\b${esc}\\s*[- ]?(\\d{2,4})\\b`));if(fm)flightNo=`${iata}${fm[1]}`;}
  if(!flightNo)flightNo=firstMatch(upper,/\b([A-Z]{2}\d{2,4})\b/);
  const actualBlock=(flat.match(/(?:ATA|Actual Arrival|Arrived|Received from Flight|RCF|Landed)[\s\S]{0,180}/i)||[])[0]||'';
  const etaBlock=(flat.match(/(?:ETA|Estimated Arrival|Expected Arrival|Scheduled Arrival|Arrival)[\s\S]{0,180}/i)||[])[0]||'';
  let arrivalDate=parseDate(actualBlock),arrivalTime=parseTime(actualBlock),arrivalIsActual=Boolean(arrivalDate||arrivalTime);
  if(!arrivalDate&&!arrivalTime){arrivalDate=parseDate(etaBlock);arrivalTime=parseTime(etaBlock);arrivalIsActual=false;}
  const status=statusFromText(flat)||row.status||'TRACKING';
  const digits=String(row.mawb||'').replace(/\D/g,''),serial=digits.slice(3);
  const awbSeen=upper.replace(/\D/g,'').includes(digits)||upper.replace(/\D/g,'').includes(serial);
  const useful=Boolean(origin||destination||pieces||weight||flightNo||arrivalDate||arrivalTime||statusFromText(flat));
  if(!useful)throw new Error('Screenshot read hua, but shipment fields identify nahi hue. Please crop screenshot around tracking details.');
  return {origin,destination,bags:pieces,pieces,weight,flightNo,arrivalDate,arrivalTime,arrivalIsActual,status,ocrAwbMatched:awbSeen,provider:'Screenshot OCR',source:'Airline tracking screenshot OCR'};
}

export default function Page(){
 const [rows,setRows]=useState([]),[mawb,setMawb]=useState(''),[client,setClient]=useState(''),[busy,setBusy]=useState(false),[note,setNote]=useState(''),[ocrIndex,setOcrIndex]=useState(-1);
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
   catch(e){const p=e.payload||{};const official=p.officialTracker||airline.url;setRows(r=>[{mawb:n,clientName:client,airlineName:airline.name,status:'MANUAL TRACK',officialTracker:official,manualHint:p.manualHint||'',trackingError:e.message,lastChecked:new Date().toISOString()},...r.filter(x=>x.mawb!==n)]);setNote(p.manualHint||(official?`${airline.name} automatic tracking unavailable — use OFFICIAL TRACK or SCREENSHOT OCR.`:e.message))}finally{setBusy(false)}
 }
 async function refresh(index){const row=rows[index];setNote(`Refreshing ${row.mawb}…`);try{const s=await track(row.mawb);setRows(r=>r.map((x,i)=>i===index?{...x,...s,clientName:x.clientName,lastChecked:new Date().toISOString(),trackingError:'',manualHint:''}:x));setNote(`${row.mawb} refreshed.`)}catch(e){const p=e.payload||{};setRows(r=>r.map((x,i)=>i===index?{...x,status:'MANUAL TRACK',officialTracker:p.officialTracker||x.officialTracker,manualHint:p.manualHint||x.manualHint,trackingError:e.message,lastChecked:new Date().toISOString()}:x));setNote(p.manualHint||((p.officialTracker||row.officialTracker)?'Auto unavailable — use OFFICIAL TRACK or SCREENSHOT OCR.':e.message))}}
 async function refreshAll(){setBusy(true);for(let i=0;i<rows.length;i++)await refresh(i);setBusy(false)}
 async function readScreenshot(index,file){
   if(!file)return;setOcrIndex(index);setNote(`Reading tracking screenshot for ${rows[index].mawb}…`);
   let worker;
   try{
     const {createWorker}=await import('tesseract.js');
     worker=await createWorker('eng',undefined,{logger:m=>{if(m.status==='recognizing text')setNote(`Screenshot OCR ${Math.round((m.progress||0)*100)}% — ${rows[index].mawb}`)}});
     const result=await worker.recognize(file);const parsed=parseScreenshotText(result?.data?.text||'',rows[index]);
     setRows(r=>r.map((x,i)=>i===index?{...x,...Object.fromEntries(Object.entries(parsed).filter(([,v])=>v!==''&&v!=null)),clientName:x.clientName,trackingError:'',manualHint:'',lastChecked:new Date().toISOString()}:x));
     setNote(`${rows[index].mawb}: screenshot se data extracted${parsed.ocrAwbMatched?' and AWB matched':''}.`);
   }catch(e){setNote(`Screenshot OCR failed: ${e.message||e}`)}finally{try{if(worker)await worker.terminate()}catch{}setOcrIndex(-1)}
 }
 function remove(i){setRows(r=>r.filter((_,x)=>x!==i))}
 return <main>
   <section className="hero"><div><div className="eyebrow">MAYAVI CARGO • V3.6</div><h1>Global MAWB Live Tracker</h1><p>3-level tracking: automatic API/direct airline data → official airline page → screenshot OCR fallback. Staff can upload the airline tracking screenshot and Mayavi extracts shipment fields into the row.</p></div><div className="version">AUTO + SCREENSHOT OCR</div></section>
   <section className="stats"><div><b>{stats.total}</b><span>Total MAWB</span></div><div><b>{stats.transit}</b><span>In Transit</span></div><div><b>{stats.arrived}</b><span>Arrived</span></div><div><b>{stats.checking}</b><span>Checking / Manual</span></div></section>
   <section className="entry"><div><label>MAWB NUMBER</label><input value={mawb} onChange={e=>setMawb(e.target.value)} placeholder="e.g. 157-12345678" onKeyDown={e=>e.key==='Enter'&&add()}/></div><div><label>CLIENT NAME</label><input value={client} onChange={e=>setClient(e.target.value)} placeholder="Optional client name"/></div><button disabled={busy} onClick={add}>{busy?'TRACKING…':'ADD + LIVE TRACK'}</button><button className="secondary" disabled={busy||!rows.length} onClick={refreshAll}>REFRESH ALL</button></section>
   {note&&<div className="note">{note}</div>}
   <section className="tableWrap"><table><thead><tr><th>MAWB</th><th>Client</th><th>Airline</th><th>Origin</th><th>Destination</th><th>Flight</th><th>Bags/Pieces</th><th>Weight</th><th>Arrival Date</th><th>Arrival Time</th><th>Status</th><th>Action</th></tr></thead><tbody>{rows.length?rows.map((r,i)=><tr key={r.mawb}><td><strong>{r.mawb}</strong>{r.trackingError&&<small className="err">{r.manualHint||'Auto tracking unavailable'}</small>}</td><td>{r.clientName||'—'}</td><td>{r.airlineName||'—'}</td><td>{r.origin||'—'}</td><td>{r.destination||'—'}</td><td>{r.flightNo||'—'}</td><td>{r.bags||r.pieces||'—'}</td><td>{r.weight?`${r.weight} kg`:'—'}</td><td>{r.arrivalDate||'—'}</td><td>{r.arrivalTime||'—'}</td><td><span className={`badge ${tone(r.status)}`}>{r.status||'CHECKING'}</span></td><td><div className="actions"><button className="refreshBtn" title="Refresh automatic tracking" onClick={()=>refresh(i)}>REFRESH</button>{r.officialTracker&&<a className={`trackLink ${r.trackingError?'urgent':''}`} href={r.officialTracker} target="_blank" rel="noreferrer" title="Open official airline tracking page">OFFICIAL TRACK ↗</a>}<label className="ocrBtn" title="Upload airline tracking screenshot">{ocrIndex===i?'READING…':'SCREENSHOT OCR'}<input type="file" accept="image/*" onChange={e=>{const f=e.target.files?.[0];readScreenshot(i,f);e.target.value=''}}/></label><button className="removeBtn" title="Remove" onClick={()=>remove(i)}>×</button></div></td></tr>):<tr><td colSpan="12" className="empty">No MAWB added yet.</td></tr>}</tbody></table></section>
   <footer>{CONFIGURED_PREFIXES.length} airline prefixes mapped • API/direct tracking first • Official link second • Screenshot OCR third</footer>
 </main>
}
