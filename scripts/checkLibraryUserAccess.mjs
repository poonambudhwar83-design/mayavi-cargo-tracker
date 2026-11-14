import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSessionToken,libraryAccessSession,readSession} from '../lib/mayaviAuth.js';

// Route-level access is checked from a signed, scoped cookie.
// Existing admin and Haryana Admin behavior must remain unchanged.
process.env.MAYAVI_SESSION_SECRET='local-library-access-regression-secret';
const makeRequest=(user,path,method='GET')=>new Request('https://tracker.mayavicargo.com'+path,{
 method,headers:{cookie:'mayavi_session='+createSessionToken(user)}
});
const library={username:'library',displayName:'Haryana Library',role:'employee',branchScope:'LIBRARY',sessionVersion:1};
const admin={username:'admin',displayName:'Admin',role:'admin',branchScope:'',sessionVersion:1};
const readOnlyHaryana={username:'haryanaadmin',displayName:'Haryana Admin',role:'employee',branchScope:'HARYANA',sessionVersion:1};
const other={username:'accounts',displayName:'Accounts',role:'employee',branchScope:'ACCOUNTS',sessionVersion:1};
for(const path of ['/api/auth','/api/library-management','/api/library-expenses']){
 const r=makeRequest(library,path);
 assert.equal(readSession(r)?.username,'library',path+' should accept the Library user');
 if(path!=='/api/auth')assert.equal(libraryAccessSession(r)?.username,'library');
 const post=makeRequest(library,path,'POST');
 assert.equal(readSession(post)?.username,'library',path+' POST should accept Library user');
}
for(const path of ['/api/shipments','/api/salary','/api/employee-attendance','/api/accounts','/api/branch-loads',
 '/api/study-notes','/api/admin-notes','/api/jepo-tracking','/api/track','/api/cron/active-airlines','/api/auth/test']){
 assert.equal(readSession(makeRequest(library,path)),null,'Library must not access '+path);
}
for(const path of ['/api/library-management','/api/library-expenses']){
 assert.equal(libraryAccessSession(makeRequest(admin,path))?.role,'admin','Main admin must still be permitted');
 assert.equal(libraryAccessSession(makeRequest(readOnlyHaryana,path)),null,'Haryana Admin remains read-only outside Library');
 assert.equal(libraryAccessSession(makeRequest(other,path)),null,'Accounts user cannot access Library');
}
assert.equal(readSession(makeRequest({...library,username:'other'},'/api/library-management')),null);
assert.equal(readSession(makeRequest({...library,role:'admin'},'/api/library-management')),null);
// Verify UI and DB account provisioning; first password is Admin-controlled.
const auth=readFileSync('app/api/auth/route.js','utf8');
const ui=readFileSync('app/UnifiedDashboard.js','utf8');
const sidebar=readFileSync('app/MayaviSidebar.js','utf8');
const libraryApi=readFileSync('app/api/library-management/route.js','utf8');
const expenseApi=readFileSync('app/api/library-expenses/route.js','utf8');
assert.ok(auth.includes("'admin_set_password'"));
assert.ok(auth.includes('if(user.branch_scope)return json('));
assert.ok(auth.includes('sessionVersion:'));
assert.ok(ui.includes('const libraryLogin='));
assert.ok(ui.includes('libraryLogin\n    ?<LibraryDashboard initialTab="seats"/>'));
assert.ok(ui.includes("branchScope==='LIBRARY'?'LIBRARY_SEATS'"));
assert.ok(sidebar.includes("title:'HARYANA · LIBRARY'"));
assert.ok(libraryApi.includes('libraryAccessSession(request)'));
assert.ok(expenseApi.includes('libraryAccessSession(request)'));
assert.ok(expenseApi.includes("operator.username||'library'"));
console.log('Haryana Library user, signed session, CRUD permissions, and cargo isolation verified.');
