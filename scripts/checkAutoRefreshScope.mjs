import assert from 'node:assert/strict';
import { isActiveMaster, refreshScope } from '../lib/autoRefreshScope.js';

const now=new Date('2026-10-16T04:00:00.000Z');
const since=(hours)=>new Date(now.getTime()-hours*3600000).toISOString();
const scope=(row)=>refreshScope(row,now);

assert.equal(scope({shipmentType:'IMPORT',customsCleared:false,status:'ARRIVED'}),'ACTIVE');
assert.equal(scope({shipmentType:'EXPORT',handoverDone:true,masterCopyReceived:false}),'ACTIVE');
assert.equal(scope({shipmentType:'EXPORT',handoverDone:false,masterCopyReceived:true}),'ACTIVE');
assert.equal(scope({shipmentType:'EXPORT',handoverDone:true,masterCopyReceived:true,masterCopyReceivedAt:since(6)}),'CLEARED_RECENT');
assert.equal(scope({shipmentType:'EXPORT',handoverDone:true,masterCopyReceived:true,masterCopyReceivedAt:since(96)}),'SKIP');
assert.equal(scope({shipmentType:'EXPORT',handoverDone:true,masterCopyReceived:true,
  masterCopyReceivedAt:since(120),handoverUpdatedAt:since(5)}),'CLEARED_RECENT');
assert.equal(scope({shipmentType:'IMPORT',customsCleared:true,customsClearedAt:since(24)}),'CLEARED_RECENT');
assert.equal(scope({shipmentType:'IMPORT',customsCleared:true,customsClearedAt:since(96)}),'SKIP');
assert.equal(scope({shipmentType:'IMPORT',customsCleared:false,partShipments:[
  {customsCleared:true,customsClearedAt:since(100)},
  {customsCleared:false,arrivalDate:'2026-10-17'}]}),'ACTIVE');
assert.equal(scope({shipmentType:'IMPORT',customsCleared:false,partShipments:[
  {customsCleared:true,customsClearedAt:since(100)},
  {customsCleared:true,customsClearedAt:since(99)}]}),'SKIP');
assert.equal(scope({shipmentType:'IMPORT',customsCleared:false,partShipments:[
  {customsCleared:true,customsClearedAt:since(100)},
  {customsCleared:true,customsClearedAt:since(3)}]}),'CLEARED_RECENT');
assert.equal(scope({shipmentType:'IMPORT',customsCleared:true,customsClearedAt:since(96),
  partShipments:[{customsCleared:null},{customsCleared:null}]}),'SKIP');
assert.equal(scope({shipmentType:'OTHER_COUNTRIES_IMPORT',customsCleared:false}),'ACTIVE');
assert.equal(scope({shipmentType:'OTHER_COUNTRIES',handoverDone:true,masterCopyReceived:true,
  masterCopyReceivedAt:since(90)}),'SKIP');
assert.equal(isActiveMaster({shipmentType:'IMPORT',customsCleared:false,
  partShipments:[{customsCleared:true},{customsCleared:true}]}),false);
console.log('Mayavi refresh scope regression passed: Active, 72h Customs Cleared, split parts and Other Countries.');
