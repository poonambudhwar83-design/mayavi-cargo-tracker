import { neon } from '@neondatabase/serverless';

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
function safeData(row={}){
  const awb=normalize(row.mawb||row.awb);
  if(!awb)throw new Error('Invalid MAWB.');
  const data={...row,mawb:`${awb.slice(0,3)}-${awb.slice(3)}`};
  delete data._dbUpdatedAt;
  return {awb,data};
}

export async function GET(){
  try{
    const sql=db();
    const rows=await sql`SELECT awb,data,version,updated_at,tracking_checked_at FROM mayavi_shipments ORDER BY updated_at DESC`;
    return Response.json({ok:true,shared:true,count:rows.length,rows});
  }catch(e){
    return Response.json({ok:false,shared:false,error:e?.message||String(e)},{status:503});
  }
}

export async function POST(request){
  try{
    const body=await request.json();
    const incoming=Array.isArray(body?.rows)?body.rows:(body?.row?[body.row]:[]);
    if(!incoming.length)return Response.json({ok:false,error:'No shipment rows supplied.'},{status:400});
    const sql=db();
    const saved=[];
    for(const row of incoming){
      const {awb,data}=safeData(row);
      const checked=data.lastChecked?new Date(data.lastChecked):null;
      const [result]=await sql`
        INSERT INTO mayavi_shipments (awb,data,version,updated_at,tracking_checked_at)
        VALUES (${awb},${JSON.stringify(data)}::jsonb,1,now(),${checked})
        ON CONFLICT (awb) DO UPDATE SET
          data=EXCLUDED.data,
          version=mayavi_shipments.version+1,
          updated_at=now(),
          tracking_checked_at=EXCLUDED.tracking_checked_at
        RETURNING awb,data,version,updated_at,tracking_checked_at
      `;
      saved.push(result);
    }
    return Response.json({ok:true,shared:true,rows:saved});
  }catch(e){
    return Response.json({ok:false,shared:false,error:e?.message||String(e)},{status:503});
  }
}

export async function DELETE(request){
  try{
    const awb=normalize(new URL(request.url).searchParams.get('awb')||'');
    if(!awb)return Response.json({ok:false,error:'Invalid MAWB.'},{status:400});
    const sql=db();
    await sql`DELETE FROM mayavi_shipments WHERE awb=${awb}`;
    return Response.json({ok:true,shared:true,awb});
  }catch(e){
    return Response.json({ok:false,shared:false,error:e?.message||String(e)},{status:503});
  }
}
