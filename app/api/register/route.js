import { NextResponse } from 'next/server';

const REGISTER_URL = 'https://api.track123.com/gateway/open-api/tk/v2.1/aviation/track/import';
const CARRIERS_URL = 'https://api.track123.com/gateway/open-api/tk/v2.1/aviation/carrier/list';

function normalizeMawb(v = '') {
  const digits = String(v).replace(/\D/g, '');
  return digits.length >= 11 ? `${digits.slice(0, 3)}-${digits.slice(3, 11)}` : String(v).trim();
}

function walk(value, out = []) {
  if (!value || typeof value !== 'object') return out;
  out.push(value);
  if (Array.isArray(value)) value.forEach(v => walk(v, out));
  else Object.values(value).forEach(v => walk(v, out));
  return out;
}

function first(obj, keys) {
  if (!obj || typeof obj !== 'object') return null;
  for (const k of keys) if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
  return null;
}

async function readJson(r) {
  const text = await r.text();
  try { return text ? JSON.parse(text) : {}; } catch { return { raw: text }; }
}

async function getCarrier(apiKey, trackingNo, supplied = '') {
  if (supplied) return { carrierCode: supplied, carrierName: '' };
  const prefix = String(trackingNo).replace(/\D/g, '').slice(0, 3);
  try {
    const r = await fetch(CARRIERS_URL, { headers: { 'Track123-Api-Secret': apiKey, Accept: 'application/json' }, cache: 'no-store' });
    if (!r.ok) return { carrierCode: '', carrierName: '' };
    const data = await readJson(r);
    const nodes = walk(data);
    const hit = nodes.find(n => {
      const p = first(n, ['prefix','awbPrefix','airWaybillPrefix','mawbPrefix','iataPrefix','awbCode']);
      return p && String(p).replace(/\D/g, '').padStart(3, '0') === prefix;
    });
    if (!hit) return { carrierCode: '', carrierName: '' };
    return {
      carrierCode: String(first(hit, ['carrierCode','code','courierCode','slug','carrier']) || ''),
      carrierName: String(first(hit, ['carrierName','name','airlineName','title']) || '')
    };
  } catch {
    return { carrierCode: '', carrierName: '' };
  }
}

function rejectedItems(data) {
  const nodes = walk(data);
  const arrays = [];
  for (const n of nodes) {
    if (Array.isArray(n.rejected)) arrays.push(...n.rejected);
    if (Array.isArray(n.rejecteds)) arrays.push(...n.rejecteds);
    if (Array.isArray(n.failed)) arrays.push(...n.failed);
  }
  return arrays;
}

function acceptedItems(data) {
  const nodes = walk(data);
  const arrays = [];
  for (const n of nodes) {
    if (Array.isArray(n.accepted)) arrays.push(...n.accepted);
    if (Array.isArray(n.accepteds)) arrays.push(...n.accepteds);
    if (Array.isArray(n.successful)) arrays.push(...n.successful);
  }
  return arrays;
}

function reasonFrom(data, fallback = '') {
  const rejected = rejectedItems(data)[0];
  const obj = rejected || data;
  return String(first(obj, ['message','msg','reason','error','errorMessage','remark','description']) || fallback || 'Track123 rejected this MAWB.');
}

async function callTrack123(apiKey, body) {
  const r = await fetch(REGISTER_URL, {
    method: 'POST',
    headers: { 'Track123-Api-Secret': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store'
  });
  return { ok: r.ok, status: r.status, data: await readJson(r) };
}

export async function POST(request) {
  try {
    const apiKey = process.env.TRACK123_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'TRACK123_API_KEY is not configured in Vercel.' }, { status: 503 });

    const { mawb, carrierCode: suppliedCarrier = '' } = await request.json();
    if (!mawb) return NextResponse.json({ error: 'MAWB is required.' }, { status: 400 });

    const trackingNo = normalizeMawb(mawb);
    const detected = await getCarrier(apiKey, trackingNo, suppliedCarrier);
    const item = { trackingNo, ...(detected.carrierCode ? { carrierCode: detected.carrierCode } : {}) };

    let result = await callTrack123(apiKey, [item]);
    if (!result.ok) {
      result = await callTrack123(apiKey, { trackNoInfos: [item] });
    }

    const rejected = rejectedItems(result.data);
    const accepted = acceptedItems(result.data);
    const isRejected = !result.ok || (rejected.length > 0 && accepted.length === 0);

    if (isRejected) {
      return NextResponse.json({
        error: reasonFrom(result.data, `Track123 HTTP ${result.status}`),
        track123Status: result.status,
        carrierCode: detected.carrierCode,
        carrierName: detected.carrierName,
        details: result.data
      }, { status: 502 });
    }

    return NextResponse.json({
      ok: true,
      status: result.status,
      carrierCode: detected.carrierCode,
      carrierName: detected.carrierName,
      details: result.data
    });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Registration failed.' }, { status: 500 });
  }
}
