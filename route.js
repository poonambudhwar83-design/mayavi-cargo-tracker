import { NextResponse } from 'next/server';

const QUERY_URL = 'https://api.track123.com/gateway/open-api/tk/v2.1/aviation/track/query';
const REFRESH_URL = 'https://api.track123.com/gateway/open-api/tk/v2.1/aviation/track/refresh';

function normalizeMawb(v = '') {
  const digits = String(v).replace(/\D/g, '');
  return digits.length >= 11 ? `${digits.slice(0,3)}-${digits.slice(3,11)}` : String(v).trim();
}

async function postTrack123(url, apiKey, body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Track123-Api-Secret': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify(body),
    cache: 'no-store'
  });
  const text = await r.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  return { ok: r.ok, status: r.status, data };
}

function pickFirst(obj, names) {
  if (!obj || typeof obj !== 'object') return null;
  for (const n of names) {
    if (obj[n] !== undefined && obj[n] !== null && obj[n] !== '') return obj[n];
  }
  return null;
}

function walkObjects(value, out = []) {
  if (!value || typeof value !== 'object') return out;
  out.push(value);
  if (Array.isArray(value)) value.forEach(v => walkObjects(v, out));
  else Object.values(value).forEach(v => walkObjects(v, out));
  return out;
}

function normalizeResponse(raw, fallbackMawb) {
  const nodes = walkObjects(raw);
  let best = nodes.find(n => {
    const t = pickFirst(n, ['trackingNo','trackNo','mawb','awbNo','waybillNo','trackingNumber']);
    return t && String(t).replace(/\D/g,'').includes(String(fallbackMawb).replace(/\D/g,'').slice(-8));
  }) || nodes.find(n => pickFirst(n, ['status','statusName','latestStatus','events','checkpoints','milestones'])) || raw;

  const status = pickFirst(best, ['statusName','status','latestStatus','trackingStatus','state']);
  const carrierCode = pickFirst(best, ['carrierCode','courierCode','carrier','airlineCode']);
  const origin = pickFirst(best, ['origin','originAirport','departureAirport','from']);
  const destination = pickFirst(best, ['destination','destinationAirport','arrivalAirport','to']);
  const eta = pickFirst(best, ['estimatedArrivalTime','estimatedArrival','eta','arrivalTime','scheduledArrivalTime']);
  const actualArrival = pickFirst(best, ['actualArrivalTime','actualArrival','arrivedAt']);
  const flightNo = pickFirst(best, ['flightNo','flightNumber','flight']);

  return {
    mawb: normalizeMawb(pickFirst(best, ['trackingNo','trackNo','mawb','awbNo','waybillNo','trackingNumber']) || fallbackMawb),
    status: status ? String(status) : 'Tracking data received',
    carrierCode: carrierCode ? String(carrierCode) : '',
    origin: origin ? String(origin) : '',
    destination: destination ? String(destination) : '',
    eta: eta || actualArrival || null,
    actualArrival: actualArrival || null,
    flightNo: flightNo ? String(flightNo) : '',
    raw
  };
}

export async function GET() {
  return NextResponse.json({ configured: Boolean(process.env.TRACK123_API_KEY) });
}

export async function POST(request) {
  try {
    const apiKey = process.env.TRACK123_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'TRACK123_API_KEY is not configured in Vercel Environment Variables.' }, { status: 503 });
    }

    const { mawb, carrierCode = '', forceRefresh = false } = await request.json();
    if (!mawb) return NextResponse.json({ error: 'MAWB is required.' }, { status: 400 });
    const trackingNo = normalizeMawb(mawb);

    if (forceRefresh && carrierCode) {
      await postTrack123(REFRESH_URL, apiKey, { trackingNo, carrierCode });
    }

    // Track123 aviation docs accept tracking-number details. This request uses both
    // common field names so the integration remains tolerant across minor schema revisions.
    let result = await postTrack123(QUERY_URL, apiKey, {
      trackNoInfos: [{ trackingNo, trackNo: trackingNo, carrierCode: carrierCode || undefined }]
    });

    if (!result.ok) {
      // Some aviation accounts use a direct list payload.
      const retry = await postTrack123(QUERY_URL, apiKey, [
        { trackingNo, carrierCode: carrierCode || undefined }
      ]);
      if (retry.ok) result = retry;
      else {
        return NextResponse.json({
          error: 'Track123 rejected the live tracking request.',
          track123Status: retry.status,
          details: retry.data
        }, { status: 502 });
      }
    }

    return NextResponse.json({ ok: true, shipment: normalizeResponse(result.data, trackingNo) });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Tracking request failed.' }, { status: 500 });
  }
}
