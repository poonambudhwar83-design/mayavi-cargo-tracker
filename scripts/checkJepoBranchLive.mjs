import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {cleanJepoTrackingNo,sourceStatusToBranch,validateJepoLiveResult} from '../lib/jepoBranchTracking.js';
assert.equal(cleanJepoTrackingNo(' 1z12b6f40334321920 '),'1Z12B6F40334321920');
assert.equal(cleanJepoTrackingNo('wrong/awb'),'');
assert.equal(sourceStatusToBranch('Pre Transit'),'PRE_TRANSIT');
assert.equal(sourceStatusToBranch('In Transit'),'IN_TRANSIT');
assert.equal(sourceStatusToBranch('Out For Delivery'),'OUT_FOR_DELIVERY');
assert.equal(sourceStatusToBranch('Delivered'),'DELIVERED');
assert.equal(sourceStatusToBranch('Not Delivered'),null);
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
const api=readFileSync('app/api/branch-loads/route.js','utf8');
const ui=readFileSync('app/BranchLoadsDashboard.js','utf8');
const sync=readFileSync('lib/jepoBranchSync.js','utf8');
const cron=readFileSync('app/api/cron/jepo-branches/route.js','utf8');
const browser=readFileSync('lib/jepoBranchBrowser.js','utf8');
const settings=JSON.parse(readFileSync('vercel.json','utf8'));
assert.ok(api.includes('jepo_live_remarks'));
assert.ok(api.includes('jepo_live_awb'));
assert.ok(ui.includes('key="liveRemarks"'));
assert.equal((ui.match(/<th>Live Remarks<\/th>/g)||[]).length,2);
assert.ok(ui.includes('Refresh JEPO Live'));
assert.ok(ui.includes('Track JEPO'));
assert.ok(ui.includes('r.liveStatus||statusLabel(r.status)'));
assert.ok(sync.includes("WHEN delivery_status='DELIVERED' THEN delivery_status"));
assert.ok(sync.includes('jepo_live_status='));
assert.ok(sync.includes('jepo_live_remarks='));
assert.ok(cron.includes('CRON_SECRET'));
assert.ok(settings.crons.some(c=>c.path==='/api/cron/jepo-branches'&&c.schedule==='*/5 * * * *'));
const nextConfig=readFileSync('next.config.js','utf8');
for(const route of ['/api/cron/jepo-branches','/api/branch-loads/jepo-live']){
  assert.ok(nextConfig.includes("'"+route+"': ['./node_modules/@sparticuz/chromium/bin/**/*']"),
    'Chromium binary must be traced into '+route+' runtime');
}
assert.ok(browser.includes('https://jepoexpress.com/track'));
assert.ok(browser.includes('freshResult:true'));
assert.ok(browser.includes('beforeResult'));
assert.ok(browser.includes('validateJepoLiveResult({...snapshot,submittedAwb:awb,freshResult:true},awb)'));
console.log('JEPO branch live status, Progress, AWB guards, tracking scheduler and Live Remarks UI checks passed.');
