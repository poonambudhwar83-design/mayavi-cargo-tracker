import { GET as track123GET, POST as track123POST } from '../../../route';

export const GET = track123GET;
export const runtime = 'nodejs';
export const maxDuration = 60;

const EMIRATES_TRACK_URL = 'https://scekprd.emirates.com/skychain/app?initial=y&service=page%2Fnwp%3ATrackshipmt';

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

function firstMatch(text, patterns) {
  for (const p of patterns) {
    const m = String(text || '').match(p);
    if (m && m[1]) return m[1].trim();
  }
  return '';
}

function parseEmiratesText(text, mawb) {
  const compact = String(text || '').replace(/\s+/g, ' ').trim();
  const digits = String(mawb).replace(/\D/g, '');
  const serial = digits.slice(3);
  const pageHasAwb = compact.replace(/\D/g, '').includes(digits) || compact.includes(serial);

  const flightNo = firstMatch(compact, [
    /(?:Flight(?:\s*No\.?|\s*Number)?|FLT)\s*[:#-]?\s*(EK\s*\d{2,4})/i,
    /\b(EK\s*\d{2,4})\b/i
  ]).replace(/\s+/g, '').toUpperCase();

  const origin = firstMatch(compact, [
    /(?:Origin|From|Departure\s*Station|Originating\s*Station)\s*[:#-]?\s*([A-Z]{3})\b/i,
    /\b([A-Z]{3})\s*(?:-|→|TO)\s*[A-Z]{3}\b/i
  ]).toUpperCase();

  const destination = firstMatch(compact, [
    /(?:Destination|To|Arrival\s*Station|Destination\s*Station)\s*[:#-]?\s*([A-Z]{3})\b/i,
    /\b[A-Z]{3}\s*(?:-|→|TO)\s*([A-Z]{3})\b/i
  ]).toUpperCase();

  const pieces = firstMatch(compact, [
    /(?:Pieces|Piece|Pcs|Pkgs|Packages)\s*[:#-]?\s*(\d{1,6})/i,
    /(\d{1,6})\s*(?:Pieces|Pcs)\b/i
  ]);

  const weight = firstMatch(compact, [
    /(?:Gross\s*Weight|Weight)\s*[:#-]?\s*([\d,.]+)\s*(?:KG|KGS|KILOGRAMS?)?/i,
    /([\d,.]+)\s*(?:KG|KGS)\b/i
  ]).replace(/,/g, '');

  const actualRaw = firstMatch(compact, [
    /(?:Actual\s*Arrival(?:\s*Time)?|Arrived(?:\s*At)?|Arrival\s*Actual)\s*[:#-]?\s*([^|]{6,40})/i
  ]);
  const etaRaw = firstMatch(compact, [
    /(?:Estimated\s*Arrival(?:\s*Time)?|ETA|Expected\s*Arrival(?:\s*Time)?|Scheduled\s*Arrival(?:\s*Time)?)\s*[:#-]?\s*([^|]{6,40})/i
  ]);

  const actualArrival = normalizeDateTime(actualRaw);
  const eta = actualArrival || normalizeDateTime(etaRaw);

  let status = '';
  if (actualArrival || /\bARRIVED\b|\bRCF\b/i.test(compact)) status = 'ARRIVED';
  else if (/\bIN\s*TRANSIT\b|\bDEPARTED\b|\bDEP\b/i.test(compact)) status = 'IN_TRANSIT';
  else status = firstMatch(compact, [/(?:Shipment\s*Status|Current\s*Status|Status)\s*[:#-]?\s*([A-Za-z][A-Za-z _-]{2,40})/i]);

  const useful = pageHasAwb && Boolean(flightNo || origin || destination || pieces || weight || eta || actualArrival || status);
  return {
    useful,
    shipment: { mawb, status, carrierCode:'EK', origin, destination, eta, actualArrival, flightNo, bags:pieces, weight, source:'Emirates SkyCargo official browser tracker' },
    debug: { pageHasAwb, textHint: compact.slice(0, 700) }
  };
}

async function setInputValue(page, index, value) {
  return page.evaluate(({ index, value }) => {
    const inputs = [...document.querySelectorAll('input')];
    const el = inputs[index];
    if (!el) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(el, value); else el.value = value;
    el.focus();
    el.dispatchEvent(new Event('input', { bubbles:true }));
    el.dispatchEvent(new Event('change', { bubbles:true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { bubbles:true, key:'Tab' }));
    return true;
  }, { index, value });
}

async function fillEmiratesForm(page, prefix, serial, digits) {
  const meta = await page.evaluate(() => [...document.querySelectorAll('input')].map((el, index) => {
    const r = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return {
      index,
      type:(el.type || '').toLowerCase(), name:el.name || '', id:el.id || '', placeholder:el.placeholder || '',
      maxLength:el.maxLength || 0, value:el.value || '', disabled:el.disabled,
      visible:r.width > 3 && r.height > 3 && style.visibility !== 'hidden' && style.display !== 'none',
      x:Math.round(r.x), y:Math.round(r.y), w:Math.round(r.width), h:Math.round(r.height)
    };
  }));

  const usable = meta.filter(x => x.visible && !x.disabled && ['text','number','tel','search',''].includes(x.type));
  const attr = x => `${x.name} ${x.id} ${x.placeholder}`;

  let prefixCandidate = usable.find(x => /awb.*pre|prefix|doc.*pre/i.test(attr(x))) || usable.find(x => x.maxLength === 3);
  let serialCandidate = usable.find(x => x !== prefixCandidate && /awb.*no|document.*no|doc.*no|awb|document/i.test(attr(x)) && (x.maxLength === 8 || x.maxLength > 3)) ||
    usable.find(x => x !== prefixCandidate && x.maxLength === 8);

  if (!prefixCandidate || !serialCandidate) {
    const pairs = [];
    for (const a of usable) for (const b of usable) {
      if (a.index === b.index) continue;
      if (Math.abs(a.y - b.y) <= 30 && a.x < b.x) {
        let score = 0;
        if (a.maxLength === 3) score += 30;
        if (b.maxLength === 8) score += 30;
        if (a.w < b.w) score += 10;
        if (a.y > 150) score += 5;
        pairs.push({ a, b, score });
      }
    }
    pairs.sort((p,q)=>q.score-p.score);
    if (pairs[0] && pairs[0].score >= 20) {
      prefixCandidate = prefixCandidate || pairs[0].a;
      serialCandidate = serialCandidate || pairs[0].b;
    }
  }

  if (prefixCandidate && serialCandidate) {
    await setInputValue(page, prefixCandidate.index, prefix);
    await setInputValue(page, serialCandidate.index, serial);
  } else {
    const one = usable.find(x => /awb|document/i.test(attr(x)) && x.maxLength >= 11) || usable.find(x => x.maxLength >= 11);
    if (!one) return { filled:false, meta:usable };
    await setInputValue(page, one.index, digits);
    serialCandidate = one;
  }

  await new Promise(r=>setTimeout(r,500));
  let clicked = await page.evaluate(() => {
    const els = [...document.querySelectorAll('button,input[type="submit"],input[type="button"],a')].filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 3 && r.height > 3;
    });
    const txt = el => (el.innerText || el.value || el.getAttribute('aria-label') || '').trim();
    const target = els.find(el => /^track$/i.test(txt(el))) || els.find(el => /track shipment|track|search|submit|go/i.test(txt(el)));
    if (!target) return false;
    target.click();
    return true;
  });

  if (!clicked && serialCandidate) {
    await page.evaluate(index => {
      const el = [...document.querySelectorAll('input')][index];
      if (el) {
        el.focus();
        el.dispatchEvent(new KeyboardEvent('keydown', { bubbles:true, key:'Enter', code:'Enter' }));
        el.dispatchEvent(new KeyboardEvent('keyup', { bubbles:true, key:'Enter', code:'Enter' }));
        if (el.form && typeof el.form.requestSubmit === 'function') el.form.requestSubmit();
      }
    }, serialCandidate.index);
    clicked = true;
  }

  return { filled:true, clicked, meta:usable, prefixCandidate, serialCandidate };
}

async function fetchEmiratesBrowser(mawb) {
  const digits = String(mawb).replace(/\D/g, '');
  if (!digits.startsWith('176') || digits.length !== 11) return { useful:false };
  const prefix = digits.slice(0,3);
  const serial = digits.slice(3,11);
  let browser;
  try {
    const chromiumMod = await import('@sparticuz/chromium');
    const puppeteerMod = await import('puppeteer-core');
    const chromium = chromiumMod.default || chromiumMod;
    const puppeteer = puppeteerMod.default || puppeteerMod;
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport:{ width:1440, height:1100 },
      executablePath:await chromium.executablePath(),
      headless:true
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({ 'Accept-Language':'en-US,en;q=0.9' });
    await page.goto(EMIRATES_TRACK_URL, { waitUntil:'networkidle2', timeout:30000 });
    await new Promise(r=>setTimeout(r,1800));

    const form = await fillEmiratesForm(page, prefix, serial, digits);
    if (!form.filled) return { useful:false, error:'Emirates Document No. fields were not found.', debug:{ inputs:form.meta } };

    try {
      await page.waitForFunction(s => document.body && (document.body.innerText.includes(s) || document.body.innerText.replace(/\D/g,'').includes(`176${s}`)), { timeout:15000 }, serial);
    } catch {}
    try { await page.waitForNetworkIdle({ idleTime:1200, timeout:12000 }); } catch {}
    await new Promise(r=>setTimeout(r,2500));

    const bodyText = await page.evaluate(() => document.body?.innerText || '');
    const parsed = parseEmiratesText(bodyText, `${prefix}-${serial}`);
    return { ...parsed, debug:{ ...(parsed.debug||{}), clicked:form.clicked, prefixField:form.prefixCandidate, serialField:form.serialCandidate, inputs:form.meta } };
  } catch (e) {
    return { useful:false, error:e?.message || 'Emirates browser tracking failed' };
  } finally {
    if (browser) try { await browser.close(); } catch {}
  }
}

function safeFallbackForEmirates(track = {}, mawb = '') {
  return {
    mawb,
    carrierCode:track.carrierCode || 'EK',
    bags:track.bags || '',
    weight:track.weight || '',
    flightNo:track.flightNo || '',
    origin:'', destination:'', eta:null, actualArrival:null,
    status:'WAITING FOR EMIRATES LIVE DATA',
    source:'Track123 fallback — ETA/origin/status not trusted for Emirates'
  };
}

export async function POST(request) {
  const body = await request.json();
  const mawb = body?.mawb || '';
  const digits = String(mawb).replace(/\D/g, '');
  const isEmirates = digits.startsWith('176');

  let emirates = { useful:false };
  if (isEmirates) emirates = await fetchEmiratesBrowser(mawb);

  const fallbackReq = new Request(request.url, { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(body) });
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
