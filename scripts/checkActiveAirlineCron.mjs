import assert from 'node:assert/strict';
import { activeAirlineCandidates, BATCH_SIZE, safeAirlineMovementPatch } from '../lib/activeAirlineCron.js';

const now=new Date('2026-11-02T02:00:00Z');
const old='2026-10-31T00:00:00Z';
const recent='2026-11-02T01:54:00Z';
const entry=(awb,more={})=>({awb:awb.replace(/\D/g,''),data:{
  mawb:awb,shipmentType:'IMPORT',customsCleared:false,
  lastChecked:old,...more
}});
const selected=activeAirlineCandidates([
  entry('098-32251715'),
  entry('065-11493672'),
  entry('072-95056684'), // owner's GF pause
  entry('160-18860310',{customsCleared:true,customsClearedAt:recent}),
  entry('176-11111111',{backendCronAttemptAt:recent}),
  entry('229-22222222',{partShipments:[
    {customsCleared:true},{customsCleared:false}]}),
  entry('157-33333333',{shipmentType:'EXPORT',
    handoverDone:true,masterCopyReceived:true}),
  entry('932-44444444',{shipmentType:'EXPORT',handoverDone:true,
    masterCopyReceived:false}),
  entry('098-55555555',{lastChecked:recent})
],now);
assert.deepEqual(selected.map(x=>x.awb),[
  '06511493672','09832251715','22922222222','93244444444'
].sort().sort((a,b)=>a.localeCompare(b)));
assert.ok(selected.every(x=>!x.awb.startsWith('072')));
assert.ok(selected.length<=BATCH_SIZE);
const verified=safeAirlineMovementPatch(
  {status:'MANIFESTED',arrivalIsActual:false,clientName:'ACME',mailSent:true,
    customsCleared:false},
  {status:'ARRIVED',arrivalIsActual:true,arrivalDate:'2026-11-02',
    arrivalTime:'01:43',pieces:'41',weight:'2020',clientName:'WRONG',
    mailSent:false,customsCleared:true,rate:999,goodsDescription:'WRONG'}
);
assert.equal(verified.status,'ARRIVED');
assert.equal(verified.arrivalIsActual,true);
assert.equal(verified.arrivalTime,'01:43');
for(const field of ['clientName','mailSent','customsCleared','rate','goodsDescription'])
  assert.ok(!(field in verified),'Cron cannot update operator field '+field);
const stale=safeAirlineMovementPatch(
  {status:'ARRIVED',arrivalIsActual:true,arrivalTime:'01:43'},
  {status:'MANIFESTED',arrivalIsActual:false,arrivalVerifiedAbsent:true,
    arrivalDate:'',arrivalTime:''});
assert.equal(stale.status,undefined);
assert.equal(stale.arrivalIsActual,undefined);
assert.equal(stale.arrivalTime,undefined);
assert.equal(safeAirlineMovementPatch({}, {status:'TRACKING'}),null);
assert.deepEqual(activeAirlineCandidates([],now),[]);
console.log('Active-only server airline cron: GF excluded, bounded fairness, cooldown, split loads, and operator protection passed.');
