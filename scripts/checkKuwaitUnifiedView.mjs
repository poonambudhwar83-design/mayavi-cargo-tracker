import assert from 'node:assert/strict';
import { kuwaitPartLoadFromActivity } from '../lib/kuwaitPartLoads.js';
import { consolidatedKuwaitDeparture } from '../lib/kuwaitUnifiedView.js';
import { kuwaitDatedArrivalEta, applyKuwaitDatedEta } from '../lib/kuwaitFlightEta.js';
import { reconcileKuwaitMasterEvents } from '../lib/kuwaitMasterEvents.js';

const ops=[
  {code:'DEP',airport:'KWI',dateText:'31-OCT-26 19:07',details:'Departed on Flight on KU381/31-OCT-26 19:07, 87 Pieces, 2885.0 Kgs, 31-OCT-26 19:07 at KWI'},
  {code:'MAN',airport:'KWI',dateText:'31-OCT-26 12:24',details:'Manifested on Flight on KU381/31-OCT-26 12:24, 55 Pieces, 1824.0 Kgs, 31-OCT-26 12:24 at KWI'},
  {code:'MAN',airport:'KWI',dateText:'31-OCT-26 12:24',details:'Manifested on Flight on KU381/31-OCT-26 12:24, 32 Pieces, 1061.0 Kgs, 31-OCT-26 12:24 at KWI'},
  {code:'RCS',airport:'KWI',dateText:'24-OCT-26 18:37',details:'Received from shipper 87 Pieces, 2885.0 Kgs, 24-OCT-26 18:37 at KWI'}
];
const physical=kuwaitPartLoadFromActivity(ops,{mawb:'229-18109630',origin:'KWI',destination:'DEL'});
assert.equal(physical.partShipments.length,2);
assert.equal(physical.status,'DEPARTED');
const old={...physical,mawb:'229-18109630',origin:'KWI',destination:'DEL',
  departureDate:'2026-10-31',departureTime:'19:07',
  arrivalDate:'2026-11-01',arrivalTime:'04:37',
  partShipments:physical.partShipments.map(p=>({...p,mailSent:true}))};
const published=kuwaitDatedArrivalEta(old,{});
assert.equal(published.arrivalDate,'2026-11-01');
assert.equal(published.arrivalTime,'01:30');
assert.equal(published.arrivalIsActual,false);
const corrected=applyKuwaitDatedEta(old,published);
assert.equal(corrected.arrivalTime,'01:30');
assert.deepEqual(corrected.partShipments.map(p=>p.arrivalTime),['01:30','01:30']);
assert.equal(corrected.arrivalIsActual,false);
const master=consolidatedKuwaitDeparture(corrected);
assert.ok(master,'87/87 on verified identical KU381 DEP is one master row');
assert.equal(master.status,'DEPARTED');
assert.equal(master.pieces,'87');assert.equal(master.weight,'2885');
assert.equal(master.arrivalDate,'2026-11-01');
assert.equal(master.arrivalTime,'01:30');
assert.equal(master.mailSent,true);
assert.equal(master._kuwaitSplitHistory.length,2);
assert.deepEqual(master._kuwaitSplitHistory.map(x=>[x.pieces,x.weight]),[['55','1824'],['32','1061']]);
assert.equal(corrected.partShipments.length,2,'Unmodified historic split retained');
assert.equal(consolidatedKuwaitDeparture({...corrected,kuwaitCargoDepartureConfirmed:false}),null);
assert.equal(consolidatedKuwaitDeparture({...corrected,partShipments:corrected.partShipments.map(p=>({...p,sourceStatus:'MAN',status:'MANIFESTED'}))}),null);
assert.equal(consolidatedKuwaitDeparture({...corrected,partShipments:corrected.partShipments.map((p,i)=>i===0?{...p,flightNo:'KU383'}:p)}),null);
assert.equal(consolidatedKuwaitDeparture({...corrected,partShipments:corrected.partShipments.map((p,i)=>i===0?{...p,arrivalIsActual:true,status:'ARRIVED',sourceStatus:'RCF'}:p)}),null);
assert.equal(consolidatedKuwaitDeparture({...corrected,partShipments:corrected.partShipments.map((p,i)=>i===0?{...p,customsCleared:true}:p)}),null);
assert.equal(consolidatedKuwaitDeparture({...corrected,partShipments:corrected.partShipments.map((p,i)=>i===0?{...p,weight:'1560'}:p)}),null);
assert.equal(consolidatedKuwaitDeparture({...corrected,partShipments:corrected.partShipments.map((p,i)=>i===0?{...p,departureDate:'2026-10-30'}:p)}),null);
const oldPreman=kuwaitPartLoadFromActivity(ops.filter(x=>x.code!=='DEP'),{origin:'KWI',destination:'DEL'});
assert.equal(oldPreman?.status,'PART LOAD');
const live=kuwaitDatedArrivalEta(old,{arrivalDate:'2026-10-31',arrivalTime:'01:02',
  arrivalTimeZone:'IST',departureDate:'2026-10-31',flightNo:'KU381',source:'Verified dated flight ETA'});
