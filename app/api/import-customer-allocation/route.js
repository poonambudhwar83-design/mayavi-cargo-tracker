import {randomUUID} from 'node:crypto';
import ExcelJS from 'exceljs';
import {neon} from '@neondatabase/serverless';
import {readSession} from '../../../lib/mayaviAuth.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';

const reply=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
const authorized=request=>readSession(request)?.role==='admin';
function db(){
  const url=process.env.DATABASE_URL||process.env.POSTGRES_URL||process.env.NEON_DATABASE_URL||process.env.DATABASE_URL_UNPOOLED;
  if(!url)throw Error('Mayavi shared database is not configured.');
  return neon(url);
}
async function ensureTable(sql){
  await sql.query("CREATE TABLE IF NOT EXISTS mayavi_import_customer_batches (id UUID PRIMARY KEY, file_name TEXT NOT NULL, sheet_name TEXT NOT NULL DEFAULT '', data_rows JSONB NOT NULL DEFAULT '[]'::jsonb, row_count INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now())");
}
const maxFile=8*1024*1024;
function showCell(value){
  if(value===null||value===undefined)return '';
  if(value instanceof Date)return Number.isNaN(value.getTime())?'':value.toISOString().slice(0,10);
  if(typeof value==='object'){
    if('result' in value)return showCell(value.result);
    if('text' in value)return showCell(value.text);
    if(Array.isArray(value.richText))return value.richText.map(x=>x.text||'').join('');
    if('hyperlink' in value)return String(value.text||value.hyperlink||'');
    return '';
  }
  return String(value).trim();
}
function parseSheet(ws){
  const rows=[];
  const maxColumns=Math.min(Math.max(ws.columnCount||0,1),80);
  const maxRows=Math.min(ws.rowCount||0,7000);
  for(let n=1;n<=maxRows;n++){
    const row=ws.getRow(n),cells=[];
    for(let c=1;c<=maxColumns;c++)cells.push(showCell(row.getCell(c).value));
    if(cells.some(x=>x!==''))rows.push(cells);
  }
  if(!rows.length)return null;
  return {sheet:ws.name,rows};
}
export async function POST(request){
  if(!authorized(request))return reply({ok:false,error:'Admin login required.'},403);
  try{
    const form=await request.formData(),file=form.get('file');
    if(!file||typeof file.arrayBuffer!=='function')return reply({ok:false,error:'Choose an Excel .xlsx file.'},400);
    if(!/\.xlsx$/i.test(String(file.name||'')))return reply({ok:false,error:'Please save this workbook as .xlsx and upload again.'},400);
    if(file.size>maxFile)return reply({ok:false,error:'Excel file is above the 8 MB limit.'},413);
    const workbook=new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await file.arrayBuffer()));
    const sheets=workbook.worksheets.map(parseSheet).filter(Boolean);
    if(!sheets.length)return reply({ok:false,error:'No populated worksheets were found.'},400);
    return reply({ok:true,fileName:String(file.name||'Import customers.xlsx').slice(0,180),sheets});
  }catch(error){return reply({ok:false,error:'Excel could not be read: '+String(error.message||error).slice(0,250)},400)}
}
export async function GET(request){
  if(!authorized(request))return reply({ok:false,error:'Admin login required.'},403);
  try{
    const sql=db();await ensureTable(sql);
    const list=await sql.query("SELECT id::text,file_name,sheet_name,row_count,created_at,updated_at FROM mayavi_import_customer_batches ORDER BY updated_at DESC LIMIT 100");
    const id=new URL(request.url).searchParams.get('id')||list[0]?.id;
    const selected=id&&/^[0-9a-f-]{36}$/i.test(id)?await sql.query("SELECT id::text,file_name,sheet_name,data_rows FROM mayavi_import_customer_batches WHERE id=$1 LIMIT 1",[id]):[];
    return reply({ok:true,batches:list,batch:selected[0]||null});
  }catch(error){return reply({ok:false,error:String(error.message||error).slice(0,300)},500)}
}
export async function PUT(request){
  if(!authorized(request))return reply({ok:false,error:'Admin login required.'},403);
  try{
    const body=await request.json();
    if(!Array.isArray(body.rows)||body.rows.length>5000)return reply({ok:false,error:'Maximum 5,000 customer rows per upload.'},400);
    const allowed=['customerName','masterNo','flightDate','flightNo','eiaWeight','origin','duty','ut','freight','eici','customerBags','customerWeight','rate','description'];
    const clean=body.rows.map((row,i)=>{
      const x={id:String(row.id||i+1).slice(0,80)};
      for(const key of allowed)x[key]=String(row[key]??'').trim().slice(0,key==='description'?700:220);
      return x;
    });
    if(!clean.length)return reply({ok:false,error:'There are no customer rows to save.'},400);
    if(clean.some(x=>!x.masterNo||!x.customerName))return reply({ok:false,error:'Master No and Customer Name are required for every row.'},400);
    if(JSON.stringify(clean).length>5000000)return reply({ok:false,error:'Customer data is too large.'},413);
    const sql=db();await ensureTable(sql);
    const fileName=String(body.fileName||'Manual import').trim().slice(0,180);
    const sheetName=String(body.sheetName||'').trim().slice(0,100);
    const id=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(String(body.id||''))?body.id:randomUUID();
    // Save whole batch atomically; an existing batch is replaced only by its exact id.
    const saved=await sql.query("INSERT INTO mayavi_import_customer_batches(id,file_name,sheet_name,data_rows,row_count) VALUES($1,$2,$3,$4::jsonb,$5) ON CONFLICT(id) DO UPDATE SET file_name=EXCLUDED.file_name,sheet_name=EXCLUDED.sheet_name,data_rows=EXCLUDED.data_rows,row_count=EXCLUDED.row_count,updated_at=now() RETURNING id::text,updated_at",[id,fileName,sheetName,JSON.stringify(clean),clean.length]);
    return reply({ok:true,id:saved[0].id,updatedAt:saved[0].updated_at,rowCount:clean.length});
  }catch(error){return reply({ok:false,error:String(error.message||error).slice(0,300)},500)}
}
