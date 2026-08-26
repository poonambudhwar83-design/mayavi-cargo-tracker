import fs from 'node:fs';
import { normalizeMawb } from '../airlines.js';

const URL = 'https://www.qrcargo.com/s/track-your-shipment';
const airline = { name: 'Qatar Airways Cargo', iata: 'QR', url: URL };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const clean = value => String(value || '').replace(/\s+/g, ' ').trim();

async function browserConfig() {
  for (const executablePath of [
    process.env.CHROME_EXECUTABLE_PATH,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable'
  ].filter(Boolean)) {
    if (fs.existsSync(executablePath)) {
      return {
        executablePath,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-zygote']
      };
    }
  }
  const mod = await import('@sparticuz/chromium');
  const chromium = mod.default || mod;
  return { executablePath: await chromium.executablePath(), args: chromium.args };
}

function monthNumber(name = '') {
  return ({ jan:'01', feb:'02', mar:'03', apr:'04', may:'05', jun:'06', jul:'07', aug:'08', sep:'09', oct:'10', nov:'11', dec:'12' })[String(name).slice(0, 3).toLowerCase()] || '';
}

function parseDateTime(raw = '') {
  const s = clean(raw);
  let m = s.match(/\b(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})/);
  if (m) return { date: `${m[1]}-${m[2]}-${m[3]}`, time: `${String(m[4]).padStart(2, '0')}:${m[5]}` };

  m = s.match(/\b(\d{1,2})[-\s/]([A-Za-z]{3,9})[-\s/,](\d{2,4})\s+(\d{1,2}):(\d{2})(?:\s*(AM|PM))?/i);
  if (!m) return { date: '', time: '' };
  let year = String(m[3]);
  if (year.length === 2) year = `20${year}`;
  const month = monthNumber(m[2]);
  if (!month) return { date: '', time: '' };
  let hour = Number(m[4]);
  const ap = String(m[6] || '').toUpperCase();
  if (ap === 'PM' && hour < 12) hour += 12;
  if (ap === 'AM' && hour === 12) hour = 0;
  return { date: `${year}-${month}-${String(m[1]).padStart(2, '0')}`, time: `${String(hour).padStart(2, '0')}:${m[5]}` };
}

function parseEventDateTime(event = {}) {
  const direct = parseDateTime(`${event.eventDate || ''} ${event.eventTime || ''}`);
  if (direct.date) return direct;
  return parseDateTime(event.createdDate || '');
}

function statusFromAuthoritative(value = '') {
  const text = clean(value);
  if (/\bdelivered\b|\bDLV\b/i.test(text)) return 'DELIVERED';
  if (/\barrived\b|\blanded\b|\bARR\b/i.test(text)) return 'ARRIVED';
  if (/received at destination|received in|\bRCF\b/i.test(text)) return 'RECEIVED AT DESTINATION';
  if (/notified consignee/i.test(text)) return 'NOTIFIED CONSIGNEE';
  if (/\bdelayed\b|\blate\b|exception/i.test(text)) return 'DELAYED';
  if (/\bdeparted\b|\bDEP\b|in[ -]?transit|airborne|in flight/i.test(text)) return 'IN TRANSIT';
  if (/\bbooked\b|\bRCS\b|manifested|received from shipper/i.test(text)) return 'BOOKED';
  return text ? text.toUpperCase() : 'TRACKING';
}

function safeJson(raw = '') {
  let text = String(raw || '').trim();
  text = text.replace(/^while\s*\(\s*1\s*\)\s*;?\s*/i, '').replace(/^for\s*\(\s*;;\s*\)\s*;?\s*/i, '');
  try { return JSON.parse(text); } catch { return null; }
}

