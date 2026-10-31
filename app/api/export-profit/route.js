import { neon } from '@neondatabase/serverless';
import { readSession } from '../../../lib/mayaviAuth.js';
import { masterKg, partKg } from '../../../lib/arrivalWeights.js';
import { selectedProfitMonth, profitMonths, currentProfitMonth, exportProfitHandoverDate, exportRateForCompany } from '../../../lib/profitPeriod.js';
import { includeExportMasterInProfit, exportProfitRegister } from '../../../lib/exportProfitSource.js';
import { EXPORT_SHIPMENT_CHARGE, validateExportShipmentCharge } from '../../../lib/exportShipmentCharge.js';
import {exportCategorySummary,validateExportBagCount} from '../../../lib/exportCategoryBags.js';

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
async function ensureCategoryBags(sql){
  // These counts never alter the tracking record's original bag count.
  await sql`CREATE TABLE IF NOT EXISTS mayavi_export_category_bags (
    awb VARCHAR(11) PRIMARY KEY,
    d_bags INTEGER NOT NULL DEFAULT 0 CHECK(d_bags >= 0),
    t_bags INTEGER NOT NULL DEFAULT 0 CHECK(t_bags >= 0),
    dt_bags INTEGER NOT NULL DEFAULT 0 CHECK(dt_bags >= 0),
    gc_bags INTEGER NOT NULL DEFAULT 0 CHECK(gc_bags >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by TEXT NOT NULL DEFAULT ''
  )`;
}
function savedBagCounts(row={}){
  return {D:Number(row.d_bags||0),T:Number(row.t_bags||0),DT:Number(row.dt_bags||0),GC:Number(row.gc_bags||0)};
}
export async function GET(request){
  if(readSession(request)?.role!=='admin')
    return Response.json({ok:false,error:'Admin authorization required.'},{status:403});
  const month=selectedProfitMonth(new URL(request.url).searchParams.get('month'));
  if(!month)return Response.json({ok:false,error:'Profit sheets start from October 2026. Choose a valid month.'},{status:400});
  try{
    const sql=sqlClient();
    await Promise.all([ensureCharges(sql),ensureCategoryBags(sql)]);
    const [shipments,charges,categoryRows]=await Promise.all([
      sql`SELECT awb,data FROM mayavi_shipments
        WHERE UPPER(COALESCE(data->>'shipmentType',''))='EXPORT'
        ORDER BY updated_at DESC`,
      sql`SELECT awb,charge FROM mayavi_export_shipment_charge`,
      sql`SELECT awb,d_bags,t_bags,dt_bags,gc_bags FROM mayavi_export_category_bags`
    ]);
    const savedCharges=new Map(charges.map(row=>[awbDigits(row.awb),Number(row.charge)]));
    const savedBags=new Map(categoryRows.map(row=>[awbDigits(row.awb),savedBagCounts(row)]));
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
      const categoryBags=savedBags.get(awb)||savedBagCounts();
      const categories=exportCategorySummary(categoryBags);
      rows.push({
        mawb:awb.slice(0,3)+'-'+awb.slice(3),
        handoverDate:exportProfitHandoverDate(data),
        register:exportProfitRegister(data),
        weight,
        clientName:client,
        rate,
        shipmentCharge, // Admin-editable; still once per master MAWB.
        categoryBags,categoryClientCharge:categories.clientCharge,
        categoryDeduction:categories.deduction,categoryProfit:categories.netProfit,
        profit:weight===null?null:Math.round((weight*rate-shipmentCharge+categories.netProfit)*100)/100
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
    if(!awb)return Response.json({ok:false,error:'Enter a valid Export MAWB.'},{status:400});
    const category=String(body.category||'').trim().toUpperCase();
    const bags=category?validateExportBagCount(body.bags):null;
    if(category&&(!['D','T','DT','GC'].includes(category)||bags===null))
      return Response.json({ok:false,error:'Enter D, T, DT or G&C bags as a whole number between 0 and 100,000.'},{status:400});
    const charge=category?null:validateExportShipmentCharge(body.shipmentCharge);
    if(!category&&charge===null)
      return Response.json({ok:false,error:'Enter a valid Shipment Charge (₹0 or more, up to 2 decimals).'},{status:400});
    const sql=sqlClient();
    await Promise.all([ensureCharges(sql),ensureCategoryBags(sql)]);
    const matched=await sql`SELECT awb FROM mayavi_shipments WHERE awb=${awb}
      AND UPPER(COALESCE(data->>'shipmentType',''))='EXPORT' LIMIT 1`;
    if(!matched.length)
      return Response.json({ok:false,error:'Export MAWB not found. Refresh the sheet.'},{status:404});
    if(category){
      if(category==='D')await sql`INSERT INTO mayavi_export_category_bags(awb,d_bags,updated_by)
        VALUES (${awb},${bags},${admin.username}) ON CONFLICT(awb) DO UPDATE
        SET d_bags=EXCLUDED.d_bags,updated_at=NOW(),updated_by=EXCLUDED.updated_by`;
      if(category==='T')await sql`INSERT INTO mayavi_export_category_bags(awb,t_bags,updated_by)
        VALUES (${awb},${bags},${admin.username}) ON CONFLICT(awb) DO UPDATE
        SET t_bags=EXCLUDED.t_bags,updated_at=NOW(),updated_by=EXCLUDED.updated_by`;
      if(category==='DT')await sql`INSERT INTO mayavi_export_category_bags(awb,dt_bags,updated_by)
        VALUES (${awb},${bags},${admin.username}) ON CONFLICT(awb) DO UPDATE
        SET dt_bags=EXCLUDED.dt_bags,updated_at=NOW(),updated_by=EXCLUDED.updated_by`;
      if(category==='GC')await sql`INSERT INTO mayavi_export_category_bags(awb,gc_bags,updated_by)
        VALUES (${awb},${bags},${admin.username}) ON CONFLICT(awb) DO UPDATE
        SET gc_bags=EXCLUDED.gc_bags,updated_at=NOW(),updated_by=EXCLUDED.updated_by`;
      const values=await sql`SELECT d_bags,t_bags,dt_bags,gc_bags
        FROM mayavi_export_category_bags WHERE awb=${awb} LIMIT 1`;
      const categoryBags=savedBagCounts(values[0]);
      return Response.json({ok:true,mawb:awb.slice(0,3)+'-'+awb.slice(3),categoryBags,
        categoryTotals:exportCategorySummary(categoryBags)}, {headers:{'Cache-Control':'no-store, private'}});
    }
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
