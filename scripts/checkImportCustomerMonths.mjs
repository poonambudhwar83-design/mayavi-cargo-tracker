import assert from 'node:assert/strict';
import {importFlightMonth,monthLabel,groupedImportRowMonths,monthOptionsForRows,UNDATED_MONTH} from '../lib/importCustomerMonth.js';

assert.equal(importFlightMonth('2026-11-20'),'2026-11');
assert.equal(importFlightMonth('20/11/2026'),'2026-11');
assert.equal(importFlightMonth('20-11-2026'),'2026-11');
assert.equal(importFlightMonth('2026/10/19'),'2026-10');
assert.equal(importFlightMonth('20 Nov 2026'),'2026-11');
assert.equal(importFlightMonth('2026-02-31'),'');
assert.equal(importFlightMonth(''),'');
assert.equal(monthLabel('2026-11'),'November 2026');

const rows=[
 {id:'a',_batchId:'batch-1',masterNo:'123',flightDate:'19/11/2026',customerName:'Alpha'},
 {id:'b',_batchId:'batch-1',masterNo:'123',flightDate:'',customerName:'Beta'},
 {id:'c',_batchId:'batch-1',masterNo:'456',flightDate:'20/10/2026',customerName:'Gamma'},
 {id:'d',_batchId:'batch-2',masterNo:'123',flightDate:'05/09/2026',customerName:'Delta'},
 {id:'e',_batchId:'batch-2',masterNo:'789',flightDate:'',customerName:'Undated'}
];
const groups=groupedImportRowMonths(rows);
assert.deepEqual(groups.map(x=>x.month),['2026-11','2026-11','2026-10','2026-09',UNDATED_MONTH]);
assert.deepEqual(monthOptionsForRows(rows),[
 {key:'2026-11',label:'November 2026',customers:2,masters:1},
 {key:'2026-10',label:'October 2026',customers:1,masters:1},
 {key:'2026-09',label:'September 2026',customers:1,masters:1},
 {key:UNDATED_MONTH,label:'Without Flight Date',customers:1,masters:1}
]);
console.log('Import Customer month grouping regression passed (Indian dates, master inheritance, multiple uploads, undated).');
