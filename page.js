'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

const EMPTY_FORM={clientName:'',mawb:'',bags:'',weight:''};
const AUTO_REFRESH_MS=20*60*1000;
const EARLY_LATE_MINUTES=30;

const AIRLINES={
'001':{name:'American Airlines Cargo',iata:'AA',official:'https://www.aacargo.com/'},
'006':{name:'Delta Cargo',iata:'DL',official:'https://www.deltacargo.com/'},
'014':{name:'Air Canada Cargo',iata:'AC',official:'https://www.aircanada.com/cargo/'},
'016':{name:'United Cargo',iata:'UA',official:'https://www.unitedcargo.com/'},
'020':{name:'Lufthansa Cargo',iata:'LH',official:'https://www.lufthansa-cargo.com/'},
'023':{name:'FedEx Express',iata:'FX',official:'https://www.fedex.com/en-us/tracking.html'},
'057':{name:'Air France KLM Martinair Cargo',iata:'AF',official:'https://www.afklcargo.com/'},
'065':{name:'Saudia Cargo',iata:'SV',official:'https://www.saudiacargo.com/'},
'071':{name:'Ethiopian Cargo',iata:'ET',official:'https://cargo.ethiopianairlines.com/my-cargo/track-your-shipment'},
'074':{name:'KLM Cargo',iata:'KL',official:'https://www.afklcargo.com/'},
'075':{name:'Iberia Cargo',iata:'IB',official:'https://www.iberia.com/cargo/'},
'081':{name:'Qantas Freight',iata:'QF',official:'https://freight.qantas.com/'},
'098':{name:'Air India Cargo',iata:'AI',official:'https://cargo.airindia.com/'},
'105':{name:'Finnair Cargo',iata:'AY',official:'https://cargo.finnair.com/'},
'125':{name:'British Airways / IAG Cargo',iata:'BA',official:'https://www.iagcargo.com/'},
'131':{name:'Japan Airlines Cargo',iata:'JL',official:'https://www.jal.co.jp/jalcargo/'},
'157':{name:'Qatar Airways Cargo',iata:'QR',official:'https://www.qrcargo.com/s/track-your-shipment'},
'160':{name:'Cathay Cargo',iata:'CX',official:'https://www.cathaycargo.com/'},
'176':{name:'Emirates SkyCargo',iata:'EK',official:'https://scekprd.emirates.com/skychain/app?initial=y&service=page%2Fnwp%3ATrackshipmt'},
'180':{name:'Korean Air Cargo',iata:'KE',official:'https://cargo.koreanair.com/'},
'205':{name:'ANA Cargo',iata:'NH',official:'https://www.anacargo.jp/en/'},
'217':{name:'Thai Airways Cargo',iata:'TG',official:'https://www.thaicargo.com/'},
'232':{name:'Malaysia Airlines Cargo',iata:'MH',official:'https://www.maskargo.com/'},
'235':{name:'Turkish Cargo',iata:'TK',official:'https://www.turkishcargo.com.tr/'},
'297':{name:'China Airlines Cargo',iata:'CI',official:'https://cargo.china-airlines.com/'},
'312':{name:'IndiGo CarGo',iata:'6E',official:'https://6ecargo.goindigo.in/FrmAWBTracking.aspx'},
'406':{name:'UPS Airlines',iata:'5X',official:'https://www.ups.com/track'},
'607':{name:'Etihad Cargo',iata:'EY',official:'https://www.etihadcargo.com/'},
'618':{name:'Singapore Airlines Cargo',iata:'SQ',official:'https://www.singaporeair.com/'},
'724':{name:'SWISS WorldCargo',iata:'LX',official:'https://www.swissworldcargo.com/'},
'988':{name:'Asiana Cargo',iata:'OZ',official:'https://www.asiana-cargo.com/'},
'999':{name:'Air China Cargo',iata:'CA',official:'https://www.airchinacargo.com/'}
};

