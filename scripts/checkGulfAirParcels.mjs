import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseGulfAirParcelsApi,parseGulfAirParcelsPage,submitGulfAirParcelsForm,collectGulfAirParcelsHistory,parcelsTrackingDigits} from '../lib/gulfAirParcels.js';
// Regardless of how Mayavi stores/formats a master, ParcelsApp always gets
// the complete eleven digit tracking number without spaces or a hyphen.
assert.equal(parcelsTrackingDigits('072-95019411'),'07295019411');
assert.equal(parcelsTrackingDigits('07295019411'),'07295019411');
assert.equal(parcelsTrackingDigits('065-11493904'),'');
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
  async $$(selector){if(selector==='button[data-tracking-submit="true"]')return [trackButton];return [];}, 
  keyboard:{
    async press(keys){flow.push('KEYS:'+keys);},
    async type(value){inputEl.value=value;flow.push('TYPE:'+value);}
  },
  async evaluate(fn,element){flow.push('READ_DOM');return fn(element);}
};
const submission=await submitGulfAirParcelsForm(browserMock,awb);
assert.equal(submission.ok,true);
assert.equal(submission.method,'PHYSICAL_INPUT_AND_BUTTON_CLICK');
assert.equal(submission.awbEntered,'07295056684');
assert.equal(inputEl.value,'07295056684');
assert.deepEqual(flow,['FOCUS_AWB_INPUT','KEYS:Backspace','TYPE:07295056684','READ_DOM','READ_DOM','READ_DOM','READ_DOM','PHYSICAL_TRACK_CLICK']);


// Regression from the actual ParcelsApp Gulf Air UI: two booked legs,
// repeated KK/BKD events, but no physical departure or arrival yet.
const awbDubai='072-95056371';
const dubaiRows=[
  '03 Nov 2026 15:11 Booked on Flight (BKD). Flight GF500 to Dubai Intl (DXB), Dubai, United Arab Emirates, pieces: 50, weight: 1400.0 Bahrain Intl (BAH), Bahrain, Bahrain',
  '03 Nov 2026 15:11 Booked (KK). Flight GF500 to Dubai Intl (DXB), Dubai, United Arab Emirates, pieces: 50, weight: 1400.0 Bahrain Intl (BAH), Bahrain, Bahrain',
  '03 Nov 2026 13:07 Booked on Flight (BKD). Flight GF131 to Bahrain Intl (BAH), Bahrain, pieces: 50, weight: 1400.0 Indira Gandhi Intl (DEL), Delhi, India',
  '03 Nov 2026 13:07 Booked on Flight (BKD). Flight GF500 to Dubai Intl (DXB), Dubai, United Arab Emirates, pieces: 50, weight: 1400.0 Bahrain Intl (BAH), Bahrain, Bahrain',
  '03 Nov 2026 13:07 Booked (KK). Flight GF131 to Bahrain Intl (BAH), Bahrain, pieces: 50, weight: 1400.0 Indira Gandhi Intl (DEL), Delhi, India'
];
const dubaiResult=parseGulfAirParcelsPage({
  rightText:'Tracking number\n07295056371\nFrom\nIndira Gandhi Intl (DEL), Delhi\nTo\nDubai Intl (DXB), Dubai\nOrigin\nIndia\nDestination\nUnited Arab Emirates\nWeight\n1400.0\nPieces\n50',
  leftText:'AWB 07295056371\n'+dubaiRows.join('\n'),
  timelineRows:dubaiRows
},awbDubai);
assert.equal(dubaiResult.ok,true,dubaiResult.reason);
assert.equal(dubaiResult.shipment.origin,'DEL');
assert.equal(dubaiResult.shipment.destination,'DXB');
assert.equal(dubaiResult.shipment.via,'BAH');
assert.equal(dubaiResult.shipment.pieces,'50');
assert.equal(dubaiResult.shipment.weight,'1400.0');
assert.equal(dubaiResult.shipment.status,'BOOKED');
assert.equal(dubaiResult.shipment.arrivalDate,'');
assert.equal(dubaiResult.shipment.departureDate,'');
assert.deepEqual(dubaiResult.shipment.bookedFlights,['GF131','GF500']);
assert.equal(dubaiResult.shipment.flightLegs.length,2);
assert.equal(dubaiResult.shipment.flightNo,'GF500');


