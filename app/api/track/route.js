import { airlineForMawb, normalizeMawb } from '../../../lib/airlines.js';
import { trackOfficial } from '../../../lib/official-tracker.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function waiting(mawb, airline, reason = '') {
  return {
    mawb,
    carrierCode: airline?.iata || '',
    airlineName: airline?.name || '',
    origin: '',
    destination: '',
    bags: '',
    pieces: '',
    weight: '',
    flightNo: '',
    arrivalDate: '',
    arrivalTime: '',
    eta: null,
    actualArrival: null,
    status: 'CHECKING',
    officialTracker: airline?.url || '',
    source: `${airline?.name || 'Official airline'} official tracker`,
    message: reason
  };
}

async function handle(mawb) {
  const airline = airlineForMawb(mawb);
  const result = await trackOfficial(mawb);

  if (result.ok) {
    return Response.json({
      ok: true,
      configured: true,
      provider: `${result.airline.name} official website`,
      source: `${result.airline.name} official website`,
      airlinePrimary: true,
      noPaidApi: true,
      noTrackJet: true,
      shipment: result.shipment,
      trackingDebug: result.debug
    });
  }

  return Response.json({
    ok: true,
    configured: true,
    provider: 'Official airline websites',
    source: 'Official airline tracker',
    airlinePrimary: true,
    noPaidApi: true,
    noTrackJet: true,
    trackingError: result.reason,
    trackingDebug: result.debug,
    officialTracker: result.airline?.url || airline?.url || '',
    shipment: waiting(mawb, result.airline || airline, result.reason)
  });
}

export async function GET(request) {
  const url = new URL(request.url);
  const query = url.searchParams.get('mawb');
  if (!query) {
    return Response.json({
      configured: true,
      provider: 'Official airline websites',
      apiKeyRequired: false,
      noPaidApi: true,
      noTrackJet: true,
      mode: 'MAWB prefix → official airline tracker → fill MAWB → read result when permitted'
    });
  }

  const mawb = normalizeMawb(query);
  if (!mawb) return Response.json({ ok: false, error: 'Enter a valid 11-digit MAWB.' }, { status: 400 });
  return handle(mawb);
}

export async function POST(request) {
  let body = {};
  try { body = await request.json(); } catch { return Response.json({ ok: false, error: 'Invalid request body.' }, { status: 400 }); }

  const mawb = normalizeMawb(body?.mawb);
  if (!mawb) return Response.json({ ok: false, error: 'Enter a valid 11-digit MAWB.' }, { status: 400 });
  return handle(mawb);
}
