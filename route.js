import { NextResponse } from 'next/server';

const QUERY_URL = 'https://api.track123.com/gateway/open-api/tk/v2.1/aviation/track/query';
const REFRESH_URL = 'https://api.track123.com/gateway/open-api/tk/v2.1/aviation/track/refresh';
const CARRIERS_URL = 'https://api.track123.com/gateway/open-api/tk/v2.1/aviation/carrier/list';
const EMIRATES_TRACK_URL = 'https://scekprd.emirates.com/skychain/app';

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
function eventTime(node) { return pickFirst(node, EVENT_TIME_FIELDS); }
function toDateValue(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') {
    const n = v < 1e12 ? v * 1000 : v;
    const d = new Date(n);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const s = String(v).trim();
  if (/^\d{10,13}$/.test(s)) {
    const n = Number(s.length === 10 ? `${s}000` : s);
    const d = new Date(n);
    if (!Number.isNaN(d.getTime())) return d;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
function validDateValue(v) { return Boolean(toDateValue(v)); }
function combineDateAndTime(dateValue, timeValue) {
  if (!dateValue || !timeValue) return null;
  const ds = String(dateValue).trim();
  const ts = String(timeValue).trim();
  for (const c of [`${ds} ${ts}`, `${ds}T${ts}`]) {
    const d = toDateValue(c);
    if (d) return d.toISOString();
  }
  return null;
}
function siblingArrivalDateTime(node) {
  if (!node || typeof node !== 'object') return null;
  const dateVal = pickFirst(node, ['arrivalDate','estimatedArrivalDate','scheduledArrivalDate','etaDate','flightArrivalDate','arrDate']);
  const timeVal = pickFirst(node, ['arrivalTime','estimatedArrivalTime','scheduledArrivalTime','etaTime','flightArrivalTime','arrTime']);
  return combineDateAndTime(dateVal, timeVal);
}
function findArrivalMilestone(raw) {
  const nodes = walkObjects(raw).filter(n => eventTime(n) && eventLabel(n));
  const arrivalLike = nodes.filter(n => /(^|\W)ARR($|\W)|ARRIVED|ACTUAL ARRIVAL|FLIGHT ARRIVAL|RECEIVED FROM FLIGHT|(^|\W)RCF($|\W)/i.test(eventLabel(n)));
  arrivalLike.sort((a, b) => (toDateValue(eventTime(b))?.getTime() || 0) - (toDateValue(eventTime(a))?.getTime() || 0));
  return arrivalLike[0] || null;
}
function findLatestEvent(raw) {
  const nodes = walkObjects(raw).filter(n => eventTime(n) && eventLabel(n));
  nodes.sort((a,b) => (toDateValue(eventTime(b))?.getTime() || 0) - (toDateValue(eventTime(a))?.getTime() || 0));
  return nodes[0] || null;
}
function findArrivalEstimate(raw, destination = '') {
  const preferred = [
    'estimatedArrivalTime','estimatedArrival','eta','etaDateTime','estimatedArrivalDateTime','flightEstimatedArrivalTime','arrivalEstimatedTime',
    'scheduledArrivalTime','scheduledArrival','scheduledArrivalDateTime','flightScheduledArrivalTime','arrivalScheduledTime',
    'arrivalTime','estimatedArrivalDate','scheduledArrivalDate','plannedArrivalTime','plannedArrival','flightArrivalTime'
  ];
  const now = Date.now();
  const dest = String(destination || '').toUpperCase();
  const candidates = [];
  for (const node of walkObjects(raw)) {
    const nodeDest = String(pickFirst(node, ['destination','destinationAirport','arrivalAirport','to','destinationCode','arrivalCode','airportCode','station']) || '').toUpperCase();
    const destMatch = !dest || !nodeDest || nodeDest === dest;
    for (const key of preferred) {
      if (node[key] !== undefined && node[key] !== null && node[key] !== '') {
        const d = toDateValue(node[key]);
        if (d && destMatch) candidates.push({ value: node[key], time: d.getTime(), score: 5 });
      }
    }
    const combined = siblingArrivalDateTime(node);
    if (combined && destMatch) {
      const d = toDateValue(combined);
      if (d) candidates.push({ value: combined, time: d.getTime(), score: 6 });
    }
    for (const [key, value] of Object.entries(node)) {
      const k = key.toLowerCase();
      if (!/(arrival|arrive|eta)/.test(k) || /(departure|origin)/.test(k)) continue;
      const d = toDateValue(value);
      if (d && destMatch) candidates.push({ value, time: d.getTime(), score: /(estimated|schedule|planned|eta)/.test(k) ? 7 : 3 });
    }
    const label = eventLabel(node);
    const t = eventTime(node);
    if (t && /ARRIVAL|ARRIVED|(^|\W)ARR($|\W)/i.test(label) && destMatch) {
      const d = toDateValue(t);
      if (d) candidates.push({ value: t, time: d.getTime(), score: /ESTIMAT|SCHEDUL|PLANNED/.test(label) ? 8 : 2 });
    }
  }
  if (!candidates.length) return null;
  candidates.sort((a,b) => {
    const af = a.time >= now - 6 * 3600000 ? 1 : 0;
    const bf = b.time >= now - 6 * 3600000 ? 1 : 0;
    if (af !== bf) return bf - af;
    if (a.score !== b.score) return b.score - a.score;
    return Math.abs(a.time - now) - Math.abs(b.time - now);
  });
  return candidates[0].value || null;
}
function normalizeResponse(raw, fallbackMawb, detectedCarrier='') {
  const best = findBestShipment(raw, fallbackMawb);
  const latest = findLatestEvent(best) || findLatestEvent(raw);
  const arrivalEvent = findArrivalMilestone(best) || findArrivalMilestone(raw);
  const summaryStatus = pickFirst(best, ['aviationStatus','statusName','status','latestStatus','trackingStatus','state']) || pickFirst(latest, ['status','statusName','eventDetail','eventCode','description']);
  const origin = String(firstAnywhere(best, ['origin','originAirport','departureAirport','from','departure','originCode','departureCode']) || firstAnywhere(raw, ['origin','originAirport','departureAirport','from','departure','originCode','departureCode']) || '');
  const destination = String(firstAnywhere(best, ['destination','destinationAirport','arrivalAirport','to','arrival','destinationCode','arrivalCode']) || firstAnywhere(raw, ['destination','destinationAirport','arrivalAirport','to','arrival','destinationCode','arrivalCode']) || '');
  const actualArrivalDirect = firstAnywhere(best, ['actualArrivalTime','actualArrival','arrivedAt','actualArrivalDate','flightActualArrivalTime','arrivalActualTime']) || firstAnywhere(raw, ['actualArrivalTime','actualArrival','arrivedAt','actualArrivalDate','flightActualArrivalTime','arrivalActualTime']);
  const actualArrival = validDateValue(actualArrivalDirect) ? actualArrivalDirect : (arrivalEvent && validDateValue(eventTime(arrivalEvent)) ? eventTime(arrivalEvent) : null);
  const eta = actualArrival || findArrivalEstimate(best, destination) || findArrivalEstimate(raw, destination) || null;
  const status = actualArrival || arrivalEvent ? 'ARRIVED' : (summaryStatus ? String(summaryStatus) : 'Tracking record found');
  return {
    mawb: normalizeMawb(pickFirst(best, ['trackingNo','trackNo','mawb','awbNo','waybillNo','trackingNumber']) || fallbackMawb),
    status,
    carrierCode: String(firstAnywhere(best, ['carrierCode','courierCode','carrier','airlineCode']) || detectedCarrier || ''),
    origin,
    destination,
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

function stripHtml(html='') {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi,' ')
    .replace(/<style[\s\S]*?<\/style>/gi,' ')
    .replace(/<[^>]+>/g,' ')
    .replace(/&nbsp;/gi,' ')
    .replace(/&amp;/gi,'&')
    .replace(/&#39;/g,"'")
    .replace(/&quot;/g,'"')
    .replace(/\s+/g,' ')
    .trim();
}
function findAirport(text, labels) {
  for (const label of labels) {
    const re = new RegExp(`${label}\\s*[:\\-]?\\s*([A-Z]{3})`, 'i');
    const m = text.match(re);
    if (m) return m[1].toUpperCase();
  }
  return '';
}
function parseEmiratesHtml(html, trackingNo) {
  const text = stripHtml(html);
  const digits = trackingNo.replace(/\D/g,'');
  const suffix = digits.slice(3);
  if (!text.includes(digits) && !text.includes(`176-${suffix}`) && !text.includes(suffix)) return null;

  const etaPatterns = [
    /(?:estimated\s+arrival|eta|scheduled\s+arrival|arrival\s+date\/time)\s*[:\-]?\s*([0-3]?\d[\/-][0-1]?\d[\/-]\d{2,4}[ ,T]+[0-2]?\d[:.]\d{2}(?:\s*[AP]M)?)/i,
    /(?:estimated\s+arrival|eta|scheduled\s+arrival)\s*[:\-]?\s*([A-Za-z]{3,9}\s+[0-3]?\d,?\s+\d{4}\s+[0-2]?\d:\d{2}(?:\s*[AP]M)?)/i,
    /(?:estimated\s+arrival|eta|scheduled\s+arrival)\s*[:\-]?\s*(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2})/i
  ];
  let eta = null;
  for (const re of etaPatterns) {
    const m = text.match(re);
    if (m && toDateValue(m[1])) { eta = toDateValue(m[1]).toISOString(); break; }
  }

  const actualPatterns = [
    /(?:actual\s+arrival|arrived(?:\s+at)?|flight\s+arrived)\s*[:\-]?\s*([0-3]?\d[\/-][0-1]?\d[\/-]\d{2,4}[ ,T]+[0-2]?\d[:.]\d{2}(?:\s*[AP]M)?)/i,
    /(?:actual\s+arrival|arrived(?:\s+at)?|flight\s+arrived)\s*[:\-]?\s*(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2})/i
  ];
  let actualArrival = null;
  for (const re of actualPatterns) {
    const m = text.match(re);
    if (m && toDateValue(m[1])) { actualArrival = toDateValue(m[1]).toISOString(); break; }
  }

  const flight = (text.match(/\bEK\s?\d{2,4}\b/i)?.[0] || '').replace(/\s+/g,'').toUpperCase();
  const pieces = text.match(/(?:pieces?|pcs?)\s*[:\-]?\s*(\d{1,5})/i)?.[1] || text.match(/(\d{1,5})\s*(?:pieces?|pcs?)\b/i)?.[1] || '';
  const weight = text.match(/(?:gross\s+weight|weight)\s*[:\-]?\s*([\d,.]+)\s*kg/i)?.[1]?.replace(/,/g,'') || '';
  const origin = findAirport(text, ['origin','from','departure']);
  const destination = findAirport(text, ['destination','to','arrival station']);
  const arrived = /\bARRIVED\b|\bRCF\b|actual\s+arrival/i.test(text) || Boolean(actualArrival);
  const inTransit = /\bIN\s*TRANSIT\b|\bDEPARTED\b|\bDEP\b/i.test(text);
  const status = arrived ? 'ARRIVED' : (inTransit ? 'IN_TRANSIT' : '');

  if (!eta && !actualArrival && !flight && !pieces && !weight && !status) return null;
  return { source:'Emirates SkyCargo', mawb:trackingNo, eta:actualArrival || eta, actualArrival, flightNo:flight, bags:pieces, weight, origin, destination, status, rawText:text.slice(0,12000) };
}
async function fetchEmirates(trackingNo) {
  const digits = trackingNo.replace(/\D/g,'');
  if (!digits.startsWith('176') || digits.length !== 11) return null;
  const suffix = digits.slice(3);
  const variants = [
    `${EMIRATES_TRACK_URL}?service=page%2Fnwp%3ATrackshipmt&NOTUSERACCEPTEDPAGE=Y&docPrefix=176&docNumber=${suffix}&docType=MAWB`,
    `${EMIRATES_TRACK_URL}?initial=y&service=page%2Fnwp%3ATrackshipmt&docPrefix=176&docNumber=${suffix}&docType=MAWB`,
    `${EMIRATES_TRACK_URL}?service=page%2Fnwp%3ATrackshipmt&documentNo=${digits}&NOTUSERACCEPTEDPAGE=Y`
  ];
  for (const url of variants) {
    try {
      const r = await fetch(url, { headers:{ 'User-Agent':'Mozilla/5.0', Accept:'text/html,application/xhtml+xml' }, cache:'no-store', redirect:'follow' });
      if (!r.ok) continue;
      const parsed = parseEmiratesHtml(await r.text(), trackingNo);
      if (parsed) return parsed;
    } catch {}
  }
  return null;
}
function usefulStatus(s='') {
  const t = String(s).toUpperCase().trim();
  if (!t || t.length > 60) return '';
  if (/ARRIVED|IN_TRANSIT|IN TRANSIT|DEPARTED|BOOKED|RECEIVED|RCF|NFD|DELIVERED|MANIFESTED|ACCEPTED|PENDING|NOTIFIED|DELAY/.test(t)) return t;
  return '';
}

export async function GET() {
  return NextResponse.json({ configured: Boolean(process.env.TRACK123_API_KEY) });
}

export async function POST(request) {
  try {
    const apiKey = process.env.TRACK123_API_KEY;
    const { mawb, carrierCode: suppliedCarrier = '', forceRefresh = false } = await request.json();
    if (!mawb) return NextResponse.json({ error: 'MAWB is required.' }, { status: 400 });
    const trackingNo = normalizeMawb(mawb);
    const prefix = trackingNo.replace(/\D/g,'').slice(0,3);

    let direct = null;
    if (prefix === '176') direct = await fetchEmirates(trackingNo);

    let track123 = null;
    let carrierCode = suppliedCarrier;
    if (apiKey) {
      carrierCode = await detectCarrier(apiKey, trackingNo, suppliedCarrier);
      if (forceRefresh && carrierCode) await postTrack123(REFRESH_URL, apiKey, { trackingNo, carrierCode });
      const item = { trackingNo, ...(carrierCode ? { carrierCode } : {}) };
      let result = await postTrack123(QUERY_URL, apiKey, [item]);
      if (!result.ok) result = await postTrack123(QUERY_URL, apiKey, { trackNoInfos: [item] });
      if (result.ok) track123 = normalizeResponse(result.data, trackingNo, carrierCode);
    }

    if (direct) {
      return NextResponse.json({
        ok:true,
        carrierCode: carrierCode || 'EK',
        source:'Emirates SkyCargo',
        shipment:{
          mawb:trackingNo,
          status: direct.status || usefulStatus(track123?.status) || 'Tracking record found',
          carrierCode: carrierCode || 'EK',
          origin: direct.origin || '',
          destination: direct.destination || '',
          eta: direct.eta || track123?.eta || null,
          actualArrival: direct.actualArrival || track123?.actualArrival || null,
          flightNo: direct.flightNo || track123?.flightNo || '',
          bags: direct.bags || track123?.bags || '',
          weight: direct.weight || track123?.weight || '',
          source:'Emirates SkyCargo',
          direct,
          rawTrack123:track123?.raw || null
        }
      });
    }

    if (track123) {
      const safeTrack123 = prefix === '176' ? {
        ...track123,
        origin:'',
        destination:'',
        status: usefulStatus(track123.status) || 'Tracking record found',
        source:'Track123 fallback'
      } : { ...track123, source:'Track123' };
      return NextResponse.json({ ok:true, carrierCode, source:safeTrack123.source, shipment:safeTrack123 });
    }

    return NextResponse.json({ error: prefix === '176' ? 'Emirates SkyCargo did not expose machine-readable shipment details, and Track123 fallback was unavailable.' : 'No live tracking source returned shipment details.' }, { status:502 });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Tracking request failed.' }, { status: 500 });
  }
}
