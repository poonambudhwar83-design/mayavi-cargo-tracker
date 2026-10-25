import { neon } from '@neondatabase/serverless';
import { readSession } from '../../../lib/mayaviAuth.js';
import { masterKg, partKg } from '../../../lib/arrivalWeights.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';

// Kept separate from mayavi_shipments so airline/cron refreshes cannot change
// duty and rate entered by the admin.
function sqlClient(){
  const url=process.env.DATABASE_URL||process.env.POSTGRES_URL||
    process.env.NEON_DATABASE_URL||process.env.DATABASE_URL_UNPOOLED||'';
  if(!url)throw new Error('Shared database is not configured.');
  return neon(url);
}
function adminOnly(request){
  const session=readSession(request);
  return session?.role==='admin'?session:null;
}
function awbDigits(value=''){
  const digits=String(value??'').replace(/\D/g,'');
  return digits.length===11?digits:'';
}
function numericPart(value){
  const text=String(value??'').replace(/,/g,'').trim();
  const reference=text.includes('/')?text.split('/').at(-1):text;
  const number=reference.includes('+')?reference.split('+').reduce((sum,p)=>sum+Number(p),0):Number(reference);
  const numeric=/^\d+(?:\.\d+)?(?:\+\d+(?:\.\d+)?)*$/.test(reference)?number:NaN;
  return Number.isFinite(numeric)&&numeric>0?numeric:null;
}
function uniqueParts(record={}){
  const seen=new Set();
  return (Array.isArray(record.partShipments)?record.partShipments:[]).filter(part=>{
    if(!part||part._saudiaPendingVirtual===true)return false;
    const key=String(part.partKey||part.partId||'').trim()||[
      String(part.flightNo||'').trim(),String(part.flightDate||part.departureDate||'').trim(),
      String(part.pieces||part.bags||'').trim(),String(part.weight||'').trim()
    ].join('|');
    if(seen.has(key))return false;
    seen.add(key);
    return true;
  });
}
function totalWeight(record={}){
  // The master AWB total is authoritative, never a single movement's numerator.
  const primary=masterKg(record);
  if(primary!==null)return primary;
  const parts=uniqueParts(record);
  const sum=parts.reduce((total,part)=>total+(partKg(part.weight)||0),0);
  return sum>0?sum:null;
}
function totalBags(record={}){
  for(const field of ['totalPieces','masterPieces','totalBags','masterBags','bags','pieces']){
    const value=numericPart(record[field]);
    if(value!==null)return value;
  }
  const parts=uniqueParts(record);
  const sum=parts.reduce((total,part)=>total+(numericPart(String(part.pieces||part.bags||'').split('/')[0])||0),0);
  return sum>0?sum:null;
}
function normalizeGoods(value=''){
  const category=String(value||'').trim().toUpperCase();
  return ['HH','PROTEIN','CLOTHES'].includes(category)?category:'';
}
function inferGoods(value=''){
  const raw=String(value||'').toUpperCase();
  if(/\bPROTEIN\b|\bWHEY\b/.test(raw))return 'PROTEIN';
  if(/\bCLOTH(?:ES|ING)?\b|\bGARMENTS?\b|\bAPPAREL\b/.test(raw))return 'CLOTHES';
  if(/\bHH\b|\bHOUSE\s*HOLD\b|\bHOUSEHOLD\b/.test(raw))return 'HH';
  return '';
}
function numberField(value){
  if(value===null||value===undefined||String(value).trim()==='')return null;
  const clean=String(value).replace(/,/g,'').trim();
  if(!/^\d+(?:\.\d{1,4})?$/.test(clean))throw new Error('Enter a valid non-negative amount (up to 4 decimal places).');
  const number=Number(clean);
  if(!Number.isFinite(number)||number>999999999999)throw new Error('Amount is out of range.');
  return number;
}
async function ensureStore(sql){
  await sql`CREATE TABLE IF NOT EXISTS mayavi_import_profit (
    awb VARCHAR(11) PRIMARY KEY,
    total_duty NUMERIC(16,2),
    rate NUMERIC(16,4),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by TEXT NOT NULL DEFAULT '',
    goods_category TEXT
  )`;
  await sql`ALTER TABLE mayavi_import_profit ADD COLUMN IF NOT EXISTS goods_category TEXT`;
}
export async function GET(request){
  if(!adminOnly(request))return Response.json({ok:false,error:'Admin authorization required.'},{status:403});
  try{
    const sql=sqlClient();
    await ensureStore(sql);
    const [shipments,profit]=await Promise.all([
      sql`SELECT awb,data FROM mayavi_shipments
          WHERE COALESCE(data->>'shipmentType','IMPORT')='IMPORT'
          ORDER BY updated_at DESC`,
      sql`SELECT awb,total_duty,rate,goods_category FROM mayavi_import_profit`
    ]);
    const saved=new Map(profit.map(row=>[awbDigits(row.awb),row]));
    const seen=new Set();
    const rows=[];
    for(const shipment of shipments){
      const awb=awbDigits(shipment.awb);
      if(!awb||seen.has(awb))continue;
      seen.add(awb);
      const data=shipment.data||{};
      const financial=saved.get(awb)||{};
      rows.push({
        mawb:awb.slice(0,3)+'-'+awb.slice(3),
        clientName:data.clientName||data.client||'',
        bags:totalBags(data),
        weight:totalWeight(data),
        totalDuty:financial.total_duty===null||financial.total_duty===undefined?'':String(financial.total_duty),
        rate:financial.rate===null||financial.rate===undefined?'':String(financial.rate),
        goodsDescription:String(data.goodsDescription||data.goods_description||''),
        goodsCategory:financial.goods_category===null||financial.goods_category===undefined
          ?inferGoods(data.goodsDescription||data.goods_description||'')
          :normalizeGoods(financial.goods_category),
        enteredAt:data.enteredAt||'',
        arrivalDate:data.arrivalDate||''
      });
    }
    return Response.json({ok:true,rows},{headers:{'Cache-Control':'no-store, private'}});
  }catch(error){
    return Response.json({ok:false,error:error?.message||'Import Profit Sheet unavailable.'},{status:503});
  }
}
export async function PATCH(request){
  const admin=adminOnly(request);
  if(!admin)return Response.json({ok:false,error:'Admin authorization required.'},{status:403});
  try{
    const body=await request.json();
    const awb=awbDigits(body?.mawb);
    const field=body?.field;
    if(!awb||!['totalDuty','rate','goodsCategory'].includes(field))
      return Response.json({ok:false,error:'Invalid profit-sheet update.'},{status:400});
    const value=field==='goodsCategory'?normalizeGoods(body?.value):numberField(body?.value);
    if(field==='goodsCategory'&&String(body?.value||'').trim()&&!value)
      return Response.json({ok:false,error:'Choose HH, Protein, or Clothes.'},{status:400});
    const sql=sqlClient();
    await ensureStore(sql);
    const [shipment]=await sql`SELECT awb FROM mayavi_shipments WHERE awb=${awb}
      AND COALESCE(data->>'shipmentType','IMPORT')='IMPORT' LIMIT 1`;
    if(!shipment)return Response.json({ok:false,error:'Import MAWB not found. Refresh the sheet.'},{status:404});
    if(field==='totalDuty'){
      await sql`INSERT INTO mayavi_import_profit (awb,total_duty,updated_by)
        VALUES (${awb},${value},${admin.username})
        ON CONFLICT (awb) DO UPDATE SET total_duty=EXCLUDED.total_duty,
        updated_by=EXCLUDED.updated_by,updated_at=now()`;
    }else if(field==='rate'){
      await sql`INSERT INTO mayavi_import_profit (awb,rate,updated_by)
        VALUES (${awb},${value},${admin.username})
        ON CONFLICT (awb) DO UPDATE SET rate=EXCLUDED.rate,
        updated_by=EXCLUDED.updated_by,updated_at=now()`;
    }else{
      await sql`INSERT INTO mayavi_import_profit (awb,goods_category,updated_by)
        VALUES (${awb},${value},${admin.username})
        ON CONFLICT (awb) DO UPDATE SET goods_category=EXCLUDED.goods_category,
        updated_by=EXCLUDED.updated_by,updated_at=now()`;
    }
    return Response.json({ok:true,mawb:awb,field,value:value===null?'':String(value)});
  }catch(error){
    return Response.json({ok:false,error:error?.message||'Could not save the amount.'},{status:400});
  }
}
