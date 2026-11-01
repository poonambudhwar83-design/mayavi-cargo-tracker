import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applySaudiaConnectionGuard, guardSaudiaConnectingFlightWithoutSal, planSaudiaDelhiPreArrival, enforceSaudiaArrivalEvidence } from '../lib/saudiaTransitGuard.js';
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
const offline=guardSaudiaConnectingFlightWithoutSal(base);
assert.equal(offline.arrivalDate,'');
assert.equal(offline.arrivalTime,'');
assert.equal(offline.arrivalVerifiedAbsent,true);
assert.equal(offline.status,'DEPARTED');

// Master 065-11493661: 49 bags DEL arrived, 50 bags on SV1125 for JED.
// Earlier source versions omitted the second physical row despite DEP evidence.
const split={mawb:'065-11493661',origin:'DMM',destination:'DEL',
  flightNo:'SV1125',flightDestination:'JED',airport:'DMM',sourceStatus:'DEP',
  status:'IN TRANSIT',arrivalDate:'2026-10-24',arrivalTime:'17:16',
  arrivalIsActual:false,arrivedPieces:49,arrivedWeight:1147,totalPieces:99,totalWeight:2565,
  pendingPieces:50,pendingWeight:1418,partLoad:true,isPartLoad:true,
  partLoadHistory:[
    {flightNo:'SV760',flightDate:'10/24/2026 12:00:00 AM',
      departed:{pieces:49,weight:1147}},
    {flightNo:'SV1125',flightDate:'10/24/2026 12:00:00 AM',
      departed:{pieces:50,weight:1418}}
  ],
  partShipments:[{partId:'SV760|2026-10-24|49|1147',
    partKey:'SV760|2026-10-24|49|1147',flightNo:'SV760',
    flightDate:'2026-10-24',pieces:49,weight:1147,totalPieces:99,
    totalWeight:2565,status:'ARRIVED',arrivalIsActual:true,
    arrivalDate:'2026-10-24',arrivalTime:'17:16',mailSent:true}]
};
const retained=guardSaudiaConnectingFlightWithoutSal(split);
assert.equal(retained.partShipments.length,2);
assert.equal(retained.partShipments[0].pieces,49);
assert.equal(retained.partShipments[0].arrivalIsActual,true);
assert.equal(retained.partShipments[0].mailSent,true);
assert.equal(retained.partShipments[0].arrivalTime,'17:16');
assert.equal(retained.partShipments[1].pieces,50);
assert.equal(retained.partShipments[1].weight,1418);
assert.equal(retained.partShipments[1].flightNo,'SV1125');
assert.equal(retained.partShipments[1].flightDestination,'JED');
assert.equal(retained.partShipments[1].status,'IN TRANSIT');
assert.equal(retained.partShipments[1].arrivalIsActual,false);
assert.equal(retained.partShipments[1].arrivalDate,'');
assert.equal(retained.status,'PART ARRIVED');
const splitTimeline={Awb:'06511493661',Destination:'DEL',Parts:[{Events:[
 {...event('ARR','DEL','10/24/2026 17:16','DEL','SV760'),Pieces:49,Weight:1147},
 {...event('DEP','DMM','10/24/2026 22:48','JED','SV1125'),Pieces:50,Weight:1418},
 {...event('ARR','JED','10/24/2026 23:55','JED','SV1125'),Pieces:50,Weight:1418}
]}]};
const transitPart=applySaudiaConnectionGuard(retained,splitTimeline);
assert.equal(transitPart.partShipments.length,2);
assert.deepEqual(transitPart.partShipments.map(p=>p.pieces),[49,50]);
assert.equal(transitPart.partShipments.reduce((total,p)=>total+p.weight,0),2565);
assert.equal(transitPart.partShipments[0].status,'ARRIVED');
assert.equal(transitPart.partShipments[0].mailSent,true);
assert.equal(transitPart.partShipments[1].status,'IN TRANSIT');
assert.equal(transitPart.partShipments[1].transitAirport,'JED');
assert.equal(transitPart.partShipments[1].transitArrivalTime,'23:55');
assert.equal(transitPart.partShipments[1].arrivalDate,'');
assert.equal(transitPart.status,'PART ARRIVED');


