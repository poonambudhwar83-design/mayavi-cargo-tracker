import assert from 'node:assert/strict';
import {parseCathayApprovedBooking,trackCathayApprovedBooking,
  cathayApprovedApiConfigured} from '../lib/cathayBookingApi.js';
import {annotateCathaySources} from '../lib/cathaySourceMap.js';

const mawb='160-18860310';
const record={
  status:'Confirmed',value:'Space Confirm',awbNumber:mawb,
  originAirport:'HKG',destinationAirport:'DEL',
  pieces:3,weight:65,
  routing:[{flightNo:'CX679',origin:'HKG',destination:'DEL',
    scheduledDepartureDateTime:'2026-10-31T20:00:00',
    scheduledArrivalDateTime:'2026-11-01T00:10:00'}]
};
const parsed=parseCathayApprovedBooking(record,mawb);
assert.equal(parsed.ok,true);
assert.equal(parsed.shipment.flightNo,'CX679');
assert.equal(parsed.shipment.arrivalDate,'2026-11-01');
assert.equal(parsed.shipment.arrivalTime,'00:10');
assert.equal(parsed.shipment.arrivalTimeZone,'IST');
assert.equal(parsed.shipment.arrivalIsActual,false);
assert.equal(parsed.shipment.arrivalEstimate,true);
assert.equal(parsed.shipment.weight,'65');
assert.equal(parseCathayApprovedBooking({...record,awbNumber:'160-18860311'},mawb).ok,false);

const twoLeg={...record,routing:[
  {flightNo:'CX800',origin:'HKG',destination:'BKK',
    scheduledDepartureDateTime:'2026-10-31T19:10:00',
    scheduledArrivalDateTime:'2026-10-31T21:00:00'},
  {...record.routing[0],origin:'BKK',flightNo:'CX679'}
]};
assert.equal(parseCathayApprovedBooking(twoLeg,mawb).shipment.flightNo,'CX679');
assert.equal(parseCathayApprovedBooking({
  ...record,routing:twoLeg.routing.slice(0,1)},mawb).ok,false);

// A UTC-marked official API clock must be converted once, to IST.
// A local clock with no offset must *not* be converted again.
const utc=parseCathayApprovedBooking({...record,routing:[{
  ...record.routing[0],
  scheduledArrivalDateTime:'2026-10-31T18:40:00Z'
}]},mawb);
assert.equal(utc.shipment.arrivalDate,'2026-11-01');
assert.equal(utc.shipment.arrivalTime,'00:10');

const approved=annotateCathaySources(parsed.shipment,{mawb,
  terminal:{shipment:{mawb,pieces:'3',bags:'3',weight:'65.0'}},
  approvedBooking:parsed,booking:parsed});
assert.match(approved.flightNoSource,/approved Get Booking Details API/);
assert.match(approved.arrivalDetailsSource,/approved Get Booking Details API/);
assert.equal(approved.cxTrackingSources.approvedApi.status,'AWB_MATCHED');
assert.equal(approved.cxBookingDetailsPending,false);

assert.equal(cathayApprovedApiConfigured({}),false);
let hit=false;
const configured={CATHAY_CARGO_API_BASE_URL:'https://cx-api.example.com/one-record',
  CATHAY_CARGO_IATA_CASS:'12345678901',
  CATHAY_CARGO_API_AUTH_HEADER:'Bearer sample-test-token'};
const result=await trackCathayApprovedBooking(mawb,{env:configured,
  request:async(url,opts)=>{
    hit=true;assert.ok(url.includes('/companies/CX/v2/booking/status/160-18860310/12345678901'));
    assert.equal(opts.headers.authorization,'Bearer sample-test-token');
    return{ok:true,json:async()=>record};
  }});
assert.equal(hit,true);assert.equal(result.ok,true);
const forbidden=await trackCathayApprovedBooking(mawb,{env:configured,
  request:async()=>({ok:false,status:403})});
assert.equal(forbidden.ok,false);
assert.equal(forbidden.reason,'CATHAY_APPROVED_API_CREDENTIALS_REJECTED');
const noConfig=await trackCathayApprovedBooking(mawb,{env:{},
  request:async()=>{throw Error('must not call unauthorized provider')}});
assert.equal(noConfig.reason,'CATHAY_APPROVED_API_NOT_CONFIGURED');
console.log('Cathay approved booking API: AWB, final destination, IST and authorization tests passed.');
