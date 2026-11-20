import {randomUUID} from 'node:crypto';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import {decodeBankCsv,parseBankCsv} from '../../../lib/personalAccountsUpload.js';
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
function cellNoteText(cell){
  const note=cell.note;
  if(!note)return '';
  if(typeof note==='string')return note.trim().slice(0,1300);
  if(Array.isArray(note.texts))return note.texts.map(t=>String(t.text||'')).join('').trim().slice(0,1300);
  return '';
}
function parseSheet(ws){
  const rows=[],cellNotes=[];
  const maxRows=Math.min(ws.rowCount||0,8000),maxColumns=Math.min(Math.max(ws.columnCount||0,1),48);
  for(let n=1;n<=maxRows;n++){
    const row=ws.getRow(n),cells=[],notes=[];
    for(let i=1;i<=maxColumns;i++){
      const cell=row.getCell(i);
      cells.push(excelText(cell));
      const note=cellNoteText(cell);
      if(note)notes.push(note);
    }
    if(cells.some(Boolean)||notes.length){rows.push(cells);cellNotes.push(notes.join(' | '));}
  }
  return rows.length?{sheet:ws.name,rows,cellNotes}:null;
}
export async function POST(request){
  if(!authorized(request))return reply({ok:false,error:'Admin login required.'},403);
  try{
    const form=await request.formData(),file=form.get('file');
    if(!file||typeof file.arrayBuffer!=='function')return reply({ok:false,error:'Choose an Excel, CSV or ZIP bank statement file.'},400);
    const originalName=String(file.name||'Statement').slice(0,180);
    if(file.size===0)return reply({ok:false,error:'The selected file is empty. Please choose the actual downloaded bank statement.'},400);
    // Vercel request bodies cannot exceed approximately 4.5 MB.
    if(file.size>4*1024*1024)return reply({ok:false,error:'This file exceeds the online upload limit (4 MB). Save a smaller date range from your bank or split the Excel statement.'},413);
    let bytes=Buffer.from(await file.arrayBuffer());
    const isZip=buffer=>buffer.length>=4&&buffer[0]===0x50&&buffer[1]===0x4b;
    const isOle=buffer=>buffer.length>=8&&buffer.subarray(0,8).equals(Buffer.from([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]));
    let effectiveName=originalName;
    if(/\.zip$/i.test(originalName)){
      if(!isZip(bytes))return reply({ok:false,error:'This is not a readable ZIP archive. Download the statement again or unzip it on your device.'},400);
      const archive=await JSZip.loadAsync(bytes);
      const matches=Object.values(archive.files).filter(item=>!item.dir&&/\.(xlsx|xls|csv)$/i.test(item.name)&&!item.name.startsWith('__MACOSX/')&&!item.name.split('/').pop().startsWith('~$'));
      if(!matches.length)return reply({ok:false,error:'No Excel or CSV bank statement was found inside this ZIP. Unzip it locally and choose the statement file.'},400);
      const workbookFile=matches.find(item=>/\.xlsx$/i.test(item.name))||matches.find(item=>/\.csv$/i.test(item.name))||matches[0];
      if(workbookFile._data?.uncompressedSize>12*1024*1024)return reply({ok:false,error:'The Excel inside ZIP is too large for Mayavi. Split the statement before importing.'},413);
      try{bytes=Buffer.from(await workbookFile.async('nodebuffer'));}catch{
        return reply({ok:false,error:'ZIP is password-protected or damaged. Unzip it on your device first and upload the Excel without sharing the password.'},400);
      }
      if(bytes.length>12*1024*1024)return reply({ok:false,error:'The unzipped bank statement is too large. Upload a smaller date range.'},413);
      effectiveName=workbookFile.name.split('/').pop();
    }
    let sheets=[];
    if(/\.csv$/i.test(effectiveName)){
      const rows=parseBankCsv(decodeBankCsv(bytes));
      if(rows.length)sheets=[{sheet:'Statement',rows,cellNotes:[]}];
    }else if(/\.(xlsx|xls)$/i.test(effectiveName)){
      if(isOle(bytes))return reply({ok:false,error:'This Excel uses old .xls format or password encryption. Open it locally with the password (if needed) and use Save As → unprotected .xlsx, then upload. Do not share your password.'},400);
      if(!isZip(bytes))return reply({ok:false,error:'This is not a readable .xlsx file. Use Excel → Save As → Excel Workbook (.xlsx), rather than only renaming the file.'},400);
      const wb=new ExcelJS.Workbook();
      try{await wb.xlsx.load(bytes);}catch(err){
        return reply({ok:false,error:'The Excel workbook could not be read. If it is encrypted, open it with the password on your device and save a new unprotected .xlsx copy. Detail: '+String(err.message||err).slice(0,135)},400);
      }
      sheets=wb.worksheets.slice(0,15).map(parseSheet).filter(Boolean);
    }else{
      return reply({ok:false,error:'This file format is not supported yet. Choose .xlsx, .xls, .csv or a .zip containing a bank statement.'},400);
    }
    if(!sheets.length)return reply({ok:false,error:'No populated entries found. Please check whether the selected workbook contains the bank statement.'},400);
    return reply({ok:true,fileName:effectiveName,sheets});
  }catch(e){
    return reply({ok:false,error:'Bank statement upload failed: '+String(e.message||e).slice(0,250)+'. If this is a protected ZIP, extract it locally first; never share your password.'},400);
  }
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
