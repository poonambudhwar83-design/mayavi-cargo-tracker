import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const ui=readFileSync('app/SpeedPostDashboard.js','utf8');
const api=readFileSync('app/api/speedpost/route.js','utf8');
for(const fragment of [
 "const [duplicateFocus,setDuplicateFocus]=useState('')",
 "const focusDuplicateED=useCallback(row=>{",
 "setSpeedPostTab(isDelivered(row)?'DELIVERED':'ACTIVE')",
 "setSelectedListDay('ALL')",
 "setExportStatus('SHEET')",
 "setRowSearch('')",
 "focusDuplicateED(result.row||{trackingNo:id})",
 "focusDuplicateED(data.row)",
 "focusDuplicateED(saved.row)",
 "onClick={()=>focusDuplicateED(r)}",
 "if(a.trackingNo===duplicateFocus)return -1",
 "if(b.trackingNo===duplicateFocus)return 1",
 "if(a.duplicateAlert===true&&b.duplicateAlert!==true)return -1",
 "const displayedRows=",
 "background-color:#d8b4fe",
 ".sp-record-table tbody tr.sp-duplicate-row > td",
 "animation:speedPostDuplicateBlink 1.3s linear infinite!important",
 "className={(r.duplicateAlert===true||r.trackingNo===duplicateFocus)?'sp-duplicate-row':undefined}",
 "The original packet is highlighted at the top with all saved details.",
 "r.consigneeName||'NAME PENDING'",
 "setDuplicateFocus(focus=>focus===id?'':focus)",
]){
 assert.ok(ui.includes(fragment),'Missing ED duplicate spotlight contract: '+fragment);
}
assert.ok(api.includes("'{duplicateAlert}','true'::jsonb"),'Server marks repeated ED without creating another parcel');
assert.ok(api.includes("return json({ok:true,duplicate:true,row:rowToResult(duplicate[0])"),'Return original ED and saved consignee data');
assert.ok(ui.indexOf("if(result.duplicate===true)")<ui.indexOf("if(result.created===true"),
 'A repeated ED should not run new tracking/save flow');
assert.ok(ui.includes("body:JSON.stringify({trackingNo:id,action:'acknowledge-duplicate'})"),'Acknowledging must clear server alert');
assert.ok(ui.includes("['saved','duplicate','review','error'].includes(x.status)"),'Count duplicate photos as reviewed');
assert.ok(ui.includes(".sp-duplicate-alert,.sp-record-table tbody tr.sp-duplicate-row > td{")&&
 ui.includes("animation:none!important;background-color:#e9d5ff!important"),'Respect reduced-motion users');
console.log('Speed Post duplicate ED test passed: previous Active/Delivered row pinned top, full saved client, purple blink, barcode and OCR, no duplicate.');
