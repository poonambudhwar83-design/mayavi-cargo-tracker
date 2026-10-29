import assert from 'node:assert/strict';
import {parseGulfAirParcelsApi,parseGulfAirParcelsPage} from '../lib/gulfAirParcels.js';
const awb='072-95056684';
const fixture={results:[{tracking_number:awb,shipment:{
  trackingId:awb,fromAirport:'LHR',toAirport:'DEL',pieces:17,weight:442.6,
  flight_legs:[{flight_number:'GF130',destination:'BAH',actual_arrival:'2026-10-27T10:20:00Z'},
    {flight_number:'GF132',destination:'DEL',scheduled_arrival:'2026-10-30T04:20:00Z'}],
  states:[
    {state:'RCS cargo accepted',airport:'LHR',date:'2026-10-26T09:00:00Z'},
    {state:'DEP flight departed GF130',airport:'LHR',date:'2026-10-27T07:45:00Z'},
    {state:'ARR arrived at Bahrain',airport:'BAH',date:'2026-10-27T10:20:00Z'}]
}}]};
const got=parseGulfAirParcelsApi(fixture,awb);
assert.equal(got.ok,true);assert.equal(got.shipment.origin,'LHR');
assert.equal(got.shipment.destination,'DEL');
assert.equal(got.shipment.weight,'442.6');assert.equal(got.shipment.pieces,'17');
assert.equal(got.shipment.status,'IN TRANSIT');
assert.equal(got.shipment.arrivalDate,'');
assert.equal(parseGulfAirParcelsApi(fixture,'072-12345678').ok,false);
const final=structuredClone(fixture);
final.results[0].shipment.states.push({state:'RCF received from flight',airport:'DEL',date:'2026-10-30T05:05:00Z'});
const arrived=parseGulfAirParcelsApi(final,awb);
assert.equal(arrived.shipment.status,'ARRIVED');
assert.equal(arrived.shipment.arrivalDate,'2026-10-30');
assert.equal(arrived.shipment.arrivalTime,'10:35');
const page=parseGulfAirParcelsPage({
  leftText:'AWB 07295056684\nBooking Destination:\nDEL\n27 Oct 2026 Flight departed at LHR GF130',
  rightText:'AWB 07295056684\nOrigin:\nLHR\nPieces:\n17\nWeight:\n442.6 kg',
  timelineRows:[]},awb);
assert.equal(page.ok,true);assert.equal(page.shipment.destination,'DEL');
assert.equal(page.shipment.origin,'LHR');assert.equal(page.shipment.weight,'442.6');
assert.equal(parseGulfAirParcelsPage({resultText:'Enter tracking number 07295056684',timelineRows:[]},awb).ok,false);
console.log('Gulf Air ParcelsApp checks passed: AWB verification, booked destination, weight, transit vs actual arrival.');
