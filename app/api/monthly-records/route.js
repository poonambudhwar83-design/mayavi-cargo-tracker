import { readSession } from '../../../lib/mayaviAuth.js';
import { ensureMonthlyArchiveTable, monthLabel, monthlyDb, snapshotClosedMonths } from '../../../lib/monthlyArchive.js';
import { importArrivalMonth } from '../../../lib/monthlyArchive.js';
import { confirmedPartArrival } from '../../../lib/arrivalWeights.js';
import { confirmedExportHandoverMonth } from '../../../lib/exportHandoverAccounting.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';

function validMonth(value=''){return /^(20\d{2})-(0[1-9]|1[0-2])$/.test(String(value||''))?String(value):''}
function validType(value=''){const t=String(value||'').toUpperCase();return t==='IMPORT'||t==='EXPORT'?t:''}

export async function GET(request){
  try{
    const session=readSession(request);
    if(!session)return Response.json({ok:false,error:'Login required.'},{status:401});
    if(session.role!=='admin')return Response.json({ok:false,error:'Admin authorization required.'},{status:403});

    const sql=monthlyDb();
    await ensureMonthlyArchiveTable(sql);
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
        archivedAt:r.archived_at
      }))
    });
  }catch(e){
    return Response.json({ok:false,error:e?.message||String(e)},{status:503});
  }
}
