import assert from 'node:assert/strict';
import { annotateCathaySources } from '../lib/cathaySourceMap.js';
const mawb='160-18860310';
const terminal={shipment:{mawb,origin:'HKG',destination:'DEL',
  pieces:'3',bags:'3',weight:'65.0',bookingDate:'2026-10-31',status:'BOOKED'}};
const base={mawb,status:'BOOKED',origin:'HKG',destination:'DEL',
  pieces:'3',bags:'3',weight:'65.0',flightNo:'',arrivalDate:'',arrivalTime:''};
const rcs=annotateCathaySources(base,{mawb,terminal});
assert.equal(rcs.pieces,'3');
assert.equal(rcs.weight,'65.0');
assert.equal(rcs.weightSource,'Cathay Cargo Terminal / Received from Shipper (RCS)');
assert.equal(rcs.cxTrackingSources.terminal.status,'AWB_MATCHED');
assert.equal(rcs.cxTrackingSources.bookingDetails.status,'UNAVAILABLE');
assert.equal(rcs.flightNo,'');assert.equal(rcs.arrivalDate,'');assert.equal(rcs.arrivalTime,'');
assert.equal(rcs.cxBookingDetailsPending,true);
// A new live RCS update wins over older operator-typed values.
const updated=annotateCathaySources({...base,weight:'70',bags:'4'},
  {mawb,terminal});
assert.equal(updated.weight,'65.0');assert.equal(updated.bags,'3');
// Only AWB-matched booking/flight data may change arrival provenance.
const booking={ok:true,shipment:{mawb,flightNo:'CX679',flightDate:'2026-10-31',
  arrivalDate:'2026-11-01',arrivalTime:'00:10',arrivalIsActual:false}};
const full=annotateCathaySources({...base,...booking.shipment},{mawb,terminal,booking});
assert.equal(full.flightNo,'CX679');
assert.equal(full.cxBookingDetailsPending,false);
assert.match(full.flightNoSource,/Booking Status/);
assert.match(full.arrivalDetailsSource,/Booking Status/);
assert.equal(full.cxTrackingSources.bookingDetails.status,'AWB_MATCHED');
const unrelated=annotateCathaySources(base,{mawb,terminal,
  booking:{ok:true,shipment:{...booking.shipment,mawb:'160-18860311'}}});
assert.equal(unrelated.arrivalDate,'');
assert.equal(unrelated.cxBookingDetailsPending,true);
// The exact booked flight, not an older, unrelated flight, is required.
const terminalFlight={...terminal,shipment:{...terminal.shipment,flightNo:'CX679'}};
const flight=annotateCathaySources({...base,flightNo:'CX679',
  arrivalDate:'2026-11-01',arrivalTime:'00:10'},{
  mawb,terminal:terminalFlight,flightStatus:{
    flightNo:'CX679',arrivalDate:'2026-11-01',arrivalTime:'00:10'}});
assert.match(flight.flightNoSource,/Terminal/);
assert.match(flight.arrivalDetailsSource,/flight status/);
const wrongFlight=annotateCathaySources({...base,flightNo:'CX679',
  arrivalDate:'2026-11-01',arrivalTime:'00:10'},
  {mawb,terminal:terminalFlight,flightStatus:{
    flightNo:'CX677',arrivalDate:'2026-11-01',arrivalTime:'00:10'}});
assert.doesNotMatch(wrongFlight.arrivalDetailsSource||'',/flight status/);
const blocked=annotateCathaySources(base,{mawb,terminal,bookingReason:'403'});
assert.equal(blocked.cxTrackingSources.bookingDetails.status,'ACCESS_DENIED');
assert.deepEqual(annotateCathaySources({mawb:'065-11493775',weight:'99'},
  {mawb:'065-11493775',terminal}),{mawb:'065-11493775',weight:'99'});
console.log('CX Terminal RCS + Booking Details source mapping and AWB guards passed.');
