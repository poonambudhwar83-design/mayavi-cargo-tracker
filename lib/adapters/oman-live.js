import fs from 'node:fs';
import { normalizeMawb } from '../airlines.js';

const OMAN = {
  name: 'Oman Air Cargo',
  iata: 'WY',
  url: 'https://cargo.omanair.com/track-shipment'
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const clean = value => String(value || '').replace(/\r/g, '').trim();

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

function normalizeDate(value = '') {
  const s = String(value).trim();
  let m = s.match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})\b/);
  if (m) return `${m[3]}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
  m = s.match(/\b(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})\b/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  return '';
}

function firstTimeAfterLabel(text = '', labelRx) {
  const rx = new RegExp(`${labelRx.source}[^0-9]{0,20}(\\d{1,2}:\\d{2})`, 'i');
  return text.match(rx)?.[1] || '';
}

function parseLatestBottomEvent(rawText = '', mawb = '') {
  const lines = clean(rawText)
    .split('\n')
    .map(x => x.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  // Oman Air shows Booking and Acceptance Information chronologically.
  // The latest event is the BOTTOM event row, so always choose the last
  // Expected / Departed / Arrived marker visible in page order.
  const eventRows = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const match = line.match(/\b(Expected|Departed|Arrived)\b/i);
    if (match) eventRows.push({ index: i, status: match[1].toUpperCase() });
  }
  if (!eventRows.length) return null;

  const latest = eventRows[eventRows.length - 1];
  const nextEventIndex = eventRows.find(x => x.index > latest.index)?.index ?? lines.length;
  const start = Math.max(0, latest.index - 2);
  const end = Math.min(lines.length, Math.max(latest.index + 24, nextEventIndex));
  const block = lines.slice(start, end).join(' | ');
  const allText = lines.join(' | ');

  const route = block.match(/\b([A-Z]{3})\s*(?:→|->|>|-|–|—|TO)\s*([A-Z]{3})\b/i)
    || allText.match(/\b([A-Z]{3})\s*(?:→|->|>|-|–|—|TO)\s*([A-Z]{3})\b/i);
  const origin = route?.[1]?.toUpperCase() || '';
  const destination = route?.[2]?.toUpperCase() || '';

  const flightNo = (block.match(/\bWY\s*[- ]?(\d{2,4})\b/i)?.[1]
    ? `WY${block.match(/\bWY\s*[- ]?(\d{2,4})\b/i)[1]}`
    : '') || (allText.match(/\bWY\s*[- ]?(\d{2,4})\b/i)?.[1] ? `WY${allText.match(/\bWY\s*[- ]?(\d{2,4})\b/i)[1]}` : '');

  const dateRaw = block.match(/\b\d{1,2}[\/-]\d{1,2}[\/-]\d{4}\b/)?.[0]
    || block.match(/\b\d{4}[\/-]\d{1,2}[\/-]\d{1,2}\b/)?.[0]
    || '';
  const arrivalDate = normalizeDate(dateRaw);

  const eta = firstTimeAfterLabel(block, /\bETA\b/i)
    || block.match(/\b(?:arrival|arriving)[^0-9]{0,20}(\d{1,2}:\d{2})/i)?.[1]
    || '';
  const ata = firstTimeAfterLabel(block, /\bATA\b|actual\s+arrival/i);
  const arrivalTime = latest.status === 'ARRIVED' ? (ata || eta) : eta;

  const pieces = allText.match(/\b(\d{1,5})\s*(?:P|PCS|PIECES?)\b/i)?.[1]
    || allText.match(/(?:pieces?|pcs?)\s*[:\-]?\s*(\d{1,5})/i)?.[1]
    || '';
  const weight = allText.match(/\b([\d,.]+)\s*(?:KGS?|KG)\b/i)?.[1]?.replace(/,/g, '') || '';

  const status = latest.status === 'ARRIVED' ? 'ARRIVED' : 'IN TRANSIT';
  const actualArrival = latest.status === 'ARRIVED' && arrivalDate && arrivalTime
    ? `${arrivalDate}T${arrivalTime}:00`
    : null;
  const etaValue = arrivalDate && arrivalTime ? `${arrivalDate}T${arrivalTime}:00` : null;

  return {
    mawb,
    carrierCode: 'WY',
    airlineName: OMAN.name,
    origin,
    destination,
    bags: pieces,
    pieces,
    weight,
    flightNo,
    arrivalDate,
    arrivalTime,
    arrivalIsActual: latest.status === 'ARRIVED',
    eta: etaValue,
    actualArrival,
    status,
    latestOfficialEvent: latest.status,
    officialTracker: OMAN.url,
    source: 'Oman Air Cargo official tracker — latest bottom event'
  };
}

async function fillAndSubmit(page, mawb) {
  const digits = mawb.replace(/\D/g, '');
  const prefix = digits.slice(0, 3);
  const serial = digits.slice(3);

  for (const frame of page.frames()) {
    const inputs = await frame.$$('input:not([type="hidden"]), textarea');
    const visible = [];
    for (const input of inputs) {
      try {
        const meta = await input.evaluate(el => {
          const r = el.getBoundingClientRect();
          return {
            visible: r.width > 3 && r.height > 3 && !el.disabled && !el.readOnly,
            max: Number(el.maxLength || -1),
            hint: `${el.placeholder || ''} ${el.name || ''} ${el.id || ''} ${el.getAttribute('aria-label') || ''}`
          };
        });
        if (meta.visible) visible.push({ input, meta });
      } catch {}
    }
    if (!visible.length) continue;

    const prefixInput = visible.find(x => x.meta.max === 3 || /prefix|airline code/i.test(x.meta.hint));
    let awbInput = visible.find(x => x !== prefixInput && (x.meta.max === 8 || /awb|air waybill|shipment|track/i.test(x.meta.hint)));
    if (!awbInput) awbInput = visible.find(x => [11, 12, 14].includes(x.meta.max));
    if (!awbInput && visible.length === 1) awbInput = visible[0];
    if (!awbInput) continue;

    if (prefixInput && awbInput !== prefixInput) {
      await prefixInput.input.click({ clickCount: 3 });
      await page.keyboard.press('Backspace');
      await prefixInput.input.type(prefix, { delay: 25 });
      await awbInput.input.click({ clickCount: 3 });
      await page.keyboard.press('Backspace');
      await awbInput.input.type(awbInput.meta.max === 8 ? serial : digits, { delay: 25 });
    } else {
      await awbInput.input.click({ clickCount: 3 });
      await page.keyboard.press('Backspace');
      await awbInput.input.type(awbInput.meta.max === 8 ? serial : digits, { delay: 25 });
    }

    const buttons = await frame.$$('button, input[type="submit"], input[type="button"], [role="button"]');
    for (const button of buttons) {
      try {
        const meta = await button.evaluate(el => {
          const r = el.getBoundingClientRect();
          return {
            visible: r.width > 3 && r.height > 3 && !el.disabled,
            text: String(el.innerText || el.value || el.getAttribute('aria-label') || '').trim()
          };
        });
        if (meta.visible && /track|search|submit|go/i.test(meta.text)) {
          await button.click({ delay: 40 });
          return true;
        }
      } catch {}
    }
    await page.keyboard.press('Enter');
    return true;
  }
  return false;
}

async function pageText(page) {
  const chunks = [];
  for (const frame of page.frames()) {
    try {
      const text = await frame.evaluate(() => document.body?.innerText || '');
      if (text) chunks.push(text);
    } catch {}
  }
  return chunks.join('\n');
}

export async function trackOmanLive(inputMawb) {
  const mawb = normalizeMawb(inputMawb);
  const digits = mawb.replace(/\D/g, '');
  if (!mawb || !digits.startsWith('910') || digits.length !== 11) {
    return { ok: false, technical: false, reason: 'Not an Oman Air MAWB.', airline: OMAN };
  }

  let browser;
  const debug = { stage: 'OMAN_OPEN', rule: 'BOTTOM_LATEST_EVENT', officialUrl: OMAN.url };
  try {
    const mod = await import('puppeteer-core');
    const puppeteer = mod.default || mod;
    const launch = await browserConfig();
    browser = await puppeteer.launch({ ...launch, headless: true, defaultViewport: { width: 1440, height: 1200 } });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36');
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
    await page.goto(OMAN.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(1800);

    const submitted = await fillAndSubmit(page, mawb);
    debug.submitted = submitted;
    if (!submitted) {
      return { ok: false, technical: true, reason: 'Oman Air tracking form was not accessible.', airline: OMAN, debug: { ...debug, stage: 'OMAN_FORM_NOT_FOUND' } };
    }

    for (let attempt = 0; attempt < 14; attempt += 1) {
      await sleep(attempt === 0 ? 1500 : 800);
      const text = await pageText(page);
      const parsed = parseLatestBottomEvent(text, mawb);
      if (parsed) {
        return {
          ok: true,
          airline: OMAN,
          shipment: parsed,
          debug: { ...debug, stage: 'OMAN_SUCCESS_BOTTOM_EVENT', latestOfficialEvent: parsed.latestOfficialEvent }
        };
      }
    }

    const preview = clean(await pageText(page)).replace(/\s+/g, ' ').slice(0, 900);
    return { ok: false, technical: true, reason: 'Oman Air result loaded but the latest event row could not be read.', airline: OMAN, debug: { ...debug, stage: 'OMAN_RESULT_UNREADABLE', preview } };
  } catch (error) {
    return { ok: false, technical: true, reason: error?.message || 'Oman Air official tracker failed.', airline: OMAN, debug: { ...debug, stage: 'OMAN_BROWSER_ERROR' } };
  } finally {
    if (browser) try { await browser.close(); } catch {}
  }
}
