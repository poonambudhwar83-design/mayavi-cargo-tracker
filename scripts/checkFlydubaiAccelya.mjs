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


// Show Details is the gross-weight authority for the verified master AWB.
const withDetails=[timeline,'Show Details','Total Pieces: 78','Gross Weight: 566.5 KG','Booking Date: 15 Oct 2026'].join('\n');
const detailed=parseFlydubaiText(withDetails,[],awb);
assert.equal(detailed?.weight,'566.5');
assert.equal(detailed?.weightSource,'Flydubai official Show Details gross weight');
assert.equal(detailed?.masterPieces,'78');
assert.equal(detailed?.bookingDate,'2026-10-15');
const showWeight=parseFlydubaiText([timeline,'Show Details','Total Bags: 78','Weight: 563.5 KG'].join('\n'),[],awb);
assert.equal(showWeight?.weight,'563.5');
assert.equal(showWeight?.masterPieces,'78');

// Split RCF events can each publish a different piece count and kilogram value.
// Deduplicate repeated events, sum only when they cover the whole master.
const part1='RCF Received at DWC from Flight FZ-3036, 16 Oct 2026\n16 Pieces 101.5 KG';
const part2='RCF Received at DWC from Flight FZ-3036, 16 Oct 2026\n62 Pieces 462 KG';
const fullyReceived=parseFlydubaiText([timeline,part1,part2,part1].join('\n'),[],awb);
assert.equal(fullyReceived?.rcfParts?.length,2);
assert.equal(fullyReceived?.rcfReceivedPieces,'78');
assert.equal(fullyReceived?.rcfReceivedWeight,'563.5');
assert.equal(fullyReceived?.weight,'563.5');
assert.equal(fullyReceived?.rcfMasterComplete,true);
assert.equal(fullyReceived?.status,'IN TRANSIT','RCF at DWC cannot mark DEL arrived');

const partlyReceived=parseFlydubaiText([timeline,part1].join('\n'),[],awb);
assert.equal(partlyReceived?.rcfReceivedPieces,'16');
assert.equal(partlyReceived?.rcfReceivedWeight,'101.5');
assert.equal(partlyReceived?.weight,'','16-piece RCF kg cannot become the 78-piece master weight');
assert.equal(partlyReceived?.rcfMasterComplete,false);

// The test must never treat flight booking at DWC as the original AWB booking.
assert.equal(parsed?.bookingDate,'');


// An actual RCF at the FINAL destination confirms arrival, even when the
// prior route timeline also contains an RCF at intermediate DWC.
const arrivedTimeline=[timeline,
  'DEL, 4:12 AM,',
  'Received at DEL from Flight No. FZ-3097, 18 Oct 2026, DWC-DEL',
  '78 Pieces'
].join('\n');
const arrived=parseFlydubaiText(arrivedTimeline,[],awb);
assert.equal(arrived?.status,'ARRIVED');
assert.equal(arrived?.arrivalIsActual,true);
assert.equal(arrived?.arrivalStation,'DEL');
assert.equal(arrived?.arrivalDate,'2026-10-18');
assert.equal(arrived?.arrivalTime,'04:12');
assert.equal(arrived?.scheduledArrivalTime,'03:15');
assert.equal(arrived?.flydubaiEvidence?.finalArrivalConfirmed,true);
assert.equal(parsed?.flydubaiEvidence?.finalArrivalConfirmed,false);

// If the carrier confirms DEL receipt without publishing an actual clock,
// never copy the previous ETA into a falsely labelled actual timestamp.
const arrivalWithoutClock=parseFlydubaiText([timeline,
  'Received at DEL from Flight No. FZ-3097, 18 Oct 2026, DWC-DEL'
].join('\n'),[],awb);
assert.equal(arrivalWithoutClock?.status,'ARRIVED');
assert.equal(arrivalWithoutClock?.arrivalIsActual,true);
assert.equal(arrivalWithoutClock?.arrivalTime,'');

// A fresh final-station date without a clock must no longer vanish.
// Arrival remains an estimate, not a confirmed Delhi cargo receipt.
const dateOnlyTimeline=timeline
  .replace('Expected to arrive at DEL on Sun, 18 Oct 2026 03:15',
           'Expected to arrive at DEL on Tue, 3 Nov 2026')
  .replaceAll('16 Oct 2026','2 Nov 2026')
  .replaceAll('17 Oct 2026','2 Nov 2026');
