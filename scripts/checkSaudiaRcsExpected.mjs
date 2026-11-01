import assert from 'node:assert/strict';
import { enforceSaudiaArrivalEvidence } from '../lib/saudiaTransitGuard.js';
import { normalizeSalFlightDate } from '../lib/saudiaFlightDate.js';
import { trackSaudiaDirect } from '../lib/saudiaDirect.js';
import { trackSaudiaViaSal } from '../lib/saudiaSalPublic.js';

const isoAfterDays=days=>new Date(Date.now()+330*60000+days*86400000).toISOString().slice(0,10);
const future=isoAfterDays(1);
const base={mawb:'065-18432864',origin:'JED',destination:'DEL',
  sourceStatus:'RCS',flightNo:'SV756',flightDate:future,flightDestination:'DEL',
  totalPieces:39,totalWeight:830,status:'BOOKED',
  arrivalDate:'',arrivalTime:'',arrivalIsActual:false};
const [year,month,day]=future.split('-');
const salRaw=Number(month)+'/'+Number(day)+'/'+year+' 12:00:00 AM';
assert.equal(normalizeSalFlightDate(salRaw),future);
assert.equal(normalizeSalFlightDate('02NOV26'),'2026-11-02');
assert.equal(normalizeSalFlightDate('2026-11-02'),'2026-11-02');
assert.equal(normalizeSalFlightDate('02/30/2026 12:00:00 AM'),'');
const salEvent={Status:'RCS',Airport:'JED',Flight_Dest:'DEL',Flight_Number:'756',
  Flight_Date:salRaw,DateTime_LT:'11/1/2026 4:46:00 PM',Pieces:39,Weight:830};
const originalFetch=globalThis.fetch;
try{
  globalThis.fetch=async url=>{
    if(String(url).startsWith('https://sal.sa/TrackShipment/TrackingApi'))
      return new Response(JSON.stringify({success:true,message:JSON.stringify({
        Awb:base.mawb,Origin:'JED',Destination:'DEL',TotalPieces:39,TotalWeight:830,
        Parts:[{Events:[salEvent]}]})}),{status:200});
    if(String(url).startsWith('https://www.flightstats.com/v2/flight-tracker/SV/756'))
      return new Response('DEL flight arrival times Scheduled 09:45 IST',{status:200});
    return new Response('unavailable',{status:404});
  };
  const publicLive=await trackSaudiaViaSal(base.mawb);
  console.log('RCS schedule source diagnostic',JSON.stringify({publicOk:publicLive.ok,flightNo:publicLive.shipment?.flightNo,flightDate:publicLive.shipment?.flightDate,arrivalTime:publicLive.shipment?.arrivalTime,source:publicLive.shipment?.arrivalTimeSource,reason:publicLive.reason}));
  const live=await trackSaudiaDirect(base.mawb);
  console.log('RCS direct schedule diagnostic',JSON.stringify({flightDate:live.shipment?.flightDate,scheduled:live.shipment?.saudiaRcsScheduledTime,planned:live.shipment?.plannedFlightDate}));
  assert.equal(live.ok,true);
  assert.equal(live.shipment.flightNo,'SV756');
  assert.equal(live.shipment.flightDate,future,'SAL full chronology must normalize Flight_Date');
  assert.equal(live.shipment.saudiaRcsScheduledTime,'09:45','Published dated flight schedule retained separately');
  assert.equal(live.shipment.saudiaRcsScheduledDate,future);
  const projected=enforceSaudiaArrivalEvidence(live.shipment);
  assert.equal(projected.arrivalDate,future,'SAL raw Flight_Date must appear as expected');
  assert.equal(projected.arrivalTime,'');
  assert.equal(projected.saudiaRcsScheduledTime,'09:45');
  assert.equal(projected.mailTime,'');
  assert.equal(projected.arrivalIsActual,false);
  assert.equal(projected.status,'EXPECTED');
}finally{globalThis.fetch=originalFetch;}
const rcs=enforceSaudiaArrivalEvidence({...base,flightDate:salRaw});
assert.equal(rcs.status,'EXPECTED');
assert.equal(rcs.arrivalDate,future);
assert.equal(rcs.flightDate,future);
assert.equal(rcs.scheduledArrivalDate,future);
assert.equal(rcs.arrivalTime,'');
assert.equal(rcs.arrivalEstimate,true);
assert.equal(rcs.arrivalIsActual,false);
assert.equal(rcs.saudiaArrivalStage,'PLANNED');
assert.equal(rcs.finalArrivalPending,true);
assert.equal(rcs.mailTime,'');
assert.equal(enforceSaudiaArrivalEvidence({...base,flightDate:isoAfterDays(-2)}).arrivalDate,'');
assert.equal(enforceSaudiaArrivalEvidence({...base,flightNo:''}).arrivalDate,'');
assert.equal(enforceSaudiaArrivalEvidence({...base,flightDestination:'RUH'}).arrivalDate,'');
assert.equal(enforceSaudiaArrivalEvidence({...base,disAfterFow:true}).arrivalDate,'');
assert.equal(enforceSaudiaArrivalEvidence({...base,
  saudiaRcsScheduledTime:'09:45',saudiaRcsScheduledDate:isoAfterDays(-2)}).saudiaRcsScheduledTime,'');
assert.equal(enforceSaudiaArrivalEvidence({...base,sourceStatus:'DEP',
  saudiaRcsScheduledTime:'09:45',saudiaRcsScheduledDate:future}).saudiaRcsScheduledTime,'');
const moving=enforceSaudiaArrivalEvidence({...base,sourceStatus:'FOW',status:'IN TRANSIT',
  arrivalDate:future,arrivalTime:'15:30'});
assert.equal(moving.status,'IN TRANSIT');
assert.equal(moving.arrivalTime,'15:30');
assert.equal(moving.saudiaArrivalStage,'ESTIMATED');
const arrived=enforceSaudiaArrivalEvidence({...base,sourceStatus:'ARR',
  airport:'DEL',status:'ARRIVED',arrivalDate:future,arrivalTime:'16:00',
  arrivalIsActual:true});
assert.equal(arrived.arrivalIsActual,true);
assert.equal(arrived.status,'ARRIVED');
console.log('Saudia RCS assigned future flight date shown EXPECTED without cargo ARR or fake ETA');
