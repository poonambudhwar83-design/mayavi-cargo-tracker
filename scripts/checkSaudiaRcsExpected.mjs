import assert from 'node:assert/strict';
import { enforceSaudiaArrivalEvidence } from '../lib/saudiaTransitGuard.js';

const isoAfterDays=days=>new Date(Date.now()+330*60000+days*86400000).toISOString().slice(0,10);
const future=isoAfterDays(1);
const base={mawb:'065-18432864',origin:'JED',destination:'DEL',
  sourceStatus:'RCS',flightNo:'SV756',flightDate:future,flightDestination:'DEL',
  totalPieces:39,totalWeight:830,status:'BOOKED',
  arrivalDate:'',arrivalTime:'',arrivalIsActual:false};
const rcs=enforceSaudiaArrivalEvidence(base);
assert.equal(rcs.status,'EXPECTED');
assert.equal(rcs.arrivalDate,future);
assert.equal(rcs.scheduledArrivalDate,future);
assert.equal(rcs.arrivalTime,'');
assert.equal(rcs.arrivalEstimate,true);
assert.equal(rcs.arrivalIsActual,false);
assert.equal(rcs.saudiaArrivalStage,'PLANNED');
assert.equal(rcs.finalArrivalPending,true);
assert.equal(rcs.mailTime,'');
assert.equal(enforceSaudiaArrivalEvidence({...base,flightDate:isoAfterDays(-2)}).arrivalDate,'');
assert.equal(enforceSaudiaArrivalEvidence({...base,flightNo:''}).arrivalDate,'');
assert.equal(enforceSaudiaArrivalEvidence({...base,flightDestination:'RUH'}).arrivalDate,'');
assert.equal(enforceSaudiaArrivalEvidence({...base,disAfterFow:true}).arrivalDate,'');
const moving=enforceSaudiaArrivalEvidence({...base,sourceStatus:'FOW',status:'IN TRANSIT',
  arrivalDate:future,arrivalTime:'15:30'});
assert.equal(moving.status,'IN TRANSIT');
assert.equal(moving.arrivalTime,'15:30');
assert.equal(moving.saudiaArrivalStage,'ESTIMATED');
const arrived=enforceSaudiaArrivalEvidence({...base,sourceStatus:'ARR',
  airport:'DEL',status:'ARRIVED',arrivalDate:future,arrivalTime:'16:00',
  arrivalIsActual:true});
assert.equal(arrived.arrivalIsActual,true);
assert.equal(arrived.status,'ARRIVED');
console.log('Saudia RCS assigned future flight date shown EXPECTED without cargo ARR or fake ETA');
