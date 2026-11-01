import assert from 'node:assert/strict';
import {physicalImportProfitRows,selectImportProfitRows} from '../lib/importProfitPhysicalRows.js';
import {proteinHandlingRate} from '../lib/importProteinDeduction.js';
import {IMPORT_FREIGHT_RATES,importFreightRegion,importFreightRate,importTotalCost,importNetProfit,importExcessProfit,importProfitIncludingExcess,importProteinGoodsChargePerBag,importGoodsCharge15Percent,importGrossProfit} from '../lib/importFreightCost.js';
import {readFileSync} from 'node:fs';
const month='2026-10';
const mk=(awb,data)=>selectImportProfitRows(data,awb,month,month);
const normal={weight:'500',bags:'20',arrivalDate:'2026-10-20',customsCleared:true};
assert.equal(mk('15712345678',normal).length,1);
assert.equal(mk('15712345678',{...normal,arrivalDate:'2026-09-20'}).length,0);
assert.equal(mk('15712345678',{...normal,customsCleared:false,arrivalDate:''}).length,1);
const emirates={weight:'1860',bags:'72',partLoad:true,isPartLoad:true,arrivalDate:'2026-10-08',
  partShipments:[
    {partKey:'EK-1',pieces:5,weight:'129.17',arrivalDate:'2026-10-08',arrivalIsActual:true,customsCleared:true},
    {partKey:'EK-2',pieces:67,weight:'1730.83',arrivalDate:'2026-10-08',arrivalIsActual:true,customsCleared:true}
  ]};
const ek=mk('17666588771',emirates);
assert.equal(ek.length,2);assert.equal(ek.filter(x=>!x.isActiveMaster).length,2);
assert.equal(ek.reduce((n,p)=>n+(p.weight||0),0),1860);
assert.ok(Math.abs(ek.reduce((n,p)=>n+p.allocationRatio,0)-1)<1e-8);
assert.ok(ek.every(x=>x.rowKey.includes('::')));
const partial={...emirates,partShipments:[
  {...emirates.partShipments[0],customsCleared:true},
  {...emirates.partShipments[1],customsCleared:false,arrivalDate:''}
]};
const mix=mk('17666588771',partial);
assert.equal(mix.length,2);
assert.equal(mix.filter(x=>x.isActiveMaster).length,1);
assert.equal(mix.filter(x=>!x.isActiveMaster).length,1);
assert.equal(mk('17666588771',{...emirates,partShipments:[
  {...emirates.partShipments[0],arrivalDate:'2026-09-30'},
  emirates.partShipments[1]
]}).length,1);
const sal={weight:'1147/2565',bags:'49/99',partLoad:true,isPartLoad:true,
  totalPieces:99,arrivedPieces:49,status:'IN TRANSIT',partShipments:[
    {partKey:'SV760|2026-10-24|49|1147',pieces:49,weight:1147,arrivalDate:'2026-10-24',arrivalIsActual:true,customsCleared:true},
    {partKey:'SV760|2026-10-24|49|1147',pieces:49,weight:1147,arrivalDate:'',arrivalIsActual:false,status:'DEPARTED'}
  ]};
const sa=mk('06511493661',sal);
assert.equal(sa.length,2);
assert.equal(sa.filter(p=>p._saudiaPendingVirtual).length,1);
assert.equal(sa.reduce((n,p)=>n+(p.bags||0),0),99);
assert.equal(sa.reduce((n,p)=>n+(p.weight||0),0),2565);
const full={...emirates,partLoad:false,isPartLoad:false};
assert.equal(mk('17666588771',full).length,1);
const fullIndigo={...emirates,partLoad:true,
  partShipments:[{partKey:'a',pieces:20,weight:550},{partKey:'b',pieces:20,weight:550}],
  masterPieces:20};
assert.equal(mk('31212345678',fullIndigo).length,1);
assert.equal(physicalImportProfitRows({...normal,customsCleared:false},'15712345678').length,1);