// 7 Nov user screenshot: 072-95019411 contains two physical loads:
// 24/55 pieces (550/1260 kg) on GF130 departed from BAH, and
// 31/55 pieces (710/1260 kg) on GF134 only booked. Repeated DEP,
// PRE, MAN, BKD for GF130 are the same bags, not 4 physical loads.
const splitAwb='072-95019411';
const splitRows=[
  '05 Nov 2026 22:46 Departed (DEP). Flight GF130 to Indira Gandhi Intl (DEL), Delhi, India, pieces: 24, weight: 550.0 Bahrain Intl (BAH), Bahrain',
  '05 Nov 2026 22:30 Departed on Flight (DEP). Flight GF130 to Indira Gandhi Intl (DEL), Delhi, India, pieces: 24, weight: 550.0 Bahrain Intl (BAH), Bahrain',
  '05 Nov 2026 18:10 Pre-Manifested on Flight (PRE). Flight GF130 to Indira Gandhi Intl (DEL), Delhi, India, pieces: 24, weight: 550.0 Bahrain Intl (BAH), Bahrain',
  '05 Nov 2026 18:10 Manifested on Flight (MAN). Flight GF130 to Indira Gandhi Intl (DEL), Delhi, India, pieces: 24, weight: 550.0 Bahrain Intl (BAH), Bahrain',
  '05 Nov 2026 17:07 Booked on Flight (BKD). Flight GF134 to Indira Gandhi Intl (DEL), Delhi, India, pieces: 31, weight: 710.0 Bahrain Intl (BAH), Bahrain',
  '05 Nov 2026 17:07 Booked on Flight (BKD). Flight GF130 to Indira Gandhi Intl (DEL), Delhi, India, pieces: 24, weight: 550.0 Bahrain Intl (BAH), Bahrain'
];
const split=parseGulfAirParcelsPage({
  resultText:'Tracking number\n07295019411',
  rightText:'Tracking number\n07295019411\nFrom\nBahrain Intl (BAH), Bahrain\nTo\nIndira Gandhi Intl (DEL), Delhi\nWeight\n1260.0 kg\nPieces\n55',
  leftText:'AWB 07295019411\n'+splitRows.join('\n'),
  timelineRows:splitRows
},splitAwb);
assert.equal(split.ok,true,split.reason);
assert.equal(split.shipment.isPartLoad,true);
assert.equal(split.shipment.partShipments.length,2);
assert.equal(split.shipment.totalPieces,55);
assert.equal(split.shipment.totalWeight,1260);
assert.equal(split.shipment.partShipments.reduce((n,p)=>n+p.pieces,0),55);
assert.equal(split.shipment.partShipments.reduce((n,p)=>n+p.weight,0),1260);
const gf130=split.shipment.partShipments.find(p=>p.flightNo==='GF130');
const gf134=split.shipment.partShipments.find(p=>p.flightNo==='GF134');
assert.equal(gf130.pieces,24);assert.equal(gf130.weight,550);
assert.equal(gf130.status,'DEPARTED');assert.equal(gf130.departureIsActual,true);
assert.equal(gf130.departureTimeZone,'IST');
assert.equal(gf130.departureDate,'2026-11-06');assert.equal(gf130.departureTime,'01:16');
assert.equal(gf134.pieces,31);assert.equal(gf134.weight,710);
assert.equal(gf134.status,'BOOKED');assert.equal(gf134.departureIsActual,false);
assert.equal(gf130.arrivalIsActual,false);assert.equal(gf134.arrivalIsActual,false);
assert.equal(split.shipment.arrivalDate,'');
assert.equal(split.shipment.arrivedPieces,0);
assert.equal(split.shipment.pendingPieces,55);