assert.equal(live.arrivalDate,'2026-11-01','midnight calendar rollover');
assert.equal(live.arrivalTime,'01:02');
assert.equal(kuwaitDatedArrivalEta({...old,flightDate:'2026-11-03'},null)?.arrivalTime,undefined,'unknown future timetable never gets a fake +7h');
assert.equal(kuwaitDatedArrivalEta(old,{flightNo:'KU383',departureDate:'2026-10-31',arrivalDate:'2026-11-01',arrivalTime:'06:00'}).arrivalTime,'01:30','wrong-flight ETA rejected, known schedule fallback');
console.log('Kuwait 87/87 merge verified; accurate dated ETA 01 Nov 01:30 IST; 55+32 history, Customs/Mail, no false arrival, and split/unmerge safeguards verified.');

const genericMawb={mawb:'229-90876543',origin:'KWI',destination:'DEL',flightNo:'KU383',
  flightDate:'2026-11-05',pieces:'20',weight:'700',status:'ARRIVED',arrivalDate:'2026-11-05',
  arrivalTime:'23:59',arrivalIsActual:true}; // stale legacy +7h clock must not imply ARR
const genericOps=[
  {code:'DEP',airport:'KWI',dateText:'05-NOV-26 19:22',
    details:'Departed on Flight on KU383/05-NOV-26 19:22, 20 Pieces, 700.0 Kgs, 05-NOV-26 19:22 at KWI'},
  {code:'RCS',airport:'KWI',dateText:'05-NOV-26 14:00',
    details:'Received from shipper on KU383/05-NOV-26 14:00, 20 Pieces, 700.0 Kgs at KWI'}];
const generic=reconcileKuwaitMasterEvents(genericMawb,genericOps);
assert.equal(generic.status,'DEPARTED','Any 229 master with exact full DEP must be DEPARTED');
assert.equal(generic.arrivalIsActual,false,'Time passed must not imply official cargo arrival');
assert.equal(generic.kuwaitCargoDepartureConfirmed,true);
assert.equal(generic.partShipments,undefined,'Single-load Kuwait master remains single row');
assert.equal(generic.departureTime,'19:22');
const anotherDated=kuwaitDatedArrivalEta(generic,{flightNo:'KU383',departureDate:'2026-11-05',
  arrivalDate:'2026-11-06',arrivalTime:'02:20',arrivalTimeZone:'IST',source:'Dated flight timetable'});
assert.equal(anotherDated.arrivalTime,'02:20','Future other KU flights use their own live ETA');
assert.match(anotherDated.arrivalTimeSource,/KU383/,'Future ETA label must contain actual flight');
const genericWithEta=applyKuwaitDatedEta(generic,anotherDated);
assert.equal(genericWithEta.status,'DEPARTED');
assert.equal(genericWithEta.arrivalTime,'02:20');
assert.equal(genericWithEta.arrivalIsActual,false);
const noDate=kuwaitDatedArrivalEta(generic,{});
assert.equal(noDate,null,'Never reuse 31 Oct KU381 ETA for future shipments');
assert.equal(applyKuwaitDatedEta(generic,noDate).arrivalTime,'','Unknown future ETA stays blank');
const irrelevant=reconcileKuwaitMasterEvents(genericMawb,[{...genericOps[0],
  details:genericOps[0].details.replace('20 Pieces','19 Pieces')}]);
assert.equal(irrelevant.kuwaitCargoDepartureConfirmed,undefined,'19/20 cargo cannot confirm full uplift');
const confirmedRcf=reconcileKuwaitMasterEvents(genericMawb,[{code:'RCF',airport:'DEL',
  dateText:'06-NOV-26 03:00',details:'Received from Flight on KU383/06-NOV-26 03:00, 20 Pieces, 700.0 Kgs'},...genericOps]);
assert.equal(confirmedRcf.status,'ARRIVED');
assert.equal(confirmedRcf.arrivalIsActual,true);
assert.equal(confirmedRcf.arrivalTime,'03:00');
const transit=reconcileKuwaitMasterEvents({...genericMawb,destination:'LHR',via:'DXB'},genericOps);
assert.equal(transit.status,'IN TRANSIT');
console.log('Any Kuwait 229 MAWB verified: official whole-master DEP, true RCF arrival, independent future dated flight ETA, no sample AWB dependence.');
