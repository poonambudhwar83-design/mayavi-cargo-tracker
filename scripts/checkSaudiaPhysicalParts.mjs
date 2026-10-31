import assert from 'node:assert/strict';
import { reconcile } from '../lib/saudiaStrong.js';
import { applySaudiaPartFlightEtas } from '../lib/saudiaPartEta.js';

const ev=(Status,Airport,DateTime_LT,Pieces,Weight,Flight_Number='',Flight_Date='10/30/2026 12:00:00 AM',Flight_Dest='JED')=>({
 Status,Airport,DateTime_LT,Pieces,Weight,Flight_Number,Flight_Date,Flight_Dest
});
const data={
  Origin:'DMM',Destination:'DEL',TotalPieces:121,TotalWeight:2850,
  Parts:[{Events:[
    ev('RCS','DMM','10/29/2026 05:00 PM',121,2850),
    ev('FOW','DMM','10/30/2026 01:00 AM',121,2850,'SV1113'),
    ev('DEP','DMM','10/30/2026 05:00 PM',113,2661.6,'SV1113'),
    ev('FOW','DMM','10/30/2026 05:00 PM',8,188.4,'SV1125'),
    ev('RCF','JED','10/30/2026 08:16 PM',113,2661.6,'SV1113'),
    ev('MAN','DMM','10/31/2026 01:39 AM',8,188.4,'SV1127','10/31/2026 12:00:00 AM'),
    ev('FOW','DMM','10/31/2026 01:40 AM',8,188.4,'SV1127','10/31/2026 12:00:00 AM')
  ]}]
};
const result=reconcile(data);
assert.equal(result.totalPieces,121);
assert.equal(result.totalWeight,2850);
assert.equal(result.arrivedPieces,0,'JED RCF is not final destination cargo ARR');
assert.equal(result.partShipments.length,2,'One 113 RCF and one 8 FOW, no virtual balance or old 8 duplicate');
const byCount=new Map(result.partShipments.map(p=>[p.pieces,p]));
const large=byCount.get(113),small=byCount.get(8);
assert.ok(large&&small);
assert.equal(large.weight,2661.6);
assert.equal(large.sourceStatus,'RCF');
assert.equal(large.transitAirport,'JED');
assert.equal(large.arrivalIsActual,false);
assert.equal(large.arrivalDate,'');
assert.equal(small.weight,188.4);
assert.equal(small.flightNo,'SV1127');
assert.equal(small.sourceStatus,'FOW');
assert.equal(small.flightDate,'2026-10-31');
assert.equal(result.partShipments.reduce((n,p)=>n+p.pieces,0),121);
assert.equal(result.partShipments.reduce((n,p)=>n+p.weight,0),2850);
assert.equal(new Set(result.partShipments.map(p=>p.partId)).size,2);
assert.equal(result.saudiaRcfMilestones.some(e=>e.pieces===113&&e.station==='JED'),true);
// Only a dated matching flight/location gets a visible ETA. FOW never
// proves cargo ARR; DEP upgrades to confirmed *flight* ETA, not cargo arrival.
const shipment={destination:'DEL',partShipments:result.partShipments};
const schedule=async ({flightNo,date,destination})=>{
 if(flightNo==='SV1127'&&date==='2026-10-31'&&destination==='JED')return{
 ok:true,flightNo,departureDate:date,departureDestination:destination,
 arrivalDate:'2026-10-31',arrivalTime:'06:30',arrivalTimeZone:'LOCAL'};
 return null;
};
const estimated=await applySaudiaPartFlightEtas(shipment,schedule);
const fow=estimated.partShipments.find(p=>p.pieces===8);
assert.equal(fow.arrivalDate,'','JED flight ETA must never be shown as DEL cargo ETA');
assert.equal(fow.transitEstimatedArrivalStation,'JED');
assert.equal(fow.transitEstimatedArrivalDate,'2026-10-31');
assert.ok(fow.transitEstimatedArrivalTime);
assert.equal(fow.saudiaArrivalStage,'ESTIMATED');
assert.equal(fow.arrivalIsActual,false);
const dep=await applySaudiaPartFlightEtas({destination:'DEL',partShipments:[
 {...small,sourceStatus:'DEP',flightDestination:'DEL',flightNo:'SV760'}]},async()=>({
 ok:true,flightNo:'SV760',departureDestination:'DEL',
 departureDate:'2026-10-31',arrivalDate:'2026-10-31',
 arrivalTime:'17:15',arrivalTimeZone:'IST'}));
assert.equal(dep.partShipments[0].saudiaArrivalStage,'CONFIRMED_ETA');
assert.equal(dep.partShipments[0].arrivalTime,'17:15');
assert.equal(dep.partShipments[0].arrivalIsActual,false);
console.log('Saudia SAL physical 113/121 JED RCF + 8/121 SV1127 FOW; per-part ETA and no false DEL ARR passed.');
