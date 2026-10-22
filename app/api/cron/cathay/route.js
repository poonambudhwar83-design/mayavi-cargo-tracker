import { createHash } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { isActiveMaster } from '../../../../lib/autoRefreshScope.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=260;

// Server-side 5-minute CX refresh, independent of open browser tabs.
// Reuse the unchanged AWB-verified Cathay parser and its guarded DB saver.
const PREFIX=/^160\d{8}$/;
const MIN_GAP_MS=4*60*1000;
const MAX_PER_TICK=6;
const BATCH_SIZE=3;
const digits=value=>String(value||'').replace(/\D/g,'');
const timestamp=value=>{const n=Date.parse(value||'');return Number.isFinite(n)?n:0;};

function internalKey(){
  const configured=process.env.MAYAVI_ADMIN_KEY||process.env.CRON_SECRET||'';
  if(configured)return configured;
  const db=process.env.DATABASE_URL||process.env.POSTGRES_URL||
    process.env.NEON_DATABASE_URL||process.env.DATABASE_URL_UNPOOLED||'';
  return db?createHash('sha256').update('mayavi-cron|'+db).digest('hex'):'';
}
async function refreshOne(row,origin,key){
  const awb=digits(row.awb),mawb=awb.slice(0,3)+'-'+awb.slice(3),start=Date.now();
  try{
    const trackingOrigin=process.env.MAYAVI_TRACKING_ORIGIN||'https://tracker.mayavicargo.com';
    const response=await fetch(trackingOrigin+'/api/track',{
      method:'POST',cache:'no-store',
      headers:{'content-type':'application/json','x-mayavi-internal-key':key},
      body:JSON.stringify({mawb,currentShipment:row.data||{}}),
      signal:AbortSignal.timeout(105000)
    });
    const result=await response.json().catch(()=>null);
    const saved=response.ok&&result?.ok===true&&result?.serverSaved===true;
    const failure=result?.trackingError||result?.error||result?.reason;
    const error=saved?'':(typeof failure==='string'?failure:failure?JSON.stringify(failure):'HTTP '+response.status).slice(0,180);
    return {mawb,ok:saved,status:saved?result.shipment?.status||'':'',
      arrivalDate:saved?result.shipment?.arrivalDate||'':'',
      arrivalTime:saved?result.shipment?.arrivalTime||'':'',
      error,httpStatus:response.status,elapsedMs:Date.now()-start};
  }catch(e){
    return {mawb,ok:false,error:String(e?.message||e).slice(0,180),
      elapsedMs:Date.now()-start};
  }
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
      "SELECT awb,data,tracking_checked_at,updated_at FROM mayavi_shipments WHERE awb LIKE '160%' AND COALESCE(data->>'customsCleared','false')!='true' ORDER BY updated_at DESC LIMIT 50",[]);
    const now=Date.now();
    const candidate=rows.map(row=>{
      const data=row.data||{};
      const unresolved=data.arrivalIsActual!==true||
        !data.flightNo||!data.arrivalDate||!data.arrivalTime;
      const active=isActiveMaster(data);
      const checkedAt=timestamp(data.lastChecked||row.tracking_checked_at||
        data.enteredAt||row.updated_at);
      const missing=!data.flightNo||!data.arrivalDate||!data.arrivalTime;
      const recent=timestamp(data.enteredAt||row.updated_at)>=now-48*60*60*1000;
      return {row,checkedAt,missing,recent,unresolved,active};
    }).filter(x=>PREFIX.test(digits(x.row.awb))&&x.unresolved&&x.active&&
      (now-x.checkedAt>=MIN_GAP_MS||
        (x.missing&&x.recent&&now-x.checkedAt>=60*1000)))
      .sort((a,b)=>Number(b.missing)-Number(a.missing)||
        Number(b.recent)-Number(a.recent)||a.checkedAt-b.checkedAt)
      .slice(0,MAX_PER_TICK);
    const results=[];
    for(let i=0;i<candidate.length;i+=BATCH_SIZE){
      const settled=await Promise.allSettled(
        candidate.slice(i,i+BATCH_SIZE).map(x=>refreshOne(x.row,
          new URL(request.url).origin,key)));
      for(const s of settled)results.push(s.status==='fulfilled'?s.value:
        {ok:false,error:String(s.reason?.message||s.reason).slice(0,160)});
    }
    const summary={ok:true,carrier:'CX',frequency:'every 5 minutes',
      candidates:candidate.length,refreshed:results.filter(r=>r.ok).length,
      failed:results.filter(r=>!r.ok).length,results};
    console.log('cathay_five_minute_cron',JSON.stringify(summary));
    return Response.json(summary,{headers:{'Cache-Control':'no-store'}});
  }catch(e){
    console.error('cathay_five_minute_cron_failed',String(e?.message||e));
    return Response.json({ok:false,error:'Cathay refresh cycle failed'},{status:503});
  }
}
