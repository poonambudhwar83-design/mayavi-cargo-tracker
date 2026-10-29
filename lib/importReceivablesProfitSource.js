import {physicalImportProfitRows,selectImportProfitRows} from './importProfitPhysicalRows.js';
import {profitMonths,currentProfitMonth} from './profitPeriod.js';

// Exactly mirror Import Profit Sheet's monthly physical-row inclusion, then
// decide whether the entire master has completed Customs Clear. This avoids
// taking historical receivables from a separate Customs Cleared listing.
export function clearedMasterInImportProfit(data={},awb='',months=profitMonths(),current=currentProfitMonth()){
  const physical=physicalImportProfitRows(data,awb);
  const visible=new Map();
  for(const month of months){
    for(const row of selectImportProfitRows(data,awb,month,current)){
      if(row.isActiveMaster===false)visible.set(row.rowKey,row);
    }
  }
  const fullyCleared=physical.length>0&&physical.every(p=>
    p.isActiveMaster===false && visible.has(p.rowKey));
  const rows=fullyCleared?[...visible.values()]:[];
  const dates=rows.map(r=>String(r.arrivalDate||'').trim())
    .filter(Boolean).sort();
  return {
    eligible:fullyCleared,
    profitRowCount:rows.length,
    profitArrivalDate:dates.at(-1)||'',
    // one receivable per master; never charge each physical part separately
    source:'IMPORT_PROFIT_SHEET'
  };
}
