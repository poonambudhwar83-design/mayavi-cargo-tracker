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
    const weight=Number(row.weight||0),branchAmount=Number(row.paidToBranch||0);
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
