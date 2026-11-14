import {branchPayoutForRecord} from './branchLoads.js';

// Client-side reporting only. The authenticated branch-loads API already
// returns only the logged-in employee's branch (Admin may see both branches).
// Group by ORIGINAL booking date, even after an entry is delivered.
export function aggregateDailyBranchLoads(rows=[]){
  const grouped=new Map();
  for(const row of rows||[]){
    const branch=String(row?.branch||'').toUpperCase();
    const date=String(row?.date||'');
    if(!['JIND','KARNAL'].includes(branch)||!/^20\d{2}-\d{2}-\d{2}$/.test(date))continue;
    const key=branch+'|'+date;
    const previous=grouped.get(key)||{branch,date,loads:0,weightThousandths:0,branchAmountPaise:0};
    const weight=Number(row.weight||0),branchAmount=branchPayoutForRecord(row);
    grouped.set(key,{
      ...previous,
      loads:previous.loads+1,
      weightThousandths:previous.weightThousandths+(Number.isFinite(weight)?Math.round(weight*1000):0),
      branchAmountPaise:previous.branchAmountPaise+(Number.isFinite(branchAmount)?Math.round(branchAmount*100):0)
    });
  }
  return [...grouped.values()].map(x=>({
    branch:x.branch,date:x.date,loads:x.loads,
    weight:x.weightThousandths/1000,
    branchAmount:x.branchAmountPaise/100
  })).sort((a,b)=>b.date.localeCompare(a.date)||a.branch.localeCompare(b.branch));
}

// One row per BOOKING date, combining Jind and Karnal when the current user's
// permissions / branch filter allow both. Each saved shipment counts only once.
// Reuse paise/thousandths rounding to avoid floating point drift in totals.
export function aggregateBranchDayTotals(dailyBranchRows=[]){
  const grouped=new Map();
  for(const row of dailyBranchRows){
    if(!/^20\\d{2}-\\d{2}-\\d{2}$/.test(String(row?.date||'')))continue;
    const prev=grouped.get(row.date)||{date:row.date,loads:0,weightThousandths:0,branchAmountPaise:0};
    prev.loads+=Number(row.loads)||0;
    prev.weightThousandths+=Math.round((Number(row.weight)||0)*1000);
    prev.branchAmountPaise+=Math.round((Number(row.branchAmount)||0)*100);
    grouped.set(row.date,prev);
  }
  return [...grouped.values()].map(row=>({
    date:row.date,loads:row.loads,weight:row.weightThousandths/1000,
    branchAmount:row.branchAmountPaise/100
  })).sort((a,b)=>b.date.localeCompare(a.date));
}
