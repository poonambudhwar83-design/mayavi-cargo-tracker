import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const ui=readFileSync('app/DashboardClient.js','utf8');
const css=readFileSync('app/globals.css','utf8');

// A repeated MAWB must search the entire local set, not only the visible
// Active or Customs Cleared rows. It must query the authenticated shared DB
// when the existing entry is absent from this browser's local snapshot.
for(const fragment of [
  "const local=rowsRef.current.find(x=>normalize(x.mawb)===n)",
  "if(local){focusExistingMaster(local);return}",
  "fetch('/api/shipments',{cache:'no-store',credentials:'include'})",
  "const saved=(data.rows||[]).find(x=>normalize(x.data?.mawb||x.awb)===n)",
  "if(saved)found=dbToRow(saved)",
  "if(found){",
  "focusExistingMaster(found);",
  "No new master was created.",
  "if(!clientName){setNote('Client Name is mandatory.",
  "setDuplicateFocus({mawb:existing.mawb,shipmentType:shipmentTypeOf(existing.shipmentType),targetView})",
  "const targetView=fullyCleared?'CLEARED':'ACTIVE'",
  "if(isAdmin)setAdminView(targetView)",
  "setActiveTab(shipmentTypeOf(existing.shipmentType))",
  "setPrefixFilter('');setClientFilter('');setGoodsFilter('')",
  "duplicateInTab&&digits(r.mawb)===digits(duplicateFocus.mawb)",
  "const ordered=sortForDashboard(expanded,activeTab)",
  "return [...ordered.filter(r=>digits(r.mawb)===digits(duplicateFocus.mawb))",
  "mayaviDuplicateRow",
  "mayaviDuplicateBanner",
  "onClick={()=>setDuplicateFocus(null)}",
]){
  assert.ok(ui.includes(fragment),'Duplicate MAWB spotlight contract missing: '+fragment);
}
assert.ok(ui.indexOf("if(local){focusExistingMaster(local);return}")<
  ui.indexOf("const enteredAt=new Date().toISOString();"),
  'Original master must be caught before any newly entered shipment fields are set');
assert.ok(ui.indexOf('if(found){')<ui.indexOf('if(!clientName){setNote'),
  'Duplicate lookup must not require the user to re-enter or overwrite saved client name');
assert.ok(ui.includes("(duplicateInTab&&digits(r.mawb)===digits(duplicateFocus.mawb))"),
  'Old-month Customs Cleared masters must be visible when repeated');
assert.ok(ui.includes('hasIndependentCustomsParts(r)||isCustomsArchived(r)'),
  'Split-load cleared/active logic must be preserved');
assert.ok(css.includes('@keyframes mayaviDuplicatePurplePulse'));
assert.ok(css.includes('tbody tr.mayaviDuplicateRow > td'),
  'Blink entire original row, not just the AWB cell');
assert.ok(css.includes('background-color:#d8b4fe'),
  'Pulse in purple');
assert.ok(css.includes('@media(prefers-reduced-motion:reduce)'),
  'Accessibility requires static highlight for reduced-motion users');
assert.ok(ui.includes("Existing record in {duplicateFocus.targetView==='CLEARED'?'CUSTOMS CLEARED':'ACTIVE'}"),
  'Client must know whether the saved master is Active or Customs Cleared');
console.log('Repeated MAWB regression passed: shared DB duplicate check, original client, cross-tab pin, purple row blink and no duplicate creation.');