// A cloned MAWB never collapses two genuine physical movements into one profit
// row. Clearing a part moves it between source registers without changing the
// MAWB / physical identity; the combined current-month count stays the same.
const mixedParts={...emirates,partShipments:[
  {...emirates.partShipments[0],customsCleared:true,arrivalDate:'2026-10-08'},
  {...emirates.partShipments[1],customsCleared:false,arrivalDate:''}
]};
const cloned=mk('17666588771',mixedParts);
assert.equal(cloned.length,2);
assert.deepEqual(cloned.map(part=>part.rowKey).sort(),physicalImportProfitRows(mixedParts,'17666588771').map(part=>part.rowKey).sort());
assert.equal(new Set(cloned.map(p=>p.rowKey)).size,cloned.length);
assert.deepEqual(cloned.map(p=>p.isActiveMaster).sort(),[false,true]);
assert.equal(cloned.reduce((n,r)=>n+(r.bags||0),0),72);
assert.equal(cloned.reduce((n,r)=>n+(r.weight||0),0),1860);
// A September cleared part is outside October, but October active parts remain.
const earlier={...mixedParts,partShipments:[
  {...mixedParts.partShipments[0],arrivalDate:'2026-09-30'},
  mixedParts.partShipments[1]
]};
assert.equal(mk('17666588771',earlier).length,1);

// Protein handling deduction depends on ORIGIN, not the via airport or final
// destination. Existing DXB, JFK, Canada and Germany freight remain separate.
for(const origin of ['YYZ','YVR','CANADA','TORONTO','FRA','MUC','GERMANY',
  'JFK','USA','UNITED STATES','LAX','SFO','ORD','EWR','ATL','DFW','BOS'])
  assert.equal(proteinHandlingRate(origin),80,origin+' should use 80/kg');
for(const origin of ['DXB','DUBAI','SHJ','HKG','LHR','DOH','DMM','', 'JED'])
  assert.equal(proteinHandlingRate(origin),50,origin+' should use 50/kg');
assert.equal(proteinHandlingRate('DXB')*100,5000);
assert.equal(proteinHandlingRate('JFK')*100,8000);
assert.equal(proteinHandlingRate('YYZ')*100,8000);
assert.equal(proteinHandlingRate('FRA')*100,8000);

// Expense breakdown is counted exactly once for both whole and split shipments.
assert.deepEqual(IMPORT_FREIGHT_RATES,{DXB:173,CANADA:450,USA:410,GERMANY:322});
// New Protein goods charge applies per physical bag, not per kg. USA
// includes JFK (old JFK ₹3,000 rule has been retired).
for(const [origin,expectedBagRate] of [
  ['DXB',3000],['DUBAI',3000],['DWC',3000],['AL MAKTOUM',3000],
  ['JFK',1800],['USA',1800],['LAX',1800],['EWR',1800],['NEW YORK',1800],
  ['CANADA',1800],['YYZ',1800],['YVR',1800],['TORONTO',1800],
  ['GERMANY',1800],['FRA',1800],['MUC',1800],['FRANKFURT',1800],
  ['HKG',1500],['JED',1500],['DOH',1500],['SHJ',1500],['LHR',1500]
]){
  assert.equal(importProteinGoodsChargePerBag(origin),expectedBagRate,
    'Protein goods bag rate for '+origin);
}
assert.equal(importProteinGoodsChargePerBag(''),null);
assert.equal(importProteinGoodsChargePerBag('   '),null);
assert.equal(importProteinGoodsChargePerBag('JFK')*4,7200);
assert.equal(importProteinGoodsChargePerBag('DXB')*4,12000);
assert.equal(importProteinGoodsChargePerBag('YYZ')*4,7200);
assert.equal(importProteinGoodsChargePerBag('FRA')*4,7200);
// Only goods charge is changed: for 4 JFK bags, Total Cost falls ₹4,800
// relative to old ₹3,000/bag, increasing calculated Profit by ₹4,800.
assert.equal(4*(3000-importProteinGoodsChargePerBag('JFK')),4800);
for(const [origin,region,rate] of [['DXB','DXB',173],['DUBAI','DXB',173],['DWC','DXB',173],['YYZ','CANADA',450],
  ['CANADA','CANADA',450],['JFK','USA',410],['USA','USA',410],['LAX','USA',410],
  ['FRA','GERMANY',322],['GERMANY','GERMANY',322],['HKG','',0]]){
  assert.equal(importFreightRegion(origin,'PROTEIN'),region,origin);
  assert.equal(importFreightRate(origin,'PROTEIN'),rate,origin);
  for(const other of ['CLOTHES','HH','BATTERY','SWITCH','', 'OTHER']){
    assert.equal(importFreightRegion(origin,other),'',origin+' '+other+' no freight');
    assert.equal(importFreightRate(origin,other),0,origin+' '+other+' no freight');
  }
}
const dx={duty:5000,eici:1500,driverExpense:2600,goodsCharge:6000,
  freightCharge:17300,proteinDeduction:5000,siibDeduction:0,goodsCharge15Percent:900};
