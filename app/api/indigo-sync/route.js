import { neon } from '@neondatabase/serverless';
import { readSession } from '../../../lib/mayaviAuth.js';
import { trackIndigo } from '../../../lib/indigo.js';
import { mergePartMail, mergePartCustoms } from '../../../lib/partMail.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;

// Bounded batches keep one slow SmartKargo response from delaying every MAWB.
const MAX_PER_RUN=4;
const PARALLEL=2;
const MIN_RETRY_MS=90*1000;
const PROTECTED_FIELDS=new Set([
  'clientName','client','companyType','companyName','goodsDescription',
  'shipmentType','enteredBy','enteredByUsername','enteredAt',
  'mailSent','mailUpdatedAt','customsCleared','customsClearedAt',
  'customsClearedBy','masterCopyReceived','masterCopyReceivedAt',
  'masterCopyReceivedBy','handoverDone','handoverUpdatedAt',
  'handoverUpdatedBy','weightMinus','weightMinusUpdatedAt',
  'weightMinusUpdatedBy'
]);

function connectionString(){
  return process.env.DATABASE_URL||process.env.POSTGRES_URL||process.env.NEON_DATABASE_URL||process.env.DATABASE_URL_UNPOOLED||'';
}
function db(){
  const url=connectionString();
  if(!url)throw new Error('DATABASE_URL is not configured in Vercel.');
  return neon(url);
}
function needsRefresh(data={}){
  if(data.customsCleared===true)return false;
  const status=String(data.status||'').toUpperCase();
  if(['ARRIVED','DELIVERED'].includes(status))return false;
  const parts=Array.isArray(data.partShipments)?data.partShipments:[];
  // Do not reprocess fully arrived physical parts; pending splits must refresh.
  if(parts.length&&parts.every(part=>['ARRIVED','DELIVERED'].includes(String(part.status||'').toUpperCase())))return false;
  return true;
}
function lastAttemptMs(row){
  const d=row.data||{};
  return Math.max(0,...[d.indigoAutoAttemptAt,d.lastChecked,row.tracking_checked_at]
    .map(x=>Date.parse(x||'')||0));
}
export async function POST(request){
  try{
    if(!readSession(request))return Response.json({ok:false,error:'Login required.'},{status:401});
    const sql=db();
    const rows=await sql`SELECT awb,data,updated_at,tracking_checked_at FROM mayavi_shipments
      WHERE awb LIKE '312%' ORDER BY updated_at DESC LIMIT 40`;
    const now=Date.now();
    const due=rows.filter(row=>needsRefresh(row.data||{})&&now-lastAttemptMs(row)>=MIN_RETRY_MS)
      .sort((a,b)=>lastAttemptMs(a)-lastAttemptMs(b)).slice(0,MAX_PER_RUN);
    let checked=0,updated=0;
    const errors=[];
    let cursor=0;
    const worker=async()=>{
      while(cursor<due.length){
        const row=due[cursor++];
        // Reserve this MAWB before network I/O: multiple open dashboard tabs
        // should not simultaneously launch expensive browser fallbacks.
        const claimed=await sql`UPDATE mayavi_shipments
          SET data=jsonb_set(data,'{indigoAutoAttemptAt}',to_jsonb(NOW()::text),true)
          WHERE awb=${row.awb}
            AND COALESCE(NULLIF(data->>'indigoAutoAttemptAt','')::timestamptz,'epoch'::timestamptz)
              < NOW()-INTERVAL '90 seconds'
          RETURNING awb`;
        if(!claimed.length)continue;
        checked++;
        try{
          const result=await trackIndigo(row.awb);
          if(!result?.ok||!result.shipment){
            errors.push({awb:row.awb,error:result?.reason||'No verified IndiGo result'});
            continue;
          }
          const live={...result.shipment};
          for(const key of PROTECTED_FIELDS)delete live[key];
          delete live._debug;
          const fresh=await sql`SELECT data FROM mayavi_shipments WHERE awb=${row.awb} LIMIT 1`;
          const saved=fresh?.[0]?.data||{};
          if(Array.isArray(live.partShipments)){
            const savedParts=Array.isArray(saved.partShipments)?saved.partShipments:[];
            live.partShipments=mergePartCustoms(mergePartMail(live.partShipments,savedParts),savedParts);
          }
          const patch={...live,mawb:live.mawb||saved.mawb||`${row.awb.slice(0,3)}-${row.awb.slice(3)}`,
            lastChecked:new Date().toISOString(),trackingError:'',manualHint:''};
          for(const key of Object.keys(patch)){
            if(patch[key]===undefined||patch[key]===null||patch[key]==='')delete patch[key];
          }
          await sql`UPDATE mayavi_shipments
            SET data=data || ${JSON.stringify(patch)}::jsonb,
                version=version+1,updated_at=NOW(),tracking_checked_at=NOW()
            WHERE awb=${row.awb}`;
          updated++;
        }catch(e){
          errors.push({awb:row.awb,error:e?.message||String(e)});
        }
      }
    };
    await Promise.all(Array.from({length:Math.min(PARALLEL,due.length)},()=>worker()));
    console.log('indigo_auto_sync',JSON.stringify({eligible:due.length,checked,updated,failed:errors.length}));
    return Response.json({ok:true,checked,updated,errors},{headers:{'cache-control':'no-store'}});
  }catch(e){
    return Response.json({ok:false,error:e?.message||String(e)},{status:503});
  }
}
