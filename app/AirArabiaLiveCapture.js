'use client';

import {useRef,useState} from 'react';

const DB_KEY='mayavi_v3_shipments';
const AIR_ARABIA_URL='https://airarabia-g9.ibsplc.aero/icargoneoportal/app/main/#/app';
const MONTHS={JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11};

function digits(v=''){return String(v||'').replace(/\D/g,'')}
function pad(v){return String(v).padStart(2,'0')}
function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
function formatTime12(value=''){
  const s=String(value||'').trim();if(!s)return'—';
  const m=s.match(/^(\d{1,2}):([0-5]\d)$/);if(!m)return s;
  const h=Number(m[1]),suffix=h>=12?'PM':'AM',h12=h%12||12;
  return `${pad(h12)}:${m[2]} ${suffix}`;
}
function closestDate(day,monthName){
  const month=MONTHS[String(monthName||'').slice(0,3).toUpperCase()];
  if(month==null)return'';
  const now=new Date();
  const candidates=[now.getFullYear()-1,now.getFullYear(),now.getFullYear()+1].map(y=>new Date(y,month,Number(day),12,0,0));
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
  if(destEsc)arrivalMatch=upper.match(new RegExp(`\\b${destEsc}\\b[\\s\\S]{0,30}?(?:ARRIVED|DELIVERED)[\\s\\S]{0,90}?(\\d{1,2})\\s+${monthRx}[^0-9]{0,18}(\\d{1,2}:\\d{2})`));
  if(!arrivalMatch){
    const all=[...upper.matchAll(new RegExp(`(?:ARRIVED|DELIVERED)[\\s\\S]{0,90}?(\\d{1,2})\\s+${monthRx}[^0-9]{0,18}(\\d{1,2}:\\d{2})`,'g'))];
    arrivalMatch=all.length?all[all.length-1]:null;
  }
  if(arrivalMatch){arrivalDate=closestDate(arrivalMatch[1],arrivalMatch[2]);arrivalTime=arrivalMatch[3];}
  const resultMarkers=/TRACKING\s*VIEW|ACTIVITY\s*VIEW|\b0\s*STOPS?\b|\bFLIGHTS?\b/.test(upper);
  const eventMarkers=/\b[A-Z]{3}\s+(?:ACCEPTED|DEPARTED|ARRIVED|DELIVERED)\b/.test(upper);
  const useful=Boolean(mawb&&(resultMarkers||eventMarkers)&&(pieces||weight||flightNo||origin||destination||arrivalTime));
  if(!useful)return null;
  return {mawb,pieces,weight,flightNo,origin,destination,arrivalDate,arrivalTime,status:status||'TRACKING'};
}

async function fetchExistingRow(mawb){
  try{
    const res=await fetch('/api/shipments',{cache:'no-store'}),data=await res.json();
    if(!data?.ok)return{};
    const key=digits(mawb);
    const record=(data.rows||[]).find(r=>digits(r?.awb||r?.data?.mawb||r?.data?.awb)===key);
    return record?.data||{};
  }catch{return{}}
}
function updateLocalBackup(row){
  try{
    const existing=JSON.parse(localStorage.getItem(DB_KEY)||'[]'),key=digits(row.mawb);
    localStorage.setItem(DB_KEY,JSON.stringify([row,...existing.filter(x=>digits(x?.mawb||x?.awb)!==key)]));
  }catch{}
}
async function saveParsed(parsed){
  const existing=await fetchExistingRow(parsed.mawb);
  const row={...existing,mawb:parsed.mawb,airlineName:existing.airlineName||existing.airline||'Air Arabia Cargo',carrierCode:existing.carrierCode||existing.airlineCode||'G9',origin:parsed.origin||existing.origin||'',destination:parsed.destination||existing.destination||'',flightNo:parsed.flightNo||existing.flightNo||existing.flight||'',pieces:parsed.pieces||existing.pieces||existing.bags||'',bags:parsed.pieces||existing.bags||existing.pieces||'',weight:parsed.weight||existing.weight||'',arrivalDate:parsed.arrivalDate||existing.arrivalDate||'',arrivalTime:parsed.arrivalTime||existing.arrivalTime||'',arrivalIsActual:Boolean(parsed.arrivalDate||parsed.arrivalTime)||Boolean(existing.arrivalIsActual),status:parsed.status||existing.status||'TRACKING',provider:'Air Arabia Live Tab OCR',source:'Air Arabia official result auto-capture',officialTracker:AIR_ARABIA_URL,trackingError:'',manualHint:'',lastChecked:new Date().toISOString()};
  const res=await fetch('/api/shipments',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({rows:[row]})}),data=await res.json();
  if(!data?.ok)throw new Error(data?.error||'Shared database save failed');
  updateLocalBackup(row);return row;
}
function syncVisibleTable(row){
  try{
    const tr=[...document.querySelectorAll('.tableWrap tbody tr')].find(x=>digits(x.querySelector('td strong')?.textContent)===digits(row.mawb));
    if(!tr)return;
    const td=tr.querySelectorAll('td');if(td.length<11)return;
    td[2].textContent=row.airlineName||'Air Arabia Cargo';
    td[3].textContent=row.origin||'—';td[4].textContent=row.destination||'—';td[5].textContent=row.flightNo||'—';
    td[6].textContent=row.bags||row.pieces||'—';td[7].textContent=row.weight?`${row.weight} kg`:'—';
    td[8].textContent=row.arrivalDate||'—';td[9].textContent=formatTime12(row.arrivalTime);
    const badge=td[10].querySelector('.badge');if(badge)badge.textContent=row.status||'TRACKING';
  }catch{}
}
async function frameBlob(video){
  if(!video?.videoWidth||!video?.videoHeight)return null;
  const scale=Math.min(1,1700/video.videoWidth),canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(video.videoWidth*scale));canvas.height=Math.max(1,Math.round(video.videoHeight*scale));
  canvas.getContext('2d',{alpha:false}).drawImage(video,0,0,canvas.width,canvas.height);
  return await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.9));
}

