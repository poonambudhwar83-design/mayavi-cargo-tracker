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
  const digits = String(mawb).replace(/\D/g, '');
  const serial = digits.slice(3);
  const pageHasAwb = text.replace(/\D/g, '').includes(digits) || text.includes(serial);

  const flightNo = firstMatch(text, [
    /(?:Flight(?:\s*No\.?|\s*Number)?|FLT)\s*[:#-]?\s*(EK\s*\d{2,4})/i,
    /\b(EK\s*\d{2,4})\b/i
  ]).replace(/\s+/g, '');

  const origin = firstMatch(text, [
    /(?:Origin|From|Departure\s*Station)\s*[:#-]?\s*([A-Z]{3})\b/i,
    /\b([A-Z]{3})\s*(?:-|→|TO)\s*[A-Z]{3}\b/i
  ]).toUpperCase();

  const destination = firstMatch(text, [
    /(?:Destination|To|Arrival\s*Station)\s*[:#-]?\s*([A-Z]{3})\b/i,
    /\b[A-Z]{3}\s*(?:-|→|TO)\s*([A-Z]{3})\b/i
  ]).toUpperCase();

  const pieces = firstMatch(text, [/(?:Pieces|Piece|Pcs|Pkgs|Packages)\s*[:#-]?\s*(\d{1,6})/i]);
  const weight = firstMatch(text, [/(?:Gross\s*Weight|Weight)\s*[:#-]?\s*([\d,.]+)\s*(?:KG|KGS|KILOGRAMS?)?/i]).replace(/,/g, '');

  const actualArrivalRaw = firstMatch(text, [
    /(?:Actual\s*Arrival(?:\s*Time)?|Arrived(?:\s*At)?|Arrival\s*Actual)\s*[:#-]?\s*([^|]{6,35})/i
  ]);
  const etaRaw = firstMatch(text, [
    /(?:Estimated\s*Arrival(?:\s*Time)?|ETA|Expected\s*Arrival(?:\s*Time)?|Scheduled\s*Arrival(?:\s*Time)?)\s*[:#-]?\s*([^|]{6,35})/i
  ]);
  const status = firstMatch(text, [/(?:Shipment\s*Status|Current\s*Status|Status)\s*[:#-]?\s*([A-Za-z][A-Za-z _-]{2,40})/i]);

  const actualArrival = normalizeDateTime(actualArrivalRaw);
  const eta = actualArrival || normalizeDateTime(etaRaw);
  const useful = pageHasAwb && Boolean(flightNo || origin || destination || pieces || weight || eta || actualArrival || status);

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
    debug: { pageHasAwb, pageTitleHint: text.slice(0, 220) }
  };
}

async function fetchEmirates(mawb) {
  const digits = String(mawb).replace(/\D/g, '');
  if (!digits.startsWith('176') || digits.length !== 11) return { useful: false };
  const serial = digits.slice(3, 11);
  const variants = [
    `${EMIRATES_TRACK_URL}?service=page%2Fnwp%3ATrackshipmt&doc_typ=AWB&awb_pre=176&awb_no=${serial}`,
    `${EMIRATES_TRACK_URL}?initial=y&service=page%2Fnwp%3ATrackshipmt&docPrefix=176&docNumber=${serial}&docType=MAWB`,
    `${EMIRATES_TRACK_URL}?service=page%2Fnwp%3ATrackshipmt&NOTUSERACCEPTEDPAGE=Y&docPrefix=176&docNumber=${serial}&docType=MAWB`,
    `${EMIRATES_TRACK_URL}?service=page%2Fnwp%3ATrackshipmt&documentNo=${digits}&NOTUSERACCEPTEDPAGE=Y`
  ];

  let lastError = '';
  for (const url of variants) {
    try {
      const r = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml'
        },
        cache: 'no-store',
        redirect: 'follow'
      });
      if (!r.ok) { lastError = `Emirates HTTP ${r.status}`; continue; }
      const parsed = parseEmiratesHtml(await r.text(), `${digits.slice(0, 3)}-${serial}`);
      if (parsed.useful) return parsed;
    } catch (e) {
      lastError = e?.message || 'Emirates tracker fetch failed';
    }
  }
  return { useful: false, error: lastError || 'Emirates public tracker did not expose the result to server-side requests.' };
}

function safeFallbackForEmirates(track = {}, mawb = '') {
  return {
    mawb,
    carrierCode: track.carrierCode || 'EK',
    bags: track.bags || '',
    weight: track.weight || '',
    flightNo: track.flightNo || '',
    origin: '',
    destination: '',
    eta: null,
    actualArrival: null,
    status: 'WAITING FOR EMIRATES LIVE DATA',
    source: 'Track123 fallback — ETA/origin not trusted for Emirates'
  };
}

export async function POST(request) {
  const body = await request.json();
  const mawb = body?.mawb || '';
  const digits = String(mawb).replace(/\D/g, '');
  const isEmirates = digits.startsWith('176');

  let emirates = { useful: false };
  if (isEmirates) emirates = await fetchEmirates(mawb);

  const fallbackReq = new Request(request.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const trackResp = await track123POST(fallbackReq);
  let trackData = {};
  try { trackData = await trackResp.json(); } catch {}

  if (isEmirates && emirates.useful) {
    const official = emirates.shipment || {};
    const track = trackData?.shipment || {};
    return Response.json({
      ok: true,
      source: 'Emirates SkyCargo official tracker',
      airlinePrimary: true,
      shipment: {
        mawb: official.mawb || mawb,
        carrierCode: 'EK',
        origin: official.origin || '',
        destination: official.destination || '',
        eta: official.eta || null,
        actualArrival: official.actualArrival || null,
        status: official.status || 'EMIRATES SHIPMENT FOUND',
        flightNo: official.flightNo || track.flightNo || '',
        bags: official.bags || track.bags || '',
        weight: official.weight || track.weight || '',
        source: 'Emirates SkyCargo official tracker'
      },
      airlineDebug: emirates.debug || null
    });
  }

  if (isEmirates) {
    return Response.json({
      ok: true,
      source: 'Emirates official tracker unavailable to server; sanitized fallback',
      airlinePrimary: false,
      airlineError: emirates.error || null,
      shipment: safeFallbackForEmirates(trackData?.shipment || {}, mawb)
    });
  }

  return Response.json(trackData, { status: trackResp.status });
}
