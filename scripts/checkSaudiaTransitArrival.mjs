import assert from 'node:assert/strict';
import { applySaudiaConnectionGuard } from '../lib/saudiaTransitGuard.js';
const base={mawb:'065-11493672',origin:'DMM',destination:'DEL',
  flightNo:'SV1125',flightDestination:'JED',airport:'DMM',sourceStatus:'DEP',
  status:'DEPARTED',arrivalDate:'2026-10-24',arrivalTime:'17:00',
  scheduledArrivalDate:'2026-10-24',scheduledArrivalTime:'17:00',
  arrivalIsActual:false,totalPieces:71,totalWeight:1840,arrivedPieces:0,
  partShipments:[{partId:'SV760|2026-10-24|71|1840',flightNo:'SV760',
    pieces:71,weight:1840,arrivalDate:'2026-10-24',arrivalIsActual:false,
    status:'IN TRANSIT'}]};
const flight='SV1125';
const event=(Status,Airport,DateTime_LT,Flight_Dest,Flight_Number=flight)=>({
  Status,Airport,DateTime_LT,Flight_Dest,Flight_Number,Flight_Date:'10/24/2026 12:00 AM',
  Pieces:71,Weight:1840
});
const timeline={Awb:'06511493672',Origin:'DMM',Destination:'DEL',Parts:[{Events:[
  event('MAN','DMM','10/24/2026 17:59','JED'),
  event('FOW','DMM','10/24/2026 18:06','JED'),
  event('DEP','DMM','10/24/2026 22:48','JED'),
  event('ARR','JED','10/24/2026 23:55','JED')
]}]};
const fixed=applySaudiaConnectionGuard(base,timeline);
assert.equal(fixed.status,'IN TRANSIT');
assert.equal(fixed.airport,'JED');
assert.equal(fixed.currentLocation,'JED');
assert.equal(fixed.sourceStatus,'ARR');
assert.equal(fixed.flightDestination,'JED');
assert.equal(fixed.transitArrivalDate,'2026-10-24');
assert.equal(fixed.transitArrivalTime,'23:55');
assert.equal(fixed.arrivalDate,'');
assert.equal(fixed.arrivalTime,'');
assert.equal(fixed.scheduledArrivalDate,'');
assert.equal(fixed.scheduledArrivalTime,'');
assert.equal(fixed.arrivalIsActual,false);
assert.equal(fixed.arrivalVerifiedAbsent,true);
assert.equal(fixed.partShipments.length,1);
assert.equal(fixed.partShipments[0].flightNo,'SV1125');
assert.equal(fixed.partShipments[0].arrivalDate,'');
assert.equal(fixed.partShipments[0].status,'IN TRANSIT');
assert.equal(fixed.partShipments[0].pieces,71);
assert.equal(fixed.partShipments[0].weight,1840);
// When DEL genuinely gets its own ARR event the guard must NOT erase it.
const arrived={...timeline,Parts:[{Events:[...timeline.Parts[0].Events,
  event('ARR','DEL','10/25/2026 13:00','DEL','SV760')]}]};
const actual=applySaudiaConnectionGuard({...base,status:'ARRIVED',arrivalIsActual:true,
  arrivalDate:'2026-10-25',arrivalTime:'15:30',arrivedPieces:71},arrived);
assert.equal(actual.status,'ARRIVED');
assert.equal(actual.arrivalDate,'2026-10-25');
assert.equal(actual.arrivalVerifiedAbsent,undefined);
// Future Delhi booking supersedes older transit ARR, but is not an actual arrival.
const future={...timeline,Parts:[{Events:[...timeline.Parts[0].Events,
  event('MAN','JED','10/25/2026 02:00','DEL','SV760')]}]};
const newer=applySaudiaConnectionGuard({...base,flightDestination:'DEL',
  arrivalDate:'2026-10-25',arrivalTime:'17:00'},future);
assert.equal(newer.arrivalDate,'2026-10-25');
assert.notEqual(newer.status,'ARRIVED');
assert.equal(applySaudiaConnectionGuard({...base,mawb:'098-11493672'},timeline).status,'DEPARTED');
assert.equal(applySaudiaConnectionGuard(base,{...timeline,Awb:'06599999999'}).status,'DEPARTED');
console.log('Saudia transit-JED vs final-DEL arrival regression passed');