export default function AirArabiaLiveCapture(){
  const [state,setState]=useState('idle');
  const [message,setMessage]=useState('Share the Air Arabia tab once. It will stay connected for multiple MAWBs until you press Stop.');
  const stopRef=useRef(null);
  async function stop(){const fn=stopRef.current;stopRef.current=null;if(fn)await fn();setState('idle');setMessage('Stopped. Share Air Arabia again only when you start a new work session.');}
  async function start(){
    if(state!=='idle')return;
    if(!navigator.mediaDevices?.getDisplayMedia){setState('error');setMessage('Use current Chrome/Edge on laptop for Air Arabia tab capture.');return;}
    let stream=null,worker=null,cancelled=false,lastSignature='';
    const video=document.createElement('video');video.muted=true;video.playsInline=true;
    stopRef.current=async()=>{cancelled=true;try{stream?.getTracks()?.forEach(t=>t.stop())}catch{}try{if(worker)await worker.terminate()}catch{}};
    try{
      setState('selecting');setMessage('Select the AIR ARABIA iCargo tab and press Share. You only need to do this once for this session.');
      stream=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:{ideal:2,max:5}},audio:false});
      if(cancelled)return;
      const track=stream.getVideoTracks()[0];
      if(track)track.addEventListener('ended',()=>{if(!cancelled){setState('idle');setMessage('Air Arabia sharing ended. Start again when needed.')}});
      video.srcObject=stream;await video.play();
      setState('watching');setMessage('LIVE: keep this iCargo tab shared. Track MAWB, fill CAPTCHA and press Next; results will save automatically.');
      const mod=await import('tesseract.js');
      worker=await mod.createWorker('eng',undefined,{logger:m=>{if(m?.status==='recognizing text'&&!cancelled)setMessage(`LIVE Air Arabia capture • OCR ${Math.round((m.progress||0)*100)}%`);}});
      while(!cancelled){
        await sleep(3500);if(cancelled)break;
        const blob=await frameBlob(video);if(!blob)continue;
        const result=await worker.recognize(blob);if(cancelled)break;
        const parsed=parseAirArabiaResult(result?.data?.text||'');
        if(!parsed){setMessage('LIVE: waiting for an Air Arabia result page. Fill CAPTCHA and press Next.');continue;}
        const signature=[parsed.mawb,parsed.status,parsed.flightNo,parsed.origin,parsed.destination,parsed.pieces,parsed.weight,parsed.arrivalDate,parsed.arrivalTime].join('|');
        if(signature===lastSignature){setMessage(`LIVE: ${parsed.mawb} already captured. Open/track the next MAWB — no need to Share again.`);continue;}
        setState('saving');setMessage(`${parsed.mawb} detected. Saving details to Mayavi…`);
        const saved=await saveParsed(parsed);syncVisibleTable(saved);lastSignature=signature;
        setState('watching');setMessage(`${saved.mawb} SAVED ✓  Keep iCargo shared and track the next MAWB — no need to Share again.`);
      }
    }catch(e){
      if(!cancelled){setState('error');const msg=String(e?.message||e||'');setMessage(msg.includes('Permission')||msg.includes('NotAllowed')?'Tab sharing was not allowed. Start again and choose the Air Arabia tab.':`Auto capture could not start: ${msg}`);}
      try{stream?.getTracks()?.forEach(t=>t.stop())}catch{}try{if(worker)await worker.terminate()}catch{}stopRef.current=null;
    }
  }
  const active=['selecting','watching','saving'].includes(state);
  return <section style={{width:'calc(100% - 24px)',maxWidth:1700,margin:'14px auto 0',background:'linear-gradient(135deg,#102a56,#173f80)',color:'#fff',borderRadius:14,padding:'12px 14px',boxShadow:'0 5px 18px rgba(20,33,61,.12)',fontFamily:'Arial,Helvetica,sans-serif',display:'flex',alignItems:'center',justifyContent:'space-between',gap:14,flexWrap:'wrap'}}>
    <div style={{minWidth:220,flex:'1 1 520px'}}>
      <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:4}}><strong style={{fontSize:11,letterSpacing:'.08em'}}>AIR ARABIA AUTO CAPTURE</strong><span style={{fontSize:10,opacity:.82}}>{state==='watching'?'LIVE':state==='saving'?'SAVING':state==='error'?'CHECK':'READY'}</span></div>
      <div style={{fontSize:11,lineHeight:1.35,opacity:.9}}>{message}</div>
    </div>
    <div style={{display:'flex',gap:8,flex:'0 0 auto'}}><button onClick={start} disabled={active} style={{border:0,borderRadius:9,padding:'9px 14px',fontWeight:800,cursor:active?'default':'pointer',background:'#ef3340',color:'#fff',opacity:active?.72:1}}>{state==='watching'?'CONNECTED':state==='saving'?'SAVING…':state==='selecting'?'SELECT iCARGO TAB…':'START AIR ARABIA'}</button>{active&&<button onClick={stop} style={{border:'1px solid rgba(255,255,255,.35)',borderRadius:9,padding:'9px 12px',fontWeight:700,cursor:'pointer',background:'transparent',color:'#fff'}}>STOP</button>}</div>
  </section>;
}
