'use client';

import { useEffect, useMemo, useState } from 'react';

const EMPTY = { mawb:'', bags:'', weight:'', origin:'', destination:'', arrivalDate:'', arrivalTime:'', carrierCode:'', flightNo:'' };

function normalizeMawb(v='') {
  const d = String(v).replace(/\D/g,'');
  return d.length >= 11 ? `${d.slice(0,3)}-${d.slice(3,11)}` : String(v).trim();
}
function airlineFromMawb(mawb=''){
  const prefix=String(mawb).replace(/\D/g,'').slice(0,3);
  const map={
    '001':{name:'American Airlines Cargo',iata:'AA',official:'https://www.aacargo.com/'},
    '006':{name:'Delta Cargo',iata:'DL',official:'https://www.deltacargo.com/'},
    '014':{name:'Air Canada Cargo',iata:'AC',official:'https://www.aircanada.com/cargo/'},
    '016':{name:'United Cargo',iata:'UA',official:'https://www.unitedcargo.com/'},
    '020':{name:'Lufthansa Cargo',iata:'LH',official:'https://www.lufthansa-cargo.com/'},
    '023':{name:'FedEx Express',iata:'FX',official:'https://www.fedex.com/en-us/tracking.html'},
    '057':{name:'Air France KLM Martinair Cargo',iata:'AF',official:'https://www.afklcargo.com/'},
    '065':{name:'Saudia Cargo',iata:'SV',official:'https://www.saudiacargo.com/'},
    '074':{name:'KLM Cargo',iata:'KL',official:'https://www.afklcargo.com/'},
    '075':{name:'Iberia Cargo',iata:'IB',official:'https://www.iberia.com/cargo/'},
    '081':{name:'Qantas Freight',iata:'QF',official:'https://freight.qantas.com/'},
    '098':{name:'Air India Cargo',iata:'AI',official:'https://cargo.airindia.com/'},
    '105':{name:'Finnair Cargo',iata:'AY',official:'https://cargo.finnair.com/'},
    '125':{name:'British Airways / IAG Cargo',iata:'BA',official:'https://www.iagcargo.com/'},
    '131':{name:'Japan Airlines Cargo',iata:'JL',official:'https://www.jal.co.jp/jalcargo/'},
    '157':{name:'Qatar Airways Cargo',iata:'QR',official:'https://www.qrcargo.com/s/track-your-shipment'},
    '160':{name:'Cathay Cargo',iata:'CX',official:'https://www.cathaycargo.com/'},
    '176':{name:'Emirates SkyCargo',iata:'EK',official:'https://www.skycargo.com/'},
    '180':{name:'Korean Air Cargo',iata:'KE',official:'https://cargo.koreanair.com/'},
    '205':{name:'ANA Cargo',iata:'NH',official:'https://www.anacargo.jp/en/'},
    '217':{name:'Thai Airways Cargo',iata:'TG',official:'https://www.thaicargo.com/'},
    '232':{name:'Malaysia Airlines Cargo',iata:'MH',official:'https://www.maskargo.com/'},
    '235':{name:'Turkish Cargo',iata:'TK',official:'https://www.turkishcargo.com.tr/'},
    '297':{name:'China Airlines Cargo',iata:'CI',official:'https://cargo.china-airlines.com/'},
    '406':{name:'UPS Airlines',iata:'5X',official:'https://www.ups.com/track'},
    '607':{name:'Etihad Cargo',iata:'EY',official:'https://www.etihadcargo.com/'},
    '618':{name:'Singapore Airlines Cargo',iata:'SQ',official:'https://www.singaporeair.com/'},
    '724':{name:'SWISS WorldCargo',iata:'LX',official:'https://www.swissworldcargo.com/'},
    '988':{name:'Asiana Cargo',iata:'OZ',official:'https://www.asiana-cargo.com/'},
    '999':{name:'Air China Cargo',iata:'CA',official:'https://www.airchinacargo.com/' }
  };
  if(map[prefix]) return map[prefix];
  return {
    name:prefix?`Airline prefix ${prefix}`:'Unknown airline',
    iata:'',
    official:prefix?`https://www.google.com/search?q=${encodeURIComponent('AWB prefix '+prefix+' official airline cargo tracking')}`:''
  };
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
function mailAlert(s){
  const arrival=arrivalDateObj(s);
  if(!arrival) return 'WAITING FOR LIVE ETA';
  const now=Date.now();
  const diff=arrival.getTime()-now;
  const status=String(s.status||'').toLowerCase();
  if(status.includes('arriv')||status.includes('rcf')||diff<=0) return 'ARRIVED';
  if(diff<=60*60*1000) return 'LANDING SOON — MAIL NOW';
  if(diff<=6*60*60*1000) return 'MAIL NOW';
  return `MAIL AT ${new Date(arrival.getTime()-6*3600000).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}`;
}
function statusClass(status=''){
  const t=status.toLowerCase();
  if(t.includes('arriv')||t.includes('delivered')||t.includes('rcf')) return 'green';
  if(t.includes('late')||t.includes('delay')||t.includes('exception')) return 'red';
  if(t.includes('early')) return 'pink';
  return 'white';
}
function extractMawb(text=''){
  const flat = text.replace(/\s+/g,' ');
  const mawbMatch = flat.match(/(?:MAWB(?:\s*No\.?)?\s*[:#-]*\s*)?(\d{3})[-\s]?(\d{8})\b/i);
  return mawbMatch ? `${mawbMatch[1]}-${mawbMatch[2]}` : '';
}

export default function Home(){
  const [shipments,setShipments]=useState([]);
  const [form,setForm]=useState(EMPTY);
  const [manualOpen,setManualOpen]=useState(false);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState('');
  const [apiConfigured,setApiConfigured]=useState(null);
  const [ocrProgress,setOcrProgress]=useState('');
  const [bagEditId,setBagEditId]=useState('');
  const [bagEditValue,setBagEditValue]=useState('');

  useEffect(()=>{
    try { setShipments(JSON.parse(localStorage.getItem('mayaviShipments')||'[]')); } catch{}
    fetch('/api/track').then(r=>r.json()).then(d=>setApiConfigured(Boolean(d.configured))).catch(()=>setApiConfigured(false));
  },[]);
  useEffect(()=>{ localStorage.setItem('mayaviShipments', JSON.stringify(shipments)); },[shipments]);

  const activeCount=useMemo(()=>shipments.filter(s=>!String(s.status||'').toLowerCase().includes('arriv')).length,[shipments]);

  function upsertMawbOnly(mawb, sourceLabel=''){
    const key=normalizeMawb(mawb);
    const airline=airlineFromMawb(key);
    setShipments(v=>{
      const idx=v.findIndex(x=>normalizeMawb(x.mawb)===key);
      if(idx<0){
        return [{...EMPTY,mawb:key,airlineName:airline.name,airlineIata:airline.iata,officialTracker:airline.official,id:crypto.randomUUID(),status:'MAWB identified — ready for live tracking',remarks:sourceLabel?`MAWB read from ${sourceLabel}`:'',updatedAt:new Date().toISOString()},...v];
      }
      const copy=[...v];
      copy[idx]={...copy[idx],mawb:key,airlineName:airline.name,airlineIata:airline.iata,officialTracker:airline.official,status:copy[idx].status||'MAWB identified — ready for live tracking',remarks:sourceLabel?`MAWB read from ${sourceLabel}`:copy[idx].remarks,updatedAt:new Date().toISOString()};
      return copy;
    });
  }

  function saveManual(e){
    e.preventDefault();
    if(!form.mawb) return setNotice('Enter a MAWB number.');
    upsertMawbOnly(form.mawb);
    setForm(EMPTY); setManualOpen(false); setNotice('MAWB saved. Airline detected from AWB prefix.');
  }

  function startBagEdit(s){ setBagEditId(s.id); setBagEditValue(s.bags||''); }
  function saveBags(id){
    const value=String(bagEditValue).replace(/\D/g,'');
    setShipments(v=>v.map(x=>x.id===id?{...x,bags:value,updatedAt:new Date().toISOString()}:x));
    setBagEditId(''); setBagEditValue('');
    setNotice('Number of bags saved manually. Live tracking will not erase it unless Track123 returns a bags value.');
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
      const liveBags=live.bags ?? live.pieces ?? live.pcs ?? '';
      const liveWeight=live.weight ?? live.grossWeight ?? '';
      setShipments(v=>v.map(x=>x.id===id?{
        ...x,
        bags: liveBags!=='' ? liveBags : x.bags,
        weight: liveWeight!=='' ? liveWeight : x.weight,
        status:live.status||x.status,
        carrierCode:live.carrierCode||x.carrierCode,
        origin:live.origin||x.origin,
        destination:live.destination||x.destination,
        arrivalDate:p.date||x.arrivalDate,
        arrivalTime:p.time||x.arrivalTime,
        flightNo:live.flightNo||x.flightNo,
        rawTrack123:live.raw,
        updatedAt:new Date().toISOString(),
        remarks:'LIVE — Track123 response received'
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
      const mawb=extractMawb(text);
      if(!mawb) throw new Error('I could read the file, but could not confidently find an 11-digit MAWB. Use Manual Entry and type the MAWB.');
      upsertMawbOnly(mawb,file.name);
      const airline=airlineFromMawb(mawb);
      setNotice(`MAWB found: ${mawb}. Airline detected: ${airline.name}.`);
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
      <table><thead><tr><th>MAWB</th><th>Airline</th><th>Bags</th><th>Weight</th><th>Origin</th><th>Destination</th><th>Arrival Date</th><th>Arrival Time</th><th>Mail Due</th><th>Mail Alert</th><th>Status</th><th>Remarks</th><th></th></tr></thead>
      <tbody>{!shipments.length?<tr><td colSpan="13" className="empty">No shipments yet. Add a MAWB or upload a MAWB PDF/photo.</td></tr>:shipments.map(s=>{const airline=airlineFromMawb(s.mawb);return <tr key={s.id} className={statusClass(s.status)}>
        <td><b>{s.mawb}</b>{s.flightNo&&<small>{s.flightNo}</small>}</td>
        <td><b>{s.airlineName||airline.name}</b>{(s.officialTracker||airline.official)&&<small><a href={s.officialTracker||airline.official} target="_blank" rel="noreferrer">Official tracker ↗</a></small>}</td>
        <td>{bagEditId===s.id?<span><input style={{width:'65px'}} inputMode="numeric" value={bagEditValue} onChange={e=>setBagEditValue(e.target.value)}/><button onClick={()=>saveBags(s.id)}>Save</button></span>:<span>{s.bags||'—'} <button onClick={()=>startBagEdit(s)}>Edit</button></span>}</td>
        <td>{s.weight?`${s.weight} kg`:'—'}</td><td>{s.origin||'—'}</td><td>{s.destination||'—'}</td><td>{s.arrivalDate||'—'}</td><td>{s.arrivalTime||'—'}</td><td>{mailDue(s)||'—'}</td><td><b>{mailAlert(s)}</b></td><td><b>{s.status||'—'}</b><small>{s.updatedAt?`Updated ${new Date(s.updatedAt).toLocaleTimeString()}`:''}</small></td><td>{s.remarks||'—'}</td><td className="actions"><button onClick={()=>trackOne(s.id,false)} disabled={busy}>Track Live</button><button className="x" onClick={()=>remove(s.id)}>×</button></td>
      </tr>})}</tbody></table>
    </section>
    <section className="help"><b>Airline-aware MAWB tracking.</b> Mayavi detects many major cargo airlines directly from the MAWB prefix and opens their official cargo tracker. If a prefix is not yet in the built-in list, Mayavi gives an airline-prefix search link instead of guessing. Automatic website extraction will only be enabled where an airline provides a stable machine-readable endpoint; Mayavi will not invent ETA data.</section>

    {manualOpen&&<div className="modal"><form onSubmit={saveManual}><h2>Add Shipment</h2><div className="grid">
      <label>MAWB*<input value={form.mawb} onChange={e=>setForm({...form,mawb:e.target.value})} placeholder="020-12345678" required/></label>
    </div><div className="modalBtns"><button type="button" onClick={()=>setManualOpen(false)}>Cancel</button><button className="primary" type="submit">Save MAWB</button></div></form></div>}
  </main>
}