function pad(n){return String(n).padStart(2,'0');}
function normalizeMawb(v=''){
  const d=String(v).replace(/\D/g,'');
  return d.length>=11?`${d.slice(0,3)}-${d.slice(3,11)}`:String(v).trim();
}
function airlineFromMawb(mawb=''){
  const p=String(mawb).replace(/\D/g,'').slice(0,3);
  return AIRLINES[p]||{name:p?`Airline prefix ${p}`:'Unknown airline',iata:'',official:''};
}
function localParts(value){
  if(!value)return{};
  const d=new Date(value);
  if(Number.isNaN(d.getTime()))return{};
  return{date:`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`,time:`${pad(d.getHours())}:${pad(d.getMinutes())}`};
}
function arrivalDateObj(s){
  if(!s.arrivalDate||!s.arrivalTime)return null;
  const d=new Date(`${s.arrivalDate}T${s.arrivalTime}:00`);
  return Number.isNaN(d.getTime())?null:d;
}
function arrivalIso(date,time){
  if(!date||!time)return'';
  const d=new Date(`${date}T${time}:00`);
  return Number.isNaN(d.getTime())?'':d.toISOString();
}
function mailTime(s){
  const d=arrivalDateObj(s);
  if(!d)return'—';
  const m=new Date(d.getTime()-5*3600000);
  return m.toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});
}
function statusClass(status=''){
  const t=String(status).toLowerCase();
  if(t.includes('arrived')&&!t.includes('early')&&!t.includes('delay'))return'green';
  if(t.includes('delay')||t.includes('late'))return'red';
  if(t.includes('early'))return'pink';
  return'white';
}
function extractMawbs(text=''){
  const source=String(text).replace(/[‐‑‒–—]/g,'-');
  const found=new Set();
  for(const m of source.matchAll(/\b(\d{3})[\s-]*(\d{8})\b/g))found.add(`${m[1]}-${m[2]}`);
  for(const m of source.matchAll(/\b(\d{3})\D{1,4}(\d{4})\D{1,4}(\d{4})\b/g)){
    if(AIRLINES[m[1]])found.add(`${m[1]}-${m[2]}${m[3]}`);
  }
  return[...found];
}
function isFinished(status=''){
  return/arrived|delivered|notified consignee|received at destination/i.test(String(status));
}
function statusFromLive(previous,live,etaIso){
  const raw=String(live?.status||'').toUpperCase();
  const baseline=previous?.baselineArrival||'';
  const actualIso=live?.actualArrival||(live?.arrivalIsActual?etaIso:'');
  const compare=(value)=>{
    if(!value||!baseline)return 0;
    const a=new Date(value).getTime(),b=new Date(baseline).getTime();
    if(Number.isNaN(a)||Number.isNaN(b))return 0;
    return Math.round((a-b)/60000);
  };
  if(/ARRIV|DELIVER|RCF|NOTIFIED CONSIGNEE|RECEIVED AT DESTINATION/.test(raw)||actualIso){
    const diff=compare(actualIso||etaIso);
    if(diff<=-EARLY_LATE_MINUTES)return'EARLY ARRIVAL';
    if(diff>=EARLY_LATE_MINUTES)return'DELAYED ARRIVAL';
    return'ARRIVED';
  }
  if(/DELAY|LATE|EXCEPTION/.test(raw))return'DELAYED';
  if(/EARLY/.test(raw))return'EARLY ARRIVAL';
  const etaDiff=compare(etaIso);
  if(etaDiff>=EARLY_LATE_MINUTES)return'DELAYED';
  if(etaDiff<=-EARLY_LATE_MINUTES)return'EARLY';
  if(/DEPART|IN[_ ]?TRANSIT|IN FLIGHT|AIRBORNE|MANIFEST|RECEIVED|RCS|BOOKED|TRACKING/.test(raw)||etaIso)return'IN TRANSIT';
  if(/WAITING|CHECKING/.test(raw))return'CHECKING';
  return raw||'CHECKING';
}

