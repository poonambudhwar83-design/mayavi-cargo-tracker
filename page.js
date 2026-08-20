'use client';

import { useEffect, useMemo, useState } from 'react';

const EMPTY = { mawb:'', bags:'', weight:'', origin:'', destination:'', arrivalDate:'', arrivalTime:'', carrierCode:'', flightNo:'' };

function normalizeMawb(v='') {
  const d = String(v).replace(/\D/g,'');
  return d.length >= 11 ? `${d.slice(0,3)}-${d.slice(3,11)}` : String(v).trim();
}
function pad(n){ return String(n).padStart(2,'0'); }
function localParts(value){
  if(!value) return {};
  const d = new Date(value);
  if(Number.isNaN(d.getTime())) return {};
  return { date:`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`, time:`${pad(d.getHours())}:${pad(d.getMinutes())}` };
}
function arrivalDateObj(s){
  if(!s.arrivalDate || !s.arrivalTime) return null;
  const d = new Date(`${s.arrivalDate}T${s.arrivalTime}:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}
function mailDue(s){ const d=arrivalDateObj(s); if(!d) return ''; return new Date(d.getTime()-6*3600000).toLocaleString(); }
function statusClass(status=''){
  const t=status.toLowerCase();
  if(t.includes('arriv')||t.includes('delivered')||t.includes('rcf')) return 'green';
  if(t.includes('late')||t.includes('delay')||t.includes('exception')) return 'red';
  if(t.includes('early')) return 'pink';
  return 'white';
}
function parseManifestDate(v=''){
  const m=String(v).match(/\b(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})\b/);
  if(!m) return '';
  return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
}
function parseManifestTime(v=''){
  const m=String(v).match(/\b(\d{1,2})[:.](\d{2})\s*(AM|PM)?\b/i);
  if(!m) return '';
  let h=Number(m[1]); const min=Number(m[2]); const ap=(m[3]||'').toUpperCase();
  if(ap==='PM' && h<12) h+=12;
  if(ap==='AM' && h===12) h=0;
  if(h>23||min>59) return '';
  return `${pad(h)}:${pad(min)}`;
}
function extractFields(text=''){
  const flat = text.replace(/\s+/g,' ');
  const mawbMatch = flat.match(/(?:MAWB(?:\s*No\.?)?\s*[:#-]*\s*)?(\d{3})[-\s]?(\d{8})\b/i);
  const bagsMatch =
    flat.match(/(?:No\.?\s*of\s*)?(?:PKT\/?Bag|bags?|pcs?|pieces?)\s*[:#-]?\s*(\d{1,5})(?:\s*\/\s*\d{1,5})?/i) ||
    flat.match(/(\d{1,5})\s*(?:bags?|pcs?|pieces?)\b/i);
  const weightMatch =
    flat.match(/(?:gross\s*)?(?:weight|wt)\s*[:#-]?\s*([\d,.]+)\s*(?:kg|kgs|kilograms?)?/i) ||
    flat.match(/([\d,.]+)\s*(?:kg|kgs)\b/i);
  const flightMatch = flat.match(/(?:Flight\s*No\.?)\s*[:#-]*\s*([A-Z]{2,3})\s*[- ]?\s*(\d{2,4})\b/i);
  const flightDateMatch = flat.match(/(?:Flight\s*Date|Arrival\s*Date|Expected\s*Date\s*of\s*Arrival)\s*[:#-]*\s*(\d{1,2}[.\/-]\d{1,2}[.\/-]\d{4})/i);
  const arrivalTimeMatch = flat.match(/(?:Expected\s*Time\s*of\s*Arrival(?:\s*\([^)]*\))?|Arrival\s*Time|ETA)\s*[:#-]*\s*(\d{1,2}[:.]\d{2}\s*(?:AM|PM)?)/i);
  const explicitRoute = flat.match(/(?:Origin(?:ating)?(?:\/Destined\s*City)?\s*[-:]?\s*)([A-Z]{3})\s*(?:\/|TO|>|-|\s+Destination\s*[-:]?\s*)([A-Z]{3})\b/i);
  const genericRoute = flat.match(/\b([A-Z]{3})\s*(?:-|\/|TO|>)\s*([A-Z]{3})\b/);
  const routeMatch = explicitRoute || genericRoute;
  return {
    mawb: mawbMatch ? `${mawbMatch[1]}-${mawbMatch[2]}` : '',
    bags: bagsMatch ? bagsMatch[1] : '',
    weight: weightMatch ? weightMatch[1].replace(/,/g,'') : '',
    origin: routeMatch ? routeMatch[1].toUpperCase() : '',
    destination: routeMatch ? routeMatch[2].toUpperCase() : '',
    arrivalDate: flightDateMatch ? parseManifestDate(flightDateMatch[1]) : '',
    arrivalTime: arrivalTimeMatch ? parseManifestTime(arrivalTimeMatch[1]) : '',
    flightNo: flightMatch ? `${flightMatch[1].toUpperCase()} ${flightMatch[2]}` : ''
  };
}

export default function Home(){
  const [shipments,setShipments]=useState([]);
  const [form,setForm]=useState(EMPTY);
  const [manualOpen,setManualOpen]=useState(false);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState('');
  const [apiConfigured,setApiConfigured]=useState(null);
  const [ocrProgress,setOcrProgress]=useState('');

  useEffect(()=>{
    try { setShipments(JSON.parse(localStorage.getItem('mayaviShipments')||'[]')); } catch{}
    fetch('/api/track').then(r=>r.json()).then(d=>setApiConfigured(Boolean(d.configured))).catch(()=>setApiConfigured(false));
  },[]);
  useEffect(()=>{ localStorage.setItem('mayaviShipments', JSON.stringify(shipments)); },[shipments]);

  const activeCount=useMemo(()=>shipments.filter(s=>!String(s.status||'').toLowerCase().includes('arriv')).length,[shipments]);

  function upsertShipment(item){
    setShipments(v=>{
      const key=normalizeMawb(item.mawb);
      const idx=v.findIndex(x=>normalizeMawb(x.mawb)===key);
      if(idx<0) return [item,...v];
      const copy=[...v];
      copy[idx]={...copy[idx],...Object.fromEntries(Object.entries(item).filter(([,val])=>val!==''&&val!==null&&val!==undefined)),id:copy[idx].id};
      return copy;
    });
  }

  function saveManual(e){
    e.preventDefault();
    if(!form.mawb) return setNotice('Enter a MAWB number.');
    const item={...form,mawb:normalizeMawb(form.mawb),id:crypto.randomUUID(),status:'Saved — live status not fetched yet',remarks:'',updatedAt:new Date().toISOString()};
    upsertShipment(item); setForm(EMPTY); setManualOpen(false); setNotice('Shipment saved. Click Track Live.');
  }

  async function trackOne(id, forceRefresh=false){
    const s=shipments.find(x=>x.id===id); if(!s) return;
    setBusy(true); setNotice(`Checking ${s.mawb} with Track123…`);
    try{
      const reg = await fetch('/api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mawb:s.mawb,carrierCode:s.carrierCode})});
      await reg.json().catch(()=>({}));
      const r=await fetch('/api/track',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mawb:s.mawb,carrierCode:s.carrierCode,forceRefresh})});
      const d=await r.json();
      if(!r.ok) throw new Error(d.error || JSON.stringify(d.details||d));
      const live=d.shipment||{}; const p=localParts(live.eta||live.actualArrival);
      setShipments(v=>v.map(x=>x.id===id?{...x,
        status:live.status||x.status, carrierCode:live.carrierCode||x.carrierCode,
        origin:live.origin||x.origin,destination:live.destination||x.destination,
        arrivalDate:p.date||x.arrivalDate,arrivalTime:p.time||x.arrivalTime,
        flightNo:live.flightNo||x.flightNo,rawTrack123:live.raw,
        updatedAt:new Date().toISOString(),remarks:'LIVE — Track123 response received'
      }:x));
      setNotice(`Live Track123 response received for ${s.mawb}.`);
    }catch(e){ setNotice(`Live tracking error: ${e.message}`); }
    finally{ setBusy(false); }
  }

  async function refreshAll(){ for(const s of shipments) await trackOne(s.id,false); }

  async function readPdf(file){
    setOcrProgress('Reading PDF text…');
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;
    const buf=await file.arrayBuffer(); const pdf=await pdfjs.getDocument({data:buf}).promise;
    let text='';
    for(let i=1;i<=pdf.numPages;i++){
      const page=await pdf.getPage(i); const content=await page.getTextContent();
      text += ' ' + content.items.map(x=>x.str).join(' ');
    }
    if(text.replace(/\s/g,'').length>20) return text;
    setOcrProgress('PDF has little selectable text. OCR will read the first page…');
    const page=await pdf.getPage(1); const viewport=page.getViewport({scale:2});
    const canvas=document.createElement('canvas'); canvas.width=viewport.width; canvas.height=viewport.height;
    await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
    return await runOcr(canvas.toDataURL('image/png'));
  }
  async function runOcr(source){
    setOcrProgress('OCR reading image…');
    const { createWorker } = await import('tesseract.js');
    const worker=await createWorker('eng',1,{logger:m=>{ if(m.status) setOcrProgress(`${m.status} ${m.progress?Math.round(m.progress*100)+'%':''}`); }});
    const {data}=await worker.recognize(source); await worker.terminate(); return data.text||'';
  }
  async function uploadFile(e){
    const file=e.target.files?.[0]; e.target.value=''; if(!file) return;
    setBusy(true); setNotice('');
    try{
      let text;
      if(file.type==='application/pdf'||file.name.toLowerCase().endsWith('.pdf')) text=await readPdf(file);
      else text=await runOcr(file);
      const found=extractFields(text);
      if(!found.mawb) throw new Error('I could read the file, but could not confidently find an 11-digit MAWB. Use Manual Entry and type the MAWB.');
      const item={...EMPTY,...found,id:crypto.randomUUID(),status:'Document read — ready for live tracking',remarks:'Extracted from '+file.name,updatedAt:new Date().toISOString()};
      upsertShipment(item);
      const extras=[found.flightNo,found.arrivalDate,found.arrivalTime,found.bags&&`${found.bags} bags`,found.weight&&`${found.weight} kg`].filter(Boolean).join(' · ');
      setNotice(`Document read successfully. MAWB found: ${found.mawb}${extras?' · '+extras:''}`);
    }catch(e){ setNotice(`Upload/OCR error: ${e.message}`); }
    finally{ setBusy(false); setOcrProgress(''); }
  }

  function remove(id){ setShipments(v=>v.filter(x=>x.id!==id)); }

  return <main>
    <header>
      <div><h1>MAYAVI CARGO</h1><p>Arrival & 6-Hour Mail Tracker</p></div>
      <div className="right"><div>{new Date().toLocaleDateString('en-IN')}</div><span className={apiConfigured?'live':'offline'}>{apiConfigured?'● TRACK123 KEY CONNECTED':'● TRACK123 KEY MISSING'}</span></div>
    </header>
    <section className="toolbar">
      <button className="primary" onClick={()=>setManualOpen(true)}>+ Manual Entry</button>
      <label className="button">Upload Pic / PDF<input type="file" accept="image/*,.pdf,application/pdf" hidden onChange={uploadFile}/></label>
      <button onClick={refreshAll} disabled={busy||!shipments.length}>Refresh Status</button>
      <div className="summary">{shipments.length} shipment(s) · {activeCount} active</div>
    </section>
    {(notice||ocrProgress)&&<div className="notice">{ocrProgress||notice}</div>}
    <section className="tableWrap">
      <table><thead><tr><th>MAWB</th><th>Bags</th><th>Weight</th><th>Origin</th><th>Destination</th><th>Arrival Date</th><th>Arrival Time</th><th>Mail Due</th><th>Status</th><th>Remarks</th><th></th></tr></thead>
      <tbody>{!shipments.length?<tr><td colSpan="11" className="empty">No shipments yet. Add a MAWB or upload a MAWB PDF/photo.</td></tr>:shipments.map(s=><tr key={s.id} className={statusClass(s.status)}>
        <td><b>{s.mawb}</b>{s.flightNo&&<small>{s.flightNo}</small>}</td><td>{s.bags||'—'}</td><td>{s.weight?`${s.weight} kg`:'—'}</td><td>{s.origin||'—'}</td><td>{s.destination||'—'}</td><td>{s.arrivalDate||'—'}</td><td>{s.arrivalTime||'—'}</td><td>{mailDue(s)||'—'}</td><td><b>{s.status||'—'}</b><small>{s.updatedAt?`Updated ${new Date(s.updatedAt).toLocaleTimeString()}`:''}</small></td><td>{s.remarks||'—'}</td><td className="actions"><button onClick={()=>trackOne(s.id,false)} disabled={busy}>Track Live</button><button className="x" onClick={()=>remove(s.id)}>×</button></td>
      </tr>)}</tbody></table>
    </section>
    <section className="help"><b>Document + live tracking.</b> The uploaded manifest supplies MAWB, bags, weight, flight, scheduled arrival date/time and route when present. “Track Live” then uses Track123 to update live milestones without erasing document data if Track123 omits ETA.</section>

    {manualOpen&&<div className="modal"><form onSubmit={saveManual}><h2>Add Shipment</h2><div className="grid">
      <label>MAWB*<input value={form.mawb} onChange={e=>setForm({...form,mawb:e.target.value})} placeholder="020-12345678" required/></label>
      <label>Carrier code<input value={form.carrierCode} onChange={e=>setForm({...form,carrierCode:e.target.value})} placeholder="optional Track123 carrier code"/></label>
      <label>Bags<input value={form.bags} onChange={e=>setForm({...form,bags:e.target.value})}/></label><label>Weight (kg)<input value={form.weight} onChange={e=>setForm({...form,weight:e.target.value})}/></label>
      <label>Origin<input value={form.origin} onChange={e=>setForm({...form,origin:e.target.value.toUpperCase()})} placeholder="DEL"/></label><label>Destination<input value={form.destination} onChange={e=>setForm({...form,destination:e.target.value.toUpperCase()})} placeholder="LHR"/></label>
      <label>Arrival date<input type="date" value={form.arrivalDate} onChange={e=>setForm({...form,arrivalDate:e.target.value})}/></label><label>Arrival time<input type="time" value={form.arrivalTime} onChange={e=>setForm({...form,arrivalTime:e.target.value})}/></label>
    </div><div className="modalBtns"><button type="button" onClick={()=>setManualOpen(false)}>Cancel</button><button className="primary" type="submit">Save Shipment</button></div></form></div>}
  </main>
}