// 121-bag SAL master: 113/121 (2661.6kg) and 8/121 (188.4kg) were received
// separately at JED. Old dashboard guard wrongly replaced both with a fake
// 121/121, 188.4/2850 kg row using the latest SV1127 8-bag DEP.
const sal121={mawb:'065-11493775',origin:'DMM',destination:'DEL',
  flightNo:'SV1127',flightDestination:'JED',airport:'DMM',
  sourceStatus:'DEP',status:'DEPARTED',arrivedPieces:0,arrivedWeight:0,
  totalPieces:121,totalWeight:2850,partLoad:true,isPartLoad:true,
  partLoadHistory:[
    {flightNo:'SV1113',flightDate:'10/30/2026 12:00:00 AM',departed:{pieces:113,weight:2661.6}},
    {flightNo:'SV1127',flightDate:'10/31/2026 12:00:00 AM',departed:{pieces:8,weight:188.4}}
  ],
  partShipments:[
    {partId:'SV1127|2026-10-31|8|188.4',partKey:'SV1127|2026-10-31|8|188.4',
      flightNo:'SV1127',flightDate:'2026-10-31',pieces:8,weight:188.4,
      totalPieces:121,totalWeight:2850,sourceStatus:'RCF',
      status:'IN TRANSIT',arrivalIsActual:false,transitAirport:'JED',flightDestination:'JED'},
    {partId:'SV1113|2026-10-30|113|2661.6',partKey:'SV1113|2026-10-30|113|2661.6',
      flightNo:'SV1113',flightDate:'2026-10-30',pieces:113,weight:2661.6,
      totalPieces:121,totalWeight:2850,sourceStatus:'RCF',
      status:'IN TRANSIT',arrivalIsActual:false,transitAirport:'JED',flightDestination:'JED'}
  ]};
const weightGuarded=guardSaudiaConnectingFlightWithoutSal(sal121);
assert.equal(weightGuarded.partShipments.length,2,
  'Never replace 113+8 physical parts with one 121-bag row');
assert.deepEqual(weightGuarded.partShipments.map(p=>p.pieces).sort((a,b)=>a-b),[8,113]);
assert.equal(weightGuarded.partShipments.reduce((n,p)=>n+p.weight,0),2850);
assert.equal(weightGuarded.partShipments.find(p=>p.pieces===8).weight,188.4);
assert.equal(weightGuarded.partShipments.find(p=>p.pieces===113).weight,2661.6);
assert.equal(weightGuarded.status,'IN TRANSIT','JED receipts are not final DEL arrival');
assert.equal(weightGuarded.arrivalDate||'','');
assert.equal(weightGuarded.arrivalIsActual,false);
// Even a temporarily incomplete parts list must not assign the 8-bag
// flight weight to all 121 bags.
const partialGuarded=guardSaudiaConnectingFlightWithoutSal({
  ...sal121,partShipments:[sal121.partShipments[0]]});
assert.equal(partialGuarded.partShipments.length,1);
assert.equal(partialGuarded.partShipments[0].pieces,8);
assert.equal(partialGuarded.partShipments[0].weight,188.4);

// The saved history fallback must be used by the dashboard itself, not only
// by the background refresh: a 49+50 split must render even before cron writes.
const dashboard=readFileSync('app/DashboardClient.js','utf8');
assert.ok(dashboard.includes("guardSaudiaConnectingFlightWithoutSal(savedRow)"));
assert.ok(dashboard.includes("p.arrivalIsActual===true?row.destination:(p.transitAirport||row.airport||'')"));

// Advance-mail regression: an AWB-matched Delhi final flight can be forecast
// at MAN (before FOW and departure), without labelling it a cargo ARRIVED.
const manifest={...splitTimeline,Parts:[{Events:[
 ...splitTimeline.Parts[0].Events,
 {Status:'MAN',Airport:'JED',DateTime_LT:'10/25/2026 06:15 AM',
  Flight_Origin:'JED',Flight_Dest:'DEL',Flight_Number:'SV760',
  Flight_Date:'10/25/2026 06:30 AM',Pieces:50,Weight:1418}
]}]};
let checked=0;
const officialSchedule=async ({flightNo,date,origin,destination})=>{
  checked++;
  assert.equal(flightNo,'SV760');assert.equal(date,'2026-10-25');
  assert.equal(origin,'JED');assert.equal(destination,'DEL');
  return {ok:true,flightNo:'SV760',departureDestination:'DEL',
    arrivalDate:'2026-10-25',arrivalTime:'17:29',arrivalTimeZone:'IST',
    arrivalIsActual:false,source:'Date-specific final DEL flight timetable'};
};
const planned=await planSaudiaDelhiPreArrival(transitPart,manifest,
  {flightSchedule:officialSchedule});
