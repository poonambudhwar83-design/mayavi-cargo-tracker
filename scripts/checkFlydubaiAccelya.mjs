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

const timeline=[
  'Track Shipment Doc. No.: 141-53630301 Courier',
  'KUWAIT (KWI)',
  'DELHI (DEL)',
  'Expected to arrive at DEL on Sun, 18 Oct 2026 03:15',
  'Tracking Details',
  'Milestones',
  'DWC, 12:31 PM,',
  'Received at DWC from Flight No. FZ-3036, 16 Oct 2026, KWI-DWC',
  '16 Pieces',
  'DWC, 12:31 PM,',
  'Received at DWC from Flight No. FZ-3036, 16 Oct 2026, KWI-DWC',
  '62 Pieces',
  'KWI, 8:30 AM,',
  'Departed to DWC on Flight FZ-3036, 16 Oct 2026, KWI-DWC',
  '78 Pieces',
  'KWI, 11:39 PM,',
  'Booked on Flight FZ-3097, 17 Oct 2026, DWC-DEL',
  '78 Pieces'
].join('\n');
const parsed=parseFlydubaiText(timeline,[],awb);
assert.equal(parsed?.origin,'KWI');
assert.equal(parsed?.destination,'DEL');
assert.equal(parsed?.pieces,'78');
assert.equal(parsed?.weight,'');
assert.equal(parsed?.flightNo,'FZ3097');
assert.equal(parsed?.departureFlightNo,'FZ3036');
assert.equal(parsed?.arrivalDate,'2026-10-18');
assert.equal(parsed?.arrivalTime,'03:15');
assert.equal(parsed?.status,'IN TRANSIT',
  'Cargo received at intermediate DWC is not ARRIVED at Delhi');
assert.equal(parsed?.arrivalIsActual,false);
assert.equal(parsed?.flydubaiEvidence?.timelineRead,true);
assert.equal(parseFlydubaiText(timeline.replace('141-53630301','141-53630302'),[],awb),null);

console.log('Flydubai Accelya parsing regression passed: AWB match, no false success from prefilled search, weight/pieces.');
