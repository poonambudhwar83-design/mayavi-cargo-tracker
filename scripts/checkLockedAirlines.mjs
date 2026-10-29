// Air India (098) official Activity View integration locked 2026-10-17.
// Working-carrier freeze requested 2026-10-08.
// Cathay Pacific (160): ZIP baseline retained; on 2026-10-27 the owner requested\n// correction of recurring CX failures. Revised Booking Status/cron sources are re-locked.
// Restore the original ZIP Booking Status/browser fallback and lock its exact source hashes.
// Other airlines' parsers remain editable. No airline parser is modified by this check.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { preserveCathayFlight } from '../lib/cathayPreserve.js';

// Saudia (065) temporary blob-hash protection was removed at the owner's
// request. Preserve the working SAL parsing/arrival-evidence regression checks.
// Other airlines retain their existing locks, unchanged.
const locked = Object.freeze({
  // Air India (098) official Activity View parser, FOW and movement tracking.
  'lib/airIndia.js':'8345dc7ebd4fcf0f178d2214b2e272703340a5bf',
  // Kuwait (229) working live ETA + IST rollover, verified in Mayavi on 2026-10-13.
  // Freeze only its own parser; shared flight-time helpers remain available to other carriers.
  'lib/kuwait.js':'0b8fd5d3290c5b48b5dcc601de6337ea0e7530c0',
  // IndiGo is now working on the live V2 deployment; freeze its official adapter,
  // part-load form extraction, sync API and sync component as of 2026-10-11.
  'lib/indigo.js':'3b56a630f809db8dddf2428739bba25c1c6beffc',
  'lib/indigoBrowser.js':'e6aa5c993e1c7c823adaf1675fd18ff797eddbc4',
  'app/api/indigo-india/route.js':'32c417b51012f84fa3531208373c19f07b3c8615',
  'app/api/indigo-sync/route.js':'4fa1764ffbc77e9f3442750dac3fe7608ca3ca4f',
  'app/IndigoAutoSync.js':'ee7f71f3fc5c99e8623cba734b1c259e4e6c0131',
  'lib/ethiopian.js':'66ab51f6cc04336758be8285a47f24441aa1508d',
  'lib/ethiopianReschedule.js':'2c23d4216256e0b0607105ac3236a4bdc935144c',
  'app/api/cron/ethiopian/route.js':'4fc89f8ea0104ab57669620a9916d3775c31235d',
  'lib/cathay.js':'c7a87ebde14d5c7ca184f5b0e6bfdeb95da63f1b',
  'lib/cathay-browser-fallback.js':'e0245a68079874c523afb37d40515c5d97a5695e',
  'lib/cathayPreserve.js':'2f6aa735d66f437ac55063dac7101e4d8d43f55e',
  // Temporary CX status lock (26 Oct 2026): final destination cannot ARRIVE ahead of IST clock.
  'lib/cathayFinalArrival.js':'dd5df361b50618a6788e0768fffb3dc0b1d19831',
  // Temporary Cathay (160) refresh policy lock, approved by operator on 27 Oct 2026.
  // Do not alter CX retry cadence/decision without an explicit unlock request.
  'lib/cathayRefreshPolicy.js':'0484537d9fcd69d41ec11da8a112b60af7703161',
  // Keep the production 5-minute Cathay-only auto-refresh implementation stable.
  'app/api/cron/cathay/route.js':'2350ade0b4830e8a147d0420672e07826ab223ce',
  // Freeze verified CX 160 flight/ETA retention: partial carrier responses must not blank the dashboard.
  'lib/emirates.js':'f41f225840527faca5adb33745b16d4b280e4abe',
  'lib/emiratesFast.js':'fcc0ac0320c69617d7983ea9e791210bf6b1777a',
});
let changed=false;
for (const [filename,expected] of Object.entries(locked)){
  try{
    const data=readFileSync(filename);
    const head=Buffer.from(`blob ${data.byteLength}\0`);
    const actual=createHash('sha1').update(head).update(data).digest('hex');
    if(actual!==expected){
      console.error(`LOCKED AIRLINE FILE MODIFIED: ${filename}. Explicit unlock approval required.`);
      changed=true;
    }
  }catch(err){console.error(`LOCKED AIRLINE FILE UNREADABLE: ${filename}: ${err.message}`);changed=true;}
}
// Temporary CX lock: preserve protected adapter/cron/policy SHA and the\n// specific CX-only integration gates in the shared multi-airline route.\n// Unlock CX only on explicit instruction from the owner. Other airline\n// changes must remain independently deployable.\n// Cathay relies on a shared track route which also contains other airlines.
 // Avoid freezing the whole shared route; guard only the Cathay integration
 // contract, so KLM/other fixes may still be deployed independently.