// A departure card found only after scrolling all the way down must upgrade
// GF134 from BOOKED to DEPARTED, without inventing a DEL cargo arrival.
const departedBelowFold=parseGulfAirParcelsPage({
  resultText:'Tracking number\n07295019411',
  rightText:'Tracking number\n07295019411\nFrom\nBahrain Intl (BAH), Bahrain\nTo\nIndira Gandhi Intl (DEL), Delhi\nWeight\n1260.0 kg\nPieces\n55',
  leftText:'AWB 07295019411\n'+splitRows.join('\n'),
  timelineRows:[...splitRows,
    '06 Nov 2026 09:10 Departed on Flight (DEP). Flight GF134 to Indira Gandhi Intl (DEL), Delhi, India, pieces: 31, weight: 710.0 Bahrain Intl (BAH), Bahrain']
},splitAwb);
assert.equal(departedBelowFold.ok,true,departedBelowFold.reason);
assert.equal(departedBelowFold.shipment.partShipments.length,2);
assert.equal(departedBelowFold.shipment.partShipments.find(p=>p.flightNo==='GF134')?.status,'DEPARTED');
assert.equal(departedBelowFold.shipment.partShipments.find(p=>p.flightNo==='GF134')?.departureIsActual,true);
assert.equal(departedBelowFold.shipment.arrivalDate,'');
assert.equal(departedBelowFold.shipment.partShipments.reduce((n,p)=>n+p.pieces,0),55);
assert.equal(departedBelowFold.shipment.partShipments.reduce((n,p)=>n+p.weight,0),1260);


// 05 Nov 2026 actual screenshots: BOTH physical loads departed from BAH.
// A later KK booking text must not override the 16:43 explicit GF134 DEP.
const screenshotParsed=parseGulfAirParcelsPage({
  resultText:'Tracking number 07295019411',
  rightText:'Tracking number\n07295019411\nFrom\nBahrain Intl (BAH), Bahrain\nTo\nIndira Gandhi Intl (DEL), Delhi\nWeight\n1260.0 kg\nPieces\n55',
  leftText:'AWB 07295019411',
  timelineRows:[...splitRows,
    '05 Nov 2026 14:25 Departed on Flight (DEP). Flight GF134 to Indira Gandhi Intl (DEL), Delhi, India, pieces: 31, weight: 710.0 Bahrain Intl (BAH), Bahrain',
    '05 Nov 2026 16:43 Departed (DEP). Flight GF134 to Indira Gandhi Intl (DEL), Delhi, India, pieces: 31, weight: 710.0 Bahrain Intl (BAH), Bahrain',
    '05 Nov 2026 17:07 Departed on flight (KK). Flight GF134 to Indira Gandhi Intl (DEL), Delhi, India, pieces: 31, weight: 710.0 Bahrain Intl (BAH), Bahrain'
  ]
},splitAwb);
assert.equal(screenshotParsed.ok,true,screenshotParsed.reason);
assert.equal(screenshotParsed.shipment.status,'IN TRANSIT');
assert.equal(screenshotParsed.shipment.partShipments.length,2);
assert.equal(screenshotParsed.shipment.totalPieces,55);
assert.equal(screenshotParsed.shipment.totalWeight,1260);
assert.equal(screenshotParsed.shipment.partShipments.find(p=>p.flightNo==='GF130').status,'DEPARTED');
assert.equal(screenshotParsed.shipment.partShipments.find(p=>p.flightNo==='GF130').partKey,'GF|24|550.000');
const screenshotGF134=screenshotParsed.shipment.partShipments.find(p=>p.flightNo==='GF134');
assert.equal(screenshotGF134.status,'DEPARTED');
assert.equal(screenshotGF134.partKey,'GF|31|710.000');
assert.equal(screenshotGF134.departureDate,'2026-11-05');
assert.equal(screenshotGF134.departureTime,'19:13');
assert.equal(screenshotParsed.shipment.arrivalDate,'');
assert.equal(screenshotParsed.shipment.arrivedPieces,0);
// AWB matching must be exact; never read another 072 cargo record.
assert.equal(parseGulfAirParcelsPage({
  rightText:'Tracking number\n07295019412\nFrom\nBahrain Intl (BAH)\nTo\nIndira Gandhi Intl (DEL)\nWeight\n1260.0\nPieces\n55',
  timelineRows:splitRows
},splitAwb).ok,false);
// Equal sized parts are different when carried by two real flights.
const equalSplit=parseGulfAirParcelsPage({
  resultText:'Tracking number 07295019411',
  rightText:'Tracking number\n07295019411\nFrom\nBahrain Intl (BAH)\nTo\nIndira Gandhi Intl (DEL)\nWeight\n1000.0\nPieces\n40',
  timelineRows:[
    '05 Nov 2026 10:00 Booked (KK). Flight GF130 to Indira Gandhi Intl (DEL), Delhi, India, pieces: 20, weight: 500.0 Bahrain Intl (BAH), Bahrain',
    '05 Nov 2026 12:00 Departed (DEP). Flight GF130 to Indira Gandhi Intl (DEL), Delhi, India, pieces: 20, weight: 500.0 Bahrain Intl (BAH), Bahrain',
    '05 Nov 2026 10:00 Booked (KK). Flight GF134 to Indira Gandhi Intl (DEL), Delhi, India, pieces: 20, weight: 500.0 Bahrain Intl (BAH), Bahrain',
    '05 Nov 2026 16:00 Departed (DEP). Flight GF134 to Indira Gandhi Intl (DEL), Delhi, India, pieces: 20, weight: 500.0 Bahrain Intl (BAH), Bahrain'
  ]
},splitAwb);
assert.equal(equalSplit.ok,true,equalSplit.reason);
assert.equal(equalSplit.shipment.partShipments.length,2);
assert.equal(new Set(equalSplit.shipment.partShipments.map(p=>p.partKey)).size,2);
assert.equal(equalSplit.shipment.partShipments.reduce((n,p)=>n+p.pieces,0),40);
assert.equal(equalSplit.shipment.partShipments.reduce((n,p)=>n+p.weight,0),1000);
assert.equal(equalSplit.shipment.arrivalDate,'');

