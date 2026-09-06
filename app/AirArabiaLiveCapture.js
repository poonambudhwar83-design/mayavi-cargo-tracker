'use client';

import {useRef,useState} from 'react';

const DB_KEY='mayavi_v3_shipments';
const AIR_ARABIA_URL='https://airarabia-g9.ibsplc.aero/icargoneoportal/app/main/#/app';
const MONTHS={JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11};

function digits(v=''){return String(v||'').replace(/\D/g,'')}
function normalize(v=''){const d=digits(v);return d.length===11?`${d.slice(0,3)}-${d.slice(3)}`:''}
function pad(v){return String(v).padStart(2,'0')}
function sleep(ms){return new Promise(r=>setTimeout(r,ms))}

function closestDate(day,monthName){
  const month=MONTHS[String(monthName||'').slice(0,3).toUpperCase()];
  if(month==null)return'';
  const now=new Date();
  const candidates=[now.getFullYear()-1,now.getFullYear(),now.getFullYear()+1]
    .map(y=>new Date(y,month,Number(day),12,0,0));
  candidates.sort((a,b)=>Math.abs(a-now)-Math.abs(b-now));
  const best=candidates[0];
  return `${best.getFullYear()}-${pad(best.getMonth()+1)}-${pad(best.getDate())}`;
}

function parseAirArabiaResult(text=''){
  const flat=String(text||'').replace(/\s+/g,' ').trim();
  const upper=flat.toUpperCase();
  const awbMatch=upper.match(/\b514\s*[-–— ]?\s*(\d{8})\b/);
  const mawb=awbMatch?`514-${awbMatch[1]}`:'';

  const pieces=(upper.match(/\b(\d{1,5})\s*PCS?\b/)||[])[1]||'';
  const weight=((upper.match(/\b([\d,.]+)\s*KG\b/)||[])[1]||'').replace(/,/g,'');
  const flightDigits=(upper.match(/\bG9\s*[-–— ]?\s*(\d{2,4})\b/)||[])[1]||'';
  const flightNo=flightDigits?`G9-${flightDigits.padStart(4,'0')}`:'';

  let origin=(upper.match(/\b([A-Z]{3})\s+(?:DEPARTED|ACCEPTED)\b/)||[])[1]||'';
  let destination=(upper.match(/\b([A-Z]{3})\s+(?:ARRIVED|DELIVERED)\b/)||[])[1]||'';

  if(!origin||!destination){
    const route=upper.match(/\b([A-Z]{3})\b\s+\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[^A-Z0-9]{0,12}\d{1,2}:\d{2}[\s\S]{0,120}?\b([A-Z]{3})\b\s+\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[^A-Z0-9]{0,12}\d{1,2}:\d{2}/);
    if(route){origin=origin||route[1];destination=destination||route[2];}
  }

  let status='';
  if(/\b[A-Z]{3}\s+DELIVERED\b/.test(upper))status='DELIVERED';
  else if(/\b[A-Z]{3}\s+ARRIVED\b/.test(upper))status='ARRIVED';
  else if(/\b[A-Z]{3}\s+DEPARTED\b/.test(upper))status='IN TRANSIT';
  else if(/\b[A-Z]{3}\s+ACCEPTED\b/.test(upper))status='BOOKED';

  let arrivalDate='',arrivalTime='';
  const monthRx='(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*';
  const destEsc=destination?destination.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'):'';
  let arrivalMatch=null;
  if(destEsc){
    arrivalMatch=upper.match(new RegExp(`\\b${destEsc}\\b[\\s\\S]{0,30}?(?:ARRIVED|DELIVERED)[\\s\\S]{0,90}?(\\d{1,2})\\s+${monthRx}[^0-9]{0,18}(\\d{1,2}:\\d{2})`));
  }
  if(!arrivalMatch){
    const all=[...upper.matchAll(new RegExp(`(?:ARRIVED|DELIVERED)[\\s\\S]{0,90}?(\\d{1,2})\\s+${monthRx}[^0-9]{0,18}(\\d{1,2}:\\d{2})`,'g'))];
    arrivalMatch=all.length?all[all.length-1]:null;
  }
  if(arrivalMatch){
    arrivalDate=closestDate(arrivalMatch[1],arrivalMatch[2]);
    arrivalTime=arrivalMatch[3];
  }

  const resultMarkers=/TRACKING\s*VIEW|ACTIVITY\s*VIEW|\b0\s*STOPS?\b|\bFLIGHTS?\b/.test(upper);
  const eventMarkers=/\b[A-Z]{3}\s+(?:ACCEPTED|DEPARTED|ARRIVED|DELIVERED)\b/.test(upper);
  const useful=Boolean(mawb&&(resultMarkers||eventMarkers)&&(pieces||weight||flightNo||origin||destination||arrivalTime));
  if(!useful)return null;

  return {mawb,pieces,weight,flightNo,origin,destination,arrivalDate,arrivalTime,status:status||'TRACKING'};
}

