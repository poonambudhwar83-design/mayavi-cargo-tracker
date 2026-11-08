import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSessionToken,readSession} from '../lib/mayaviAuth.js';

const original=process.env.MAYAVI_SESSION_SECRET;
process.env.MAYAVI_SESSION_SECRET='test-only-session-secret-not-used-in-production';
try{
 const session={username:'haryanaadmin',displayName:'Haryana Admin',role:'employee',branchScope:'HARYANA',sessionVersion:1};
 const token=createSessionToken(session);
 const req=path=>({url:'https://tracker.mayavicargo.com'+path,headers:new Headers({cookie:'mayavi_session='+token})});
 assert.equal(readSession(req('/api/jepo-tracking'))?.role,'haryana_admin','Allow Haryana Admin to GET JEPO Tracking data.');
 assert.equal(readSession(req('/api/haryana-admin'))?.role,'haryana_admin','Existing Haryana dashboard remains available.');
 assert.equal(readSession(req('/api/accounts')),null,'No Accounts API access.');
 assert.equal(readSession(req('/api/salary')),null,'No salary/profit access.');
 assert.equal(readSession(req('/api/cron/jepo-tracking')),null,'No cron access.');
 assert.equal(readSession(req('/api/other-private')),null,'No broad API access.');
}finally{
 if(original===undefined)delete process.env.MAYAVI_SESSION_SECRET;
 else process.env.MAYAVI_SESSION_SECRET=original;
}
const api=readFileSync('app/api/jepo-tracking/route.js','utf8');
const nav=readFileSync('app/HaryanaAdminDashboard.js','utf8');
const ui=readFileSync('app/JEPOTrackingDashboard.js','utf8');
const unified=readFileSync('app/UnifiedDashboard.js','utf8');
assert.ok(api.includes('async function auth(request,sql,{readOnlyAllowed=false}={})'));
assert.ok(api.includes("isHaryana=readOnlyAllowed&&session.role==='haryana_admin'"));
assert.ok(api.includes("user.role==='employee'&&user.branch_scope==='HARYANA'"));
assert.ok(api.includes("if(!await auth(request,sql,{readOnlyAllowed:true}))"));
const post=api.slice(api.indexOf('export async function POST'),api.indexOf('export async function PATCH'));
const patch=api.slice(api.indexOf('export async function PATCH'));
assert.ok(post.includes('if(!await auth(request,sql))'), 'CSV upload remains admin-only.');
assert.ok(patch.includes('if(!await auth(request,sql))'), 'Manual live refresh remains admin-only.');
assert.ok(!post.includes('readOnlyAllowed:true')&&!patch.includes('readOnlyAllowed:true'), 'No Haryana write permission.');
assert.ok(nav.includes('>JEPO TRACKING</button>'));
assert.ok(nav.includes('<JEPOTrackingDashboard readOnly/>'));
assert.ok(nav.includes('ACTIVE IMPORT MASTERS')&&nav.includes('JIND / KARNAL LOADS'), 'Keep existing Haryana tabs.');
assert.ok(unified.includes('<HaryanaAdminDashboard currentUser={session} onLogout={logout}/>'));
assert.ok(ui.includes('export default function JEPOTrackingDashboard({readOnly=false})'));
assert.ok(ui.includes('{!readOnly&&<section style={panel}>'), 'Hide upload and save for read-only Haryana.');
assert.ok(ui.includes("tab==='ACTIVE'&&!readOnly"), 'Hide batch tracking button.');
assert.ok(ui.includes("{!readOnly&&<td"), 'Hide row live-check button.');
assert.ok(ui.includes("['DAILY','Daily Load']")&&ui.includes("['WEEKLY','Weekly Load']"), 'Haryana views all live summaries.');
console.log('Haryana Admin JEPO read-only access tests passed, other APIs remain restricted.');
