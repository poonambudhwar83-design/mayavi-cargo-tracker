import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Regression: the live tab uses \s and \b once, not escaped literals.
// Otherwise the crawler misses hydrated milestones and may read stale summary data.
const adapterSource=readFileSync(new URL('../lib/airIndia.js',import.meta.url),'utf8');
assert.ok(adapterSource.includes(String.raw`current.search(/AWB\s+Activity\s+Timeline/i)`),
  'Activity View must detect the hydrated timeline heading');
assert.ok(adapterSource.includes(String.raw`timeline.match(/\b(?:FREIGHT\s+ON\s+HAND|FOW|BOOKED\s+Booked|DEPARTURE\s+Departed|ARRIVAL\s+Arrived|MANIFESTED\s+Manifested)\b/gi)`),
  'Activity View must detect new FOW and movement milestones');
assert.ok(!adapterSource.includes(String.raw`current.search(/AWB\\s+Activity\\s+Timeline/i)`),
  'Escaped literal \\s would break timeline hydration detection');

import { extractActivityMaster, parseActivity } from '../lib/airIndia.js';

const book='AWB Activity Timeline\nBOOKED Booked 19 pcs 1,002 kg at DEL for AI 187, 18 Oct 2026\nDEL • 17 Oct 2026, 18:30';
const correct=extractActivityMaster(book,{pieces:'17',bags:'17',weight:'985'});
assert.equal(correct?.pieces,'19');
assert.equal(correct?.bags,'19');
assert.equal(correct?.weight,'1002');
assert.equal(correct?.weightSource,'Air India AWB Activity View master milestone');

const fow='AWB Activity Timeline\nFREIGHT ON HAND Freight on hand 19 pcs 1,002.5 kg\nDEL • 17 Oct 2026, 16:40';
assert.equal(extractActivityMaster(fow,{pieces:'19',weight:'1002'})?.weight,'1002.5');
assert.equal(extractActivityMaster(fow,{pieces:'19',weight:'1002'})?.masterPieces,'19');

const split='AWB Activity Timeline\nBOOKED Booked 20 pcs 600 kg at DEL for AI 187, 18 Oct 2026\nBOOKED Booked 13 pcs 390 kg at DEL for AI 190, 19 Oct 2026';
assert.equal(extractActivityMaster(split,{pieces:'33',weight:'990'}),null,
  'Two individual part-bookings must not replace the 33-piece master');

const part='AWB Activity Timeline\nBOOKED Booked 20 pcs 600 kg at DEL for AI 187, 18 Oct 2026';
assert.equal(extractActivityMaster(part,{pieces:'33',weight:'990'}),null,
  'A single partial milestone must not replace a larger known master');

const arrival='AWB Activity Timeline\nARRIVAL Arrived 20 pcs 600 kg on AI187, 18 Oct 2026 12:30 (A) at DEL';
assert.equal(extractActivityMaster(arrival,{pieces:'33',weight:'990'}),null,
  'Movement quantity alone is not a verified master quantity');

assert.equal(extractActivityMaster('Tracking View: 19 pcs 1002 kg',{pieces:'19'}),null,
  'A hidden or unopened Activity View is not proof of activity totals');

const total='AWB Activity Timeline\nBOOKED Booked 33 pcs 990 kg at DEL for AI 187, 18 Oct 2026\nMANIFESTED Manifested 20 pcs 600 kg for AI187, 18 Oct 2026 at DEL';
assert.equal(extractActivityMaster(total,{pieces:'33',weight:'960'})?.weight,'990');
// A preliminary Tracking View can show 40 pcs / 800 kg while a verified FOW
// event records 36 pcs / 764 kg. Always prefer Activity View FOW.
const corrected=extractActivityMaster(
  'AWB Activity Timeline\nBOOKED Booked 40 pcs 800 kg at DEL for AI190, 18 Oct 2026\nFREIGHT ON HAND Freight on hand 36 pcs 764 kg',
  {pieces:'40',bags:'40',weight:'800'});
