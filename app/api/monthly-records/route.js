import { readSession } from '../../../lib/mayaviAuth.js';
import { ensureMonthlyArchiveTable, monthLabel, monthlyDb, snapshotClosedMonths } from '../../../lib/monthlyArchive.js';

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

    const months=await sql`
      SELECT
        archive_month,
        COUNT(*) FILTER (WHERE shipment_type='IMPORT')::int AS import_count,
        COUNT(*) FILTER (WHERE shipment_type='EXPORT')::int AS export_count,
        MAX(archived_at) AS archived_at
      FROM mayavi_monthly_archive
      GROUP BY archive_month
      ORDER BY archive_month DESC
    `;

    const url=new URL(request.url);
    const month=validMonth(url.searchParams.get('month'));
    const type=validType(url.searchParams.get('type'));
    let rows=[];
    if(month&&type){
      rows=await sql`
        SELECT archive_month,shipment_type,awb,data,archived_at
        FROM mayavi_monthly_archive
        WHERE archive_month=${month} AND shipment_type=${type}
        ORDER BY COALESCE(data->>'enteredAt','') ASC, awb ASC
      `;
    }else if(month){
      rows=await sql`
        SELECT archive_month,shipment_type,awb,data,archived_at
        FROM mayavi_monthly_archive
        WHERE archive_month=${month}
        ORDER BY shipment_type,COALESCE(data->>'enteredAt','') ASC,awb ASC
      `;
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
        archivedAt:r.archived_at
      }))
    });
  }catch(e){
    return Response.json({ok:false,error:e?.message||String(e)},{status:503});
  }
}
