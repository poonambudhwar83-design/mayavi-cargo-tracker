// Regression checks: Gulf Air (GF/072) must never invent a final arrival.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readableGulfFailure} from '../lib/gulfAirDiagnostics.js';
import { parseGulfAirTrackingPage } from '../lib/gulfAir.js';
const mawb='072-12345675';
const header='Online Air Waybill Tracking\nAWB Number: '+mawb+'\nOrigin: BAH\nDestination: DEL\nGross Weight: 100 KG\nPieces: 3';
const rcs=['RCS','BAH','27-OCT-2026 10:00','Received from shipper 3 pieces 100 KG'];
const dep=['DEP','BAH','27-OCT-2026 18:05','Departed on GF130'];
const transit=parseGulfAirTrackingPage({text:header,tables:[[rcs,dep]]},mawb);
assert.equal(transit.ok,true,transit.reason);
assert.equal(transit.shipment.status,'IN TRANSIT');
assert.equal(transit.shipment.origin,'BAH');
assert.equal(transit.shipment.destination,'DEL');
assert.equal(transit.shipment.flightNo,'GF130');
assert.equal(transit.shipment.weight,'100');
assert.equal(transit.shipment.bags,'3');
assert.equal(transit.shipment.bookingDate,'2026-10-27');
assert.equal(transit.shipment.arrivalDate,'');
assert.equal(transit.shipment.arrivalIsActual,false);
assert.equal(transit.shipment.departureDate,'2026-10-27');
const hub=parseGulfAirTrackingPage({text:header,tables:[[rcs,dep,['ARR','BAH','27-OCT-2026 21:00','Arrived at transit hub']]]},mawb);
assert.notEqual(hub.shipment.status,'ARRIVED','Transit hub arrival is not final delivery');
const final=parseGulfAirTrackingPage({text:header,tables:[[rcs,dep,['RCF','DEL','28-OCT-2026 03:20','Received from flight GF130']]]},mawb);
assert.equal(final.shipment.status,'ARRIVED');
assert.equal(final.shipment.arrivalIsActual,true);
assert.equal(final.shipment.arrivalDate,'2026-10-28');
assert.equal(final.shipment.arrivalTime,'03:20');
const unknown=parseGulfAirTrackingPage({text:'ONLINE AIR WAYBILL TRACKING Prefix 072',tables:[]},mawb);
assert.equal(unknown.ok,false,'Empty search form must never count as a shipment');
const other=parseGulfAirTrackingPage({text:header.replace(mawb,'072-99999999'),tables:[[rcs,dep]]},mawb);
assert.equal(other.ok,false,'Wrong AWB cannot be accepted');
assert.equal(readableGulfFailure({reason:'PARCELS PUBLIC TRACKER API RETURNED NO_DATA'}),'PARCELS PUBLIC TRACKER API RETURNED NO_DATA');
assert.equal(readableGulfFailure({error:{message:'Gulf official cargo unavailable'}}),'Gulf official cargo unavailable');
assert.equal(readableGulfFailure({code:'CAPTCHA_QUOTA_EXCEEDED'}),'CAPTCHA_QUOTA_EXCEEDED');
assert.equal(readableGulfFailure(new Error('CHAMP timeout')),'CHAMP timeout');
assert.ok(!readableGulfFailure({error:{message:'Access denied'}}).includes('[object Object]'),
  'Stored Gulf tracking errors must never lose structured provider meaning.');

// If the first-party Falcon Cargo browser returns 24/55 and 31/55 physical
// events, both parts are visible, not collapsed into one master or duplicated.
const splitAwb='072-95019411';
const splitHeader='AWB Number: '+splitAwb+'\nOrigin: BAH\nDestination: DEL\nGross Weight: 1260 KG\nPieces: 55';
const splitOfficial=parseGulfAirTrackingPage({text:splitHeader,tables:[[
  ['DEP','BAH','05-NOV-2026 22:46','GF130 pieces: 24 weight: 550 KG'],
  ['DEP','BAH','06-NOV-2026 09:10','GF134 pieces: 31 weight: 710 KG'],
  ['BKD','BAH','05-NOV-2026 17:07','GF130 pieces: 24 weight: 550 KG']
]]},splitAwb);
assert.equal(splitOfficial.ok,true,splitOfficial.reason);
assert.equal(splitOfficial.shipment.partShipments.length,2);
assert.equal(splitOfficial.shipment.partShipments.find(p=>p.flightNo==='GF130')?.status,'DEPARTED');
assert.equal(splitOfficial.shipment.partShipments.find(p=>p.flightNo==='GF134')?.status,'DEPARTED');
assert.equal(splitOfficial.shipment.partShipments.reduce((n,p)=>n+p.pieces,0),55);
assert.equal(splitOfficial.shipment.arrivalDate,'');

const gulfCode=readFileSync('lib/gulfAir.js','utf8');
const gulfCron=readFileSync('app/api/cron/gulf-air/route.js','utf8');
assert.ok(gulfCode.includes("GULF_AIR_PUBLIC_CARGO_URL='https://www.gulfair.com/cargo'"),
  'Use first-party Gulf Air Falcon Cargo tracking form.');
assert.ok(gulfCode.includes('const publicCargo=await searchGulfAirPublicCargo(page,mawb)'),
  'Try first-party Gulf cargo before CHAMP fallback.');
assert.ok(gulfCode.includes("const inputs=await frame.$('input').catch(()=>[])"),
  'First-party Gulf Air AWB inputs must be returned as an iterable list.');
assert.ok(gulfCode.includes("const controls=await frame.$('button,input[type=\"submit\"],a,[role=\"button\"]').catch(()=>[])"),
  'First-party Gulf Air buttons must be returned as an iterable list.');
assert.ok(!gulfCode.includes("const inputs=await frame.$('input').catch(()=>[])"),
  'Do not regress the scalar-ElementHandle iterable error.');
assert.ok(gulfCode.includes('await button.click({delay:100})'),
  'Public Gulf page must click its actual Track your cargo control.');
assert.ok(gulfCode.includes('parseGulfAirTrackingPage({...lastDom,officialTracker:GULF_AIR_PUBLIC_CARGO_URL},mawb)'),
  'Accept only exact AWB-verified first-party result rows.');
assert.ok(gulfCron.includes('readableGulfFailure(cause)'),
  'Scheduled Gulf tracking must preserve the provider error rather than [object Object].');
console.log('Gulf Air GF 072 CHAMP shipment parsing regression checks passed');