const dateOnly=parseFlydubaiText(dateOnlyTimeline,[],awb);
assert.equal(dateOnly?.arrivalDate,'2026-11-03');
assert.equal(dateOnly?.scheduledArrivalDate,'2026-11-03');
assert.equal(dateOnly?.arrivalTime,'');
assert.equal(dateOnly?.status,'IN TRANSIT');
assert.equal(dateOnly?.arrivalIsActual,false);
assert.equal(dateOnly?.flightNo,'FZ3097');
assert.match(dateOnly?.arrivalTimeSource||'',/time pending/i);
const hubOnlyDate=parseFlydubaiText(
  dateOnlyTimeline.replace('Expected to arrive at DEL','Expected to arrive at DWC'),[],awb);
assert.equal(hubOnlyDate?.arrivalDate,'',
  'Never use an intermediate-hub ETA as final Delhi arrival');

// The current SHJ-DWC-DEL shipment can list only the booked FZ3097 date.
const bookedDateOnly=timeline
  .replace('Expected to arrive at DEL on Sun, 18 Oct 2026 03:15','')
  .replace('Booked on Flight FZ-3097, 17 Oct 2026, DWC-DEL',
           'Booked on Flight FZ-3097, 3 Nov 2026, DWC-DEL');
const bookedFinal=parseFlydubaiText(bookedDateOnly,[],awb);
assert.equal(bookedFinal?.flightNo,'FZ3097');
assert.equal(bookedFinal?.finalFlightOrigin,'DWC');
assert.equal(bookedFinal?.finalFlightDestination,'DEL');
assert.equal(bookedFinal?.finalFlightDate,'2026-11-03');
assert.equal(bookedFinal?.arrivalDate,'','Booked flight date alone is NOT an arrival');
assert.equal(bookedFinal?.arrivalIsActual,false);
const labelledEta=parseFlydubaiText(
  bookedDateOnly.replace('Tracking Details','Expected Arrival DEL: 3 Nov 2026 09:20\\nTracking Details'),[],awb);
assert.equal(labelledEta?.arrivalDate,'2026-11-03');
assert.equal(labelledEta?.arrivalTime,'09:20');
assert.equal(labelledEta?.arrivalIsActual,false);


const routeCard=["Doc. No.: 141-53630301 Courier","KUWAIT (KWI) DELHI (DEL)","Confirmed FZ3036 Confirmed FZ3097","KWI","12:00 PM | 03 Nov","1:30 PM | 03 Nov","DWC","8:00 AM | 04 Nov","1:15 PM | 04 Nov","DEL","Tracking Details","Milestones","Booked on Flight FZ-3036, 3 Nov 2026, KWI-DWC","78 Pieces","Booked on Flight FZ-3097, 4 Nov 2026, DWC-DEL","78 Pieces"].join('\n');
const card=parseFlydubaiText(routeCard,[],awb);
assert.equal(card?.finalFlightDepartureTime,'08:00');
assert.equal(card?.scheduledArrivalDate,'2026-11-04');
assert.equal(card?.scheduledArrivalTime,'13:15');
assert.equal(card?.arrivalIsActual,false);



// Regression: carrier timeline prints a date year on one line and the
// independently labelled piece quantity on the next. Never save 2026 pieces.
const yearSplit=[
  'Track Shipment Doc. No.: 141-53630301 Courier',
  'KUWAIT (KWI)',
  'DELHI (DEL)',
  'Tracking Details',
  'Milestones',
  'KWI, 8:30 AM,',
  'Departed to DWC on Flight FZ-3036, 12 Nov 2026, KWI-DWC',
  'Pieces: 24',
  'DWC, 11:39 PM,',
  'Booked on Flight FZ-3097, 12 Nov 2026, DWC-DEL',
  'Pieces: 24'
].join('\n');
const splitParsed=parseFlydubaiText(yearSplit,[],awb);
assert.equal(splitParsed?.pieces,'24');
assert.equal(splitParsed?.bags,'24');
assert.notEqual(splitParsed?.masterPieces,'2026');
const masterOverride=parseFlydubaiText(
  yearSplit+'\nShow Details\nTotal Pieces: 30\nGross Weight: 2000 KG',[],awb);
assert.equal(masterOverride?.pieces,'30',
  'AWB-level Show Details total must override part-load quantities');
assert.equal(masterOverride?.masterPieces,'30');

console.log('Flydubai Accelya parsing regression passed: AWB match, no false success from prefilled search, weight/pieces.');
