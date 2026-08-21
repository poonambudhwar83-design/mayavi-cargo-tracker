import { GET as track123GET, POST as track123POST } from '../../../route';

export const GET = track123GET;
export const runtime = 'nodejs';
export const maxDuration = 60;

const EMIRATES_TRACK_URL = 'https://scekprd.emirates.com/skychain/app?initial=y&service=page%2Fnwp%3ATrackshipmt';

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
    /(?:Origin|From|Departure\s*Station|Originating\s*Station)\s*[:#-]?\s*([A-Z]{3})\b/i,
    /\b([A-Z]{3})\s*(?:-|→|TO)\s*[A-Z]{3}\b/i
  ]).toUpperCase();

  const destination = firstMatch(text, [
    /(?:Destination|To|Arrival\s*Station|Destination\s*Station)\s*[:#-]?\s*([A-Z]{3})\b/i,
    /\b[A-Z]{3}\s*(?:-|→|TO)\s*([A-Z]{3})\b/i
  ]).toUpperCase();

  const pieces = firstMatch(text, [
    /(?:Pieces|Piece|Pcs|Pkgs|Packages)\s*[:#-]?\s*(\d{1,6})/i,
    /(\d{1,6})\s*(?:Pieces|Pcs)\b/i
  ]);
  const weight = firstMatch(text, [
    /(?:Gross\s*Weight|Weight)\s*[:#-]?\s*([\d,.]+)\s*(?:KG|KGS|KILOGRAMS?)?/i,
    /([\d,.]+)\s*(?:KG|KGS)\b/i
  ]).replace(/,/g, '');

  const actualArrivalRaw = firstMatch(text, [
    /(?:Actual\s*Arrival(?:\s*Time)?|Arrived(?:\s*At)?|Arrival\s*Actual)\s*[:#-]?\s*([^|]{6,35})/i
  ]);
  const etaRaw = firstMatch(text, [
    /(?:Estimated\s*Arrival(?:\s*Time)?|ETA|Expected\s*Arrival(?:\s*Time)?|Scheduled\s*Arrival(?:\s*Time)?)\s*[:#-]?\s*([^|]{6,35})/i
  ]);

  const actualArrival = normalizeDateTime(actualArrivalRaw);
  const eta = actualArrival || normalizeDateTime(etaRaw);

  let status = firstMatch(text, [
    /(?:Shipment\s*Status|Current\s*Status|Status)\s*[:#-]?\s*([A-Za-z][A-Za-z _-]{2,40})/i
  ]);
  if (actualArrival || /\bARRIVED\b|\bRCF\b/i.test(text)) status = 'ARRIVED';
  else if (/\bIN\s*TRANSIT\b|\bDEPARTED\b|\bDEP\b/i.test(text)) status = 'IN_TRANSIT';

  const useful = pageHasAwb && Boolean(flightNo || origin || destination || pieces || weight || eta || actualArrival || status);
  return {
    useful,
    shipment: {
      mawb,
      status,
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
    debug: { pageHasAwb, pageTitleHint: text.slice(0, 300) }
  };
}

async function fillEmiratesForm(page, prefix, serial, digits) {
  const inputs = await page.$$('input');
  const meta = [];
  for (let i = 0; i < inputs.length; i++) {
    const info = await inputs[i].evaluate(el => ({
      type: (el.type || '').toLowerCase(),
      name: el.name || '', id: el.id || '', placeholder: el.placeholder || '',
      maxLength: el.maxLength || 0, value: el.value || '', disabled: el.disabled,
      visible: !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)
    }));
    if (info.visible && !info.disabled && ['text','number','tel','search',''].includes(info.type)) meta.push({ index:i, ...info });
  }

  const scorePrefix = x => /prefix|pre|awb.*pre/i.test(`${x.name} ${x.id} ${x.placeholder}`) ? 20 : (x.maxLength > 0 && x.maxLength <= 3 ? 10 : 0);
  const scoreSerial = x => /awb|document|doc|number|no/i.test(`${x.name} ${x.id} ${x.placeholder}`) ? 20 : (x.maxLength >= 8 ? 10 : 0);
  const sortedPrefix = [...meta].sort((a,b)=>scorePrefix(b)-scorePrefix(a));
  const prefixCandidate = sortedPrefix[0] && scorePrefix(sortedPrefix[0]) > 0 ? sortedPrefix[0] : null;
  const serialCandidates = meta.filter(x => !prefixCandidate || x.index !== prefixCandidate.index).sort((a,b)=>scoreSerial(b)-scoreSerial(a));
  const serialCandidate = serialCandidates[0] || null;

  if (prefixCandidate && serialCandidate) {
    await inputs[prefixCandidate.index].click({ clickCount:3 });
    await inputs[prefixCandidate.index].type(prefix);
    await inputs[serialCandidate.index].click({ clickCount:3 });
    await inputs[serialCandidate.index].type(serial);
  } else if (meta[0]) {
    await inputs[meta[0].index].click({ clickCount:3 });
    await inputs[meta[0].index].type(digits);
  } else {
    return { filled:false, meta };
  }

  const clicked = await page.evaluate(() => {
    const candidates = [...document.querySelectorAll('button,input[type="submit"],input[type="button"],a')];
    const target = candidates.find(el => /^(track|search|submit|go)$/i.test((el.innerText || el.value || '').trim())) ||
      candidates.find(el => /track shipment|track|search/i.test((el.innerText || el.value || '').trim()));
    if (target) { target.click(); return true; }
    return false;
  });
  return { filled:true, clicked, meta };
}

async function fetchEmiratesBrowser(mawb) {
  const digits = String(mawb).replace(/\D/g, '');
  if (!digits.startsWith('176') || digits.length !== 11) return { useful:false };
  const prefix = digits.slice(0,3);
  const serial = digits.slice(3,11);
  let browser;
  try {
    const [{ default: chromium }, { default: puppeteer }] = await Promise.all([
      import('@sparticuz/chromium'),
      import('puppeteer-core')
    ]);
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: { width: 1440, height: 1000 },
      executablePath: await chromium.executablePath(),
      headless: chromium.headless
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36');
    await page.goto(EMIRATES_TRACK_URL, { waitUntil:'domcontentloaded', timeout:25000 });
    await new Promise(r=>setTimeout(r,2500));
    const form = await fillEmiratesForm(page, prefix, serial, digits);
    if (!form.filled) return { useful:false, error:'Emirates form fields were not found.', debug:{ inputs:form.meta } };
    try { await page.waitForNetworkIdle({ idleTime:1000, timeout:12000 }); } catch {}
    await new Promise(r=>setTimeout(r,3500));
    const html = await page.content();
    const parsed = parseEmiratesHtml(html, `${prefix}-${serial}`);
    return { ...parsed, debug:{ ...(parsed.debug||{}), inputs:form.meta, clicked:form.clicked } };
  } catch (e) {
    return { useful:false, error:e?.message || 'Emirates browser tracking failed' };
  } finally {
    if (browser) try { await browser.close(); } catch {}
  }
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
    source: 'Track123 fallback — ETA/origin/status not trusted for Emirates'
  };
}

export async function POST(request) {
  const body = await request.json();
  const mawb = body?.mawb || '';
  const digits = String(mawb).replace(/\D/g, '');
  const isEmirates = digits.startsWith('176');

  let emirates = { useful:false };
  if (isEmirates) emirates = await fetchEmiratesBrowser(mawb);

  const fallbackReq = new Request(request.url, {
    method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(body)
  });
  const trackResp = await track123POST(fallbackReq);
  let trackData = {};
  try { trackData = await trackResp.json(); } catch {}

  if (isEmirates && emirates.useful) {
    const official = emirates.shipment || {};
    const track = trackData?.shipment || {};
    return Response.json({
      ok:true,
      source:'Emirates SkyCargo official browser tracker',
      airlinePrimary:true,
      shipment:{
        mawb:official.mawb || mawb,
        carrierCode:'EK',
        origin:official.origin || '',
        destination:official.destination || '',
        eta:official.eta || null,
        actualArrival:official.actualArrival || null,
        status:official.status || 'EMIRATES SHIPMENT FOUND',
        flightNo:official.flightNo || track.flightNo || '',
        bags:official.bags || track.bags || '',
        weight:official.weight || track.weight || '',
        source:'Emirates SkyCargo official browser tracker'
      },
      airlineDebug:emirates.debug || null
    });
  }

  if (isEmirates) {
    return Response.json({
      ok:true,
      source:'Emirates browser tracker unavailable; sanitized fallback',
      airlinePrimary:false,
      airlineError:emirates.error || null,
      airlineDebug:emirates.debug || null,
      shipment:safeFallbackForEmirates(trackData?.shipment || {}, mawb)
    });
  }

  return Response.json(trackData, { status:trackResp.status });
}
