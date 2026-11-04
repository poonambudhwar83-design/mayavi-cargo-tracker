import { randomUUID, createHash } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import ExcelJS from 'exceljs';
import { readSession } from '../../../lib/mayaviAuth.js';
import { parseCountryWorkbook } from '../../../lib/countryLoadAnalysis.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const MAX_UPLOAD_BYTES=3*1024*1024; // under Vercel's request-body limit
const respond=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
function database(){
  const url=process.env.DATABASE_URL||process.env.POSTGRES_URL||
    process.env.NEON_DATABASE_URL||process.env.DATABASE_URL_UNPOOLED||'';
  if(!url)throw Error('Mayavi database unavailable.');
  return neon(url);
}
async function authorized(request,sql){
  const session=readSession(request);
  if(!session)return {error:'Please log in first.',status:401};
  if(session.role!=='admin')return {error:'Admin access only.',status:403};
  const rows=await sql`SELECT role,is_active FROM mayavi_users WHERE lower(username)=${session.username} LIMIT 1`;
  if(rows[0]?.role!=='admin'||!rows[0]?.is_active)return {error:'Admin account is not active.',status:403};
  return {session};
}
const flowValue=s=>['IMPORT','EXPORT'].includes(String(s||'').toUpperCase())?String(s).toUpperCase():'';
const monthValue=s=>/^(20\d{2})-(0[1-9]|1[0-2])$/.test(String(s||''))?String(s):'';
const validMonth=s=>s==='ALL'||Boolean(monthValue(s));
const safeFileName=s=>String(s||'country-load.xlsx').replace(/[^a-zA-Z0-9_. -]/g,'_').slice(0,100);
const round=v=>Math.round(Number(v||0)*100)/100;
async function ensureTables(sql){
  await sql`CREATE TABLE IF NOT EXISTS mayavi_other_country_uploads (
    id UUID PRIMARY KEY,
    flow TEXT NOT NULL CHECK(flow IN ('IMPORT','EXPORT')),
    report_month VARCHAR(7) NOT NULL CHECK(report_month ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
    file_name TEXT NOT NULL,
    file_bytes BYTEA NOT NULL,
    file_sha256 TEXT NOT NULL,
    sheets TEXT NOT NULL DEFAULT '',
    parsed_rows INTEGER NOT NULL DEFAULT 0,
    skipped_rows INTEGER NOT NULL DEFAULT 0,
    uploaded_by TEXT NOT NULL,
    ready BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS mayavi_other_country_rows (
    id BIGSERIAL PRIMARY KEY,
    upload_id UUID NOT NULL REFERENCES mayavi_other_country_uploads(id) ON DELETE CASCADE,
    courier_name TEXT NOT NULL,
    country TEXT NOT NULL DEFAULT 'Unspecified',
    weight_kg NUMERIC(16,3) NOT NULL CHECK(weight_kg>0),
    bags INTEGER NOT NULL CHECK(bags>0),
    sheet_name TEXT NOT NULL DEFAULT '',
    source_row INTEGER NOT NULL DEFAULT 0
  )`;
  await sql`CREATE INDEX IF NOT EXISTS mayavi_other_country_rows_upload_idx ON mayavi_other_country_rows(upload_id)`;
  await sql`CREATE INDEX IF NOT EXISTS mayavi_other_country_upload_month_idx
    ON mayavi_other_country_uploads(flow,report_month,created_at DESC) WHERE ready=true`;
}
async function activeFiles(sql){
  return sql`SELECT DISTINCT ON(flow,report_month)
    id,flow,report_month,file_name,file_sha256,sheets,parsed_rows,skipped_rows,uploaded_by,created_at
    FROM mayavi_other_country_uploads WHERE ready=true
    ORDER BY flow,report_month,created_at DESC,id DESC`;
}
const activeSql=`SELECT DISTINCT ON(flow,report_month) id FROM mayavi_other_country_uploads
  WHERE ready=true ORDER BY flow,report_month,created_at DESC,id DESC`;