assert.equal(checked,0); // SAL MAN alone never creates cargo Arrival/Mail clocks.
assert.equal(planned.status,'PART ARRIVED');
assert.equal(planned.partShipments.length,2);
assert.equal(planned.partShipments[0].mailSent,true);
assert.equal(planned.partShipments[0].arrivalDate,'2026-10-24');
assert.equal(planned.partShipments[0].arrivalTime,'17:16');
assert.equal(planned.partShipments[1].flightNo,'SV760');
assert.equal(planned.partShipments[1].flightDestination,'DEL');
assert.equal(planned.partShipments[1].sourceStatus,'MAN');
assert.equal(planned.partShipments[1].status,'BOOKED');
assert.equal(planned.partShipments[1].arrivalDate,'');
assert.equal(planned.partShipments[1].arrivalTime,'');
assert.equal(planned.partShipments[1].saudiaArrivalStage,'PLANNED');
assert.equal(planned.partShipments[1].arrivalEstimate,false);
assert.equal(planned.partShipments[1].mailSent,false);
// After actual SAL FOW this AWB can receive a verified pre-arrival ETA.
const fowManifest={...manifest,Parts:[{Events:[
  ...manifest.Parts[0].Events.slice(0,-1),
  {...manifest.Parts[0].Events.at(-1),Status:'FOW'}
]}]};
const fow=await planSaudiaDelhiPreArrival(transitPart,fowManifest,
  {flightSchedule:officialSchedule});
assert.equal(checked,1);
assert.equal(fow.partShipments[1].sourceStatus,'FOW');
assert.equal(fow.partShipments[1].status,'IN TRANSIT');
assert.equal(fow.partShipments[1].saudiaArrivalStage,'ESTIMATED');
assert.equal(fow.partShipments[1].arrivalDate,'2026-10-25');
assert.equal(fow.partShipments[1].arrivalTime,'17:29');
assert.equal(fow.partShipments[1].arrivalEstimate,true);
assert.equal(fow.partShipments[1].arrivalIsActual,false);
assert.equal(fow.partShipments[1].mailSent,false);
const predicted=Date.parse(fow.partShipments[1].arrivalDate+'T'+fow.partShipments[1].arrivalTime+':00Z');
const deadline=new Date(predicted-6*3600*1000).toISOString().slice(0,16);
assert.equal(deadline,'2026-10-25T11:29');
// SAL DEP confirms flight departed, NOT the cargo's actual ARR at Delhi.
const depManifest={...manifest,Parts:[{Events:[
 ...manifest.Parts[0].Events.slice(0,-1),
 {...manifest.Parts[0].Events.at(-1),Status:'DEP'}
]}]};
const dep=await planSaudiaDelhiPreArrival(transitPart,depManifest,
  {flightSchedule:officialSchedule});
assert.equal(dep.partShipments[1].sourceStatus,'DEP');
assert.equal(dep.partShipments[1].status,'DEPARTED');
assert.equal(dep.partShipments[1].saudiaArrivalStage,'CONFIRMED_ETA');
assert.equal(dep.partShipments[1].arrivalTime,'17:29');
assert.equal(dep.partShipments[1].arrivalIsActual,false);


// SV1125 arrives JED only: no Delhi forecast or email deadline may come from it.
const noFinal=await planSaudiaDelhiPreArrival(transitPart,splitTimeline,
  {flightSchedule:async()=>{throw Error('Must not query JED as DEL');}});
