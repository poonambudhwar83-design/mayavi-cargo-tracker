import assert from 'node:assert/strict';
import { annotateCathaySources } from '../lib/cathaySourceMap.js';
import {parseCathayTrackingApi} from '../lib/cathay-browser-fallback.js';
import {parseCathaySeptemberBookingStatus,parseCathaySeptemberTimeline} from '../lib/cathay-september-browser-fallback.js';
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
// October 20 ZIP's JSON Booking Status parser is restored beside today's
// Cathay browser extractor. It must only accept the exact tracking number.
const octBooking={
  AWBNumber:'16018860310',date:'31OCT26',
  routing:[{origin:'HKG',destination:'DEL'}],
  pieces:3,weight:{value:65},
  bookingStatus:[{flight:'CX679',STD:'2026-10-31T20:15:00',
    STA:'2026-10-31T23:50:00',status:'BOOKED'}]
};
const parsedOct=parseCathayTrackingApi(JSON.stringify(octBooking),mawb);
assert.ok(parsedOct,'October archive parser must recognize verified Cathay JSON');
assert.equal(parsedOct.flightNo,'CX679');
assert.equal(parsedOct.destination,'DEL');
assert.equal(parsedOct.pieces,'3');
assert.equal(parsedOct.weight,'65');
assert.equal(parsedOct.arrivalDate,'2026-10-31');
assert.equal(parsedOct.arrivalTime,'23:50');
assert.equal(parsedOct.arrivalIsActual,false);
assert.equal(parseCathayTrackingApi(JSON.stringify(octBooking),'160-18860311'),null,
  'Never borrow another shipment arrival time');
assert.equal(parseCathayTrackingApi('{"error":"Access Denied"}',mawb),null);
const octActual=parseCathayTrackingApi(JSON.stringify({
  ...octBooking,bookingStatus:[{...octBooking.bookingStatus[0],ATA:'2026-10-31T23:58:00'}]
}),mawb);
assert.equal(octActual.arrivalIsActual,true);
assert.equal(octActual.arrivalTime,'23:58');

// The untouched September 19 backup's Booking Status date/time parser remains
// executable and handles final-station actual arrival after exact-AWB gating.
const septPage=[
  'AWB 160-18860310', 'Current status: Booking Received', 'Booking Status',
  'HKG to DEL', 'CX679', '3 pc(s) | 65 kg',
  'HKG 31 OCT 2026 20:15 Actual',
  'DEL 01 NOV 2026 00:05 Actual',
  'Shipment History'
].join('\n');
const sept=parseCathaySeptemberBookingStatus(septPage,mawb,
  {origin:'HKG',destination:'DEL'});
assert.equal(sept?.flightNo,'CX679');
assert.equal(sept?.pieces,'3');
assert.equal(sept?.arrivalDate,'2026-11-01');
assert.equal(sept?.arrivalTime,'00:05');
assert.equal(sept?.arrivalIsActual,true);
assert.equal(parseCathaySeptemberTimeline(septPage,mawb,
  {origin:'HKG',destination:'DEL'})?.arrivalTime,'00:05');

console.log('CX Terminal RCS + Booking Details source mapping and AWB guards passed.');
