import {proteinHandlingRate} from './importProteinDeduction.js';
import {resolvedExportShipmentCharge} from './exportShipmentCharge.js';
import {importFreightRate,importTotalCost,importNetProfit,importExcessProfit,importProfitIncludingExcess,importProteinGoodsChargePerBag,importGoodsCharge15Percent,importGrossProfit} from './importFreightCost.js';

const dataNumber=value=>value===null||value===undefined||value===''?null:Number(value);
const round=value=>Math.round((value+Number.EPSILON)*100)/100;
export function monthlyAmount(value){
  if(value===null||value===undefined||String(value).trim()==='')return null;
  const raw=String(value).replace(/,/g,'').trim();
  if(!/^\d+(?:\.\d{1,2})?$/.test(raw))return null;
  const parsed=Number(raw);
  return Number.isFinite(parsed)&&parsed>=0&&parsed<=999999999?round(parsed):null;
}
// Must mirror the Import Profit Sheet's actual physical-part figures, including
// driver-expense allocation, freight, excess weight and eligibility of the
// display-only 15% Goods Charge. Regression tests enforce formula parity.
export function monthlyImportFigures(row={}){
  const kg=dataNumber(row.weight);
  const rawExtra=dataNumber(row.excessWeight);
  const excessWeight=rawExtra!==null&&Number.isFinite(rawExtra)&&rawExtra>=0?rawExtra:null;
  const duty=dataNumber(row.totalDuty);
  const allocation=Number.isFinite(Number(row.allocationRatio))?Number(row.allocationRatio):1;
  const rate=dataNumber(row.rate);
  const eici=kg===null?null:15*kg;
  const bags=dataNumber(row.bags);
  const category=String(row.goodsCategory||'').toUpperCase();
  const origin=String(row.origin||'').trim().toUpperCase();
  const isHkgOrigin=/(^|[^A-Z0-9])(HKG|HONG[ -]?KONG)($|[^A-Z0-9])/.test(origin);
  const chargePerBag=category==='HH'?(isHkgOrigin?1500:340):
    category==='CLOTHES'||category==='BATTERY'?1500:
    category==='PROTEIN'?importProteinGoodsChargePerBag(origin):null;
  const goodsCharge=bags===null||chargePerBag===null?null:bags*chargePerBag;
  const goodsCharge15Percent=importGoodsCharge15Percent(goodsCharge,chargePerBag);
  const proteinDeduction=category==='PROTEIN'&&kg!==null?proteinHandlingRate(origin)*kg:0;
  const freightRate=importFreightRate(origin,category);
  const freightCharge=kg===null?null:round(freightRate*kg);
  const siibDeduction=category==='CLOTHES'&&kg!==null?30*kg:0;
  const masterDriverExpense=dataNumber(row.driverExpense)??2600;
  const driverExpense=round(masterDriverExpense*allocation);
  const totalCost=importTotalCost({duty,eici,driverExpense,goodsCharge,freightCharge,proteinDeduction,siibDeduction});
  const baseProfit=importNetProfit(rate,kg,totalCost);
  const excessProfit=importExcessProfit(rate,excessWeight);
  const profit=importProfitIncludingExcess(baseProfit,excessProfit);
  const grossProfit=importGrossProfit(profit,proteinDeduction,siibDeduction);
  return {profit,grossProfit,goodsCharge15Percent};
}
export function sumMonthlyImport(rows=[]){
  let grossProfit=0,goodsCharge15Percent=0,completed=0,eligible15=0;
  for(const row of rows){
    const figure=monthlyImportFigures(row);
    // Import Profit Sheet footer counts only rows with positive weight and completed figures.
    if(Number(row.weight)>0&&figure.grossProfit!==null){grossProfit=round(grossProfit+figure.grossProfit);completed++}
    if(figure.goodsCharge15Percent!==null){goodsCharge15Percent=round(goodsCharge15Percent+figure.goodsCharge15Percent);eligible15++}
  }
  return {grossProfit,goodsCharge15Percent,completed,totalRows:rows.length,eligible15};
}
export function sumMonthlyExport(rows=[]){
  let grossProfit=0,completed=0;
  for(const row of rows){
    // Match the Export Profit Sheet's profitFor() (positive-weight rows only).
    const weight=Number(row.weight),rate=Number(row.rate)||6;
    if(row.weight===null||row.weight===''||!Number.isFinite(weight)||weight<=0)continue;
    const profit=round(weight*rate-resolvedExportShipmentCharge(row.shipmentCharge));
    if(Number.isFinite(profit)){grossProfit=round(grossProfit+profit);completed++}
  }
  return {grossProfit,completed,totalRows:rows.length};
}
export function calculateMonthlyExpenses({importGross=0,exportGross=0,jind=0,karnal=0,goods15=0,salaryCash=0,salaryAccount=0,rent=0,office=0,rooms=0,misc=0}={}){
  const values=[importGross,exportGross,jind,karnal,goods15,salaryCash,salaryAccount,rent,office,rooms,misc];
  if(values.some(n=>typeof n!=='number'||!Number.isFinite(n)))return null;
  const totalIncome=round(importGross+exportGross+jind+karnal+goods15);
  const totalSalary=round(salaryCash+salaryAccount);
  const totalExpenses=round(totalSalary+rent+office+rooms+misc);
  return {totalIncome,totalSalary,totalExpenses,finalProfit:round(totalIncome-totalExpenses)};
}