function findTrackingObjects(value, output = [], depth = 0) {
  if (depth > 16 || value === null || value === undefined) return output;
  if (typeof value === 'string') {
    const s = value.trim();
    if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']'))) {
      const nested = safeJson(s);
      if (nested) findTrackingObjects(nested, output, depth + 1);
    }
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach(item => findTrackingObjects(item, output, depth + 1));
    return output;
  }
  if (typeof value === 'object') {
    if (Array.isArray(value.cargoTrackingFlightList) || Array.isArray(value.cargoTrackingMvtStausList)) output.push(value);
    Object.values(value).forEach(item => findTrackingObjects(item, output, depth + 1));
  }
  return output;
}

function normalizeFlightNumber(value = '') {
  const s = clean(value).toUpperCase();
  const match = s.match(/\bQR[-\s]?(\d{2,4})\b/) || s.match(/\b(\d{2,4})\b/);
  return match ? `QR${match[1]}` : '';
}

function chooseShipmentObject(objects, mawb) {
  const digits = mawb.replace(/\D/g, '');
  const serial = digits.slice(3);
  const scored = objects.map(item => {
    const text = JSON.stringify(item);
    let score = 0;
    if (text.includes(mawb)) score += 8;
    if (text.includes(digits)) score += 8;
    if (text.includes(serial)) score += 4;
    if (Array.isArray(item.cargoTrackingFlightList) && item.cargoTrackingFlightList.length) score += 3;
    if (Array.isArray(item.cargoTrackingMvtStausList) && item.cargoTrackingMvtStausList.length) score += 2;
    return { item, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.item || null;
}

function parseQatarStructured(raw, mawb) {
  const json = safeJson(raw);
  if (!json) return null;
  const text = JSON.stringify(json);
  if (/no (?:shipment|record|result)|not found|invalid (?:awb|mawb|air waybill)|unable to find|no data/i.test(text)) return { notFound: true };

  const objects = findTrackingObjects(json);
  const shipmentSO = chooseShipmentObject(objects, mawb);
  if (!shipmentSO) return null;

  const flights = Array.isArray(shipmentSO.cargoTrackingFlightList) ? shipmentSO.cargoTrackingFlightList : [];
  const events = Array.isArray(shipmentSO.cargoTrackingMvtStausList) ? shipmentSO.cargoTrackingMvtStausList : [];
  const firstLeg = flights[0] || {};
  const finalLeg = flights.at(-1) || {};

  const origin = clean(firstLeg.segmentOfDeparture || firstLeg.segmentDeparture || shipmentSO.origin || '').toUpperCase();
  const destination = clean(finalLeg.segmetnOfArrival || finalLeg.segmentOfArrival || finalLeg.segmentArrival || shipmentSO.destination || shipmentSO.shipmentAptUpdate || '').toUpperCase();
  const pieces = String(finalLeg.pieces || firstLeg.pieces || shipmentSO.pieces || shipmentSO.totalPieces || '');
  const weight = String(finalLeg.weight || firstLeg.weight || shipmentSO.weight || shipmentSO.grossWeight || '').replace(/,/g, '');
  const flightNo = normalizeFlightNumber(finalLeg.flightNumber || finalLeg.flightNo || '');

  const destinationArrivalEvents = events.filter(event => {
    const airport = clean(event.eventAirport).toUpperCase();
    const details = clean(event.movementDetails);
    return (!destination || airport === destination) && /\barrived\b/i.test(details);
  });
  const actualArrivalEvent = destinationArrivalEvents[0] || null;

  let arrival = actualArrivalEvent ? parseEventDateTime(actualArrivalEvent) : { date: '', time: '' };
  let arrivalIsActual = Boolean(arrival.date);
  if (!arrival.date) {
    arrival = parseDateTime(finalLeg.arrivalDate || finalLeg.eta || finalLeg.estimatedArrivalDate || finalLeg.scheduledArrivalDate || '');
    arrivalIsActual = false;
  }

  const authoritativeStatus = shipmentSO.shipmentUpdate || shipmentSO.shipmentUpdate1 || shipmentSO.shipmentUpdate2 || finalLeg.flightStatus || events[0]?.movementDetails || '';
  const status = statusFromAuthoritative(authoritativeStatus);

  const useful = Boolean(origin || destination || pieces || weight || flightNo || arrival.date || status !== 'TRACKING');
  if (!useful) return null;

  return {
    useful: true,
    shipment: {
      mawb,
      carrierCode: 'QR',
      airlineName: airline.name,
      origin,
      destination,
      bags: pieces,
      pieces,
      weight,
      flightNo,
      arrivalDate: arrival.date,
      arrivalTime: arrival.time,
      arrivalIsActual,
      status,
      officialTracker: URL,
      source: 'Qatar Airways Cargo official network response'
    },
    debug: {
      legs: flights.length,
      events: events.length,
      finalLegArrivalRaw: clean(finalLeg.arrivalDate || ''),
      statusRaw: clean(authoritativeStatus)
    }
  };
}

function parseTextFallback(raw, mawb) {
  const text = clean(raw);
  const digits = mawb.replace(/\D/g, '');
  const serial = digits.slice(3);
  if (/no (?:shipment|record|result)|not found|invalid (?:awb|mawb|air waybill)|unable to find|no data/i.test(text)) return { notFound: true };
  const seen = text.includes(mawb) || text.includes(digits) || text.includes(serial);
  if (!seen) return null;

  const route = text.match(/\b([A-Z]{3})\s*(?:-|–|—|→|>)\s*([A-Z]{3})\b/);
  const origin = ((text.match(/(?:origin|from|departure(?: airport)?)\s*[:\-]?\s*([A-Z]{3})\b/i) || [])[1] || route?.[1] || '').toUpperCase();
  const destination = ((text.match(/(?:destination|to|arrival(?: airport| station)?)\s*[:\-]?\s*([A-Z]{3})\b/i) || [])[1] || route?.[2] || '').toUpperCase();
  const pieces = (text.match(/(?:pieces?|pcs?|bags?)\s*[:#-]?\s*(\d{1,6})\b/i) || [])[1] || '';
  const weight = ((text.match(/(?:gross\s+weight|weight)\s*[:#-]?\s*([\d,.]+)/i) || [])[1] || '').replace(/,/g, '');
  const flightMatches = [...text.matchAll(/\bQR[-\s]?(\d{2,4})\b/ig)];
  const flightNo = flightMatches.length ? `QR${flightMatches.at(-1)[1]}` : '';
  let arrival = parseDateTime((text.match(/(?:actual arrival|arrived(?: at)?|\bARR\b)[\s\S]{0,220}/i) || [])[0] || '');
  const actual = Boolean(arrival.date);
  if (!arrival.date) arrival = parseDateTime((text.match(/(?:estimated arrival|expected arrival|\bETA\b|scheduled arrival)[\s\S]{0,240}/i) || [])[0] || '');
  const status = statusFromAuthoritative(text);
  const useful = Boolean(origin || destination || pieces || weight || flightNo || arrival.date || status !== 'TRACKING');
  if (!useful) return null;
  return { useful: true, shipment: { mawb, carrierCode:'QR', airlineName:airline.name, origin, destination, bags:pieces, pieces, weight, flightNo, arrivalDate:arrival.date, arrivalTime:arrival.time, arrivalIsActual:actual, status, officialTracker:URL, source:'Qatar Airways Cargo official website' } };
}

async function deepText(page) {
  const texts = [];
  for (const frame of page.frames()) {
    try {
      const t = await frame.evaluate(() => {
        const parts = [];
        const walk = root => {
          if (!root?.querySelectorAll) return;
          if (root instanceof ShadowRoot && root.textContent?.trim()) parts.push(root.textContent);
          for (const el of root.querySelectorAll('*')) if (el.shadowRoot) walk(el.shadowRoot);
        };
        if (document.body?.innerText) parts.push(document.body.innerText);
        walk(document);
        return parts.join('\n');
      });
      if (t) texts.push(t);
    } catch {}
  }
  return texts.join('\n');
}

async function deepElements(page, selector) {
  const all = [];
  for (const frame of page.frames()) {
    try {
      const handle = await frame.evaluateHandle(sel => {
        const out = [], seen = new Set();
        const walk = root => {
          if (!root?.querySelectorAll) return;
          for (const el of root.querySelectorAll(sel)) if (!seen.has(el)) { seen.add(el); out.push(el); }
          for (const el of root.querySelectorAll('*')) if (el.shadowRoot) walk(el.shadowRoot);
        };
        walk(document);
        return out;
      }, selector);
      const props = await handle.getProperties();
      for (const prop of props.values()) {
        const element = prop.asElement();
        if (element) all.push({ frame, element });
      }
      await handle.dispose();
    } catch {}
  }
  return all;
}

async function typeValue(page, element, value) {
  await element.click({ clickCount: 3 });
  await page.keyboard.press('Backspace');
  await element.type(value, { delay: 45 });
  return element.evaluate(el => String(el.value || ''));
}

async function submitMawb(page, mawb) {
  const digits = mawb.replace(/\D/g, '');
  const prefix = digits.slice(0, 3);
  const serial = digits.slice(3);
  let candidates = [];
  for (const { frame, element } of await deepElements(page, 'input[type="text"],input:not([type])')) {
    try {
      const meta = await element.evaluate(el => {
        const r = el.getBoundingClientRect();
        return {
          visible: r.width > 3 && r.height > 3 && !el.disabled && !el.readOnly,
          max: Number(el.maxLength || -1),
          value: String(el.value || ''),
          hint: `${el.placeholder || ''} ${el.name || ''} ${el.id || ''} ${el.getAttribute('aria-label') || ''}`
        };
      });
      if (meta.visible) candidates.push({ frame, element, meta });
    } catch {}
  }
  if (!candidates.length) return { ok:false, reason:'QATAR_AWB_INPUTS_NOT_FOUND' };

  let prefixField = candidates.find(x => x.meta.max === 3 || x.meta.value === '157' || /prefix/i.test(x.meta.hint));
  let numberField = candidates.find(x => x !== prefixField && (x.meta.max === 8 || /awb|air waybill|shipment|number/i.test(x.meta.hint))) || (prefixField ? candidates.find(x => x !== prefixField) : null);

  if (prefixField && prefixField.meta.value !== prefix) {
    const entered = await typeValue(page, prefixField.element, prefix);
    if (entered !== prefix) return { ok:false, reason:'QATAR_PREFIX_NOT_ACCEPTED', entered };
  }
  if (!numberField && candidates.length === 1) {
    const enteredPrefix = await typeValue(page, candidates[0].element, prefix);
    if (enteredPrefix !== prefix) return { ok:false, reason:'QATAR_PREFIX_NOT_ACCEPTED', entered:enteredPrefix };
    await page.keyboard.press('Tab');
    await sleep(900);
    return submitMawb(page, mawb);
  }
  if (!numberField) return { ok:false, reason:'QATAR_NUMBER_INPUT_NOT_FOUND', inputCount:candidates.length };

  const enteredSerial = await typeValue(page, numberField.element, serial);
  let tokenized = false;
  if (enteredSerial !== serial) {
    await sleep(250);
    tokenized = clean(await deepText(page)).includes(serial);
    if (!tokenized) return { ok:false, reason:'QATAR_NUMBER_NOT_ACCEPTED', entered:enteredSerial };
  }

  for (const { frame, element } of await deepElements(page, 'button,input[type="submit"],[role="button"]')) {
    try {
      const meta = await element.evaluate(el => {
        const r = el.getBoundingClientRect();
        return { visible:r.width > 3 && r.height > 3 && !el.disabled, text:String(el.innerText || el.value || el.getAttribute('aria-label') || '').trim() };
      });
      if (meta.visible && /track shipment|track|search/i.test(meta.text)) {
        await element.click({ delay:70 });
        return { ok:true, button:meta.text, tokenized };
      }
    } catch {}
  }
  await page.keyboard.press('Enter');
  return { ok:true, button:'ENTER', tokenized };
}

export async function trackQatarLiveV2(inputMawb) {
  const mawb = normalizeMawb(inputMawb);
  if (!/^157-\d{8}$/.test(mawb)) return { ok:false, technical:false, reason:'INVALID QATAR MAWB', airline, debug:{ stage:'QATAR_INVALID_MAWB' } };

  let browser;
  const debug = { stage:'QATAR_OPEN', officialUrl:URL };
  try {
    const mod = await import('puppeteer-core');
    const puppeteer = mod.default || mod;
    const launch = await browserConfig();
    debug.browser = launch.executablePath;
    browser = await puppeteer.launch({ ...launch, headless:true, defaultViewport:{ width:1440, height:1050 } });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36');
    await page.setExtraHTTPHeaders({ 'Accept-Language':'en-US,en;q=0.9' });

    const network = [];
    let capture = false;
    page.on('response', async response => {
      if (!capture) return;
      try {
        const url = response.url();
        const ct = String(response.headers()['content-type'] || '');
        if (!/(qrcargo|aura|apex|track|shipment|cargo|croamis|api)/i.test(url) && !/json/i.test(ct)) return;
        const body = await response.text();
        if (body && body.length < 350000 && /(cargoTracking|shipment|awb|origin|destination|arrival|pieces|weight|flight|movement|status|157)/i.test(body)) network.push({ url, body });
      } catch {}
    });

    await page.goto(URL, { waitUntil:'domcontentloaded', timeout:30000 });
    await sleep(3200);
    capture = true;
    debug.stage = 'QATAR_SUBMIT';
    const submit = await submitMawb(page, mawb);
    debug.submit = submit;
    if (!submit.ok) return { ok:false, technical:true, reason:submit.reason, airline, debug:{ ...debug, stage:'QATAR_FORM_FAILED' } };

    debug.stage = 'QATAR_WAIT_RESULT';
    for (let attempt = 0; attempt < 18; attempt += 1) {
      await sleep(attempt === 0 ? 1400 : 800);
      for (let i = network.length - 1; i >= 0; i -= 1) {
        const parsed = parseQatarStructured(network[i].body, mawb);
        if (parsed?.notFound) return { ok:false, notFound:true, technical:false, reason:'Qatar Airways Cargo returned no shipment record.', airline, debug:{ ...debug, stage:'QATAR_NO_RECORD', networkResponses:network.length } };
        if (parsed?.useful) return { ok:true, airline, shipment:parsed.shipment, debug:{ ...debug, ...parsed.debug, stage:'QATAR_SUCCESS_NETWORK', networkResponses:network.length } };
      }
      const pageParsed = parseTextFallback(await deepText(page), mawb);
      if (pageParsed?.notFound) return { ok:false, notFound:true, technical:false, reason:'Qatar Airways Cargo returned no shipment record.', airline, debug:{ ...debug, stage:'QATAR_NO_RECORD_PAGE', networkResponses:network.length } };
      if (pageParsed?.useful) return { ok:true, airline, shipment:pageParsed.shipment, debug:{ ...debug, stage:'QATAR_SUCCESS_PAGE', networkResponses:network.length } };
    }

    return { ok:false, technical:true, reason:'Qatar accepted the MAWB but Mayavi could not parse the returned shipment data.', airline, debug:{ ...debug, stage:'QATAR_RESULT_UNREADABLE', networkResponses:network.length, preview:clean(await deepText(page)).slice(0,700) } };
  } catch (error) {
    return { ok:false, technical:true, reason:error?.message || 'Qatar official tracker failed.', airline, debug:{ ...debug, stage:'QATAR_BROWSER_ERROR' } };
  } finally {
    if (browser) try { await browser.close(); } catch {}
  }
}
