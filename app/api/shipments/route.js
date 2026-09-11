import { neon } from '@neondatabase/serverless';
import { readSession } from '../../../lib/mayaviAuth.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';

function connectionString(){
  return process.env.DATABASE_URL||process.env.POSTGRES_URL||process.env.NEON_DATABASE_URL||process.env.DATABASE_URL_UNPOOLED||'';
}
function db(){
  const url=connectionString();
  if(!url)throw new Error('DATABASE_URL is not configured in Vercel.');
  return neon(url);
}
function digits(v=''){return String(v).replace(/\D/g,'')}
function normalize(v=''){const d=digits(v);return d.length===11?d:''}
function normalizeSaudiaFlightNo(value=''){
  const raw=String(value||'').trim().toUpperCase().replace(/\s+/g,'');
  if(!raw)return'';
  const m=raw.match(/^(?:SV|SVA)?0*(\d{1,4}[A-Z]?)$/);
  if(m)return`SV${m[1]}`;
  return /^SV\d{1,4}[A-Z]?$/.test(raw)?raw:'';
}
function enforceSaudiaFlightNo(data={},awbValue=''){
  const awb=normalize(awbValue||data.mawb||data.awb);
  if(!awb.startsWith('065'))return data;
  const flightNo=normalizeSaudiaFlightNo(data.flightNo||data.flight||'');
  if(!flightNo)return data;
  return {...data,flightNo,flight:flightNo};
}
function fractionIsPartial(v=''){
  const m=String(v||'').trim().match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
  if(!m)return false;
  const arrived=Number(m[1]),total=Number(m[2]);
  return Number.isFinite(arrived)&&Number.isFinite(total)&&total>0&&arrived>=0&&arrived<total;
}
function saudiaIsPartLoad(data={},awbValue=''){
  const awb=normalize(awbValue||data.mawb||data.awb);
  if(!awb.startsWith('065'))return false;
  if(data.isPartLoad===true)return true;
  const arrivedPieces=Number(data.arrivedPieces),totalPieces=Number(data.totalPieces);
  if(Number.isFinite(arrivedPieces)&&Number.isFinite(totalPieces)&&totalPieces>0&&arrivedPieces>0&&arrivedPieces<totalPieces)return true;
  return fractionIsPartial(data.pieces)||fractionIsPartial(data.bags)||fractionIsPartial(data.weight);
}
function enforceSaudiaPartLoad(data={},awbValue=''){
  if(!saudiaIsPartLoad(data,awbValue))return data;
  return {...data,isPartLoad:true,status:'PART ARRIVED'};
}
function sanitizeKuwaitDetailsOnly(data={},awbValue=''){
  const awb=normalize(awbValue||data.mawb||data.awb);
  if(!awb.startsWith('229'))return data;
  // Kuwait tracking now returns verified destination and calculated arrival fields.
  // Preserve them in shared storage so a refresh survives page reload/login/device changes.
  return {...data};
}
function sanitizeShipment(data={},awbValue=''){
  let clean=sanitizeKuwaitDetailsOnly(data,awbValue);
  clean=enforceSaudiaFlightNo(clean,awbValue);
  return enforceSaudiaPartLoad(clean,awbValue);
}
function secureEqual(a='',b=''){
  const aa=Buffer.from(String(a)),bb=Buffer.from(String(b));
  return aa.length===bb.length&&aa.equals(bb);
}
function internalAllowed(request){
  const configured=process.env.MAYAVI_ADMIN_KEY||process.env.CRON_SECRET||'';
  const supplied=request.headers.get('x-mayavi-internal-key')||'';
  return Boolean(configured&&supplied&&secureEqual(configured,supplied));
}
function access(request){
  const session=readSession(request);
  return {session,internal:internalAllowed(request),allowed:Boolean(session||internalAllowed(request))};
}
function safeData(row={},session=null,markEntry=false){
  const awb=normalize(row.mawb||row.awb);
  if(!awb)throw new Error('Invalid MAWB.');
  let data={...row,mawb:`${awb.slice(0,3)}-${awb.slice(3)}`,shipmentType:row.shipmentType==='EXPORT'?'EXPORT':'IMPORT'};
  data=sanitizeShipment(data,awb);
  delete data._dbUpdatedAt;
  if(markEntry&&session){
    data.enteredBy=String(session.displayName||session.username||'').trim();
    data.enteredByUsername=String(session.username||'').trim();
    data.enteredAt=data.enteredAt||new Date().toISOString();
  }
  return {awb,data};
}

