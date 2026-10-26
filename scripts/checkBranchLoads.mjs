import assert from 'node:assert/strict';
import {amounts,allowedBranch,dateValid,decimal,DESTINATIONS,COMMODITIES,SERVICES,LOAD_STATUSES} from '../lib/branchLoads.js';
assert.equal(allowedBranch('jind'),'JIND');
assert.equal(allowedBranch('Karnal'),'KARNAL');
assert.equal(allowedBranch('sonu'),'');
assert.equal(dateValid('2026-10-26'),true);
assert.equal(dateValid('2026-02-30'),false);
assert.deepEqual(amounts('125.5','150','3500'),{amount:18825,balance:15325});
assert.deepEqual(amounts('10','100','1100'),{amount:1000,balance:-100});
assert.equal(amounts('0','100','0'),null);
assert.equal(decimal('-1'),null);
assert.equal(decimal('1.234',2),null);
assert.ok(DESTINATIONS.includes('UK')&&DESTINATIONS.includes('USA')&&DESTINATIONS.includes('Australia'));
assert.ok(COMMODITIES.includes('Protein')&&COMMODITIES.includes('Clothes'));
assert.ok(SERVICES.includes('FedEx')&&SERVICES.includes('Aramex')&&SERVICES.includes('DHL')&&SERVICES.includes('Self'));
assert.deepEqual(LOAD_STATUSES,['AT_JIND_OFFICE','AT_KARNAL_OFFICE','AT_JEPO_OFFICE','DISPATCHED','IN_TRANSIT','DELIVERED']);
assert.ok(SERVICES.includes('TPL')&&SERVICES.includes('KCC'));
// Contract: branch workers see only their own records; Admin alone sees both.
// Checking the live route in prebuild protects against future cross-branch leaks.
import {readFileSync} from 'node:fs';
const route=readFileSync('app/api/branch-loads/route.js','utf8');
assert.ok(route.includes('WHERE branch=${auth.branch} ORDER BY record_date DESC'));
assert.ok(route.includes("const branch=auth.admin?allowedBranch(body.branch):auth.branch;"));
assert.ok(route.includes('WHERE id=${id} AND branch=${auth.branch} RETURNING id'));
assert.ok(route.includes('DELETE FROM mayavi_branch_loads WHERE id=${id} AND branch=${auth.branch} RETURNING id'));
console.log('Jind/Karnal daily load and server-side data isolation checks passed.');
