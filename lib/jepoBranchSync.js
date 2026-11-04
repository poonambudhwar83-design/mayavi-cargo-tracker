import {readJepoTrackingBatch} from './jepoBranchBrowser.js';
import {cleanJepoTrackingNo} from './jepoBranchTracking.js';

// Separate live source fields never alter prices, amounts, branch or notes.
export async function ensureJepoBranchColumns(sql){
 await sql`ALTER TABLE mayavi_branch_loads ADD COLUMN IF NOT EXISTS jepo_live_status TEXT NOT NULL DEFAULT ''`;
 await sql`ALTER TABLE mayavi_branch_loads ADD COLUMN IF NOT EXISTS jepo_live_remarks TEXT NOT NULL DEFAULT ''`;
 await sql`ALTER TABLE mayavi_branch_loads ADD COLUMN IF NOT EXISTS jepo_live_checked_at TIMESTAMPTZ`;
 await sql`ALTER TABLE mayavi_branch_loads ADD COLUMN IF NOT EXISTS jepo_live_error TEXT NOT NULL DEFAULT ''`;
}
export async function syncJepoBranchAwbs(sql,numbers=[]){
 const awbs=[...new Set(numbers.map(cleanJepoTrackingNo).filter(Boolean))].slice(0,8);
 if(!awbs.length)return {checked:0,updated:0,failed:0,results:[]};
 await ensureJepoBranchColumns(sql);
 let tracked;
 try{tracked=await readJepoTrackingBatch(awbs);}
 catch(e){tracked=awbs.map(awb=>({awb,ok:false,error:String(e?.message||e).slice(0,240)}));}
 let updated=0,failed=0;
 const results=[];
 for(const result of tracked){
  if(result.ok){
    const mapped=result.mappedStatus||'';
    await sql`UPDATE mayavi_branch_loads SET
      jepo_live_status=${result.liveStatus},jepo_live_remarks=${result.liveRemarks},
      jepo_live_checked_at=NOW(),jepo_live_error='',
      delivery_status=CASE
        WHEN ${mapped}='DELIVERED' THEN 'DELIVERED'
        WHEN delivery_status='DELIVERED' THEN delivery_status
        WHEN ${mapped} IN ('PRE_TRANSIT','IN_TRANSIT','OUT_FOR_DELIVERY','DISPATCHED')
          THEN ${mapped}
        ELSE delivery_status END
      WHERE UPPER(BTRIM(tracking_no))=${result.awb}`;
    updated++;results.push({awb:result.awb,ok:true,status:result.liveStatus,remarks:result.liveRemarks});
  }else{
    failed++;
    await sql`UPDATE mayavi_branch_loads SET jepo_live_checked_at=NOW(),
      jepo_live_error=${String(result.error||'Tracking unavailable').slice(0,250)}
      WHERE UPPER(BTRIM(tracking_no))=${result.awb}`;
    results.push({awb:result.awb,ok:false,error:result.error});
  }
 }
 return {checked:tracked.length,updated,failed,results};
}
