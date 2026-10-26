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
console.log('Cathay future-arrival status regression passed; protected 160 reader unchanged.');
