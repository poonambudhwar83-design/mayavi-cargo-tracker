// Ethiopian-only operational exception from CURRENT official cargo events.
// "RESCHEDULED" here means Mayavi needs a revised ETA, NOT that Ethiopian
// has confirmed a new booking. No airline parser or other carrier is changed.
const airport = x => String(x || '').trim().toUpperCase();
const isoDate = x => /^20\d{2}-\d{2}-\d{2}$/.test(String(x || ''));
const hhmm = x => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(x || ''));

export function markEthiopianReschedulePending(shipment = {}, nowMs = Date.now()) {
  if (airport(shipment.carrierCode) !== 'ET' || !shipment.ethiopianLiveVerifiedAt) return shipment;
  if (shipment.arrivalIsActual === true || /ARRIVED|DELIVERED|OFFLOAD|CANCEL/i.test(String(shipment.status || ''))) return shipment;
  const destination = airport(shipment.destination);
  const flights = Array.isArray(shipment.flightSchedule) ? shipment.flightSchedule : [];
  const finalLeg = [...flights].reverse().find(f =>
    airport(f.destination) === destination && f.flightNo && isoDate(f.date));
  if (!finalLeg || !/^(SCHEDULED|CONFIRMED)$/.test(airport(finalLeg.flightStatus))) return shipment;
  // Compare only IST-normalized estimated arrival for this SAME final-flight day.
  // A schedule being old is not enough without a dated arrival-time estimate.
  const etaDate = String(shipment.arrivalDate || '');
  const etaTime = String(shipment.arrivalTime || '');
  if (!isoDate(etaDate) || !hhmm(etaTime) || etaDate !== finalLeg.date ||
      airport(shipment.arrivalTimeZone || 'IST') !== 'IST') return shipment;
  const expected = Date.parse(etaDate + 'T' + etaTime + ':00+05:30');
  if (!Number.isFinite(expected) || !Number.isFinite(nowMs) || nowMs <= expected) return shipment;

  // The 10 Oct KWI -> ADD departure does NOT confirm the 11 Oct ADD -> DEL leg.
  // Only matching final-leg departure/destination-arrival cargo events may
  // prevent the reschedule-needed warning.
  const origin = airport(finalLeg.origin);
  const route = new RegExp('\\bfrom\\s+' + origin + '\\s+to\\s+' + destination + '\\b', 'i');
  const history = Array.isArray(shipment.historyEvents) ? shipment.historyEvents : [];
  const hasFinalDeparture = history.some(e =>
    /DEPART|LOADED ON FLIGHT/i.test(String(e.label || '')) &&
    route.test(String(e.description || '')));
  const hasFinalArrival = history.some(e =>
    /RECEIVED FROM FLIGHT|ARRIV|DELIVER/i.test(String(e.label || '')) &&
    route.test(String(e.description || '')));
  if (hasFinalDeparture || hasFinalArrival) return shipment;

  const flight = String(finalLeg.flightNo || '').toUpperCase();
  const note = flight + ' ' + origin + ' -> ' + destination + ': scheduled arrival ' +
    etaDate + ' ' + etaTime + ' IST has passed; final-leg departure is not confirmed. ' +
    'Await a revised airline ETA (Mayavi alert, not airline-confirmed rebooking).';
  return {
    ...shipment,
    status: 'RESCHEDULED',
    statusSource: 'Mayavi missed-ETA rule (official final-leg departure not confirmed)',
    reschedulePending: true,
    rescheduleReason: note,
    previousScheduledArrivalDate: etaDate,
    previousScheduledArrivalTime: etaTime,
    previousScheduledArrivalTimeZone: 'IST',
    arrivalDate: '',
    arrivalTime: '',
    arrivalIsActual: false,
    arrivalEstimate: false,
    arrivalVerifiedAbsent: true,
    arrivalTimeZone: 'IST',
    arrivalTimeSource: 'Previous ETA expired; waiting for confirmed revised flight ETA',
    mailTime: '',
    remarks: note
  };
}