assert.equal(corrected?.pieces,'36');
assert.equal(corrected?.bags,'36');
assert.equal(corrected?.weight,'764');
assert.equal(corrected?.activityQuantitySource,'FOW');
// Duplicate FOW milestones are not separate loads.
assert.equal(extractActivityMaster(
  'AWB Activity Timeline\nFREIGHT ON HAND Freight on hand 36 pcs 764 kg\nFOW Freight on hand 36 pcs 764 kg',
  {pieces:'40',weight:'800'})?.pieces,'36');
// Multiple different partial FOW milestones are ambiguous; do not sum or
// replace a master shipment without a verified total.
assert.equal(extractActivityMaster(
  'AWB Activity Timeline\nFOW Freight on hand 20 pcs 400 kg\nFOW Freight on hand 16 pcs 364 kg',
  {pieces:'40',weight:'800'}),null);


const newOffload='AWB Activity Timeline\nOFFLOADED Offloaded 6 pcs 0 kg for IX-0124, 30 Oct 2026 at AUH\nAUH • 30 Oct 2026, 15:27:00\nOFFLOADED Offloaded 15 pcs 0 kg for IX-0124, 30 Oct 2026 at AUH\nAUH • 30 Oct 2026, 15:26:00\nBOOKED Booked 41 pcs 1,015 kg at AUH for IX-0124, 30 Oct 2026';
const example={origin:'AUH',destination:'DEL',pieces:'41',bags:'41',weight:'1015'};
const offloaded=parseActivity(newOffload,example);
assert.equal(offloaded.status,'OFFLOADED','Newer offloads must override future summary-card ETA');
assert.equal(offloaded.offloadedPieces,'21','Both 6 and 15 piece offloads must be counted');
assert.equal(offloaded.masterPieces,'41','41-piece total remains unchanged');
assert.equal(offloaded.arrivalVerifiedAbsent,true);
assert.equal(offloaded.arrivalDate,'');
assert.equal(offloaded.departureIsActual,false);
const priorDeparture='AWB Activity Timeline\nDEPARTURE Departed 41 pcs 1015 kg on IX-0124, 30 Oct 2026 14:00 (A) at AUH\n'+newOffload.replace('AWB Activity Timeline\n','');
assert.equal(parseActivity(newOffload+'\nDEPARTURE Departed 41 pcs 1015 kg on IX-0124, 30 Oct 2026 14:00 (A) at AUH',example).status,'OFFLOADED','Latest offload must override an older departure');
assert.equal(parseActivity(priorDeparture,example).status,'DEPARTED','A later verified departure restores transit');
// This AWB was offloaded on two separate dates; the older 28 Oct full
// offload is history. Count the latest 30 Oct 6+15+20 only once.
const historicalOffloads='AWB Activity Timeline\n'
  +'OFFLOADED Offloaded 6 pcs 0 kg for IX-0124, 30 Oct 2026 at AUH\n'
  +'OFFLOADED Offloaded 15 pcs 0 kg for IX-0124, 30 Oct 2026 at AUH\n'
  +'OFFLOADED Offloaded 20 pcs 0 kg for IX-0124, 30 Oct 2026 at AUH\n'
  +'DEPARTURE Departed 41 pcs 0 kg on IX-0124, 30 Oct 2026 14:40 (A) at AUH\n'
  +'OFFLOADED Offloaded 41 pcs 0 kg for IX-0124, 28 Oct 2026 at AUH';
const currentOffload=parseActivity(historicalOffloads,example);
assert.equal(currentOffload.status,'OFFLOADED');
assert.equal(currentOffload.offloadedPieces,'41','Historical 28 Oct offload must not double count current 30 Oct 41 pcs');
assert.equal(currentOffload.arrivalDate,'','An OFFLOADED master must not enter next-day arrival list');


const newerManifest='AWB Activity Timeline\n'
  +'MANIFESTED Manifested 41 pcs 0 kg for IX-0132, 01 Nov 2026 at AUH\n'
  +historicalOffloads.replace('AWB Activity Timeline\n','');
