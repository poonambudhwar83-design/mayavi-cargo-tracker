import { createHash } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { refreshScope } from '../../../../lib/autoRefreshScope.js';
import { cathayRefreshDecision } from '../../../../lib/cathayRefreshPolicy.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=260;

// Server-side 5-minute CX refresh, independent of open browser tabs.
// Reuse the unchanged AWB-verified Cathay parser and its guarded DB saver.
const PREFIX=/^160\d{8}$/;
const MAX_PER_TICK=4; // Check multiple unresolved CX AWBs so one carrier-blocked AWB cannot starve others.
const BATCH_SIZE=4;
const ATTEMPT_TIMEOUT_MS=85000;
const MAX_ATTEMPTS=1; // Upstream empty pages cannot be fixed by immediate duplicate requests; retry next cycle.
const digits=value=>String(value||'').replace(/\D/g,'');

function internalKey(){
  const configured=process.env.MAYAVI_ADMIN_KEY||process.env.CRON_SECRET||'';
  if(configured)return configured;
  const db=process.env.DATABASE_URL||process.env.POSTGRES_URL||
    process.env.NEON_DATABASE_URL||process.env.DATABASE_URL_UNPOOLED||'';
  return db?createHash('sha256').update('mayavi-cron|'+db).digest('hex'):'';
}
async function refreshOne(row,origin,key,fast=false){
  const awb=digits(row.awb),mawb=awb.slice(0,3)+'-'+awb.slice(3),start=Date.now();
  const trackingOrigin=process.env.MAYAVI_TRACKING_ORIGIN||'https://tracker.mayavicargo.com';
  let lastError='Tracking request failed',lastStatus=0;
  for(let attempt=1;attempt<=MAX_ATTEMPTS;attempt++){
    try{
      const response=await fetch(trackingOrigin+'/api/track',{
        method:'POST',cache:'no-store',
        headers:{'content-type':'application/json','x-mayavi-internal-key':key},
        body:JSON.stringify({mawb,currentShipment:row.data||{},cxFastRefresh:fast}),
        signal:AbortSignal.timeout(fast?40000:ATTEMPT_TIMEOUT_MS)
      });
      lastStatus=response.status;
      const result=await response.json().catch(()=>null);
      const saved=response.ok&&result?.ok===true&&result?.serverSaved===true;
      const s=result?.shipment||{};
      const detailsComplete=Boolean(s.flightNo&&s.arrivalDate&&s.arrivalTime);
      if(saved)return {mawb,ok:true,attempts:attempt,fast,detailsComplete,
        incomplete:!detailsComplete,status:s.status||'',
        arrivalDate:s.arrivalDate||'',arrivalTime:s.arrivalTime||'',
        error:'',httpStatus:response.status,elapsedMs:Date.now()-start};
      const failure=result?.trackingError||result?.error||result?.reason;
      lastError=(typeof failure==='string'?failure:failure?JSON.stringify(failure):
        'HTTP '+response.status).slice(0,180);
      // Do not repeat a legitimate carrier response; retry only transient upstream failures.
      if(response.status!==429&&response.status<500)break;
    }catch(e){
      lastError=String(e?.message||e).slice(0,180);
    }
    if(attempt<MAX_ATTEMPTS)await new Promise(resolve=>setTimeout(resolve,500));
  }
  console.warn('cathay_refresh_attempts_exhausted',JSON.stringify({mawb,attempts:MAX_ATTEMPTS,error:lastError}));
  return {mawb,ok:false,attempts:MAX_ATTEMPTS,fast,error:lastError,
    httpStatus:lastStatus,elapsedMs:Date.now()-start};
}
export async function GET(request){
  // CRON_SECRET authorization when configured; otherwise only Vercel's
  // internal cron request user-agent is accepted, not public visitors.
  const secret=process.env.CRON_SECRET;
  const agent=request.headers.get('user-agent')||'';
  if(secret
    ?request.headers.get('authorization')!=='Bearer '+secret
    :!/^vercel-cron\/[\d.]+/i.test(agent))
    return Response.json({ok:false,error:'Unauthorized'},{status:401});

  const db=process.env.DATABASE_URL||process.env.POSTGRES_URL||
    process.env.NEON_DATABASE_URL||process.env.DATABASE_URL_UNPOOLED||'';
  if(!db)return Response.json({ok:false,error:'Database unavailable'},{status:503});
  const key=internalKey();
  if(!key)return Response.json({ok:false,error:'Internal tracking unavailable'},{status:503});
  try{
    const sql=neon(db);
    const rows=await sql.query(
      "SELECT awb,data,tracking_checked_at,updated_at FROM mayavi_shipments WHERE regexp_replace(awb,'[^0-9]','','g') LIKE '160%' ORDER BY updated_at DESC LIMIT 120",[]);
    const now=Date.now();
    const candidate=rows.map(row=>{
      const data=row.data||{},scope=refreshScope(data,new Date(now));
      const decision=cathayRefreshDecision(data,scope,now,
        row.tracking_checked_at||row.updated_at);
      const recent=Date.parse(data.enteredAt||row.updated_at||'')>=now-48*60*60*1000;
      return {row,scope,recent,...decision};
    }).filter(x=>PREFIX.test(digits(x.row.awb))&&x.scope==='ACTIVE'&&x.due)
      .sort((a,b)=>Number(b.missing)-Number(a.missing)||
        Number(b.unresolved)-Number(a.unresolved)||
        Number(b.recent)-Number(a.recent)||a.checkedAt-b.checkedAt)
      .slice(0,MAX_PER_TICK);
    // The old approved-independent pipeline worked after the Terminal
    // published a dated Departure Flight. Check that public Terminal every
    // 5 minutes without spending 80 seconds on a 403 browser lookup.
    // Retry public Booking Details once every 30 minutes and on manual refresh.
    const fastRefresh=new Date(now).getUTCMinutes()%30!==0;
    const results=[];
    for(let i=0;i<candidate.length;i+=BATCH_SIZE){
      const settled=await Promise.allSettled(
        candidate.slice(i,i+BATCH_SIZE).map(x=>refreshOne(x.row,
          new URL(request.url).origin,key,fastRefresh)));
      for(const s of settled)results.push(s.status==='fulfilled'?s.value:
        {ok:false,error:String(s.reason?.message||s.reason).slice(0,160)});
    }
    const summary={ok:true,carrier:'CX',frequency:'every 5 minutes',
      mode:fastRefresh?'terminal-fast':'terminal-and-booking-details',
      inspected:rows.length,
      activeMasters:rows.filter(row=>refreshScope(row.data||{},new Date(now))==='ACTIVE').length,
      missingFlightOrArrival:rows.filter(row=>!row.data?.flightNo||!row.data?.arrivalDate||!row.data?.arrivalTime).length,
      candidates:candidate.length,refreshed:results.filter(r=>r.ok).length,
      incomplete:results.filter(r=>r.incomplete).length,
      failed:results.filter(r=>!r.ok).length,results};
    console.log('cathay_five_minute_cron',JSON.stringify(summary));
    return Response.json(summary,{headers:{'Cache-Control':'no-store'}});
  }catch(e){
    console.error('cathay_five_minute_cron_failed',String(e?.message||e));
    return Response.json({ok:false,error:'Cathay refresh cycle failed'},{status:503});
  }
}
