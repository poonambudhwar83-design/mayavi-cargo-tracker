import { readSession } from '../../../lib/mayaviAuth.js';
import { ensureMonthlyArchiveTable, monthLabel, monthlyDb, snapshotClosedMonths } from '../../../lib/monthlyArchive.js';
import { importArrivalMonth } from '../../../lib/monthlyArchive.js';
import { confirmedPartArrival } from '../../../lib/arrivalWeights.js';
import { confirmedExportHandoverMonth } from '../../../lib/exportHandoverAccounting.js';
import {archiveOriginalWeight,normalizedWeightMinus,validMonthlyPartKey} from '../../../lib/monthlyWeightMinus.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';

function validMonth(value=''){return /^(20\d{2})-(0[1-9]|1[0-2])$/.test(String(value||''))?String(value):''}
function validType(value=''){const t=String(value||'').toUpperCase();return t==='IMPORT'||t==='EXPORT'?t:''}

async function ensureWeightMinusTable(sql){
  await sql`CREATE TABLE IF NOT EXISTS mayavi_monthly_weight_minus (
    archive_month TEXT NOT NULL,
    shipment_type TEXT NOT NULL,
    awb TEXT NOT NULL,
    part_key TEXT NOT NULL DEFAULT 'master',
    weight_minus NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (weight_minus >= 0),
    updated_by TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (archive_month, shipment_type, awb, part_key)
  )`;
}
function authorizedAdmin(request){
  const session=readSession(request);
  if(!session)return {error:'Login required.',status:401};
  if(session.role!=='admin')return {error:'Admin authorization required.',status:403};
  return {session};
}
export async function PATCH(request){
  const auth=authorizedAdmin(request);
  if(auth.error)return Response.json({ok:false,error:auth.error},{status:auth.status});
  let payload={};
  try{payload=await request.json()}catch{return Response.json({ok:false,error:'Invalid JSON data.'},{status:400})}
  const month=validMonth(payload.month);
  const awb=String(payload.awb||'').replace(/\D/g,'');
  const partKey=String(payload.partKey||'master');
  if(!month||!/^[0-9]{11}$/.test(awb)||!validMonthlyPartKey(partKey))
    return Response.json({ok:false,error:'Invalid month, MAWB or shipment part.'},{status:400});
  try{
    const sql=monthlyDb();
    await ensureMonthlyArchiveTable(sql);
    await ensureWeightMinusTable(sql);
    const archive=await sql`SELECT data FROM mayavi_monthly_archive
      WHERE archive_month=${month} AND shipment_type='IMPORT' AND awb=${awb} LIMIT 1`;
    if(!archive.length)return Response.json({ok:false,error:'This Import record is not saved for the selected month.'},{status:404});
    const original=archiveOriginalWeight(archive[0].data||{},month,partKey);
    if(original===null)return Response.json({ok:false,error:'No verified weight for this shipment/part.'},{status:400});
    const minus=normalizedWeightMinus(payload.weightMinus,original);
    if(minus===null)return Response.json({ok:false,error:'Weight Minus must be 0–'+original+' kg, with up to 3 decimals.'},{status:400});
    await sql`INSERT INTO mayavi_monthly_weight_minus
      (archive_month,shipment_type,awb,part_key,weight_minus,updated_by,updated_at)
      VALUES (${month},'IMPORT',${awb},${partKey},${minus},${String(auth.session.username||'admin').slice(0,100)},NOW())
      ON CONFLICT(archive_month,shipment_type,awb,part_key) DO UPDATE
      SET weight_minus=EXCLUDED.weight_minus,updated_by=EXCLUDED.updated_by,updated_at=NOW()`;
    return Response.json({ok:true,month,awb,partKey,weightMinus:minus,originalWeight:original,
      netWeight:Math.round((original-minus)*1000)/1000});
  }catch(e){
    console.error('monthly_weight_minus_save',String(e?.message||e));
    return Response.json({ok:false,error:'Could not save Weight Minus. Please retry.'},{status:503});
  }
}

