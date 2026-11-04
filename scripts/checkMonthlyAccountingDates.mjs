import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { confirmedExportHandoverDate, confirmedExportHandoverMonth } from '../lib/exportHandoverAccounting.js';
import { includeExportMasterInProfit } from '../lib/exportProfitSource.js';
import { exportProfitHandoverDate, exportProfitHandoverMonth } from '../lib/profitPeriod.js';
import { importArrivalMonth } from '../lib/monthlyArchive.js';
import { confirmedPartArrival } from '../lib/arrivalWeights.js';
import {archiveOriginalWeight,normalizedWeightMinus,netArchiveWeight,monthlyPartKey,validMonthlyPartKey} from '../lib/monthlyWeightMinus.js';

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
const monthlyParts={partShipments:[
  {arrivalDate:'2026-10-31',arrivalIsActual:true,weight:'210/570',pieces:'6'},
  {arrivalDate:'2026-11-01',arrivalIsActual:true,weight:'360/570',pieces:'8'}
]};
assert.equal(archiveOriginalWeight(monthlyParts,'2026-10','part:0'),210,
  'October partial weight must not include the part arriving in November');
assert.equal(archiveOriginalWeight(monthlyParts,'2026-11','part:0'),360);
assert.equal(archiveOriginalWeight(monthlyParts,'2026-10','master'),null,
  'Split MAWB cannot deduct entire master weight again.');
assert.equal(archiveOriginalWeight({totalWeight:'725',weight:'725'},'2026-10','master'),725);
assert.equal(monthlyPartKey({archivePartIndex:0}),'part:0');
assert.equal(monthlyPartKey({archivePartIndex:3}),'part:3');
assert.equal(monthlyPartKey({}),'master');
assert.equal(validMonthlyPartKey('part:0'),true);
assert.equal(validMonthlyPartKey('part:abc'),false);
assert.equal(normalizedWeightMinus('50.125',210),50.125);
assert.equal(normalizedWeightMinus('',210),0);
assert.equal(normalizedWeightMinus('220',210),null,'Cannot subtract more than original weight.');
assert.equal(normalizedWeightMinus('-1',210),null,'Cannot enter negative minus weight.');
assert.equal(normalizedWeightMinus('1.1234',210),null,'Only three decimal places allowed.');
assert.equal(netArchiveWeight(210,50.125),159.875);
assert.ok(api.includes('mayavi_monthly_weight_minus'), 'Write Weight Minus separately so original archived data stays untouched.');
assert.ok(api.includes('ON CONFLICT(archive_month,shipment_type,awb,part_key) DO UPDATE'),
  'Each saved Import part gets its own editable adjustment.');
assert.ok(ui.includes('Weight Minus (kg)')&&ui.includes('Net Weight (kg)'));
assert.ok(ui.includes("method:'PATCH'"),'Weight Minus must persist to backend.');
console.log('Monthly Records accounting verified: Export Handover YES IST, Import actual arrival, no departure-month duplicates.');
