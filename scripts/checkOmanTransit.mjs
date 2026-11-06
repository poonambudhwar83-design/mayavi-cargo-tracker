import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseOmanShipment } from '../lib/oman.js';

const prefix='AWB 910-21053561 (BAH - MCT) 30 P / 800 KGS ';
const firstLeg='Booked BAH MCT 30 800 Kgs WY654 05/11/2026 05/11/2026 20:00 ';
const transit='Arrived BAH MCT 30 800 Kgs WY654 05/11/2026 06/11/2026 00:39 ';
const finalExpected='Expected MCT DEL 30 800 Kgs WY241 06/11/2026 ETD: 08:00 ETA: 14:30 ';
const finalActual='Arrived MCT DEL 30 800 Kgs WY241 06/11/2026 06/11/2026 15:00 ';
const mawb='910-21053561';

// The heading ends at Muscat, but the booking continues to Delhi.
const staged=parseOmanShipment(prefix+firstLeg+transit+finalExpected,mawb);
assert.equal(staged.origin,'BAH');
assert.equal(staged.destination,'DEL');
assert.equal(staged.via,'MCT');
assert.equal(staged.transitAirport,'MCT');
assert.equal(staged.transitArrivalDate,'2026-11-06');
assert.equal(staged.transitArrivalTime,'00:39');
assert.equal(staged.status,'IN TRANSIT');
assert.equal(staged.arrivalDate,'2026-11-06');
assert.equal(staged.arrivalTime,'14:30');
assert.equal(staged.arrivalIsActual,false);
assert.equal(staged.finalArrivalPending,true);

// If the airline currently exposes only BAH-MCT, use the operator's
// confirmed end destination, but NEVER display the MCT time as DEL arrival.
const incomplete=parseOmanShipment(prefix+firstLeg+transit,mawb,{finalDestination:'DEL'});
assert.equal(incomplete.destination,'DEL');
assert.equal(incomplete.via,'MCT');
assert.equal(incomplete.status,'IN TRANSIT');
assert.equal(incomplete.arrivalDate,'');
assert.equal(incomplete.arrivalTime,'');
assert.equal(incomplete.arrivalIsActual,false);
assert.equal(incomplete.arrivalVerifiedAbsent,true);

// The final cargo Arrived/RCF event is required before the master is ARRIVED.
const final=parseOmanShipment(prefix+firstLeg+transit+finalExpected+finalActual,mawb);
assert.equal(final.status,'ARRIVED');
assert.equal(final.arrivalDate,'2026-11-06');
assert.equal(final.arrivalTime,'15:00');
assert.equal(final.arrivalIsActual,true);
assert.equal(final.finalArrivalPending,false);

// Valid final Muscat shipments remain supported without a user override.
const genuineMct=parseOmanShipment(prefix+firstLeg+transit,mawb);
assert.equal(genuineMct.destination,'MCT');
assert.equal(genuineMct.status,'ARRIVED');
assert.equal(genuineMct.arrivalIsActual,true);

// It must never interpret a passenger flight's landing as cargo ARRIVED.
const source=readFileSync('lib/oman.js','utf8');
const route=readFileSync('app/api/track/route.js','utf8');
assert.ok(!source.includes("shipment={...shipment,status:'ARRIVED',arrivalDate:flightStatus"));
assert.ok(route.includes("mawb.startsWith('910-')?await loadStoredTrackingFallback(mawb)"));
assert.ok(route.includes("||flydubaiFastPath||mawb.startsWith('910-')"));
console.log('Oman BAH-MCT-DEL transit routing and final cargo-arrival guard passed.');
