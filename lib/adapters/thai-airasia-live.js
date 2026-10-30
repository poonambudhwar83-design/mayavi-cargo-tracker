import { airlineForMawb, normalizeMawb } from '../airlines.js';
import { trackOfficial } from '../official-tracker.js';
import { fetchFlightEta } from '../aerodatabox.js';

// Verified against the customer's SmartKargo movement history (29 Oct 2026)
// and the published 31 Oct XJ230 timetable. This is a time-limited fallback
// for ONE known shipment, not a timetable rule for all Thai AirAsia cargo.
const KNOWN_ONWARD_LEGS = {
  '900-15927424': {
    origin: 'HAN',
    connection: 'DMK',
    destination: 'DEL',
    flightNo: 'XJ230',
    flightDate: '2026-10-31',
    scheduledArrival: '19:50',
    pieces: '19',
    weight: '564'
  }
};

function clock(value = '') {
  const match = String(value).match(/(\d{4}-\d{2}-\d{2})[T\s](\d{2}:\d{2})/);
  return match ? { date: match[1], time: match[2] } : null;
}

function isExactOnwardFlight(flight, leg) {
  if (!flight || !leg) return false;
  const number = String(flight.flightNo || '').replace(/[^a-z0-9]/gi, '').toUpperCase();
  const origin = String(flight.origin || '').toUpperCase();
  const destination = String(flight.destination || '').toUpperCase();
  // AeroDataBox occasionally returns another day's flight when a flight
  // number has no record for the requested day. Never treat that as arrival.
  const day = String(flight.departureTime || flight.actualDeparture || flight.eta || '').slice(0, 10);
  return number === leg.flightNo &&
    origin === leg.connection &&
    destination === leg.destination &&
    day === leg.flightDate;
}

export async function trackThaiAirAsiaLive(inputMawb) {
  const mawb = normalizeMawb(inputMawb);
  const airline = airlineForMawb(mawb);
  if (!mawb || !mawb.startsWith('900-')) {
    return { ok: false, reason: 'NOT THAI AIRASIA MAWB', airline };
  }

  const official = await trackOfficial(mawb);
  const tracked = official.ok ? official.shipment || {} : {};
  const leg = KNOWN_ONWARD_LEGS[mawb];

  if (!leg) {
    // Generic SmartKargo parsing can see an ARRIVED milestone at an
    // intermediate airport. Without the final station/flight pairing
    // we must not present that event as confirmed destination arrival.
    const finalArrivalVerified = Boolean(
      tracked.finalArrivalVerified && tracked.arrivalIsActual
    );
    if (!official.ok) return official;
    return {
      ok: true,
      airline,
      shipment: {
        ...tracked,
        carrierCode: 'FD',
        airlineName: 'Thai AirAsia Cargo',
        arrivalDate: finalArrivalVerified ? tracked.arrivalDate : '',
        arrivalTime: finalArrivalVerified ? tracked.arrivalTime : '',
        arrivalIsActual: finalArrivalVerified,
        actualArrival: finalArrivalVerified ? tracked.actualArrival : null,
        eta: finalArrivalVerified ? tracked.eta : null,
        status: finalArrivalVerified ? 'ARRIVED' : 'TRACKING',
        source: 'AirAsia SmartKargo (final-destination arrival unverified)'
      },
      debug: { stage: 'THAI_AIRASIA_FINAL_DESTINATION_GUARD', official: official.debug }
    };
  }

  let flight = null;
  try {
    flight = await fetchFlightEta(leg.flightNo, {
      date: leg.flightDate,
      origin: leg.connection,
      destination: leg.destination
    });
  } catch {}

  const matchingFlight = isExactOnwardFlight(flight, leg) ? flight : null;
  const cancelled = /CANCEL/.test(String(matchingFlight?.status || '').toUpperCase());
  const actual = !cancelled ? clock(matchingFlight?.actualArrival) : null;
  const estimated = !cancelled ? clock(matchingFlight?.eta) : null;
  const arrival = actual || estimated || (cancelled ? null : {
    date: leg.flightDate, time: leg.scheduledArrival
  });

  // A 29 Oct ARRIVED event is the HAN->DMK leg, NOT the 31 Oct final DEL leg.
  // Flight status is paired by flight number, date and both endpoints above.
  const status = cancelled ? 'DELAYED' : actual ? 'ARRIVED' : 'IN TRANSIT';
  const remarks = cancelled
    ? `${leg.flightNo} to DEL: flight cancelled; revised onward booking required`
    : actual
      ? `Confirmed ${leg.flightNo} arrival at DEL; intermediate DMK arrival excluded`
      : `Arrived at DMK on 29 Oct; ${leg.flightNo} scheduled to DEL on 31 Oct (ETA, not actual)`;

  return {
    ok: true,
    airline,
    shipment: {
      ...tracked,
      mawb,
      carrierCode: 'FD',
      airlineName: 'Thai AirAsia Cargo',
      origin: leg.origin,
      destination: leg.destination,
      currentStation: actual ? leg.destination : leg.connection,
      bags: tracked.bags || tracked.pieces || leg.pieces,
      pieces: tracked.pieces || tracked.bags || leg.pieces,
      weight: tracked.weight || leg.weight,
      flightNo: leg.flightNo,
      flightDate: leg.flightDate,
      arrivalDate: arrival?.date || '',
      arrivalTime: arrival?.time || '',
      arrivalIsActual: Boolean(actual),
      arrivalEstimate: !actual && Boolean(arrival),
      actualArrival: matchingFlight?.actualArrival && actual ? matchingFlight.actualArrival : null,
      eta: matchingFlight?.eta && estimated ? matchingFlight.eta : arrival ? `${arrival.date}T${arrival.time}:00` : null,
      status,
      remarks,
      officialTracker: airline?.url || 'https://airasia.smartkargo.com/FrmAWBTracking.aspx',
      source: actual
        ? 'AirAsia SmartKargo + exact XJ230 DEL flight actual'
        : 'AirAsia SmartKargo + published XJ230 schedule (estimated only)'
    },
    debug: {
      stage: 'THAI_AIRASIA_FINAL_DESTINATION_CHECK',
      official: official.debug,
      officialError: official.ok ? '' : official.reason,
      flightMatched: Boolean(matchingFlight),
      confirmedFinalArrival: Boolean(actual)
    }
  };
}
