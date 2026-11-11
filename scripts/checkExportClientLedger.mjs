import assert from 'node:assert/strict';
import {buildExportClientLedgerRows,validEiciAmount} from '../lib/exportClientLedger.js';

const mk=(awb,clientName,totalWeight,partShipments=[])=>({
  awb,data:{shipmentType:'EXPORT',clientName,totalWeight,partShipments}
});
const shipments=[
  mk('11100000001','Regular Client',10,[{partKey:'a',weight:4},{partKey:'b',weight:6}]),
  mk('11100000002','DHL',20),
  mk('11100000003','Special Client',7.5),
  mk('11100000005','M5 EXPRESS',12),
  {awb:'11100000004',data:{shipmentType:'IMPORT',clientName:'Ignore',totalWeight:100}}
];
const eici=[{awb:'11100000001',amount:100},{awb:'11100000002',amount:100},{awb:'11100000003',amount:0}];
const splits=[{client_key:'SPECIAL CLIENT',scheme:'2_ACCOUNT_4_CASH'},{client_key:'DHL',scheme:'2_ACCOUNT_4_CASH'}];
const receipts=[
  {awb:'11100000001',mode:'ACCOUNT',amount:50},
  {awb:'11100000001',mode:'CASH',amount:10}
];
const rows=buildExportClientLedgerRows(shipments,eici,splits,receipts,'2026-10','2026-10');
assert.equal(rows.length,4,'Import excluded, one ledger row per Export master');
const get=client=>rows.find(r=>r.clientName===client);
const ordinary=get('Regular Client');
assert.equal(ordinary.weight,10,'Never add known master and parts together');
assert.equal(ordinary.grossAccount,30);
assert.equal(ordinary.commission,0);
assert.equal(ordinary.eiciAmount,100);
assert.equal(ordinary.eiciGst,18);
assert.equal(ordinary.accountCharge,148);
assert.equal(ordinary.cashCharge,30);
assert.equal(ordinary.totalCharge,178);
assert.equal(ordinary.accountBalance,98);
assert.equal(ordinary.cashBalance,20);
assert.equal(ordinary.balance,118);
const dhl=get('DHL');
assert.equal(dhl.scheme,'DHL','DHL cannot get special 2/4 split');
assert.equal(dhl.grossAccount,380,'DHL gross = 19 x weight');
assert.equal(dhl.commission,160,'DHL commission = 8 x weight');
assert.equal(dhl.netAccount,220,'DHL net account = 11 x weight');
assert.equal(dhl.cashCharge,0);
assert.equal(dhl.accountCharge,338);
assert.equal(dhl.eiciGst,18);
const special=get('Special Client');
assert.equal(special.accountRate,2);
assert.equal(special.cashRate,4);
assert.equal(special.accountCharge,15);
assert.equal(special.cashCharge,30);
assert.equal(special.eiciGst,0);
const m5=get('M5 EXPRESS');
assert.equal(m5.scheme,'2_ACCOUNT_4_CASH','M5 is fixed to 2/4 by client name');
assert.equal(m5.accountCharge,24);
assert.equal(m5.cashCharge,48);
assert.equal(validEiciAmount('-4'),null);
assert.equal(validEiciAmount('1.123'),null);
assert.equal(validEiciAmount('123.45'),123.45);
const unknown=buildExportClientLedgerRows([mk('11100000005','Unknown',5)],[],[],[],'2026-10','2026-10')[0];
assert.equal(unknown.missingEici,true,'Do not silently assume EICI amount');
assert.equal(unknown.eiciGst,null);
console.log('Export Client Ledger rates, GST, commission, receipts and master-weight checks passed.');
