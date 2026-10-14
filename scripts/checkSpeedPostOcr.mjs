import assert from 'node:assert/strict';
import {checkEdChecksum,edOcrCandidates} from '../lib/speedpostOcr.js';
import {readConsigneeFromEmsTO} from '../lib/speedpostToOcr.js';
import {parseTrackParcelDetails} from '../lib/trackparcel.js';

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

// Second real-world case: a rotated TO panel beneath an EMS sticker.
// The previous OCR confused digit 2 with 5 on ED977952529IN, and incorrectly
// trusted an incomplete recipient address. Check the exact user-verified
// text tokens, not a hard-coded response tied to this particular parcel.
const validEd='ED977952529IN';
const wrongEd='ED977955529IN';
assert.equal(checkEdChecksum(validEd),true,'Printed Mandeep EMS ED has valid check digit');
assert.equal(checkEdChecksum(wrongEd),false,'OCR-confused 2->5 ED must be rejected');
assert.equal(edOcrCandidates('ED 977952529 IN',{emsRegion:true})[0]?.number,validEd);
assert.equal(edOcrCandidates(wrongEd,{emsRegion:true})[0]?.checkDigitValid,false);
const rotatedRecipient=[
  'MANDEEP',
  '68 WESTWOOD RD',
  'ILFORD',
  'IG3 8RZ, UK',
  '+44 7471283083',
  'FROM',
  'AJAY',
  'S/O JARNAIL',
  'RAMGARH PANDWAN',
  'DIST. KAITHAL'
].join('\n');
const readRotated=readConsigneeFromEmsTO(rotatedRecipient,'',{focusedRecipientArea:true});
assert.equal(readRotated.consigneeName,'MANDEEP','TO name must be MANDEEP');
for(const token of ['68 WESTWOOD RD','ILFORD','IG3 8RZ','UK'])
  assert.ok(readRotated.consigneeAddress.includes(token),'Complete TO address contains '+token);
assert.ok(!/AJAY|JARNAIL|KAITHAL/.test(readRotated.consigneeAddress),'FROM sender must be excluded');
console.log('Speed Post OCR regression passed: ED checksum false-read, Mandeep rotated TO, Gulshan TO and sender exclusion');

const edForDelivery='ED977952461IN';
const resultCard=[
  'India Post','Live result',edForDelivery,
  'Status','Delivered','To','14 King Street, Leicester UK',
  'Weight','9710','Tracking History',
  '10 Oct 2026','Delivered','Item handed over',
  '09 Oct 2026','Out for Delivery'
].join('\n');
const readDelivery=parseTrackParcelDetails(resultCard,edForDelivery);
assert.equal(readDelivery?.status,'Delivered');
assert.equal(readDelivery?.weight,'9710 g');
assert.equal(readDelivery?.address,'14 King Street, Leicester UK');
assert.equal(readDelivery?.trackParcelDeliveredAtText,'10 Oct 2026',
  'Use dated Delivered event, not latest lookup time');
const noDateResult=parseTrackParcelDetails([
 'India Post','Live result',edForDelivery,'Status','Delivered',
 'Weight','9710','Tracking History','Delivered'
].join('\n'),edForDelivery);
assert.equal(noDateResult?.deliveredAtText,'','Never invent delivery date');
assert.equal(parseTrackParcelDetails(resultCard,'ED111111111IN'),null,
  'Never accept event from different ED');
// A fresh ED appearing in the search input does not make generic tracking
// FAQ, a cited indiapost.gov.in URL, or an old Delivered mention current data.
const misleadingPage=[
  'India Post','Live result','ED977952475IN',
  'Origin','indiapost.gov.in, checked 2026-10-06. TrackParcel is not India Post.',
  'Tracking History','Delivered','Why is parcel delivered?'
].join('\n');
assert.equal(parseTrackParcelDetails(misleadingPage,'ED977952475IN'),null,
  'A website disclaimer and generic Delivered text must not create shipment data');
const incompleteWithWeight=[
  'India Post','Live result','ED977952339IN',
  'Origin','indiapost.gov.in, checked 2026-10-06. TrackParcel is not India Post.',
  'Weight','9710','Tracking History','Delivered'
].join('\n');
const partial=parseTrackParcelDetails(incompleteWithWeight,'ED977952339IN');
assert.equal(partial?.weight,'9710 g','Keep confirmed parcel weight');
assert.equal(partial?.origin,'','Reject website disclaimer as origin');
assert.equal(partial?.status,'','Never infer Delivered from history or FAQ');
console.log('TrackParcel date, weight and TO-address regression passed');
