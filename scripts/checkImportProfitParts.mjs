import assert from 'node:assert/strict';
import {physicalImportProfitRows,selectImportProfitRows} from '../lib/importProfitPhysicalRows.js';
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
console.log('Import Profit active/cleared part-row reconciliation passed.');
