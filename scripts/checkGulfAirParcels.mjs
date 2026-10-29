import assert from 'node:assert/strict';
import {parseGulfAirParcelsApi,parseGulfAirParcelsPage,submitGulfAirParcelsForm} from '../lib/gulfAirParcels.js';
const awb='072-95056684';
const fixture={results:[{tracking_number:awb,shipment:{
  trackingId:awb,fromAirport:'LHR',toAirport:'DEL',pieces:17,weight:442.6,
  flight_legs:[{flight_number:'GF130',destination:'BAH',actual_arrival:'2026-10-27T10:20:00Z'},
    {flight_number:'GF132',destination:'DEL',scheduled_arrival:'2026-10-30T04:20:00Z'}],
  states:[
    {state:'RCS cargo accepted',airport:'LHR',date:'2026-10-26T09:00:00Z'},
    {state:'DEP flight departed GF130',airport:'LHR',date:'2026-10-27T07:45:00Z'},
    {state:'ARR arrived at Bahrain',airport:'BAH',date:'2026-10-27T10:20:00Z'}]
}}]};
const got=parseGulfAirParcelsApi(fixture,awb);
assert.equal(got.ok,true);assert.equal(got.shipment.origin,'LHR');
assert.equal(got.shipment.destination,'DEL');
assert.equal(got.shipment.weight,'442.6');assert.equal(got.shipment.pieces,'17');
assert.equal(got.shipment.status,'IN TRANSIT');
assert.equal(got.shipment.arrivalDate,'');
assert.equal(parseGulfAirParcelsApi(fixture,'072-12345678').ok,false);
const final=structuredClone(fixture);
final.results[0].shipment.states.push({state:'RCF received from flight',airport:'DEL',date:'2026-10-30T05:05:00Z'});
const arrived=parseGulfAirParcelsApi(final,awb);
assert.equal(arrived.shipment.status,'ARRIVED');
assert.equal(arrived.shipment.arrivalDate,'2026-10-30');
assert.equal(arrived.shipment.arrivalTime,'10:35');
const page=parseGulfAirParcelsPage({
  leftText:'AWB 07295056684\nBooking Destination:\nDEL\n27 Oct 2026 Flight departed at LHR GF130',
  rightText:'AWB 07295056684\nOrigin:\nLHR\nPieces:\n17\nWeight:\n442.6 kg',
  timelineRows:[]},awb);
assert.equal(page.ok,true);assert.equal(page.shipment.destination,'DEL');
assert.equal(page.shipment.origin,'LHR');assert.equal(page.shipment.weight,'442.6');
assert.equal(parseGulfAirParcelsPage({resultText:'Enter tracking number 07295056684',timelineRows:[]},awb).ok,false);
// Layout witnessed on ParcelsApp: From/To labels with city names and IATA in parentheses.
// Booking flights are not actual departures or confirmed final arrival.
const actualPage=parseGulfAirParcelsPage({
  resultText:'Tracking number\n07295056684',
  rightText:'Tracking number\n07295056684\nFrom\nIndira Gandhi Intl (DEL), Delhi\nTo\nDubai Intl (DXB), Dubai\nOrigin\nIndia\nDestination\nUnited Arab Emirates\nWeight\n1500.0\nPieces\n50',
  leftText:'Tracking number\n07295056684\n28 Oct 2026 13:01 Booked (KK). Flight GF131 to Bahrain Intl (BAH). Pieces: 50, weight: 1500.0\n28 Oct 2026 13:01 Booked (KK). Flight GF512 to Dubai Intl (DXB). Pieces: 50, weight: 1500.0',
  timelineRows:['28 Oct 2026 13:01 Booked (KK). Flight GF131 to Bahrain Intl (BAH). Pieces: 50, weight: 1500.0','28 Oct 2026 13:01 Booked (KK). Flight GF512 to Dubai Intl (DXB). Pieces: 50, weight: 1500.0']
},awb);
assert.equal(actualPage.ok,true);
assert.equal(actualPage.shipment.origin,'DEL');
assert.equal(actualPage.shipment.destination,'DXB');
assert.equal(actualPage.shipment.pieces,'50');
assert.equal(actualPage.shipment.weight,'1500.0');
assert.equal(actualPage.shipment.status,'BOOKED');
assert.equal(actualPage.shipment.arrivalDate,'');
// Regress the exact requested UI sequence: AWB focus, actual keyboard typing,
// check the field value, then click ParcelsApp's Track button.
const flow=[];
const inputEl={value:'',async click(){flow.push('FOCUS_AWB_INPUT');}};
const trackButton={innerText:'Track package',async click(){flow.push('PHYSICAL_TRACK_CLICK');}};
const browserMock={
  async $(selector){if(selector==='input[name="tracking_id"]')return inputEl;
    if(selector==='button[data-tracking-submit="true"]')return trackButton;return null;},
  keyboard:{
    async press(keys){flow.push('KEYS:'+keys);},
    async type(value){inputEl.value=value;flow.push('TYPE:'+value);}
  },
  async evaluate(fn,element){flow.push('READ_DOM');return fn(element);}
};
const submission=await submitGulfAirParcelsForm(browserMock,awb);
assert.equal(submission.ok,true);
assert.equal(submission.method,'PHYSICAL_INPUT_AND_BUTTON_CLICK');
assert.deepEqual(flow,['FOCUS_AWB_INPUT','KEYS:Control+A','TYPE:07295056684','READ_DOM','READ_DOM','PHYSICAL_TRACK_CLICK']);

console.log('Gulf Air ParcelsApp checks passed: AWB verification, booked destination, weight, transit vs actual arrival.');
