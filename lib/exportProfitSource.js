import { importArrivalMonth } from './monthlyArchive.js';

// Mirror the Export tracker: a master is moved to its completed register only
// when handover AND master copy have both been confirmed. Never include Import
// or private Other Countries data in this Export Profit selection.
export function isCompletedExportMaster(data={}){
  return data.handoverDone===true&&data.masterCopyReceived===true;
}

// This-month Export Profit = every Export Active master (regardless of date)
// plus this month's completed Export masters, as on the dashboard.
// Closed months = masters completed with a departure in that month.
// Do not use handover deadline as a visibility gate: it can be blank until
// the flight is assigned and does not determine Active/Completed membership.
export function includeExportMasterInProfit(data={},month='',currentMonth=''){
  const completed=isCompletedExportMaster(data);
  const departureMonth=importArrivalMonth(data.departureDate||data.flightDate||'');
  if(!month||!currentMonth)return false;
  return month===currentMonth?(!completed||departureMonth===month):
    (completed&&departureMonth===month);
}
export function exportProfitRegister(data={}){
  return isCompletedExportMaster(data)?'MASTER COPY RECEIVED':'ACTIVE';
}
