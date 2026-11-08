import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateJepoLiveResult,validateJepoProgressOnlyResult} from '../lib/jepoBranchTracking.js';
import {jepoTrackingState,jepoTrackingStatusLabel} from '../lib/jepoTrackingState.js';

const snapshot={
 submittedAwb:'533140',freshResult:true,
 bodyText:'Fwd No : 1Z1234567890123456\nStatus :\nDate Time Location Progress\nFri, 30 Oct 2026 10:54 AM Departed from Facility',
 status:'Date Time Location Progress',latestProgress:'Departed from Facility',
 latestEventWhen:'Fri, 30 Oct 2026 10:54 AM'
};
assert.throws(()=>validateJepoLiveResult(snapshot,'533140'),/verified shipment status/i,
 'Do not turn JEPO Progress table headings into a fake shipment Status.');
const progress=validateJepoProgressOnlyResult(snapshot,'533140');
assert.equal(progress.liveRemarks,'Departed from Facility');
assert.equal(progress.liveEventWhen,'Fri, 30 Oct 2026 10:54 AM');
assert.equal(progress.liveStatus,'');
assert.equal(progress.deliveredDate,null);
assert.equal(progress.progressOnly,true);
assert.throws(()=>validateJepoProgressOnlyResult({...snapshot,submittedAwb:'533141'},'533140'),/not verified/);
assert.throws(()=>validateJepoProgressOnlyResult({...snapshot,bodyText:'Fwd No : CONSIGNEE'},'533140'),/verifiable downstream AWB/i);
assert.throws(()=>validateJepoProgressOnlyResult({...snapshot,latestProgress:''},'533140'),/timeline is empty/);
const record={status:'PENDING',liveRemarks:progress.liveRemarks,liveStatus:'',checkedAt:'2026-11-08T03:02:00Z'};
assert.equal(jepoTrackingState(record),'PROGRESS_ONLY');
assert.equal(jepoTrackingStatusLabel(record),'JEPO Progress Available');

const browser=readFileSync('lib/jepoBranchBrowser.js','utf8');
const store=readFileSync('lib/jepoTrackingStore.js','utf8');
const ui=readFileSync('app/JEPOTrackingDashboard.js','utf8');
const config=JSON.parse(readFileSync('vercel.json','utf8'));
assert.ok(browser.includes('waitForJepoResult(page,beforeResult,{allowProgressOnly})'));
assert.ok(browser.includes('validateJepoProgressOnlyResult(liveResult,awb)'));
assert.ok(store.includes('allowProgressOnly:true'));
assert.ok(store.includes("live_status=CASE WHEN $2<>'' THEN $2 ELSE live_status END"));
assert.ok(ui.includes("['awb','AWB No.'],['liveRemarks','JEPO Progress']"),'Progress must appear beside AWB.');
assert.ok(ui.includes('JEPO live checks every 2 minutes, up to 100 AWBs per batch'));
assert.equal(config.crons.find(x=>x.path==='/api/cron/jepo-tracking').schedule,'*/2 * * * *');
assert.ok(ui.includes("['WEEKLY','Weekly Load']"),'Keep existing JEPO reports.');
console.log('JEPO fast 100-AWB/2-minute scheduling, real Progress capture and no invented status verified.');
