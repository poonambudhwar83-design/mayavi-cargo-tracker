import { randomUUID, createHash } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import ExcelJS from 'exceljs';
import { readSession } from '../../../lib/mayaviAuth.js';
import { parseCountryWorkbook, buildCourierSectorPivot } from '../../../lib/countryLoadAnalysis.js';
import { createCourierAnalysisPdf } from '../../../lib/courierAnalysisPdf.js';

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
  await sql`ALTER TABLE mayavi_other_country_rows ADD COLUMN IF NOT EXISTS shipment_month VARCHAR(7) NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE mayavi_other_country_rows ADD COLUMN IF NOT EXISTS shipment_date DATE`;
  await sql`CREATE INDEX IF NOT EXISTS mayavi_other_country_rows_shipment_month_idx
    ON mayavi_other_country_rows(shipment_month,upload_id)`;

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
// One-time, idempotent backfill for previously uploaded 2026 Excel workbooks.
// Original Excel bytes and saved rows are retained. The Excel FLT DATE controls
// the report month; only an unparseable/missing date falls back to upload month.
export async function backfillSavedShipmentDates(sql){
  const pending=await sql`SELECT u.id,u.report_month,
    encode(u.file_bytes,'base64') AS workbook_bytes
    FROM mayavi_other_country_uploads u WHERE u.ready=true
      AND EXISTS (SELECT 1 FROM mayavi_other_country_rows r
        WHERE r.upload_id=u.id AND r.shipment_month='')
    ORDER BY u.created_at ASC`;
  for(const item of pending){
    const workbook=new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(item.workbook_bytes,'base64'));
    const parsed=parseCountryWorkbook(workbook);
    // Rows already in the database are keyed by the original Excel sheet and
    // sheet row number. Do not insert/delete any existing cargo records here.
    const records=parsed.rows.map(row=>({
      sheet_name:row.sheet,source_row:row.rowNumber,
      shipment_month:row.shipmentMonth||item.report_month,
      shipment_date:row.shipmentDate||null
    }));
    for(let i=0;i<records.length;i+=600){
      const batch=records.slice(i,i+600);
      await sql`UPDATE mayavi_other_country_rows AS r
        SET shipment_month=x.shipment_month,
          shipment_date=CAST(x.shipment_date AS DATE)
        FROM jsonb_to_recordset(${JSON.stringify(batch)}::jsonb)
          AS x(sheet_name text,source_row integer,shipment_month varchar(7),shipment_date text)
        WHERE r.upload_id=${item.id}::uuid
          AND r.shipment_month=''
          AND r.sheet_name=x.sheet_name AND r.source_row=x.source_row`;
    }
    // Any legacy rows with unrecognized mapping remain under their original
    // upload month rather than disappearing from monthly reports.
    await sql`UPDATE mayavi_other_country_rows SET shipment_month=${item.report_month}
      WHERE upload_id=${item.id}::uuid AND shipment_month=''`;
  }
}
async function savedMonths(sql,flow){
  const rows=await sql`SELECT DISTINCT COALESCE(NULLIF(r.shipment_month,''),u.report_month) AS month
    FROM mayavi_other_country_rows r JOIN mayavi_other_country_uploads u ON u.id=r.upload_id
    WHERE u.id IN (SELECT DISTINCT ON(flow,report_month) id FROM mayavi_other_country_uploads
      WHERE ready=true ORDER BY flow,report_month,created_at DESC,id DESC)
      AND u.flow=${flow} ORDER BY month DESC`;
  return rows.map(row=>row.month);
}
async function workbookCoverage(sql){
  const rows=await sql`SELECT r.upload_id,ARRAY_AGG(DISTINCT COALESCE(NULLIF(r.shipment_month,''),u.report_month)
    ORDER BY COALESCE(NULLIF(r.shipment_month,''),u.report_month)) AS months
    FROM mayavi_other_country_rows r JOIN mayavi_other_country_uploads u ON u.id=r.upload_id
    WHERE u.id IN (SELECT DISTINCT ON(flow,report_month) id FROM mayavi_other_country_uploads
      WHERE ready=true ORDER BY flow,report_month,created_at DESC,id DESC)
    GROUP BY r.upload_id`;
  return Object.fromEntries(rows.map(row=>[row.upload_id,row.months]));
}

