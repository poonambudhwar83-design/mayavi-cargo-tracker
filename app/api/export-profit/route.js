import { neon } from '@neondatabase/serverless';
import { readSession } from '../../../lib/mayaviAuth.js';
import { masterKg, partKg } from '../../../lib/arrivalWeights.js';
import { selectedProfitMonth, profitMonths, currentProfitMonth, exportProfitHandoverDate, exportRateForCompany } from '../../../lib/profitPeriod.js';
import { includeExportMasterInProfit, exportProfitRegister } from '../../../lib/exportProfitSource.js';
import { EXPORT_SHIPMENT_CHARGE } from '../../../lib/exportShipmentCharge.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Read-only calculation based ONLY on Export MAWB masters. Includes the same
// Active + completed-source registers as the Export dashboard. No Import rows,
// airline tracking, or financial-entry fields are changed by this endpoint.
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
function clientName(data={}){
  return String(data.clientName||data.client||'').trim();
}
export async function GET(request){
  if(readSession(request)?.role!=='admin')
    return Response.json({ok:false,error:'Admin authorization required.'},{status:403});
  const month=selectedProfitMonth(new URL(request.url).searchParams.get('month'));
  if(!month)return Response.json({ok:false,error:'Profit sheets start from October 2026. Choose a valid month.'},{status:400});
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
      if(!includeExportMasterInProfit(data,month,currentProfitMonth()))continue;
      const weight=totalWeight(data);
      const client=clientName(data);
      const rate=exportRateForCompany(client);
      rows.push({
        mawb:awb.slice(0,3)+'-'+awb.slice(3),
        handoverDate:exportProfitHandoverDate(data),
        register:exportProfitRegister(data),
        weight,
        clientName:client,
        rate,
        shipmentCharge:EXPORT_SHIPMENT_CHARGE, // Deduct once per master MAWB.
        profit:weight===null?null:Math.round((weight*rate-EXPORT_SHIPMENT_CHARGE)*100)/100
      });
    }
    return Response.json({ok:true,rows,month,months:profitMonths()},{headers:{'Cache-Control':'no-store, private'}});
  }catch(error){
    return Response.json({ok:false,error:error?.message||'Export Profit Sheet unavailable.'},{status:503});
  }
}
