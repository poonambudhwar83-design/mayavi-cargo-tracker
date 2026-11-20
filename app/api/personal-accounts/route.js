import {randomUUID} from 'node:crypto';
import ExcelJS from 'exceljs';
import {neon} from '@neondatabase/serverless';
import {readSession} from '../../../lib/mayaviAuth.js';
import {PERSONAL_ACCOUNT_FIELDS,PERSONAL_ACCOUNT_KEYS,numericAccountAmount,isValidAccountSaveRow} from '../../../lib/personalAccountsCore.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const reply=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
const authorized=request=>readSession(request)?.role==='admin';
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
function database(){
  const url=process.env.DATABASE_URL||process.env.POSTGRES_URL||process.env.NEON_DATABASE_URL||process.env.DATABASE_URL_UNPOOLED;
  if(!url)throw Error('Mayavi shared database is not configured.');
  return neon(url);
}
async function ensureTable(sql){
  await sql.query("CREATE TABLE IF NOT EXISTS mayavi_personal_account_ledgers (id UUID PRIMARY KEY, file_name TEXT NOT NULL, sheet_name TEXT NOT NULL DEFAULT '', data_rows JSONB NOT NULL DEFAULT '[]'::jsonb, row_count INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now())");
}
function excelText(cell){
  const value=cell.value;
  if(value===undefined||value===null)return '';
  if(value instanceof Date)return Number.isNaN(value.getTime())?'':value.toISOString().slice(0,10);
  if(typeof value==='object'){
    if('result' in value)return String(value.result??'').trim();
    if(Array.isArray(value.richText))return value.richText.map(x=>x.text||'').join('').trim();
    if('text' in value)return String(value.text??'').trim();
    if('hyperlink' in value)return String(value.hyperlink??'').trim();
    return '';
  }
  if(typeof value==='number'){
    const fmt=String(cell.numFmt||'').split(';')[0];
    if(/^0{2,}$/.test(fmt)&&Number.isInteger(value)&&value>=0)return String(value).padStart(fmt.length,'0');
  }
  return String(value).trim();
}
function parseSheet(ws){
  const rows=[];
  const maxRows=Math.min(ws.rowCount||0,8000),maxColumns=Math.min(Math.max(ws.columnCount||0,1),48);
  for(let n=1;n<=maxRows;n++){
    const row=ws.getRow(n),cells=[];
    for(let i=1;i<=maxColumns;i++)cells.push(excelText(row.getCell(i)));
    if(cells.some(Boolean))rows.push(cells);
  }
  return rows.length?{sheet:ws.name,rows}:null;
}
export async function POST(request){
  if(!authorized(request))return reply({ok:false,error:'Admin login required.'},403);
  try{
    const form=await request.formData(),file=form.get('file');
    if(!file||typeof file.arrayBuffer!=='function')return reply({ok:false,error:'Choose an Excel .xlsx file.'},400);
    if(!/\.xlsx$/i.test(String(file.name||'')))return reply({ok:false,error:'Upload an .xlsx workbook (please convert .xls files to .xlsx first).'},400);
    if(file.size>10*1024*1024)return reply({ok:false,error:'Maximum Excel upload size is 10 MB.'},413);
    const wb=new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await file.arrayBuffer()));
    const sheets=wb.worksheets.slice(0,15).map(parseSheet).filter(Boolean);
    if(!sheets.length)return reply({ok:false,error:'No populated sheet found in Excel workbook.'},400);
    return reply({ok:true,fileName:String(file.name||'Personal Accounts.xlsx').slice(0,180),sheets});
  }catch(e){return reply({ok:false,error:'Excel could not be parsed: '+String(e.message||e).slice(0,230)},400);}
}
async function excelDownload(batch){
  const book=new ExcelJS.Workbook();
  book.creator='Mayavi Cargo · Personal Accounts';
  book.created=new Date();
  const sheet=book.addWorksheet('Personal Accounts',{views:[{state:'frozen',ySplit:1}]});
  sheet.columns=[
    {header:'Date',key:'date',width:17},
    {header:'Details',key:'details',width:55},
    {header:'Cheque No.',key:'chequeNo',width:22},
    {header:'Debit',key:'debit',width:19},
    {header:'Credit',key:'credit',width:19},
    {header:'Balance',key:'balance',width:19},
    {header:'Remarks',key:'remarks',width:58}
  ];
  sheet.getRow(1).height=27;
  sheet.getRow(1).eachCell(c=>{c.font={bold:true,color:{argb:'FFFFFFFF'},size:11};c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF20538C'}};c.alignment={vertical:'middle',wrapText:true};});
  sheet.autoFilter={from:'A1',to:'G1'};
  sheet.pageSetup={paperSize:9,orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0};
  for(const [i,row] of (batch.data_rows||[]).entries()){
    const record={};
    for(const field of PERSONAL_ACCOUNT_FIELDS){
      const raw=String(row[field.key]??'');
      if(['debit','credit','balance'].includes(field.key)){
        const amount=numericAccountAmount(raw);record[field.key]=amount===null?raw:amount;
      }else record[field.key]=raw;
    }
    sheet.addRow(record);
    const current=sheet.getRow(i+2);
    current.height=22;
    current.eachCell({includeEmpty:true},(cell,col)=>{
      cell.alignment={vertical:'top',wrapText:col===2||col===7};
      if(i%2===1)cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF3F7FC'}};
      if([4,5,6].includes(col)&&typeof cell.value==='number')cell.numFmt='#,##0.00;[Red](#,##0.00)';
    });
    current.getCell(3).numFmt='@';
  }
  const output=Buffer.from(await book.xlsx.writeBuffer());
  const basename=String(batch.file_name||'Personal-Accounts').replace(/\.[^.]+$/,'').replace(/[^a-z0-9_-]/gi,'-').slice(0,64)||'Personal-Accounts';
  return new Response(output,{headers:{
    'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition':'attachment; filename="'+basename+'-saved.xlsx"',
    'Cache-Control':'private, no-store',
    'X-Content-Type-Options':'nosniff'
  }});
}
export async function GET(request){
  if(!authorized(request))return reply({ok:false,error:'Admin login required.'},403);
  try{
    const sql=database();await ensureTable(sql);
    const list=await sql.query('SELECT id::text,file_name,sheet_name,row_count,created_at,updated_at FROM mayavi_personal_account_ledgers ORDER BY updated_at DESC LIMIT 150');
    const params=new URL(request.url).searchParams;
    const requested=params.get('id')||list[0]?.id||'';
    if(requested&&!uuid.test(requested))return reply({ok:false,error:'Invalid saved ledger ID.'},400);
    const matched=requested?await sql.query('SELECT id::text,file_name,sheet_name,data_rows,row_count,updated_at FROM mayavi_personal_account_ledgers WHERE id=$1 LIMIT 1',[requested]):[];
    const batch=matched[0]||null;
    if(params.get('format')==='xlsx'){
      if(!batch)return reply({ok:false,error:'Choose a saved ledger to download.'},404);
      return excelDownload(batch);
    }
    return reply({ok:true,batches:list,batch});
  }catch(e){return reply({ok:false,error:String(e.message||e).slice(0,250)},500);}
}
export async function PUT(request){
  if(!authorized(request))return reply({ok:false,error:'Admin login required.'},403);
  try{
    const body=await request.json();
    if(!Array.isArray(body.rows)||body.rows.length===0||body.rows.length>8000)return reply({ok:false,error:'Save requires 1–8,000 account rows.'},400);
    const rows=body.rows.map((r,index)=>{
      const clean={id:String(r.id||'row-'+(index+1)).slice(0,100)};
      for(const k of PERSONAL_ACCOUNT_KEYS)clean[k]=String(r[k]??'').trim().slice(0,k==='details'||k==='remarks'?1300:220);
      return clean;
    });
    if(rows.some(r=>!isValidAccountSaveRow(r)))return reply({ok:false,error:'Empty account rows cannot be saved.'},400);
    if(new Set(rows.map(r=>r.id)).size!==rows.length)return reply({ok:false,error:'Duplicate row IDs detected; please reload and retry.'},400);
    const serialized=JSON.stringify(rows);
    if(serialized.length>6000000)return reply({ok:false,error:'Account data is too large to save.'},413);
    const id=body.id&&uuid.test(String(body.id))?body.id:randomUUID();
    const fileName=String(body.fileName||'Personal Accounts').slice(0,180);
    const sheetName=String(body.sheetName||'Accounts').slice(0,120);
    const sql=database();await ensureTable(sql);
    const saved=await sql.query("INSERT INTO mayavi_personal_account_ledgers(id,file_name,sheet_name,data_rows,row_count) VALUES($1,$2,$3,$4::jsonb,$5) ON CONFLICT(id) DO UPDATE SET file_name=EXCLUDED.file_name,sheet_name=EXCLUDED.sheet_name,data_rows=EXCLUDED.data_rows,row_count=EXCLUDED.row_count,updated_at=now() RETURNING id::text, row_count, updated_at",[id,fileName,sheetName,serialized,rows.length]);
    return reply({ok:true,id:saved[0].id,rowCount:saved[0].row_count,updatedAt:saved[0].updated_at});
  }catch(e){return reply({ok:false,error:'Save failed: '+String(e.message||e).slice(0,250)},500);}
}
