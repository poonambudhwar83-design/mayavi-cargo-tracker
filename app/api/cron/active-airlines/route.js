import { createHash, timingSafeEqual } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { mergePartMail, mergePartCustoms } from '../../../../lib/partMail.js';
import { activeAirlineCandidates, BATCH_SIZE, safeAirlineMovementPatch } from '../../../../lib/activeAirlineCron.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=260;

const CONCURRENCY=3;
const REQUEST_TIMEOUT_MS=75000;
const digits=value=>String(value||'').replace(/\D/g,'');
const dbUrl=()=>process.env.DATABASE_URL||process.env.POSTGRES_URL||
  process.env.NEON_DATABASE_URL||process.env.DATABASE_URL_UNPOOLED||'';
function cronKey(){
  const set=process.env.MAYAVI_ADMIN_KEY||process.env.CRON_SECRET||'';
  const database=dbUrl();
  return set||(database?createHash('sha256').update('mayavi-cron|'+database).digest('hex'):'');
}
function authorized(request){
  const secret=process.env.CRON_SECRET;
  if(!secret)return /^vercel-cron\/[\d.]+/i.test(request.headers.get('user-agent')||'');
  const expected=Buffer.from('Bearer '+secret);
  const actual=Buffer.from(request.headers.get('authorization')||'');
  return expected.length===actual.length&&timingSafeEqual(expected,actual);
}
async function refreshOne(sql,row,origin,internalKey){
  const awb=digits(row.awb);
  const mawb=awb.slice(0,3)+'-'+awb.slice(3);
  const checkedAt=new Date().toISOString();
  let response=null,result=null,reason='';
  try{
    response=await fetch(origin+'/api/track',{
      method:'POST',cache:'no-store',
      headers:{'content-type':'application/json','x-mayavi-internal-key':internalKey},
      body:JSON.stringify({mawb,currentShipment:row.data||{}}),
      signal:AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    result=await response.json().catch(()=>null);
    if(!response.ok||result?.ok!==true){
      reason=String(result?.trackingError||result?.error||
        'Airline tracking HTTP '+response.status).slice(0,250);
    }
  }catch(e){
    reason=String(e?.message||e).slice(0,250);
  }
  const movement=result?.ok===true? safeAirlineMovementPatch(row.data||{},result.shipment||{}):null;
  const verified=Boolean(result?.ok&&movement);
  const patch={
    backendAutoRefresh:true,
    backendCronAttemptAt:checkedAt,
    backendCronVerifiedAt:verified?checkedAt:(row.data?.backendCronVerifiedAt||''),
    backendCronSucceeded:verified,
    backendCronError:verified?'':(reason||'Airline returned no verified movement')
  };
  if(verified){
    // Dedicated airline adapters normally save their own verified movement.
    // The fallback covers adapters which return a valid result but do not save.
    if(result.serverSaved!==true){
      Object.assign(patch,movement);
      if(Array.isArray(movement.partShipments)){
        const original=row.data?.partShipments||[];
        patch.partShipments=mergePartMail(movement.partShipments,original);
        if(['065','098','176','312','229'].includes(awb.slice(0,3)))
          patch.partShipments=mergePartCustoms(patch.partShipments,original);
      }
      patch.lastChecked=checkedAt;
      patch.trackingError='';
    }
  }
  // An upstream failure must NEVER re-save a stale entire shipment. Only
  // append retry metadata, preserving the latest operator and airline data.
  await sql`UPDATE mayavi_shipments
    SET data=data||${JSON.stringify(patch)}::jsonb,
      version=version+1,updated_at=now()
    WHERE awb=${awb}`;
  return {mawb,verified,serverSaved:result?.serverSaved===true,
    status:verified?(result.shipment?.status||''):'',
    error:verified?'':patch.backendCronError};
}

export async function GET(request){
  if(!authorized(request))
    return Response.json({ok:false,error:'Unauthorized'},{status:401});
  const database=dbUrl(),key=cronKey();
  if(!database||!key)
    return Response.json({ok:false,error:'Background tracking unavailable'},{status:503});
  try{
    const sql=neon(database);
    // DB query replaces a browser/session-dependent /api/shipments request.
    // Filtering includes all dates of uncleared masters, not just this month.
    const all=await sql`SELECT awb,data,tracking_checked_at,updated_at
      FROM mayavi_shipments ORDER BY updated_at DESC`;
    const now=new Date();
    const selected=activeAirlineCandidates(all,now,BATCH_SIZE);
    const origin=new URL(request.url).origin;
    const results=[];
    for(let i=0;i<selected.length;i+=CONCURRENCY){
      const round=await Promise.allSettled(selected.slice(i,i+CONCURRENCY)
        .map(row=>refreshOne(sql,row,origin,key)));
      for(const item of round){
        results.push(item.status==='fulfilled'?item.value:
          {verified:false,error:String(item.reason?.message||item.reason).slice(0,200)});
      }
    }
    const summary={ok:true,checkedAt:now.toISOString(),mode:'Active only (Gulf Air excluded)',
      inspected:all.length,selected:selected.length,
      verified:results.filter(x=>x.verified).length,
      failed:results.filter(x=>!x.verified).length,results};
    console.log('mayavi_active_airline_cron',JSON.stringify(summary));
    return Response.json(summary,{headers:{'Cache-Control':'no-store'}});
  }catch(e){
    console.error('mayavi_active_airline_cron_error',String(e?.message||e));
    return Response.json({ok:false,error:'Active airline refresh failed'},{status:503});
  }
}
