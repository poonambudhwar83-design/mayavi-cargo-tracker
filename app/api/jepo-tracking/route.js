import {neon} from '@neondatabase/serverless';
import ExcelJS from 'exceljs';
import {createHash} from 'node:crypto';
import {readSession} from '../../../lib/mayaviAuth.js';
import {parseJepoExcel} from '../../../lib/jepoExcelImport.js';
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
const columns="awb,service,vendor,consignee,destination,chargeable_weight,jp_code,to_char(booking_date,'YYYY-MM-DD') AS booking_date,status,live_status,carrier_awb,live_remarks,live_event_when,to_char(delivered_on,'YYYY-MM-DD') AS delivered_on,delivery_date_source,checked_at,tracking_error,import_file,created_at";
function rowData(row){
 return {awb:row.awb,service:row.service,vendor:row.vendor,consignee:row.consignee,destination:row.destination,
  weight:row.chargeable_weight===null?null:Number(row.chargeable_weight),jpCode:row.jp_code,
  bookingDate:row.booking_date,status:row.status,liveStatus:row.live_status,carrierAwb:row.carrier_awb,
  liveRemarks:row.live_remarks,liveEventWhen:row.live_event_when,deliveredOn:row.delivered_on,
  deliveryDateSource:row.delivery_date_source,checkedAt:row.checked_at,trackingError:row.tracking_error,
  importFile:row.import_file};
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
// Older imports only stored the unique AWB row, not duplicate occurrences.
// An administrator can restore the duplicate audit by scanning the original
// CSV/XLSX without overwriting shipment records or incrementing counts on
// a second scan of the same source file.
async function ensureHistoricalScanTables(sql){
 await sql.query("CREATE TABLE IF NOT EXISTS mayavi_jepo_historical_scans (file_hash TEXT PRIMARY KEY, file_name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'STARTED', scanned_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), completed_at TIMESTAMPTZ)");
 await sql.query("CREATE TABLE IF NOT EXISTS mayavi_jepo_historical_scan_awbs (file_hash TEXT NOT NULL REFERENCES mayavi_jepo_historical_scans(file_hash), awb TEXT NOT NULL, occurrences INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(file_hash,awb))");
 await sql.query("CREATE INDEX IF NOT EXISTS mayavi_jepo_historical_scan_awbs_awb_idx ON mayavi_jepo_historical_scan_awbs(awb)");
 await sql.query("CREATE TABLE IF NOT EXISTS mayavi_jepo_historical_duplicate_events (file_hash TEXT NOT NULL, awb TEXT NOT NULL, file_repeats INTEGER NOT NULL, previous_repeats INTEGER NOT NULL, PRIMARY KEY(file_hash,awb))");
}
async function previousHistoricalAwbs(sql,records,fileHash){
 const matches=new Set();
 for(let i=0;i<records.length;i+=500){
  const awbs=records.slice(i,i+500).map(r=>r.awb);
  const rows=await sql.query("SELECT DISTINCT h.awb FROM mayavi_jepo_historical_scan_awbs h JOIN mayavi_jepo_historical_scans s ON s.file_hash=h.file_hash WHERE s.status='COMPLETED' AND h.file_hash<>$2 AND h.awb IN (SELECT jsonb_array_elements_text($1::jsonb))",[JSON.stringify(awbs),fileHash]);
  for(const row of rows)matches.add(row.awb);
 }
 return [...matches];
}
async function recordHistoricalDuplicates(sql,{parsed,fileHash,fileName,username,previousAwbs}){
 const previous=new Set(previousAwbs);
 const repeated=new Map(parsed.repeatedAwbs.map(r=>[r.awb,r]));
 const duplicates=[...new Set([...previous,...repeated.keys()])].map(awb=>{
  const repeatedItem=repeated.get(awb);
  const fileRepeats=repeatedItem?Math.max(0,Number(repeatedItem.count||1)-1):0;
  const previousRepeats=previous.has(awb)?1:0;
  return {awb,file_repeats:fileRepeats,previous_repeats:previousRepeats,excel_rows:repeatedItem?.rows?.join(', ')||''};
 }).filter(x=>x.file_repeats+x.previous_repeats>0);
 await ensureDuplicateAuditTable(sql);
 for(let i=0;i<duplicates.length;i+=150){
  const batch=duplicates.slice(i,i+150);
  // The audit event's unique (file_hash, AWB) key makes retries idempotent.
  // The event insert and count increment happen in one atomic SQL statement.
  await sql.query("WITH events AS (INSERT INTO mayavi_jepo_historical_duplicate_events (file_hash,awb,file_repeats,previous_repeats) SELECT $2,x.awb,x.file_repeats,x.previous_repeats FROM jsonb_to_recordset($1::jsonb) AS x(awb text,file_repeats int,previous_repeats int,excel_rows text) ON CONFLICT DO NOTHING RETURNING awb,file_repeats,previous_repeats) INSERT INTO mayavi_jepo_duplicate_audit (awb,duplicate_occurrences,file_repeat_occurrences,existing_awb_occurrences,upload_events,last_excel_rows,last_import_file,last_acknowledged_by) SELECT e.awb,e.file_repeats+e.previous_repeats,e.file_repeats,e.previous_repeats,1,COALESCE(x.excel_rows,''),$3,$4 FROM events e JOIN jsonb_to_recordset($1::jsonb) AS x(awb text,file_repeats int,previous_repeats int,excel_rows text) ON x.awb=e.awb ON CONFLICT (awb) DO UPDATE SET duplicate_occurrences=mayavi_jepo_duplicate_audit.duplicate_occurrences+EXCLUDED.duplicate_occurrences,file_repeat_occurrences=mayavi_jepo_duplicate_audit.file_repeat_occurrences+EXCLUDED.file_repeat_occurrences,existing_awb_occurrences=mayavi_jepo_duplicate_audit.existing_awb_occurrences+EXCLUDED.existing_awb_occurrences,upload_events=mayavi_jepo_duplicate_audit.upload_events+1,last_excel_rows=EXCLUDED.last_excel_rows,last_import_file=EXCLUDED.last_import_file,last_acknowledged_by=EXCLUDED.last_acknowledged_by,last_acknowledged_at=NOW(),last_seen_at=NOW()",
   [JSON.stringify(batch),fileHash,fileName,username]);
 }
 return duplicates.length;
}
export async function GET(request){
 try{
  const sql=db();
  if(!await auth(request,sql,{readOnlyAllowed:true}))return json({ok:false,error:'Admin or Haryana Admin login required.'},403);
  await ensureJepoTrackingTable(sql);
  const rows=await sql.query("SELECT "+columns+" FROM mayavi_jepo_tracking ORDER BY CASE WHEN status='DELIVERED' THEN 1 ELSE 0 END, booking_date DESC NULLS LAST, created_at DESC LIMIT 20000");
  await ensureDuplicateAuditTable(sql);
  const duplicateRows=await sql.query("SELECT d.awb,d.duplicate_occurrences,d.file_repeat_occurrences,d.existing_awb_occurrences,d.upload_events,d.last_excel_rows,d.last_import_file,d.last_acknowledged_by,d.last_acknowledged_at,d.first_seen_at,d.last_seen_at,(t.awb IS NOT NULL) AS in_tracking,COALESCE(t.status,'') AS tracking_status FROM mayavi_jepo_duplicate_audit d LEFT JOIN mayavi_jepo_tracking t ON t.awb=d.awb ORDER BY d.last_seen_at DESC LIMIT 20000");
  return json({ok:true,rows:rows.map(rowData),duplicateRows:duplicateRows.map(x=>({awb:x.awb,count:Number(x.duplicate_occurrences),fileRepeats:Number(x.file_repeat_occurrences),alreadySavedRepeats:Number(x.existing_awb_occurrences),uploadEvents:Number(x.upload_events),excelRows:x.last_excel_rows,file:x.last_import_file,acknowledgedBy:x.last_acknowledged_by,acknowledgedAt:x.last_acknowledged_at,firstSeenAt:x.first_seen_at,lastSeenAt:x.last_seen_at,inTracking:x.in_tracking,trackingStatus:x.tracking_status}))});
 }catch(e){console.error('jepo_tracking_get',String(e?.message||e).slice(0,180));return json({ok:false,error:'JEPO Tracking records could not be loaded.'},503);}
}
export async function POST(request){
 try{
  const sql=db();
  if(!await auth(request,sql))return json({ok:false,error:'Admin login required.'},403);
  const form=await request.formData();
  const action=String(form.get('action')||'preview');
  if(!['preview','save','historical-preview','historical-save'].includes(action))return json({ok:false,error:'Unsupported action.'},400);
  const file=form.get('file');
  if(!file||typeof file.arrayBuffer!=='function')return json({ok:false,error:'Select JEPO CSV or Excel workbook.'},400);
  if(!/\.(xlsx|csv)$/i.test(file.name||''))return json({ok:false,error:'Please upload a .csv or .xlsx file.'},400);
  if(!file.size||file.size>10*1024*1024)return json({ok:false,error:'CSV or Excel file should be 10 MB or smaller.'},413);
  const isCsv=/\.csv$/i.test(file.name||'');
  let workbook,fileHash;
  try{
   const bytes=Buffer.from(await file.arrayBuffer());
   fileHash=createHash('sha256').update(bytes).digest('hex');
   if(isCsv)workbook=csvAsJepoWorkbook(bytes,file.name);
   else{workbook=new ExcelJS.Workbook();await workbook.xlsx.load(bytes);}
  }catch(e){return json({ok:false,error:String(e?.message||'CSV/Excel file could not be opened.')},422);}
  let parsed;
  try{parsed=parseJepoExcel(workbook,{sheetName:String(form.get('sheetName')||''),headerRow:isCsv?1:Number(form.get('headerRow')||0)});}
  catch(e){return json({ok:false,error:String(e?.message||'Excel column mapping failed.')},422);}
  await ensureJepoTrackingTable(sql);
  const historical=action.startsWith('historical-');
  if(historical)await ensureHistoricalScanTables(sql);
  const previousScan=historical?await sql.query("SELECT status FROM mayavi_jepo_historical_scans WHERE file_hash=$1 LIMIT 1",[fileHash]):[];
  const alreadyScanned=previousScan[0]?.status==='COMPLETED';
  const existingAwbs=historical?(alreadyScanned?[]:await previousHistoricalAwbs(sql,parsed.records,fileHash)):await existingJepoAwbs(sql,parsed.records);
  const requiresAcknowledgement=parsed.duplicates>0||existingAwbs.length>0;
  if(['save','historical-save'].includes(action)&&requiresAcknowledgement&&String(form.get('acknowledgeDuplicates')||'')!=='true')
   return json({ok:false,error:'Duplicate AWBs found. Please preview, review and acknowledge repeated or already saved AWBs before saving.',duplicates:parsed.duplicates,previouslySavedCount:existingAwbs.length},409);
  if(['preview','historical-preview'].includes(action))return json({ok:true,historical,alreadyScanned,sheetName:parsed.sheetName,headerRow:parsed.headerRow,mapping:parsed.columnMapping,columnMatches:parsed.columnMatches,missingFields:parsed.missingFields,
   total:parsed.records.length,invalid:parsed.invalid,duplicates:parsed.duplicates,missingDates:parsed.missingDates,
   repeatedAwbs:parsed.repeatedAwbs,repeatedUniqueCount:parsed.repeatedUniqueCount,
   previouslySavedCount:existingAwbs.length,previouslySavedAwbs:existingAwbs.slice(0,200),
   preview:parsed.records.slice(0,12)});
  const fileName=String(file.name||'jepo.xlsx').replace(/[/\\\u0000-\u001f]/g,'_').slice(0,150);
  const session=readSession(request);
  if(action==='historical-save'){
   if(alreadyScanned)return json({ok:true,alreadyScanned:true,message:'This original Excel/CSV file has already been scanned. No duplicate counts were added.'});
   // The file is hashed, so the same old export cannot inflate counts if rescanned.
   await sql.query("INSERT INTO mayavi_jepo_historical_scans(file_hash,file_name,scanned_by) VALUES($1,$2,$3) ON CONFLICT(file_hash) DO NOTHING",[fileHash,fileName,session.username]);
   for(let i=0;i<parsed.records.length;i+=200){
    const part=parsed.records.slice(i,i+200);
    const repeated=new Map(parsed.repeatedAwbs.map(item=>[item.awb,item.count]));
    await sql.query("INSERT INTO mayavi_jepo_historical_scan_awbs (file_hash,awb,occurrences) SELECT $2,x.awb,x.occurrences FROM jsonb_to_recordset($1::jsonb) AS x(awb text,occurrences int) ON CONFLICT DO NOTHING",
     [JSON.stringify(part.map(item=>({awb:item.awb,occurrences:repeated.get(item.awb)||1}))),fileHash]);
   }
   const historicalDuplicates=await recordHistoricalDuplicates(sql,{parsed,fileHash,fileName,username:session.username,previousAwbs:existingAwbs});
   await sql.query("UPDATE mayavi_jepo_historical_scans SET status='COMPLETED',completed_at=NOW() WHERE file_hash=$1",[fileHash]);
   return json({ok:true,historical:true,recordedDuplicates:historicalDuplicates,duplicates:parsed.duplicates,repeatedAwbs:parsed.repeatedAwbs,repeatedUniqueCount:parsed.repeatedUniqueCount,previouslySavedCount:existingAwbs.length,previouslySavedAwbs:existingAwbs.slice(0,200),
    message:'Historical duplicate scan saved. Shipment tracking records were not changed.'});
  }
  for(let i=0;i<parsed.records.length;i+=200){
   const part=parsed.records.slice(i,i+200);
   await sql.query("INSERT INTO mayavi_jepo_tracking (awb,service,vendor,consignee,destination,chargeable_weight,jp_code,booking_date,imported_by,import_file) SELECT x.awb,x.service,x.vendor,x.consignee,x.destination,x.weight,x.jp_code,NULLIF(x.booking_date,'')::date,$2,$3 FROM jsonb_to_recordset($1::jsonb) AS x(awb text,service text,vendor text,consignee text,destination text,weight numeric,jp_code text,booking_date text) ON CONFLICT (awb) DO UPDATE SET service=COALESCE(NULLIF(EXCLUDED.service,''),mayavi_jepo_tracking.service),vendor=COALESCE(NULLIF(EXCLUDED.vendor,''),mayavi_jepo_tracking.vendor),consignee=COALESCE(NULLIF(EXCLUDED.consignee,''),mayavi_jepo_tracking.consignee),destination=COALESCE(NULLIF(EXCLUDED.destination,''),mayavi_jepo_tracking.destination),chargeable_weight=COALESCE(EXCLUDED.chargeable_weight,mayavi_jepo_tracking.chargeable_weight),jp_code=COALESCE(NULLIF(EXCLUDED.jp_code,''),mayavi_jepo_tracking.jp_code),booking_date=COALESCE(EXCLUDED.booking_date,mayavi_jepo_tracking.booking_date),imported_by=EXCLUDED.imported_by,import_file=EXCLUDED.import_file,updated_at=NOW()",
    [JSON.stringify(part.map(r=>({...r,weight:r.weight,jp_code:r.jpCode,booking_date:r.bookingDate||''}))),session.username,fileName]);
  }
  const recordedDuplicates=await saveDuplicateAudit(sql,{parsed,existingAwbs,fileName,username:session.username});
  return json({ok:true,saved:parsed.records.length,recordedDuplicates,invalid:parsed.invalid,duplicates:parsed.duplicates,missingFields:parsed.missingFields,
   repeatedAwbs:parsed.repeatedAwbs,repeatedUniqueCount:parsed.repeatedUniqueCount,
   previouslySavedCount:existingAwbs.length,previouslySavedAwbs:existingAwbs.slice(0,200),
   missingDates:parsed.missingDates,message:'JEPO AWBs saved. Repeated AWBs acknowledged and existing verified tracking retained.'});
 }catch(e){console.error('jepo_tracking_upload',String(e?.message||e).slice(0,220));return json({ok:false,error:'JEPO Excel upload failed; please verify file and retry.'},503);}
}
export async function PATCH(request){
 try{
  const sql=db();
  if(!await auth(request,sql))return json({ok:false,error:'Admin login required.'},403);
  const body=await request.json().catch(()=>({}));
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
