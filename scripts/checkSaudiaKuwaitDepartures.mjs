import assert from 'node:assert/strict';
import {resolveSaudiaArrivedMasterFlight} from '../lib/saudiaArrivedMasterFlight.js';
import {markKuwaitAircraftDeparture} from '../lib/kuwaitAircraftDeparture.js';

for(const [mawb,old,pieces,weight] of [
  ['065-11493694','SV1115',67,1873],
  ['065-11493613','SV1125',51,1328],
  ['065-11493764','SV1117',40,1060]]){
  const row={mawb,origin:'DMM',destination:'DEL',flightNo:old,
    status:'IN TRANSIT',totalPieces:pieces,totalWeight:weight,
    arrivalIsActual:false,arrivalDate:'2026-10-31',arrivalTime:'18:42',
    partLoadHistory:[{flightNo:old,departed:{pieces,weight}}],
    partShipments:[{flightNo:'SV758',flightDate:'2026-10-31',
      flightDestination:'DEL',arrivalDate:'2026-10-31',
      arrivalTime:'18:42',arrivalIsActual:true,pieces,weight,
      arrivalTimeSource:'SAL actual destination ARR/DLV'}]};
  const fixed=resolveSaudiaArrivedMasterFlight(row);
  assert.equal(fixed.flightNo,'SV758',mawb+' final actual DEL flight');
  assert.equal(fixed.flightDate,'2026-10-31');
  assert.equal(fixed.status,'ARRIVED');
  assert.equal(fixed.arrivalIsActual,true);
  assert.equal(fixed.finalArrivalPending,false);
  assert.equal(fixed.partLoadHistory,row.partLoadHistory,'Keep the previous connection history');
  assert.equal(resolveSaudiaArrivedMasterFlight({...row,partShipments:row.partShipments.map(p=>({...p,flightDestination:'JED'}))}).flightNo,old,'JED is not final DEL');
  assert.equal(resolveSaudiaArrivedMasterFlight({...row,partShipments:row.partShipments.map(p=>({...p,arrivalIsActual:false}))}).flightNo,old,'No ARR, no confirmed new flight');
  assert.equal(resolveSaudiaArrivedMasterFlight({...row,totalPieces:pieces+10}).flightNo,old,'Partial shipments retain active flight');
}
const ku={mawb:'229-18109630',flightNo:'KU381',flightDate:'2026-10-31',origin:'KWI',destination:'DEL',status:'PART LOAD',
  partShipments:[{pieces:'55',sourceStatus:'MAN',status:'MANIFESTED'},{pieces:'32',sourceStatus:'MAN',status:'MANIFESTED'}]};
const record={ok:true,departureIsActual:true,departureDate:'2026-10-31',departureTime:'19:10',
  departureOrigin:'KWI',departureDestination:'DEL',flightNo:'KU381',source:'Dated flight status'};
const fixed=markKuwaitAircraftDeparture(ku,record);
assert.equal(fixed.kuwaitFlightDeparted,true);
assert.equal(fixed.kuwaitCargoDepartureConfirmed,false);
assert.equal(fixed.status,'PART LOAD','Aircraft DEP must not fabricate cargo DEP');
assert.deepEqual(fixed.partShipments,ku.partShipments);
for(const invalid of [{...record,departureIsActual:false},{...record,departureDate:'2026-10-30'},
  {...record,flightNo:'KU382'},{...record,departureDestination:'KWI'}]){
  assert.equal(markKuwaitAircraftDeparture(ku,invalid).kuwaitFlightDeparted,undefined);
}
console.log('SAL final DEL flight and Kuwait aircraft departure vs cargo DEP checks passed');
