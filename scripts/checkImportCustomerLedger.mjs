import assert from 'node:assert/strict';
import {importMonthlyCustomerLedger} from '../lib/importCustomerLedger.js';
const rows=[
 {id:'a',_batchId:'batch1',customerName:'Puneet Traders',masterNo:'123',flightDate:'20-11-2026',origin:'DXB',description:'Clothes',customerWeight:'10',customerBags:'2'},
 {id:'b',_batchId:'batch1',customerName:' puneet  traders ',masterNo:'456',flightDate:'21-11-2026',origin:'JFK',description:'Books',customerWeight:'20',customerBags:'4'},
 {id:'c',_batchId:'batch1',customerName:'Other Client',masterNo:'456',flightDate:'21-11-2026',origin:'JFK',description:'Books',customerWeight:'5',customerBags:'1'},
 {id:'d',_batchId:'batch2',customerName:'Puneet Traders',masterNo:'123',flightDate:'22-11-2026',origin:'DXB',description:'Clothes',customerWeight:'10',customerBags:'2'}
];
const calculated=new Map([
 ['a',{sales:2000,shares:{duty:100,eici:50,ut:20,freight:200},pl:1630}],
 ['b',{sales:4000,shares:{duty:200,eici:100,ut:40,freight:400},pl:3260}],
 ['c',{sales:1000,shares:{duty:50,eici:25,ut:10,freight:100},pl:815}]
]);
const result=importMonthlyCustomerLedger(rows,calculated);
assert.equal(result.length,2);
const main=result.find(r=>r.customerName==='Puneet Traders');
assert.ok(main);
assert.equal(main.entries.length,3);
assert.equal(main.masterCount,3); // Same master number in separate uploads stays distinct.
assert.equal(main.totalWeight,40);
assert.equal(main.totalBags,8);
assert.equal(main.totalRevenue,6000);
assert.equal(main.totalDuty,300);
assert.equal(main.totalEici,150);
assert.equal(main.totalUt,60);
assert.equal(main.totalFreight,600);
assert.equal(main.totalProfit,4890);
assert.equal(main.pendingProfitRows,1);
assert.equal(main.originText,'DXB • JFK');
assert.equal(main.descriptionText,'Clothes • Books');
assert.equal(result.find(r=>r.customerName==='Other Client').totalProfit,815);
assert.equal(rows[0].customerName,'Puneet Traders'); // aggregation must not mutate source.
console.log('Import customer monthly ledger totals and per-master details verified.');
