import assert from 'node:assert/strict';
import {checkEdChecksum,edOcrCandidates} from '../lib/speedpostOcr.js';
import {readConsigneeFromEmsTO} from '../lib/speedpostToOcr.js';

// Regression based on the customer's parcel photographed in October 2026.
// Tests only manually verified OCR tokens, never uses customer images/files,
// and never writes shipment/consignee data into the tracker.
const barcodeBelowBars='~ ED977952461IN .';
const [candidate]=edOcrCandidates(barcodeBelowBars,{emsRegion:true});
assert.equal(candidate?.number,'ED977952461IN','Read the small ED print below EMS barcode');
assert.equal(candidate?.checkDigitValid,true,'Check the UPU S10 ED check digit');
assert.equal(checkEdChecksum('ED977952461IN'),true);
assert.equal(edOcrCandidates('ED 977952461 IN',{emsRegion:true})[0]?.number,
  'ED977952461IN','Read split ED tokens from label');

const parcelOcrText=[
  'Sorte the particulars given',
  'Date',
  'GULSHAN',
  'BEAUCHAMP COURT',
  'POOL LN, SLOUGH',
  'SL1 3PF, UK',
  '+44 7352681034',
  'HAPPY',
  'S/O RAJ KUMAR',
  'BACHGAON DABKHERI',
  'DIST. KURUKSHETRA',
  '136119 HARYANA'
].join('\n');

for(const focus of [true,false]){
  const recipient=readConsigneeFromEmsTO(parcelOcrText,'',{focusedRecipientArea:focus});
  assert.equal(recipient.consigneeName,'GULSHAN','Name must be first printed recipient, not sender HAPPY');
  for(const phrase of ['BEAUCHAMP COURT','POOL LN, SLOUGH','SL1 3PF','UK']){
    assert.ok(recipient.consigneeAddress.includes(phrase),
      'Address must include '+phrase+' without sender or customs data');
  }
  assert.ok(!/HAPPY|RAJ KUMAR|KURUKSHETRA/.test(recipient.consigneeAddress),
    'Sender must not be copied into recipient address');
}
const senderOnly=readConsigneeFromEmsTO('HAPPY\nS/O RAJ KUMAR\nBACHGAON DABKHERI\nDIST. KURUKSHETRA\n136119 HARYANA','',{focusedRecipientArea:true});
assert.equal(senderOnly.consigneeName,'','Sender-only text must not be labelled recipient');
console.log('Speed Post OCR regression passed: photo ED/check digit, consignee, full UK address, sender exclusion');