const dxbTotal=importTotalCost(dx);
assert.equal(dxbTotal,37400);
// Legacy 15% Goods Charge input MUST NOT be used anywhere in Import Total
// Cost, so removing a surcharge reduces cost and increases profit.
assert.equal(importTotalCost({...dx,goodsCharge15Percent:99999}),37400);
assert.equal(importNetProfit(500,100,37400),12600);
// Free extra kg must NEVER alter EICI, duty, freight, bags, driver or any cost.
// Base MAWB 100 kg × ₹500 minus ₹37,400 expenses = ₹12,600.
// An extra 10 kg earns ₹5,000 WITHOUT expenses -> final Profit ₹17,600.
assert.equal(importExcessProfit(500,10),5000);
assert.equal(importProfitIncludingExcess(importNetProfit(500,100,37400),importExcessProfit(500,10)),17600);
assert.equal(importTotalCost(dx),37400);
assert.equal(importExcessProfit('555.50','2.25'),1249.88);
assert.equal(importExcessProfit(500,0),0);
assert.equal(importExcessProfit(500,''),null);
assert.equal(importExcessProfit('',10),null);
assert.equal(importExcessProfit(500,-1),null);
assert.equal(importProfitIncludingExcess(importNetProfit(500,100,37400),null),12600);
assert.equal(importProfitIncludingExcess(null,5000),null);
assert.equal(importProfitIncludingExcess(1000,0),1000);
// Part excess kg add individually and never twice for the same MAWB.
const partsExtra=[2.5,3.5].map(kg=>importExcessProfit(500,kg));
assert.deepEqual(partsExtra,[1250,1750]);
assert.equal(partsExtra.reduce((sum,n)=>sum+n,0),3000);
// The otherwise-identical Clothes cargo includes existing expenses but NO
// origin freight or protein handling; clothes SIIB is retained.
const clothesTotal=importTotalCost({...dx,freightCharge:importFreightRate('DXB','CLOTHES')*100,proteinDeduction:0,siibDeduction:3000});
assert.equal(clothesTotal,18100);
assert.equal(importNetProfit(500,100,clothesTotal),31900);
assert.equal(importFreightRate('JFK','CLOTHES'),0);
assert.equal(importFreightRate('YYZ','HH'),0);
assert.equal(importFreightRate('FRA','BATTERY'),0);
assert.equal(importFreightRate('DXB','SWITCH'),0);
assert.equal(importNetProfit(500,100,dxbTotal),12600);
assert.equal(importNetProfit(null,100,dxbTotal),null);
assert.equal(importTotalCost({...dx,duty:null}),null);
const partA=importTotalCost({duty:1000,eici:750,driverExpense:1300,goodsCharge:3000,freightCharge:8650,proteinDeduction:2500,siibDeduction:0,goodsCharge15Percent:450});
const partB=importTotalCost({duty:4000,eici:750,driverExpense:1300,goodsCharge:3000,freightCharge:8650,proteinDeduction:2500,siibDeduction:0,goodsCharge15Percent:450});
assert.equal(partA+partB,dxbTotal);
const profitUi=readFileSync('app/ImportProfitSheet.js','utf8');
const apiSource=readFileSync('app/api/import-profit/route.js','utf8');
assert.ok(profitUi.includes("import {proteinHandlingRate} from '../lib/importProteinDeduction.js';"));
assert.ok(profitUi.includes("const proteinDeduction=category==='PROTEIN'&&kg!==null?proteinHandlingRate(origin)*kg:0;"));
assert.ok(profitUi.includes("['S.No.','MAWB','Client','Goods'"));
assert.ok(profitUi.includes("const columns=['MAWB','Client','Goods'"));
assert.ok(profitUi.includes("return [row.mawb,row.clientName"));
assert.ok(!profitUi.includes("'Part / Register'"));
assert.ok(!profitUi.includes("'Arrival Date','Client'"));
assert.ok(profitUi.includes('colSpan={22}'),'22 Import Profit columns including 15% and Gross Profit');
assert.ok(profitUi.includes('colSpan={4}'));
assert.ok(profitUi.includes('key={row.rowKey||row.mawb}'));
assert.ok(profitUi.includes('const active=row.isActiveMaster===true;'));
assert.ok(apiSource.includes('selectImportProfitRows(data,awb,month,currentProfitMonth())'));
assert.ok(apiSource.includes('for(const physical of physicalRows)'));
// Each split row, including the only currently manifested part, retains its
// own real weight and independently saved duty.
assert.ok(apiSource.includes('weight:isPart?physical.weight:totalWeight(data)'));
assert.ok(apiSource.includes('bags:isPart?physical.bags:totalBags(data)'));
assert.ok(apiSource.includes('mayavi_import_profit_part_duty'));
assert.ok(apiSource.includes('PRIMARY KEY (awb,part_key)'));
assert.ok(apiSource.includes('physicalImportProfitRows(shipment.data||{},awb)'));
assert.ok(apiSource.includes('totalDuty:duty===null||duty===undefined'));
assert.ok(profitUi.includes('const duty=dataNumber(row.totalDuty);'));
assert.ok(!profitUi.includes('masterDuty*allocation'));
assert.ok(profitUi.includes('save(row.mawb,field,e.target.value,row.rowKey)'));
assert.ok(profitUi.includes('row.rowKey===rowKey'));
assert.ok(profitUi.includes('const usaFreightDeduction='));
assert.ok(profitUi.includes('const totalCost=importTotalCost('));
assert.ok(profitUi.includes('const baseProfit=importNetProfit(rate,kg,totalCost);'));
assert.ok(profitUi.includes('const excessProfit=importExcessProfit(rate,excessWeight);'));
assert.ok(profitUi.includes('const profit=importProfitIncludingExcess(baseProfit,excessProfit);'));
assert.ok(profitUi.includes('title={totalCostDetails(n)}'));
// Per-part Excess Weight must persist independently and appear in totals/CSV.
assert.ok(profitUi.includes("'Excess Weight (kg)'"));
assert.ok(profitUi.includes("'Excess Profit (₹)'"));
assert.ok(profitUi.includes("'Excess Weight (kg; no additional cost)'"));
assert.ok(profitUi.includes("'Excess Profit (Excess Weight x Rate; no costs)'"));
assert.ok(profitUi.includes("save(row.mawb,'excessWeight',e.target.value,row.rowKey)"));
assert.ok(profitUi.includes("const perPart=field==='totalDuty'||field==='excessWeight';"));
assert.ok(profitUi.includes('excessWeight+=n.excessWeight||0;'));
assert.ok(profitUi.includes('if(n.excessProfit!==null)excessProfit+=n.excessProfit;'));
assert.ok(profitUi.includes('n.profit,n.excessProfit'));
assert.ok(profitUi.includes('row.weight,row.excessWeight'));
assert.ok(profitUi.includes('displayMoney(totals.excessProfit)'));
assert.ok(profitUi.includes('No additional cost')||profitUi.includes('without any extra cost'));
assert.ok(apiSource.includes("['totalDuty','excessWeight','rate'"));
assert.ok(apiSource.includes('ADD COLUMN IF NOT EXISTS excess_weight NUMERIC(16,4)'));
assert.ok(apiSource.includes('SELECT awb,part_key,total_duty,excess_weight'));
assert.ok(apiSource.includes("const extra=isPart?part?.excess_weight:financial.excess_weight;"));
assert.ok(apiSource.includes("if(field==='totalDuty'||field==='excessWeight')"));
assert.ok(apiSource.includes('INSERT INTO mayavi_import_profit_part_duty (awb,part_key,excess_weight,updated_by)'));
assert.ok(apiSource.includes('INSERT INTO mayavi_import_profit (awb,excess_weight,updated_by)'));
assert.ok(apiSource.includes('ON CONFLICT (awb,part_key) DO UPDATE SET excess_weight=EXCLUDED.excess_weight'));
assert.ok(apiSource.includes('excessWeight:extra===null||extra===undefined'));
assert.ok(apiSource.includes("physicalImportProfitRows(shipment.data||{},awb).some(part=>part.rowKey===rowKey)"));
assert.ok(profitUi.includes('USA Protein Freight (410 x kg; includes JFK)'));
assert.ok(profitUi.includes('importFreightRate(origin,category)'));
assert.ok(profitUi.includes('Freight is charged ONLY when Goods is Protein'));
assert.ok(!profitUi.includes('185*kg'));
assert.ok(!profitUi.includes('Total Cost (before special deductions)'));
assert.ok(profitUi.includes('const canadaFreightDeduction='));
assert.ok(profitUi.includes('const germanyFreightDeduction='));
// Battery and Switch Goods Charge = physical part bags × ₹1,500, with no manual override.
// Other eligible goods still use the existing tariff and deduction rules.
assert.ok(profitUi.includes("category==='CLOTHES'||category==='BATTERY'||category==='SWITCH'?1500:"));
assert.ok(profitUi.includes('<option value="SWITCH">Switch</option>'));
assert.ok(profitUi.includes('Clothes, Battery and Switch 1500/bag'));
assert.ok(apiSource.includes("['HH','PROTEIN','CLOTHES','BATTERY','SWITCH'].includes(category)"));
assert.ok(apiSource.includes("if(/\\bSWITCH(?:ES)?\\b/.test(raw))return 'SWITCH';"));
assert.equal(5*1500,7500);
assert.ok(profitUi.includes("const goodsCharge=bags===null||chargePerBag===null?null:bags*chargePerBag;"));
assert.ok(!profitUi.includes("batteryMasterCharge"));
assert.ok(!profitUi.includes("Battery charge\" value="));
assert.ok(profitUi.includes("category==='PROTEIN'?importProteinGoodsChargePerBag(origin):null;"));
assert.ok(profitUi.includes("Protein from DXB ₹3,000/bag, Protein from USA (including JFK), Canada or Germany ₹1,800/bag"));
assert.ok(profitUi.includes("Protein DXB 3000/bag; Protein USA incl JFK, Canada, Germany 1800/bag"));
assert.ok(profitUi.includes('Freight included: {displayMoney(n.freightCharge)} (₹{n.freightRate} × {quantity.format(n.kg||0)} kg)'),
  'Total Cost must visibly show the amount of freight included, not just the per kg rate');
