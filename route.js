import { NextResponse } from 'next/server';

const QUERY_URL = 'https://api.track123.com/gateway/open-api/tk/v2.1/aviation/track/query';
const REFRESH_URL = 'https://api.track123.com/gateway/open-api/tk/v2.1/aviation/track/refresh';

function normalizeMawb(v = '') {
  const digits = String(v).replace(/\D/g, '');
  return digits.length >= 11 ? `${digits.slice(0, 3)}-${digits.slice(3, 11)}` : String(v).trim();
}

async function postTrack123(url, apiKey, body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Track123-Api-Secret': apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify(body),
    cache: 'no-store'
  });

  const text = await r.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  return { ok: r.ok, status: r.status, data };
}

function pickFirst(obj, names) {
  if (!obj || typeof obj !== 'object') return null;
  for (const name of names) {
    const value = obj[name];
    if (value !== undefined && value !== null && value !== '') return value;
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

function responseLooksRejected(data) {
  if (!data || typeof data !== 'object') return false;
  const code = pickFirst(data, ['code', 'statusCode', 'errorCode']);
  const success = pickFirst(data, ['success', 'ok']);
  const message = String(pickFirst(data, ['message', 'msg', 'error', 'errorMessage']) || '').toLowerCase();

  if (success === false) return true;
  if (code !== null && code !== undefined) {
    const s = String(code);
    if (!['0', '200', 'SUCCESS', 'success'].includes(s)) return true;
  }
  return Boolean(message && /(invalid|unauthor|forbidden|quota|reject|error|failed)/i.test(message));
}

function findBestShipment(raw, fallbackMawb) {
  const targetDigits = String(fallbackMawb).replace(/\D/g, '');
  const nodes = walkObjects(raw);

  const exact = nodes.find(n => {
    const t = pickFirst(n, ['trackingNo', 'trackNo', 'mawb', 'awbNo', 'waybillNo', 'trackingNumber']);
    if (!t) return false;
    const digits = String(t).replace(/\D/g, '');
    return digits === targetDigits || (digits.length >= 8 && targetDigits.endsWith(digits.slice(-8)));
  });
  if (exact) return exact;

  return nodes.find(n =>
    pickFirst(n, [
      'status', 'statusName', 'latestStatus', 'trackingStatus', 'state',
      'events', 'checkpoints', 'milestones', 'flightInfo', 'origin', 'destination'
    ])
  ) || raw;
}

function findLatestEvent(raw) {
  const nodes = walkObjects(raw);
  const eventLike = nodes.filter(n => {
    const time = pickFirst(n, ['eventTime', 'time', 'dateTime', 'timestamp', 'actualTime', 'scheduledTime']);
    const status = pickFirst(n, ['eventCode', 'eventDetail', 'status', 'statusName', 'milestone', 'description']);
    return time && status;
  });

  eventLike.sort((a, b) => {
    const ta = new Date(pickFirst(a, ['eventTime', 'time', 'dateTime', 'timestamp', 'actualTime', 'scheduledTime'])).getTime();
    const tb = new Date(pickFirst(b, ['eventTime', 'time', 'dateTime', 'timestamp', 'actualTime', 'scheduledTime'])).getTime();
    return (Number.isNaN(tb) ? 0 : tb) - (Number.isNaN(ta) ? 0 : ta);
  });

  return eventLike[0] || null;
}

function normalizeResponse(raw, fallbackMawb) {
  const best = findBestShipment(raw, fallbackMawb);
  const latestEvent = findLatestEvent(best) || findLatestEvent(raw);

  const status =
    pickFirst(best, ['statusName', 'status', 'latestStatus', 'trackingStatus', 'state', 'transitStatus']) ||
    pickFirst(latestEvent, ['eventDetail', 'statusName', 'status', 'eventCode', 'milestone', 'description']);

  const carrierCode = pickFirst(best, ['carrierCode', 'courierCode', 'carrier', 'airlineCode']);
  const origin = pickFirst(best, ['origin', 'originAirport', 'departureAirport', 'from', 'departure']);
  const destination = pickFirst(best, ['destination', 'destinationAirport', 'arrivalAirport', 'to', 'arrival']);
  const eta = pickFirst(best, [
    'estimatedArrivalTime', 'estimatedArrival', 'eta', 'arrivalTime',
    'scheduledArrivalTime', 'estimatedArrivalDate', 'scheduledArrivalDate'
  ]);
  const actualArrival = pickFirst(best, ['actualArrivalTime', 'actualArrival', 'arrivedAt', 'actualArrivalDate']);
  const flightNo = pickFirst(best, ['flightNo', 'flightNumber', 'flight']);

  const trackNo = pickFirst(best, ['trackingNo', 'trackNo', 'mawb', 'awbNo', 'waybillNo', 'trackingNumber']) || fallbackMawb;

  return {
    mawb: normalizeMawb(trackNo),
    status: status ? String(status) : 'No live milestone returned yet',
    carrierCode: carrierCode ? String(carrierCode) : '',
    origin: origin ? String(origin) : '',
    destination: destination ? String(destination) : '',
    eta: eta || actualArrival || null,
    actualArrival: actualArrival || null,
    flightNo: flightNo ? String(flightNo) : '',
    latestEvent: latestEvent || null,
    raw
  };
}

async function queryTracking(apiKey, trackingNo, carrierCode) {
  const item = { trackingNo };
  if (carrierCode) item.carrierCode = carrierCode;

  // Track123's current aviation docs describe the request body as tracking-number
  // detail objects. Try the direct array first, then compatibility shapes used by
  // older/revised schemas so existing accounts keep working.
  const candidates = [
    [item],
    { trackingNoInfos: [item] },
    { trackNoInfos: [{ trackNo: trackingNo, ...(carrierCode ? { courierCode: carrierCode } : {}) }] },
    { trackNos: [trackingNo] }
  ];

  let last = null;
  for (const body of candidates) {
    const result = await postTrack123(QUERY_URL, apiKey, body);
    last = result;
    if (result.ok && !responseLooksRejected(result.data)) return result;
  }
  return last;
}

export async function GET() {
  return NextResponse.json({ configured: Boolean(process.env.TRACK123_API_KEY) });
}

export async function POST(request) {
  try {
    const apiKey = process.env.TRACK123_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'TRACK123_API_KEY is not configured in Vercel Environment Variables.' },
        { status: 503 }
      );
    }

    const { mawb, carrierCode = '', forceRefresh = false } = await request.json();
    if (!mawb) return NextResponse.json({ error: 'MAWB is required.' }, { status: 400 });

    const trackingNo = normalizeMawb(mawb);

    if (forceRefresh && carrierCode) {
      // Track123 allows air-cargo refresh only when carrierCode is known.
      await postTrack123(REFRESH_URL, apiKey, { trackingNo, carrierCode });
    }

    const result = await queryTracking(apiKey, trackingNo, carrierCode);

    if (!result || !result.ok || responseLooksRejected(result.data)) {
      return NextResponse.json(
        {
          error: 'Track123 rejected the live air-cargo tracking request.',
          track123Status: result?.status || null,
          details: result?.data || null
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ok: true,
      shipment: normalizeResponse(result.data, trackingNo)
    });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Tracking request failed.' }, { status: 500 });
  }
}
