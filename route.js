import { NextResponse } from 'next/server';

const QUERY_URL = 'https://api.track123.com/gateway/open-api/tk/v2.1/aviation/track/query';
const REFRESH_URL = 'https://api.track123.com/gateway/open-api/tk/v2.1/aviation/track/refresh';
const CARRIERS_URL = 'https://api.track123.com/gateway/open-api/tk/v2.1/aviation/carrier/list';

function normalizeMawb(v = '') {
  const digits = String(v).replace(/\D/g, '');
  return digits.length >= 11 ? `${digits.slice(0, 3)}-${digits.slice(3, 11)}` : String(v).trim();
}
function pickFirst(obj, names) {
  if (!obj || typeof obj !== 'object') return null;
  for (const n of names) if (obj[n] !== undefined && obj[n] !== null && obj[n] !== '') return obj[n];
  return null;
}
function walkObjects(value, out = []) {
  if (!value || typeof value !== 'object') return out;
  out.push(value);
  if (Array.isArray(value)) value.forEach(v => walkObjects(v, out));
  else Object.values(value).forEach(v => walkObjects(v, out));
  return out;
}
function firstAnywhere(raw, names) {
  for (const node of walkObjects(raw)) {
    const v = pickFirst(node, names);
    if (v !== null && v !== undefined && v !== '') return v;
  }
  return null;
}
async function readJson(r) {
  const text = await r.text();
  try { return text ? JSON.parse(text) : {}; } catch { return { raw: text }; }
}
async function postTrack123(url, apiKey, body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Track123-Api-Secret': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body), cache: 'no-store'
  });
  return { ok: r.ok, status: r.status, data: await readJson(r) };
}
async function detectCarrier(apiKey, trackingNo, supplied = '') {
  if (supplied) return supplied;
  const prefix = String(trackingNo).replace(/\D/g, '').slice(0, 3);
  try {
    const r = await fetch(CARRIERS_URL, { headers: { 'Track123-Api-Secret': apiKey, Accept: 'application/json' }, cache: 'no-store' });
    if (!r.ok) return '';
    const data = await readJson(r);
    const hit = walkObjects(data).find(n => {
      const p = pickFirst(n, ['prefix','awbPrefix','airWaybillPrefix','mawbPrefix','iataPrefix','awbCode']);
      return p && String(p).replace(/\D/g, '').padStart(3, '0') === prefix;
    });
    return hit ? String(pickFirst(hit, ['carrierCode','code','courierCode','slug','carrier']) || '') : '';
  } catch { return ''; }
}
function rejectionReason(data, fallback = '') {
  const nodes = walkObjects(data);
  const rejected = nodes.find(n => Array.isArray(n.rejected) && n.rejected.length)?.rejected?.[0] ||
    nodes.find(n => Array.isArray(n.rejecteds) && n.rejecteds.length)?.rejecteds?.[0] || null;
  return String(pickFirst(rejected || data, ['message','msg','reason','error','errorMessage','remark','description']) || fallback || 'Track123 rejected the live air-cargo tracking request.');
}
function findBestShipment(raw, fallbackMawb) {
  const targetDigits = String(fallbackMawb).replace(/\D/g, '');
  const nodes = walkObjects(raw);
  return nodes.find(n => {
    const t = pickFirst(n, ['trackingNo','trackNo','mawb','awbNo','waybillNo','trackingNumber']);
    return t && String(t).replace(/\D/g, '') === targetDigits;
  }) || nodes.find(n => pickFirst(n, ['aviationStatus','status','events','flightInfo','origin','destination'])) || raw;
}

const EVENT_TIME_FIELDS = [
  'actualTime','actualDateTime','eventTime','eventDateTime','dateTime','timestamp','time','occurredAt',
  'actualArrivalTime','arrivalActualTime','flightActualArrivalTime',
  'estimatedTime','estimatedDateTime','estimatedArrivalTime','flightEstimatedArrivalTime',
  'scheduledTime','scheduledDateTime','scheduledArrivalTime','flightScheduledArrivalTime'
];
const EVENT_LABEL_FIELDS = [
  'eventCode','milestoneCode','code','eventDetail','eventName','milestone','statusName','status','description','remark','activity'
];

