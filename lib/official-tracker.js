import fs from 'node:fs';
import { airlineForMawb, normalizeMawb } from './airlines.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();

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

function technicalBlock(text = '') {
  if (/captcha|verify (?:you are|that you are) human|i am not a robot|robot check|unusual traffic|cloudflare|security check|one moment please/i.test(text)) return 'CAPTCHA / ANTI-BOT';
  if (/access denied|forbidden|request blocked|not authorized/i.test(text)) return 'ACCESS BLOCKED';
  if (/login required|sign[- ]?in required|register to track|please register to track|account required to track/i.test(text)) return 'LOGIN WALL';
  return '';
}

function statusFromText(text = '') {
  if (/notified consignee/i.test(text)) return 'NOTIFIED CONSIGNEE';
  if (/received at destination|\bRCF\b/i.test(text)) return 'RECEIVED AT DESTINATION';
  if (/\bdelivered\b|\bDLV\b/i.test(text)) return 'DELIVERED';
  if (/\barrived\b|\blanded\b|actual arrival|\bARR\b/i.test(text)) return 'ARRIVED';
  if (/\bdelayed\b|\blate\b|exception/i.test(text)) return 'DELAYED';
  if (/\bdeparted\b|\bDEP\b|in[ -]?transit|airborne|in flight/i.test(text)) return 'IN TRANSIT';
  if (/\bbooked\b|\bRCS\b|received from shipper|manifested/i.test(text)) return 'BOOKED';
  return 'TRACKING';
}

function monthNumber(name = '') {
  const months = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
  return months[String(name).slice(0, 3).toLowerCase()] || '';
}

function dateTimeFromText(raw = '') {
  const s = clean(raw);
  let match = s.match(/\b(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})/);
  if (match) return { date: `${match[1]}-${match[2]}-${match[3]}`, time: `${String(match[4]).padStart(2, '0')}:${match[5]}` };

  match = s.match(/\b(\d{1,2})[-\s/]([A-Za-z]{3,9})[-\s/,](\d{2,4})\s+(\d{1,2}):(\d{2})(?:\s*(AM|PM))?/i);
  if (!match) return { date: '', time: '' };

  let year = String(match[3]);
  if (year.length === 2) year = `20${year}`;
  const month = monthNumber(match[2]);
  if (!month) return { date: '', time: '' };

  let hour = Number(match[4]);
  const ampm = String(match[6] || '').toUpperCase();
  if (ampm === 'PM' && hour < 12) hour += 12;
  if (ampm === 'AM' && hour === 12) hour = 0;

  return {
    date: `${year}-${month}-${String(match[1]).padStart(2, '0')}`,
    time: `${String(hour).padStart(2, '0')}:${match[5]}`
  };
}

function extractArrival(text = '') {
  const chunks = [
    { re: /(?:actual arrival|arrived(?: at)?|landed(?: at)?|\bARR\b)[\s\S]{0,240}/i, actual: true },
    { re: /(?:estimated arrival|expected arrival|\bETA\b|scheduled arrival|arrival date(?:\/time)?)[\s\S]{0,260}/i, actual: false }
  ];

  for (const item of chunks) {
    const chunk = (text.match(item.re) || [])[0] || '';
    const result = dateTimeFromText(chunk);
    if (result.date) return { ...result, actual: item.actual };
  }

  if (/\barrived\b|\blanded\b|\bdelivered\b|\bRCF\b|\bDLV\b/i.test(text)) {
    const dates = [...text.matchAll(/\b(\d{1,2}[-\s/][A-Za-z]{3,9}[-\s/,]\d{2,4}\s+\d{1,2}:\d{2}(?:\s*(?:AM|PM))?)/ig)];
    if (dates.length) {
      const result = dateTimeFromText(dates.at(-1)[1]);
      if (result.date) return { ...result, actual: true };
    }
  }

  return { date: '', time: '', actual: false };
}