assert.equal(noFinal.partShipments[1].arrivalTime,'');
assert.equal(noFinal.partShipments[1].flightDestination,'JED');
// A stale previously manifested Delhi leg, before the JED transit ARR,
// must not be reused to promise a future Delhi arrival.
const oldManifest={...splitTimeline,Parts:[{Events:[
 {...manifest.Parts[0].Events.at(-1),DateTime_LT:'10/24/2026 18:15',Flight_Date:'10/24/2026 12:00 AM',Pieces:50},
 ...splitTimeline.Parts[0].Events
]}]};
const ignored=await planSaudiaDelhiPreArrival(transitPart,oldManifest,
  {flightSchedule:async()=>{throw Error('Stale flight must not be scheduled');}});
assert.equal(ignored.flightNo,'SV1125');
// SAL may already MAN next day's DEL flight before the same cargo arrives JED.
// Advance notice must survive this earlier, legitimate MAN event.
const advanceManifest={...splitTimeline,Parts:[{Events:[
 {...manifest.Parts[0].Events.at(-1),DateTime_LT:'10/24/2026 22:00',Pieces:50},
 ...splitTimeline.Parts[0].Events
]}]};
const advanced=await planSaudiaDelhiPreArrival(transitPart,advanceManifest,
  {flightSchedule:officialSchedule});
assert.equal(advanced.partShipments[1].flightNo,'SV760');
assert.equal(advanced.partShipments[1].arrivalTime,'');
assert.equal(advanced.partShipments[1].saudiaArrivalStage,'PLANNED');
assert.equal(advanced.partShipments[1].arrivalIsActual,false);
// Even if a flight timetable returns the wrong route, no Mail ETA is created.
const wrongRoute=await planSaudiaDelhiPreArrival(transitPart,fowManifest,
  {flightSchedule:async()=>({ok:true,flightNo:'SV760',departureDestination:'JED',
      arrivalDate:'2026-10-25',arrivalTime:'17:29',arrivalTimeZone:'IST'})});
assert.equal(wrongRoute.partShipments[1].arrivalTime,'');
assert.equal(wrongRoute.partShipments[1].mailSent,false);
// Even the correct SV number must not borrow a different origin/date's ETA.
const wrongOrigin=await planSaudiaDelhiPreArrival(transitPart,fowManifest,
  {flightSchedule:async()=>({ok:true,flightNo:'SV760',departureOrigin:'RUH',
    departureDestination:'DEL',departureDate:'2026-10-25',
    arrivalDate:'2026-10-25',arrivalTime:'17:29',arrivalTimeZone:'IST'})});
assert.equal(wrongOrigin.partShipments[1].arrivalTime,'');
const wrongOperatingDate=await planSaudiaDelhiPreArrival(transitPart,fowManifest,
  {flightSchedule:async()=>({ok:true,flightNo:'SV760',departureOrigin:'JED',
    departureDestination:'DEL',departureDate:'2026-10-24',
    arrivalDate:'2026-10-25',arrivalTime:'17:29',arrivalTimeZone:'IST'})});
assert.equal(wrongOperatingDate.partShipments[1].arrivalTime,'');
// MAN canceled by DIS must not produce a final Delhi mail deadline.
const cancelledManifest={...manifest,Parts:[{Events:[
 ...manifest.Parts[0].Events,
 {Status:'DIS',Airport:'JED',DateTime_LT:'10/25/2026 06:55 AM',
  Flight_Origin:'JED',Flight_Dest:'DEL',Flight_Number:'SV760',
  Flight_Date:'10/25/2026 06:30 AM',Pieces:50,Weight:1418}
]}]};
const cancelled=await planSaudiaDelhiPreArrival(transitPart,cancelledManifest,
 {flightSchedule:async()=>{throw Error('Cancelled DEL manifest may not get ETA');}});
assert.equal(cancelled.partShipments[1].flightNo,'SV1125');
// Brand-new unsplit AWB gets future flight status and ETA as soon as SAL MAN exists.
const newMaster={mawb:'065-99999123',destination:'DEL',totalPieces:12,
  totalWeight:240,arrivedPieces:0,arrivalIsActual:false,
  status:'BOOKED',partShipments:[]};
const firstManifest={Awb:'06599999123',Destination:'DEL',Parts:[{Events:[
 {...manifest.Parts[0].Events.at(-1),Pieces:12,Weight:240}
]}]};
const first=await planSaudiaDelhiPreArrival(newMaster,firstManifest,
  {flightSchedule:officialSchedule});
