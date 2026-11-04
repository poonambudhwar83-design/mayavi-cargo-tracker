import {readJepoTrackingBatch} from './jepoBranchBrowser.js';
import {cleanJepoTrackingNo} from './jepoBranchTracking.js';

// Separate live source fields never alter prices, amounts, branch or notes.
export async function ensureJepoBranchColumns(sql){
 await sql`ALTER TABLE mayavi_branch_loads ADD COLUMN IF NOT EXISTS jepo_live_status TEXT NOT NULL DEFAULT ''`;
 await sql`ALTER TABLE mayavi_branch_loads ADD COLUMN IF NOT EXISTS jepo_live_awb TEXT NOT NULL DEFAULT ''`;
 await sql`ALTER TABLE mayavi_branch_loads ADD COLUMN IF NOT EXISTS jepo_live_remarks TEXT NOT NULL DEFAULT ''`;
 await sql`ALTER TABLE mayavi_branch_loads ADD COLUMN IF NOT EXISTS jepo_live_checked_at TIMESTAMPTZ`;
 await sql`ALTER TABLE mayavi_branch_loads ADD COLUMN IF NOT EXISTS jepo_live_error TEXT NOT NULL DEFAULT ''`;
 await sql`ALTER TABLE mayavi_branch_loads ADD COLUMN IF NOT EXISTS delivered_on DATE`;
 await sql`ALTER TABLE mayavi_branch_loads ADD COLUMN IF NOT EXISTS delivery_date_source TEXT NOT NULL DEFAULT ''`;
}
export async function syncJepoBranchAwbs(sql,numbers=[],{concurrency=8}={}){
  // A single scheduled run covers every JEPO number, not 16 serial numbers.
  // Eight independent browser tabs read statuses concurrently. Every result
  // is stored as soon as it arrives, preserving progress on partial failures.
  const awbs=[...new Set(numbers.map(cleanJepoTrackingNo).filter(Boolean))].slice(0,240);
  if(!awbs.length)return {checked:0,updated:0,failed:0,pending:0,results:[]};
  await ensureJepoBranchColumns(sql);
  let updated=0,failed=0,checked=0;
  const results=[];
  const persist=async result=>{
    checked++;
    if(result.ok){
      const mapped=result.mappedStatus||'';
      try{
        await sql`UPDATE mayavi_branch_loads SET
          jepo_live_status=${result.liveStatus},jepo_live_awb=${result.awb},jepo_live_remarks=${result.liveRemarks},
          jepo_live_checked_at=NOW(),jepo_live_error='',
          delivered_on=CASE
            WHEN ${mapped}='DELIVERED' AND ${result.deliveredDate||''}<>'' THEN ${result.deliveredDate||null}::date
            ELSE delivered_on END,
          delivery_date_source=CASE
            WHEN ${mapped}='DELIVERED' AND ${result.deliveredDate||''}<>'' THEN 'JEPO'
            ELSE delivery_date_source END,
          delivery_status=CASE
            WHEN ${mapped}='DELIVERED' THEN 'DELIVERED'
            WHEN delivery_status='DELIVERED' THEN delivery_status
            WHEN ${mapped} IN ('PRE_TRANSIT','IN_TRANSIT','OUT_FOR_DELIVERY','DISPATCHED')
              THEN ${mapped}
            ELSE delivery_status END
          WHERE UPPER(BTRIM(tracking_no))=${result.awb}`;
        updated++;
        results.push({awb:result.awb,ok:true,status:result.liveStatus,remarks:result.liveRemarks});
        return;
      }catch(error){
        console.error('jepo_save_status',String(error?.message||error).slice(0,180));
        result={awb:result.awb,ok:false,error:'Unable to save verified website response'};
      }
    }
    failed++;
    try{
      await sql`UPDATE mayavi_branch_loads SET jepo_live_checked_at=NOW(),
        jepo_live_awb=${result.awb},jepo_live_error=${String(result.error||'Tracking unavailable').slice(0,250)}
        WHERE UPPER(BTRIM(tracking_no))=${result.awb}`;
    }catch(error){console.error('jepo_save_error',String(error?.message||error).slice(0,180));}
    results.push({awb:result.awb,ok:false,error:result.error});
  };
  await readJepoTrackingBatch(awbs,persist,{concurrency});
  return {checked,updated,failed,pending:Math.max(0,awbs.length-checked),results};
}
