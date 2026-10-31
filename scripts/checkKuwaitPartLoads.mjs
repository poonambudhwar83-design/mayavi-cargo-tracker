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
