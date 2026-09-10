import { neon } from '@neondatabase/serverless';
import { readSession } from '../../../lib/mayaviAuth.js';
import { readSaudiaScreenshot } from '../../../lib/saudiaScreenshotOcr.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;

function connectionString(){return process.env.DATABASE_URL||process.env.POSTGRES_URL||process.env.NEON_DATABASE_URL||process.env.DATABASE_URL_UNPOOLED||''}
function db(){const url=connectionString();if(!url)throw new Error('DATABASE_URL is not configured in Vercel.');return neon(url)}
function digits(v=''){return String(v||'').replace(/\D/g,'')}
function normalize(v=''){const d=digits(v);return d.length===11?`${d.slice(0,3)}-${d.slice(3)}`:''}
function merge(base={},next={}){
  const out={...base};
  for(const k of ['origin','destination','flightNo','flightDate','pieces','bags','weight','bookingDate','arrivalDate','arrivalTime','officialTracker'])if(next?.[k])out[k]=next[k];
  if(next?.arrivalIsActual!==undefined)out.arrivalIsActual=Boolean(next.arrivalIsActual);
  // For Saudia the screenshot's top/right State field is authoritative. Timeline must not override it.
  if(next?.status&&next.status!=='TRACKING')out.status=next.status;
  if(next?.source)out.source=next.source;
  return out;
}

export async function POST(request){
  try{
    const session=readSession(request);if(!session)return Response.json({ok:false,error:'Login required.'},{status:401});
    const body=await request.json(),mawb=normalize(body?.mawb),clientName=String(body?.clientName||'').trim(),shipmentType=body?.shipmentType==='EXPORT'?'EXPORT':'IMPORT',images=Array.isArray(body?.images)?body.images.filter(Boolean).slice(0,5):[];
    if(!mawb||!mawb.startsWith('065-'))return Response.json({ok:false,error:'Enter a valid Saudia 065 MAWB.'},{status:400});
    if(!images.length)return Response.json({ok:false,error:'Upload at least one Saudia More Information screenshot.'},{status:400});

    let extracted={mawb,carrierCode:'SV',airlineName:'Saudia Cargo'},successCount=0;const debug=[];
    for(const image of images){
      const r=await readSaudiaScreenshot({mawb,screenshotBase64:image});
      debug.push({ok:r.ok,reason:r.reason||'',eventCount:r.debug?.eventCount||0,summarySample:r.debug?.summarySample||'',segment1Sample:r.debug?.segment1Sample||''});
      if(r.ok){extracted=merge(extracted,r.shipment);successCount++;}
    }
    if(!successCount)return Response.json({ok:false,error:'Could not read verified Saudia fields from the More Information screenshot.',debug},{status:422});

    const awb=digits(mawb),sql=db();const [existing]=await sql`SELECT data FROM mayavi_shipments WHERE awb=${awb} LIMIT 1`;
    const current=existing?.data||{};
    const finalClient=clientName||String(current.clientName||'').trim();
    if(!finalClient)return Response.json({ok:false,error:'Client Name is mandatory. Enter client name before saving the Saudia screenshot.'},{status:400});

    const now=new Date().toISOString();
    const updated=merge(current,extracted);
    updated.mawb=mawb;updated.shipmentType=current.shipmentType==='EXPORT'?'EXPORT':existing?'IMPORT':shipmentType;updated.clientName=finalClient;
    updated.enteredBy=current.enteredBy||String(session.displayName||session.username||'').trim();
    updated.enteredByUsername=current.enteredByUsername||String(session.username||'').trim();
    updated.enteredAt=current.enteredAt||now;updated.lastChecked=now;updated.trackingError='';updated.manualHint='';

    const [saved]=await sql`
      INSERT INTO mayavi_shipments (awb,data,version,updated_at,tracking_checked_at)
      VALUES (${awb},${JSON.stringify(updated)}::jsonb,1,now(),now())
      ON CONFLICT (awb) DO UPDATE SET
        data=${JSON.stringify(updated)}::jsonb,
        version=mayavi_shipments.version+1,
        updated_at=now(),
        tracking_checked_at=now()
      RETURNING awb,data,version,updated_at,tracking_checked_at
    `;
    return Response.json({ok:true,shipment:saved?.data||updated,debug,successCount,created:!existing});
  }catch(e){return Response.json({ok:false,error:e?.message||String(e)},{status:503});}
}