const latestManifest=parseActivity(newerManifest,example);
assert.equal(latestManifest.status,'MANIFESTED');
assert.equal(latestManifest.activityMilestone,'MANIFESTED');
assert.equal(latestManifest.flightNo,'IX0132');
assert.equal(latestManifest.flightDate,'2026-11-01');
assert.equal(latestManifest.masterPieces,'41');
assert.equal(latestManifest.masterWeight,'1015');
assert.equal(latestManifest.departureIsActual,false);
assert.equal(latestManifest.arrivalIsActual,false);
assert.equal(latestManifest.arrivalDate,'');
assert.equal(latestManifest.offloadedPieces,'0');
assert.ok(latestManifest.manifestEvidence.includes('IX-0132'));
assert.equal(parseActivity('AWB Activity Timeline\n'
  +historicalOffloads.replace('AWB Activity Timeline\n','')
  +'\nMANIFESTED Manifested 41 pcs 0 kg for IX-0132, 01 Nov 2026 at AUH',example).status,
  'OFFLOADED','Old manifest must not overrule latest offload');
assert.equal(parseActivity('AWB Activity Timeline\nMANIFESTED Manifested 10 pcs 0 kg for IX-0132, 01 Nov 2026 at AUH\n'
  +historicalOffloads.replace('AWB Activity Timeline\n',''),example).status,'OFFLOADED',
  'A partial manifest is not full-master confirmation');
const splitManifest='AWB Activity Timeline\n'
  +'MANIFESTED Manifested 21 pcs 0 kg for AI-0930, 01 Nov 2026 at DXB\n'
  +'MANIFESTED Manifested 20 pcs 0 kg for AI-0930, 01 Nov 2026 at DXB\n';
assert.equal(parseActivity(splitManifest,{origin:'DXB',destination:'DEL',pieces:'41',weight:'2020'}).status,'MANIFESTED');
assert.equal(parseActivity(splitManifest,{origin:'DXB',destination:'DEL',pieces:'41',weight:'2020'}).flightDate,'2026-11-01');
const fowWithManifest='AWB Activity Timeline\nFREIGHT ON HAND Freight on hand 24 pcs 1300 kg\n'
  +'MANIFESTED Manifested 24 pcs 0 kg for AI-0930, 01 Nov 2026 at DXB';
const fowManifest=parseActivity(fowWithManifest,{origin:'DXB',destination:'DEL',pieces:'24',weight:'1300'});
assert.equal(fowManifest.status,'FREIGHT ON HAND');
assert.equal(fowManifest.flightNo,'AI0930');
assert.equal(fowManifest.flightDate,'2026-11-01');
const fowWithBooked='AWB Activity Timeline\nFREIGHT ON HAND Freight on hand 41 pcs 2020 kg\n'
  +'BOOKED Booked 41 pcs 2020 kg at DXB for AI-0916, 01 Nov 2026';
assert.equal(parseActivity(fowWithBooked,{origin:'DXB',destination:'DEL',pieces:'41',weight:'2020'}).flightDate,'2026-11-01');


const buildUp='AWB Activity Timeline\n'
  +'BUILD UP Built Up 41 pcs 1015 kg for IX-0132, 01 Nov 2026 at AUH\n'
  +'OFFLOADED Offloaded 41 pcs 0 kg for IX-0124, 30 Oct 2026 at AUH';
const built=parseActivity(buildUp,example);
assert.equal(built.status,'BUILD UP');
assert.equal(built.flightNo,'IX0132');
assert.equal(built.flightDate,'2026-11-01');
assert.equal(built.arrivalDate,'');
assert.equal(built.departureIsActual,false);
assert.equal(parseActivity('AWB Activity Timeline\n'
  +'MANIFESTED Manifested 41 pcs 0 kg for IX-0132, 01 Nov 2026 at AUH\n'
  +buildUp.replace('AWB Activity Timeline\n',''),example).status,'MANIFESTED',
  'Later manifest must replace older Build Up');
assert.equal(parseActivity('AWB Activity Timeline\n'
  +'BUILT UP Built Up 41 pcs 1015 kg for IX-0132, 01 Nov 2026 at AUH',example).status,'BUILD UP');
assert.equal(parseActivity('AWB Activity Timeline\n'
  +'EXECUTED Executed 41 pcs 1015 kg for AI-0930, 01 Nov 2026 at DXB',
  {origin:'DXB',destination:'DEL',pieces:'41',weight:'1015'}).status,'EXECUTED');
