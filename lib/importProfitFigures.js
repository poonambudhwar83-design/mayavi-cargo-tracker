import {proteinHandlingRate} from './importProteinDeduction.js';
import {importFreightRegion,importFreightRate,importTotalCost,importNetProfit,importExcessProfit,importProfitIncludingExcess,importProteinGoodsChargePerBag,importHHGoodsChargePerBag,importGoodsCharge15Percent,importGrossProfit} from './importFreightCost.js';

export const DRIVER_EXPENSE_PER_MAWB=2600;
export const dataNumber=value=>value===null||value===undefined||value===''?null:Number(value);
export function figures(row={}){
  const kg=dataNumber(row.weight);
  const rawExtra=dataNumber(row.excessWeight);
  const excessWeight=rawExtra!==null&&Number.isFinite(rawExtra)&&rawExtra>=0?rawExtra:null;
  // Duty is a per-part expense. Other master charges retain their allocation.
  const duty=dataNumber(row.totalDuty);
  const allocation=Number.isFinite(Number(row.allocationRatio))?Number(row.allocationRatio):1;
  const rate=dataNumber(row.rate);
  const eici=kg===null?null:15*kg;
  const bags=dataNumber(row.bags);
  const averageWeightPerBag=kg!==null&&Number.isFinite(kg)&&bags!==null&&Number.isFinite(bags)&&bags>0?kg/bags:null;
  const category=String(row.goodsCategory||'').toUpperCase();
  const origin=String(row.origin||'').trim().toUpperCase();
  // Protein bag charges come from the shipment's original origin,
  // never Via or destination. JFK now follows all other USA origins.
  const chargePerBag=category==='HH'?importHHGoodsChargePerBag(origin,row.clientName||row.client):
    category==='CLOTHES'||category==='BATTERY'||category==='SWITCH'?1500:
    category==='PROTEIN'?importProteinGoodsChargePerBag(origin):null;
  // Battery and Switch are charged on actual bags in each physical part, not a master override.
  const goodsCharge=bags===null||chargePerBag===null?null:bags*chargePerBag;
  const goodsCharge15Percent=importGoodsCharge15Percent(goodsCharge,chargePerBag);
  const dutyPerKg=kg>0&&duty!==null?duty/kg:null;
  // Profit is earned at the manually entered selling rate per kg, never a fixed tariff.
  // Do not show a misleading profit until all the required inputs are available.
  // Canada, Germany and USA departures: ₹80/kg; DXB and all others: ₹50/kg.
  // Keep this handling deduction separate from existing airport freight costs.
  const proteinDeduction=category==='PROTEIN'&&kg!==null?proteinHandlingRate(origin)*kg:0;
  // Freight is ONLY for Protein. Clothes/HH/Battery/other goods pay no
  // origin freight, even when they depart DXB, Canada, USA or Germany.
  // USA includes JFK; no origin freight can be applied twice.
  const freightRegion=importFreightRegion(origin,category);
  const freightRate=importFreightRate(origin,category);
  const freightCharge=kg===null?null:Math.round(freightRate*kg*100)/100;
  const dxbFreightDeduction=freightRegion==='DXB'?freightCharge:0;
  const usaFreightDeduction=freightRegion==='USA'?freightCharge:0;
  const canadaFreightDeduction=freightRegion==='CANADA'?freightCharge:0;
  const germanyFreightDeduction=freightRegion==='GERMANY'?freightCharge:0;
  const siibDeduction=category==='CLOTHES'&&kg!==null?30*kg:0;
  // Driver expense is set ONCE for the master; distribute it proportionally
  // across physical rows to avoid charging it repeatedly for every part.
  const masterDriverExpense=dataNumber(row.driverExpense)??DRIVER_EXPENSE_PER_MAWB;
  const driverExpense=Math.round(masterDriverExpense*allocation*100)/100;
  // Total Cost includes genuine freight, duty, handling, driver and goods
  // expenses, but NO extra 15% Goods Charge for any goods or client.
  const totalCost=importTotalCost({duty,eici,driverExpense,goodsCharge,freightCharge,proteinDeduction,siibDeduction});
  const baseProfit=importNetProfit(rate,kg,totalCost);
  const excessProfit=importExcessProfit(rate,excessWeight);
  const profit=importProfitIncludingExcess(baseProfit,excessProfit);
  // Re-add only the Protein/Clothes deductions already included in net Profit.
  // Origin freight, 15% Goods Charge reporting and all other cost rules are unchanged.
  const grossProfit=importGrossProfit(profit,proteinDeduction,siibDeduction);
  const profitPerKg=profit===null||kg===null||kg<=0?null:profit/kg;
  return {kg,excessWeight,excessProfit,baseProfit,bags,averageWeightPerBag,duty,rate,eici,goodsCharge,goodsCharge15Percent,chargePerBag,totalCost,dutyPerKg,proteinDeduction,freightRegion,freightRate,freightCharge,dxbFreightDeduction,usaFreightDeduction,canadaFreightDeduction,germanyFreightDeduction,siibDeduction,driverExpense,profit,profitPerKg,grossProfit};
}
