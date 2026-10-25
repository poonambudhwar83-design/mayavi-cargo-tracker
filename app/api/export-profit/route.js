import { neon } from '@neondatabase/serverless';
import { readSession } from '../../../lib/mayaviAuth.js';
import { masterKg, partKg } from '../../../lib/arrivalWeights.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Read-only calculation based on the export MAWB masters. No airline tracking
// or financial-entry fields are changed by this endpoint.
function sqlClient(){
  const url=process.env.DATABASE_URL||process.env.POSTGRES_URL||
    process.env.NEON_DATABASE_URL||process.env.DATABASE_URL_UNPOOLED||'';
  if(!url)throw new Error('Shared database is not configured.');
  return neon(url);
}
function awbDigits(value=''){
  const digits=String(value??'').replace(/\D/g,'');
  return digits.length===11?digits:'';
}
function totalWeight(data={}){
  const master=masterKg(data);
  if(master!==null)return master;
  const parts=Array.isArray(data.partShipments)?data.partShipments:[];
  const seen=new Set();
  let result=0;
  for(const part of parts){
    if(!part||part._saudiaPendingVirtual===true)continue;
    const key=String(part.partKey||part.partId||'').trim()||
      [part.flightNo,part.flightDate||part.departureDate,part.pieces||part.bags,part.weight].join('|');
    if(seen.has(key))continue;
    seen.add(key);
    result+=partKg(part.weight)||0;
  }
  return result>0?result:null;
}
function companyName(data={}){
  const name=String(data.companyName||'').trim();
  if(name)return name;
  const type=String(data.companyType||'').trim().toUpperCase();
  return type==='KCC'||type==='PV'?type:'';
}
export async function GET(request){
  if(readSession(request)?.role!=='admin')
    return Response.json({ok:false,error:'Admin authorization required.'},{status:403});
  try{
    const sql=sqlClient();
    const shipments=await sql`SELECT awb,data FROM mayavi_shipments
      WHERE UPPER(COALESCE(data->>'shipmentType',''))='EXPORT'
      ORDER BY updated_at DESC`;
    const seen=new Set(),rows=[];
    for(const shipment of shipments){
      const awb=awbDigits(shipment.awb);
      if(!awb||seen.has(awb))continue;
      seen.add(awb);
      const data=shipment.data||{};
      const weight=totalWeight(data);
      rows.push({
        mawb:awb.slice(0,3)+'-'+awb.slice(3),
        weight,
        companyName:companyName(data),
        shipmentCharge:1000, // One fixed shipment charge per unique master MAWB.
        profit:weight===null?null:Math.round((weight*6-1000)*100)/100
      });
    }
    return Response.json({ok:true,rows},{headers:{'Cache-Control':'no-store, private'}});
  }catch(error){
    return Response.json({ok:false,error:error?.message||'Export Profit Sheet unavailable.'},{status:503});
  }
}
