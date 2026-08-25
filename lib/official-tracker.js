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
  return {
    executablePath: await chromium.executablePath(),
    args: chromium.args
  };
}

function technicalBlock(text = '') {
  if (/captcha|verify (?:you are|that you are) human|i am not a robot|robot check|unusual traffic|cloudflare|security check|one moment please/i.test(text)) return 'CAPTCHA / ANTI-BOT';
  if (/access denied|forbidden|request blocked|not authorized/i.test(text)) return 'ACCESS BLOCKED';
  if (/sign in|log in|login required|register to track|please register|account required/i.test(text)) return 'LOGIN WALL';
  return '';
}

function statusFromText(text = '') {
  if (/notified consignee/i.test(text)) return 'NOTIFIED CONSIGNEE';
  if (/received at destination|\bRCF\b/i.test(text)) return 'RECEIVED AT DESTINATION';
  if (/\bdelivered\b|\bDLV\b/i.test(text)) return 'DELIVERED';
  if (/\barrived\b|\blanded\b|actual arrival/i.test(text)) return 'ARRIVED';
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
  const actualChunk = (text.match(/(?:actual arrival|arrived(?: at)?|landed(?: at)?)[\s\S]{0,180}/i) || [])[0] || '';
  let result = dateTimeFromText(actualChunk);
  if (result.date) return { ...result, actual: true };

  const etaChunk = (text.match(/(?:estimated arrival|expected arrival|\bETA\b|scheduled arrival|arrival date(?:\/time)?)[\s\S]{0,220}/i) || [])[0] || '';
  result = dateTimeFromText(etaChunk);
  if (result.date) return { ...result, actual: false };

  return { date: '', time: '', actual: false };
}

function parseResult(text, mawb, airline) {
  const compact = clean(text);
  const digits = mawb.replace(/\D/g, '');
  const serial = digits.slice(3);

  if (/no shipment|no record|not found|invalid (?:awb|air waybill)|unable to find|no data found|awb does not exist/i.test(compact)) {
    return { notFound: true };
  }

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

async function bodyText(page) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await page.evaluate(() => document.body?.innerText || '');
    } catch (error) {
      if (!/Execution context was destroyed|Cannot find context|detached/i.test(String(error?.message || error))) throw error;
      await sleep(500);
    }
  }
  return '';
}

async function visibleInputs(page) {
  const handles = await page.$$('input,textarea');
  const result = [];
  for (const handle of handles) {
    try {
      const meta = await handle.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
          visible: rect.width > 4 && rect.height > 4 && !element.disabled,
          type: String(element.type || 'text').toLowerCase(),
          label: `${element.placeholder || ''} ${element.name || ''} ${element.id || ''} ${element.getAttribute('aria-label') || ''}`,
          max: Number(element.maxLength || 0)
        };
      });
      if (meta.visible && !['hidden', 'checkbox', 'radio', 'file', 'password', 'email'].includes(meta.type)) result.push({ handle, meta });
    } catch {}
  }
  return result;
}

async function setValue(page, handle, value) {
  await page.evaluate((element, nextValue) => {
    const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (setter) setter.call(element, nextValue); else element.value = nextValue;
    element.focus();
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, handle, value);
}

async function submitMawb(page, mawb) {
  const digits = mawb.replace(/\D/g, '');
  const prefix = digits.slice(0, 3);
  const serial = digits.slice(3);
  const inputs = await visibleInputs(page);
  const label = (item) => String(item.meta.label || '');

  const prefixInput = inputs.find((item) => item.meta.max === 3 || /prefix|airline code/i.test(label(item)));
  const serialInput = inputs.find((item) => item !== prefixInput && (item.meta.max === 8 || /(awb|air waybill|waybill).*(number|no)|shipment.*number/i.test(label(item))));

  let target = null;
  if (prefixInput && serialInput) {
    await setValue(page, prefixInput.handle, prefix);
    await setValue(page, serialInput.handle, serial);
    target = serialInput.handle;
  } else {
    const one = inputs.find((item) => /awb|air waybill|waybill|shipment.*(?:track|number)|tracking.*number/i.test(label(item)))
      || inputs.find((item) => [8, 11, 12, 14].includes(item.meta.max));
    if (!one) return { ok: false, reason: 'TRACKING FORM NOT ACCESSIBLE' };
    const value = one.meta.max === 8 ? serial : one.meta.max === 11 ? digits : mawb;
    await setValue(page, one.handle, value);
    target = one.handle;
  }

  const buttons = await page.$$('button,input[type="submit"],input[type="button"],[role="button"]');
  for (const button of buttons) {
    try {
      const meta = await button.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { visible: rect.width > 4 && rect.height > 4 && !element.disabled, text: String(element.innerText || element.value || element.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim() };
      });
      if (meta.visible && /track|search|find|submit|enquir|inquir|^go$/i.test(meta.text)) {
        await button.click({ delay: 60 });
        return { ok: true, clicked: meta.text };
      }
    } catch {}
  }

  if (target) {
    try {
      await page.evaluate((element) => element.form?.requestSubmit?.(), target);
      return { ok: true, clicked: 'form.requestSubmit' };
    } catch {}
  }

  return { ok: false, reason: 'TRACK BUTTON NOT ACCESSIBLE' };
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

    browser = await puppeteer.launch({
      ...config,
      headless: true,
      defaultViewport: { width: 1440, height: 1050 }
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131 Safari/537.36');
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
    await page.goto(airline.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(1200);

    try {
      await page.evaluate(() => {
        const button = [...document.querySelectorAll('button')].find((element) => /accept all|accept cookies|allow all|agree/i.test((element.innerText || '').trim()));
        if (button) button.click();
      });
    } catch {}

    let text = await bodyText(page);
    let blocked = technicalBlock(text);
    if (blocked) return { ok: false, technical: true, reason: blocked, airline, debug: { ...debug, stage: 'OFFICIAL_BLOCKED' } };

    debug.stage = 'OFFICIAL_SUBMIT';
    const submitted = await submitMawb(page, mawb);
    debug.submit = submitted;
    if (!submitted.ok) return { ok: false, technical: true, reason: submitted.reason, airline, debug: { ...debug, stage: 'OFFICIAL_FORM_BLOCKED' } };

    await sleep(3500);
    try { await page.waitForNetworkIdle({ idleTime: 700, timeout: 9000 }); } catch {}
    text = await bodyText(page);
    blocked = technicalBlock(text);
    if (blocked) return { ok: false, technical: true, reason: blocked, airline, debug: { ...debug, stage: 'OFFICIAL_BLOCKED_AFTER_SUBMIT' } };

    const parsed = parseResult(text, mawb, airline);
    if (parsed.notFound) return { ok: false, technical: false, notFound: true, reason: 'Official airline website returned no shipment record.', airline, debug: { ...debug, stage: 'OFFICIAL_NO_RECORD' } };
    if (!parsed.useful) return { ok: false, technical: true, reason: 'Official page opened, but the live result was not machine-readable.', airline, debug: { ...debug, stage: 'OFFICIAL_RESULT_UNREADABLE' } };

    return { ok: true, airline, shipment: parsed.shipment, debug: { ...debug, stage: 'OFFICIAL_SUCCESS' } };
  } catch (error) {
    return { ok: false, technical: true, reason: error?.message || 'Official airline browser failed.', airline, debug: { ...debug, stage: 'OFFICIAL_BROWSER_ERROR' } };
  } finally {
    if (browser) {
      try { await browser.close(); } catch {}
    }
  }
}