export async function GET(request){
  try{
    const session=readSession(request);
    if(!session)return Response.json({ok:false,error:'Login required.'},{status:401});
    if(session.role!=='admin')return Response.json({ok:false,error:'Admin authorization required.'},{status:403});

    const sql=monthlyDb();
    await ensureMonthlyArchiveTable(sql);
    await ensureWeightMinusTable(sql);
    const snapshot=await snapshotClosedMonths(sql);

    // Keep older archive snapshots untouched. Previously some Export masters
    // were stored by flight departure month; only surface them in the correct
    // confirmed Handover YES month. The snapshot job also backfills that month.
    const archived=await sql`
      SELECT archive_month,shipment_type,awb,data,archived_at
      FROM mayavi_monthly_archive
      ORDER BY archive_month DESC,awb ASC
    `;
    const matchesAccountingMonth=record=>{
      const data=record.data||{},period=String(record.archive_month||'');
      if(record.shipment_type==='EXPORT')
        return confirmedExportHandoverMonth(data)===period;
      if(record.shipment_type!=='IMPORT')return false;
      const parts=Array.isArray(data.partShipments)?data.partShipments.filter(Boolean):[];
      if(parts.length)return parts.some(p=>confirmedPartArrival(p)&&importArrivalMonth(p.arrivalDate)===period);
      return confirmedPartArrival(data)&&importArrivalMonth(data.arrivalDate)===period;
    };
    const validRecords=archived.filter(matchesAccountingMonth);
    const summary=new Map();
    for(const record of validRecords){
      const key=record.archive_month;
      if(!summary.has(key))summary.set(key,{
        archive_month:key,import_count:0,export_count:0,archived_at:null
      });
      const item=summary.get(key);
      if(record.shipment_type==='IMPORT')item.import_count++;
      else if(record.shipment_type==='EXPORT')item.export_count++;
      if(!item.archived_at||String(record.archived_at)>String(item.archived_at))
        item.archived_at=record.archived_at;
    }
    const months=[...summary.values()].sort((a,b)=>b.archive_month.localeCompare(a.archive_month));

    const url=new URL(request.url);
    const month=validMonth(url.searchParams.get('month'));
    const type=validType(url.searchParams.get('type'));
    const rows=month?validRecords.filter(record=>
      record.archive_month===month&&(!type||record.shipment_type===type))
      .sort((a,b)=>String(a.data?.enteredAt||'').localeCompare(String(b.data?.enteredAt||''))||
        String(a.awb||'').localeCompare(String(b.awb||''))):[];
    const savedMinus=month&&(!type||type==='IMPORT')?
      await sql`SELECT awb,part_key,weight_minus FROM mayavi_monthly_weight_minus
        WHERE archive_month=${month} AND shipment_type='IMPORT'`:[];
    const weightMinusByAwb=new Map();
    for(const adjustment of savedMinus){
      const byPart=weightMinusByAwb.get(adjustment.awb)||{};
      byPart[adjustment.part_key]=Number(adjustment.weight_minus)||0;
      weightMinusByAwb.set(adjustment.awb,byPart);
    }


    return Response.json({
      ok:true,
      currentMonth:snapshot.currentMonth,
      months:months.map(m=>({
        key:m.archive_month,
        label:monthLabel(m.archive_month),
        importCount:Number(m.import_count||0),
        exportCount:Number(m.export_count||0),
        archivedAt:m.archived_at
      })),
      rows:rows.map(r=>({
        archiveMonth:r.archive_month,
        shipmentType:r.shipment_type,
        awb:r.awb,
        data:r.data||{},
        weightMinusByPart:r.shipment_type==='IMPORT'?weightMinusByAwb.get(r.awb)||{}:{},
        archivedAt:r.archived_at
      }))
    });
  }catch(e){
    return Response.json({ok:false,error:e?.message||String(e)},{status:503});
  }
}
