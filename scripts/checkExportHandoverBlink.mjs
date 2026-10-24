// Export Handover blinking protected 2026-10-24 after live user verification.
// Intentional contract lock: only the handover deadline and its UI blink are
// frozen; do not freeze the shared dashboard, Import Mail, or airline trackers.
// Changing the protected behavior requires explicit approval.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const src=readFileSync('app/DashboardClient.js','utf8');
const css=readFileSync('app/globals.css','utf8');
function extract(name){
  const marker='function '+name+'(';
  const at=src.indexOf(marker);
  assert.ok(at>=0,'LOCKED EXPORT HANDOVER FUNCTION MISSING: '+name);
  assert.equal(src.indexOf(marker,at+1),-1,'LOCKED EXPORT HANDOVER FUNCTION DUPLICATED: '+name);
  const end=src.indexOf('\nfunction ',at+marker.length);
  return src.slice(at,end>=0?end:src.length).trim();
}
const lockedHandoverTime=String.raw`function handoverTimeFrom(date='',time=''){
  const d=istDateTimeValue(date,time);if(!d)return'';
  return new Date(d.getTime()-5*60*60*1000).toISOString().slice(0,16).replace('T',' ');
}`;
const lockedOverdue=String.raw`function exportHandoverOverdue(row={},nowMs=Date.now()){
  if(row.handoverDone===true)return false;
  const displayed=formatDateTime24(row.handoverTime||handoverTimeFrom(row.departureDate||row.flightDate||'',row.departureTime||''));
  const m=displayed.match(/^(20\d{2}-\d{2}-\d{2})\s+(\d{2}:\d{2})$/);
  if(!m)return false;
  const wallClock=istDateTimeValue(m[1],m[2]);
  return Boolean(wallClock&&nowMs>=wallClock.getTime()-330*60*1000);
}`;

assert.equal(extract('handoverTimeFrom'),lockedHandoverTime,'LOCKED EXPORT HANDOVER -5H RULE MODIFIED: approval required.');
assert.equal(extract('exportHandoverOverdue'),lockedOverdue,'LOCKED EXPORT HANDOVER OVERDUE RULE MODIFIED: approval required.');
assert.ok(src.includes("exportHandoverOverdue(r,mailClock)?'urgentBlink':''"),'LOCKED EXPORT NO BLINK UI MODIFIED.');
assert.ok(src.includes("r.handoverDone!==true?'selected':''"),'LOCKED EXPORT NO SELECTION MODIFIED.');
assert.ok(src.includes("setHandover(r.mawb,true)"),'LOCKED EXPORT YES ACTION MISSING.');
assert.ok(src.includes("setHandover(r.mawb,false)"),'LOCKED EXPORT NO ACTION MISSING.');
assert.ok(src.includes("setInterval(()=>setMailClock(Date.now()),15000)"),'LOCKED BLINK CLOCK UPDATE REMOVED.');
assert.ok(css.includes('.urgentBlink{animation:mayaviUrgentBlink .8s infinite'),'LOCKED EXPORT BLINK CSS REMOVED.');

const names=['pad','formatTime24','formatDateTime24','istDateTimeValue','handoverTimeFrom','exportHandoverOverdue'];
const scripts=names.map(extract).join('\n')+'\n({handoverTimeFrom,exportHandoverOverdue})';
const {handoverTimeFrom,exportHandoverOverdue}=runInNewContext(scripts,{Date,String,Number,Boolean});
const asUtc=t=>Date.parse(t);

assert.equal(handoverTimeFrom('2026-10-24','20:00'),'2026-10-24 15:00');
assert.equal(handoverTimeFrom('2026-10-25','02:00'),'2026-10-24 21:00');
assert.equal(handoverTimeFrom('2026-10-24',''),'');
const row={departureDate:'2026-10-24',departureTime:'20:00',handoverDone:false};
assert.equal(exportHandoverOverdue(row,asUtc('2026-10-24T09:29:59Z')),false,'Must not blink before 15:00 IST.');
assert.equal(exportHandoverOverdue(row,asUtc('2026-10-24T09:30:00Z')),true,'Must blink from 15:00 IST, not departure.');
assert.equal(exportHandoverOverdue({...row,handoverDone:true},asUtc('2026-10-24T11:00:00Z')),false,'YES must stop blinking.');
assert.equal(exportHandoverOverdue({handoverTime:'2026-10-24 15:00',handoverDone:false},asUtc('2026-10-24T09:30:00Z')),true,'Stored displayed handover time must drive blink.');
assert.equal(exportHandoverOverdue({departureDate:'2026-10-25',departureTime:'02:00',handoverDone:false},asUtc('2026-10-24T15:30:00Z')),true,'Previous-day deadline must blink.');
assert.equal(exportHandoverOverdue({handoverDone:false},asUtc('2026-10-24T15:30:00Z')),false,'Missing date/time must not blink.');
console.log('LOCKED Export Handover blink regression passed: -5h IST, NO deadline, YES stop, date rollover, CSS and live clock.');