export default function Home(){
  const[shipments,setShipments]=useState([]);
  const[form,setForm]=useState(EMPTY_FORM);
  const[manualOpen,setManualOpen]=useState(false);
  const[busy,setBusy]=useState(false);
  const[notice,setNotice]=useState('');
  const[routerReady,setRouterReady]=useState(null);
  const[ocrProgress,setOcrProgress]=useState('');
  const[uploadClient,setUploadClient]=useState('');
  const shipmentsRef=useRef([]);

  useEffect(()=>{
    try{setShipments(JSON.parse(localStorage.getItem('mayaviShipments')||'[]'));}catch{}
    fetch('/api/track').then(r=>r.json()).then(d=>setRouterReady(Boolean(d.configured))).catch(()=>setRouterReady(false));
  },[]);
  useEffect(()=>{shipmentsRef.current=shipments;localStorage.setItem('mayaviShipments',JSON.stringify(shipments));},[shipments]);
  useEffect(()=>{
    const id=setInterval(async()=>{
      const active=shipmentsRef.current.filter(s=>!isFinished(s.status)).slice(0,6);
      for(const s of active)await trackMawb(s.mawb,false,true);
    },AUTO_REFRESH_MS);
    return()=>clearInterval(id);
  },[]);

  const activeCount=useMemo(()=>shipments.filter(s=>!isFinished(s.status)).length,[shipments]);

  function patchRow(id,patch){
    setShipments(v=>v.map(x=>x.id===id?{...x,...patch,updatedAt:new Date().toISOString()}:x));
  }

  function upsertMawbs(mawbs,sourceLabel='',clientName='',seed={}){
    const unique=[...new Set(mawbs.map(normalizeMawb).filter(x=>/^\d{3}-\d{8}$/.test(x)))];
    setShipments(v=>{
      const next=[...v];
      for(const mawb of unique){
        const airline=airlineFromMawb(mawb);
        const i=next.findIndex(x=>normalizeMawb(x.mawb)===mawb);
        if(i<0){
          next.unshift({
            id:crypto.randomUUID(),mawb,clientName:clientName||'',bags:seed.bags||'',weight:seed.weight||'',origin:'',arrivalDate:'',arrivalTime:'',flightNo:'',
            airlineName:airline.name,airlineIata:airline.iata,officialTracker:airline.official,status:'CHECKING',baselineArrival:'',dataSource:'TrackJet → official airline',
            remarks:sourceLabel?`Read from ${sourceLabel}`:'',updatedAt:new Date().toISOString()
          });
        }else{
          next[i]={...next[i],clientName:clientName||next[i].clientName||'',bags:seed.bags||next[i].bags||'',weight:seed.weight||next[i].weight||'',airlineName:airline.name,airlineIata:airline.iata,officialTracker:airline.official,updatedAt:new Date().toISOString()};
        }
      }
      return next;
    });
    return unique;
  }

  async function trackMawb(mawb,forceRefresh=false,silent=false){
    const key=normalizeMawb(mawb),airline=airlineFromMawb(key);
    if(!silent)setNotice(`Tracking ${key}: ${airline.name} via TrackJet → official carrier…`);
    try{
      const r=await fetch('/api/track',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mawb:key,forceRefresh})});
      const d=await r.json();
      if(!r.ok)throw new Error(d.error||'Tracking request failed');
      const live=d.shipment||{};
      const parts=(live.arrivalDate&&live.arrivalTime)?{date:live.arrivalDate,time:live.arrivalTime}:localParts(live.actualArrival||live.eta);
      const etaIso=arrivalIso(parts.date,parts.time)||(live.actualArrival||live.eta||'');
      const debug=d.trackingDebug||{};
      setShipments(list=>list.map(prev=>{
        if(normalizeMawb(prev.mawb)!==key)return prev;
        const status=statusFromLive(prev,live,etaIso);
        return{
          ...prev,
          airlineName:airline.name,airlineIata:airline.iata,officialTracker:airline.official,
          flightNo:live.flightNo||prev.flightNo||'',
          bags:live.bags??live.pieces??prev.bags??'',
          weight:live.weight??prev.weight??'',
          origin:live.origin||prev.origin||'',
          arrivalDate:parts.date||prev.arrivalDate||'',
          arrivalTime:parts.time||prev.arrivalTime||'',
          baselineArrival:prev.baselineArrival||etaIso||'',
          status,
          dataSource:d.source||live.source||'TrackJet → official airline',
          remarks:d.trackingError?`${debug.stage||'Carrier check'} · ${d.trackingError}`:(parts.date&&parts.time?`Live arrival ${parts.date} ${parts.time}`:`${debug.stage||'Carrier checked'} · waiting for ETA`),
          updatedAt:new Date().toISOString()
        };
      }));
      if(!silent){
        if(parts.date&&parts.time)setNotice(`${airline.name}: live arrival ${parts.date} ${parts.time} received. Mail time is automatically 5 hours earlier.`);
        else setNotice(`${airline.name}: carrier checked. ${d.trackingError||'Arrival time is not published yet.'}`);
      }
    }catch(e){
      setShipments(list=>list.map(x=>normalizeMawb(x.mawb)===key?{...x,status:'CHECKING',remarks:`Tracking error · ${e.message}`,updatedAt:new Date().toISOString()}:x));
      if(!silent)setNotice(`Live tracking error for ${key}: ${e.message}`);
    }
  }

  async function trackOne(mawb){
    setBusy(true);
    try{await trackMawb(mawb,true,false);}finally{setBusy(false);}
  }

  async function refreshAll(){
    const active=shipmentsRef.current.filter(s=>!isFinished(s.status));
    if(!active.length)return setNotice('No active shipments to refresh.');
    setBusy(true);
    try{
      for(let i=0;i<active.length;i++){
        setNotice(`Refreshing ${i+1}/${active.length}: ${active[i].mawb}`);
        await trackMawb(active[i].mawb,true,true);
      }
      setNotice(`Refresh complete for ${active.length} active shipment(s).`);
    }finally{setBusy(false);}
  }

  async function runOcr(source,label='image'){
    setOcrProgress(`OCR reading ${label}…`);
    const{createWorker}=await import('tesseract.js');
    const w=await createWorker('eng',1,{logger:m=>{if(m.status)setOcrProgress(`${m.status} ${m.progress?Math.round(m.progress*100)+'%':''}`);}});
    const{data}=await w.recognize(source);
    await w.terminate();
    return data.text||'';
  }

  async function readPdf(file){
    setOcrProgress(`Reading PDF: ${file.name}`);
    const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc=`https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;
    const pdf=await pdfjs.getDocument({data:await file.arrayBuffer()}).promise;
    let text='';
    for(let i=1;i<=pdf.numPages;i++){
      const p=await pdf.getPage(i),c=await p.getTextContent();
      text+=' '+c.items.map(x=>x.str).join(' ');
    }
    if(extractMawbs(text).length)return text;
    let scanned='';
    for(let i=1;i<=Math.min(pdf.numPages,3);i++){
      const p=await pdf.getPage(i),vp=p.getViewport({scale:2}),canvas=document.createElement('canvas');
      canvas.width=vp.width;canvas.height=vp.height;
      await p.render({canvasContext:canvas.getContext('2d'),viewport:vp}).promise;
      scanned+=' '+await runOcr(canvas.toDataURL('image/png'),`PDF page ${i}`);
    }
    return scanned;
  }

  async function uploadFiles(e){
    const files=[...(e.target.files||[])];
    e.target.value='';
    if(!files.length)return;
    setBusy(true);
    try{
      const all=new Set();
      for(let i=0;i<files.length;i++){
        const file=files[i];
        setOcrProgress(`Reading ${i+1}/${files.length}: ${file.name}`);
        const text=file.type==='application/pdf'||file.name.toLowerCase().endsWith('.pdf')?await readPdf(file):await runOcr(file,file.name);
        extractMawbs(text).forEach(x=>all.add(x));
      }
      const mawbs=[...all];
      if(!mawbs.length)throw new Error('Could not confidently find a MAWB. Use a clear photo showing the full 11-digit master number.');
      const added=upsertMawbs(mawbs,files.length===1?files[0].name:`${files.length} uploaded files`,uploadClient);
      setOcrProgress('');
      for(let i=0;i<added.length;i++){
        setNotice(`Found ${added.length} MAWB(s). Live tracking ${i+1}/${added.length}: ${added[i]}`);
        await trackMawb(added[i],false,true);
      }
      setNotice(`${added.length} MAWB(s) extracted and sent through live carrier tracking.`);
    }catch(e){
      setNotice(`Upload/OCR error: ${e.message}`);
    }finally{setBusy(false);setOcrProgress('');}
  }

  async function saveManual(e){
    e.preventDefault();
    const mawb=normalizeMawb(form.mawb);
    if(!/^\d{3}-\d{8}$/.test(mawb))return setNotice('Enter a valid 11-digit MAWB.');
    upsertMawbs([mawb],'manual entry',form.clientName,{bags:form.bags,weight:form.weight});
    setForm(EMPTY_FORM);setManualOpen(false);setBusy(true);
    try{await trackMawb(mawb,false,false);}finally{setBusy(false);}
  }

  function remove(id){setShipments(v=>v.filter(x=>x.id!==id));}

  return <main>
    <header>
      <div><h1>MAYAVI CARGO — LIVE FLIGHT TRACKER</h1><p>Photo/PDF → MAWB → Airline Prefix → TrackJet → Official Airline → ETA → 5-Hour Mail Time</p></div>
      <div className="right"><div>{new Date().toLocaleDateString('en-IN')}</div><span className={routerReady?'live':'offline'}>{routerReady?'● LIVE ROUTER READY':'● ROUTER CHECKING'}</span><small>Auto refresh: 20 min</small></div>
    </header>

    <section className="toolbar">
      <button className="primary" onClick={()=>setManualOpen(true)}>+ Manual MAWB</button>
      <input className="toolbarInput" value={uploadClient} onChange={e=>setUploadClient(e.target.value)} placeholder="Client name for upload (optional)" />
      <label className="button">Upload Pic / PDF(s)<input type="file" accept="image/*,.pdf,application/pdf" multiple hidden onChange={uploadFiles}/></label>
      <button onClick={refreshAll} disabled={busy||!shipments.length}>{busy?'Working…':'Refresh Live Status'}</button>
      <div className="summary">{shipments.length} shipment(s) · {activeCount} active</div>
    </section>

    {(notice||ocrProgress)&&<div className="notice">{ocrProgress||notice}</div>}

    <section className="tableWrap"><table>
      <thead><tr><th>Client</th><th>MAWB</th><th>Airline</th><th>Flight</th><th>Bags</th><th>Weight</th><th>Origin</th><th>Estimated Arrival Date</th><th>Estimated Arrival Time</th><th>Mail Time (-5h)</th><th>Status</th><th>Live Source</th><th></th></tr></thead>
      <tbody>{!shipments.length?<tr><td colSpan="13" className="empty">Upload a clear MAWB photo/PDF or enter a MAWB manually. One photo may contain multiple MAWBs.</td></tr>:shipments.map(s=>{
        const airline=airlineFromMawb(s.mawb);
        return <tr key={s.id} className={statusClass(s.status)}>
          <td><input className="cellInput" value={s.clientName||''} onChange={e=>patchRow(s.id,{clientName:e.target.value})} placeholder="Client name"/></td>
          <td><b>{s.mawb}</b></td>
          <td><b>{s.airlineName||airline.name}</b>{(s.officialTracker||airline.official)&&<small><a href={s.officialTracker||airline.official} target="_blank" rel="noreferrer">Official tracker ↗</a></small>}</td>
          <td>{s.flightNo||'—'}</td>
          <td><input className="cellInput smallInput" value={s.bags||''} onChange={e=>patchRow(s.id,{bags:e.target.value.replace(/\D/g,'')})} placeholder="—"/></td>
          <td><input className="cellInput smallInput" value={s.weight||''} onChange={e=>patchRow(s.id,{weight:e.target.value})} placeholder="—"/></td>
          <td>{s.origin||'—'}</td>
          <td>{s.arrivalDate||'—'}</td>
          <td><b>{s.arrivalTime||'—'}</b></td>
          <td><b>{mailTime(s)}</b></td>
          <td><span className="statusBadge">{s.status||'CHECKING'}</span></td>
          <td>{s.dataSource||'—'}<small>{s.remarks||''}</small></td>
          <td className="actions"><button onClick={()=>trackOne(s.mawb)} disabled={busy}>Track</button><button className="x" onClick={()=>remove(s.id)}>×</button></td>
        </tr>;
      })}</tbody>
    </table></section>

    <div className="help"><b>How it works:</b> upload one photo, several photos, or a PDF. Mayavi extracts every readable 11-digit MAWB, identifies the airline from the 3-digit prefix, opens the carrier path through TrackJet, reads the official airline result when machine-readable, and returns origin + estimated arrival date/time first. Bags, weight and flight number are filled when the carrier publishes them. The Mail Time column is always exactly 5 hours before the current arrival time. Early/Delayed status is also detected when the live arrival moves at least 30 minutes from the first ETA seen by Mayavi.</div>

    {manualOpen&&<div className="modal"><form onSubmit={saveManual}>
      <h2>Add MAWB</h2>
      <div className="grid">
        <label>Client Name<input value={form.clientName} onChange={e=>setForm({...form,clientName:e.target.value})} placeholder="Optional"/></label>
        <label>MAWB<input autoFocus value={form.mawb} onChange={e=>setForm({...form,mawb:e.target.value})} placeholder="157-12345678"/></label>
        <label>Bags<input value={form.bags} onChange={e=>setForm({...form,bags:e.target.value.replace(/\D/g,'')})} placeholder="Optional"/></label>
        <label>Weight<input value={form.weight} onChange={e=>setForm({...form,weight:e.target.value})} placeholder="Optional"/></label>
      </div>
      <div className="modalBtns"><button type="button" onClick={()=>setManualOpen(false)}>Cancel</button><button className="primary" type="submit">Add & Track Live</button></div>
    </form></div>}
  </main>;
}
