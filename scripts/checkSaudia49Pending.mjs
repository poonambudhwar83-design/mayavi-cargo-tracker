import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {reconcile} from '../lib/saudiaStrong.js';
import {mergePartCustoms,mergePartMail,partIdentity} from '../lib/partMail.js';
import {enforceSaudiaArrivalEvidence} from '../lib/saudiaTransitGuard.js';

const event=(Status,Airport,DateTime_LT,Pieces,Weight,Flight_Number,Flight_Date,Flight_Dest)=>
 ({Status,Airport,DateTime_LT,Pieces,Weight,Flight_Number,Flight_Date,Flight_Dest,Flight_Origin:'DMM'});
// 065-11493661: the 49-pc DEL ARR and later duplicate 49-pc DEP are
// the same physical movement, even if SAL formats Flight_Date differently.
// 50-pc JED RCF is independent verified cargo, NOT a subtraction-only flight.
const raw={Awb:'06511493661',Origin:'DMM',Destination:'DEL',
 TotalPieces:99,TotalWeight:2565,
 Parts:[{Events:[
 event('RCS','DMM','10/24/2026 00:01',99,2565,'','10/24/2026','DEL'),
 event('FOW','DMM','10/24/2026 05:00',99,2565,'SV760','10/24/2026 12:00:00 AM','DEL'),
 event('ARR','DEL','10/24/2026 17:16',49,1147,'SV760','10/24/2026 12:00:00 AM','DEL'),
 event('DEP','DMM','10/24/2026 21:37',50,1418,'SV1125','10/24/2026 12:00:00 AM','JED'),
 event('RCF','JED','10/25/2026 11:08',50,1418,'SV1125','10/24/2026 12:00:00 AM','JED'),
 // Late duplicate flight timeline record, identical 49 bags but a different
 // raw date format; it should not consume 49 of the 50-pc pending capacity.
 event('DEP','DMM','10/25/2026 12:00',49,1147,'SV760','10/24/2026 00:00','DEL')
 ]}]};
const r=reconcile(raw);
assert.equal(r.totalPieces,99);
assert.equal(r.arrivedPieces,49);
assert.equal(r.pendingPieces,50);
assert.equal(r.pendingWeight,1418);
assert.equal(r.partShipments.length,2,JSON.stringify(r.partShipments));
assert.deepEqual(r.partShipments.map(p=>[p.pieces,p.weight,p.arrivalIsActual,p.sourceStatus]),[
 [49,1147,true,'ARR'],
 [50,1418,false,'RCF']]);
assert.equal(r.partShipments.find(p=>p.pieces===50).transitAirport,'JED');
assert.equal(r.saudiaRcfMilestones.some(p=>p.pieces===50&&p.station==='JED'),true);
assert.equal(new Set(r.partShipments.map(p=>p.partId)).size,2);
assert.equal(r.partShipments.reduce((s,p)=>s+p.pieces,0),99);
assert.equal(r.partShipments.reduce((s,p)=>s+p.weight,0),2565);
// A single 49-pc clearance stays with the 49-pc ARR, not the 50-pc RCF.
// Operator toggles are independent and persist through airline updates.
const stored=[{...r.partShipments[0],mailSent:true,customsCleared:true,customsClearedAt:'2026-10-31T04:00:00Z'},
 {...r.partShipments[1],mailSent:false,customsCleared:false}];
const newParts=mergePartCustoms(mergePartMail(r.partShipments,stored),stored);
assert.equal(newParts[0].customsCleared,true);
assert.equal(newParts[1].customsCleared,false);
assert.equal(newParts[0].mailSent,true);
assert.equal(new Set(newParts.map((p,i)=>partIdentity(p,i))).size,2);
const guarded=enforceSaudiaArrivalEvidence({mawb:'065-11493661',destination:'DEL',
  arrivedPieces:49,status:'PART ARRIVED',sourceStatus:'RCF',partShipments:newParts});
assert.equal(guarded.partShipments[0].arrivalIsActual,true);
assert.equal(guarded.partShipments[1].arrivalIsActual,false);
// Never silently stop showing the remaining balance before SAL releases
// a physical RCF/FOW. The UI adds only a clearly labelled virtual UNASSIGNED
// balance row in that situation, not a fabricated departed cargo.
const ui=readFileSync('app/DashboardClient.js','utf8');
assert.ok(ui.includes("if(prefix==='065'&&(row.partLoad===true||row.isPartLoad===true)&&Number(row.totalPieces||row.masterPieces||0)>0){"));
assert.ok(ui.includes("if(masterTotal>0&&parts.length>0&&available>0){"));
assert.ok(ui.includes("'BALANCE PENDING'"));
const api=readFileSync('app/api/shipments/route.js','utf8');
assert.ok(api.includes("body?.operation==='partCustoms'"));
assert.ok(api.includes("if(matches!==1)"));
assert.ok(api.includes("!awb.startsWith('065-')&&part.mailSent!==true"));
console.log('Saudia SAL 49/99 ARR vs 50/99 JED RCF; duplicate DEP removal, independent Customs and balance display passed.');
