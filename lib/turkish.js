import fs from 'node:fs';
import { createWorker } from 'tesseract.js';
import { normalizeMawb } from './airlines.js';

const URL = 'https://turkishcargo.com/en/cargo-tracking';
const AIRLINE = { name: 'Turkish Cargo', iata: 'TK', url: URL };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const digitsOnly = value => String(value || '').replace(/\D/g, '');
const MONTH = { JAN:'01', FEB:'02', MAR:'03', APR:'04', MAY:'05', JUN:'06', JUL:'07', AUG:'08', SEP:'09', OCT:'10', NOV:'11', DEC:'12' };

async function browserConfig() {
  for (const p of [process.env.CHROME_EXECUTABLE_PATH, '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'].filter(Boolean)) {
    if (fs.existsSync(p)) return { executablePath: p, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-zygote'] };
  }
  const mod = await import('@sparticuz/chromium');
  const chromium = mod.default || mod;
  return { executablePath: await chromium.executablePath(), args: chromium.args };
}

function parseDateTime(value = '') {
  const s = clean(value);
  let m = s.match(/(20\d{2})[-\/.]([01]?\d)[-\/.]([0-3]?\d)[T\s,]+(\d{1,2}):(\d{2})/);
  if (m) return { date: `${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`, time: `${String(m[4]).padStart(2,'0')}:${m[5]}` };
  m = s.match(/([0-3]?\d)[-\/.]([01]?\d)[-\/.](20\d{2})[T\s,]+(\d{1,2}):(\d{2})/);
  if (m) return { date: `${m[3]}-${String(m[2]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`, time: `${String(m[4]).padStart(2,'0')}:${m[5]}` };
  m = s.match(/\b([0-3]?\d)\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s+(20\d{2})[\s,]+(\d{1,2}):(\d{2})\b/i);
  if (m) return { date: `${m[3]}-${MONTH[m[2].slice(0,3).toUpperCase()]}-${String(m[1]).padStart(2,'0')}`, time: `${String(m[4]).padStart(2,'0')}:${m[5]}` };
  m = s.match(/\b(JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER)\s+([0-3]?\d)(?:ST|ND|RD|TH)?,?\s+(20\d{2})[\s,]+(\d{1,2}):(\d{2})\b/i);
  if (m) return { date: `${m[3]}-${MONTH[m[1].slice(0,3).toUpperCase()]}-${String(m[2]).padStart(2,'0')}`, time: `${String(m[4]).padStart(2,'0')}:${m[5]}` };
  return { date: '', time: '' };
}

function around(text, rx, before = 180, after = 520) {
  const m = rx.exec(text);
  if (!m) return '';
  return text.slice(Math.max(0, m.index - before), Math.min(text.length, m.index + after));
}

function lastFlight(text = '') {
  const s = clean(text).toUpperCase();
  const keyed = s.match(/(?:FLIGHT(?:\s*(?:NO|NUMBER))?|FLT)\s*[:#\-]?\s*(TK\s*0*\d{2,4})\b/i);
  if (keyed) return keyed[1].replace(/\s+/g, '');
  const all = [...s.matchAll(/\bTK[-\s]?(\d{2,4})\b/g)];
  return all.length ? `TK${all.at(-1)[1]}` : '';
}

function findCode(text, kind) {
  const s = clean(text);
  const direct = kind === 'origin'
    ? s.match(/\b(?:FROM|ORIGIN)\s*[:\-]?\s*([A-Z]{3})\b/i)
    : s.match(/\b(?:TO|DESTINATION)\s*[:\-]?\s*([A-Z]{3})\b/i);
  if (direct) return direct[1].toUpperCase();
  const jsonRx = kind === 'origin'
    ? /["']?(?:origin|from)[A-Za-z_]{0,24}["']?\s*[:=]\s*["']?([A-Z]{3})\b/i
    : /["']?(?:destination|to)[A-Za-z_]{0,24}["']?\s*[:=]\s*["']?([A-Z]{3})\b/i;
  return (s.match(jsonRx)?.[1] || '').toUpperCase();
}

function statusFromText(text = '', destination = '') {
  const s = clean(text).toUpperCase();
  const dest = String(destination || '').toUpperCase();
  if (/\bDLV\b|SHIPMENT\s+DELIVERED|DELIVERED\s*-?\s*[A-Z]{3}/.test(s)) return 'ARRIVED';
  if (dest && new RegExp(`\\b(?:RCF|ARR)\\s+${dest}\\b|${dest}[^.]{0,140}(?:RECEIVED FROM FLIGHT|ARRIVED)`, 'i').test(s)) return 'ARRIVED';
  if (/\bDEP\b|DEPARTED|IN TRANSIT|AIRBORNE|IN FLIGHT/.test(s)) return 'IN TRANSIT';
  if (/DELAY|LATE|EXCEPTION/.test(s)) return 'DELAYED';
  return 'BOOKED';
}

function parseTkSmart(raw, mawb) {
  const s = clean(raw);
  if (!s) return null;
  const upper = s.toUpperCase();
  const digits = digitsOnly(mawb);
  const serial = digits.slice(3);
  const flatDigits = digitsOnly(s);
  if (/no (?:shipment|record|result)|not found|invalid (?:awb|air waybill)|no data/i.test(s)) return { notFound: true };

  const awbMatched = s.includes(mawb) || s.includes(digits) || s.includes(serial) || flatDigits.includes(digits) || flatDigits.includes(serial);
  const strongHints = [
    /TK\s*SMART|CARGO\s+TRACKING\s+INFORMATION/i.test(s),
    /\b(?:FROM|ORIGIN)\s*[:\-]?\s*[A-Z]{3}\b/i.test(s),
    /\b(?:TO|DESTINATION)\s*[:\-]?\s*[A-Z]{3}\b/i.test(s),
    /\b\d{1,6}\s*PIECE\s*\(?S\)?/i.test(s),
    /\b[\d,.]+\s*(?:KG|KGS)\b/i.test(s),
    /\bDLV\b|SHIPMENT\s+DELIVERED|DELIVERED\s*-?\s*[A-Z]{3}/i.test(s)
  ].filter(Boolean).length;
  if (!awbMatched && strongHints < 3) return null;

  let origin = findCode(s, 'origin');
  let destination = findCode(s, 'destination');
  if (!origin || !destination) {
    const route = upper.match(/\b([A-Z]{3})\s*(?:→|->|–|—|-)\s*([A-Z]{3})\b/);
    if (route) { origin = origin || route[1]; destination = destination || route[2]; }
  }

  const pieces = (s.match(/\b(\d{1,6})\s*PIECE\s*\(?S\)?/i)
    || s.match(/(?:PIECE(?:COUNT)?|PIECES|PCS|BAGS)\s*["']?\s*[:=\-]\s*["']?(\d{1,6})/i)
    || s.match(/\b(\d{1,6})\s*(?:PIECES?|PCS?|BAGS?)\b/i) || [])[1] || '';
  const weight = ((s.match(/(?:GROSS\s*)?WEIGHT[A-Za-z_]*\s*["']?\s*[:=\-]?\s*["']?([\d,.]+)\s*(?:KG|KGS)?/i)
    || s.match(/\b([\d,.]+)\s*(?:KG|KGS)\b/i) || [])[1] || '').replace(/,/g, '');
  const volume = ((s.match(/(?:VOLUME|VOL)[A-Za-z_]*\s*["']?\s*[:=\-]?\s*["']?([\d,.]+)\s*(?:M3|M³|CBM)?/i)
    || s.match(/\b([\d,.]+)\s*(?:M3|M³|CBM)\b/i) || [])[1] || '').replace(/,/g, '');
  const flightNo = lastFlight(s);
  const status = statusFromText(s, destination);

  let arrival = { date: '', time: '' };
  let arrivalIsActual = false;
  if (status === 'ARRIVED') {
    const deliveredTailMatch = /\bDLV\b|SHIPMENT\s+DELIVERED|DELIVERED\s*-?\s*[A-Z]{3}/i.exec(s);
    if (deliveredTailMatch) arrival = parseDateTime(s.slice(deliveredTailMatch.index, deliveredTailMatch.index + 750));
    if (!arrival.date) arrival = parseDateTime(around(s, /\bDLV\b|SHIPMENT\s+DELIVERED|DELIVERED\s*-?\s*[A-Z]{3}/i, 320, 750));
    if (!arrival.date) arrival = parseDateTime(s);
    arrivalIsActual = Boolean(arrival.date || arrival.time);
  } else {
    arrival = parseDateTime(around(s, /ETA|ESTIMATED ARRIVAL|EXPECTED ARRIVAL|SCHEDULED ARRIVAL/i, 100, 500));
  }

  const bookingDate = parseDateTime(around(s, /BOOKED|BOOKING|ACCEPTED|\bRCS\b/i, 100, 450)).date;
  const useful = Boolean((origin && destination) || pieces || weight || volume || flightNo || arrival.date || /\bDLV\b|DELIVERED/i.test(s));
  if (!useful) return null;

  return {
    useful: true,
    shipment: {
      mawb,
      carrierCode: 'TK',
      airlineName: 'Turkish Cargo',
      officialTracker: URL,
      origin,
      destination,
      bags: pieces,
      pieces,
      weight,
      volume,
      flightNo,
      bookingDate,
      arrivalDate: arrival.date,
      arrivalTime: arrival.time,
      arrivalIsActual,
      status,
      source: 'Turkish Cargo TK SMART / Cargo Tracking Information'
    }
  };
}

async function clickText(frame, wanted) {
  try {
    return await frame.evaluate(label => {
      const norm = value => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const target = norm(label);
      const found = [];
      const scan = root => {
        for (const el of root.querySelectorAll('button,input[type="submit"],input[type="button"],[role="button"],a,[onclick],li,[role="option"],[role="menuitem"],div,span')) {
          const r = el.getBoundingClientRect();
          const text = norm(el.innerText || el.value || el.textContent || '');
          if (r.width > 3 && r.height > 3 && text === target) found.push({ el, area: r.width * r.height });
          if (el.shadowRoot) scan(el.shadowRoot);
        }
      };
      scan(document);
      found.sort((a,b) => a.area - b.area);
      if (!found.length) return false;
      found[0].el.click();
      return true;
    }, wanted);
  } catch { return false; }
}

async function bodyHas(frame, needle) {
  try { return await frame.evaluate(value => String(document.body?.innerText || '').includes(value), needle); }
  catch { return false; }
}

function startNetworkCapture(page, mawb) {
  const items = [];
  const pending = new Set();
  const serial = digitsOnly(mawb).slice(3);
  const handler = response => {
    const task = (async () => {
      try {
        const url = response.url();
        const headers = response.headers();
        const type = String(headers['content-type'] || '').toLowerCase();
        if (!/(json|text|html|javascript|xml)/.test(type) && !/(cargo|track|shipment|awb)/i.test(url)) return;
        const text = await response.text();
        if (!text || text.length > 1500000) return;
        const flat = clean(text);
        const digitText = digitsOnly(flat);
        if (/palmate\.ai|webchat|chatbot/i.test(url)) return;
        const hasAwb = digitText.includes(digitsOnly(mawb)) || digitText.includes(serial);
        const officialStatusResponse = /turkishcargo\.com/i.test(url) && /\bDLV\b|DELIVERED|\bRCF\b|\bRCS\b|\bDEP\b/i.test(flat);
        if (type.includes('javascript') && !hasAwb) return;
        if (hasAwb || officialStatusResponse) items.push({ url, text: flat.slice(0, 250000) });
      } catch {}
    })();
    pending.add(task);
    task.finally(() => pending.delete(task));
  };
  page.on('response', handler);
  return {
    items,
    async flush() { if (pending.size) await Promise.allSettled([...pending]); },
    stop() { page.off('response', handler); }
  };
}

async function parseCapturedNetwork(capture, mawb) {
  await capture.flush();
  for (const item of [...capture.items].reverse()) {
    const parsed = parseTkSmart(item.text, mawb);
    if (parsed?.notFound) return { notFound: true, url: item.url };
    if (parsed?.useful) {
      parsed.shipment.source = 'Turkish Cargo official tracking network response';
      return { parsed, url: item.url, sample: item.text.slice(0, 8000) };
    }
  }
  return null;
}

async function fillAddSearch(page, mawb) {
  const digits = digitsOnly(mawb);
  const prefix = digits.slice(0,3);
  const serial = digits.slice(3);
  for (const frame of page.frames()) {
    const inputs = await frame.$$('input:not([type="hidden"]),textarea');
    const fields = [];
    for (const input of inputs) {
      try {
        const meta = await input.evaluate(el => {
          const r = el.getBoundingClientRect();
          return { visible: r.width > 3 && r.height > 3 && !el.disabled && !el.readOnly, max: Number(el.maxLength || -1), label: `${el.placeholder || ''} ${el.name || ''} ${el.id || ''} ${el.getAttribute('aria-label') || ''} ${el.labels?.[0]?.innerText || ''}` };
        });
        if (meta.visible) fields.push({ input, meta });
      } catch {}
    }
    const prefixField = fields.find(x => x.meta.max === 3 || /prefix|awb code|airline code/i.test(x.meta.label));
    let numberField = fields.find(x => x !== prefixField && (x.meta.max === 8 || /awb|air waybill/i.test(x.meta.label)));
    if (!numberField) numberField = fields.find(x => [11,12,14].includes(x.meta.max));
    if (!numberField) continue;

    if (prefixField) {
      await prefixField.input.click({ clickCount: 3 });
      await page.keyboard.press('Backspace');
      await prefixField.input.type(prefix, { delay: 30 });
    }
    await numberField.input.click({ clickCount: 3 });
    await page.keyboard.press('Backspace');
    await numberField.input.type(numberField.meta.max === 8 ? serial : (prefixField ? serial : digits), { delay: 30 });
    await sleep(900);

    let addMode = '';
    if (await clickText(frame, 'Add')) {
      addMode = 'CLICK_ADD';
    } else if (await clickText(frame, `Add: ${serial}`)) {
      addMode = 'CLICK_ADD_SERIAL';
    } else {
      await numberField.input.press('ArrowDown');
      await numberField.input.press('Enter');
      addMode = 'ARROWDOWN_ENTER_ADD';
      await sleep(500);
      if (!await bodyHas(frame, serial)) {
        await numberField.input.click();
        await numberField.input.press('Enter');
        addMode = 'ENTER_ADD';
      }
    }
    await sleep(900);

    let searchMode = '';
    for (const f of page.frames()) {
      if (!searchMode && await clickText(f, 'Search')) searchMode = 'CLICK_SEARCH';
    }
    if (!searchMode) {
      try {
        await numberField.input.press('Enter');
        await sleep(500);
        for (const f of page.frames()) if (!searchMode && await clickText(f, 'Search')) searchMode = 'CLICK_SEARCH_AFTER_ENTER';
      } catch {}
    }
    return { ok: true, addMode, searchMode: searchMode || 'SEARCH_NOT_CLICKED', serialVisible: await bodyHas(frame, serial) };
  }
  return { ok: false, stage: 'FORM_NOT_FOUND' };
}

async function readDomResult(page, mawb) {
  const serial = digitsOnly(mawb).slice(3);
  for (const frame of page.frames()) {
    try {
      const text = await frame.evaluate(awb => {
        const norm = value => String(value || '').replace(/\s+/g, ' ').trim();
        const candidates = [];
        const scan = root => {
          for (const el of root.querySelectorAll('section,article,div,main')) {
            const t = norm(el.innerText || el.textContent || '');
            if (t.length >= 40 && t.length <= 30000 && (t.includes(awb) || /TK\s*SMART|DELIVERED|\bDLV\b/i.test(t)) && /FROM|TO|PIECE|KG|DLV|DELIVERED/i.test(t)) candidates.push({ el, text: t, len: t.length });
            if (el.shadowRoot) scan(el.shadowRoot);
          }
        };
        scan(document);
        candidates.sort((a,b) => a.len - b.len);
        if (!candidates.length) return '';
        candidates[0].el.scrollIntoView({ block: 'center', behavior: 'auto' });
        return candidates[0].text;
      }, serial);
      if (text) {
        const parsed = parseTkSmart(text, mawb);
        if (parsed?.useful || parsed?.notFound) return { parsed, text };
      }
    } catch {}
  }
  return null;
}

async function positionTrackingArea(page) {
  let found = false;
  for (const frame of page.frames()) {
    try {
      const hit = await frame.evaluate(() => {
        const norm = value => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
        const target = [...document.querySelectorAll('h1,h2,h3,h4,h5,section,div,p,span')].find(el => {
          const t = norm(el.innerText || el.textContent || '');
          return t === 'cargo tracking information' || t.startsWith('cargo tracking information ');
        });
        if (target) {
          target.scrollIntoView({ block: 'start', behavior: 'auto' });
          window.scrollBy({ top: 260, left: 0, behavior: 'auto' });
          return true;
        }
        return false;
      });
      found = found || hit;
    } catch {}
  }
  if (!found) {
    for (const frame of page.frames()) try { await frame.evaluate(() => window.scrollBy({ top: 650, left: 0, behavior: 'auto' })); } catch {}
  }
  await sleep(650);
  return found;
}

async function screenshotOcr(page, mawb) {
  await positionTrackingArea(page);
  let worker;
  const samples = [];
  try {
    worker = await createWorker('eng');
    for (let i = 0; i < 3; i++) {
      if (i) {
        for (const frame of page.frames()) try { await frame.evaluate(() => window.scrollBy({ top: 380, left: 0, behavior: 'auto' })); } catch {}
        await sleep(450);
      }
      const image = await page.screenshot({ type: 'png', fullPage: false });
      const result = await worker.recognize(image);
      const text = result?.data?.text || '';
      const flat = clean(text);
      samples.push(flat.slice(0, 3500));
      const parsed = parseTkSmart(text, mawb);
      if (parsed?.notFound) return { notFound: true, samples };
      if (parsed?.useful) {
        parsed.shipment.source = 'Turkish Cargo TK SMART screenshot OCR / Cargo Tracking Information';
        return { parsed, samples, screenshotIndex: i + 1 };
      }
    }
    return { samples };
  } catch (error) {
    return { samples, error: error?.message || 'OCR failed' };
  } finally {
    if (worker) try { await worker.terminate(); } catch {}
  }
}

export async function trackTurkish(input) {
  const mawb = normalizeMawb(input);
  if (!mawb || !mawb.startsWith('235-')) return { ok: false, reason: 'INVALID TURKISH MAWB', airline: AIRLINE };

  let browser;
  let capture;
  const debug = { prefix: '235', airline: 'Turkish Cargo', url: URL, stage: 'OPEN' };
  try {
    const mod = await import('puppeteer-core');
    const puppeteer = mod.default || mod;
    const launch = await browserConfig();
    browser = await puppeteer.launch({ ...launch, headless: true, defaultViewport: { width: 1440, height: 1200, deviceScaleFactor: 1.25 } });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36');
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
    capture = startNetworkCapture(page, mawb);

    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(1600);
    for (const frame of page.frames()) await clickText(frame, 'Accept all');

    const flow = await fillAddSearch(page, mawb);
    if (!flow.ok) return { ok: false, reason: 'TURKISH ADD/SEARCH FLOW NOT FOUND', airline: AIRLINE, debug: { ...debug, ...flow } };
    if (flow.searchMode === 'SEARCH_NOT_CLICKED') return { ok: false, reason: 'TURKISH SEARCH BUTTON NOT CLICKED', airline: AIRLINE, debug: { ...debug, ...flow, stage: 'SEARCH_BUTTON_FAILED' } };
    await sleep(4500);

    const network = await parseCapturedNetwork(capture, mawb);
    if (network?.notFound) return { ok: false, notFound: true, reason: 'NO SHIPMENT RECORD', airline: AIRLINE, debug: { ...debug, ...flow, stage: 'NETWORK_NO_RECORD', responseUrl: network.url } };
    if (network?.parsed?.useful) return { ok: true, airline: AIRLINE, shipment: network.parsed.shipment, debug: { ...debug, ...flow, stage: 'NETWORK_TK_SMART_SUCCESS', responseUrl: network.url, sample: network.sample } };

    for (let i = 0; i < 5; i++) {
      const dom = await readDomResult(page, mawb);
      if (dom?.parsed?.notFound) return { ok: false, notFound: true, reason: 'NO SHIPMENT RECORD', airline: AIRLINE, debug: { ...debug, ...flow, stage: 'DOM_NO_RECORD' } };
      if (dom?.parsed?.useful) return { ok: true, airline: AIRLINE, shipment: dom.parsed.shipment, debug: { ...debug, ...flow, stage: 'DOM_TK_SMART_SUCCESS', sample: clean(dom.text).slice(0,8000) } };
      if (i === 2) for (const frame of page.frames()) try { await frame.evaluate(() => window.scrollBy({ top: 430, left: 0, behavior: 'auto' })); } catch {}
      await sleep(650);
    }

    const shot = await screenshotOcr(page, mawb);
    if (shot?.notFound) return { ok: false, notFound: true, reason: 'NO SHIPMENT RECORD', airline: AIRLINE, screenshotCaptured: true, screenshotOcrUsed: true, debug: { ...debug, ...flow, stage: 'SCREENSHOT_NO_RECORD', samples: shot.samples } };
    if (shot?.parsed?.useful) return { ok: true, airline: AIRLINE, shipment: shot.parsed.shipment, screenshotCaptured: true, screenshotVerified: true, screenshotOcrUsed: true, debug: { ...debug, ...flow, stage: 'SCREENSHOT_TK_SMART_SUCCESS', screenshotIndex: shot.screenshotIndex, samples: shot.samples } };

    await capture.flush();
    return { ok: false, reason: 'TURKISH TK SMART RESULT NOT READABLE', airline: AIRLINE, screenshotCaptured: true, screenshotOcrUsed: true, debug: { ...debug, ...flow, stage: 'TK_SMART_UNREADABLE', capturedResponses: capture.items.slice(-12).map(x => ({ url: x.url, sample: x.text.slice(0,1200) })), ocrSamples: shot?.samples || [], ocrError: shot?.error || '' } };
  } catch (error) {
    return { ok: false, reason: error?.message || 'TURKISH TRACKING FAILED', airline: AIRLINE, debug: { ...debug, stage: 'BROWSER_ERROR' } };
  } finally {
    if (capture) try { capture.stop(); } catch {}
    if (browser) try { await browser.close(); } catch {}
  }
}
