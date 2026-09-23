import { createHash } from 'node:crypto';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;

function digits(v=''){return String(v||'').replace(/\D/g,'')}
function normalize(v=''){const d=digits(v);return d.length===11?`${d.slice(0,3)}-${d.slice(3)}`:''}
function pad(v){return String(v).padStart(2,'0')}
function dateTimeValue(date='',time=''){
  const dm=String(date).match(/^(\d{4})-(\d{2})-(\d{2})$/),tm=String(time).match(/^(\d{1,2}):(\d{2})/);
  if(!dm||!tm)return null;
  const d=new Date(Number(dm[1]),Number(dm[2])-1,Number(dm[3]),Number(tm[1]),Number(tm[2]),0,0);
  return Number.isFinite(d.getTime())?d:null;
}
function formatTime12(value=''){
  const m=String(value||'').match(/^(\d{1,2}):([0-5]\d)$/);if(!m)return value||'';
  const h=Number(m[1]);return `${pad(h%12||12)}:${m[2]} ${h>=12?'PM':'AM'}`;
}
function mailTimeFrom(date='',time=''){
  const d=dateTimeValue(date,time);if(!d)return'';
  d.setHours(d.getHours()-6);
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${formatTime12(`${pad(d.getHours())}:${pad(d.getMinutes())}`)}`;
}
function isFiveAirline(mawb=''){return /^(098|157|160|176|910)-/.test(String(mawb||''));}
function isAirIndia(mawb=''){return /^098-/.test(String(mawb||''));}
function businessStatus(raw='',timingStatus='',arrivalIsActual=false,mawb=''){
  const s=String(raw||'').toUpperCase();

  // AIR INDIA: official Activity View movement always wins over ETA/timing calculations.
  // Manifested/Accepted/Built Up/Executed/Booked = BOOKED
  // Departed = IN TRANSIT
  // Arrived/Delivered = ARRIVED
  if(isAirIndia(mawb)){
    if(s.includes('PART ARRIVED'))return'PART ARRIVED';
    if(s.includes('DELIVER'))return'DELIVERED';
    if(s.includes('ARRIVED')||s.includes('DESTINATION')||s.includes('LANDED')||s.includes('RCF'))return'ARRIVED';
    if(s.includes('IN TRANSIT')||s.includes('TRANSIT')||s.includes('DEPART')||s.includes('AIRBORNE')||s.includes('IN FLIGHT')||s==='DEP')return'IN TRANSIT';
    if(s.includes('MANIFEST')||s.includes('ACCEPT')||s.includes('BUILT')||s.includes('EXECUT')||s.includes('BOOK'))return'BOOKED';
    return'BOOKED';
  }

  if(s.includes('PART ARRIVED'))return'PART ARRIVED';
  if(s.includes('DELIVER'))return'DELIVERED';
  if(s.includes('DELAY')||s.includes('LATE'))return'DELAYED';
  if(isFiveAirline(mawb)&&!arrivalIsActual&&(s.includes('ARRIVED')||s.includes('DESTINATION')||s.includes('LANDED')||s.includes('RCF')))return'IN TRANSIT';
  if(s.includes('ARRIVED')||s.includes('DESTINATION')||s.includes('LANDED')||s.includes('RCF'))return'ARRIVED';
  if(s.includes('IN TRANSIT')||s.includes('TRANSIT')||s.includes('DEPART')||s.includes('AIRBORNE')||s.includes('IN FLIGHT')||s==='DEP')return'IN TRANSIT';
  if(timingStatus==='EARLY'||s.includes('EARLY'))return'EARLY ARRIVAL';
  if(timingStatus==='DELAYED')return'DELAYED';
  return'BOOKED';
}
function decorateTiming(existing={},incoming={}){
  const shipmentType=(incoming.shipmentType||existing.shipmentType)==='EXPORT'?'EXPORT':'IMPORT';
  const mawb=normalize(incoming.mawb||existing.mawb||incoming.awb||existing.awb)||incoming.mawb||existing.mawb||'';
  const clearArrival=incoming.arrivalVerifiedAbsent===true;
  const scheduledArrivalDate=incoming.scheduledArrivalDate||existing.scheduledArrivalDate||incoming.arrivalDate||existing.arrivalDate||'';
  const scheduledArrivalTime=incoming.scheduledArrivalTime||existing.scheduledArrivalTime||incoming.arrivalTime||existing.arrivalTime||'';
  const arrivalDate=clearArrival?'':(incoming.arrivalDate||existing.arrivalDate||'');
  const arrivalTime=clearArrival?'':(incoming.arrivalTime||existing.arrivalTime||'');
  const incomingActualKnown=Object.prototype.hasOwnProperty.call(incoming,'arrivalIsActual');
  const arrivalIsActual=clearArrival?false:(incomingActualKnown?incoming.arrivalIsActual===true:existing.arrivalIsActual===true);
  const planned=dateTimeValue(scheduledArrivalDate,scheduledArrivalTime),current=dateTimeValue(arrivalDate,arrivalTime);
  let timingDeltaMinutes=null,timingStatus='';
  if(planned&&current){timingDeltaMinutes=Math.round((current-planned)/60000);timingStatus=timingDeltaMinutes>60?'DELAYED':timingDeltaMinutes<-60?'EARLY':'ON TIME';}
  let status=businessStatus(incoming.status||existing.status||'',timingStatus,arrivalIsActual,mawb);
  if(!isAirIndia(mawb)&&isFiveAirline(mawb)&&!arrivalIsActual&&(arrivalDate||arrivalTime)&&status==='BOOKED')status='IN TRANSIT';
  return {...existing,...incoming,mawb,shipmentType,scheduledArrivalDate,scheduledArrivalTime,arrivalDate,arrivalTime,arrivalIsActual,timingDeltaMinutes,timingStatus,status,mailTime:shipmentType==='IMPORT'?mailTimeFrom(arrivalDate,arrivalTime):'',mailSent:shipmentType==='IMPORT'?Boolean((incoming.mailSent??existing.mailSent)===true):undefined};
}
async function readJson(res){try{return await res.json()}catch{return null}}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function cronInternalKey(){
  const configured=process.env.MAYAVI_ADMIN_KEY||process.env.CRON_SECRET||'';
  if(configured)return configured;
  const url=process.env.DATABASE_URL||process.env.POSTGRES_URL||process.env.NEON_DATABASE_URL||process.env.DATABASE_URL_UNPOOLED||'';
  return url?createHash('sha256').update(`mayavi-cron|${url}`).digest('hex'):'';
}

function retryDelay(attempt){
  // 1.25s, 2.5s, 5s. Keeps one temporary Vercel/Neon/SAL failure
  // from cancelling the whole hourly refresh cycle.
  return Math.min(5000,1250*(2**attempt));
}
async function fetchJsonWithRetry(url,options={},attempts=3,label='request'){
  let lastError='';
  for(let i=0;i<attempts;i+=1){
    try{
      const res=await fetch(url,{...options,cache:'no-store'});
      const data=await readJson(res);
      if(res.ok)return{res,data,attempt:i+1};

      lastError=data?.trackingError||data?.error||`${label} HTTP ${res.status}`;
      const retryable=res.status===408||res.status===425||res.status===429||res.status>=500;
      if(!retryable||i===attempts-1)break;
    }catch(e){
      lastError=e?.message||String(e);
      if(i===attempts-1)break;
    }
    await sleep(retryDelay(i));
  }
  throw new Error(`${label} failed after ${attempts} attempt${attempts===1?'':'s'}: ${lastError||'unknown error'}`);
}

export async function GET(request){
  const secret=process.env.CRON_SECRET;
  if(secret&&request.headers.get('authorization')!==`Bearer ${secret}`)return Response.json({ok:false,error:'Unauthorized'},{status:401});
  const origin=new URL(request.url).origin;
  const internalKey=cronInternalKey();
  const internalHeaders=internalKey?{'x-mayavi-internal-key':internalKey}:{};

  // Previously one temporary /api/shipments 503 aborted the entire cron run.
  // Retry the shared list before giving up, so a transient DB/function error
  // does not postpone movement updates until the next hourly schedule.
  let shipmentsCall;
  try{
    shipmentsCall=await fetchJsonWithRetry(`${origin}/api/shipments`,{headers:internalHeaders},4,'Shipment list');
  }catch(e){
    return Response.json({ok:false,error:e?.message||'Could not read shipments',retryExhausted:true},{status:503});
  }
  const shipments=shipmentsCall.data;
  if(!shipments?.ok)return Response.json({ok:false,error:shipments?.error||'Could not read shipments',retryExhausted:true},{status:503});

  const rows=(shipments.rows||[]).map(r=>r?.data||{}).filter(r=>normalize(r.mawb||r.awb));
  const refreshExisting=async existing=>{
    const mawb=normalize(existing.mawb||existing.awb);
    let track=null,trackAttempts=0,trackError='';

    try{
      // Saudia gets one extra attempt because its SAL chronology may briefly
      // lag or time out while FOW/flight cards are being published.
      const call=await fetchJsonWithRetry(
        `${origin}/api/track`,
        {method:'POST',headers:{'content-type':'application/json',...internalHeaders},body:JSON.stringify({mawb,currentShipment:existing})},
        mawb.startsWith('065-')?3:2,
        `Tracking ${mawb}`
      );
      track=call.data;
      trackAttempts=call.attempt;
    }catch(e){
      trackError=e?.message||String(e);
    }

    let next;
    if(track?.ok&&track.shipment){
      next=decorateTiming(existing,{...track.shipment,mawb,shipmentType:existing.shipmentType==='EXPORT'?'EXPORT':'IMPORT',clientName:existing.clientName||existing.client||'',enteredBy:existing.enteredBy||'',enteredByUsername:existing.enteredByUsername||'',enteredAt:existing.enteredAt||'',mailSent:existing.mailSent===true,lastChecked:new Date().toISOString(),trackingError:'',manualHint:'',backendAutoRefresh:true,backendAutoRefreshAttempts:trackAttempts||1,backendOcrUsed:Boolean(track.screenshotOcrUsed),backendScreenshotCaptured:Boolean(track.screenshotCaptured)});
    }else{
      next=decorateTiming(existing,{mawb,status:existing.status||'BOOKED',lastChecked:new Date().toISOString(),trackingError:trackError||track?.trackingError||track?.error||'Auto refresh failed',backendAutoRefresh:true,backendAutoRefreshAttempts:trackAttempts||0});
    }

    const saveCall=await fetchJsonWithRetry(
      `${origin}/api/shipments`,
      {method:'POST',headers:{'content-type':'application/json',...internalHeaders},body:JSON.stringify({rows:[next]})},
      3,
      `Save ${mawb}`
    );
    const saved=saveCall.data;
    if(!saved?.ok)throw new Error(saved?.error||'Save failed');

    return {mawb,status:next.status||'',shipmentType:next.shipmentType,trackingAttempts:trackAttempts||0,saveAttempts:saveCall.attempt,backendOcrUsed:Boolean(next.backendOcrUsed)};

  };
  const importRows=rows.filter(r=>r.shipmentType!=='EXPORT');
  const exportRows=rows.filter(r=>r.shipmentType==='EXPORT');
  const importResults=await Promise.allSettled(importRows.map(refreshExisting));
  const exportResults=await Promise.allSettled(exportRows.map(refreshExisting));
  const results=[...importResults,...exportResults];

  const ok=results.filter(r=>r.status==='fulfilled').map(r=>r.value);
  const failed=results.filter(r=>r.status==='rejected').map(r=>String(r.reason?.message||r.reason||'Failed'));
  return Response.json({
    ok:true,
    shipmentListAttempts:shipmentsCall.attempt,
    refreshed:ok.length,
    failed:failed.length,
    results:ok,
    errors:failed
  });
}
