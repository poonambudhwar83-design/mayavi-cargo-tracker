import fs from 'node:fs';
import { normalizeMawb } from '../airlines.js';

const QATAR_URL = 'https://www.qrcargo.com/s/track-your-shipment';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const clean = value => String(value || '').replace(/\s+/g, ' ').trim();

async function browserConfig() {
  const candidates = [
    process.env.CHROME_EXECUTABLE_PATH,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable'
  ].filter(Boolean);

  for (const executablePath of candidates) {
    if (fs.existsSync(executablePath)) {
      return {
        executablePath,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-zygote']
      };
    }
  }

  const chromiumModule = await import('@sparticuz/chromium');
  const chromium = chromiumModule.default || chromiumModule;
  return { executablePath: await chromium.executablePath(), args: chromium.args };
}

function monthNumber(name = '') {
  return ({ jan:'01', feb:'02', mar:'03', apr:'04', may:'05', jun:'06', jul:'07', aug:'08', sep:'09', oct:'10', nov:'11', dec:'12' })[String(name).slice(0,3).toLowerCase()] || '';
}

function parseDateTime(raw = '') {
  const s = clean(raw);
  let m = s.match(/\b(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})/);
  if (m) return { date:`${m[1]}-${m[2]}-${m[3]}`, time:`${String(m[4]).padStart(2,'0')}:${m[5]}` };

  m = s.match(/\b(\d{1,2})[-\s/]([A-Za-z]{3,9})[-\s/,](\d{2,4})\s+(\d{1,2}):(\d{2})(?:\s*(AM|PM))?/i);
  if (!m) return { date:'', time:'' };
  let year = String(m[3]);
  if (year.length === 2) year = `20${year}`;
  const month = monthNumber(m[2]);
  if (!month) return { date:'', time:'' };
  let hour = Number(m[4]);
  const ap = String(m[6] || '').toUpperCase();
  if (ap === 'PM' && hour < 12) hour += 12;
  if (ap === 'AM' && hour === 12) hour = 0;
  return { date:`${year}-${month}-${String(m[1]).padStart(2,'0')}`, time:`${String(hour).padStart(2,'0')}:${m[5]}` };
}

function statusFromText(text = '') {
  if (/notified consignee/i.test(text)) return 'NOTIFIED CONSIGNEE';
  if (/received at destination|\bRCF\b/i.test(text)) return 'RECEIVED AT DESTINATION';
  if (/\bdelivered\b|\bDLV\b/i.test(text)) return 'DELIVERED';
  if (/\barrived\b|\blanded\b|\bARR\b/i.test(text)) return 'ARRIVED';
  if (/\bdelayed\b|\blate\b|exception/i.test(text)) return 'DELAYED';
  if (/\bdeparted\b|\bDEP\b|in[ -]?transit|airborne|in flight/i.test(text)) return 'IN TRANSIT';
  if (/\bbooked\b|\bRCS\b|manifested|received from shipper/i.test(text)) return 'BOOKED';
  return 'TRACKING';
}