assert.equal(parseActivity('AWB Activity Timeline\n'
  +'ACCEPTED Accepted 41 pcs 1015 kg for AI-0916, 01 Nov 2026 at DXB',
  {origin:'DXB',destination:'DEL',pieces:'41',weight:'1015'}).status,'ACCEPTED');
assert.equal(parseActivity('AWB Activity Timeline\n'
  +'FREIGHT ON HAND Freight on hand 41 pcs 1015 kg at DXB',
  {origin:'DXB',destination:'DEL',pieces:'41',weight:'1015'}).status,'FREIGHT ON HAND');

assert.equal(parseActivity('AWB Activity Timeline\nBOOKED Booked 41 pcs 1015 kg at AUH for IX-0132, 01 Nov 2026\nMANIFESTED Manifested 41 pcs 0 kg for IX-0124, 30 Oct 2026 at AUH',example).status,'BOOKED');
const actualDeparture='AWB Activity Timeline\nDEPARTURE Departed 41 pcs 1015 kg on IX-0124, 30 Oct 2026 18:20 (A) at AUH';
const departed=parseActivity(actualDeparture,example);
assert.equal(departed.status,'DEPARTED','Departure is not actual cargo arrival');
assert.equal(departed.departureIsActual,true);
assert.equal(departed.arrivalIsActual,false);
const actualArrival='AWB Activity Timeline\nARRIVAL Arrived 41 pcs 1015 kg on IX-0124, 31 Oct 2026 10:30 (A) at DEL';
const arrived=parseActivity(actualArrival,example);
assert.equal(arrived.status,'ARRIVED','Destination arrival in Activity View confirms cargo arrival');
assert.equal(arrived.arrivalIsActual,true);

console.log('Air India Activity View movement tests passed: OFFLOADED, DEPARTED, ARRIVED and quantity.');


import { acceptAirIndiaDatedEta } from '../lib/airIndiaScheduleEta.js';
const currentScheduled={mawb:'098-30448456',origin:'AUH',destination:'DEL',
  flightNo:'IX0124',flightDate:'2026-11-01',status:'MANIFESTED',arrivalIsActual:false};
const flightEta=acceptAirIndiaDatedEta(currentScheduled,{
  ok:true,departureDate:'2026-11-01',departureTime:'11:55',
  departureOrigin:'AUH',departureDestination:'DEL',
  arrivalDate:'2026-11-01',arrivalTime:'17:10',arrivalTimeZone:'LOCAL',source:'Flight timetable'});
assert.equal(flightEta.arrivalDate,'2026-11-01');
assert.equal(flightEta.arrivalTime,'17:10');
assert.equal(flightEta.arrivalEstimate,true);
assert.equal(flightEta.arrivalIsActual,false);
assert.equal(flightEta.arrivalVerifiedAbsent,false);
const dxBovernight=acceptAirIndiaDatedEta({mawb:'098-32251715',origin:'DXB',destination:'DEL',
  flightNo:'AI0916',flightDate:'2026-11-01',status:'MANIFESTED'},{
  departureDate:'2026-11-01',departureTime:'20:40',departureOrigin:'DXB',
  departureDestination:'DEL',arrivalDate:'2026-11-01',arrivalTime:'01:50',arrivalTimeZone:'LOCAL'});
assert.equal(dxBovernight.arrivalDate,'2026-11-02');
assert.equal(dxBovernight.arrivalTime,'01:50');
assert.equal(acceptAirIndiaDatedEta({...currentScheduled,status:'OFFLOADED'},{arrivalDate:'2026-11-01',arrivalTime:'17:10'}),null);
assert.equal(acceptAirIndiaDatedEta({...currentScheduled,flightDate:''},{arrivalDate:'2026-11-01',arrivalTime:'17:10'}),null);
assert.equal(acceptAirIndiaDatedEta(currentScheduled,{departureDate:'2026-10-30',arrivalDate:'2026-11-01',arrivalTime:'17:10'}),null);
assert.equal(acceptAirIndiaDatedEta(currentScheduled,{departureOrigin:'DXB',arrivalDate:'2026-11-01',arrivalTime:'17:10'}),null);
