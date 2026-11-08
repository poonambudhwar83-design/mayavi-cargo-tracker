import {readJepoTrackingBatch} from './jepoBranchBrowser.js';
import {cleanJepoTrackingNo} from './jepoBranchTracking.js';

export async function ensureJepoTrackingTable(sql){
 await sql.query("CREATE TABLE IF NOT EXISTS mayavi_jepo_tracking (awb TEXT PRIMARY KEY, service TEXT NOT NULL DEFAULT '', vendor TEXT NOT NULL DEFAULT '', consignee TEXT NOT NULL DEFAULT '', destination TEXT NOT NULL DEFAULT '', chargeable_weight NUMERIC(15,3), jp_code TEXT NOT NULL DEFAULT '', booking_date DATE, status TEXT NOT NULL DEFAULT 'PENDING', live_status TEXT NOT NULL DEFAULT '', carrier_awb TEXT NOT NULL DEFAULT '', live_remarks TEXT NOT NULL DEFAULT '', live_event_when TEXT NOT NULL DEFAULT '', delivered_on DATE, delivery_date_source TEXT NOT NULL DEFAULT '', checked_at TIMESTAMPTZ, tracking_error TEXT NOT NULL DEFAULT '', imported_by TEXT NOT NULL DEFAULT '', import_file TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
 await sql.query("CREATE INDEX IF NOT EXISTS mayavi_jepo_tracking_status_checked_idx ON mayavi_jepo_tracking(status,checked_at)");
 await sql.query("CREATE INDEX IF NOT EXISTS mayavi_jepo_tracking_booking_idx ON mayavi_jepo_tracking(booking_date DESC)");
}

// Reuse the exact verified JEPO browser reader already used for Jind/Karnal.
// Failed website checks never erase saved scan statuses or delivery dates.
export async function syncJepoTrackingAwbs(sql,numbers,{concurrency=6}={}){
 const awbs=[...new Set((numbers||[]).map(cleanJepoTrackingNo).filter(Boolean))].slice(0,100);
 if(!awbs.length)return {checked:0,updated:0,failed:0,pending:0,results:[]};
 await ensureJepoTrackingTable(sql);
 let checked=0,updated=0,failed=0;
 const results=[];
 async function save(result){
  checked++;
  if(result?.ok){
   try{
    const mapped=result.mappedStatus||'';
    await sql.query("UPDATE mayavi_jepo_tracking SET live_status=CASE WHEN $2<>'' THEN $2 ELSE live_status END,carrier_awb=$3,live_remarks=$4,live_event_when=$5,checked_at=NOW(),tracking_error='', status=CASE WHEN $6='DELIVERED' THEN 'DELIVERED' WHEN status='DELIVERED' THEN 'DELIVERED' WHEN $6 IN ('PRE_TRANSIT','IN_TRANSIT','OUT_FOR_DELIVERY','DISPATCHED') THEN $6 ELSE status END,delivered_on=CASE WHEN $6='DELIVERED' AND $7::date IS NOT NULL THEN $7::date ELSE delivered_on END,delivery_date_source=CASE WHEN $6='DELIVERED' AND $7::date IS NOT NULL THEN 'JEPO' ELSE delivery_date_source END,updated_at=NOW() WHERE awb=$1",
     [result.awb,result.liveStatus,result.carrierAwb||'',result.liveRemarks||'',result.liveEventWhen||'',mapped,result.deliveredDate||null]);
    updated++;
    results.push({awb:result.awb,ok:true,status:result.liveStatus,progress:result.liveRemarks||'',progressOnly:Boolean(result.progressOnly),deliveredOn:result.deliveredDate||null});
    return;
   }catch(e){
    console.error('jepo_tracking_save',String(e?.message||e).slice(0,150));
    result={awb:result.awb,ok:false,error:'Verified update could not be saved.'};
   }
  }
  failed++;
  try{
   await sql.query("UPDATE mayavi_jepo_tracking SET checked_at=NOW(),tracking_error=$2 WHERE awb=$1",
    [result.awb,String(result.error||'JEPO website unavailable').slice(0,240)]);
  }catch(e){console.error('jepo_tracking_save_error',String(e?.message||e).slice(0,150));}
  results.push({awb:result.awb,ok:false,error:result.error});
 }
 await readJepoTrackingBatch(awbs,save,{concurrency,allowProgressOnly:true});
 return {checked,updated,failed,pending:Math.max(0,awbs.length-checked),results};
}
