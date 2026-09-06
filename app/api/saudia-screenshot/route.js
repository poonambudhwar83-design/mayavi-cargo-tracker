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
function statusRank(s=''){const u=String(s).toUpperCase();if(u.includes('ARRIVED')||u.includes('DELIVER'))return 5;if(u.includes('DELAY'))return 4;if(u.includes('TRANSIT')||u.includes('DEPART'))return 3;if(u.includes('BOOK'))return 2;return 0}
function merge(base={},next={}){
  const out={...base};
  for(const k of ['origin','destination','flightNo','pieces','bags','weight','bookingDate','arrivalDate','arrivalTime','officialTracker']){if(next?.[k])out[k]=next[k]}
  if(next?.arrivalIsActual)out.arrivalIsActual=true;
  if(statusRank(next?.status)>statusRank(out.status))out.status=next.status;
  if(next?.source)out.source=next.source;
  return out;
}

export async function POST(request){
  try{
    const session=readSession(request);if(!session)return Response.json({ok:false,error:'Login required.'},{status:401});
    const body=await request.json(),mawb=normalize(body?.mawb),images=Array.isArray(body?.images)?body.images.filter(Boolean).slice(0,5):[];
    if(!mawb||!mawb.startsWith('065-'))return Response.json({ok:false,error:'Enter a valid Saudia 065 MAWB.'},{status:400});
    if(!images.length)return Response.json({ok:false,error:'Upload at least one Saudia result screenshot.'},{status:400});
    let extracted={mawb,carrierCode:'SV',airlineName:'Saudia Cargo'},successCount=0;const debug=[];
    for(const image of images){const r=await readSaudiaScreenshot({mawb,screenshotBase64:image});debug.push({ok:r.ok,reason:r.reason||'',eventCount:r.debug?.eventCount||0,arrivalEvent:r.debug?.arrivalEvent||'',latestEvent:r.debug?.latestEvent||''});if(r.ok){extracted=merge(extracted,r.shipment);successCount++;}}
    if(!successCount)return Response.json({ok:false,error:'Could not read verified Saudia shipment timeline from these screenshots.',debug},{status:422});
    const awb=digits(mawb),sql=db();const [existing]=await sql`SELECT data FROM mayavi_shipments WHERE awb=${awb} LIMIT 1`;
    if(!existing)return Response.json({ok:false,error:'Add this MAWB to Mayavi first, then upload the Saudia screenshots.'},{status:404});
    const current=existing.data||{},updated=merge(current,extracted);updated.mawb=mawb;updated.lastChecked=new Date().toISOString();updated.trackingError='';updated.manualHint='';
    if(updated.arrivalDate&&updated.arrivalTime)updated.status='ARRIVED';
    const [saved]=await sql`UPDATE mayavi_shipments SET data=${JSON.stringify(updated)}::jsonb,version=version+1,updated_at=now(),tracking_checked_at=now() WHERE awb=${awb} RETURNING awb,data,version,updated_at,tracking_checked_at`;
    return Response.json({ok:true,shipment:saved?.data||updated,debug,successCount});
  }catch(e){return Response.json({ok:false,error:e?.message||String(e)},{status:503});}
}