const sharedRoute=readFileSync('app/api/track/route.js','utf8');
// Air India 098 is locked independently of other airlines. The dedicated
// parser is SHA-protected above; guard only its shared-route integration here
// so other airline fixes and global refresh cadence remain editable.
const airIndiaRouteContract=[
  ['Air India adapter import',"import { trackAirIndia } from '../../../lib/airIndia.js';"],
  ['Air India dedicated 098 routing',"if(mawb.startsWith('098-')) return trackAirIndia(mawb);"],
  ['Air India official adapter fast path',"const airIndiaFastPath=mawb.startsWith('098-');"],
  ['Air India generic API bypass','skipGenericApi=ethiopianFastPath||klmFastPath||flydubaiFastPath||airArabiaOfficialOnly||airIndiaFastPath'],
  ['Air India Activity View split-load data priority','if(airIndiaFastPath&&direct){']
];
for(const [label,fragment] of airIndiaRouteContract){
  if(!sharedRoute.includes(fragment)){
    console.error('LOCKED AIR INDIA INTEGRATION CHANGED: '+label+'. Explicit unlock approval required.');
    changed=true;
  }
}
// Saudia is a shared /api/track integration, so protect only its 065 wiring.
// Keep other airlines' routing and timings independently editable.
const saudiaRouteContract=[
  ['SAL direct adapter import',"import { trackSaudiaDirect } from '../../../lib/saudiaDirect.js';"],
  ['SAL event guard import',"import { guardSaudiaFromLatestSal, enforceSaudiaArrivalEvidence } from '../../../lib/saudiaTransitGuard.js';"],
  ['SAL 065 fast path',"const saudiaFastPath=mawb.startsWith('065-');"],
  ['Dated Delhi flight schedule',"shipment=await guardSaudiaFromLatestSal(mawb,shipment,{flightSchedule:trackFlightScheduleFast});"],
  ['Cargo arrival evidence stage gate',"shipment=enforceSaudiaArrivalEvidence(shipment);"],
];
for(const [label,fragment] of saudiaRouteContract){
  if(!sharedRoute.includes(fragment)){
    console.error('TEMPORARILY LOCKED SAUDIA TRACKING CHANGED: '+label+'. Explicit user-approved update required.');
    changed=true;
  }
}
const saudiaCron=readFileSync('app/api/cron/refresh/route.js','utf8');
if(!saudiaCron.includes('incoming=enforceSaudiaArrivalEvidence({...existing,...incoming});')){
  console.error('TEMPORARILY LOCKED SAUDIA CRON CHANGED: RCS planned arrival must be cleared.');
  changed=true;
}
const saudiaDashboard=readFileSync('app/DashboardClient.js','utf8');
const saudiaDashboardContract=[
  ['FOW estimated label',"return'ESTIMATED ARRIVAL • FOW';"],
  ['DEP confirmed-flight label',"return'FLIGHT DEPARTED • CONFIRMED ETA';"],
  ['Explicit SAL arrival evidence',"const raw=enforceSaudiaArrivalEvidence({...existing,...incoming});"],
  ['Saved SAL arrival evidence',"enforceSaudiaArrivalEvidence(guardSaudiaConnectingFlightWithoutSal(savedRow))"],
  ['MAN flight date not auto-promoted',"if(!/^(FOW|DEP)$/.test(String(part.sourceStatus||'').toUpperCase()))return null;"],
];
for(const [label,fragment] of saudiaDashboardContract){
  if(!saudiaDashboard.includes(fragment)){
    console.error('TEMPORARILY LOCKED SAUDIA DASHBOARD CHANGED: '+label);
    changed=true;
  }
}