export async function GET(request){
  try{
    const auth=access(request);if(!auth.allowed)return Response.json({ok:false,error:'Login required.'},{status:401});
    const sql=db();
    const rawRows=await sql`SELECT awb,data,version,updated_at,tracking_checked_at FROM mayavi_shipments ORDER BY updated_at DESC`;
    const rows=rawRows.map(row=>({...row,data:sanitizeShipment(row.data||{},row.awb)}));
    return Response.json({ok:true,shared:true,count:rows.length,rows});
  }catch(e){
    return Response.json({ok:false,shared:false,error:e?.message||String(e)},{status:503});
  }
}

export async function POST(request){
  try{
    const auth=access(request);if(!auth.allowed)return Response.json({ok:false,error:'Login required.'},{status:401});
    const body=await request.json();
    const incoming=Array.isArray(body?.rows)?body.rows:(body?.row?[body.row]:[]);
    if(!incoming.length)return Response.json({ok:false,error:'No shipment rows supplied.'},{status:400});
    const markEntry=body?.markEntry===true&&!auth.internal;
    const sql=db();
    const saved=[];
    for(const row of incoming){
      const {awb,data}=safeData(row,auth.session,markEntry);
      const checked=data.lastChecked?new Date(data.lastChecked):null;
      const [result]=await sql`
        INSERT INTO mayavi_shipments (awb,data,version,updated_at,tracking_checked_at)
        VALUES (${awb},${JSON.stringify(data)}::jsonb,1,now(),${checked})
        ON CONFLICT (awb) DO UPDATE SET
          data=EXCLUDED.data || jsonb_build_object(
            'enteredBy',COALESCE(mayavi_shipments.data->>'enteredBy',EXCLUDED.data->>'enteredBy'),
            'enteredByUsername',COALESCE(mayavi_shipments.data->>'enteredByUsername',EXCLUDED.data->>'enteredByUsername'),
            'enteredAt',COALESCE(mayavi_shipments.data->>'enteredAt',EXCLUDED.data->>'enteredAt'),
            'bookingDate',COALESCE(NULLIF(EXCLUDED.data->>'bookingDate',''),mayavi_shipments.data->>'bookingDate',''),
            'bookingTime',COALESCE(NULLIF(EXCLUDED.data->>'bookingTime',''),mayavi_shipments.data->>'bookingTime',''),
            'bookingDateSource',COALESCE(NULLIF(EXCLUDED.data->>'bookingDateSource',''),mayavi_shipments.data->>'bookingDateSource',''),
            'flightNo',COALESCE(NULLIF(EXCLUDED.data->>'flightNo',''),mayavi_shipments.data->>'flightNo',''),
            'flightDate',COALESCE(NULLIF(EXCLUDED.data->>'flightDate',''),mayavi_shipments.data->>'flightDate','')
          ),
          version=mayavi_shipments.version+1,
          updated_at=now(),
          tracking_checked_at=EXCLUDED.tracking_checked_at
        RETURNING awb,data,version,updated_at,tracking_checked_at
      `;
      saved.push({...result,data:sanitizeShipment(result.data||{},result.awb)});
    }
    return Response.json({ok:true,shared:true,rows:saved});
  }catch(e){
    return Response.json({ok:false,shared:false,error:e?.message||String(e)},{status:503});
  }
}

export async function DELETE(request){
  try{
    const session=readSession(request);
    if(!session||session.role!=='admin')return Response.json({ok:false,error:'Admin authorization required.'},{status:403});
    const awb=normalize(new URL(request.url).searchParams.get('awb')||'');
    if(!awb)return Response.json({ok:false,error:'Invalid MAWB.'},{status:400});
    const sql=db();
    await sql`DELETE FROM mayavi_shipments WHERE awb=${awb}`;
    return Response.json({ok:true,shared:true,awb});
  }catch(e){
    return Response.json({ok:false,shared:false,error:e?.message||String(e)},{status:503});
  }
}
