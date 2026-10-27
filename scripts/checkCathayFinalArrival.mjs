import assert from 'node:assert/strict';
import {guardCathayFinalArrival} from '../lib/cathayFinalArrival.js';
const now=Date.parse('2026-10-26T05:30:00Z'); // 11:00 IST
const base={mawb:'160-18867063',origin:'HKG',destination:'DEL',
  flightNo:'CX679',departureDate:'2026-10-26',departureTime:'17:45',
  arrivalDate:'2026-10-26',arrivalTime:'23:14',arrivalIsActual:true,status:'ARRIVED'};
const before=guardCathayFinalArrival(base,now);
assert.equal(before.status,'BOOKED');
assert.equal(before.arrivalIsActual,false);
assert.equal(before.arrivalEstimate,true);
assert.equal(before.arrivalTime,'23:14');
assert.equal(before.flightNo,'CX679');
assert.equal(guardCathayFinalArrival({...base,departureTime:'08:30'},now).status,'IN TRANSIT');
assert.equal(guardCathayFinalArrival(base,Date.parse('2026-10-26T18:00:00Z')).status,'ARRIVED');
assert.equal(guardCathayFinalArrival({...base,status:'BOOKED'},now).status,'BOOKED');
assert.equal(guardCathayFinalArrival({...base,status:'DELIVERED'},now).status,'DELIVERED');
assert.equal(guardCathayFinalArrival({...base,mawb:'065-11493775'},now).status,'ARRIVED');

import { parseCathayBookingStatus } from '../lib/cathay-browser-fallback.js';
import { cathayRefreshDecision } from '../lib/cathayRefreshPolicy.js';
const booking='Booking Status HKG to DEL CX679 12 pc(s) | 312.50 kg HKG 27 OCT 2026 09:20 Actual DEL 27 OCT 2026 15:35 Estimated Shipment History';
const planned=parseCathayBookingStatus(booking,'160-18865044');
assert.equal(planned.flightNo,'CX679');
assert.equal(planned.weight,'312.50');
assert.equal(planned.pieces,'12');
assert.equal(planned.arrivalDate,'2026-10-27');
assert.equal(planned.arrivalTime,'15:35');
assert.equal(planned.arrivalIsActual,false);
assert.equal(planned.arrivalEstimate,true);
assert.equal(planned.status,'DEPARTED');
const actual=parseCathayBookingStatus(booking.replace('15:35 Estimated','15:41 Actual'),'160-18865044');
assert.equal(actual.arrivalIsActual,true);
assert.equal(actual.status,'ARRIVED');
assert.equal(parseCathayBookingStatus('Booking Status Track Cargo Help','160-18865044'),null);
const tick=Date.parse('2026-10-27T04:45:00Z');
const oldCheck=new Date(tick-65*60*1000).toISOString();
const freshCheck=new Date(tick-3*60*1000).toISOString();
assert.equal(cathayRefreshDecision({flightNo:'CX679',arrivalDate:'2026-10-27',arrivalTime:'13:45',arrivalIsActual:true,status:'ARRIVED',lastChecked:oldCheck},'ACTIVE',tick).due,true);
assert.equal(cathayRefreshDecision({flightNo:'CX679',arrivalDate:'2026-10-27',arrivalTime:'13:45',arrivalIsActual:true,status:'ARRIVED',lastChecked:freshCheck},'ACTIVE',tick).due,false);
assert.equal(cathayRefreshDecision({status:'BOOKED',lastChecked:new Date(tick-6*60*1000).toISOString()},'ACTIVE',tick).due,true);
assert.equal(cathayRefreshDecision({status:'BOOKED',lastChecked:freshCheck},'ACTIVE',tick).due,false);
assert.equal(cathayRefreshDecision({status:'BOOKED',lastChecked:oldCheck},'SKIP',tick).due,false);

console.log('Cathay future-arrival, booking estimates and recurring refresh tests passed.');
