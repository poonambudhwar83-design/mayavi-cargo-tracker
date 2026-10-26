import assert from 'node:assert/strict';
import { trackSaudiaStrong } from '../lib/saudiaStrong.js';

// SAL TrackingApi contract test. Simulate returned official shipment events,
// no hard-coded alert by MAWB and no airline-independent status guesses.
const originalFetch=globalThis.fetch;
const event=(status,airport,date,pieces=50,weight=1418,flight='SV1125')=>({
  Status:status,Airport:airport,DateTime_LT:date,
  Flight_Number:flight,Flight_Date:'10/25/2026 00:00',
  Flight_Origin:'DMM',Flight_Dest:airport==='DEL'?'DEL':'JED',
  Pieces:pieces,Weight:weight
});
const expected={Awb:'06511493661',Origin:'DMM',Destination:'DEL',
  TotalPieces:99,TotalWeight:2565,
  Parts:[{Events:[
    event('ARR','DEL','10/24/2026 17:16',49,1147,'SV760'),
    event('DEP','DMM','10/25/2026 08:00',50,1418),
    event('RCF','JED','10/25/2026 10:00',50,1418)
  ]}]};
async function check(events){
  globalThis.fetch=async()=>({ok:true,status:200,
    text:async()=>JSON.stringify({message:{...expected,Parts:[{Events:events}]}})});
  const result=await trackSaudiaStrong('065-11493661');
  assert.equal(result.ok,true,result.reason);
  return result.shipment;
}
try{
  const cases=expected.Parts[0].Events;
  const flagged=await check(cases);
  assert.equal(flagged.saudiaRcfFollowUp,true);
  assert.equal(flagged.saudiaRcfStation,'JED');
  assert.equal(flagged.saudiaRcfPieces,50);
  assert.equal(flagged.arrivedPieces,49);
  assert.equal(flagged.pendingPieces,50);
  assert.notEqual(flagged.arrivalIsActual,true);
  // RCS is normal acceptance, not RCF / inspection.
  const rcs=await check([...cases.slice(0,2),event('RCS','DMM','10/25/2026 10:00',50,1418)]);
  assert.equal(rcs.saudiaRcfFollowUp,false);
  // A later verified FOW supersedes the same RCF receipt.
  const nextFlight=await check([...cases,event('FOW','JED','10/25/2026 12:00',50,1418,'SV760')]);
  assert.equal(nextFlight.saudiaRcfFollowUp,false);
  // RCF after final destination arrival must still be a visible follow-up.
  const dest=await check([
    event('ARR','DEL','10/25/2026 13:00',99,2565,'SV760'),
    event('RCF','DEL','10/25/2026 14:00',99,2565,'SV760')
  ]);
  assert.equal(dest.saudiaRcfFollowUp,true);
  assert.equal(dest.saudiaRcfStation,'DEL');
  // Actual customs release/delivery supersedes the RCF alert.
  const closed=await check([
    event('ARR','DEL','10/25/2026 13:00',99,2565,'SV760'),
    event('RCF','DEL','10/25/2026 14:00',99,2565,'SV760'),
    event('DLV','DEL','10/25/2026 15:00',99,2565,'SV760')
  ]);
  assert.equal(closed.saudiaRcfFollowUp,false);
  console.log('Saudia SAL RCF alert regressions passed (RCS normal, RCF flagged, later movement clears).');
}finally{globalThis.fetch=originalFetch;}