function parseQatarText(raw, mawb) {
  const text = clean(raw);
  const digits = mawb.replace(/\D/g, '');
  const serial = digits.slice(3);

  if (/no (?:shipment|record|result)|not found|invalid (?:awb|mawb|air waybill)|unable to find/i.test(text)) {
    return { notFound:true };
  }

  const seen = text.includes(mawb) || text.includes(digits) || text.includes(serial);
  const route = text.match(/\b([A-Z]{3})\s*(?:-|–|—|→|>)\s*([A-Z]{3})\b/);
  const origin = ((text.match(/(?:origin|from|departure(?: airport)?)\s*[:\-]?\s*([A-Z]{3})\b/i) || [])[1] || route?.[1] || '').toUpperCase();
  const destination = ((text.match(/(?:destination|to|arrival(?: airport| station)?)\s*[:\-]?\s*([A-Z]{3})\b/i) || [])[1] || route?.[2] || '').toUpperCase();
  const pieces = (text.match(/(?:pieces?|pcs?|bags?)\s*[:#-]?\s*(\d{1,6})\b/i) || text.match(/\b(\d{1,6})\s*(?:pieces?|pcs?|bags?)\b/i) || [])[1] || '';
  const weight = ((text.match(/(?:gross\s+weight|weight)\s*[:#-]?\s*([\d,.]+)\s*(?:kg|kgs|kilograms?)?/i) || text.match(/([\d,.]+)\s*(?:kg|kgs|kilograms?)\b/i) || [])[1] || '').replace(/,/g,'');
  const flights = [...text.matchAll(/\bQR[-\s]?(\d{2,4})\b/ig)];
  const flightNo = flights.length ? `QR${flights.at(-1)[1]}` : '';

  let arrival = { date:'', time:'' };
  let actual = false;
  const actualChunk = (text.match(/(?:actual arrival|arrived(?: at)?|landed(?: at)?|\bARR\b)[\s\S]{0,260}/i) || [])[0] || '';
  arrival = parseDateTime(actualChunk);
  if (arrival.date) actual = true;
  if (!arrival.date) {
    const etaChunk = (text.match(/(?:estimated arrival|expected arrival|\bETA\b|scheduled arrival|arrival date(?:\/time)?)[\s\S]{0,280}/i) || [])[0] || '';
    arrival = parseDateTime(etaChunk);
  }

  const status = statusFromText(text);
  const useful = Boolean(seen && (origin || destination || pieces || weight || flightNo || arrival.date || status !== 'TRACKING'));

  return {
    useful,
    shipment: {
      mawb,
      carrierCode:'QR',
      airlineName:'Qatar Airways Cargo',
      origin,
      destination,
      bags:pieces,
      pieces,
      weight,
      flightNo,
      arrivalDate:arrival.date,
      arrivalTime:arrival.time,
      arrivalIsActual:actual,
      status,
      officialTracker:QATAR_URL,
      source:'Qatar Airways Cargo official website'
    }
  };
}

async function deepText(page) {
  return page.evaluate(() => {
    const parts = [];
    const walk = root => {
      if (!root) return;
      if (root instanceof ShadowRoot && root.textContent?.trim()) parts.push(root.textContent);
      if (!root.querySelectorAll) return;
      for (const el of root.querySelectorAll('*')) if (el.shadowRoot) walk(el.shadowRoot);
    };
    if (document.body?.innerText) parts.push(document.body.innerText);
    walk(document);
    return parts.join('\n');
  });
}

async function fillAndSubmit(page, mawb) {
  const digits = mawb.replace(/\D/g, '');
  const prefix = digits.slice(0,3);
  const serial = digits.slice(3);

  return page.evaluate(({ prefix, serial }) => {
    const findComponent = root => {
      if (!root?.querySelectorAll) return null;
      for (const el of root.querySelectorAll('*')) {
        if (el.tagName?.toLowerCase() === 'c-qcg_lwc_new-track_shipment_awb_search' && el.shadowRoot) return el.shadowRoot;
        if (el.shadowRoot) {
          const found = findComponent(el.shadowRoot);
          if (found) return found;
        }
      }
      return null;
    };

    const findAllDeep = (root, selector) => {
      const found = [];
      const seen = new Set();
      const walk = current => {
        if (!current?.querySelectorAll) return;
        for (const el of current.querySelectorAll(selector)) {
          if (!seen.has(el)) {
            seen.add(el);
            found.push(el);
          }
        }
        for (const el of current.querySelectorAll('*')) if (el.shadowRoot) walk(el.shadowRoot);
      };
      walk(root);
      return found;
    };

    const root = findComponent(document);
    if (!root) return { ok:false, reason:'QATAR_TRACK_COMPONENT_NOT_FOUND' };

    const textInputs = findAllDeep(root, 'input[type="text"]');
    const prefixInput = textInputs.find(el => Number(el.maxLength) === 3);
    const numberInput = textInputs.find(el => el !== prefixInput && !el.disabled && !el.readOnly);
    const button = findAllDeep(root, 'button,input[type="submit"],[role="button"]')
      .find(el => /track shipment/i.test(String(el.innerText || el.value || el.getAttribute('aria-label') || '')));

    if (!prefixInput || !numberInput) return { ok:false, reason:'QATAR_AWB_INPUTS_NOT_FOUND', inputCount:textInputs.length };
    if (!button) return { ok:false, reason:'QATAR_TRACK_BUTTON_NOT_FOUND', inputCount:textInputs.length };

    const setValue = (el, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (setter) setter.call(el, value); else el.value = value;
      el.focus();
      el.dispatchEvent(new Event('input', { bubbles:true, composed:true }));
      el.dispatchEvent(new Event('change', { bubbles:true, composed:true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { key:'Tab', bubbles:true, composed:true }));
      el.blur();
    };

    setValue(prefixInput, prefix);
    setValue(numberInput, serial);
    button.click();
    return { ok:true, prefixValue:prefixInput.value, serialLength:numberInput.value.length, button:String(button.innerText || button.value || '').trim() };
  }, { prefix, serial });
}

export async function trackQatar(inputMawb) {
  const mawb = normalizeMawb(inputMawb);
  if (!/^157-\d{8}$/.test(mawb)) {
    return { ok:false, technical:false, reason:'INVALID QATAR MAWB', airline:{ name:'Qatar Airways Cargo', iata:'QR', url:QATAR_URL }, debug:{ stage:'QATAR_INVALID_MAWB' } };
  }

  let browser;
  const airline = { name:'Qatar Airways Cargo', iata:'QR', url:QATAR_URL };
  const debug = { stage:'QATAR_OPEN', airline:airline.name, officialUrl:QATAR_URL };

  try {
    const puppeteerModule = await import('puppeteer-core');
    const puppeteer = puppeteerModule.default || puppeteerModule;
    const config = await browserConfig();
    debug.browser = config.executablePath;
    browser = await puppeteer.launch({ ...config, headless:true, defaultViewport:{ width:1440, height:1050 } });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36');
    await page.setExtraHTTPHeaders({ 'Accept-Language':'en-US,en;q=0.9' });
    await page.goto(QATAR_URL, { waitUntil:'domcontentloaded', timeout:30000 });
    await sleep(3200);

    debug.stage = 'QATAR_SUBMIT';
    const submit = await fillAndSubmit(page, mawb);
    debug.submit = submit;
    if (!submit.ok) return { ok:false, technical:true, reason:submit.reason, airline, debug:{ ...debug, stage:'QATAR_FORM_FAILED' } };

    debug.stage = 'QATAR_WAIT_RESULT';
    let last = '';
    for (let attempt = 0; attempt < 15; attempt += 1) {
      await sleep(attempt === 0 ? 1400 : 900);
      last = clean(await deepText(page));
      const parsed = parseQatarText(last, mawb);
      if (parsed.notFound) return { ok:false, notFound:true, technical:false, reason:'Qatar Airways Cargo returned no shipment record.', airline, debug:{ ...debug, stage:'QATAR_NO_RECORD' } };
      if (parsed.useful) return { ok:true, airline, shipment:parsed.shipment, debug:{ ...debug, stage:'QATAR_SUCCESS' } };
    }

    return { ok:false, technical:true, reason:'Qatar MAWB was submitted, but no machine-readable result was returned.', airline, debug:{ ...debug, stage:'QATAR_RESULT_UNREADABLE', resultPreview:last.slice(0,500) } };
  } catch (error) {
    return { ok:false, technical:true, reason:error?.message || 'Qatar official tracker failed.', airline, debug:{ ...debug, stage:'QATAR_BROWSER_ERROR' } };
  } finally {
    if (browser) try { await browser.close(); } catch {}
  }
}