async function breakdown(sql,flow,month,country){
  // Sum WEIGHT for each shipment row's average (weight / bags), never sum averages.
  const rows=await sql`SELECT MIN(r.courier_name) AS courier_name,
    COUNT(*)::int AS entries, SUM(r.bags)::bigint AS total_bags,
    SUM(r.weight_kg)::numeric AS total_weight,
    SUM(CASE WHEN r.weight_kg/r.bags < 30 THEN r.weight_kg ELSE 0 END)::numeric AS under30,
    SUM(CASE WHEN r.weight_kg/r.bags >= 30 AND r.weight_kg/r.bags < 35 THEN r.weight_kg ELSE 0 END)::numeric AS from30to35,
    SUM(CASE WHEN r.weight_kg/r.bags >= 35 AND r.weight_kg/r.bags <= 40 THEN r.weight_kg ELSE 0 END)::numeric AS from35to40,
    SUM(CASE WHEN r.weight_kg/r.bags > 40 THEN r.weight_kg ELSE 0 END)::numeric AS over40
    FROM mayavi_other_country_rows r
    JOIN mayavi_other_country_uploads u ON u.id=r.upload_id
    WHERE u.id IN (SELECT DISTINCT ON(flow,report_month) id FROM mayavi_other_country_uploads
      WHERE ready=true ORDER BY flow,report_month,created_at DESC,id DESC)
      AND u.flow=${flow} AND (${month}='ALL' OR COALESCE(NULLIF(r.shipment_month,''),u.report_month)=${month})
      AND (${country}='ALL' OR r.country=${country})
    GROUP BY LOWER(TRIM(r.courier_name))
    ORDER BY total_weight DESC, courier_name ASC`;
  return rows.map(r=>{
    const totalWeight=Number(r.total_weight),totalBags=Number(r.total_bags);
    return {courierName:r.courier_name,entries:Number(r.entries),totalWeight:round(totalWeight),
      totalBags,avgBagKg:totalBags?round(totalWeight/totalBags):0,
      under30:round(r.under30),from30To35:round(r.from30to35),from35To40:round(r.from35to40),over40:round(r.over40)};
  });
}
async function countriesFor(sql,flow,month){
  const rows=await sql`SELECT DISTINCT r.country FROM mayavi_other_country_rows r
    JOIN mayavi_other_country_uploads u ON u.id=r.upload_id
    WHERE u.id IN (SELECT DISTINCT ON(flow,report_month) id FROM mayavi_other_country_uploads
      WHERE ready=true ORDER BY flow,report_month,created_at DESC,id DESC)
    AND u.flow=${flow} AND (${month}='ALL' OR COALESCE(NULLIF(r.shipment_month,''),u.report_month)=${month})
    ORDER BY r.country ASC`;
  return rows.map(row=>row.country);
}
async function sectorBreakdown(sql,flow,month,country){
  // SQL aggregates only the active workbook per flow/month and groups by
  // actual uploaded Origin. Existing saved sheets remain valid—no reupload.
  const groups=await sql`SELECT MIN(r.courier_name) AS courier_name,
    r.country AS sector, SUM(r.weight_kg)::numeric AS weight_kg
    FROM mayavi_other_country_rows r
    JOIN mayavi_other_country_uploads u ON u.id=r.upload_id
    WHERE u.id IN (SELECT DISTINCT ON(flow,report_month) id FROM mayavi_other_country_uploads
      WHERE ready=true ORDER BY flow,report_month,created_at DESC,id DESC)
    AND u.flow=${flow} AND (${month}='ALL' OR COALESCE(NULLIF(r.shipment_month,''),u.report_month)=${month})
    AND (${country}='ALL' OR r.country=${country})
    GROUP BY LOWER(TRIM(r.courier_name)),r.country`;
  return buildCourierSectorPivot(groups.map(row=>({
    courierName:row.courier_name,sector:row.sector,weightKg:Number(row.weight_kg)
  })));
}
function addSectorLoads(rows,pivot){
  return rows.map(row=>({...row,
    sectorLoads:pivot.byCourier[row.courierName.trim().toLocaleLowerCase('en')]||{}}));
}
function overall(rows=[]){
  const total={entries:0,totalWeight:0,totalBags:0,under30:0,from30To35:0,from35To40:0,over40:0,avgBagKg:0,couriers:rows.length};
  for(const row of rows)for(const key of ['entries','totalWeight','totalBags','under30','from30To35','from35To40','over40'])total[key]+=Number(row[key]||0);
  for(const key of ['totalWeight','under30','from30To35','from35To40','over40'])total[key]=round(total[key]);
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
  const [rows,pivot]=await Promise.all([
    breakdown(sql,flow,month,country),sectorBreakdown(sql,flow,month,country)
  ]);
  if(!rows.length)return respond({ok:false,error:'No saved data for this selection.'},404);
  const fullRows=addSectorLoads(rows,pivot);
  const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('Courier Summary');
  sheet.addRow(['Courier Name','Total Load (kg)','35–40 kg - Load (kg)','More than 40 kg - Load (kg)',
    ...pivot.sectors.map(s=>s.name+' (kg)'),'Average kg / bag']);
  for(const row of fullRows)sheet.addRow([row.courierName,row.totalWeight,row.from35To40,row.over40,
    ...pivot.sectors.map(sector=>row.sectorLoads[sector.name]||0),row.avgBagKg]);
  const totals=overall(rows);
  sheet.addRow(['GRAND TOTAL',totals.totalWeight,totals.from35To40,totals.over40,
    ...pivot.sectors.map(sector=>sector.totalWeight),totals.avgBagKg]);
  sheetStyle(sheet);
  const note=book.addWorksheet('Method');
  note.addRow(['Analysis','Other Courier Summary - '+flow]);
  note.addRow(['Month',month==='ALL'?'All saved months':month]);
  note.addRow(['Origin / Sector',country==='ALL'?'All origins':country]);
  note.addRow(['Sector Columns','Each origin column shows total uploaded weight for that courier from that origin.']);
  note.addRow(['Source','Latest successfully uploaded Excel per flow/month']);
  note.addRow(['Order','Courier with highest total weight (kg) appears first']);
  note.addRow(['Average kg/bag','Total Load / Total Bags (weighted average)']);
  note.addRow(['35–40 kg','Sum of shipment weight where weight divided by bags is at least 35 and at most 40 kg.']);
  note.addRow(['More than 40 kg','Sum of weights where shipment weight divided by bags is strictly more than 40 kg.']);
  return excelResponse(await book.xlsx.writeBuffer(),`Mayavi_${flow}_Courier_Summary_${month}.xlsx`);
}
async function pdfSummaryFile(sql,flow,month,country){
  const [rows,pivot]=await Promise.all([
    breakdown(sql,flow,month,country),sectorBreakdown(sql,flow,month,country)
  ]);
  if(!rows.length)return respond({ok:false,error:'No saved data for this selected month and origin.'},404);
  const pdf=createCourierAnalysisPdf({
    flow,month,country,rows:addSectorLoads(rows,pivot),sectors:pivot.sectors,totals:overall(rows)
  });
  const safeCountry=country==='ALL'?'All_Origins':safeFileName(country).replace(/[^A-Za-z0-9_-]/g,'_');
  return new Response(pdf,{status:200,headers:{
    'Content-Type':'application/pdf',
    'Content-Disposition':'attachment; filename="Mayavi_'+flow+'_Courier_Summary_'+month+'_'+safeCountry+'.pdf"',
    'Content-Length':String(pdf.length),
    'Cache-Control':'private, no-store',
    'X-Content-Type-Options':'nosniff'
  }});
}
async function detailsFile(sql,flow,month,country){
  const rows=await sql`SELECT COALESCE(NULLIF(r.shipment_month,''),u.report_month) AS report_month,r.shipment_date,
    r.courier_name,r.country,r.weight_kg,r.bags,r.sheet_name,r.source_row FROM mayavi_other_country_rows r
    JOIN mayavi_other_country_uploads u ON u.id=r.upload_id
    WHERE u.id IN (SELECT DISTINCT ON(flow,report_month) id FROM mayavi_other_country_uploads
      WHERE ready=true ORDER BY flow,report_month,created_at DESC,id DESC)
    AND u.flow=${flow} AND (${month}='ALL' OR COALESCE(NULLIF(r.shipment_month,''),u.report_month)=${month})
    AND (${country}='ALL' OR r.country=${country})
    ORDER BY u.report_month DESC,r.id ASC LIMIT 100001`;
  if(!rows.length)return respond({ok:false,error:'No saved data for this selection.'},404);
  if(rows.length>100000)return respond({ok:false,error:'Please choose one month to export all records without truncation.'},422);
  const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('All Entries');
  sheet.addRow(['Flight/Load Date','Month','Courier Name','Origin / Sector','Weight (kg)','No. of Bags','Average kg / bag','Weight Category','Source Sheet','Excel Row']);
  for(const r of rows){
    const weight=Number(r.weight_kg),bags=Number(r.bags),avg=weight/bags;
    sheet.addRow([r.shipment_date?r.shipment_date.toISOString?.().slice(0,10)||String(r.shipment_date):'',r.report_month,r.courier_name,r.country,weight,bags,round(avg),
      avg<30?'Below 30':avg<35?'30 to 35':avg<=40?'35 to 40':'Above 40',r.sheet_name,r.source_row]);
  }
  sheetStyle(sheet);sheet.getColumn(9).width=25;
  return excelResponse(await book.xlsx.writeBuffer(),`Mayavi_${flow}_All_Entries_${month}.xlsx`);
}
export async function GET(request){
  try{
    const sql=database(),auth=await authorized(request,sql);
    if(auth.error)return respond({ok:false,error:auth.error},auth.status);
    await ensureTables(sql);
    await backfillSavedShipmentDates(sql);
    const url=new URL(request.url),flow=flowValue(url.searchParams.get('flow')||'IMPORT');
    const requestedMonth=url.searchParams.get('month')||'LATEST';
    const country=String(url.searchParams.get('country')||'ALL').slice(0,120);
    const download=url.searchParams.get('download')||'';
    if(!flow||!(requestedMonth==='LATEST'||monthValue(requestedMonth)))
      return respond({ok:false,error:'Choose a saved report month.'},400);
    // Pick the most recently saved month for this flow; never aggregate all
    // months implicitly. Import and Export have independent month selections.
    const files=await activeFiles(sql);
    const months=await savedMonths(sql,flow);
    const month=requestedMonth==='LATEST'?(months[0]||''):requestedMonth;
    if(!month){
      if(download)return respond({ok:false,error:'No saved monthly workbook found for this selection.'},404);
      return respond({ok:true,flow,month:'LATEST',country,files:[],months,countries:[],sectors:[],rows:[],totals:overall([])});
    }
    if(download==='summary')return summaryFile(sql,flow,month,country);
    if(download==='pdf')return pdfSummaryFile(sql,flow,month,country);
    if(download==='details')return detailsFile(sql,flow,month,country);
    if(download==='original'){
      if(month==='ALL')return respond({ok:false,error:'Select a month to download the saved original Excel.'},400);
      // A November shipment may belong to an Excel workbook uploaded under
      // October. Offer the original source workbook containing that date.
      const data=await sql`SELECT u.file_name,encode(u.file_bytes,'base64') AS content
        FROM mayavi_other_country_uploads u
        JOIN mayavi_other_country_rows r ON r.upload_id=u.id
        WHERE u.ready=true AND u.flow=${flow}
          AND COALESCE(NULLIF(r.shipment_month,''),u.report_month)=${month}
          AND u.id IN (SELECT DISTINCT ON(flow,report_month) id FROM mayavi_other_country_uploads
            WHERE ready=true ORDER BY flow,report_month,created_at DESC,id DESC)
        GROUP BY u.id
        ORDER BY COUNT(*) DESC,MAX(u.created_at) DESC LIMIT 1`;
      if(!data.length)return respond({ok:false,error:'Original Excel not found for that month.'},404);
      return excelResponse(Buffer.from(data[0].content,'base64'),data[0].file_name);
    }
    const [rows,countries,pivot,coverage]=await Promise.all([breakdown(sql,flow,month,country),countriesFor(sql,flow,month),sectorBreakdown(sql,flow,month,country),workbookCoverage(sql)]);
    return respond({ok:true,flow,month,country,files:files.map(f=>({
      id:f.id,flow:f.flow,month:f.report_month,fileName:f.file_name,
      sheets:f.sheets,rows:Number(f.parsed_rows),skipped:Number(f.skipped_rows),coveredMonths:coverage[f.id]||[],uploadedAt:f.created_at
    })),months,
    countries,sectors:pivot.sectors,rows:addSectorLoads(rows,pivot),totals:overall(rows)});
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
        bags:row.bags,sheet_name:row.sheet,source_row:row.rowNumber,
        shipment_month:row.shipmentMonth||month,shipment_date:row.shipmentDate||null
      }));
      await sql`INSERT INTO mayavi_other_country_rows
        (upload_id,courier_name,country,weight_kg,bags,sheet_name,source_row,shipment_month,shipment_date)
        SELECT ${uploadId}::uuid,x.courier_name,x.country,x.weight_kg,x.bags,x.sheet_name,x.source_row,
          x.shipment_month,CAST(x.shipment_date AS DATE)
        FROM jsonb_to_recordset(${JSON.stringify(records)}::jsonb)
        AS x(courier_name text,country text,weight_kg numeric,bags integer,sheet_name text,source_row integer,shipment_month varchar(7),shipment_date text)`;
    }
    await sql`UPDATE mayavi_other_country_uploads SET ready=true WHERE id=${uploadId}::uuid`;
    return respond({ok:true,rows:extracted.rows.length,skipped:extracted.skipped,
      sheetNames:extracted.sheetNames,ignoredSheets:extracted.ignoredSheets,
      message:'Workbook saved. Courier load is grouped by each Excel flight date; upload month '+month+' is only the source workbook label.'});
  }catch(e){
    if(uploadId&&sql){try{await sql`DELETE FROM mayavi_other_country_uploads WHERE id=${uploadId}::uuid AND ready=false`;}catch{}}
    console.error('country_analysis_upload',e?.message);
    const clientError=/No valid rows|Required|more than 40,000/i.test(String(e?.message||''));
    return respond({ok:false,error:e?.message||'Excel upload failed.'},clientError?422:503);
  }
}
