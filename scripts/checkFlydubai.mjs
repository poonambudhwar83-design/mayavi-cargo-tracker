import assert from 'node:assert/strict';
import { parseFlydubaiText } from '../lib/flydubai.js';
const awb='141-12345675';
const details='Shipment AWB 141-12345675 Origin DEL Destination LHR Pieces 20 Weight 145 KG';
const rows=[
  'RCS | DEL | DXB | 14/10/2026 | 20:00',
  'DEP | DEL | DXB | FZ432 | 15/10/2026 | 02:00',
  'ARR | DEL | DXB | FZ432 | 15/10/2026 | 04:00',
  'ETA | DXB | LHR | FZ901 | 16/10/2026 | 11:30'
];
assert.equal(parseFlydubaiText(details,rows,awb).status,'IN TRANSIT');
assert.equal(parseFlydubaiText(details,rows,awb).arrivalIsActual,false);
const arrived=parseFlydubaiText(details,[...rows,'ARR | DXB | LHR | FZ901 | 16/10/2026 | 11:45'],awb);
assert.equal(arrived.status,'ARRIVED');
assert.equal(arrived.arrivalIsActual,true);
assert.equal(arrived.arrivalDate,'2026-10-16');
assert.equal(parseFlydubaiText('Track your shipment',[],awb),null);
assert.equal(parseFlydubaiText(details,rows,'141-99999992'),null);
console.log('Flydubai AWB verification and final-destination event tests passed');