async function fetchExistingRow(mawb){
  try{
    const res=await fetch('/api/shipments',{cache:'no-store'});
    const data=await res.json();
    if(!data?.ok)return{};
    const key=digits(mawb);
    const record=(data.rows||[]).find(r=>digits(r?.awb||r?.data?.mawb||r?.data?.awb)===key);
    return record?.data||{};
  }catch{return{}}
}

function updateLocalBackup(row){
  try{
    const existing=JSON.parse(localStorage.getItem(DB_KEY)||'[]');
    const key=digits(row.mawb);
    const next=[row,...existing.filter(x=>digits(x?.mawb||x?.awb)!==key)];
    localStorage.setItem(DB_KEY,JSON.stringify(next));
  }catch{}
}

async function saveParsed(parsed){
  const existing=await fetchExistingRow(parsed.mawb);
  const row={
    ...existing,
    mawb:parsed.mawb,
    airlineName:existing.airlineName||existing.airline||'Air Arabia',
    carrierCode:existing.carrierCode||existing.airlineCode||'G9',
    origin:parsed.origin||existing.origin||'',
    destination:parsed.destination||existing.destination||'',
    flightNo:parsed.flightNo||existing.flightNo||existing.flight||'',
    pieces:parsed.pieces||existing.pieces||existing.bags||'',
    bags:parsed.pieces||existing.bags||existing.pieces||'',
    weight:parsed.weight||existing.weight||'',
    arrivalDate:parsed.arrivalDate||existing.arrivalDate||'',
    arrivalTime:parsed.arrivalTime||existing.arrivalTime||'',
    arrivalIsActual:Boolean(parsed.arrivalDate||parsed.arrivalTime)||Boolean(existing.arrivalIsActual),
    status:parsed.status||existing.status||'TRACKING',
    provider:'Air Arabia Live Tab OCR',
    source:'Air Arabia official result auto-capture',
    officialTracker:AIR_ARABIA_URL,
    trackingError:'',manualHint:'',
    lastChecked:new Date().toISOString()
  };
  const res=await fetch('/api/shipments',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({rows:[row]})});
  const data=await res.json();
  if(!data?.ok)throw new Error(data?.error||'Shared database save failed');
  updateLocalBackup(row);
  return row;
}

async function frameBlob(video){
  if(!video?.videoWidth||!video?.videoHeight)return null;
  const maxWidth=1700;
  const scale=Math.min(1,maxWidth/video.videoWidth);
  const canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(video.videoWidth*scale));
  canvas.height=Math.max(1,Math.round(video.videoHeight*scale));
  const ctx=canvas.getContext('2d',{alpha:false});
  ctx.drawImage(video,0,0,canvas.width,canvas.height);
  return await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.9));
}