const cathayRouteContract=[
  ["Cathay official adapter import","import { trackCathay } from '../../../lib/cathay.js';"],
  ["Cathay dedicated 160 tracking","if(mawb.startsWith('160-')) return trackCathay(mawb);"],
  ["Cathay prefix fast path","const cathayFastPath=mawb.startsWith('160-');"],
  ["Cathay shared persistence","airIndiaFastPath||qatarFastPath||cathayFastPath||malaysiaFastPath"],
  ["Cathay saved-row eligibility","mawb.startsWith('074-')||mawb.startsWith('160-')||mawb.startsWith('098-')"],
  ["Cathay verified flight/ETA retained before API response","shipment=preserveCathayFlight(previousCx,shipment,mawb);"],
  ["CX current official response must pass final-arrival status guard","shipment=guardCathayFinalArrival(shipment);"],
  ["Cathay verified flight/ETA retained during DB save","tracked=preserveCathayFlight(existingCx?.[0]?.data||{},tracked,mawb);"],
  ["Cathay final-arrival status guarded before DB persistence","tracked=guardCathayFinalArrival(tracked);"],
  ["CX incomplete official-result fallback","if(cathayFastPath&&(!directResult?.ok||cathayIncomplete)){"],
  ["CX empty official shell guard","if(cathayFastPath&&directResult?.ok){"],
  ["CX preserves previous data on temporary upstream blank","cathay_empty_response_rejected"],
  ["CX original confirmed-allotment departure preserved","const preserveCxSchedule=cathayFastPath&&Boolean(direct?.departureTime&&direct?.departureDate)&&dep.departureIsActual!==true;"],
  ["CX HKG departure timezone preserved","if(cathayFastPath&&direct?.departureTimeZone&&"],
  ["CX IST departure timezone restored","shipment.departureTimeZone=direct.departureTimeZone;"],
  ["CX arrival timezone preserved","if(cathayFastPath&&direct?.arrivalTimeZone&&"],
  ["CX IST arrival timezone restored","shipment.arrivalTimeZone=direct.arrivalTimeZone;"],
  ["CX stale error clears after verified tracking","if(mawb.startsWith('160-')&&(key==='trackingError'||key==='manualHint')&&value==='')continue;"]
];
for(const [label,fragment] of cathayRouteContract){
  if(!sharedRoute.includes(fragment)){
    console.error('LOCKED CATHAY INTEGRATION CHANGED: '+label+'. Explicit unlock approval required.');
    changed=true;
  }
}
// The verified Cathay details must survive dashboard/browser saves as well as
// the main /api/track response. These are shared modules, so enforce only the
// CX-specific contracts instead of locking all airline dashboards or endpoints.
const cxShipmentsRoute=readFileSync('app/api/shipments/route.js','utf8');
if(!cxShipmentsRoute.includes("if(incomingAwb.startsWith('160-'))rowForSave=guardCathayFinalArrival(rowForSave);")){
  console.error('TEMPORARILY LOCKED CATHAY STATUS SAVE CHANGED: Future arrival cannot be shown as ARRIVED.');
  changed=true;
}
if(!cxShipmentsRoute.includes("rowForSave=preserveCathayFlight(existingRow?.data||{},rowForSave,incomingAwb);")){
  console.error('LOCKED CATHAY SHARED SAVE CONTRACT CHANGED: CX 160 must retain saved flight and arrival.');
  changed=true;
}
const savedCx={mawb:'160-18873536',flightNo:'CX679',origin:'HKG',
  destination:'DEL',arrivalDate:'2026-10-18',arrivalTime:'23:50',
  arrivalIsActual:false,arrivalEstimate:true,status:'BOOKED'};
const incomplete=preserveCathayFlight(savedCx,{mawb:savedCx.mawb,
  flightNo:'',arrivalDate:'',arrivalTime:'',status:'TRACKING'},savedCx.mawb);
if(incomplete.flightNo!=='CX679'||incomplete.arrivalDate!=='2026-10-18'||
   incomplete.arrivalTime!=='23:50'||incomplete.status!=='BOOKED'){
  console.error('LOCKED CATHAY RETENTION REGRESSION: Partial carrier response erased verified flight or arrival.');
  changed=true;
}
const newerCx=preserveCathayFlight(savedCx,{mawb:savedCx.mawb,flightNo:'CX677',
  arrivalDate:'',arrivalTime:''},savedCx.mawb);
if(newerCx.flightNo!=='CX677'||newerCx.arrivalTime){
  console.error('LOCKED CATHAY NEW-FLIGHT REGRESSION: Stale CX679 ETA was attached to CX677.');
  changed=true;
}
const updatedCx=preserveCathayFlight(savedCx,{mawb:savedCx.mawb,flightNo:'CX679',
  arrivalDate:'2026-10-19',arrivalTime:'01:15'},savedCx.mawb);
if(updatedCx.arrivalDate!=='2026-10-19'||updatedCx.arrivalTime!=='01:15'){
  console.error('LOCKED CATHAY NEW-ARRIVAL REGRESSION: New verified ETA did not replace old ETA.');
  changed=true;
}
const qatarSame=preserveCathayFlight(savedCx,{mawb:'157-53523153',
  flightNo:'',arrivalTime:''},'157-53523153');
