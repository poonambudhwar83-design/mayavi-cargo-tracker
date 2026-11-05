// Per-master export extra bag categories. Independent of the shipment's existing bags.
export const EXPORT_BAG_CODES=['D','T','DT','GC'];
export const EXPORT_BAG_CATEGORIES={
  D:{label:'D',clientRate:10000,deductionRate:6000},
  T:{label:'T',clientRate:6000,deductionRate:6000},
  DT:{label:'DT',clientRate:6000,deductionRate:6000},
  GC:{label:'G&C',clientRate:500,deductionRate:300}
};
export function validateExportBagCount(value){
  const text=String(value??'').trim();
  if(!/^(?:0|[1-9]\d{0,5})$/.test(text))return null;
  const count=Number(text);
  return Number.isSafeInteger(count)&&count<=100000?count:null;
}
// G&C client charge depends on the client: TPL and OVERSEAS ₹300/bag;
// all other clients ₹500/bag. D/T/DT old deductions are provisional until revised.
export function exportCategoryClientRate(code,clientName=''){
  if(code==='GC'&&/\b(?:TPL|OVERSEAS)\b/i.test(String(clientName||'').trim()))return 300;
  return EXPORT_BAG_CATEGORIES[code]?.clientRate??0;
}
export function exportCategorySummary(counts={},clientName=''){
  const items={};
  let clientCharge=0,deduction=0,netProfit=0;
  for(const code of EXPORT_BAG_CODES){
    const category=EXPORT_BAG_CATEGORIES[code];
    const raw=Number(counts?.[code]??0);
    const bags=Number.isSafeInteger(raw)&&raw>=0?raw:0;
    const charge=bags*exportCategoryClientRate(code,clientName);
    const cost=bags*category.deductionRate;
    items[code]={bags,clientCharge:charge,deduction:cost,netProfit:charge-cost};
    clientCharge+=charge;deduction+=cost;netProfit+=charge-cost;
  }
  return {items,clientCharge,deduction,netProfit};
}
