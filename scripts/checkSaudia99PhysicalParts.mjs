import assert from 'node:assert/strict';
import { reconcileSaudiaPhysicalParts } from '../lib/saudiaPhysicalParts.js';
import { partIdentity, mergePartMail, mergePartCustoms } from '../lib/partMail.js';

// Real-world 06511493661 case: one physical ARR, the historic DEP of the same
// 49 bags, and a separate actual SAL RCF for the missing 50 at JED.
const arrived={partId:'SV760|2026-10-24|49|1147',partKey:'SV760|2026-10-24|49|1147',
 pieces:49,weight:1147,totalPieces:99,totalWeight:2565,
 flightNo:'SV760',flightDate:'2026-10-24',flightDestination:'DEL',
 arrivalDate:'2026-10-24',arrivalTime:'17:16',arrivalIsActual:true,status:'ARRIVED',
 sourceStatus:'ARR',mailSent:true,customsCleared:false};
const historicDep={...arrived,arrivalDate:'',arrivalTime:'',arrivalIsActual:false,
 status:'DEPARTED',sourceStatus:'DEP',mailSent:true};
const rcf={id:'JED|2026-10-25|11:08|50|1418|0',
 station:'JED',date:'2026-10-25',time:'11:08',pieces:50,weight:1418,
 flightNo:'SV1125',flightDate:'10/24/2026 12:00:00 AM',source:'SAL RCF',epoch:1792926480000};
const master={mawb:'065-11493661',destination:'DEL',
 source:'SAL complete shipment chronology',totalPieces:99,totalWeight:2565,
 arrivedPieces:49,arrivedWeight:1147,pendingPieces:50,pendingWeight:1418,
 partLoad:true,isPartLoad:true,partShipments:[arrived,historicDep],
 saudiaRcfMilestones:[rcf]};
const actual=reconcileSaudiaPhysicalParts(master);
assert.equal(actual.partShipments.length,2,'49 ARR and 50 SAL RCF; no duplicate 49 DEP');
assert.equal(new Set(actual.partShipments.map((p,i)=>partIdentity(p,i))).size,2,'independent PATCH IDs');
const a=actual.partShipments.find(p=>p.pieces===49);
const b=actual.partShipments.find(p=>p.pieces===50);
assert.ok(a&&b);
assert.equal(a.arrivalIsActual,true);
assert.equal(a.mailSent,true);
assert.equal(a.status,'ARRIVED');
assert.equal(b.weight,1418);
assert.equal(b.sourceStatus,'RCF');
assert.equal(b.transitAirport,'JED');
assert.equal(b.transitArrivalDate,'2026-10-25');
assert.equal(b.arrivalIsActual,false);
assert.equal(actual.saudiaVerifiedPendingBalance,false,'physical 50 RCF is recorded, no fictional virtual row');
assert.equal(actual.pendingPieces,50,'50 outstanding for Delhi');
assert.equal(actual.partShipments.reduce((s,p)=>s+p.pieces,0),99);
assert.equal(actual.partShipments.reduce((s,p)=>s+p.weight,0),2565);
// Independent 49 customs choice belongs only to the arrived physical part.
const saved=[{...a,customsCleared:true,customsClearedAt:'2026-10-31T02:00:00Z'},
 {...b,customsCleared:false}];
const refreshed=mergePartCustoms(mergePartMail(actual.partShipments,saved),saved);
assert.equal(refreshed.find(p=>p.pieces===49).customsCleared,true);
assert.notEqual(refreshed.find(p=>p.pieces===50).customsCleared,true);
// If only 49 ARR is verified so far, show 50 informational pending bags,
// without manufacturing a flight/physical part or customs clear eligibility.
const withoutRcf=reconcileSaudiaPhysicalParts({...master,saudiaRcfMilestones:[]});
assert.equal(withoutRcf.partShipments.length,1);
assert.equal(withoutRcf.saudiaVerifiedPendingBalance,true);
assert.equal(withoutRcf.saudiaUnassignedPieces,50);
assert.equal(withoutRcf.saudiaUnassignedWeight,1418);
// After arrival of the 50 at DEL, no pending balance survives.
const final=reconcileSaudiaPhysicalParts({...master,arrivedPieces:99,arrivedWeight:2565,
 partShipments:[arrived,{...b,sourceStatus:'ARR',arrivalIsActual:true,
 arrivalDate:'2026-10-26',arrivalTime:'12:00',flightDestination:'DEL'}]});
assert.equal(final.saudiaUnassignedPieces,0);
assert.equal(final.pendingPieces,0);
console.log('Saudia 99 split validated: 49 ARR + SAL 50 JED RCF, unique customs IDs, and informational pending balance.');