export default function AirArabiaLiveCapture(){
  const [state,setState]=useState('idle');
  const [message,setMessage]=useState('Click once, choose the Air Arabia tab, then fill CAPTCHA and press Next.');
  const stopRef=useRef(null);

  async function stop(){
    const fn=stopRef.current;stopRef.current=null;
    if(fn)await fn();
    setState('idle');
    setMessage('Stopped. Click again when you want automatic Air Arabia capture.');
  }

  async function start(){
    if(state!=='idle')return;
    if(!navigator.mediaDevices?.getDisplayMedia){
      setState('error');
      setMessage('This browser does not support tab capture. Please use current Chrome/Edge on laptop.');
      return;
    }
    let stream=null,worker=null,cancelled=false;
    const video=document.createElement('video');
    video.muted=true;video.playsInline=true;
    stopRef.current=async()=>{
      cancelled=true;
      try{stream?.getTracks()?.forEach(t=>t.stop())}catch{}
      try{if(worker)await worker.terminate()}catch{}
    };
    try{
      setState('selecting');
      setMessage('Chrome will ask what to share — select the AIR ARABIA TAB and press Share.');
      stream=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:{ideal:2,max:5}},audio:false});
      if(cancelled)return;
      const track=stream.getVideoTracks()[0];
      if(track)track.addEventListener('ended',()=>{if(!cancelled){setState('idle');setMessage('Tab sharing ended. Click Auto Capture to start again.')}});
      video.srcObject=stream;
      await video.play();
      setState('watching');
      setMessage('Watching Air Arabia. Fill AWB + CAPTCHA and press Next — no screenshot upload is needed.');

      const mod=await import('tesseract.js');
      worker=await mod.createWorker('eng',undefined,{logger:m=>{
        if(m?.status==='recognizing text'&&!cancelled)setMessage(`Watching Air Arabia result… OCR ${Math.round((m.progress||0)*100)}%`);
      }});

      while(!cancelled){
        await sleep(3500);
        if(cancelled)break;
        const blob=await frameBlob(video);
        if(!blob)continue;
        const result=await worker.recognize(blob);
        if(cancelled)break;
        const parsed=parseAirArabiaResult(result?.data?.text||'');
        if(!parsed){
          setMessage('Waiting for the Air Arabia result page. Complete CAPTCHA and press Next.');
          continue;
        }
        setState('saving');
        setMessage(`${parsed.mawb} detected. Saving flight, route, pieces, weight and arrival details…`);
        const saved=await saveParsed(parsed);
        setState('done');
        setMessage(`${saved.mawb} captured and saved automatically. Tracker will refresh now.`);
        try{stream?.getTracks()?.forEach(t=>t.stop())}catch{}
        cancelled=true;
        try{await worker.terminate()}catch{}
        worker=null;
        setTimeout(()=>window.location.reload(),1200);
        break;
      }
    }catch(e){
      if(!cancelled){
        setState('error');
        const msg=String(e?.message||e||'');
        setMessage(msg.includes('Permission')||msg.includes('NotAllowed')?'Tab sharing was not allowed. Click again and choose the Air Arabia tab.':`Auto capture could not start: ${msg}`);
      }
      try{stream?.getTracks()?.forEach(t=>t.stop())}catch{}
      try{if(worker)await worker.terminate()}catch{}
      stopRef.current=null;
    }
  }

  const active=['selecting','watching','saving'].includes(state);
  return <div style={{position:'fixed',right:16,bottom:16,zIndex:9999,width:'min(390px,calc(100vw - 32px))',background:'rgba(12,20,36,.97)',color:'#fff',border:'1px solid rgba(255,255,255,.18)',borderRadius:16,padding:14,boxShadow:'0 14px 42px rgba(0,0,0,.30)',fontFamily:'system-ui,-apple-system,Segoe UI,sans-serif'}}>
    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:10}}>
      <div style={{fontSize:12,fontWeight:800,letterSpacing:'.08em'}}>AIR ARABIA AUTO CAPTURE</div>
      <div style={{fontSize:11,opacity:.78}}>{state==='watching'?'LIVE':state==='saving'?'SAVING':state==='done'?'DONE':state==='error'?'CHECK':'READY'}</div>
    </div>
    <div style={{fontSize:12,lineHeight:1.45,margin:'8px 0 11px',opacity:.9}}>{message}</div>
    <div style={{display:'flex',gap:8}}>
      <button onClick={start} disabled={active||state==='done'} style={{flex:1,border:0,borderRadius:10,padding:'10px 12px',fontWeight:800,cursor:active?'default':'pointer',background:'#ef3340',color:'#fff',opacity:active?.72:1}}>{state==='watching'?'WATCHING…':state==='saving'?'SAVING…':state==='selecting'?'SELECT AIR ARABIA TAB…':'START AUTO CAPTURE'}</button>
      {active&&<button onClick={stop} style={{border:'1px solid rgba(255,255,255,.25)',borderRadius:10,padding:'10px 12px',fontWeight:700,cursor:'pointer',background:'transparent',color:'#fff'}}>STOP</button>}
    </div>
  </div>;
}
