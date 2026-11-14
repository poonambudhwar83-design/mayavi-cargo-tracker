import {neon} from '@neondatabase/serverless';
import ExcelJS from 'exceljs';
import {readSession} from '../../../lib/mayaviAuth.js';
import {parseJepoExcel} from '../../../lib/jepoExcelImport.js';
import {parseJepoCustomerMap,normalizeJepoJpCode} from '../../../lib/jepoCustomerMapping.js';
import {csvAsJepoWorkbook} from '../../../lib/jepoCsvImport.js';
import {ensureJepoTrackingTable,syncJepoTrackingAwbs} from '../../../lib/jepoTrackingStore.js';
import {cleanJepoTrackingNo} from '../../../lib/jepoBranchTracking.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=180;
const json=(v,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'no-store, private'}});
const db=()=>{
 const url=process.env.DATABASE_URL||process.env.POSTGRES_URL||process.env.NEON_DATABASE_URL||process.env.DATABASE_URL_UNPOOLED;
 if(!url)throw Error('Mayavi shared database unavailable.');
 return neon(url);
};
async function auth(request,sql,{readOnlyAllowed=false}={}){
 const session=readSession(request);
 if(!session)return false;
 const isAdmin=session.role==='admin';
 const isHaryana=readOnlyAllowed&&session.role==='haryana_admin'&&session.branchScope==='HARYANA'&&session.username==='haryanaadmin';
 if(!isAdmin&&!isHaryana)return false;
 const rows=await sql.query("SELECT role,branch_scope,is_active,session_version FROM mayavi_users WHERE lower(username)=$1 LIMIT 1",[session.username]);
 const user=rows[0];
 if(!user||!user.is_active||Number(user.session_version)!==Number(session.sessionVersion||0))return false;
 return isAdmin?user.role==='admin':user.role==='employee'&&user.branch_scope==='HARYANA';
}
const columns="awb,service,vendor,consignee,destination,goods_description,followup_remarks,followup_updated_by,followup_updated_at,chargeable_weight,jp_code,to_char(booking_date,'YYYY-MM-DD') AS booking_date,status,live_status,carrier_awb,live_remarks,live_event_when,to_char(delivered_on,'YYYY-MM-DD') AS delivered_on,delivery_date_source,checked_at,tracking_error,import_file,created_at";
function rowData(row){
 return {awb:row.awb,service:row.service,vendor:row.vendor,consignee:row.consignee,destination:row.destination,goodsDescription:row.goods_description||'',followupRemarks:row.followup_remarks||'',followupUpdatedBy:row.followup_updated_by||'',followupUpdatedAt:row.followup_updated_at||null,
  weight:row.chargeable_weight===null?null:Number(row.chargeable_weight),jpCode:row.jp_code,
  bookingDate:row.booking_date,status:row.status,liveStatus:row.live_status,carrierAwb:row.carrier_awb,
  liveRemarks:row.live_remarks,liveEventWhen:row.live_event_when,deliveredOn:row.delivered_on,
  deliveryDateSource:row.delivery_date_source,checkedAt:row.checked_at,trackingError:row.tracking_error,
  importFile:row.import_file};
}

