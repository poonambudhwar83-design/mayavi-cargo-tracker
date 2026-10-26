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

  // Each physical SAL part is flagged independently, including an unresolved
  // receipt on an unassigned/virtual pending balance. Other parts stay plain.
  const {matchSaudiaRcfParts}=await import('../lib/saudiaRcfParts.js');
  const splitRows=[
    {partId:'arrived49',pieces:49,weight:1147,arrivalIsActual:true,flightNo:'SV760'},
    {_saudiaPendingVirtual:true,partId:'pending50',pieces:50,weight:1418,arrivalIsActual:false}
  ];
  const matched=matchSaudiaRcfParts(flagged,splitRows);
  assert.equal(matched[0],null);
  assert.equal(matched[1]?.station,'JED');
  assert.equal(matched[1]?.pieces,50);
  // Different simultaneous RCF events on different physical parts both show.
  const both=await check([...cases,event('RCF','DEL','10/25/2026 11:00',49,1147,'SV760')]);
  const splitMatched=matchSaudiaRcfParts(both,splitRows);
  assert.equal(splitMatched[0]?.station,'DEL');
  assert.equal(splitMatched[1]?.station,'JED');
  // RCS never highlights a physical part.
  assert.deepEqual(matchSaudiaRcfParts(rcs,splitRows),[null,null]);
  // A later FOW must clear only its own 50-bag RCF, not an independent 49.
  const later=await check([...cases,event('RCF','DEL','10/25/2026 11:00',49,1147,'SV760'),
    event('FOW','JED','10/25/2026 12:00',50,1418,'SV760')]);
  const laterFlags=matchSaudiaRcfParts(later,splitRows);
  assert.equal(laterFlags[0]?.station,'DEL');
  assert.equal(laterFlags[1],null);
  // Two equal bag-count parts have distinguishable weights, avoid false RCF.
  const sameCountParts=[{pieces:50,weight:900},{pieces:50,weight:1100}];
  const weightSpecific=matchSaudiaRcfParts({mawb:'065-12345678',
    saudiaRcfMilestones:[{pieces:50,weight:1100,station:'JED'}]},sameCountParts);
  assert.equal(weightSpecific[0],null);
  assert.equal(weightSpecific[1]?.station,'JED');
  // Identical bag and weight parts without reliable flight/part identity must
  // not both be falsely highlighted.
  const ambiguous=matchSaudiaRcfParts({mawb:'065-12345678',
    saudiaRcfMilestones:[{pieces:50,weight:1100,station:'JED'}]},
    [{pieces:50,weight:1100},{pieces:50,weight:1100}]);
  assert.deepEqual(ambiguous,[null,null]);
  console.log('Saudia SAL RCF alert regressions passed (RCS normal, RCF flagged, later movement clears).');
}finally{globalThis.fetch=originalFetch;}