assert.ok(!profitUi.includes("Protein JFK/DXB 3000"));
assert.ok(!profitUi.includes('isJfkOrigin?3000'));
// 15% reporting column: ordinary HH ₹340/bag is excluded, every other
// Goods Charge tariff is eligible, including HKG HH ₹1,500/bag.
for(const [total,bagRate,expected] of [
  [340,340,0],[340*6,340,0],
  [1500*4,1500,900],[1800*3,1800,810],
  [3000*2,3000,900],[1500*1,1500,225],
  [0,1500,0],[1234.50,1500,185.18]
])assert.equal(importGoodsCharge15Percent(total,bagRate),expected,
  '15% Goods Charge '+total+' at '+bagRate+'/bag');
assert.equal(importGoodsCharge15Percent(null,340),null);
assert.equal(importGoodsCharge15Percent(null,1500),null);
assert.equal(importGoodsCharge15Percent(1500,null),null);
assert.ok(profitUi.includes("const goodsCharge15Percent=importGoodsCharge15Percent(goodsCharge,chargePerBag);"));
assert.ok(profitUi.includes("'15% of Goods Charge (₹)'"),'Show 15% next to Goods Charge');
assert.ok(profitUi.includes("n.goodsCharge,n.goodsCharge15Percent,n.profit"),
  'CSV must export 15% directly after Goods Charge');
