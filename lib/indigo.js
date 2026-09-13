import { normalizeMawb } from './airlines.js';

const URL = 'https://6ecargo.goindigo.in/FrmAWBTracking.aspx';
const pad = v => String(v).padStart(2, '0');

function decode(s = '') {
  return String(s)
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function clean(html = '') {
  return decode(String(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:td|th|tr|div|p|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

function rows(html = '') {
  return [...String(html).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map(m => clean(m[1]).replace(/\n+/g, ' | '))
    .filter(Boolean);
}

function dmyPairs(s = '') {
  const out = [];
  for (const m of String(s).matchAll(/(\d{1,2})[\/-](\d{1,2})[\/-](20\d{2})[\s,T]+([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?/g)) {
    out.push({
      date: `${m[3]}-${pad(m[2])}-${pad(m[1])}`,
      time: `${pad(m[4])}:${m[5]}`,
      stamp: `${m[3]}${pad(m[2])}${pad(m[1])}${pad(m[4])}${m[5]}${m[6] || '00'}`
    });
  }
  return out;
}

function parseIndigoTracking(html = '', mawb = '') {
  const text = clean(html);
  const upper = text.toUpperCase();
  const serial = String(mawb).replace(/\D/g, '').slice(3);
  const tableRows = rows(html);

  const route = upper.match(new RegExp(`AWB\\s*:?\\s*312[- ]?${serial}\\s*\\(\\s*([A-Z]{3})\\s*[-–—>]\\s*([A-Z]{3})\\s*\\)`))
    || upper.match(/AWB\s*:?\s*312[- ]?\d{8}[\s\S]{0,120}?\b([A-Z]{3})\s*[-–—>]\s*([A-Z]{3})\b/);

  let origin = route?.[1] || '';
  let destination = route?.[2] || '';

  if (!origin || !destination) {
    const od = upper.match(/\bORIGIN\b[\s:|-]*([A-Z]{3})[\s\S]{0,120}?\bDEST(?:INATION)?\b[\s:|-]*([A-Z]{3})/);
    if (od) {
      origin = origin || od[1];
      destination = destination || od[2];
    }
  }

  const awbAt = upper.search(new RegExp(`AWB\\s*:?\\s*312[- ]?${serial}`));
  const summary = awbAt >= 0 ? text.slice(awbAt, awbAt + 1200) : text.slice(0, 2600);
  const total = summary.match(/\b(\d{1,5})\s*(?:P|PCS|PIECES?)\s*\/\s*([\d,.]+)\s*(?:KG|KGS)\b/i)
    || summary.match(/\b(\d{1,5})\s*(?:P|PCS|PIECES?)\b[\s\S]{0,80}?\b([\d,.]+)\s*(?:KG|KGS)\b/i);

  const pieces = total?.[1] || '';
  const weight = (total?.[2] || '').replace(/,/g, '');
  const fm = upper.match(/\b(6E\s*0*\d{1,4})\b/);
  const flightNo = fm ? fm[1].replace(/\s+/g, '') : '';
  const dest = destination.toUpperCase();

  const arrivalRows = tableRows
    .filter(r => /\bARRIVED\b|RECEIVED FROM.*FLIGHT/i.test(r))
    .filter(r => !dest || new RegExp(`\\b${dest}\\b`, 'i').test(r));

  let best = null;
  let bestRow = '';
  for (const row of arrivalRows) {
    for (const p of dmyPairs(row)) {
      if (!best || p.stamp > best.stamp) {
        best = p;
        bestRow = row;
      }
    }
  }

  if (!best && dest) {
    const at = upper.lastIndexOf(`ARRIVED AT ${dest}`);
    if (at >= 0) {
      const window = text.slice(Math.max(0, at - 600), at + 700);
      for (const p of dmyPairs(window)) if (!best || p.stamp > best.stamp) best = p;
      bestRow = window;
    }
  }

  const lastActivityArrived = dest
    ? new RegExp(`(?:LAST\\s+ACTIVITY[\\s\\S]{0,240}?)?ARRIVED\\s+AT\\s+${dest}\\b`, 'i').test(text)
    : false;

  const arrivalDate = best?.date || '';
  const arrivalTime = best?.time || '';
  const arrivalIsActual = Boolean(best && (arrivalRows.length || lastActivityArrived));

  let status = 'TRACKING';
  if (arrivalIsActual || (lastActivityArrived && arrivalRows.length)) status = 'ARRIVED';
  else if (/\bDEPARTED\b|\bIN TRANSIT\b/i.test(text)) status = 'IN TRANSIT';
  else if (/\bBOOKED\b|\bACCEPTED\b|\bMANIFESTED\b/i.test(text)) status = 'BOOKED';

  return {
    mawb,
    carrierCode: '6E',
    airlineName: 'IndiGo CarGo',
    origin,
    destination,
    bags: pieces,
    pieces,
    weight,
    flightNo,
    arrivalDate,
    arrivalTime,
    arrivalIsActual,
    status,
    officialTracker: URL,
    source: 'IndiGo CarGo official SmartKargo tracker',
    arrivalTimeSource: arrivalIsActual ? 'IndiGo final-destination Arrived event' : '',
    _debug: {
      textSample: text.slice(0, 6000),
      arrivalRows: arrivalRows.slice(-8),
      arrivalEvidence: bestRow.slice(0, 1200)
    }
  };
}

function useful(s = {}) {
  return Boolean(
    (s.origin && s.destination) ||
    s.pieces || s.weight || s.flightNo ||
    s.arrivalDate || s.arrivalTime ||
    (s.status && s.status !== 'TRACKING')
  );
}

function headers(extra = {}) {
  return {
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
    'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'accept-language': 'en-US,en;q=0.9',
    'cache-control': 'no-cache',
    'pragma': 'no-cache',
    ...extra
  };
}

function attr(tag, name) {
  const m = String(tag).match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return decode(m?.[1] ?? m?.[2] ?? m?.[3] ?? '');
}

function inputs(html = '') {
  const list = [...String(html).matchAll(/<input\b[^>]*>/gi)].map(m => {
    const tag = m[0];
    return {
      name: attr(tag, 'name'),
      id: attr(tag, 'id'),
      type: (attr(tag, 'type') || 'text').toLowerCase(),
      value: attr(tag, 'value'),
      placeholder: attr(tag, 'placeholder')
    };
  });
  for (const m of String(html).matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/gi)) {
    const tag = `<textarea ${m[1]}>`;
    list.push({ name: attr(tag, 'name'), id: attr(tag, 'id'), type: 'textarea', value: decode(m[2] || ''), placeholder: attr(tag, 'placeholder') });
  }
  return list;
}

function cookieHeader(response) {
  try {
    const xs = response.headers.getSetCookie?.();
    if (xs?.length) return xs.map(x => x.split(';')[0]).join('; ');
  } catch {}
  return (response.headers.get('set-cookie') || '')
    .split(/,(?=[^;,]+=)/)
    .map(x => x.split(';')[0])
    .filter(Boolean)
    .join('; ');
}

async function queryParamTracking(mawb, serial) {
  const queryUrl = `${URL}?AWBNo=${encodeURIComponent(serial)}&AWBPrefix=312`;
  try {
    const res = await fetch(queryUrl, { headers: headers({ referer: URL }), redirect: 'follow', cache: 'no-store' });
    const html = await res.text();
    const text = clean(html);
    if (!res.ok || /Access Denied|permission to access/i.test(text)) {
      return { ok: false, reason: `INDIGO QUERY URL BLOCKED (${res.status})`, debug: { stage: 'QUERY_BLOCKED', status: res.status, preview: text.slice(0, 1800) } };
    }
    const shipment = parseIndigoTracking(html, mawb);
    const debug = shipment._debug;
    delete shipment._debug;
    if (useful(shipment)) {
      return { ok: true, shipment, officialTracker: URL, adapter: 'IndiGo official AWB query URL', debug: { stage: 'SUCCESS_QUERY_URL', status: res.status, ...debug } };
    }
    return { ok: false, reason: /AWB\s+Details\s+not\s+available/i.test(text) ? 'INDIGO QUERY URL SAYS AWB DETAILS NOT AVAILABLE' : 'INDIGO QUERY URL RETURNED NO VERIFIED SHIPMENT FIELDS', debug: { stage: 'QUERY_NO_FIELDS', status: res.status, preview: text.slice(0, 2500) } };
  } catch (e) {
    return { ok: false, reason: `INDIGO QUERY URL ERROR: ${e?.message || e}`, debug: { stage: 'QUERY_ERROR' } };
  }
}

async function postFormTracking(mawb, serial) {
  try {
    const get = await fetch(URL, { headers: headers(), redirect: 'follow', cache: 'no-store' });
    const getHtml = await get.text();
    const getText = clean(getHtml);
    if (!get.ok || /Access Denied|permission to access/i.test(getText)) {
      return { ok: false, reason: `INDIGO OFFICIAL GET BLOCKED (${get.status})`, debug: { stage: 'GET_BLOCKED', status: get.status, preview: getText.slice(0, 1800) } };
    }

    const list = inputs(getHtml);
    const form = new URLSearchParams();
    for (const i of list) if (i.name && i.type === 'hidden') form.set(i.name, i.value || '');

    const desc = i => `${i.name} ${i.id} ${i.placeholder}`.toLowerCase();
    const prefixInput = list.find(i => i.name && i.type !== 'hidden' && /prefix/.test(desc(i)));
    const awbInput = list.find(i => i.name && i.type !== 'hidden' && /(awb|airway)/.test(desc(i)) && !/prefix/.test(desc(i)));
    const trackInput = list.find(i => i.name && ['submit', 'button'].includes(i.type) && /track|go/i.test(`${i.value} ${i.name} ${i.id}`));

    if (!prefixInput || !awbInput) {
      return { ok: false, reason: 'INDIGO FORM FIELDS NOT FOUND', debug: { stage: 'FORM_FIELDS', inputs: list.filter(i => i.type !== 'hidden').slice(0, 30) } };
    }

    form.set(prefixInput.name, '312');
    form.set(awbInput.name, serial);
    if (trackInput?.name) form.set(trackInput.name, trackInput.value || 'Track');

    const cookie = cookieHeader(get);
    const post = await fetch(URL, {
      method: 'POST',
      headers: headers({
        'content-type': 'application/x-www-form-urlencoded',
        'referer': URL,
        'origin': 'https://6ecargo.goindigo.in',
        ...(cookie ? { cookie } : {})
      }),
      body: form.toString(),
      redirect: 'follow',
      cache: 'no-store'
    });

    const html = await post.text();
    const text = clean(html);
    if (!post.ok || /Access Denied|permission to access/i.test(text)) {
      return { ok: false, reason: `INDIGO OFFICIAL POST BLOCKED (${post.status})`, debug: { stage: 'POST_BLOCKED', status: post.status, preview: text.slice(0, 1800) } };
    }

    const shipment = parseIndigoTracking(html, mawb);
    const debug = shipment._debug;
    delete shipment._debug;
    if (useful(shipment)) {
      return { ok: true, shipment, officialTracker: URL, adapter: 'IndiGo CarGo direct SmartKargo form', debug: { stage: 'SUCCESS_DIRECT_FORM', status: post.status, ...debug } };
    }

    return { ok: false, reason: /AWB\s+Details\s+not\s+available/i.test(text) ? 'INDIGO OFFICIAL FORM SAYS AWB DETAILS NOT AVAILABLE' : 'INDIGO OFFICIAL FORM RETURNED NO VERIFIED SHIPMENT FIELDS', debug: { stage: 'NO_FIELDS', status: post.status, preview: text.slice(0, 2500) } };
  } catch (e) {
    return { ok: false, reason: `INDIGO DIRECT TRACKING ERROR: ${e?.message || e}`, debug: { stage: 'ERROR' } };
  }
}

export async function trackIndigo(input) {
  const mawb = normalizeMawb(input);
  if (!mawb || !mawb.startsWith('312-')) return { ok: false, reason: 'INVALID INDIGO MAWB', officialTracker: URL };

  const serial = mawb.slice(4);

  const query = await queryParamTracking(mawb, serial);
  if (query.ok) return query;

  const form = await postFormTracking(mawb, serial);
  if (form.ok) return form;

  return {
    ok: false,
    reason: form.reason || query.reason || 'INDIGO TRACKING FAILED',
    officialTracker: URL,
    debug: {
      query: query.debug || null,
      form: form.debug || null
    }
  };
}