function parseResult(text, mawb, airline) {
  const compact = clean(text);
  const digits = mawb.replace(/\D/g, '');
  const serial = digits.slice(3);

  if (/no shipment|no record|not found|invalid (?:awb|air waybill)|unable to find|no data found|awb does not exist/i.test(compact)) return { notFound: true };

  const seen = compact.includes(mawb) || compact.includes(digits) || compact.includes(serial);
  const route = compact.match(/\b([A-Z]{3})\s*(?:-|–|—|→|>)\s*([A-Z]{3})\b/);
  const origin = ((compact.match(/(?:origin|from|departure(?: airport)?)\s*[:\-]?\s*([A-Z]{3})\b/i) || [])[1] || route?.[1] || '').toUpperCase();
  const destination = ((compact.match(/(?:destination|to|arrival(?: airport| station)?)\s*[:\-]?\s*([A-Z]{3})\b/i) || [])[1] || route?.[2] || '').toUpperCase();
  const pieces = (compact.match(/(?:pieces?|pcs?|bags?)\s*[:#-]?\s*(\d{1,6})\b/i) || compact.match(/\b(\d{1,6})\s*(?:pieces?|pcs?|bags?)\b/i) || [])[1] || '';
  const weight = ((compact.match(/(?:gross\s+weight|weight)\s*[:#-]?\s*([\d,.]+)\s*(?:kg|kgs|kilograms?)?/i) || compact.match(/([\d,.]+)\s*(?:kg|kgs|kilograms?)\b/i) || [])[1] || '').replace(/,/g, '');
  const flightRegex = airline.iata ? new RegExp(`\\b${airline.iata}[-\\s]?(\\d{2,4})\\b`, 'ig') : null;
  const flights = flightRegex ? [...compact.matchAll(flightRegex)] : [];
  const flightNo = flights.length ? `${airline.iata}${flights.at(-1)[1]}` : '';
  const arrival = extractArrival(compact);
  const status = statusFromText(compact);
  const useful = Boolean(seen && (origin || destination || pieces || weight || flightNo || arrival.date || status !== 'TRACKING'));

  return {
    useful,
    shipment: {
      mawb,
      carrierCode: airline.iata,
      airlineName: airline.name,
      origin,
      destination,
      bags: pieces,
      pieces,
      weight,
      flightNo,
      arrivalDate: arrival.date,
      arrivalTime: arrival.time,
      arrivalIsActual: arrival.actual,
      status,
      officialTracker: airline.url,
      source: `${airline.name} official website`
    }
  };
}

async function deepElementHandles(context, selector) {
  const arrayHandle = await context.evaluateHandle((sel) => {
    const found = [];
    const seen = new Set();
    const walk = (root) => {
      if (!root?.querySelectorAll) return;
      for (const element of root.querySelectorAll(sel)) {
        if (!seen.has(element)) { seen.add(element); found.push(element); }
      }
      for (const element of root.querySelectorAll('*')) {
        if (element.shadowRoot) walk(element.shadowRoot);
      }
    };
    walk(document);
    return found;
  }, selector);

  const properties = await arrayHandle.getProperties();
  const elements = [];
  for (const property of properties.values()) {
    const element = property.asElement();
    if (element) elements.push(element);
  }
  await arrayHandle.dispose();
  return elements;
}

async function contextDeepText(context) {
  return context.evaluate(() => {
    const parts = [];
    const walk = (root) => {
      if (!root) return;
      if (root instanceof ShadowRoot) {
        const text = root.textContent || '';
        if (text.trim()) parts.push(text);
      }
      if (!root.querySelectorAll) return;
      for (const element of root.querySelectorAll('*')) {
        if (element.shadowRoot) walk(element.shadowRoot);
      }
    };
    if (document.body?.innerText) parts.push(document.body.innerText);
    walk(document);
    return parts.join('\n');
  });
}

async function pageDeepText(page) {
  const texts = [];
  for (const frame of page.frames()) {
    try {
      const text = await contextDeepText(frame);
      if (text) texts.push(text);
    } catch {}
  }
  return clean(texts.join('\n'));
}

async function clickConsent(page) {
  for (const frame of page.frames()) {
    const buttons = await deepElementHandles(frame, 'button,input[type="button"],input[type="submit"],[role="button"]');
    for (const button of buttons) {
      try {
        const text = await frame.evaluate((element) => String(element.innerText || element.value || element.getAttribute('aria-label') || '').trim(), button);
        if (/accept all|accept cookies|allow all|agree/i.test(text)) {
          await button.click({ delay: 40 });
          return true;
        }
      } catch {}
    }
  }
  return false;
}

async function visibleInputs(page) {
  const result = [];
  for (const frame of page.frames()) {
    let handles = [];
    try { handles = await deepElementHandles(frame, 'input,textarea'); } catch { continue; }
    for (const handle of handles) {
      try {
        const meta = await frame.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          const labelElement = element.labels?.[0];
          return {
            visible: rect.width > 3 && rect.height > 3 && !element.disabled,
            type: String(element.type || 'text').toLowerCase(),
            label: `${element.placeholder || ''} ${element.name || ''} ${element.id || ''} ${element.getAttribute('aria-label') || ''} ${labelElement?.innerText || ''}`,
            max: Number(element.maxLength || 0),
            value: String(element.value || ''),
            readOnly: Boolean(element.readOnly)
          };
        }, handle);
        if (meta.visible && !['hidden', 'checkbox', 'radio', 'file', 'password', 'email'].includes(meta.type)) result.push({ frame, handle, meta });
      } catch {}
    }
  }
  return result;
}

async function setValue(frame, handle, value) {
  await frame.evaluate((element, nextValue) => {
    const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (setter) setter.call(element, nextValue); else element.value = nextValue;
    element.focus();
    element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    element.dispatchEvent(new KeyboardEvent('keyup', { key: 'Tab', bubbles: true, composed: true }));
    element.blur();
  }, handle, value);
}

async function clickTrack(page) {
  for (const frame of page.frames()) {
    let buttons = [];
    try { buttons = await deepElementHandles(frame, 'button,input[type="submit"],input[type="button"],[role="button"],a[role="button"]'); } catch { continue; }
    for (const button of buttons) {
      try {
        const meta = await frame.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return {
            visible: rect.width > 3 && rect.height > 3 && !element.disabled,
            text: String(element.innerText || element.value || element.getAttribute('aria-label') || element.title || '').replace(/\s+/g, ' ').trim()
          };
        }, button);
        if (meta.visible && /track(?: shipment)?|search|find|submit|enquir|inquir|^go$/i.test(meta.text)) {
          await button.click({ delay: 70 });
          return meta.text;
        }
      } catch {}
    }
  }
  return '';
}

async function submitMawb(page, mawb) {
  const digits = mawb.replace(/\D/g, '');
  const prefix = digits.slice(0, 3);
  const serial = digits.slice(3);
  const inputs = await visibleInputs(page);
  const label = (item) => `${item.meta.label || ''} ${item.meta.value || ''}`;

  const serialInput = inputs.find((item) => item.meta.max === 8 && !item.meta.readOnly)
    || inputs.find((item) => /(awb|air waybill|waybill|shipment).*(number|no)|number.*(?:awb|shipment)/i.test(label(item)) && !item.meta.readOnly);
  const prefixInput = inputs.find((item) => item !== serialInput && (item.meta.max === 3 || /prefix|airline code/i.test(label(item))) && !item.meta.readOnly);

  let target = null;
  if (serialInput && (prefixInput || serialInput.meta.max === 8)) {
    if (prefixInput) await setValue(prefixInput.frame, prefixInput.handle, prefix);
    await setValue(serialInput.frame, serialInput.handle, serial);
    target = serialInput;
  } else {
    const one = inputs.find((item) => /awb|air waybill|waybill|shipment.*(?:track|number)|tracking.*number/i.test(label(item)) && !item.meta.readOnly)
      || inputs.find((item) => [11, 12, 14].includes(item.meta.max) && !item.meta.readOnly);
    if (!one) return { ok: false, reason: 'TRACKING FORM NOT ACCESSIBLE', inputCount: inputs.length };
    const value = one.meta.max === 11 ? digits : mawb;
    await setValue(one.frame, one.handle, value);
    target = one;
  }

  const clicked = await clickTrack(page);
  if (clicked) return { ok: true, clicked, inputCount: inputs.length };

  if (target) {
    try {
      await target.frame.evaluate((element) => {
        if (element.form?.requestSubmit) element.form.requestSubmit();
        else element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, composed: true }));
      }, target.handle);
      return { ok: true, clicked: 'form/enter fallback', inputCount: inputs.length };
    } catch {}
  }

  return { ok: false, reason: 'TRACK BUTTON NOT ACCESSIBLE', inputCount: inputs.length };
}

