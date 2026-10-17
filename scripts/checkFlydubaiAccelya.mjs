import assert from 'node:assert/strict';
import {parseFlydubaiText} from '../lib/flydubai.js';

const awb='141-53630301';
const fake='Track Shipment Doc No 14153630301 Search Tracking Details\n'+
  'Origin: KWI Destination: DWC Bags: 467 Flight FZ3036 Booked 17 Oct 2026';
assert.equal(parseFlydubaiText(fake,[],awb),null,
  'A prefilled document and unrelated page statistics may not update a shipment');
assert.equal(parseFlydubaiText('Doc No 14153630301 Bags 467 Flight FZ3036',[],awb),null);
const verified='Tracking Details AWB 141-53630301 Origin KWI Destination DWC Pieces 2 Weight 100 kg';
const a=parseFlydubaiText(verified,[],awb);
assert.equal(a?.pieces,'2');
assert.equal(a?.weight,'100');
assert.equal(a?.origin,'KWI');
assert.equal(a?.destination,'DWC');
assert.equal(parseFlydubaiText(verified,[],'141-53630302'),null);
console.log('Flydubai Accelya parsing regression passed: AWB match, no false success from prefilled search, weight/pieces.');
