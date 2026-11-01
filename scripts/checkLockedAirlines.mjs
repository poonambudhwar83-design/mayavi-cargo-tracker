// Air India (098) Activity View baseline updated 2026-11-01 for owner-approved flight/date and re-manifest correction; re-locked at new SHA.
// Working-carrier freeze requested 2026-10-08.
// Cathay Pacific (160): ZIP baseline retained; on 2026-10-27 the owner requested\n// correction of recurring CX failures. Revised Booking Status/cron sources are re-locked.
// Restore the original ZIP Booking Status/browser fallback and lock its exact source hashes.
// Other airlines' parsers remain editable. No airline parser is modified by this check.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { preserveCathayFlight } from '../lib/cathayPreserve.js';

// Saudia (065) re-locked 2026-11-01 on the owner's request after the SV756
// dated live flight-source, RCS expected date and provisional Mail -6h fix.
// Freeze carrier-only parsers, physical-part guards and the verified mail logic;
// other airlines' shared route, dashboard and cron files stay editable.
// Future flight updates remain LIVE; this guards only SOURCE CODE changes.
// The user may explicitly request an unlock for future Saudia fixes.
const locked = Object.freeze({
  // Air India (098) official Activity View parser, FOW and movement tracking.
  'lib/airIndia.js':'4227d853694cfc3f615c8d828152decc7c9a9225',
  // Kuwait (229) working live ETA + IST rollover, verified in Mayavi on 2026-10-13.
  // Freeze only its own parser; shared flight-time helpers remain available to other carriers.
  'lib/kuwait.js':'0b8fd5d3290c5b48b5dcc601de6337ea0e7530c0',
  // Kuwait 229 latest official full-cargo DEP, dated ETA and master merge.
  // Physical 55+32 history remains in the DB; the full-departed view is one row.
  'lib/kuwaitPartLoads.js':'5dc0565ad54c37e5050974ce33fec135ce9b0aa9',
  'lib/kuwaitUnifiedView.js':'4f442d8531668e13681a1488189c382977d28f03',
  'lib/kuwaitFlightEta.js':'34c9d11df7055d5c441f7d75f1f0f9488d6d1148',
  'lib/kuwaitMasterEvents.js':'eb66b2fb73f86b0898263cce756c3e5d58a3406f',
  'lib/kuwaitAircraftDeparture.js':'7cc94d007f8ab31cbb0bf4cd42c6b53c65d756c6',
  // Saudia 065: protected working live SAL chronology, part loads, RCS/ETA
  // timing, scheduled fallback and -6h provisional Mail. Explicit unlock required.
  'lib/saudia.js':'db7739b0860ad49ac762fded8b82654e6c05ff31',
  'lib/saudiaStrong.js':'32ba65e2da6f98beb3ab025b215cd12b4fbaa13b',
  'lib/saudiaDirect.js':'4220f15ef4aaf8e346e98dfd82a7eaa97250a39f',
  'lib/saudiaTransitGuard.js':'146c9ebfdd5f3920718a5bde964c0b1c1f46d867',
  'lib/saudiaPhysicalParts.js':'bdd9f796e52b352aeef0ddb662e858c85da0b681',
  'lib/saudiaArrivedMasterFlight.js':'5fd3ac0ebf36d0302a10b2ef68839413ea9cdbf8',
  'lib/saudiaRcfParts.js':'17d5c82b8933676063a0f445d0166cc2707e5d4c',
  'lib/saudiaSalPublic.js':'37413b5d36037483ed963d8599940a4837a97bcc',
  'lib/saudiaFlightDate.js':'5e85ba9841989891dedb1f89125c2739de19dc00',
  'lib/saudiaProvisionalMail.js':'682ca98d12e369604c98dc4eee70530d35789394',
  'lib/saudiaPublishedSchedule.js':'8d735fdb01b288fdaace574da53a4fe85985b72c',
  'lib/saudiaPartEta.js':'fb4b2341cbde569992cdcac392b867ad607ecf80',
  'scripts/checkSaudiaRcsExpected.mjs':'132f2569ceb97c9ba8e4592cc3e9d565d1c05b6a',
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
  'lib/cathay.js':'5dba64edc085c943205fe12613f654c2cc943294',
  'lib/cathay-browser-fallback.js':'0ca1b323ef6ef0c4b55d1c67bbde46f22d9dad6d',
  'lib/cathayPreserve.js':'2f6aa735d66f437ac55063dac7101e4d8d43f55e',
  // Temporary CX status lock (26 Oct 2026): final destination cannot ARRIVE ahead of IST clock.
  'lib/cathayFinalArrival.js':'dd5df361b50618a6788e0768fffb3dc0b1d19831',
  // Temporary Cathay (160) refresh policy lock, approved by operator on 27 Oct 2026.
  // Do not alter CX retry cadence/decision without an explicit unlock request.
  'lib/cathayRefreshPolicy.js':'dbdf39ab54e46ce59e99831a82fa2a50656ec25a',
  // Keep the production 5-minute Cathay-only auto-refresh implementation stable.
  'app/api/cron/cathay/route.js':'b91c6c8d54426af375757991ce96079406036de6',
  // Freeze verified CX 160 flight/ETA retention: partial carrier responses must not blank the dashboard.
  'lib/emirates.js':'f41f225840527faca5adb33745b16d4b280e4abe',
  'lib/emiratesFast.js':'fcc0ac0320c69617d7983ea9e791210bf6b1777a',
  // Thai AirAsia 900 & AirAsia 807 SmartKargo: owner-approved temporary freeze
  // of AWB-specific tracking, DMK connection and verified DEL arrival parser.
  'lib/airAsia.js':'8191d7df6dbb3f71189b1caf311b32ae93d745e8',
  'lib/airAsiaBrowser.js':'aa5639c01c7ccf11d5c25868e19b32c538806ca5',
  'scripts/checkThaiAirAsia900.mjs':'e47c1112054644fa4b7dd379fa6060c22d2c3be0',
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
// Saudia shared multi-airline integrations are protected by narrow functional
// contracts: other carriers and unrelated features may still be edited.
const saudiaRouteLock=[
  ['SAL strong chronology source','trackSaudiaDirect(mawb)'],
  ['Saudia verified final-arrival evidence','shipment=enforceSaudiaArrivalEvidence(shipment);'],
  ['Saudia independent physical part chronology','shipment=resolveSaudiaArrivedMasterFlight(reconcileSaudiaPhysicalParts(shipment));']
];
for(const [label,fragment] of saudiaRouteLock){
  if(!sharedRoute.includes(fragment)){
    console.error('LOCKED SAUDIA TRACKING CONTRACT MODIFIED: '+label+'. Explicit owner-approved unlock required.');
    changed=true;
  }
}
const saudiaDashboardSource=readFileSync('app/DashboardClient.js','utf8');
const saudiaDashboardLock=[
  ['Saudia provisional Mail calculation',"mailTimeFrom(mailArrivalDate,arrivalTime)||saudiaRcsProvisionalMailTime(merged)"],
  ['Saudia RCS live schedule and time display','saudiaRcsScheduledTime(r)'],
  ['Saudia provisional Mail calculation for rows','const saudiaPlanningMail=saudiaRcsProvisionalMailTime(row);'],
  ['Saudia provisional Mail visible label','{saudiaRcsProvisionalMailTime(r)&&'],
  ['Saudia RCS Mail provisional warning','PROVISIONAL •'],
  ['Saudia no false cargo RCS overdue blink',"if(event==='FOW'||!(movement==='DEPARTED'"],
];
for(const [label,fragment] of saudiaDashboardLock){
  if(!saudiaDashboardSource.includes(fragment)){
    console.error('LOCKED SAUDIA DISPLAY/MAIL CONTRACT MODIFIED: '+label+'. Explicit owner-approved unlock required.');
    changed=true;
  }
}
const saudiaCronSource=readFileSync('app/api/cron/refresh/route.js','utf8');
for(const [label,fragment] of [
  ['Saudia provisional Mail helper',"import { saudiaRcsProvisionalMailTime } from '../../../../lib/saudiaProvisionalMail.js';"],
  ['Saudia background provisional Mail',"saudiaRcsProvisionalMailTime({...combined,status})"],
  ['Saudia background cargo-arrival guard','incoming=enforceSaudiaArrivalEvidence({...existing,...incoming});']
]){
  if(!saudiaCronSource.includes(fragment)){
    console.error('LOCKED SAUDIA BACKGROUND REFRESH CONTRACT MODIFIED: '+label+'. Explicit unlock required.');
    changed=true;
  }
}
const saudiaPackage=JSON.parse(readFileSync('package.json','utf8'));
for(const script of ['checkSaudiaRcsExpected.mjs','checkImportArrivalMail.mjs','checkLockedAirlines.mjs']){
  if(!String(saudiaPackage.scripts?.prebuild||'').includes('node scripts/'+script)){
    console.error('LOCKED SAUDIA VERIFICATION DISABLED: '+script+'. Explicit owner-approved unlock required.');
    changed=true;
  }
}
// Kuwait live-lock: preserve its integrations without
// freezing shared files which other airlines legitimately need to edit.
// Every deploy checks these gates AND immutable carrier-specific Git blob SHAs.
const userLockedRoute=[
  ['Kuwait official full-master DEP/RCF parser',
    'Object.assign(direct,reconcileKuwaitMasterEvents(direct,directResult?.debug?.ops||[]));'],
  ['Kuwait same-flight split reconciliation',
    'const split=kuwaitPartLoadFromActivity(directResult?.debug?.ops||[],direct);'],
  ['Kuwait dated flight ETA no cargo DEP+7h',
    'Object.assign(direct,applyKuwaitDatedEta(direct,'],
  ['Kuwait per-flight ETA source',
    'kuwaitDatedArrivalEta(direct,flightEtaSource||{})'],
  ['Kuwait independent full-master part history',
    'shipment.partShipments=direct.partShipments;']
];
for(const [label,fragment] of userLockedRoute){
  if(!sharedRoute.includes(fragment)){
    console.error('LOCKED SAUDIA/KUWAIT LIVE INTEGRATION CHANGED: '+label+'. Explicit user-approved unlock required.');
    changed=true;
  }
}
const kuwaitDashboard=readFileSync('app/DashboardClient.js','utf8');
for(const [label,fragment] of [
  ['Full Kuwait DEP master consolidation','const one=consolidatedKuwaitDeparture(row);'],
  ['Kuwait 229 full-load Mail operation',"operation:unified?'kuwaitMasterMail':undefined"],
  ['Kuwait 229 full-load Customs operation',"operation:'kuwaitMasterCustoms',customsCleared:cleared"]
]){
  if(!kuwaitDashboard.includes(fragment)){
    console.error('LOCKED SAUDIA/KUWAIT LIVE DASHBOARD CHANGED: '+label+'. Explicit user-approved unlock required.');
    changed=true;
  }
}
const kuwaitSaveRoute=readFileSync('app/api/shipments/route.js','utf8');
for(const [label,fragment] of [
  ['Kuwait atomic full-master Mail flag',"const kuwaitBulkMail=body?.operation==='kuwaitMasterMail';"],
  ['Kuwait atomic full-master Customs flag',"const kuwaitBulkCustoms=body?.operation==='kuwaitMasterCustoms';"],
  ['Kuwait full master validated before bulk update','if(!consolidatedKuwaitDeparture(updated)){']
]){
  if(!kuwaitSaveRoute.includes(fragment)){
    console.error('LOCKED KUWAIT SHARED SAVE CHANGED: '+label+'. Explicit user-approved unlock required.');
    changed=true;
  }
}

const cathayRouteContract=[
  ["Cathay official adapter import","import { trackCathay } from '../../../lib/cathay.js';"],
  ["Cathay dedicated 160 tracking","if(mawb.startsWith('160-')) return trackCathay(mawb,{fastTerminal:options?.fastTerminal===true});"],
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
// Under one genuine Saudia split-load MAWB, a manifested first part still
// requires a balance row before any piece has reached the destination.
if(!dashboard.includes('if(masterTotal>0&&parts.length>0&&available>0){')){
  console.error('SAUDIA PENDING BALANCE REGRESSION: 17/67 MAN must show 50/67 pending even before any destination arrival.');
  changed=true;
}
// The Active Sheet weight must count all visible physical parts, including
// future manifests, without requiring ARRIVED/Customs Clear status.
// Otherwise pending SV manifests silently disappear from the total.
for(const [label,fragment] of [
  ['all physical parts counted',"if(row._partKey)return partKg(row.weight)||0;"],
  ['single partial rows counted',"return fractional?(partKg(row.weight)||0):weightForTotal(row);"],
  ['one master or sum of physical parts and its unmanifested Saudia balance',"if(parts.length)total+=group.filter(p=>p._partKey||p._saudiaPendingVirtual===true).reduce((sum,p)=>sum+summaryRowWeight(p,activeTab),0);"],
  ['Saudia outstanding physical kg included once',"if(row._saudiaPendingVirtual===true)return partKg(row.weight)||0;"]
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
// Thai AirAsia 900 temporary lock: shareable multi-airline API and dashboard
// remain editable for other carriers, but the final-station arrival rules,
// scheduled flight label and 807/900 regression checks must remain in place.
// Only the owner may explicitly unlock the 900 checks for future amendments.
const airAsiaTrackSource=readFileSync('app/api/track/route.js','utf8');
const airAsiaDisplaySource=readFileSync('app/DashboardClient.js','utf8');
const airAsiaPkg=JSON.parse(readFileSync('package.json','utf8'));
for(const [name,source,expected] of [
  ['SmartKargo official 900/807 reader',airAsiaTrackSource,"const official=await trackAirAsia(mawb);"],
  ['Thai AirAsia final-delhi actual guard',airAsiaTrackSource,"if(mawb.startsWith('900-')&&shipment.arrivalIsActual!==true)"],
  ['Thai AirAsia stale arrival clears',airAsiaTrackSource,"shipment.arrivalVerifiedAbsent=true;"],
  ['Thai AirAsia scheduled arrival retained separately',airAsiaTrackSource,"shipment.scheduledArrivalDate=converted.arrivalDate;"],
  ['900 final-flight scheduled UI helper',airAsiaDisplaySource,'function airAsiaScheduledFinalArrival(row={})'],
  ['900 no false final arrival',airAsiaDisplaySource,'row.arrivalIsActual===true||row.arrivalVerifiedAbsent!==true'],
  ['900 must require DEL destination',airAsiaDisplaySource,"destination!=='DEL'"],
  ['900 UI shows scheduled date',airAsiaDisplaySource,'r.arrivalDate||airAsiaScheduledFinalArrival(r)?.date'],
  ['900 UI labels destination pending',airAsiaDisplaySource,'SCHEDULED ONLY • DEL NOT ARRIVED'],
  ['900 UI shows IST expected time',airAsiaDisplaySource,'IST • EXPECTED ONLY'],
  ['900 script executes on every build',String(airAsiaPkg.scripts?.prebuild||''),'node scripts/checkThaiAirAsia900.mjs']
]){
  if(!source.includes(expected)){
    console.error('LOCKED THAI AIRASIA 900 REGRESSION: '+name+'. Owner approval required to unlock.');
    changed=true;
  }
}
if(changed)process.exit(1);
console.log('Airline lock check passed: Saudia (065) live SAL, dated SV flight schedule, RCS planned arrival, -6h provisional Mail and physical parts are SOURCE-CODE SHA-LOCKED; shared Saudia dashboard, route and cron contracts protected. Kuwait (229), Air India (098), Cathay (160), Emirates (176), IndiGo (312), Ethiopian (071), and Thai AirAsia (900) locks remain active. Live tracking and refresh remain enabled.');