function eventLabel(node) {
  return EVENT_LABEL_FIELDS.map(k => node && node[k] != null ? String(node[k]) : '').filter(Boolean).join(' ').toUpperCase();
}
function eventTime(node) {
  return pickFirst(node, EVENT_TIME_FIELDS);
}
function validDateValue(v) {
  if (!v) return false;
  const d = new Date(v);
  return !Number.isNaN(d.getTime());
}
function findArrivalMilestone(raw) {
  const nodes = walkObjects(raw).filter(n => eventTime(n) && eventLabel(n));
  const arrivalLike = nodes.filter(n => {
    const label = eventLabel(n);
    return /(^|\W)ARR($|\W)|ARRIVED|ACTUAL ARRIVAL|FLIGHT ARRIVAL|RECEIVED FROM FLIGHT|(^|\W)RCF($|\W)/i.test(label);
  });
  arrivalLike.sort((a, b) => {
    const ta = new Date(eventTime(a)).getTime();
    const tb = new Date(eventTime(b)).getTime();
    return (Number.isNaN(tb) ? 0 : tb) - (Number.isNaN(ta) ? 0 : ta);
  });
  return arrivalLike[0] || null;
}
function findLatestEvent(raw) {
  const nodes = walkObjects(raw).filter(n => eventTime(n) && eventLabel(n));
  nodes.sort((a,b) => {
    const ta = new Date(eventTime(a)).getTime();
    const tb = new Date(eventTime(b)).getTime();
    return (Number.isNaN(tb) ? 0 : tb) - (Number.isNaN(ta) ? 0 : ta);
  });
  return nodes[0] || null;
}
function findArrivalEstimate(raw) {
  const preferred = [
    'estimatedArrivalTime','estimatedArrival','eta','flightEstimatedArrivalTime','arrivalEstimatedTime',
    'scheduledArrivalTime','scheduledArrival','flightScheduledArrivalTime','arrivalScheduledTime',
    'arrivalTime','estimatedArrivalDate','scheduledArrivalDate'
  ];
  const direct = firstAnywhere(raw, preferred);
  if (validDateValue(direct)) return direct;

  const candidates = walkObjects(raw).filter(n => {
    const label = eventLabel(n);
    const t = eventTime(n);
    return t && /ARRIVAL|ARRIVED|(^|\W)ARR($|\W)/i.test(label);
  });
  const timed = candidates.map(n => eventTime(n)).filter(validDateValue);
  timed.sort((a,b) => new Date(a).getTime() - new Date(b).getTime());
  return timed[0] || null;
}
function normalizeResponse(raw, fallbackMawb, detectedCarrier='') {
  const best = findBestShipment(raw, fallbackMawb);
  const latest = findLatestEvent(best) || findLatestEvent(raw);
  const arrivalEvent = findArrivalMilestone(best) || findArrivalMilestone(raw);

  const summaryStatus = pickFirst(best, ['aviationStatus','statusName','status','latestStatus','trackingStatus','state']) ||
    pickFirst(latest, ['status','statusName','eventDetail','eventCode','description']);

  const actualArrivalDirect = firstAnywhere(best, [
    'actualArrivalTime','actualArrival','arrivedAt','actualArrivalDate','flightActualArrivalTime','arrivalActualTime'
  ]) || firstAnywhere(raw, [
    'actualArrivalTime','actualArrival','arrivedAt','actualArrivalDate','flightActualArrivalTime','arrivalActualTime'
  ]);
  const actualArrival = validDateValue(actualArrivalDirect) ? actualArrivalDirect : (arrivalEvent && validDateValue(eventTime(arrivalEvent)) ? eventTime(arrivalEvent) : null);
  const eta = actualArrival || findArrivalEstimate(best) || findArrivalEstimate(raw) || null;

  const status = actualArrival || arrivalEvent ? 'ARRIVED' : (summaryStatus ? String(summaryStatus) : 'Tracking record found');

  return {
    mawb: normalizeMawb(pickFirst(best, ['trackingNo','trackNo','mawb','awbNo','waybillNo','trackingNumber']) || fallbackMawb),
    status,
    carrierCode: String(firstAnywhere(best, ['carrierCode','courierCode','carrier','airlineCode']) || detectedCarrier || ''),
    origin: String(firstAnywhere(best, ['origin','originAirport','departureAirport','from','departure','originCode','departureCode']) || firstAnywhere(raw, ['origin','originAirport','departureAirport','from','departure','originCode','departureCode']) || ''),
    destination: String(firstAnywhere(best, ['destination','destinationAirport','arrivalAirport','to','arrival','destinationCode','arrivalCode']) || firstAnywhere(raw, ['destination','destinationAirport','arrivalAirport','to','arrival','destinationCode','arrivalCode']) || ''),
    eta,
    actualArrival: actualArrival || null,
    flightNo: String(firstAnywhere(best, ['flightNo','flightNumber','flight','flightCode']) || firstAnywhere(raw, ['flightNo','flightNumber','flight','flightCode']) || ''),
    bags: firstAnywhere(best, ['pieces','pieceCount','piecesCount','pcs','bags','bagCount']) || firstAnywhere(raw, ['pieces','pieceCount','piecesCount','pcs','bags','bagCount']) || '',
    weight: firstAnywhere(best, ['weight','grossWeight','totalWeight','chargeableWeight']) || firstAnywhere(raw, ['weight','grossWeight','totalWeight','chargeableWeight']) || '',
    latestEvent: latest,
    arrivalEvent,
    raw
  };
}

export async function GET() {
  return NextResponse.json({ configured: Boolean(process.env.TRACK123_API_KEY) });
}

export async function POST(request) {
  try {
    const apiKey = process.env.TRACK123_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'TRACK123_API_KEY is not configured in Vercel Environment Variables.' }, { status: 503 });
    const { mawb, carrierCode: suppliedCarrier = '', forceRefresh = false } = await request.json();
    if (!mawb) return NextResponse.json({ error: 'MAWB is required.' }, { status: 400 });

    const trackingNo = normalizeMawb(mawb);
    const carrierCode = await detectCarrier(apiKey, trackingNo, suppliedCarrier);

    if (forceRefresh && carrierCode) await postTrack123(REFRESH_URL, apiKey, { trackingNo, carrierCode });

    const item = { trackingNo, ...(carrierCode ? { carrierCode } : {}) };
    let result = await postTrack123(QUERY_URL, apiKey, [item]);
    if (!result.ok) result = await postTrack123(QUERY_URL, apiKey, { trackNoInfos: [item] });

    if (!result.ok) {
      return NextResponse.json({
        error: rejectionReason(result.data, `Track123 HTTP ${result.status}`),
        track123Status: result.status,
        carrierCode,
        details: result.data
      }, { status: 502 });
    }

    return NextResponse.json({ ok: true, carrierCode, shipment: normalizeResponse(result.data, trackingNo, carrierCode) });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Tracking request failed.' }, { status: 500 });
  }
}
