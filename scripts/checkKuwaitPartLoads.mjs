import assert from 'node:assert/strict';
import { kuwaitPartLoadFromActivity } from '../lib/kuwaitPartLoads.js';

const ops=[
  {code:'PRE',airport:'KWI',dateText:'30-OCT-26 13:06',details:'Pre-Manifested on Flight on KU381/30-OCT-26 13:06, 46 Pieces, 1525.0 Kgs, 30-OCT-26 13:06 at KWI'},
  {code:'MAN',airport:'KWI',dateText:'30-OCT-26 13:05',details:'Manifested on Flight on KU381/30-OCT-26 13:05, 41 Pieces, 1360.0 Kgs, 30-OCT-26 13:05 at KWI'},
  {code:'PRE',airport:'KWI',dateText:'30-OCT-26 02:17',details:'Pre-Manifested on Flight on KU381/30-OCT-26 02:17, 87 Pieces, 2885.0 Kgs, 30-OCT-26 02:17 at KWI'},
  {code:'RCS',airport:'KWI',dateText:'24-OCT-26 18:37',details:'Received from shipper on KU381/24-OCT-26 18:37, 87 Pieces, 2885.0 Kgs, 24-OCT-26 18:37 at KWI'}
];
const row=kuwaitPartLoadFromActivity(ops,{mawb:'229-18109630',origin:'KWI',destination:'DEL',pieces:'46',weight:'1525.0'});
assert.ok(row,'Real 229-18109630 AWB must yield a split');
assert.equal(row.isPartLoad,true);
assert.equal(row.masterPieces,'87');
assert.equal(row.masterWeight,'2885');
assert.equal(row.pieces,'87');
assert.equal(row.weight,'2885');
assert.equal(row.partShipments.length,2);
assert.deepEqual(row.partShipments.map(p=>[p.pieces,p.totalPieces,p.weight,p.totalWeight,p.status,p.flightNo,p.flightDate]),[
  ['41','87','1360','2885','MANIFESTED','KU381','2026-10-30'],
  ['46','87','1525','2885','PRE-MANIFESTED','KU381','2026-10-30']
]);
assert.ok(row.partShipments.every(p=>p.arrivalIsActual===false&&!p.arrivalDate&&!p.arrivalTime&&!p.departureIsActual));
assert.equal(row.partShipments.reduce((n,p)=>n+Number(p.weight),0),2885);
assert.equal(new Set(row.partShipments.map(p=>p.partId)).size,2);
assert.equal(row.partShipments.reduce((n,p)=>n+Number(p.pieces),0),87);
// Duplicate/historical PRE is not a separate physical part.
assert.equal(kuwaitPartLoadFromActivity([...ops.slice(0,1),ops[0],ops[2],ops[3]],{destination:'DEL'}),null);
assert.equal(kuwaitPartLoadFromActivity([ops[2],ops[3]],{destination:'DEL'}),null);
const persisted=kuwaitPartLoadFromActivity([ops[0],{...ops[1],code:'PRE',details:ops[1].details.replace('Manifested on Flight','Pre-Manifested on Flight')},ops[1],ops[2],ops[3]],{destination:'DEL'});
assert.deepEqual(persisted.partShipments.map(p=>p.status),['MANIFESTED','PRE-MANIFESTED'],'Latest true MAN wins same physical part PRE history');
console.log('Kuwait 229 part load verified: 41/87 1360 MAN + 46/87 1525 PRE; total 87/2885, no false cargo arrival.');


const entireDeparted=[
  {code:'DEP',airport:'KWI',dateText:'31-OCT-26 19:15',details:'Departed on Flight on KU381/31-OCT-26 19:15, 87 Pieces, 2885.0 Kgs, 31-OCT-26 19:15 at KWI'},
  {code:'MAN',airport:'KWI',dateText:'31-OCT-26 12:24',details:'Manifested on Flight on KU381/31-OCT-26 12:24, 55 Pieces, 1824.0 Kgs, 31-OCT-26 12:24 at KWI'},
  {code:'MAN',airport:'KWI',dateText:'31-OCT-26 12:24',details:'Manifested on Flight on KU381/31-OCT-26 12:24, 32 Pieces, 1061.0 Kgs, 31-OCT-26 12:24 at KWI'},
  {code:'RCS',airport:'KWI',dateText:'30-OCT-26 22:17',details:'Received from shipper 87 Pieces, 2885.0 Kgs'}
];
const loaded=kuwaitPartLoadFromActivity(entireDeparted,{destination:'DEL'});
assert.equal(loaded.status,'DEPARTED','Verified direct KWI-DEL master cargo DEP means DEPARTED, not IN TRANSIT');
assert.equal(loaded.partShipments.length,2,'Keep two independently listed physical parts');
assert.deepEqual(loaded.partShipments.map(p=>[p.pieces,p.weight,p.status,p.sourceStatus]),[
  ['55','1824','DEPARTED','DEP'],['32','1061','DEPARTED','DEP']]);
assert.ok(loaded.partShipments.every(p=>p.departureIsActual===true&&!p.arrivalIsActual));
assert.ok(loaded.partShipments.every(p=>p.arrivalEstimate===true&&p.arrivalDate==='2026-11-01'&&p.arrivalTime==='04:45'&&p.arrivalTimeZone==='IST'));
assert.ok(loaded.partShipments.every(p=>p.arrivalTimeSource.includes('not cargo ARR')));
const unverified=kuwaitPartLoadFromActivity(entireDeparted.map(x=>({...x,
  code:x.code==='DEP'?'MAN':x.code})),{destination:'DEL'});
assert.equal(unverified.status,'PART LOAD');
assert.ok(unverified.partShipments.every(p=>p.departureIsActual===false));
console.log('Kuwait verified full 87-bag DEP updates both 55/32 physical rows without merging; MAN stays MAN');

const latestOps=[...entireDeparted];
latestOps[0]={...latestOps[0],
  dateText:'31-OCT-26 19:07',
  details:'Departed on Flight on KU381/31-OCT-26 19:07, 87 Pieces, 2885.0 Kgs, 31-OCT-26 19:07 at KWI'};
const current=kuwaitPartLoadFromActivity(latestOps,{mawb:'229-18109630',origin:'KWI',destination:'DEL'});
assert.equal(current.status,'DEPARTED');
assert.equal(current.partShipments.length,2);
assert.deepEqual(current.partShipments.map(p=>[p.pieces,p.weight,p.arrivalDate,p.arrivalTime,p.status]),[
  ['55','1824','2026-11-01','04:37','DEPARTED'],
  ['32','1061','2026-11-01','04:37','DEPARTED']]);
assert.equal(current.arrivalIsActual,false,'Kuwait RCF missing: ETA is not arrival');
const via=kuwaitPartLoadFromActivity(latestOps,{origin:'KWI',destination:'DEL',via:'DXB'});
assert.equal(via.status,'IN TRANSIT','Real via flights retain IN TRANSIT status');
console.log('Kuwait direct departure, separate 55/32 records, IST estimated arrival and via rule regression passed');
