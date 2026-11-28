import test from 'node:test';
import assert from 'node:assert/strict';
import {parseKlmLiveJson} from '../lib/klmLive.js';
import {parseKlmShipmentPageText} from '../lib/klmShipmentPage.js';
import {guardAirFranceArrival} from '../lib/airFranceArrival.js';
const awb='057-12345675';
const payload={awbNumber:awb,origin:'CDG',destination:'DEL',grossWeight:120,pieces:10,events:[{eventCode:'DEP',station:'CDG',eventActualTime:'2026-11-28T04:00:00Z'},{eventCode:'RCF',station:'DEL',eventActualTime:'2026-11-28T12:00:00Z',pieces:4}]};
test('Air France exact AWB, issuer and partial destination receipt',()=>{
 const parsed=parseKlmLiveJson(payload,awb);
 assert.equal(parsed.carrierCode,'AF');assert.equal(parsed.weight,'120');
 assert.equal(parsed.departureIsActual,true);
 const guarded=guardAirFranceArrival(parsed);
 assert.equal(guarded.status,'PART ARRIVED');assert.equal(guarded.arrivalIsActual,false);assert.equal(guarded.remainingPieces,'6');
});
test('complete receipt and duplicate milestones are not double counted',()=>{
 const s={destination:'DEL',pieces:'10',status:'ARRIVED',arrivalIsActual:true,arrivalDate:'2026-11-28',arrivalTime:'17:30',afArrivalEvents:[{location:'DEL',pieces:10},{location:'DEL',pieces:10}]};
 const r=guardAirFranceArrival(s);assert.equal(r.arrivalIsActual,true);assert.equal(r.arrivedPieces,'10');
 assert.equal(guardAirFranceArrival({...s,afArrivalEvents:[{location:'CDG',pieces:10}]}).arrivalIsActual,false);
});
test('wrong issuer same serial rejected; KLM still works',()=>{
 assert.equal(parseKlmLiveJson(payload,'074-12345675'),null);
 assert.equal(parseKlmLiveJson({...payload,awbNumber:'074-12345675'},'074-12345675').carrierCode,'KL');
 assert.equal(parseKlmShipmentPageText('074-12345675 CDG → DEL Shipment details 10 pcs, 120 kg Flight schedule',awb),null);
 const page=parseKlmShipmentPageText('057-12345675 CDG → DEL Shipment details 10 pcs, 120 kg Flight schedule',awb);
 assert.equal(page.carrierCode,'AF');
});
