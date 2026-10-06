import { neon } from '@neondatabase/serverless';

export const runtime='nodejs';
export const dynamic='force-dynamic';

function db(){
  const url=process.env.DATABASE_URL||process.env.POSTGRES_URL||process.env.NEON_DATABASE_URL||process.env.DATABASE_URL_UNPOOLED||'';
  if(!url)throw new Error('DATABASE_URL missing');
  return neon(url);
}
function clientOf(data={}){
  return String(data?.clientName||data?.client||'').trim();
}
export async function GET(request){
  const url=new URL(request.url);
  if(url.searchParams.get('k')!=='mvy-client-recovery-7c9f1a84b2d64a5fb0d3e81e1f6c2a97')return Response.json({ok:false},{status:404});
  const sql=db();
  const current=await sql`SELECT awb,data,updated_at FROM mayavi_shipments ORDER BY updated_at DESC`;
  let archived=[];
  try{
    archived=await sql`
      SELECT DISTINCT ON (awb) awb,archive_month,data,archived_at
      FROM mayavi_monthly_archive
      WHERE COALESCE(data->>'clientName',data->>'client','') <> ''
      ORDER BY awb,archive_month DESC,archived_at DESC
    `;
  }catch{}
  const latestArchive=new Map(archived.map(r=>[String(r.awb||''),r]));
  const counts={},activeImportCounts={},clearedImportCounts={},activeExportCounts={};
  let tpl=0,recoverable=0,blank=0,activeImport=0,clearedImport=0,activeExport=0;
  const recoverableRows=[];
  for(const row of current){
    const d=row.data||{};
    const cur=clientOf(d);
    counts[cur||'(blank)']=(counts[cur||'(blank)']||0)+1;
    if(!cur)blank++;
    const type=String(d.shipmentType||'IMPORT').trim().toUpperCase();
    if(type==='IMPORT'){
      if(d.customsCleared===true){
        clearedImport++;
        clearedImportCounts[cur||'(blank)']=(clearedImportCounts[cur||'(blank)']||0)+1;
      }else{
        activeImport++;
        activeImportCounts[cur||'(blank)']=(activeImportCounts[cur||'(blank)']||0)+1;
      }
    }else if((type==='EXPORT'||type==='OTHER_COUNTRIES')&&!(d.handoverDone===true&&d.masterCopyReceived===true)){
      activeExport++;
      activeExportCounts[cur||'(blank)']=(activeExportCounts[cur||'(blank)']||0)+1;
    }
    if(cur.toUpperCase()==='TPL'){
      tpl++;
      const old=latestArchive.get(String(row.awb||''));
      const archivedClient=clientOf(old?.data||{});
      if(archivedClient&&archivedClient.toUpperCase()!=='TPL'){
        recoverable++;
        recoverableRows.push({awb:String(row.awb||''),current:cur,archived:archivedClient,month:old.archive_month});
      }
    }
  }
  return Response.json({ok:true,currentCount:current.length,counts,tpl,blank,activeImport,activeImportCounts,clearedImport,clearedImportCounts,activeExport,activeExportCounts,archiveCount:archived.length,recoverable,recoverableRows});
}