assert.ok(profitUi.includes("displayMoney(n.goodsCharge15Percent)"),
  'Each physical part has own 15% value');
assert.ok(profitUi.includes("displayMoney(totals.goodsCharge15Percent)"),
  'Footer total must sum 15% values');
assert.ok(profitUi.includes("not added to Total Cost or deducted from Profit"),
  'Display-only amount must be explained');
assert.ok(profitUi.includes('const totalCost=importTotalCost({duty,eici,driverExpense,goodsCharge,freightCharge,proteinDeduction,siibDeduction});'),
  '15% reporting value must NOT change Total Cost or Profit');
assert.equal(importTotalCost({...dx,goodsCharge15Percent:99999}),37400,
  '15% reporting value must never become a landed expense');


// The final Gross Profit column is net Profit PLUS the existing Protein and
// Clothes deductions; it must not restore freight, driver cost, Goods Charge
// or the display-only 15% amount and must not invent results for incomplete rows.
assert.equal(importGrossProfit(10000,5000,0),15000,'DXB protein gross profit');
assert.equal(importGrossProfit(10000,8000,0),18000,'Canada/Germany/USA protein gross profit');
assert.equal(importGrossProfit(10000,0,3000),13000,'Clothes gross profit');
assert.equal(importGrossProfit(10000,0,0),10000,'HH and Battery gross profit unchanged');
assert.equal(importGrossProfit(-1000,500,0),-500,'Negative net profit is preserved');
assert.equal(importGrossProfit(null,500,0),null,'Incomplete Profit stays blank');
assert.equal(importGrossProfit(NaN,500,0),null,'Nonfinite Profit stays blank');
// Part-level results sum without reintroducing the master-level charge.
assert.equal(importGrossProfit(1000,2500,0)+importGrossProfit(500,2500,0),6500);
assert.ok(profitUi.includes("const grossProfit=importGrossProfit(profit,proteinDeduction,siibDeduction);"),
  'Add ONLY the two previously subtracted deductions');
assert.ok(profitUi.includes("'Gross Profit (₹)'"),'Gross Profit must appear in table');
assert.ok(profitUi.includes("'Gross Profit (Profit + Protein/Clothes Deduction)'"),
  'Gross Profit must appear in CSV');
assert.ok(profitUi.includes("n.averageWeightPerBag,n.grossProfit];"),
  'Gross Profit must be the LAST CSV column');
assert.ok(profitUi.includes('displayMoney(n.grossProfit)'),'Display physical part Gross Profit');
assert.ok(profitUi.includes('grossProfit+=n.grossProfit'),'Footer must sum calculated Gross Profit');
assert.ok(profitUi.includes('totals.completed?displayMoney(totals.grossProfit)'),
  'Empty or incomplete rows cannot fabricate a Gross Profit footer');
assert.ok(profitUi.includes("displayAmount(n.averageWeightPerBag)}</td>\n                <td style={{...cell,fontWeight:900,color:n.grossProfit"),
  'Gross Profit must be the LAST visible table cell');

console.log('Import Profit active/cleared part-row reconciliation passed.');