async function breakdown(sql,flow,month,country){
  // Sum WEIGHT for each shipment row's average (weight / bags), never sum averages.
  const rows=await sql`SELECT MIN(r.courier_name) AS courier_name,
    COUNT(*)::int AS entries, SUM(r.bags)::bigint AS total_bags,
    SUM(r.weight_kg)::numeric AS total_weight,
    SUM(CASE WHEN r.weight_kg/r.bags < 30 THEN r.weight_kg ELSE 0 END)::numeric AS under30,
    SUM(CASE WHEN r.weight_kg/r.bags >= 30 AND r.weight_kg/r.bags <= 35 THEN r.weight_kg ELSE 0 END)::numeric AS from30to35,
    SUM(CASE WHEN r.weight_kg/r.bags > 35 THEN r.weight_kg ELSE 0 END)::numeric AS over35
    FROM mayavi_other_country_rows r
    JOIN mayavi_other_country_uploads u ON u.id=r.upload_id
    WHERE u.id IN (SELECT DISTINCT ON(flow,report_month) id FROM mayavi_other_country_uploads
      WHERE ready=true ORDER BY flow,report_month,created_at DESC,id DESC)
      AND u.flow=${flow} AND (${month}='ALL' OR u.report_month=${month})
      AND (${country}='ALL' OR r.country=${country})
    GROUP BY LOWER(TRIM(r.courier_name))
    ORDER BY total_weight DESC, courier_name ASC`;
  return rows.map(r=>{
    const totalWeight=Number(r.total_weight),totalBags=Number(r.total_bags);
    return {courierName:r.courier_name,entries:Number(r.entries),totalWeight:round(totalWeight),
      totalBags,avgBagKg:totalBags?round(totalWeight/totalBags):0,
      under30:round(r.under30),from30To35:round(r.from30to35),over35:round(r.over35)};
  });
}
async function countriesFor(sql,flow,month){
  const rows=await sql`SELECT DISTINCT r.country FROM mayavi_other_country_rows r
    JOIN mayavi_other_country_uploads u ON u.id=r.upload_id
    WHERE u.id IN (SELECT DISTINCT ON(flow,report_month) id FROM mayavi_other_country_uploads
      WHERE ready=true ORDER BY flow,report_month,created_at DESC,id DESC)
    AND u.flow=${flow} AND (${month}='ALL' OR u.report_month=${month})
    ORDER BY r.country ASC`;
  return rows.map(row=>row.country);
}
function overall(rows=[]){
  const total={entries:0,totalWeight:0,totalBags:0,under30:0,from30To35:0,over35:0,avgBagKg:0,couriers:rows.length};
  for(const row of rows)for(const key of ['entries','totalWeight','totalBags','under30','from30To35','over35'])total[key]+=Number(row[key]||0);
  for(const key of ['totalWeight','under30','from30To35','over35'])total[key]=round(total[key]);
  total.avgBagKg=total.totalBags?round(total.totalWeight/total.totalBags):0;
  return total;
}
function excelResponse(buffer,name){
  return new Response(buffer,{status:200,headers:{
    'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition':'attachment; filename="'+safeFileName(name)+'"',
    'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'
  }});
}
function sheetStyle(sheet){
  sheet.views=[{state:'frozen',ySplit:1}];
  sheet.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};
  sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF1B3A64'}};
  sheet.autoFilter={from:{row:1,column:1},to:{row:sheet.rowCount,column:sheet.columnCount}};
  for(let i=1;i<=sheet.columnCount;i++)sheet.getColumn(i).width=i===1?27:18;
}
async function summaryFile(sql,flow,month,country){
  const rows=await breakdown(sql,flow,month,country);
  if(!rows.length)return respond({ok:false,error:'No saved data for this selection.'},404);
  const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('Courier Summary');
  sheet.addRow(['Courier Name','Total Load (kg)','Average kg / bag',
    'Below 30 kg - Load (kg)','30-35 kg - Load (kg)','Above 35 kg - Load (kg)']);
  for(const row of rows)sheet.addRow([row.courierName,row.totalWeight,row.avgBagKg,
    row.under30,row.from30To35,row.over35]);
  const totals=overall(rows);
  sheet.addRow(['GRAND TOTAL',totals.totalWeight,totals.avgBagKg,
    totals.under30,totals.from30To35,totals.over35]);
  sheetStyle(sheet);
  const note=book.addWorksheet('Method');
  note.addRow(['Analysis','Other Countries - '+flow]);
  note.addRow(['Month',month==='ALL'?'All saved months':month]);
  note.addRow(['Country',country==='ALL'?'All countries':country]);
  note.addRow(['Source','Latest successfully uploaded Excel per flow/month']);
  note.addRow(['Order','Courier with highest total weight (kg) appears first']);
  note.addRow(['Average kg/bag','Total Load / Total Bags (weighted average)']);
  note.addRow(['Below 30','Shipment weight where shipment weight / bags is below 30']);
  note.addRow(['30-35','Shipment weight where average is >=30 and <=35']);
  note.addRow(['Above 35','Shipment weight where average is >35']);
  return excelResponse(await book.xlsx.writeBuffer(),`Mayavi_${flow}_Courier_Summary_${month}.xlsx`);
}
async function detailsFile(sql,flow,month,country){
  const rows=await sql`SELECT u.report_month,r.courier_name,r.country,r.weight_kg,r.bags,
    r.sheet_name,r.source_row FROM mayavi_other_country_rows r
    JOIN mayavi_other_country_uploads u ON u.id=r.upload_id
    WHERE u.id IN (SELECT DISTINCT ON(flow,report_month) id FROM mayavi_other_country_uploads
      WHERE ready=true ORDER BY flow,report_month,created_at DESC,id DESC)
    AND u.flow=${flow} AND (${month}='ALL' OR u.report_month=${month})
    AND (${country}='ALL' OR r.country=${country})
    ORDER BY u.report_month DESC,r.id ASC LIMIT 100001`;
  if(!rows.length)return respond({ok:false,error:'No saved data for this selection.'},404);
  if(rows.length>100000)return respond({ok:false,error:'Please choose one month to export all records without truncation.'},422);
  const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('All Entries');
  sheet.addRow(['Month','Courier Name','Country','Weight (kg)','No. of Bags','Average kg / bag','Weight Category','Source Sheet','Excel Row']);
  for(const r of rows){
    const weight=Number(r.weight_kg),bags=Number(r.bags),avg=weight/bags;
    sheet.addRow([r.report_month,r.courier_name,r.country,weight,bags,round(avg),
      avg<30?'Below 30':avg<=35?'30 to 35':'Above 35',r.sheet_name,r.source_row]);
  }
  sheetStyle(sheet);sheet.getColumn(8).width=25;
  return excelResponse(await book.xlsx.writeBuffer(),`Mayavi_${flow}_All_Entries_${month}.xlsx`);
}
export async function GET(request){
  try{
    const sql=database(),auth=await authorized(request,sql);
    if(auth.error)return respond({ok:false,error:auth.error},auth.status);
    await ensureTables(sql);
    const url=new URL(request.url),flow=flowValue(url.searchParams.get('flow')||'IMPORT');
    const month=url.searchParams.get('month')||'ALL';
    const country=String(url.searchParams.get('country')||'ALL').slice(0,120);
    const download=url.searchParams.get('download')||'';
    if(!flow||!validMonth(month))return respond({ok:false,error:'Choose valid Import/Export and month.'},400);
    if(download==='summary')return summaryFile(sql,flow,month,country);
    if(download==='details')return detailsFile(sql,flow,month,country);
    if(download==='original'){
      if(month==='ALL')return respond({ok:false,error:'Select a month to download the saved original Excel.'},400);
      const data=await sql`SELECT file_name,encode(file_bytes,'base64') AS content FROM mayavi_other_country_uploads
        WHERE ready=true AND flow=${flow} AND report_month=${month}
        ORDER BY created_at DESC,id DESC LIMIT 1`;
      if(!data.length)return respond({ok:false,error:'Original Excel not found for that month.'},404);
      return excelResponse(Buffer.from(data[0].content,'base64'),data[0].file_name);
    }
    const [files,rows,countries]=await Promise.all([activeFiles(sql),breakdown(sql,flow,month,country),countriesFor(sql,flow,month)]);
    return respond({ok:true,flow,month,country,files:files.map(f=>({
      id:f.id,flow:f.flow,month:f.report_month,fileName:f.file_name,
      sheets:f.sheets,rows:Number(f.parsed_rows),skipped:Number(f.skipped_rows),uploadedAt:f.created_at
    })),months:[...new Set(files.filter(f=>f.flow===flow).map(f=>f.report_month))].sort().reverse(),
    countries,rows,totals:overall(rows)});
  }catch(e){console.error('country_analysis_get',e?.message);
    return respond({ok:false,error:'Unable to load Country Analysis. '+(e?.message||'')},503);}
}
export async function POST(request){
  let uploadId=null,sql=null;
  try{
    sql=database();
    const auth=await authorized(request,sql);
    if(auth.error)return respond({ok:false,error:auth.error},auth.status);
    const form=await request.formData(),flow=flowValue(form.get('flow')),month=monthValue(form.get('month'));
    const file=form.get('file');
    if(!flow||!month)return respond({ok:false,error:'Choose Import/Export and a valid report month.'},400);
    if(!file||typeof file.arrayBuffer!=='function')return respond({ok:false,error:'Select an Excel workbook.'},400);
    if(!/\.xlsx$/i.test(file.name||''))return respond({ok:false,error:'Please upload an .xlsx file (not .xls or .csv).'},400);
    if(!file.size||file.size>MAX_UPLOAD_BYTES)return respond({ok:false,error:'File must be below 3 MB. Divide large data into monthly workbooks.'},413);
    const bytes=Buffer.from(await file.arrayBuffer());
    const workbook=new ExcelJS.Workbook();
    try{await workbook.xlsx.load(bytes);}catch{return respond({ok:false,error:'Could not open this .xlsx workbook. Check that it is a valid Excel file.'},400);}
    let mapping={};try{mapping=JSON.parse(String(form.get('mapping')||'{}'));}catch{}
    const extracted=parseCountryWorkbook(workbook,mapping);
    await ensureTables(sql);
    const sha=createHash('sha256').update(bytes).digest('hex');
    const same=await sql`SELECT id FROM mayavi_other_country_uploads
      WHERE flow=${flow} AND report_month=${month} AND file_sha256=${sha} AND ready=true LIMIT 1`;
    if(same.length)return respond({ok:true,duplicate:true,message:'This workbook is already saved for this month. Nothing was duplicated.',
      rows:extracted.rows.length,skipped:extracted.skipped});
    uploadId=randomUUID();
    await sql`INSERT INTO mayavi_other_country_uploads
      (id,flow,report_month,file_name,file_bytes,file_sha256,sheets,parsed_rows,skipped_rows,uploaded_by)
      VALUES (${uploadId}::uuid,${flow},${month},${safeFileName(file.name)},
      decode(${bytes.toString('base64')},'base64'),${sha},${extracted.sheetNames.join(', ')},
      ${extracted.rows.length},${extracted.skipped},${auth.session.username})`;
    for(let i=0;i<extracted.rows.length;i+=250){
      const records=extracted.rows.slice(i,i+250).map(row=>({
        courier_name:row.courierName,country:row.country,weight_kg:row.weightKg,
        bags:row.bags,sheet_name:row.sheet,source_row:row.rowNumber
      }));
      await sql`INSERT INTO mayavi_other_country_rows
        (upload_id,courier_name,country,weight_kg,bags,sheet_name,source_row)
        SELECT ${uploadId}::uuid,x.courier_name,x.country,x.weight_kg,x.bags,x.sheet_name,x.source_row
        FROM jsonb_to_recordset(${JSON.stringify(records)}::jsonb)
        AS x(courier_name text,country text,weight_kg numeric,bags integer,sheet_name text,source_row integer)`;
    }
    await sql`UPDATE mayavi_other_country_uploads SET ready=true WHERE id=${uploadId}::uuid`;
    return respond({ok:true,rows:extracted.rows.length,skipped:extracted.skipped,
      sheetNames:extracted.sheetNames,ignoredSheets:extracted.ignoredSheets,
      message:'Workbook saved permanently. This is now the active '+flow+' workbook for '+month+'.'});
  }catch(e){
    if(uploadId&&sql){try{await sql`DELETE FROM mayavi_other_country_uploads WHERE id=${uploadId}::uuid AND ready=false`;}catch{}}
    console.error('country_analysis_upload',e?.message);
    const clientError=/No valid rows|Required|more than 40,000/i.test(String(e?.message||''));
    return respond({ok:false,error:e?.message||'Excel upload failed.'},clientError?422:503);
  }
}
