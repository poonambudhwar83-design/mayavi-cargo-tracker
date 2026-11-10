import {createHash,timingSafeEqual} from 'node:crypto';
import {neon} from '@neondatabase/serverless';
import {safeAirlineMovementPatch} from '../../../../lib/activeAirlineCron.js';
import {mergePartMail,mergePartCustoms} from '../../../../lib/partMail.js';
import {readableGulfFailure} from '../../../../lib/gulfAirDiagnostics.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;
const digits=v=>String(v||'').replace(/\D/g,'');
const databaseUrl=()=>process.env.DATABASE_URL||process.env.POSTGRES_URL||
  process.env.NEON_DATABASE_URL||process.env.DATABASE_URL_UNPOOLED||'';
const cronKey=()=>process.env.MAYAVI_ADMIN_KEY||process.env.CRON_SECRET||
  (databaseUrl()?createHash('sha256').update('mayavi-cron|'+databaseUrl()).digest('hex'):'');
function authorized(request){
  const secret=process.env.CRON_SECRET;
  if(!secret)return false;
  const expected=Buffer.from('Bearer '+secret);
  const actual=Buffer.from(request.headers.get('authorization')||'');
  return expected.length===actual.length&&timingSafeEqual(expected,actual);
}
async function trackOne(sql,origin,key,row){
  const awb=digits(row.awb);
  const mawb=awb.slice(0,3)+'-'+awb.slice(3);
  const checkedAt=new Date().toISOString();
  let result=null,reason='';
  try{
    // Run Gulf-only lookups through the dedicated Mumbai function, instead of
    // the US-region generic tracker. This route delegates to the same shared
    // AWB-verified logic but isolates the Gulf carrier and its source region.
    const response=await fetch(origin+'/api/gulf-track',{
      method:'POST',cache:'no-store',
      headers:{'content-type':'application/json','x-mayavi-internal-key':key},
      body:JSON.stringify({mawb,currentShipment:row.data||{}}),
      signal:AbortSignal.timeout(210000)
    });
    result=await response.json().catch(()=>null);
    if(!response.ok||!result?.ok){
      const cause=result?.trackingError||result?.directAdapterError||result?.error;
      reason=readableGulfFailure(cause)||'Gulf track HTTP '+response.status;
      const diagnostic=result?.debug?.direct;
      if(reason==='[object Object]'||!reason)
        reason=readableGulfFailure(diagnostic)||'Gulf carrier did not return verified tracking details';
    }
  }catch(e){reason=readableGulfFailure(e)||'Gulf request failed';}
  const movement=result?.ok?safeAirlineMovementPatch(row.data||{},result.shipment||{}):null;
  const verified=Boolean(result?.ok&&movement);
  const patch={
    backendGulfAutoRefresh:true,backendGulfAttemptAt:checkedAt,
    backendGulfVerifiedAt:verified?checkedAt:row.data?.backendGulfVerifiedAt||'',
    backendGulfVerified:verified,
    backendGulfError:verified?'':(reason||'No AWB-verified ParcelsApp or CHAMP data'),
    backendGulfProvider:verified?String(result?.provider||'Gulf Air verified tracking'):'',
    lastChecked:checkedAt,
    trackingError:verified?'':(reason||'No current verified 072 tracking data')
  };
  if(verified&&result.serverSaved!==true){
    // Preserve operator decisions even if the adapter could not save itself.
    // The dedicated 072 cron must not reset Mail/Customs to false on refresh.
    if(Array.isArray(movement.partShipments)&&Array.isArray(row.data?.partShipments)){
      movement.partShipments=mergePartCustoms(
        mergePartMail(movement.partShipments,row.data.partShipments),row.data.partShipments);
    }
    // The airline adapter normally persists its own fully verified response.
    // This fallback may copy only airline fields, never client/admin/finance data.
    Object.assign(patch,movement);
    const oldStatus=String(row.data?.status||'').toUpperCase();
    if(['DELIVERED','ARRIVED'].includes(oldStatus)&&
      !['DELIVERED','ARRIVED'].includes(String(movement.status||'').toUpperCase())){
      for(const field of ['status','arrivalDate','arrivalTime','arrivalIsActual','arrivalEstimate'])
        delete patch[field];
    }
  }
  // On NO_DATA, overwrite only diagnostic fields. NEVER erase the previous
  // verified route, bags, weight, booking, events or cargo arrival.
  await sql`UPDATE mayavi_shipments
    SET data=data||${JSON.stringify(patch)}::jsonb,updated_at=now(),version=version+1
    WHERE awb=${awb}`;
  return {mawb,verified,serverSaved:result?.serverSaved===true,
    status:verified?String(result.shipment?.status||''):'',
    error:verified?'':patch.backendGulfError};
}
export async function GET(request){
  if(!authorized(request))return Response.json({ok:false,error:'Unauthorized'},{status:401});
  const url=databaseUrl(),key=cronKey();
  if(!url||!key)return Response.json({ok:false,error:'Missing tracker backend'},{status:503});
  try{
    const sql=neon(url);
    // Rotate oldest or never-checked 072 AWBs first; include previous months.
    // Three independent requests run concurrently to stay within the server
    // timeout, and the next run continues with the oldest unchecked records.
    const candidates=await sql`SELECT awb,data FROM mayavi_shipments
      WHERE awb LIKE '072%' AND LENGTH(awb)=11
      ORDER BY NULLIF(data->>'backendGulfAttemptAt','')::timestamptz ASC NULLS FIRST,awb ASC
      LIMIT 3`;
    // Vercel cron arrives on a protected deployment hostname; that hostname
    // returns 401 for internal tracking calls. Use the public production
    // custom domain while preserving the Gulf-only 072 query.
    const origin=process.env.VERCEL_ENV==='production'
      ?'https://tracker.mayavicargo.com':new URL(request.url).origin;
    const output=await Promise.allSettled(candidates.map(row=>trackOne(sql,origin,key,row)));
    const results=output.map((item,i)=>item.status==='fulfilled'?item.value:
      {mawb:candidates[i]?.awb,verified:false,error:String(item.reason?.message||item.reason).slice(0,250)});
    const summary={ok:true,checkedAt:new Date().toISOString(),selected:candidates.length,
      verified:results.filter(x=>x.verified).length,failed:results.filter(x=>!x.verified).length,
      results};
    console.log('mayavi_gulf_air_cron',JSON.stringify(summary));
    return Response.json(summary,{headers:{'Cache-Control':'no-store'}});
  }catch(e){
    console.error('mayavi_gulf_air_cron_error',String(e?.message||e));
    return Response.json({ok:false,error:'Gulf Air scheduled tracking failed'},{status:503});
  }
}