async function waitForResult(page, mawb, airline) {
  let lastText = '';
  for (let attempt = 0; attempt < 14; attempt += 1) {
    await sleep(attempt === 0 ? 1200 : 800);
    lastText = await pageDeepText(page);
    const blocked = technicalBlock(lastText);
    if (blocked) return { blocked, text: lastText };
    const parsed = parseResult(lastText, mawb, airline);
    if (parsed.notFound || parsed.useful) return { parsed, text: lastText };
  }
  return { text: lastText };
}

export async function trackOfficial(inputMawb) {
  const mawb = normalizeMawb(inputMawb);
  if (!mawb) return { ok: false, technical: false, reason: 'INVALID MAWB', airline: null, debug: { stage: 'INVALID_MAWB' } };

  const airline = airlineForMawb(mawb);
  if (!airline) return { ok: false, technical: false, reason: 'NO OFFICIAL TRACKER MAPPED FOR THIS PREFIX', airline: null, debug: { stage: 'NO_OFFICIAL_TRACKER' } };

  let browser;
  const debug = { stage: 'OFFICIAL_OPEN', airline: airline.name, officialUrl: airline.url };
  try {
    const puppeteerModule = await import('puppeteer-core');
    const puppeteer = puppeteerModule.default || puppeteerModule;
    const config = await browserConfig();
    debug.browser = config.executablePath;

    browser = await puppeteer.launch({ ...config, headless: true, defaultViewport: { width: 1440, height: 1050 } });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131 Safari/537.36');
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
    await page.goto(airline.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(1800);
    await clickConsent(page);
    await sleep(500);

    let text = await pageDeepText(page);
    let blocked = technicalBlock(text);
    if (blocked) return { ok: false, technical: true, reason: blocked, airline, debug: { ...debug, stage: 'OFFICIAL_BLOCKED' } };

    debug.stage = 'OFFICIAL_SUBMIT';
    const submitted = await submitMawb(page, mawb);
    debug.submit = submitted;
    debug.frames = page.frames().length;
    if (!submitted.ok) return { ok: false, technical: true, reason: submitted.reason, airline, debug: { ...debug, stage: 'OFFICIAL_FORM_BLOCKED' } };

    const result = await waitForResult(page, mawb, airline);
    text = result.text || '';
    blocked = result.blocked || technicalBlock(text);
    if (blocked) return { ok: false, technical: true, reason: blocked, airline, debug: { ...debug, stage: 'OFFICIAL_BLOCKED_AFTER_SUBMIT' } };

    const parsed = result.parsed || parseResult(text, mawb, airline);
    if (parsed.notFound) return { ok: false, technical: false, notFound: true, reason: 'Official airline website returned no shipment record.', airline, debug: { ...debug, stage: 'OFFICIAL_NO_RECORD' } };
    if (!parsed.useful) return { ok: false, technical: true, reason: 'Official page opened and MAWB was submitted, but the live result was not machine-readable.', airline, debug: { ...debug, stage: 'OFFICIAL_RESULT_UNREADABLE' } };

    return { ok: true, airline, shipment: parsed.shipment, debug: { ...debug, stage: 'OFFICIAL_SUCCESS' } };
  } catch (error) {
    return { ok: false, technical: true, reason: error?.message || 'Official airline browser failed.', airline, debug: { ...debug, stage: 'OFFICIAL_BROWSER_ERROR' } };
  } finally {
    if (browser) {
      try { await browser.close(); } catch {}
    }
  }
}