// Guard the previously broken Gulf per-part PATCH and Docs Received flow.
const gulfShipmentsApi=readFileSync('app/api/shipments/route.js','utf8');
const gulfSharedTrack=readFileSync('app/api/track/route.js','utf8');
const gulfDashboard=readFileSync('app/DashboardClient.js','utf8');
assert.ok(gulfShipmentsApi.includes("['065','072','098','176','312','229']"));
assert.ok(gulfShipmentsApi.includes("body?.operation==='docsReceived'"));
assert.ok(gulfSharedTrack.includes("if(!(mawb.startsWith('072-')||"));
assert.ok(gulfSharedTrack.includes("(mawb.startsWith('072-')||mawb.startsWith('065-')"));
assert.ok(gulfDashboard.includes('<th>Docs Received</th>'));
assert.ok(gulfDashboard.includes("operation:'docsReceived'"));

// Simulate a virtualized tracking history: initial viewport only shows BKD,
// while older/deeper scrolling reveals the GF134 DEP event.
const visited=[];
const historyMock={async evaluate(_function,step){
  visited.push(step);
  if(step===0)return {rows:[splitRows[4]],bottom:false,expanded:0};
  if(step===1)return {rows:['06 Nov 2026 09:10 Departed on Flight (DEP). Flight GF134 to DEL, pieces: 31, weight: 710.0'],
    bottom:true,expanded:0};
  return {rows:[],bottom:true,expanded:0};
}};
const collected=await collectGulfAirParcelsHistory(historyMock);
assert.ok(collected.some(row=>row.includes('GF134')&&row.includes('DEP')));
assert.ok(visited.includes(1),'Gulf reader must scroll beyond the initially visible rows');

