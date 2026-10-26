import assert from 'node:assert/strict';
import {physicalImportProfitRows,selectImportProfitRows} from '../lib/importProfitPhysicalRows.js';
import {proteinHandlingRate} from '../lib/importProteinDeduction.js';
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

const profitUi=readFileSync('app/ImportProfitSheet.js','utf8');
const apiSource=readFileSync('app/api/import-profit/route.js','utf8');
assert.ok(profitUi.includes("import {proteinHandlingRate} from '../lib/importProteinDeduction.js';"));
assert.ok(profitUi.includes("const proteinDeduction=category==='PROTEIN'&&kg!==null?proteinHandlingRate(origin)*kg:0;"));
assert.ok(profitUi.includes("['S.No.','MAWB','Client','Goods'"));
assert.ok(profitUi.includes("const columns=['MAWB','Client','Goods'"));
assert.ok(profitUi.includes("return [row.mawb,row.clientName"));
assert.ok(!profitUi.includes("'Part / Register'"));
assert.ok(!profitUi.includes("'Arrival Date','Client'"));
assert.ok(profitUi.includes('colSpan={19}'));
assert.ok(profitUi.includes('colSpan={4}'));
assert.ok(profitUi.includes('key={row.rowKey||row.mawb}'));
assert.ok(profitUi.includes('const active=row.isActiveMaster===true;'));
assert.ok(apiSource.includes('selectImportProfitRows(data,awb,month,currentProfitMonth())'));
assert.ok(apiSource.includes('for(const physical of physicalRows)'));
assert.ok(apiSource.includes('weight:physical.partCount===1?totalWeight(data):physical.weight'));
assert.ok(profitUi.includes('const jfkFreightDeduction='));
assert.ok(profitUi.includes('const canadaFreightDeduction='));
assert.ok(profitUi.includes('const germanyFreightDeduction='));

console.log('Import Profit active/cleared part-row reconciliation passed.');
