import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { confirmedExportHandoverDate, confirmedExportHandoverMonth } from '../lib/exportHandoverAccounting.js';
import { includeExportMasterInProfit } from '../lib/exportProfitSource.js';
import { exportProfitHandoverDate, exportProfitHandoverMonth } from '../lib/profitPeriod.js';
import { importArrivalMonth } from '../lib/monthlyArchive.js';
import { confirmedPartArrival } from '../lib/arrivalWeights.js';

const handover={
  shipmentType:'EXPORT',handoverDone:true,masterCopyReceived:true,
  departureDate:'2026-11-01',departureTime:'02:00',
  handoverTime:'2026-10-31 21:00',
  handoverUpdatedAt:'2026-10-31T15:30:00Z'
};
assert.equal(confirmedExportHandoverDate(handover),'2026-10-31','Actual IST handover is authoritative');
assert.equal(confirmedExportHandoverMonth(handover),'2026-10');
assert.equal(exportProfitHandoverDate(handover),'2026-10-31');
assert.equal(exportProfitHandoverMonth(handover),'2026-10');
assert.equal(includeExportMasterInProfit(handover,'2026-10','2026-11'),true);
assert.equal(includeExportMasterInProfit(handover,'2026-11','2026-11'),false,
  'Completed Export must not be double-counted in departure month');
assert.equal(confirmedExportHandoverDate({...handover,handoverDone:false}),'',
  'Unconfirmed export must not be archived');
assert.equal(confirmedExportHandoverMonth({...handover,handoverDone:false}),'');
assert.equal(confirmedExportHandoverDate({...handover,
  handoverUpdatedAt:'2026-10-31T20:30:00Z'}),'2026-11-01',
  'Actual handover time crossing midnight in IST determines accounting month');
assert.equal(confirmedExportHandoverMonth({...handover,
  handoverUpdatedAt:'2026-10-31T20:30:00Z'}),'2026-11');
assert.equal(confirmedExportHandoverDate({...handover,
  handoverUpdatedAt:'',handoverTime:'2026-10-31 21:00'}),'2026-10-31',
  'Legacy confirmed handover falls back to displayed handover time, not departure');
assert.equal(confirmedExportHandoverDate({...handover,
  handoverUpdatedAt:'',handoverTime:'',departureTime:'02:00'}),'2026-10-31');
assert.equal(confirmedExportHandoverDate({...handover,handoverDone:false,handoverUpdatedAt:'2026-10-31T15:30:00Z'}),'');
assert.equal(importArrivalMonth('2026-11-01'),'2026-11');
assert.equal(importArrivalMonth('2026-10-31'),'2026-10');
assert.equal(confirmedPartArrival({arrivalDate:'2026-10-31',arrivalIsActual:true}),true);
assert.equal(confirmedPartArrival({arrivalDate:'2026-10-31',arrivalEstimate:true}),false);

const archive=readFileSync('lib/monthlyArchive.js','utf8');
const api=readFileSync('app/api/monthly-records/route.js','utf8');
const ui=readFileSync('app/MonthlyDashboard.js','utf8');
const sheet=readFileSync('app/ExportProfitSheet.js','utf8');
const track=readFileSync('app/DashboardClient.js','utf8');
assert.ok(archive.includes('const month=confirmedExportHandoverMonth(data)'));
assert.ok(archive.includes("archiveBy:'handoverDate'"));
assert.ok(!archive.includes("archiveBy:'departureDate'"));
assert.ok(archive.includes('!confirmedPartArrival(data)'),
  'Import archive must require real arrival, not estimated ETA');
assert.ok(archive.includes('importArrivalMonth(part.arrivalDate)'),
  'Import split parts assigned by their individual arrival dates');
assert.ok(api.includes('const validRecords=archived.filter(matchesAccountingMonth)'),
  'Legacy departure-month snapshots must be hidden without deleting records');
assert.ok(api.includes('confirmedExportHandoverMonth(data)===period'));
assert.ok(ui.includes('return confirmedExportHandoverMonth(d)===month?[record]:[];'));
assert.ok(ui.includes('Handover Date (IST)'));
assert.ok(ui.includes('formatDate(confirmedExportHandoverDate(r))'));
assert.ok(sheet.includes('recorded Handover YES date in IST'));
assert.ok(track.includes("done&&row.handoverDone===true&&row.handoverUpdatedAt?row.handoverUpdatedAt:"),
  'Repeated Handover YES must not silently shift the historical month');
console.log('Monthly Records accounting verified: Export Handover YES IST, Import actual arrival, no departure-month duplicates.');
