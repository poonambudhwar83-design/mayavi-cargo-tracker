import {neon} from '@neondatabase/serverless';
import ExcelJS from 'exceljs';
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

export async function GET(request){
 try{
  const sql=db();
  if(!await auth(request,sql,{readOnlyAllowed:true}))return json({ok:false,error:'Admin or Haryana Admin login required.'},403);
  await ensureJepoTrackingTable(sql);
  const rows=await sql.query("SELECT "+columns+" FROM mayavi_jepo_tracking ORDER BY CASE WHEN status='DELIVERED' THEN 1 ELSE 0 END, booking_date DESC NULLS LAST, created_at DESC LIMIT 20000");
  return json({ok:true,rows:rows.map(rowData)});
 }catch(e){console.error('jepo_tracking_get',String(e?.message||e).slice(0,180));return json({ok:false,error:'JEPO Tracking records could not be loaded.'},503);}
}
export async function POST(request){
 try{
  const sql=db();
  if(!await auth(request,sql))return json({ok:false,error:'Admin login required.'},403);
  const form=await request.formData();
  const action=String(form.get('action')||'preview');
  if(!['preview','save'].includes(action))return json({ok:false,error:'Unsupported action.'},400);
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
  let parsed;
  try{parsed=parseJepoExcel(workbook,{sheetName:String(form.get('sheetName')||''),headerRow:isCsv?1:Number(form.get('headerRow')||0)});}
  catch(e){return json({ok:false,error:String(e?.message||'Excel column mapping failed.')},422);}
  await ensureJepoTrackingTable(sql);
  const existingAwbs=await existingJepoAwbs(sql,parsed.records);
  if(action==='preview')return json({ok:true,sheetName:parsed.sheetName,headerRow:parsed.headerRow,mapping:parsed.columnMapping,columnMatches:parsed.columnMatches,missingFields:parsed.missingFields,
   total:parsed.records.length,invalid:parsed.invalid,duplicates:parsed.duplicates,missingDates:parsed.missingDates,
   repeatedAwbs:parsed.repeatedAwbs,repeatedUniqueCount:parsed.repeatedUniqueCount,
   previouslySavedCount:existingAwbs.length,previouslySavedAwbs:existingAwbs.slice(0,200),
   preview:parsed.records.slice(0,12)});
  const fileName=String(file.name||'jepo.xlsx').replace(/[/\\\u0000-\u001f]/g,'_').slice(0,150);
  const session=readSession(request);
  for(let i=0;i<parsed.records.length;i+=200){
   const part=parsed.records.slice(i,i+200);
   await sql.query("INSERT INTO mayavi_jepo_tracking (awb,service,vendor,consignee,destination,chargeable_weight,jp_code,booking_date,imported_by,import_file) SELECT x.awb,x.service,x.vendor,x.consignee,x.destination,x.weight,x.jp_code,NULLIF(x.booking_date,'')::date,$2,$3 FROM jsonb_to_recordset($1::jsonb) AS x(awb text,service text,vendor text,consignee text,destination text,weight numeric,jp_code text,booking_date text) ON CONFLICT (awb) DO UPDATE SET service=COALESCE(NULLIF(EXCLUDED.service,''),mayavi_jepo_tracking.service),vendor=COALESCE(NULLIF(EXCLUDED.vendor,''),mayavi_jepo_tracking.vendor),consignee=COALESCE(NULLIF(EXCLUDED.consignee,''),mayavi_jepo_tracking.consignee),destination=COALESCE(NULLIF(EXCLUDED.destination,''),mayavi_jepo_tracking.destination),chargeable_weight=COALESCE(EXCLUDED.chargeable_weight,mayavi_jepo_tracking.chargeable_weight),jp_code=COALESCE(NULLIF(EXCLUDED.jp_code,''),mayavi_jepo_tracking.jp_code),booking_date=COALESCE(EXCLUDED.booking_date,mayavi_jepo_tracking.booking_date),imported_by=EXCLUDED.imported_by,import_file=EXCLUDED.import_file,updated_at=NOW()",
    [JSON.stringify(part.map(r=>({...r,weight:r.weight,jp_code:r.jpCode,booking_date:r.bookingDate||''}))),session.username,fileName]);
  }
  return json({ok:true,saved:parsed.records.length,invalid:parsed.invalid,duplicates:parsed.duplicates,missingFields:parsed.missingFields,
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