// An empty result can echo the AWB input and show dated marketing text.
assert.equal(parseGulfAirParcelsPage({
  resultText:'Tracking number 07295019411\n31 Oct 2026 Read the latest Shipping Report. The parcel was delivered across supported services.',
  leftText:'31 Oct 2026 Read the latest Shipping Report. Delivered packages everywhere.',
  rightText:'Tracking number 07295019411'
},'07295019411').ok,false,'Marketing text must never become a fake DLV cargo event');

// Regression: an actual GF130 arrival must preserve the GF130 departure
// and must not mark all 55 master pieces arrived while GF134 is still booked.
const partialArrival=parseGulfAirParcelsPage({
  resultText:'Tracking number 07295019411',
  rightText:'Tracking number\n07295019411\nFrom\nBahrain Intl (BAH)\nTo\nIndira Gandhi Intl (DEL)\nWeight\n1260.0\nPieces\n55',
  leftText:'AWB 07295019411',
  timelineRows:[...splitRows,
    '06 Nov 2026 13:10 Arrived (ARR). Flight GF130 to Indira Gandhi Intl (DEL), Delhi, India, pieces: 24, weight: 550.0 Bahrain Intl (BAH), Bahrain']
},splitAwb);
assert.equal(partialArrival.ok,true,partialArrival.reason);
const gf130Arrived=partialArrival.shipment.partShipments.find(p=>p.flightNo==='GF130');
assert.equal(gf130Arrived.status,'ARRIVED');
assert.equal(gf130Arrived.departureDate,'2026-11-06');
assert.equal(gf130Arrived.departureTime,'01:16');
assert.equal(gf130Arrived.arrivalDate,'2026-11-06');
assert.equal(gf130Arrived.arrivalTime,'13:10');
assert.equal(partialArrival.shipment.arrivedPieces,24);
assert.equal(partialArrival.shipment.pendingPieces,31);
assert.equal(partialArrival.shipment.status,'PART ARRIVED');
assert.equal(partialArrival.shipment.arrivalIsActual,false);
assert.equal(partialArrival.shipment.arrivalDate,'');
assert.equal(partialArrival.shipment.partShipments.length,2);

const dashboardSource=readFileSync('app/DashboardClient.js','utf8');
assert.ok(dashboardSource.includes("prefix!=='229'&&prefix!=='072')return[row];"),
  'Gulf Air 072 is eligible for independent physical part rows.');

// A 072 row should open the user-verified full-AWB ParcelsApp permalink,
// not a generic landing page that loses the AWB number.
const dashboardDirect=readFileSync('app/DashboardClient.js','utf8');
assert.ok(dashboardDirect.includes("if(n.startsWith('072-'))return `https://parcelsapp.com/en/tracking/${allDigits}`;"));
assert.ok(dashboardDirect.includes("'PARCELS LIVE ↗'"));
const gulfSource=readFileSync('lib/gulfAirParcels.js','utf8');
assert.ok(dashboardDirect.includes("if(digits(r.mawb).startsWith('072'))void refreshByMawb(r.mawb,{silent:true});"),
  'PARCELS LIVE click must also trigger a background Mayavi refresh for this Gulf AWB.');
assert.ok(dashboardDirect.includes("const endpoint=n.startsWith('072-')?'/api/gulf-track':'/api/track'"),
  'Gulf 072 click refresh must run in the dedicated regional backend.');
assert.ok(gulfSource.includes("const directPage=await publicPageLookup(mawb,detailsUrl);"),
  'Read the AWB-specific Parcels result that the Mayavi link opens.');
assert.ok(gulfSource.indexOf('const directPage=await publicPageLookup(mawb,detailsUrl);')<
  gulfSource.indexOf('const packagePage=await publicPageLookup(mawb,PARCELS_TRACK_PACKAGE_URL);'),
  'Mayavi direct result URL must be attempted before Parcels public form fallback.');
