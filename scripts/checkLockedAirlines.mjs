// Air India (098) official Activity View integration locked 2026-10-17.
// Working-carrier freeze requested 2026-10-08.
// Change these hashes ONLY after the owner explicitly approves unlocking
// Saudia (065), Emirates (176), Cathay Pacific (160), Ethiopian (071), or Kuwait (229).
// Cathay's reusable, AWB-matched dated flight ETA extraction is protected here.
// Other airlines' parsers remain editable. No airline parser is modified by this check.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { preserveCathayFlight } from '../lib/cathayPreserve.js';

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
  'lib/cathay.js':'4d7019c1d75cab806c1adeb0172272f56bdf083c',
  'lib/cathay-browser-fallback.js':'5618757ead95c1be70f34c7b811b5f8bbd3d637b',
  // Freeze verified CX 160 flight/ETA retention: partial carrier responses must not blank the dashboard.
  'lib/cathayPreserve.js':'2f6aa735d66f437ac55063dac7101e4d8d43f55e',
  'lib/emirates.js':'f41f225840527faca5adb33745b16d4b280e4abe',
  'lib/emiratesFast.js':'fcc0ac0320c69617d7983ea9e791210bf6b1777a',
  'lib/saudiaDirect.js':'cf70796f383793531541f72ed48add3e05fbdda4',
  'lib/saudiaStrong.js':'d24fecbc68d30fa76f142db9d13401a6feb86e68',
  'lib/saudiaSalPublic.js':'9c55a2fc495706ab8fc799800a0d29b48a1b316c',
  'lib/saudia.js':'db7739b0860ad49ac762fded8b82654e6c05ff31',
  'lib/saudiaSal.js':'3e6ee3646ae3b67833d3c379af2b85ffab999fda'
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
// Cathay relies on a shared track route which also contains other airlines.
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
const cathayRouteContract=[
  ["Cathay official adapter import","import { trackCathay } from '../../../lib/cathay.js';"],
  ["Cathay dedicated 160 tracking","if(mawb.startsWith('160-')) return trackCathay(mawb);"],
  ["Cathay prefix fast path","const cathayFastPath=mawb.startsWith('160-');"],
  ["Cathay shared persistence","airIndiaFastPath||qatarFastPath||cathayFastPath||malaysiaFastPath"],
  ["Cathay saved-row eligibility","mawb.startsWith('074-')||mawb.startsWith('160-')||mawb.startsWith('098-')"],
  ["Cathay verified flight/ETA retained before API response","shipment=preserveCathayFlight(previousCx,shipment,mawb);"],
  ["Cathay verified flight/ETA retained during DB save","tracked=preserveCathayFlight(existingCx?.[0]?.data||{},tracked,mawb);"]
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
  ['CX one-minute server sync',"out.push(key.startsWith('071')||key.startsWith('098')||key.startsWith('160')"]
];
for(const [label,fragment] of cathayDashboardContract){
  if(!dashboard.includes(fragment)){
    console.error('LOCKED CATHAY DISPLAY CONTRACT CHANGED: '+label+'. Explicit unlock approval required.');
    changed=true;
  }
}
// The live ET cron must continue independently of other airlines; only the
// ET-specific cadence is guarded (other schedules may be changed normally).
const config=JSON.parse(readFileSync('vercel.json','utf8'));
if(!Array.isArray(config.crons)||!config.crons.some(item=>
  item.path==='/api/cron/ethiopian'&&item.schedule==='*/30 * * * *')){
  console.error('LOCKED ETHIOPIAN AUTO REFRESH CHANGED: Explicit unlock approval required.');
  changed=true;
}
// Saudia SV760 working FOW -> DEP pending-part ETA was verified on 2026-10-10.
// Freeze precisely that source block, not the entire shared multi-airline route,
// so maintenance to KLM, Speed Post, or another airline stays independent.
// The Saudia adapter files above were already Git-blob SHA-locked.
const saudiaRouteStart="  // Saudia-only: an FOW-to-DEP transition confirms flight departure, not cargo";
const saudiaRouteEnd="  // A verified Malaysia response";
const saudiaRouteStartAt=sharedRoute.indexOf(saudiaRouteStart);
const saudiaRouteEndAt=sharedRoute.indexOf(saudiaRouteEnd,saudiaRouteStartAt);
const saudiaEtaSha256='5351c72981e3a378ef48028cd938309c8060f722b687a710b31c9716a2866172';
if(saudiaRouteStartAt<0||saudiaRouteEndAt<=saudiaRouteStartAt
  ||sharedRoute.indexOf(saudiaRouteStart,saudiaRouteStartAt+saudiaRouteStart.length)!==-1){
  console.error('LOCKED SAUDIA ETA BLOCK MISSING OR DUPLICATED: Explicit unlock approval required.');
  changed=true;
}else{
  const protectedCode=sharedRoute.slice(saudiaRouteStartAt,saudiaRouteEndAt);
  const actual=createHash('sha256').update(protectedCode,'utf8').digest('hex');
  if(actual!==saudiaEtaSha256){
    console.error('LOCKED SAUDIA FOW/DEP FLIGHT ETA MODIFIED: Explicit unlock approval required.');
    changed=true;
  }
}
const saudiaRouteContract=[
  ['Official Saudia adapter import',"import { trackSaudiaDirect } from '../../../lib/saudiaDirect.js';"],
  ['Saudia official browser routing',"return mawb.startsWith('065-')?trackSaudiaDirect(mawb):trackWithBrowser(mawb);"],
  ['Saudia prefix fast path',"const saudiaFastPath=mawb.startsWith('065-');"],
  ['Saudia official-only API routing', '||cathayFastPath||saudiaFastPath||thaiFastPath||'],
  ['Saudia ETA flight-reader imports', 'trackFlightArrivalEstimate, trackFlightScheduleFast'],
  ['Saudia preferred-arrival placement', 'shipment=applyPreferredArrival(shipment,direct,browser,api,ocr);']
];
for(const [label,fragment] of saudiaRouteContract){
  if(!sharedRoute.includes(fragment)){
    console.error('LOCKED SAUDIA INTEGRATION CHANGED: '+label+'. Explicit unlock approval required.');
    changed=true;
  }
}
if(changed)process.exit(1);
console.log('Airline lock check passed: Air India (098), IndiGo (312), Cathay Pacific (160), Ethiopian (071), Saudia (065), Emirates (176), and Kuwait (229).');
