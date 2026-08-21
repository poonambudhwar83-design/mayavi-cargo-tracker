import { GET as track123GET, POST as track123POST } from '../../../route';

export const GET = track123GET;

const EMIRATES_TRACK_URL = 'https://scekprd.emirates.com/skychain/app';

function cleanText(html = '') {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstMatch(text, patterns) {
  for (const p of patterns) {
    const m = text.match(p);
    if (m && m[1]) return m[1].trim();
  }
  return '';
}

function normalizeDateTime(value = '') {
  const v = String(value).trim();
  if (!v) return null;

  const native = new Date(v);
  if (!Number.isNaN(native.getTime())) return native.toISOString();

  const m = v.match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})[^\d]?(\d{1,2})[:.](\d{2})(?:\s*(AM|PM))?/i);
  if (!m) return null;
  let [, dd, mm, yy, hh, min, ap] = m;
  let year = Number(yy);
  if (year < 100) year += 2000;
  let hour = Number(hh);
  if (ap) {
    const upper = ap.toUpperCase();
    if (upper === 'PM' && hour < 12) hour += 12;
    if (upper === 'AM' && hour === 12) hour = 0;
  }
  const d = new Date(Date.UTC(year, Number(mm) - 1, Number(dd), hour, Number(min)));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function parseEmiratesHtml(html, mawb) {
  const text = cleanText(html);
  const flightNo = firstMatch(text, [
    /(?:Flight(?:\s*No\.?|\s*Number)?|FLT)\s*[:#-]?\s*(EK\s*\d{2,4})/i,
    /\b(EK\s*\d{2,4})\b/i
  ]).replace(/\s+/g, '');

  const origin = firstMatch(text, [
    /(?:Origin|From)\s*[:#-]?\s*([A-Z]{3})\b/i,
    /\b([A-Z]{3})\s*(?:-|→|TO)\s*[A-Z]{3}\b/i
  ]).toUpperCase();

  const destination = firstMatch(text, [
    /(?:Destination|To)\s*[:#-]?\s*([A-Z]{3})\b/i,
    /\b[A-Z]{3}\s*(?:-|→|TO)\s*([A-Z]{3})\b/i
  ]).toUpperCase();

  const pieces = firstMatch(text, [
    /(?:Pieces|Piece|Pcs|Pkgs|Packages)\s*[:#-]?\s*(\d{1,6})/i
  ]);

  const weight = firstMatch(text, [
    /(?:Gross\s*Weight|Weight)\s*[:#-]?\s*([\d,.]+)\s*(?:KG|KGS|KILOGRAMS?)?/i
  ]).replace(/,/g, '');

  const actualArrivalRaw = firstMatch(text, [
    /(?:Actual\s*Arrival|Arrived(?:\s*At)?|Arrival\s*Actual)\s*[:#-]?\s*([^|]{6,35})/i
  ]);

  const etaRaw = firstMatch(text, [
    /(?:Estimated\s*Arrival(?:\s*Time)?|ETA|Expected\s*Arrival(?:\s*Time)?|Scheduled\s*Arrival(?:\s*Time)?)\s*[:#-]?\s*([^|]{6,35})/i
  ]);

  const status = firstMatch(text, [
    /(?:Shipment\s*Status|Current\s*Status|Status)\s*[:#-]?\s*([A-Za-z][A-Za-z _-]{2,40})/i
  ]);

  const actualArrival = normalizeDateTime(actualArrivalRaw);
  const eta = actualArrival || normalizeDateTime(etaRaw);

  const useful = Boolean(flightNo || origin || destination || pieces || weight || eta || status);

  return {
    useful,
    shipment: {
      mawb,
      status: actualArrival ? 'ARRIVED' : status,
      carrierCode: 'EK',
      origin,
      destination,
      eta,
      actualArrival,
      flightNo,
      bags: pieces,
      weight,
      source: 'Emirates SkyCargo official tracker'
    },
    debug: {
      pageHasMawb: text.replace(/\D/g, '').includes(String(mawb).replace(/\D/g, '')),
      pageTitleHint: text.slice(0, 180)
    }
  };
}

async function fetchEmirates(mawb) {
  const digits = String(mawb).replace(/\D/g, '');
  if (!digits.startsWith('176') || digits.length < 11) return { useful: false };
  const serial = digits.slice(3, 11);

  const url = new URL(EMIRATES_TRACK_URL);
  url.searchParams.set('service', 'page/nwp:Trackshipmt');
  url.searchParams.set('doc_typ', 'AWB');
  url.searchParams.set('awb_pre', '176');
  url.searchParams.set('awb_no', serial);

  try {
    const r = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MayaviCargo/1.0)',
        Accept: 'text/html,application/xhtml+xml'
      },
      cache: 'no-store',
      redirect: 'follow'
    });
    if (!r.ok) return { useful: false, error: `Emirates HTTP ${r.status}` };
    const html = await r.text();
    return parseEmiratesHtml(html, `${digits.slice(0, 3)}-${serial}`);
  } catch (e) {
    return { useful: false, error: e?.message || 'Emirates tracker fetch failed' };
  }
}

function mergeShipment(fallback = {}, primary = {}) {
  const out = { ...fallback };
  for (const [k, v] of Object.entries(primary || {})) {
    if (v !== undefined && v !== null && v !== '') out[k] = v;
  }
  return out;
}

export async function POST(request) {
  const body = await request.json();
  const mawb = body?.mawb || '';
  const digits = String(mawb).replace(/\D/g, '');

  let emirates = { useful: false };
  if (digits.startsWith('176')) emirates = await fetchEmirates(mawb);

  const fallbackReq = new Request(request.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const trackResp = await track123POST(fallbackReq);
  let trackData = {};
  try { trackData = await trackResp.json(); } catch {}

  if (emirates.useful) {
    const merged = mergeShipment(trackData?.shipment || {}, emirates.shipment || {});
    return Response.json({
      ok: true,
      source: 'Emirates SkyCargo official tracker first; Track123 fallback',
      shipment: merged,
      airlinePrimary: true,
      airlineDebug: emirates.debug || null
    });
  }

  if (trackResp.ok) {
    return Response.json({
      ...trackData,
      source: digits.startsWith('176')
        ? 'Track123 fallback (Emirates official tracker returned no machine-readable shipment details)'
        : (trackData?.source || 'Track123'),
      airlinePrimary: false,
      airlineError: emirates.error || null
    }, { status: trackResp.status });
  }

  return Response.json(trackData, { status: trackResp.status });
}