assert.ok(gulfSource.includes("const isDirectDetails=startUrl===directDetailsUrl"),
  'Direct Parcels result page must not require the initial Track Package form.');
const gulfCron=readFileSync('app/api/cron/gulf-air/route.js','utf8');
const cronSettings=JSON.parse(readFileSync('vercel.json','utf8'));
assert.ok(gulfSource.includes('collectGulfAirParcelsHistory(resultPage)'),
  'Gulf tracking page must be fully scrolled before classifying part-load status.');
assert.ok(gulfSource.includes('const trackingNumber=mawb;'),
  'Gulf licensed API must use the documented hyphenated 3+8 AWB, unlike the public web form.');
assert.ok(gulfSource.includes("body:JSON.stringify({language:'en',shipments:[{tracking_number:trackingNumber,carrier_hint:'gulf-air-cargo'}]})"),
  'Gulf licensed API request must include a carrier hint.');
assert.ok(gulfSource.includes("const actual=await page.evaluate(el=>String(el.value||''),input)"),
  'Gulf AWB field validation must reject hyphens rather than stripping them.');
assert.ok(gulfSource.includes('submittedTracking:submittedTracking.slice(-3)'),
  'Gulf-only diagnostics should confirm whether ParcelsApp received the full 11 digits.');
assert.ok(gulfSource.includes('const packagePage=await publicPageLookup(mawb,PARCELS_TRACK_PACKAGE_URL);'),
  'Start Gulf Air checks on parcelsapp.com and use the visible Track Package button.');
assert.ok(gulfSource.indexOf('const packagePage=await publicPageLookup(mawb,PARCELS_TRACK_PACKAGE_URL);')<
  gulfSource.indexOf('const carrierPage=await publicPageLookup(mawb,GULF_PARCELS_URL);'),
  'The main ParcelsApp Track Package flow must run before the Gulf carrier fallback.');
assert.ok(gulfSource.includes("PARCELS_TRACK_PACKAGE_URL='https://parcelsapp.com/'"),
  'The owner supplied parcelsapp.com homepage as the entry point.');
assert.ok(gulfSource.includes("reason:'PARCELS PUBLIC TRACKER API RETURNED NO_DATA'"),
  'If ParcelsApp has no current data, report NO_DATA rather than invent a status.');
assert.ok(!gulfSource.includes("keyboard.press('Control+A')"),
  'Legacy browser Control+A error must not recur.');
assert.ok(gulfSource.includes("await button.click({delay:100})"),
  'The real ParcelsApp Track Cargo button must be clicked.');
assert.ok(gulfCron.includes("awb LIKE '072%'"), 'Scheduled checks must include only Gulf Air 072 shipments.');
assert.ok(gulfCron.includes("origin=process.env.VERCEL_ENV==='production'"),
  'Dedicated hourly Gulf Air cron must not call SSO-protected Vercel deployment hostname.');
assert.ok(gulfCron.includes("'https://tracker.mayavicargo.com'"),
  'Production Gulf Air checks must use the public Mayavi tracker URL.');
assert.ok(gulfCron.includes("data=data||"), 'Refreshes must preserve existing shipment metadata and manual fields.');
assert.ok(gulfCron.includes("backendGulfError"), 'Source failure must be saved as technical diagnostic.');
assert.ok(gulfCron.includes("Promise.allSettled"), 'All current 072 AWBs should be checked in parallel.');
assert.ok(gulfCron.includes("x-mayavi-internal-key"), 'Scheduled checks must use internal tracking authentication.');
assert.ok(cronSettings.crons.some(r=>r.path==='/api/cron/gulf-air'&&r.schedule==='15 * * * *'),
  'Run dedicated Gulf Air status checks each hour without changing JEPO refresh.');
assert.ok(cronSettings.crons.some(r=>r.path==='/api/cron/jepo-branches'&&r.schedule==='0 * * * *'),
  'JEPO must run on its user-requested one-hour interval.');

console.log('Gulf Air ParcelsApp checks passed: AWB verification, booked destination, weight, transit vs actual arrival.');
