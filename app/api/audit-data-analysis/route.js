import {randomUUID,createHash} from 'node:crypto';
import {neon} from '@neondatabase/serverless';
import ExcelJS from 'exceljs';
import {readSession} from '../../../lib/mayaviAuth.js';
import {listAuditSheets,parseAuditWorkbook,summarizeAuditRows} from '../../../lib/auditDataAnalysis.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const MAX_FILE=5*1024*1024;
function json(value,status=200){return Response.json(value,{status,headers:{'Cache-Control':'no-store, private'}});}
function db(){
 const url=process.env.DATABASE_URL||process.env.POSTGRES_URL||process.env.NEON_DATABASE_URL||process.env.DATABASE_URL_UNPOOLED;
 if(!url)throw Error('Shared Mayavi database is not configured.');
 return neon(url);
}
function authorized(request){return readSession(request)?.role==='admin';}
async function ensure(sql){
 await sql.query("CREATE TABLE IF NOT EXISTS mayavi_audit_analysis_uploads (id UUID PRIMARY KEY,file_name TEXT NOT NULL,file_sha256 TEXT NOT NULL,sheet_name TEXT NOT NULL,header_row INTEGER NOT NULL,mapping JSONB NOT NULL DEFAULT '{}'::jsonb,row_count INTEGER NOT NULL DEFAULT 0,skipped INTEGER NOT NULL DEFAULT 0,duplicates INTEGER NOT NULL DEFAULT 0,uploaded_by TEXT NOT NULL,ready BOOLEAN NOT NULL DEFAULT false,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
 await sql.query("CREATE TABLE IF NOT EXISTS mayavi_audit_analysis_rows (id BIGSERIAL PRIMARY KEY,upload_id UUID NOT NULL REFERENCES mayavi_audit_analysis_uploads(id) ON DELETE CASCADE,source_row INTEGER NOT NULL,mawb TEXT NOT NULL,weight NUMERIC(16,3),bags INTEGER,gc TEXT NOT NULL DEFAULT '',t TEXT NOT NULL DEFAULT '',dt TEXT NOT NULL DEFAULT '',d TEXT NOT NULL DEFAULT '',xray TEXT NOT NULL DEFAULT '',shift TEXT NOT NULL DEFAULT '',loader TEXT NOT NULL DEFAULT '',co_loader TEXT NOT NULL DEFAULT '',remarks TEXT NOT NULL DEFAULT '')");
 await sql.query("ALTER TABLE mayavi_audit_analysis_rows ADD COLUMN IF NOT EXISTS client_name TEXT NOT NULL DEFAULT ''");
 await sql.query("CREATE INDEX IF NOT EXISTS mayavi_audit_rows_upload_idx ON mayavi_audit_analysis_rows(upload_id,source_row)");
}
function fileName(name){return String(name||'audit.xlsx').replace(/[/\\<>:"|?*\u0000-\u001F]+/g,'_').slice(0,150);}
function formatUpload(r){return {id:r.id,fileName:r.file_name,sheetName:r.sheet_name,rows:Number(r.row_count),
 skipped:Number(r.skipped),duplicates:Number(r.duplicates),uploadedBy:r.uploaded_by,createdAt:r.created_at};}
export async function GET(request){
 if(!authorized(request))return json({ok:false,error:'Admin authorization required.'},403);
 try{
  const sql=db();await ensure(sql);
  const uploads=await sql.query("SELECT id,file_name,sheet_name,row_count,skipped,duplicates,uploaded_by,created_at FROM mayavi_audit_analysis_uploads WHERE ready=true ORDER BY created_at DESC,id DESC LIMIT 100");
  const chosen=new URL(request.url).searchParams.get('upload')||uploads[0]?.id||null;
  const selected=uploads.find(x=>x.id===chosen)||uploads[0];
  const rows=selected?await sql.query("SELECT source_row,mawb,weight,bags,client_name,gc,t,dt,d,xray,shift,loader,co_loader,remarks FROM mayavi_audit_analysis_rows WHERE upload_id=$1::uuid ORDER BY source_row LIMIT 10000",[selected.id]):[];
  const prepared=rows.map(x=>({sourceRow:Number(x.source_row),mawb:x.mawb,weight:x.weight===null?null:Number(x.weight),
   bags:x.bags===null?null:Number(x.bags),clientName:x.client_name||'',gc:x.gc,t:x.t,dt:x.dt,d:x.d,xray:x.xray,shift:x.shift,loader:x.loader,coLoader:x.co_loader,remarks:x.remarks}));
  return json({ok:true,uploads:uploads.map(formatUpload),selectedId:selected?.id||null,rows:prepared,totals:summarizeAuditRows(prepared)});
 }catch(e){console.error('audit_data_get',e?.message);return json({ok:false,error:'Could not load saved Audit analysis.'},503);}
}
export async function POST(request){
 if(!authorized(request))return json({ok:false,error:'Admin authorization required.'},403);
 let uploadId=null,sql=null;
 try{
  const form=await request.formData();
  const action=String(form.get('action')||'preview');
  if(!['preview','save'].includes(action))return json({ok:false,error:'Invalid upload action.'},400);
  const file=form.get('file');
  if(!file||typeof file.arrayBuffer!=='function')return json({ok:false,error:'Excel file select karein.'},400);
  if(!/\.xlsx$/i.test(file.name||''))return json({ok:false,error:'Only .xlsx Excel files supported.'},400);
  if(file.size<=0||file.size>MAX_FILE)return json({ok:false,error:'Excel file 5 MB se chhoti honi chahiye.'},413);
  let mapping={};
  try{const supplied=JSON.parse(String(form.get('mapping')||'{}'));if(supplied&&typeof supplied==='object'&&!Array.isArray(supplied))mapping=supplied;}catch{return json({ok:false,error:'Column mapping could not be read.'},400);}
  const sheetName=String(form.get('sheetName')||'').slice(0,200);
  const headerRow=Number(form.get('headerRow')||0);
  const bytes=Buffer.from(await file.arrayBuffer()),wb=new ExcelJS.Workbook();
  try{await wb.xlsx.load(bytes);}catch{return json({ok:false,error:'This Excel workbook cannot be opened. Please use .xlsx.'},400);}
  const sheets=listAuditSheets(wb);
  if(!sheets.length)return json({ok:false,error:'Excel mein koi data sheet nahi mili.'},422);
  if(action==='preview'){
   try{
    const parsed=parseAuditWorkbook(wb,{sheetName,headerRow,mapping});
    return json({ok:true,sheets,selectedSheet:parsed.sheetName,headerRow:parsed.headerRow,
      mapping:parsed.mapping,preview:parsed.rows.slice(0,15),totals:summarizeAuditRows(parsed.rows),
      skipped:parsed.skipped,duplicates:parsed.duplicates});
   }catch(e){
    return json({ok:true,sheets,selectedSheet:sheetName||sheets[0].name,
      headerRow:headerRow||sheets[0].headerRow,mapping:Object.keys(mapping).length?mapping:sheets[0].mapping,
      preview:[],warning:e?.message||'Choose the correct Excel columns to preview.'});
   }
  }
  const parsed=parseAuditWorkbook(wb,{sheetName,headerRow,mapping});
  sql=db();await ensure(sql);
  const sha=createHash('sha256').update(bytes).digest('hex');
  const normalizedMapping=JSON.stringify(parsed.mapping);
  const existing=await sql.query("SELECT id FROM mayavi_audit_analysis_uploads WHERE ready=true AND file_sha256=$1 AND sheet_name=$2 AND mapping=$3::jsonb LIMIT 1",[sha,parsed.sheetName,normalizedMapping]);
  if(existing.length)return json({ok:true,duplicate:true,uploadId:existing[0].id,
   message:'Same Excel and column selection already saved; no duplicate data created.'});
  uploadId=randomUUID();
  const user=readSession(request);
  await sql.query("INSERT INTO mayavi_audit_analysis_uploads (id,file_name,file_sha256,sheet_name,header_row,mapping,row_count,skipped,duplicates,uploaded_by) VALUES ($1::uuid,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10)",
   [uploadId,fileName(file.name),sha,parsed.sheetName,parsed.headerRow,normalizedMapping,parsed.rows.length,parsed.skipped,parsed.duplicates,user.username]);
  for(let i=0;i<parsed.rows.length;i+=250){
   const rows=parsed.rows.slice(i,i+250).map(r=>({
    source_row:r.sourceRow,mawb:r.mawb,weight:r.weight,bags:r.bags,client_name:r.clientName,
    gc:r.gc,t:r.t,dt:r.dt,d:r.d,xray:r.xray,shift:r.shift,
    loader:r.loader,co_loader:r.coLoader,remarks:r.remarks
   }));
   await sql.query("INSERT INTO mayavi_audit_analysis_rows (upload_id,source_row,mawb,weight,bags,client_name,gc,t,dt,d,xray,shift,loader,co_loader,remarks) SELECT $1::uuid,x.source_row,x.mawb,x.weight,x.bags,x.client_name,x.gc,x.t,x.dt,x.d,x.xray,x.shift,x.loader,x.co_loader,x.remarks FROM jsonb_to_recordset($2::jsonb) AS x(source_row integer,mawb text,weight numeric,bags integer,client_name text,gc text,t text,dt text,d text,xray text,shift text,loader text,co_loader text,remarks text)",[uploadId,JSON.stringify(rows)]);
  }
  await sql.query("UPDATE mayavi_audit_analysis_uploads SET ready=true WHERE id=$1::uuid",[uploadId]);
  return json({ok:true,uploadId,rows:parsed.rows.length,skipped:parsed.skipped,duplicates:parsed.duplicates,
   message:'Excel Audit data saved separately. Existing Export/Import Profit Sheets were not changed.'});
 }catch(e){
  if(uploadId&&sql){try{await sql.query("DELETE FROM mayavi_audit_analysis_uploads WHERE id=$1::uuid AND ready=false",[uploadId]);}catch{}}
  const client=/MAWB|mapping|Excel|records|column|header|sheet|10,000/i.test(String(e?.message||''));
  console.error('audit_data_upload',String(e?.message||'').slice(0,180));
  return json({ok:false,error:e?.message||'Could not analyze Excel file.'},client?422:503);
 }
}