if(qatarSame.flightNo||qatarSame.arrivalTime){
  console.error('LOCKED CATHAY CROSS-CARRIER REGRESSION: Other airline was modified.');
  changed=true;
}
// Kuwait (229) uses a dedicated official reader with dated arrival fallback.
 // Protect the working shared-route wiring and save-to-existing-row contract
 // without freezing the rest of the shared multi-airline tracking route.
const kuwaitRouteContract=[
  ["Kuwait official adapter import","import { trackKuwait } from '../../../lib/kuwait.js';"],
  ["Kuwait 229 official adapter routing","if(mawb.startsWith('229-')) return trackKuwait(mawb);"],
  ["Kuwait generic browser adapter bypass","if(mawb.startsWith('229-')) return {ok:false,skipped:true,reason:'KUWAIT AIRWAYS USES DEDICATED DETAILS TABLE ADAPTER'};"],
  ["Kuwait 229 fast path","const kuwaitFastPath=mawb.startsWith('229-');"],
  ["Kuwait prefers dedicated tracker over generic API","||thaiFastPath||kuwaitFastPath||malaysiaFastPath"],
  ["Kuwait dedicated adapter source preference","kuwaitFastPath?'KUWAIT AIRWAYS DEDICATED DETAILS TABLE ADAPTER IS PRIMARY'"],
  ["Kuwait bypasses generic OCR","||mawb.startsWith('229-')||"],
  ["Kuwait prefix eligible for DB persistence","||mawb.startsWith('807-')||mawb.startsWith('229-')"],
  ["Kuwait live update persists in existing MAWB row","||kuwaitFastPath||mawb.startsWith('607-')"]
];
for(const [label,fragment] of kuwaitRouteContract){
  if(!sharedRoute.includes(fragment)){
    console.error('LOCKED KUWAIT INTEGRATION CHANGED: '+label+'. Explicit unlock approval required.');
    changed=true;
  }
}
// Keep the existing IndiGo 312 routing and part-load reconciliation wired up.
// Other airline logic in the shared track route is intentionally not locked.
const indigoRouteContract=[
  ['IndiGo official adapter import',"import { trackIndigo } from '../../../lib/indigo.js';"],
  ['IndiGo dedicated 312 tracking',"if(mawb.startsWith('312-')) return trackIndigo(mawb);"],
  ['IndiGo fast path',"const indigoFastPath=mawb.startsWith('312-');"],
  ['IndiGo part-load logic',"if(indigoFastPath&&Array.isArray(shipment.partShipments)&&shipment.partShipments.length){"],
  ['IndiGo master quantity prevents false split','shipment.partLoad=masterPiecesCount>0'],
  ['IndiGo full offload status survives','(lastIdentifiedMovement?.status||refreshedParts[0]?.status||shipment.status);'],
  ['IndiGo persisted tracking',"||indigoFastPath||klmFastPath||ethiopianFastPath"],
  ['IndiGo dedicated browser handling',"if(mawb.startsWith('312-')) return {ok:false,skipped:true,reason:'INDIGO USES DEDICATED SMARTKARGO FORM ADAPTER'};"],
];
for(const [label,fragment] of indigoRouteContract){
  if(!sharedRoute.includes(fragment)){
    console.error('LOCKED INDIGO INTEGRATION CHANGED: '+label+'. Explicit unlock approval required.');
    changed=true;
  }
}
// Ethiopian 071 is locked without freezing the shared multi-airline route.
// These invariants block accidental removal of official tracking, estimated
// final-flight ETA, no-OCR policy and server persistence on later KLM updates.
const ethiopianRouteContract=[
  ["Ethiopian official adapter import","import { trackEthiopian } from '../../../lib/ethiopian.js';"],
  ["Ethiopian dedicated 071 tracking","if(mawb.startsWith('071-')) return trackEthiopian(mawb);"],
  ["Ethiopian fast path","const ethiopianFastPath=mawb.startsWith('071-');"],
  ["Ethiopian official-only source","const skipGenericApi=ethiopianFastPath||klmFastPath||"],
  ["Ethiopian skip OCR","const skipGenericOcr=mawb.startsWith('071-')||mawb.startsWith('074-')"],
  ["Ethiopian AWB live verification","const hasUseful=ethiopianFastPath"],
  ["Ethiopian saved row eligibility","mawb.startsWith('071-')||mawb.startsWith('074-')||"],
  ["Ethiopian persistence","||klmFastPath||ethiopianFastPath||virginFastPath"]
];
for(const [label,fragment] of ethiopianRouteContract){
  if(!sharedRoute.includes(fragment)){
    console.error('LOCKED ETHIOPIAN INTEGRATION CHANGED: '+label+'. Explicit unlock approval required.');
    changed=true;
  }
}
// Protect only Ethiopian's live-data preference on the shared dashboard.
// The rest of the dashboard can evolve, including Remarks column styling.
const dashboard=readFileSync('app/DashboardClient.js','utf8');
// The Active Sheet weight must count all visible physical parts, including
// future manifests, without requiring ARRIVED/Customs Clear status.
// Otherwise pending SV manifests silently disappear from the total.
for(const [label,fragment] of [
  ['all physical parts counted',"if(row._partKey)return partKg(row.weight)||0;"],
  ['single partial rows counted',"return fractional?(partKg(row.weight)||0):weightForTotal(row);"],
  ['one master or sum of physical parts',"if(parts.length)total+=parts.reduce((sum,p)=>sum+summaryRowWeight(p,activeTab),0);"],
  ['no virtual DIS balance double count',"if(row._saudiaPendingVirtual===true)return 0;"]
]){
  if(!dashboard.includes(fragment)){
    console.error('LOCKED ACTIVE WEIGHT REGRESSION: '+label);
    changed=true;
  }
}