assert.equal(first.partShipments.length,1);
assert.equal(first.partShipments[0].arrivalEstimate,false);
assert.equal(first.partShipments[0].saudiaArrivalStage,'PLANNED');
assert.equal(first.partShipments[0].arrivalIsActual,false);
assert.equal(first.arrivalDate,'');
assert.equal(first.arrivalTime,'');
assert.equal(first.status,'BOOKED');
// AWB 06511493775: only SAL RCS/BOOKED, despite passenger flight SV760
// landing at 17:16 on 24 Oct. It did not prove 24 Oct cargo ARR.
const stale={mawb:'065-11493775',destination:'DEL',status:'BOOKED',
  sourceStatus:'RCS',flightNo:'SV760',flightDate:'2026-10-24',
  flightDestination:'DEL',arrivalDate:'2026-10-24',arrivalTime:'17:16',
  scheduledArrivalDate:'2026-10-24',scheduledArrivalTime:'17:00',
  arrivalTimeSource:'FlightStats actual aircraft arrival',
  arrivalIsActual:false,mailTime:'2026-10-24 11:16'};
const cleared=enforceSaudiaArrivalEvidence(stale);
assert.equal(cleared.saudiaArrivalStage,'PLANNED');
assert.equal(cleared.status,'BOOKED');
assert.equal(cleared.flightNo,'SV760');
assert.equal(cleared.arrivalDate,'');
assert.equal(cleared.arrivalTime,'');
assert.equal(cleared.scheduledArrivalDate,'');
assert.equal(cleared.scheduledArrivalTime,'');
assert.equal(cleared.arrivalVerifiedAbsent,true);
assert.equal(cleared.mailTime,'');
// An FOW may show an estimated arrival; a departure confirms flight movement,
// while neither one is an actual cargo arrival.
const fowStage=enforceSaudiaArrivalEvidence({
  ...stale,sourceStatus:'FOW',arrivalTimeSource:'SAL final flight ETA'});
assert.equal(fowStage.saudiaArrivalStage,'ESTIMATED');
assert.equal(fowStage.arrivalEstimate,true);
assert.equal(fowStage.arrivalIsActual,false);
const departedStage=enforceSaudiaArrivalEvidence({
  ...stale,sourceStatus:'DEP',arrivalTimeSource:'SAL final flight ETA'});
assert.equal(departedStage.saudiaArrivalStage,'CONFIRMED_ETA');
assert.equal(departedStage.arrivalEstimate,true);
assert.equal(departedStage.arrivalIsActual,false);
const trueArrival=enforceSaudiaArrivalEvidence({...stale,
  status:'ARRIVED',sourceStatus:'ARR',airport:'DEL',arrivalIsActual:true});
assert.equal(trueArrival.saudiaArrivalStage,'ACTUAL');
assert.equal(trueArrival.arrivalDate,'2026-10-24');
assert.equal(trueArrival.arrivalTime,'17:16');
const transitNotDelhi=enforceSaudiaArrivalEvidence({...stale,
  status:'ARRIVED',sourceStatus:'ARR',airport:'JED',arrivalIsActual:true,
  flightDestination:'JED'});
assert.equal(transitNotDelhi.arrivalDate,'');
assert.equal(transitNotDelhi.arrivalIsActual,false);
const otherAirline=enforceSaudiaArrivalEvidence({...stale,mawb:'098-11493775'});
assert.equal(otherAirline.arrivalTime,'17:16');

// Dashboard must reject JED hub dates while preserving Delhi-flight estimated time.
const currentDashboard=readFileSync('app/DashboardClient.js','utf8');
assert.ok(currentDashboard.includes("if(part.flightDestination&&String(part.flightDestination).toUpperCase()!==String(master.destination||'').toUpperCase())return null;"));
assert.ok(currentDashboard.includes("if(part.flightDestination&&String(part.flightDestination).toUpperCase()!=='DEL')return'';"));
console.log('Saudia Delhi pre-arrival MAN/FOW/DEP email forecast regression passed');

console.log('Saudia transit-JED vs final-DEL arrival regression passed');
