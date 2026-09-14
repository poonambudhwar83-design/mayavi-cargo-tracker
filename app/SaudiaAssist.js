'use client';

import {useRef,useState} from 'react';

const DB_KEY='mayavi_v3_shipments';
const SAUDIA_URL='https://saudiacargo.com/en/digital-services?tab=trackShipment';
const MONTH={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
const digits=v=>String(v||'').replace(/\D/g,'');
const pad=v=>String(v).padStart(2,'0');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function normalizeDate(raw=''){
  const s=String(raw||'').trim().toUpperCase();
  let m=s.match(/\b(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})\b/);if(m)return`${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m=s.match(/\b(\d{1,2})[-\s](JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[-\s,]*(20\d{2})\b/);if(m)return`${m[3]}-${MONTH[m[2]]}-${pad(m[1])}`;
  m=s.match(/\b(\d{1,2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{2}|\d{4})\b/);if(m)return`${m[3].length===2?'20'+m[3]:m[3]}-${MONTH[m[2]]}-${pad(m[1])}`;
  return'';
}
function eventDateTime(window=''){
  const s=String(window||'').toUpperCase();
  const date=normalizeDate(s);
  const tm=s.match(/\b([0-2]?\d):([0-5]\d)\b/);
  return{date,time:tm?`${pad(tm[1])}:${tm[2]}`:''};
}
function nearestEvent(upper,codes=[]){
  let best=null;
  for(const code of codes){
    const rx=new RegExp(`\\b${code}\\b`,'g');let m;
    while((m=rx.exec(upper))){
      const start=Math.max(0,m.index-120),end=Math.min(upper.length,m.index+260),window=upper.slice(start,end),dt=eventDateTime(window);
      if(!dt.date&&!dt.time)continue;
      const score=m.index;
      if(!best||score>best.score)best={code,date:dt.date,time:dt.time,window,score};
    }
  }
  return best;
}
function parseSaudiaResult(text=''){
  const flat=String(text||'').replace(/\s+/g,' ').trim(),upper=flat.toUpperCase();
  const awbMatch=upper.match(/\b065\s*[-–— ]?\s*(\d{8})\b/);
  if(!awbMatch)return null;
  const mawb=`065-${awbMatch[1]}`;
  const origin=(upper.match(/\bORIGIN\s*[:\-]?\s*([A-Z]{3})\b/)||[])[1]||'';
  const destination=(upper.match(/\bDESTINATION\s*[:\-]?\s*([A-Z]{3})\b/)||[])[1]||'';
  const pieces=((upper.match(/\b(?:TOTAL\s*(?:NUMBER\s*OF\s*)?PIECES|PIECES|PCS|BAGS?)\s*[:\-]?\s*(\d{1,6})\b/)||[])[1]||'');
  const weight=((upper.match(/\b(?:GROSS\s*)?WEIGHT\s*[:\-]?\s*([\d,.]+)\s*(?:KG|KGS?)?\b/)||[])[1]||'').replace(/,/g,'');
  const flightDigits=(upper.match(/\b(?:FLIGHT\s*(?:NO\.?|NUMBER)?\s*[:\-]?\s*)?SV\s*[- ]?(\d{1,4})\b/)||[])[1]||'';
  const flightNo=flightDigits?`SV${flightDigits}`:'';
  const flightDateRaw=(upper.match(/\bFLIGHT\s*DATE\s*[:\-]?\s*([^|]{6,24})/)||[])[1]||'';
  const flightDate=normalizeDate(flightDateRaw);
  const explicitStatus=((upper.match(/\b(?:STATUS|STATE)\s*[:\-]?\s*(DLV|ARR|RCF|DEP|MAN|XXX|BKD|RCS|DLY|FOW|FIW)\b/)||[])[1]||'').toUpperCase();
  const latest=nearestEvent(upper,['DLV','ARR','RCF','DEP','MAN','XXX','RCS','BKD','DLY']);
  const sourceStatus=latest?.code||explicitStatus;
  const booked=nearestEvent(upper,['BKD','RCS']);
  const arrival=nearestEvent(upper,['DLV','ARR','RCF']);
  const departure=nearestEvent(upper,['DEP','MAN']);
  let status='TRACKING',arrivalIsActual=false;
  if(sourceStatus==='DLY')status='DELAYED';
  else if(sourceStatus==='DLV'||sourceStatus==='ARR'||(sourceStatus==='RCF'&&destination==='DEL')){status='ARRIVED';arrivalIsActual=true;}
  else if(sourceStatus==='DEP'||sourceStatus==='MAN')status='DEPARTED';
  else if(['XXX','FOW','FIW','RCF'].includes(sourceStatus))status='IN TRANSIT';
  else if(sourceStatus==='BKD'||sourceStatus==='RCS')status='BOOKED';
  const arrivalDate=arrivalIsActual?(arrival?.date||''):'';
  const arrivalTime=arrivalIsActual?(arrival?.time||''):'';
  const bookingDate=booked?.date||'';
  const bookingTime=booked?.time||'';
  const departureDate=departure?.date||'';
  const departureTime=departure?.time||'';
  const useful=Boolean(pieces||weight||flightNo||origin||destination||sourceStatus||bookingDate||arrivalDate||departureDate);
  if(!useful)return null;
  return{mawb,origin,destination,pieces,bags:pieces,weight,flightNo,flightDate,bookingDate,bookingTime,departureDate,departureTime,arrivalDate,arrivalTime,arrivalIsActual,departureIsActual:Boolean(departureDate||departureTime),sourceStatus,status};
}
async function fetchExistingRow(mawb){
  try{const res=await fetch('/api/shipments',{cache:'no-store'}),data=await res.json();if(!data?.ok)return{};const key=digits(mawb),record=(data.rows||[]).find(r=>digits(r?.awb||r?.data?.mawb||r?.data?.awb)===key);return record?.data||{};}catch{return{}}
}
function updateLocalBackup(row){try{const existing=JSON.parse(localStorage.getItem(DB_KEY)||'[]'),key=digits(row.mawb);localStorage.setItem(DB_KEY,JSON.stringify([row,...existing.filter(x=>digits(x?.mawb||x?.awb)!==key)]));}catch{}}
async function saveParsed(parsed){
  const existing=await fetchExistingRow(parsed.mawb);
  const parsedActual=parsed.arrivalIsActual===true;
  const keepExistingActual=existing.arrivalIsActual===true&&!parsedActual;
  const row={
    ...existing,mawb:parsed.mawb,airlineName:'Saudia Cargo',carrierCode:'SV',
    origin:parsed.origin||existing.origin||'',destination:parsed.destination||existing.destination||'',
    flightNo:parsed.flightNo||existing.flightNo||existing.flight||'',flightDate:parsed.flightDate||existing.flightDate||'',
    pieces:parsed.pieces||existing.pieces||existing.bags||'',bags:parsed.bags||existing.bags||existing.pieces||'',weight:parsed.weight||existing.weight||'',
    bookingDate:parsed.bookingDate||existing.bookingDate||'',bookingTime:parsed.bookingTime||existing.bookingTime||'',
    departureDate:parsed.departureDate||existing.departureDate||'',departureTime:parsed.departureTime||existing.departureTime||'',
    arrivalDate:keepExistingActual?(existing.arrivalDate||''):(parsed.arrivalDate||existing.arrivalDate||''),
    arrivalTime:keepExistingActual?(existing.arrivalTime||''):(parsed.arrivalTime||existing.arrivalTime||''),
    arrivalIsActual:parsedActual||existing.arrivalIsActual===true,
    departureIsActual:parsed.departureIsActual===true||existing.departureIsActual===true,
    sourceStatus:parsed.sourceStatus||existing.sourceStatus||'',
    status:keepExistingActual?(existing.status||'ARRIVED'):(parsed.status&&parsed.status!=='TRACKING'?parsed.status:(existing.status||'TRACKING')),
    provider:'Saudia official live tab OCR',source:'Saudia Cargo official public tracker live capture',officialTracker:SAUDIA_URL,trackingError:'',manualHint:'',lastChecked:new Date().toISOString()
  };
  const res=await fetch('/api/shipments',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({rows:[row]})}),data=await res.json();
  if(!data?.ok)throw new Error(data?.error||'Shared database save failed');
  updateLocalBackup(row);return row;
}
async function frameBlob(video){
  if(!video?.videoWidth||!video?.videoHeight)return null;
  const scale=Math.min(1,1700/video.videoWidth),canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(video.videoWidth*scale));canvas.height=Math.max(1,Math.round(video.videoHeight*scale));
  canvas.getContext('2d',{alpha:false}).drawImage(video,0,0,canvas.width,canvas.height);
  return await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.9));
}

export default function SaudiaAssist(){
  const [state,setState]=useState('idle');
  const [message,setMessage]=useState('');
  const stopRef=useRef(null);
  async function stop(){const fn=stopRef.current;stopRef.current=null;if(fn)await fn();setState('idle');setMessage('');}
  function openSaudia(){window.open(SAUDIA_URL,'_blank','noopener,noreferrer');}
  async function start(){
    if(state!=='idle')return;
    if(!navigator.mediaDevices?.getDisplayMedia){setState('error');setMessage('Use Chrome/Edge on laptop.');return;}
    let stream=null,worker=null,cancelled=false,lastSignature='';
    const video=document.createElement('video');video.muted=true;video.playsInline=true;
    stopRef.current=async()=>{cancelled=true;try{stream?.getTracks()?.forEach(t=>t.stop())}catch{}try{if(worker)await worker.terminate()}catch{}};
    try{
      setState('selecting');setMessage('Select the official Saudia tracker tab.');
      stream=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:{ideal:2,max:5}},audio:false});
      if(cancelled)return;
      const track=stream.getVideoTracks()[0];if(track)track.addEventListener('ended',()=>{if(!cancelled){setState('idle');setMessage('')}});
      video.srcObject=stream;await video.play();
      setState('watching');setMessage('Enter 065 AWB, solve CAPTCHA manually, then submit. Mayavi will capture the result.');
      const mod=await import('tesseract.js');worker=await mod.createWorker('eng');
      while(!cancelled){
        await sleep(3500);if(cancelled)break;
        const blob=await frameBlob(video);if(!blob)continue;
        const result=await worker.recognize(blob);if(cancelled)break;
        const parsed=parseSaudiaResult(result?.data?.text||'');
        if(!parsed){setMessage('Waiting for Saudia result page — solve CAPTCHA and submit.');continue;}
        const signature=[parsed.mawb,parsed.status,parsed.sourceStatus,parsed.flightNo,parsed.bookingDate,parsed.departureDate,parsed.arrivalDate,parsed.arrivalTime].join('|');
        if(signature===lastSignature){setMessage(`${parsed.mawb} already captured. Track the next Saudia AWB in the same shared tab.`);continue;}
        setState('saving');setMessage(`${parsed.mawb} detected. Saving to Mayavi…`);
        const saved=await saveParsed(parsed);lastSignature=signature;
        setState('watching');setMessage(`${saved.mawb} SAVED ✓ Track the next Saudia AWB in the same shared tab.`);
      }
    }catch(e){
      if(!cancelled){setState('error');setMessage(String(e?.message||e||'Saudia capture could not start.'));}
      try{stream?.getTracks()?.forEach(t=>t.stop())}catch{}try{if(worker)await worker.terminate()}catch{}stopRef.current=null;
    }
  }
  const active=['selecting','watching','saving'].includes(state);
  const btn={border:'1px solid #cfd7e5',background:'#fff',borderRadius:9,padding:'8px 10px',fontWeight:800,cursor:'pointer',fontSize:11,whiteSpace:'nowrap'};
  return <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap',marginRight:'auto'}}>
    <button type="button" onClick={openSaudia} style={btn}>OPEN SAUDIA</button>
    <button type="button" onClick={start} disabled={active} style={{...btn,opacity:active?.65:1}}>{state==='selecting'?'SELECT TAB…':state==='saving'?'SAVING…':state==='watching'?'SAUDIA LIVE ✓':'START SAUDIA'}</button>
    {active&&<button type="button" onClick={stop} style={btn}>STOP</button>}
    {message&&<span style={{fontSize:10,maxWidth:430,color:state==='error'?'#b42318':'#344054'}}>{message}</span>}
  </div>;
}
