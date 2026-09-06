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
  d.setHours(d.getHours()-5);
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${formatTime12(`${pad(d.getHours())}:${pad(d.getMinutes())}`)}`;
}
function businessStatus(raw='',timingStatus=''){
  const s=String(raw||'').toUpperCase();
  if(s.includes('ARRIVED')||s.includes('DELIVER')||s.includes('DESTINATION')||s.includes('LANDED')||s.includes('RCF'))return'ARRIVED';
  if(s.includes('IN TRANSIT')||s.includes('TRANSIT')||s.includes('DEPART')||s.includes('AIRBORNE')||s.includes('IN FLIGHT')||s==='DEP')return'IN TRANSIT';
  if(timingStatus==='EARLY'||s.includes('EARLY'))return'EARLY ARRIVAL';
  if(timingStatus==='DELAYED'||s.includes('DELAY')||s.includes('LATE'))return'DELAYED';
  return'BOOKED';
}
function decorateTiming(existing={},incoming={}){
  const shipmentType=(incoming.shipmentType||existing.shipmentType)==='EXPORT'?'EXPORT':'IMPORT';
  const scheduledArrivalDate=existing.scheduledArrivalDate||incoming.scheduledArrivalDate||existing.arrivalDate||incoming.arrivalDate||'';
  const scheduledArrivalTime=existing.scheduledArrivalTime||incoming.scheduledArrivalTime||existing.arrivalTime||incoming.arrivalTime||'';
  const arrivalDate=incoming.arrivalDate||existing.arrivalDate||'';
  const arrivalTime=incoming.arrivalTime||existing.arrivalTime||'';
  const planned=dateTimeValue(scheduledArrivalDate,scheduledArrivalTime),current=dateTimeValue(arrivalDate,arrivalTime);
  let timingDeltaMinutes=null,timingStatus='';
  if(planned&&current){timingDeltaMinutes=Math.round((current-planned)/60000);timingStatus=timingDeltaMinutes>60?'DELAYED':timingDeltaMinutes<-60?'EARLY':'ON TIME';}
  const status=businessStatus(incoming.status||existing.status||'',timingStatus);
  return {...existing,...incoming,shipmentType,scheduledArrivalDate,scheduledArrivalTime,arrivalDate,arrivalTime,timingDeltaMinutes,timingStatus,status,mailTime:shipmentType==='IMPORT'?mailTimeFrom(arrivalDate,arrivalTime):'',mailSent:shipmentType==='IMPORT'?Boolean((incoming.mailSent??existing.mailSent)===true):undefined};
}
async function readJson(res){try{return await res.json()}catch{return null}}

export async function GET(request){
  const secret=process.env.CRON_SECRET;
  if(secret&&request.headers.get('authorization')!==`Bearer ${secret}`)return Response.json({ok:false,error:'Unauthorized'},{status:401});
  const origin=new URL(request.url).origin;
  const shipmentsRes=await fetch(`${origin}/api/shipments`,{cache:'no-store'});
  const shipments=await readJson(shipmentsRes);
  if(!shipments?.ok)return Response.json({ok:false,error:shipments?.error||'Could not read shipments'},{status:503});
  const rows=(shipments.rows||[]).map(r=>r?.data||{}).filter(r=>normalize(r.mawb||r.awb));
  const results=await Promise.allSettled(rows.map(async existing=>{
    const mawb=normalize(existing.mawb||existing.awb);
    const trackRes=await fetch(`${origin}/api/track`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({mawb}),cache:'no-store'});
    const track=await readJson(trackRes);
    let next;
    if(track?.ok&&track.shipment){
      next=decorateTiming(existing,{...track.shipment,mawb,shipmentType:existing.shipmentType==='EXPORT'?'EXPORT':'IMPORT',clientName:existing.clientName||existing.client||'',mailSent:existing.mailSent===true,lastChecked:new Date().toISOString(),trackingError:'',manualHint:'',backendAutoRefresh:true,backendOcrUsed:Boolean(track.screenshotOcrUsed),backendScreenshotCaptured:Boolean(track.screenshotCaptured)});
    }else{
      next=decorateTiming(existing,{mawb,status:existing.status||'BOOKED',lastChecked:new Date().toISOString(),trackingError:track?.trackingError||track?.error||'Auto refresh failed',backendAutoRefresh:true});
    }
    const saveRes=await fetch(`${origin}/api/shipments`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({rows:[next]}),cache:'no-store'});
    const saved=await readJson(saveRes);if(!saved?.ok)throw new Error(saved?.error||'Save failed');
    return {mawb,status:next.status||'',shipmentType:next.shipmentType,backendOcrUsed:Boolean(next.backendOcrUsed)};
  }));
  const ok=results.filter(r=>r.status==='fulfilled').map(r=>r.value),failed=results.filter(r=>r.status==='rejected').map(r=>String(r.reason?.message||r.reason||'Failed'));
  return Response.json({ok:true,refreshed:ok.length,failed:failed.length,results:ok,errors:failed});
}