// Backend scheduled tracking continues when no employee/admin has Mayavi open.
const saudiaCronConfig=JSON.parse(readFileSync('vercel.json','utf8'));
if(!Array.isArray(saudiaCronConfig.crons)||!saudiaCronConfig.crons.some(c=>c.path==='/api/cron/refresh'&&c.schedule==='0 */2 * * *')){
  console.error('LOCKED MAYAVI AIR CARGO 2-HOUR SERVER REFRESH CHANGED.');
  changed=true;
}
const ethiopianDashboardContract=[
  ['Ethiopian database priority at startup',"const serverAuthoritative=key.startsWith('071')||"],
  ['Ethiopian database priority while polling',"out.push(key.startsWith('071')||"]
];
for(const [label,fragment] of ethiopianDashboardContract){
  if(!dashboard.includes(fragment)){
    console.error('LOCKED ETHIOPIAN DASHBOARD FLOW CHANGED: '+label+'. Explicit unlock approval required.');
    changed=true;
  }
}
// Cathay 160: shared Neon data is authoritative, not a newer stale local
// browser row which can be blank after a partially hydrated CX refresh.
const cathayDashboardContract=[
  ['CX startup DB hydration',"const serverAuthoritative=key.startsWith('071')||key.startsWith('098')||key.startsWith('160')"],
  ['CX final destination status protection',"Object.assign(merged,guardCathayFinalArrival(merged));"],
  ['CX one-minute server sync',"out.push(key.startsWith('071')||key.startsWith('098')||key.startsWith('160')"]
];
for(const [label,fragment] of cathayDashboardContract){
  if(!dashboard.includes(fragment)){
    console.error('LOCKED CATHAY DISPLAY CONTRACT CHANGED: '+label+'. Explicit unlock approval required.');
    changed=true;
  }
}
// Cathay 160 automatic refresh remains every five minutes, even with the app closed.
const cathayCronConfig=JSON.parse(readFileSync('vercel.json','utf8'));
if(!Array.isArray(cathayCronConfig.crons)||!cathayCronConfig.crons.some(item=>
  item.path==='/api/cron/cathay'&&item.schedule==='*/5 * * * *')){
  console.error('TEMPORARILY LOCKED CATHAY 5-MINUTE BACKGROUND REFRESH CHANGED.');
  changed=true;
}
// The live ET cron must continue independently of other airlines; only the
// ET-specific cadence is guarded (other schedules may be changed normally).
const config=JSON.parse(readFileSync('vercel.json','utf8'));
if(!Array.isArray(config.crons)||!config.crons.some(item=>
  item.path==='/api/cron/ethiopian'&&item.schedule==='*/30 * * * *')){
  console.error('LOCKED ETHIOPIAN AUTO REFRESH CHANGED: Explicit unlock approval required.');
  changed=true;
}
if(changed)process.exit(1);
console.log('Airline lock check passed: Air India (098), IndiGo (312), Ethiopian (071), Cathay (160, including booking reader, refresh policy, IST handling, final-arrival guard and 5-min cron), Emirates (176), and Kuwait (229) are LOCKED; Saudia (065) remains regression-guarded.');
