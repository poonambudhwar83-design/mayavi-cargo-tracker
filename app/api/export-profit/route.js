import { neon } from '@neondatabase/serverless';
import { readSession } from '../../../lib/mayaviAuth.js';
import { masterKg, partKg } from '../../../lib/arrivalWeights.js';
import { selectedProfitMonth, profitMonths, currentProfitMonth, exportProfitHandoverDate, exportRateForCompany } from '../../../lib/profitPeriod.js';
import { includeExportMasterInProfit, exportProfitRegister } from '../../../lib/exportProfitSource.js';
import { EXPORT_SHIPMENT_CHARGE, validateExportShipmentCharge } from '../../../lib/exportShipmentCharge.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Read Export master MAWBs and a separately saved per-MAWB shipment charge.
// This endpoint never modifies Import rows, source tracking or airline adapters.
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
async function ensureCharges(sql){
  // Per master MAWB only. CREATE IF NOT EXISTS keeps old data safe.
  await sql`CREATE TABLE IF NOT EXISTS mayavi_export_shipment_charge (
    awb VARCHAR(11) PRIMARY KEY,
    charge NUMERIC(16,2) NOT NULL CHECK(charge>=0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by TEXT NOT NULL DEFAULT ''
  )`;
}
export async function GET(request){
  if(readSession(request)?.role!=='admin')
    return Response.json({ok:false,error:'Admin authorization required.'},{status:403});
  const month=selectedProfitMonth(new URL(request.url).searchParams.get('month'));
  if(!month)return Response.json({ok:false,error:'Profit sheets start from October 2026. Choose a valid month.'},{status:400});
  try{
    const sql=sqlClient();
    await ensureCharges(sql);
    const [shipments,charges]=await Promise.all([
      sql`SELECT awb,data FROM mayavi_shipments
        WHERE UPPER(COALESCE(data->>'shipmentType',''))='EXPORT'
        ORDER BY updated_at DESC`,
      sql`SELECT awb,charge FROM mayavi_export_shipment_charge`
    ]);
    const savedCharges=new Map(charges.map(row=>[awbDigits(row.awb),Number(row.charge)]));
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
      const shipmentCharge=savedCharges.has(awb)?savedCharges.get(awb):EXPORT_SHIPMENT_CHARGE;
      rows.push({
        mawb:awb.slice(0,3)+'-'+awb.slice(3),
        handoverDate:exportProfitHandoverDate(data),
        register:exportProfitRegister(data),
        weight,
        clientName:client,
        rate,
        shipmentCharge, // Admin-editable; still once per master MAWB.
        profit:weight===null?null:Math.round((weight*rate-shipmentCharge)*100)/100
      });
    }
    return Response.json({ok:true,rows,month,months:profitMonths()},{headers:{'Cache-Control':'no-store, private'}});
  }catch(error){
    return Response.json({ok:false,error:error?.message||'Export Profit Sheet unavailable.'},{status:503});
  }
}

export async function PATCH(request){
  const admin=readSession(request);
  if(admin?.role!=='admin')
    return Response.json({ok:false,error:'Admin authorization required.'},{status:403});
  try{
    const body=await request.json().catch(()=>({}));
    const awb=awbDigits(body.mawb);
    const charge=validateExportShipmentCharge(body.shipmentCharge);
    if(!awb||charge===null)
      return Response.json({ok:false,error:'Enter a valid Shipment Charge (₹0 or more, up to 2 decimals).'},{status:400});
    const sql=sqlClient();
    await ensureCharges(sql);
    const matched=await sql`SELECT awb FROM mayavi_shipments WHERE awb=${awb}
      AND UPPER(COALESCE(data->>'shipmentType',''))='EXPORT' LIMIT 1`;
    if(!matched.length)
      return Response.json({ok:false,error:'Export MAWB not found. Refresh the sheet.'},{status:404});
    await sql`INSERT INTO mayavi_export_shipment_charge(awb,charge,updated_by)
      VALUES (${awb},${charge},${admin.username})
      ON CONFLICT(awb) DO UPDATE SET charge=EXCLUDED.charge,
      updated_at=NOW(),updated_by=EXCLUDED.updated_by`;
    return Response.json({ok:true,mawb:awb.slice(0,3)+'-'+awb.slice(3),shipmentCharge:charge},
      {headers:{'Cache-Control':'no-store, private'}});
  }catch(error){
    return Response.json({ok:false,error:error?.message||'Unable to save shipment charge.'},{status:503});
  }
}
