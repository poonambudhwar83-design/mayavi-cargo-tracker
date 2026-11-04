import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {cleanJepoTrackingNo,sourceStatusToBranch,validateJepoLiveResult} from '../lib/jepoBranchTracking.js';
import {isJindJepoTimeout} from '../lib/jepoTimeoutHighlights.js';
import {parseJepoDeliveryDate} from '../lib/jepoDeliveryDate.js';
assert.equal(cleanJepoTrackingNo(' 1z12b6f40334321920 '),'1Z12B6F40334321920');
assert.equal(cleanJepoTrackingNo('wrong/awb'),'');
assert.equal(cleanJepoTrackingNo('618'),'618','Legacy short JEPO numbers must be attempted, not silently skipped.');
assert.equal(sourceStatusToBranch('Pre Transit'),'PRE_TRANSIT');
assert.equal(sourceStatusToBranch('In Transit'),'IN_TRANSIT');
assert.equal(sourceStatusToBranch('Out For Delivery'),'OUT_FOR_DELIVERY');
assert.equal(sourceStatusToBranch('Delivered'),'DELIVERED');
assert.equal(sourceStatusToBranch('Not Delivered'),null);
assert.equal(parseJepoDeliveryDate('Fri, 30 Oct 2026 10:54 AM'),'2026-10-30');
assert.equal(parseJepoDeliveryDate('4 Nov 2026 12:45 PM'),'2026-11-04');
assert.equal(parseJepoDeliveryDate('2026-11-04'),'2026-11-04');
assert.equal(parseJepoDeliveryDate('04/11/2026'),'2026-11-04');
assert.equal(parseJepoDeliveryDate('31/02/2026'),null);
assert.equal(parseJepoDeliveryDate(''),null);