async function ensureJepoCustomerTable(sql){
 await sql.query("CREATE TABLE IF NOT EXISTS mayavi_jepo_customer_codes (jp_code TEXT PRIMARY KEY, customer_name TEXT NOT NULL DEFAULT '', source_file TEXT NOT NULL DEFAULT '', updated_by TEXT NOT NULL DEFAULT '', updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
}

// Repeated shipments are acknowledged against already-saved imports as well
// as duplicate rows inside the current CSV/XLSX. No duplicate database rows.
async function existingJepoAwbs(sql,records=[]){
 const matches=[];
 for(let i=0;i<records.length;i+=900){
  const awbs=records.slice(i,i+900).map(r=>r.awb);
  const rows=await sql.query("SELECT awb FROM mayavi_jepo_tracking WHERE awb IN (SELECT jsonb_array_elements_text($1::jsonb))",[JSON.stringify(awbs)]);
  for(const item of rows)matches.push(item.awb);
 }
 return matches;
}

// Persist duplicate acknowledgements separately from the unique AWB tracking rows.
// This audit remains accessible even if the underlying shipment is later deleted.
async function ensureDuplicateAuditTable(sql){
 await sql.query("CREATE TABLE IF NOT EXISTS mayavi_jepo_duplicate_audit (awb TEXT PRIMARY KEY, duplicate_occurrences INTEGER NOT NULL DEFAULT 0, file_repeat_occurrences INTEGER NOT NULL DEFAULT 0, existing_awb_occurrences INTEGER NOT NULL DEFAULT 0, upload_events INTEGER NOT NULL DEFAULT 0, last_excel_rows TEXT NOT NULL DEFAULT '', last_import_file TEXT NOT NULL DEFAULT '', last_acknowledged_by TEXT NOT NULL DEFAULT '', last_acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
 await sql.query("CREATE INDEX IF NOT EXISTS mayavi_jepo_duplicate_audit_seen_idx ON mayavi_jepo_duplicate_audit(last_seen_at DESC)");
}
async function saveDuplicateAudit(sql,{parsed,existingAwbs,fileName,username}){
 const previouslySaved=new Set(existingAwbs);
 const repeated=new Map(parsed.repeatedAwbs.map(r=>[r.awb,r]));
 const all=[...new Set([...previouslySaved,...repeated.keys()])].map(awb=>{
  const sameFile=repeated.get(awb);
  const extraInFile=sameFile?Math.max(0,Number(sameFile.count||1)-1):0;
  const alreadySaved=previouslySaved.has(awb)?1:0;
  return {awb,duplicateCount:extraInFile+alreadySaved,fileRepeats:extraInFile,existingRepeats:alreadySaved,
   excelRows:sameFile?.rows?.join(', ')||''};
 }).filter(r=>r.duplicateCount>0);
 if(!all.length)return 0;
 await ensureDuplicateAuditTable(sql);
 for(let i=0;i<all.length;i+=200){
  const batch=all.slice(i,i+200);
  await sql.query("INSERT INTO mayavi_jepo_duplicate_audit (awb,duplicate_occurrences,file_repeat_occurrences,existing_awb_occurrences,upload_events,last_excel_rows,last_import_file,last_acknowledged_by) SELECT x.awb,x.duplicate_count,x.file_repeats,x.existing_repeats,1,x.excel_rows,$2,$3 FROM jsonb_to_recordset($1::jsonb) AS x(awb text,duplicate_count int,file_repeats int,existing_repeats int,excel_rows text) ON CONFLICT (awb) DO UPDATE SET duplicate_occurrences=mayavi_jepo_duplicate_audit.duplicate_occurrences+EXCLUDED.duplicate_occurrences,file_repeat_occurrences=mayavi_jepo_duplicate_audit.file_repeat_occurrences+EXCLUDED.file_repeat_occurrences,existing_awb_occurrences=mayavi_jepo_duplicate_audit.existing_awb_occurrences+EXCLUDED.existing_awb_occurrences,upload_events=mayavi_jepo_duplicate_audit.upload_events+1,last_excel_rows=EXCLUDED.last_excel_rows,last_import_file=EXCLUDED.last_import_file,last_acknowledged_by=EXCLUDED.last_acknowledged_by,last_acknowledged_at=NOW(),last_seen_at=NOW()",
   [JSON.stringify(batch.map(x=>({awb:x.awb,duplicate_count:x.duplicateCount,file_repeats:x.fileRepeats,existing_repeats:x.existingRepeats,excel_rows:x.excelRows}))),fileName,username]);
 }
 return all.length;
}
export async function GET(request){
 try{
  const sql=db();
  if(!await auth(request,sql,{readOnlyAllowed:true}))return json({ok:false,error:'Admin or Haryana Admin login required.'},403);
  await ensureJepoTrackingTable(sql);
  await ensureJepoCustomerTable(sql);
  const names=await sql.query("SELECT jp_code,customer_name FROM mayavi_jepo_customer_codes");
  const customers=new Map(names.map(row=>[normalizeJepoJpCode(row.jp_code),row.customer_name]));
  const rows=await sql.query("SELECT "+columns+" FROM mayavi_jepo_tracking ORDER BY CASE WHEN status='DELIVERED' THEN 1 ELSE 0 END, booking_date DESC NULLS LAST, created_at DESC LIMIT 20000");
  await ensureDuplicateAuditTable(sql);
  const duplicateRows=await sql.query("SELECT d.awb,d.duplicate_occurrences,d.file_repeat_occurrences,d.existing_awb_occurrences,d.upload_events,d.last_excel_rows,d.last_import_file,d.last_acknowledged_by,d.last_acknowledged_at,d.first_seen_at,d.last_seen_at,(t.awb IS NOT NULL) AS in_tracking,COALESCE(t.status,'') AS tracking_status FROM mayavi_jepo_duplicate_audit d LEFT JOIN mayavi_jepo_tracking t ON t.awb=d.awb ORDER BY d.last_seen_at DESC LIMIT 20000");
  return json({ok:true,rows:rows.map(row=>({...rowData(row),customerName:customers.get(normalizeJepoJpCode(row.jp_code))||''})),duplicateRows:duplicateRows.map(x=>({awb:x.awb,count:Number(x.duplicate_occurrences),fileRepeats:Number(x.file_repeat_occurrences),alreadySavedRepeats:Number(x.existing_awb_occurrences),uploadEvents:Number(x.upload_events),excelRows:x.last_excel_rows,file:x.last_import_file,acknowledgedBy:x.last_acknowledged_by,acknowledgedAt:x.last_acknowledged_at,firstSeenAt:x.first_seen_at,lastSeenAt:x.last_seen_at,inTracking:x.in_tracking,trackingStatus:x.tracking_status}))});
 }catch(e){console.error('jepo_tracking_get',String(e?.message||e).slice(0,180));return json({ok:false,error:'JEPO Tracking records could not be loaded.'},503);}
}
export async function POST(request){
 try{
  const sql=db();
  if(!await auth(request,sql))return json({ok:false,error:'Admin login required.'},403);
  const form=await request.formData();
  const action=String(form.get('action')||'preview');
  if(!['preview','save','preview_customers','save_customers'].includes(action))return json({ok:false,error:'Unsupported action.'},400);
  const file=form.get('file');
  if(!file||typeof file.arrayBuffer!=='function')return json({ok:false,error:'Select JEPO CSV or Excel workbook.'},400);
  if(!/\.(xlsx|csv)$/i.test(file.name||''))return json({ok:false,error:'Please upload a .csv or .xlsx file.'},400);
  if(!file.size||file.size>10*1024*1024)return json({ok:false,error:'CSV or Excel file should be 10 MB or smaller.'},413);
  const isCsv=/\.csv$/i.test(file.name||'');
  let workbook;
  try{
   const bytes=Buffer.from(await file.arrayBuffer());
   if(isCsv)workbook=csvAsJepoWorkbook(bytes,file.name);
   else{workbook=new ExcelJS.Workbook();await workbook.xlsx.load(bytes);}
  }catch(e){return json({ok:false,error:String(e?.message||'CSV/Excel file could not be opened.')},422);}
  if(action==='preview_customers'||action==='save_customers'){
   let customerSheet;
   try{customerSheet=parseJepoCustomerMap(workbook,{headerRow:isCsv?1:Number(form.get('headerRow')||0)});}
   catch(e){return json({ok:false,error:String(e?.message||'JP Code and Customer Name could not be matched.')},422);}
   if(customerSheet.conflicts.length)return json({ok:false,error:'Same JP Code has different Customer Names in the uploaded sheet. Fix duplicates before importing.',conflicts:customerSheet.conflicts.slice(0,15)},422);
   await ensureJepoTrackingTable(sql);
   await ensureJepoCustomerTable(sql);
   const codes=customerSheet.records.map(row=>row.jpCode);
   const matches=await sql.query("SELECT COUNT(*)::int AS shipment_count,COUNT(DISTINCT UPPER(BTRIM(jp_code)))::int AS jp_count FROM mayavi_jepo_tracking WHERE UPPER(BTRIM(jp_code)) IN (SELECT value FROM jsonb_array_elements_text($1::jsonb) AS x(value))",[JSON.stringify(codes)]);
   const preview={ok:true,action,matchedShipments:Number(matches[0]?.shipment_count||0),matchedCodes:Number(matches[0]?.jp_count||0),
    totalCodes:customerSheet.records.length,sheetName:customerSheet.sheetName,headerRow:customerSheet.headerRow,
    jpHeader:customerSheet.jpHeader,customerHeader:customerSheet.customerHeader,
    duplicates:customerSheet.duplicates,invalid:customerSheet.invalid,
    preview:customerSheet.records.slice(0,10)};
   if(action==='preview_customers')return json(preview);
   const session=readSession(request);
   const name=String(file.name||'customer-map.xlsx').replace(/[^a-zA-Z0-9_. ()-]/g,'_').slice(0,150);
   for(let i=0;i<customerSheet.records.length;i+=200){
    const batch=customerSheet.records.slice(i,i+200);
    await sql.query("INSERT INTO mayavi_jepo_customer_codes (jp_code,customer_name,source_file,updated_by) SELECT x.jp_code,x.customer_name,$2,$3 FROM jsonb_to_recordset($1::jsonb) AS x(jp_code text,customer_name text) ON CONFLICT (jp_code) DO UPDATE SET customer_name=EXCLUDED.customer_name,source_file=EXCLUDED.source_file,updated_by=EXCLUDED.updated_by,updated_at=NOW()",
     [JSON.stringify(batch.map(x=>({jp_code:x.jpCode,customer_name:x.customerName}))),name,session.username]);
   }
   return json({...preview,savedCodes:customerSheet.records.length,message:'Customer names matched by JP Code. Active, Overdue and Delivered show names without changing shipment history.'});
  }
  let parsed;
  try{parsed=parseJepoExcel(workbook,{sheetName:String(form.get('sheetName')||''),headerRow:isCsv?1:Number(form.get('headerRow')||0)});}
  catch(e){return json({ok:false,error:String(e?.message||'Excel column mapping failed.')},422);}
  await ensureJepoTrackingTable(sql);
  const existingAwbs=await existingJepoAwbs(sql,parsed.records);
  // Duplicate AWBs are detected and diverted automatically. No acknowledgement step.
  if(action==='preview')return json({ok:true,sheetName:parsed.sheetName,headerRow:parsed.headerRow,mapping:parsed.columnMapping,columnMatches:parsed.columnMatches,missingFields:parsed.missingFields,
   total:parsed.records.length,invalid:parsed.invalid,duplicates:parsed.duplicates,missingDates:parsed.missingDates,
   repeatedAwbs:parsed.repeatedAwbs,repeatedUniqueCount:parsed.repeatedUniqueCount,
   previouslySavedCount:existingAwbs.length,previouslySavedAwbs:existingAwbs.slice(0,200),
   preview:parsed.records.slice(0,12)});
  const fileName=String(file.name||'jepo.xlsx').replace(/[/\\\u0000-\u001f]/g,'_').slice(0,150);
  const session=readSession(request);
  for(let i=0;i<parsed.records.length;i+=200){
   const part=parsed.records.slice(i,i+200);
   await sql.query("INSERT INTO mayavi_jepo_tracking (awb,service,vendor,consignee,destination,goods_description,chargeable_weight,jp_code,booking_date,imported_by,import_file) SELECT x.awb,x.service,x.vendor,x.consignee,x.destination,COALESCE(x.goods_description,''),x.weight,x.jp_code,NULLIF(x.booking_date,'')::date,$2,$3 FROM jsonb_to_recordset($1::jsonb) AS x(awb text,service text,vendor text,consignee text,destination text,goods_description text,weight numeric,jp_code text,booking_date text) ON CONFLICT (awb) DO UPDATE SET goods_description=EXCLUDED.goods_description,updated_at=NOW() WHERE mayavi_jepo_tracking.goods_description='' AND EXCLUDED.goods_description<>''",
    [JSON.stringify(part.map(r=>({...r,goods_description:r.goodsDescription||'',weight:r.weight,jp_code:r.jpCode,booking_date:r.bookingDate||''}))),session.username,fileName]);
  }
  const recordedDuplicates=await saveDuplicateAudit(sql,{parsed,existingAwbs,fileName,username:session.username});
  return json({ok:true,saved:parsed.records.length,recordedDuplicates,newAwbs:parsed.records.length-existingAwbs.length,invalid:parsed.invalid,duplicates:parsed.duplicates,missingFields:parsed.missingFields,
   repeatedAwbs:parsed.repeatedAwbs,repeatedUniqueCount:parsed.repeatedUniqueCount,
   previouslySavedCount:existingAwbs.length,previouslySavedAwbs:existingAwbs.slice(0,200),
   missingDates:parsed.missingDates,message:'New JEPO AWBs saved. Duplicate AWBs recorded separately automatically; existing shipments and verified tracking left unchanged.'});
 }catch(e){console.error('jepo_tracking_upload',String(e?.message||e).slice(0,220));return json({ok:false,error:'JEPO Excel upload failed; please verify file and retry.'},503);}
}
export async function PATCH(request){
 try{
  const sql=db();
  if(!await auth(request,sql))return json({ok:false,error:'Admin login required.'},403);
  const body=await request.json().catch(()=>({}));
  if(body.action==='save_followup_remarks'){
   const awb=cleanJepoTrackingNo(body.awb);
   if(!awb||typeof body.remarks!=='string'||body.remarks.length>1000)
    return json({ok:false,error:'Valid AWB and follow-up remarks up to 1000 characters required.'},400);
   const remarks=body.remarks.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g,' ').trim();
   await ensureJepoTrackingTable(sql);
   // Keep verified carrier progress separate; a manual follow-up must never
   // overwrite the live tracking status, delivered date, or website remarks.
   const session=readSession(request);
   const saved=await sql.query("UPDATE mayavi_jepo_tracking SET followup_remarks=$2,followup_updated_by=$3,followup_updated_at=NOW(),updated_at=NOW() WHERE awb=$1 RETURNING awb,followup_remarks,followup_updated_by,followup_updated_at",
    [awb,remarks,session?.username||'admin']);
   return saved.length?json({ok:true,awb:saved[0].awb,followupRemarks:saved[0].followup_remarks,
    followupUpdatedBy:saved[0].followup_updated_by,followupUpdatedAt:saved[0].followup_updated_at}):
    json({ok:false,error:'JEPO AWB not found.'},404);
  }
  if(body.action==='save_goods_description'){
   const awb=cleanJepoTrackingNo(body.awb);
   if(!awb||typeof body.goodsDescription!=='string'||body.goodsDescription.length>400)return json({ok:false,error:'Valid AWB and goods description up to 400 characters required.'},400);
   await ensureJepoTrackingTable(sql);
   const description=body.goodsDescription.replace(/[\u0000-\u001f\u007f]/g,' ').trim();
   const saved=await sql.query("UPDATE mayavi_jepo_tracking SET goods_description=$2,updated_at=NOW() WHERE awb=$1 RETURNING awb,goods_description",[awb,description]);
   return saved.length?json({ok:true,awb:saved[0].awb,goodsDescription:saved[0].goods_description}):json({ok:false,error:'JEPO AWB not found.'},404);
  }
  const awbs=[...new Set((Array.isArray(body.awbs)?body.awbs:[body.awb]).map(cleanJepoTrackingNo).filter(Boolean))].slice(0,8);
  if(!awbs.length)return json({ok:false,error:'Select one or more AWB numbers.'},400);
  await ensureJepoTrackingTable(sql);
  const existing=await sql.query("SELECT awb FROM mayavi_jepo_tracking WHERE awb IN (SELECT jsonb_array_elements_text($1::jsonb))",[JSON.stringify(awbs)]);
  if(!existing.length)return json({ok:false,error:'These AWBs are not in JEPO Tracking.'},404);
  const result=await syncJepoTrackingAwbs(sql,existing.map(x=>x.awb));
  return json({ok:true,...result});
 }catch(e){console.error('jepo_tracking_refresh',String(e?.message||e).slice(0,180));return json({ok:false,error:'JEPO website is temporarily unavailable. Previous status is safe.'},503);}
}

export async function DELETE(request){
 try{
  const sql=db();
  if(!await auth(request,sql))return json({ok:false,error:'Admin login required.'},403);
  const body=await request.json().catch(()=>({}));
  const awb=cleanJepoTrackingNo(body.awb);
  if(!awb||body.confirm!==true)return json({ok:false,error:'Select an AWB and confirm deletion.'},400);
  await ensureJepoTrackingTable(sql);
  const deleted=await sql.query("DELETE FROM mayavi_jepo_tracking WHERE awb=$1 RETURNING awb,status",[awb]);
  if(!deleted.length)return json({ok:false,error:'JEPO AWB not found or already deleted.'},404);
  return json({ok:true,awb:deleted[0].awb,status:deleted[0].status,message:'JEPO AWB deleted.'});
 }catch(e){console.error('jepo_tracking_delete',String(e?.message||e).slice(0,180));return json({ok:false,error:'Could not delete JEPO AWB. No other records were changed.'},503);}
}
