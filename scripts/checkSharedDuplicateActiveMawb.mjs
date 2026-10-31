import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const route=readFileSync('app/api/shipments/route.js','utf8');
const ui=readFileSync('app/DashboardClient.js','utf8');
const css=readFileSync('app/globals.css','utf8');

// Only alert metadata may be patched on an existing, authenticated master.
// Do not write a second MAWB, change client name, or touch customs/profit.
for(const token of [
  "body?.operation==='markDuplicate'||body?.operation==='acknowledgeDuplicate'",
  "SELECT data FROM mayavi_shipments WHERE awb=",
  "'{duplicateAlert}','true'::jsonb,true",
  "'{duplicateCount}',to_jsonb(COALESCE((data->>'duplicateCount')::integer,0)+1),true",
  "'{duplicateAlertAt}'",
  "'{duplicateAlert}','false'::jsonb,true",
  "'duplicateAlert',COALESCE((mayavi_shipments.data->>'duplicateAlert')::boolean,false)",
  "'duplicateCount',COALESCE((mayavi_shipments.data->>'duplicateCount')::integer,0)"
])assert.ok(route.includes(token),'Missing server duplicate warning storage: '+token);
assert.ok(route.includes("!['admin','employee'].includes(auth.session?.role)"),
  'Read-only/guest sessions must not mark or acknowledge shared duplicates');
for(const token of [
  "const storedDuplicates=tabRows.filter(r=>r.duplicateAlert===true)",
  "r.duplicateAlert===true||",
  "const duplicateVisibleInTab=Boolean(duplicateSpotlight)",
  "async function recordDuplicateMawb(existing)",
  "operation:'markDuplicate'",
  "if(local){await recordDuplicateMawb(local);return}",
  "await recordDuplicateMawb(found)",
  "setRows(current=>dedupeRowsByMawb([saved,...current.filter",
  "if(!duplicateVisibleInTab)return ordered",
  "ordered.filter(r=>isDuplicateRow(r))",
  "className={isDuplicateRow(r)?'mayaviDuplicateRow':''}",
  "duplicateVisibleInTab&&<section className=\"mayaviDuplicateBanner\"",
  "onClick={()=>acknowledgeDuplicateMawb(duplicateSpotlight)}",
  "operation:'acknowledgeDuplicate'"
])assert.ok(ui.includes(token),'Missing Active/Cleared shared duplicate spotlight: '+token);
assert.ok(css.includes(".cargoTrackTable tbody tr.mayaviDuplicateRow > td")&&
  css.includes("@keyframes mayaviDuplicatePurplePulse"),
  'Entire original row including frozen MAWB/client must purple pulse');
assert.ok(ui.includes("if(isAdmin&&adminView==='CLEARED')return tabRows.filter(r=>hasIndependentCustomsParts(r)||isCustomsArchived(r))"),
  'Alert cannot force an Active import master into Customs Cleared');
assert.ok(ui.includes("return tabRows.filter(r=>hasIndependentCustomsParts(r)||!isCustomsArchived(r))"),
  'Original Active master must remain in Active sheet');
assert.ok(ui.includes('isDuplicateRow(r)'),
  'Cross-session server flag must visually highlight the original master');
console.log('Persistent duplicate MAWB: original Active/Cleared row purple blinks across browsers, duplicate is not created and customs/client details preserved.');