const internalReference='547123';
const forwardedReference='1Z9999999999999999';
const liveSnapshot={
 bodyText:'Fwd No : '+forwardedReference+'\nStatus :\nPre Transit\nDate Time Location Progress\nFri, 30 Oct 2026 10:54 AM Departed from Facility',
 submittedAwb:internalReference,freshResult:true,status:'Pre Transit',latestProgress:'Departed from Facility'
};
const sample=validateJepoLiveResult(liveSnapshot,internalReference);
assert.equal(sample.awb,internalReference);
assert.equal(sample.carrierAwb,forwardedReference,'Carrier AWB differs from the internal JEPO reference.');
assert.equal(sample.liveStatus,'Pre Transit');
assert.equal(sample.liveRemarks,'Departed from Facility');
assert.equal(sample.mappedStatus,'PRE_TRANSIT');
assert.throws(()=>validateJepoLiveResult({...liveSnapshot,submittedAwb:'547999'},internalReference),/fresh result/i);
assert.throws(()=>validateJepoLiveResult({...liveSnapshot,freshResult:false},internalReference),/fresh result/i);
assert.throws(()=>validateJepoLiveResult({...liveSnapshot,latestProgress:''},internalReference),/Progress/i);
assert.throws(()=>validateJepoLiveResult({...liveSnapshot,bodyText:'No shipment details'},internalReference),/forwarded/i);
const confirmedDelivery=validateJepoLiveResult({
 bodyText:'Fwd No : 1Z123456789\nStatus: Delivered\nDate Time Location Progress',
 status:'Delivered',latestProgress:'Your parcel has been delivered',
 deliveredScanDate:'Fri, 30 Oct 2026 10:54 AM',submittedAwb:internalReference,freshResult:true
},internalReference);
assert.equal(confirmedDelivery.deliveredDate,'2026-10-30');
assert.equal(validateJepoLiveResult({
 bodyText:'Fwd No : 1Z123456789\nStatus: Delivered',
 status:'Delivered',latestProgress:'Delivered',submittedAwb:internalReference,freshResult:true
},internalReference).deliveredDate,null,'Never substitute refresh date for missing delivery event');
const api=readFileSync('app/api/branch-loads/route.js','utf8');
const ui=readFileSync('app/BranchLoadsDashboard.js','utf8');
const sync=readFileSync('lib/jepoBranchSync.js','utf8');
const cron=readFileSync('app/api/cron/jepo-branches/route.js','utf8');
const browser=readFileSync('lib/jepoBranchBrowser.js','utf8');
const settings=JSON.parse(readFileSync('vercel.json','utf8'));
assert.ok(api.includes("to_char(delivered_on,'YYYY-MM-DD') AS delivered_on"), 'Return real delivered date, not booked date.');
assert.ok(api.includes("TIME ZONE 'Asia/Kolkata'"), 'Manual delivery uses local IST day.');
assert.ok(ui.includes('sheet===\'DELIVERED\'')&&ui.includes('const byDelivery='), 'Delivered sheet sorted by verified delivery day.');
assert.ok(ui.includes('Date not verified'), 'Unknown historic delivery dates must not be made up.');
assert.ok(ui.includes("'Delivery Date'"), 'Delivery day included in exported Delivered records.');
assert.ok(sync.includes("delivery_date_source="), 'JEPO verified delivery event is persisted.');
assert.ok(browser.includes('deliveredScanDate'), 'Read actual date from live timeline.');
assert.ok(api.includes('jepo_live_remarks'));
assert.ok(api.includes('jepo_live_awb'));
assert.ok(ui.includes('key="liveRemarks"'));
assert.equal((ui.match(/<th>Live Remarks<\/th>/g)||[]).length,2);
assert.ok(ui.includes('setInterval(onFocus,20000)'), 'Visible branch page must refresh from saved live data every 20 seconds.');
assert.ok(ui.includes('JEPO AUTO LIVE'), 'Show automatic live status without requiring clicks.');
assert.ok(ui.includes('JEPO website checked every 4 hours'), 'Display the four-hour tracking schedule.');
assert.ok(ui.includes('Refresh JEPO Live'));
assert.ok(ui.includes('Track JEPO'));
assert.ok(ui.includes('r.liveStatus||statusLabel(r.status)'));
assert.ok(sync.includes("WHEN delivery_status='DELIVERED' THEN delivery_status"));
assert.ok(sync.includes('jepo_live_status='));
assert.ok(sync.includes('jepo_live_remarks='));
assert.ok(sync.includes('slice(0,240)'), 'The complete JEPO register must fit in one parallel pass.');
assert.ok(sync.includes('readJepoTrackingBatch(awbs,persist,{concurrency})'), 'Persist each concurrent result as it arrives.');
assert.ok(browser.includes('const results=new Array(awbs.length)'), 'Maintain correct AWB result order during parallel requests.');
assert.ok(cron.includes('LIMIT 240'), 'Check all JEPO AWBs in one scheduled run.');
assert.ok(!cron.includes("delivery_status<>'DELIVERED'"), 'All records including Delivered must have refresh coverage.');
assert.ok(cron.includes('CRON_SECRET'));
assert.ok(settings.crons.some(c=>c.path==='/api/cron/jepo-branches'&&c.schedule==='0 */4 * * *'));
const nextConfig=readFileSync('next.config.js','utf8');
for(const route of ['/api/cron/jepo-branches','/api/branch-loads/jepo-live']){
  assert.ok(nextConfig.includes("'"+route+"': ['./node_modules/@sparticuz/chromium/bin/**/*']"),
    'Chromium binary must be traced into '+route+' runtime');
}
assert.ok(browser.includes('https://jepoexpress.com/track'));
assert.ok(browser.includes('freshResult:true'));
assert.ok(browser.includes('beforeResult'));
assert.ok(browser.includes('validateJepoLiveResult({...snapshot,submittedAwb:awb,freshResult:true},awb)'));
assert.ok(browser.includes("let cursor=0"), 'Browser workers must share bounded work queue.');
assert.ok(browser.includes("await Promise.all(Array.from"), 'JEPO tracking must use parallel browser tabs.');
assert.ok(browser.includes("if(typeof onResult==='function')await onResult(results[index])"), 'Persist results without waiting for the last shipment.');
assert.ok(api.includes('checkTrackingNo'), 'Duplicate check must work before save.');
assert.ok(api.includes('findDuplicateJepo(sql,entry.trackingNo,id)'), 'Server must reject duplicate creates and edits.');
assert.ok(api.includes('duplicateNotice'), 'Duplicate acknowledgment must include warning.');
assert.ok(ui.includes('DUPLICATE JEPO NO.'), 'Show duplicate warning during JEPO number entry.');
assert.ok(ui.includes('duplicateTrackingNumbers'), 'Highlight existing duplicate tracking numbers.');
assert.ok(ui.includes('duplicateBadge'), 'Show duplicate label in saved JEPO tracking rows.');
assert.equal(isJindJepoTimeout({branch:'JIND',liveError:'Waiting failed: 25000ms exceeded'}),true,
  'The actual JEPO Jind waiting error must blink.');
assert.equal(isJindJepoTimeout({branch:'JIND',liveError:'Navigation timeout of 27000ms exceeded'}),true);
assert.equal(isJindJepoTimeout({branch:'JIND',liveError:'Timed out while waiting for result'}),true);
assert.equal(isJindJepoTimeout({branch:'KARNAL',liveError:'Waiting failed: 25000ms exceeded'}),false,
  'The Jind-only alert must not recolor Karnal entries.');
assert.equal(isJindJepoTimeout({branch:'JIND',liveError:'Unknown key: Control+A'}),false,
  'Unrelated tracking errors must not be mislabeled as timeouts.');
assert.equal(isJindJepoTimeout({branch:'JIND',liveError:''}),false,
  'The alert must disappear on a successful automatic refresh.');
const jindCss=readFileSync('app/BranchLoadsDashboard.module.css','utf8');
assert.ok(jindCss.includes('jindJepoTimeoutCells'), 'Amber timeout blinking animation must exist.');
assert.ok(jindCss.includes('prefers-reduced-motion'), 'Accessibility animation opt out required.');
assert.ok(ui.includes('isJindJepoTimeout(row)?styles.jindTimeoutRow'), 'Highlight Jind timeout table rows.');
assert.ok(ui.includes('JEPO TIMEOUT · AUTO RETRY'), 'Show which Jind shipments timed out.');
assert.ok(ui.includes('https://jepoexpress.com/track'), 'Keep direct tracking website link.');
assert.ok(ui.includes('>Track JEPO</button>'), 'Keep existing manual JEPO tracking button.');
console.log('JEPO branch live status, Progress, AWB guards, tracking scheduler and Live Remarks UI checks passed.');
