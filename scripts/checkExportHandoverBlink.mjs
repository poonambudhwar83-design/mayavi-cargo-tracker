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

// The old fixed ₹2,600/₹2,500 Export per-MAWB deductions have been removed.
// Only exactly matched Data Analysis rows with blank G&C/D/T/DT contribute Audit expenses.
import { EXPORT_SHIPMENT_CHARGE, resolvedExportShipmentCharge, auditOnlyExportShipmentCharge, validateExportShipmentCharge } from '../lib/exportShipmentCharge.js';
import { readFileSync as readExportChargeSource } from 'node:fs';
import assertExportCharge from 'node:assert/strict';
const exportChargeUi=readExportChargeSource('app/ExportProfitSheet.js','utf8');
const exportChargeApi=readExportChargeSource('app/api/export-profit/route.js','utf8');
assertExportCharge.equal(EXPORT_SHIPMENT_CHARGE,0);
assertExportCharge.equal(resolvedExportShipmentCharge(undefined),0);
assertExportCharge.equal(resolvedExportShipmentCharge(''),0);
assertExportCharge.equal(resolvedExportShipmentCharge(0),0);
assertExportCharge.equal(resolvedExportShipmentCharge(3250.25),3250.25);
assertExportCharge.equal(validateExportShipmentCharge('-1'),null);
assertExportCharge.equal(auditOnlyExportShipmentCharge({shipmentCharge:2600}),0);
assertExportCharge.equal(auditOnlyExportShipmentCharge({shipmentCharge:2500}),0);
assertExportCharge.equal(auditOnlyExportShipmentCharge({shipmentCharge:175,auditAutoCharge:true}),175);
assertExportCharge.ok(exportChargeUi.includes('value*rate-auditOnlyExportShipmentCharge(row)'));
assertExportCharge.ok(exportChargeUi.includes('acc.shipmentCharges+=auditOnlyExportShipmentCharge(r);'));
assertExportCharge.ok(exportChargeUi.includes('Shipment Charges (₹) • Audit Auto'));
assertExportCharge.ok(exportChargeUi.includes('showCategoryMoney(item.deduction)'));
assertExportCharge.ok(exportChargeUi.includes('showCategoryCount(totals.categoryItems[code].bags)'));
assertExportCharge.ok(!exportChargeUi.includes('Shipment Charge defaults to ₹2,600 per MAWB (editable)'));
assertExportCharge.ok(!exportChargeUi.includes('onBlur={event=>void saveShipmentCharge('));
assertExportCharge.ok(exportChargeApi.includes('audits.get(exportAuditKey(awb,client))'));
assertExportCharge.ok(exportChargeApi.includes('shipmentCharge,auditAutoCharge:autoCharge'));
assertExportCharge.ok(exportChargeApi.includes('weight*rate-(autoCharge?shipmentCharge:0)'));
assertExportCharge.ok(!exportChargeApi.includes('mayavi_export_shipment_charge'));
assertExportCharge.ok(exportChargeApi.includes('export async function PATCH(request)'));
assertExportCharge.ok(exportChargeApi.includes("admin?.role!=='admin'"));
import { exportRateForCompany } from '../lib/profitPeriod.js';
assertExportCharge.equal(exportRateForCompany('DHL'),11);
assertExportCharge.equal(exportRateForCompany('DHL EXPRESS'),11);
assertExportCharge.equal(exportRateForCompany('dhl'),11);
assertExportCharge.equal(exportRateForCompany('OVERSEAS'),7);
assertExportCharge.equal(exportRateForCompany('OTHER CLIENT'),6);
assertExportCharge.ok(exportChargeUi.includes('DHL client ₹11/kg'));
assertExportCharge.ok(exportChargeUi.includes('DHL clients earn ₹11/kg'));
assertExportCharge.ok(!exportChargeUi.includes('₹19/kg'));
assertExportCharge.equal(400*exportRateForCompany('DHL')-auditOnlyExportShipmentCharge({shipmentCharge:2600}),4400);
assertExportCharge.equal(400*exportRateForCompany('DHL')-auditOnlyExportShipmentCharge({shipmentCharge:175,auditAutoCharge:true}),4225);
console.log('Export Audit-only shipment charges: fixed fees ignored; exact-match category blank rule and DHL rates passed.');

// Export Profit MAWBs must match Export Active + Master Copy Received (never Import).
import { includeExportMasterInProfit, exportProfitRegister } from '../lib/exportProfitSource.js';
const currentExportMonth='2026-10', oldExportMonth='2026-09';
const activeExport={shipmentType:'EXPORT',masterCopyReceived:false,handoverDone:false,departureDate:''};
const completeExport={shipmentType:'EXPORT',masterCopyReceived:true,handoverDone:true,departureDate:'2026-11-01',handoverUpdatedAt:'2026-10-31T15:00:00Z'};
const oldComplete={...completeExport,departureDate:'2026-10-01',handoverUpdatedAt:'2026-09-30T15:00:00Z'};
assertExportCharge.equal(includeExportMasterInProfit(activeExport,currentExportMonth,currentExportMonth),true);
assertExportCharge.equal(includeExportMasterInProfit(completeExport,currentExportMonth,currentExportMonth),true);
assertExportCharge.equal(includeExportMasterInProfit(oldComplete,currentExportMonth,currentExportMonth),false);
assertExportCharge.equal(includeExportMasterInProfit(oldComplete,oldExportMonth,currentExportMonth),true);
assertExportCharge.equal(includeExportMasterInProfit({...activeExport,departureDate:'2026-09-20'},oldExportMonth,currentExportMonth),false);
assertExportCharge.equal(includeExportMasterInProfit({...completeExport,handoverDone:false},oldExportMonth,currentExportMonth),false,'Handover NO never closes past export month');
assertExportCharge.equal(includeExportMasterInProfit({...completeExport,masterCopyReceived:false},oldExportMonth,currentExportMonth),false,'Active export cannot appear in closed profit month');
assertExportCharge.equal(exportProfitRegister(completeExport),'MASTER COPY RECEIVED');
assertExportCharge.equal(exportProfitRegister(activeExport),'ACTIVE');
assertExportCharge.ok(exportChargeApi.includes("WHERE UPPER(COALESCE(data->>'shipmentType',''))='EXPORT'"));
assertExportCharge.ok(exportChargeApi.includes('includeExportMasterInProfit(data,month,currentProfitMonth())'));
assertExportCharge.ok(exportChargeApi.includes('register:exportProfitRegister(data)'));
assertExportCharge.ok(exportChargeUi.includes('Active + {syncedRegisters.completed} Master Copy Received'));
assertExportCharge.ok(exportChargeUi.includes('row.register==='));
assertExportCharge.ok(!exportChargeUi.includes('By handover month'));
console.log('Export Active and Master Copy Received profit sync parity passed.');
