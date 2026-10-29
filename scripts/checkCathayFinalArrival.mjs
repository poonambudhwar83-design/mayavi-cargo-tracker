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
const booking='AWB 160-18865044 Booking Status HKG to DEL CX679 12 pc(s) | 312.50 kg HKG 27 OCT 2026 09:20 Actual DEL 27 OCT 2026 15:35 Estimated Shipment History';
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

// Official photo (27 Oct 2026): one piece, 60kg, CX679 on 27 Oct,
// HKG Local 20:15 (IST 17:45), DEL Local 28 Oct 00:10; not arrived.
const cathayPhotoText='AWB 160-18865044 Modify HKG to DEL | 1 pc(s) | 60 kg Current status: Booking Received 1pc(s) | 60kg Booking Status HKG to DEL Confirmed (allotment) CX679 27 Oct 2026 1pc(s) | 60kg HKG 27 Oct 20:15 Scheduled DEL 28 Oct 00:10 Scheduled Shipment History Shipment has not been accepted yet';
const photo=parseCathayBookingStatus(cathayPhotoText,'160-18865044');
assert.ok(photo);
assert.equal(photo.origin,'HKG');assert.equal(photo.destination,'DEL');
assert.equal(photo.pieces,'1');assert.equal(photo.weight,'60');
assert.equal(photo.flightNo,'CX679');assert.equal(photo.flightDate,'2026-10-27');
assert.equal(photo.departureDate,'2026-10-27');assert.equal(photo.departureTime,'17:45');
assert.equal(photo.departureLocalTime,'20:15');
assert.equal(photo.arrivalDate,'2026-10-28');assert.equal(photo.arrivalTime,'00:10');
assert.equal(photo.arrivalIsActual,false);assert.equal(photo.arrivalEstimate,true);
assert.equal(photo.status,'BOOKED');
assert.equal(parseCathayBookingStatus(cathayPhotoText.replace('160-18865044','160-18865045'),'160-18865044'),null);
import { readFileSync } from 'node:fs';
const trackApi=readFileSync('app/api/track/route.js','utf8');
assert.ok(trackApi.includes('const preserveCxSchedule=cathayFastPath'));
assert.ok(trackApi.includes('shipment.departureTimeZone=direct.departureTimeZone'));
assert.ok(trackApi.includes("key==='trackingError'||key==='manualHint'"));
// Cathay formats AWB serials into groups. A visible booking card may still
// contain all the arrival evidence and must not be rejected as another MAWB.
const spacedBooking=cathayPhotoText.replace('160-18865044','160-1886 5044');
const spaced=parseCathayBookingStatus(spacedBooking,'160-18865044');
assert.ok(spaced,'Cathay spaced MAWB serial must remain verifiable');
assert.equal(spaced.arrivalDate,'2026-10-28');
assert.equal(spaced.arrivalTime,'00:10');
// Never promote the official form shell into a fake flight/ETA.
assert.equal(parseCathayBookingStatus('Track your shipment Airline code 160 Air Waybill number(s) 1886 3806 Booking Status','160-18863806'),null);
assert.ok(trackApi.includes('const cxBookingCardUnavailable=cathayFastPath'));
assert.ok(trackApi.includes('!cxBookingCardUnavailable'));
const browserSource=readFileSync('lib/cathay-browser-fallback.js','utf8');
assert.ok(browserSource.includes('allCathayTabText(browser)'));
assert.ok(browserSource.includes('scrollCathayTabs(browser,i)'));
assert.ok(browserSource.includes("await fillField(page,'awb',serial)"));
console.log('Cathay future-arrival, allotment, timezone and recurring refresh tests passed.');
