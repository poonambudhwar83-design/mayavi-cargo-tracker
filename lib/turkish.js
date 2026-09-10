import fs from 'node:fs';
import { createWorker } from 'tesseract.js';
import { normalizeMawb } from './airlines.js';
import { dismissTurkishCookies } from './turkish-cookie.js';

const URL = 'https://turkishcargo.com/en/cargo-tracking';
const AIRLINE = { name:'Turkish Cargo', iata:'TK', url:URL };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const digitsOnly = value => String(value || '').replace(/\D/g, '');
const MONTH = { JAN:'01', FEB:'02', MAR:'03', APR:'04', MAY:'05', JUN:'06', JUL:'07', AUG:'08', SEP:'09', OCT:'10', NOV:'11', DEC:'12' };

async function browserConfig() {
  for (const p of [
    process.env.CHROME_EXECUTABLE_PATH,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable'
  ].filter(Boolean)) {
    if (fs.existsSync(p)) {
      return {
        executablePath:p,
        args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote']
      };
    }
  }
  const mod = await import('@sparticuz/chromium');
  const chromium = mod.default || mod;
  return { executablePath:await chromium.executablePath(), args:chromium.args };
}

function dateOnly(value='') {
  const s = clean(value);
  let m = s.match(/\b(20\d{2})[-\/.]([01]?\d)[-\/.]([0-3]?\d)\b/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`;
  m = s.match(/\b([0-3]?\d)[-\/.]([01]?\d)[-\/.](20\d{2})\b/);
  if (m) return `${m[3]}-${String(m[2]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`;
  m = s.match(/\b([0-3]?\d)\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s+(20\d{2})\b/i);
  if (m) return `${m[3]}-${MONTH[m[2].slice(0,3).toUpperCase()]}-${String(m[1]).padStart(2,'0')}`;
  return '';
}

function combineDateTime(date='', time='') {
  return date ? `${date}T${time || '00:00'}:00` : '';
}

function parseReservationRows(text='') {
  const rows = [];
  const rx = /\b(TK\s*0*\d{2,4})\b\s+(\d{1,2}[.\/-]\d{1,2}[.\/-]\d{4})\s+(\d{1,2}[.\/-]\d{1,2}[.\/-]\d{4})\s+(\d{1,2}:\d{2})\s+(\d{1,2}[.\/-]\d{1,2}[.\/-]\d{4})\s+(\d{1,2}:\d{2})\s+([A-Z]{3})\s*[-–—]\s*([A-Z]{3})\b/ig;
  for (const m of text.matchAll(rx)) {
    rows.push({
      flightNo:`TK${String(m[1]).replace(/\D/g,'').padStart(4,'0')}`,
      flightDate:dateOnly(m[2]),
      etaDate:dateOnly(m[3]),
      etaTime:m[4],
      etdDate:dateOnly(m[5]),
      etdTime:m[6],
      origin:m[7].toUpperCase(),
      destination:m[8].toUpperCase()
    });
  }
  return rows;
}

function parseStatusActual(text='', code='ARR') {
  const upperCode = String(code).toUpperCase();
  const rx = new RegExp(`\\b${upperCode}\\b\\s+Shipment\\s+(?:Arrived|Received From Flight|Delivered)[^]*?\\b([A-Z]{3})\\b(?:\\s+TK\\s*0*\\d{2,4})?[^]*?(\\d{1,2}[.\\/-]\\d{1,2}[.\\/-]\\d{4})\\s+(\\d{1,2}:\\d{2})`, 'i');
  const m = text.match(rx);
  if (!m) return null;
  return { station:m[1].toUpperCase(), date:dateOnly(m[2]), time:m[3] };
}

function parseBookingDate(text='') {
  const patterns = [
    /\bBKD\b\s+Shipment\s+Booked[^]*?(\d{1,2}[.\/-]\d{1,2}[.\/-]\d{4})\s+\d{1,2}:\d{2}/i,
    /\bBooking\s*Date\b\s*[:\-]?\s*(\d{1,2}[.\/-]\d{1,2}[.\/-]\d{4}|20\d{2}[.\/-]\d{1,2}[.\/-]\d{1,2})/i,
    /\bLast\s+Acceptance\s+Date\s+and\s+Time\s*:\s*(\d{1,2}[.\/-]\d{1,2}[.\/-]\d{4})/i
  ];
  for (const rx of patterns) {
    const m = text.match(rx);
    if (m) {
      const d = dateOnly(m[1]);
      if (d) return d;
    }
  }
  return '';
}

function parseTkSmart(cardText='', bodyText='', mawb='') {
  const card = clean(cardText);
  const body = clean(bodyText);
  const combined = clean(`${card} ${body}`);
  if (!combined) return null;
  if (/no (?:shipment|record|result)|not found|invalid (?:awb|air waybill)|no data/i.test(combined)) return { notFound:true };

  const digits = digitsOnly(mawb);
  const serial = digits.slice(3);
  const flat = digitsOnly(combined);
  const awbMatched = combined.includes(mawb) || combined.includes(digits) || combined.includes(serial) || flat.includes(digits) || flat.includes(serial);
  const looksLikeTk = /TK\s*SMART/i.test(combined) && /(piece|kg|\bFrom\b|\bTo\b|Delivered)/i.test(combined);
  if (!awbMatched && !looksLikeTk) return null;

  let origin = (card.match(/\bFrom\s+([A-Z]{3})\b/i) || body.match(/\bFrom\s+([A-Z]{3})\b/i) || [])[1] || '';
  let destination = (card.match(/\bTo\s+([A-Z]{3})\b/i) || body.match(/\bTo\s+([A-Z]{3})\b/i) || [])[1] || '';
  origin = origin.toUpperCase();
  destination = destination.toUpperCase();

  const originName = clean((card.match(/\bFrom\s+[A-Z]{3}\s*[-–—]?\s*([^]*?)(?=\bTo\s+[A-Z]{3}\b|\bDelivered\b|$)/i) || [])[1] || '').slice(0,120);
  const destinationName = clean((card.match(/\bTo\s+[A-Z]{3}\s*[-–—]?\s*([^]*?)(?=\bDelivered\b|\bDLV\b|$)/i) || [])[1] || '').slice(0,120);

  const pieces = (card.match(/\b(\d{1,6})\s*piece\s*\(?s?\)?/i) || combined.match(/\b(\d{1,6})\s*(?:pieces|pcs|bags)\b/i) || [])[1] || '';
  const weight = ((card.match(/\b([\d,.]+)\s*(?:kg|kgs)\b/i) || combined.match(/\b([\d,.]+)\s*(?:kg|kgs)\b/i) || [])[1] || '').replace(/,/g,'');
  const volume = ((card.match(/\b([\d,.]+)\s*(?:m3|m³|cbm)\b/i) || combined.match(/\b([\d,.]+)\s*(?:m3|m³|cbm)\b/i) || [])[1] || '').replace(/,/g,'');

  const reservationRows = parseReservationRows(body);
  const finalLeg = reservationRows.length ? reservationRows.at(-1) : null;
  if (finalLeg) {
    origin = origin || finalLeg.origin;
    destination = destination || finalLeg.destination;
  }

  let deliveryStation = '';
  let deliveryDate = '';
  let deliveryTime = '';
  const delivered = card.match(/Delivered\s*(?:-|–|—)?\s*([A-Z]{3})?\s*(\d{1,2}\s+[A-Za-z]{3}\s+\d{4}|\d{1,2}[.\/-]\d{1,2}[.\/-]\d{4})\s+(\d{1,2}:\d{2})/i);
  if (delivered) {
    deliveryStation = (delivered[1] || '').toUpperCase();
    deliveryDate = dateOnly(delivered[2]);
    deliveryTime = delivered[3];
  }

  const actualArr = parseStatusActual(body, 'ARR');
  const rcfArr = parseStatusActual(body, 'RCF');
  const actualArrival = actualArr || (rcfArr && rcfArr.station === destination ? rcfArr : null);

  const bookingDate = parseBookingDate(body);
  const upper = combined.toUpperCase();
  let status = 'BOOKED';
  if (/\bDLV\b|DELIVERED|\bARR\b\s+SHIPMENT\s+ARRIVED|RECEIVED FROM FLIGHT/.test(upper)) status = 'ARRIVED';
  else if (/DELAY|LATE|EXCEPTION/.test(upper)) status = 'DELAYED';
  else if (/\bDEP\b|DEPARTED|IN TRANSIT|AIRBORNE|IN FLIGHT/.test(upper)) status = 'IN TRANSIT';

  const arrivalDate = actualArrival?.date || finalLeg?.etaDate || '';
  const arrivalTime = actualArrival?.time || finalLeg?.etaTime || '';
  const scheduledArrivalDate = finalLeg?.etaDate || '';
  const scheduledArrivalTime = finalLeg?.etaTime || '';
  const scheduledDeparture = finalLeg?.etdDate ? combineDateTime(finalLeg.etdDate, finalLeg.etdTime) : '';
  const flightNo = finalLeg?.flightNo || '';
  const flightDate = finalLeg?.flightDate || '';

  const useful = Boolean((origin && destination) || pieces || weight || volume || flightNo || arrivalDate || deliveryDate || status === 'ARRIVED');
  if (!useful) return null;

  return {
    useful:true,
    shipment:{
      mawb,
      carrierCode:'TK',
      airlineName:'Turkish Cargo',
      officialTracker:URL,
      origin,
      originName,
      destination,
      destinationName,
      bags:pieces,
      pieces,
      weight,
      volume,
      flightNo,
      flightDate,
      bookingDate,
      scheduledArrivalDate,
      scheduledArrivalTime,
      scheduledDeparture,
      arrivalDate,
      arrivalTime,
      arrivalIsActual:Boolean(actualArrival?.date),
      actualArrivalDate:actualArrival?.date || '',
      actualArrivalTime:actualArrival?.time || '',
      actualArrival:actualArrival?.date ? combineDateTime(actualArrival.date, actualArrival.time) : '',
      deliveryStation,
      deliveryDate,
      deliveryTime,
      deliveredAt:deliveryDate ? combineDateTime(deliveryDate, deliveryTime) : '',
      status,
      source:'Turkish Cargo TK SMART / Cargo Tracking Information'
    }
  };
}

async function clearAndTypeInput(page, handle, value) {
  await handle.focus();
  await handle.evaluate(el => {
    const proto = Object.getPrototypeOf(el);
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(el, ''); else el.value = '';
    el.dispatchEvent(new Event('input', { bubbles:true }));
    el.dispatchEvent(new Event('change', { bubbles:true }));
  });
  await sleep(100);
  await handle.type(String(value), { delay:35 });
  await sleep(150);
  return handle.evaluate(el => String(el.value || ''));
}

async function clickAddOption(page, serial, timeout=9000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    for (const frame of page.frames()) {
      try {
        const marked = await frame.evaluate(awb => {
          for (const old of document.querySelectorAll('[data-mayavi-turkish-add]')) old.removeAttribute('data-mayavi-turkish-add');
          const norm = v => String(v || '').replace(/\s+/g,' ').trim();
          const visible = el => {
            const r = el.getBoundingClientRect();
            const st = getComputedStyle(el);
            return r.width > 3 && r.height > 3 && st.display !== 'none' && st.visibility !== 'hidden';
          };
          const selectors = 'mat-option,.mat-mdc-option,.mat-option,[role="option"],li,[class*="option"],[class*="autocomplete"],button,a,div,span,p';
          const matches = [...document.querySelectorAll(selectors)].filter(el => {
            if (!visible(el)) return false;
            const text = norm(el.innerText || el.textContent || '');
            return /^Add\s*:/i.test(text) && text.replace(/\D/g,'').includes(awb) && text.length <= 80;
          });
          if (!matches.length) return null;
          matches.sort((a,b) => {
            const aOption = a.matches('mat-option,.mat-mdc-option,.mat-option,[role="option"],li,[class*="option"]') ? 0 : 1;
            const bOption = b.matches('mat-option,.mat-mdc-option,.mat-option,[role="option"],li,[class*="option"]') ? 0 : 1;
            if (aOption !== bOption) return aOption - bOption;
            return norm(a.innerText || a.textContent || '').length - norm(b.innerText || b.textContent || '').length;
          });
          const leaf = matches[0];
          const option = leaf.closest('mat-option,.mat-mdc-option,.mat-option,[role="option"],li,[class*="option"],[class*="autocomplete"]') || leaf;
          option.setAttribute('data-mayavi-turkish-add','1');
          option.scrollIntoView({ block:'center', inline:'center', behavior:'auto' });
          return norm(option.innerText || option.textContent || '');
        }, serial);
        if (!marked) continue;
        const handle = await frame.$('[data-mayavi-turkish-add="1"]');
        if (!handle) continue;
        await handle.hover().catch(()=>{});
        await sleep(120);
        await handle.click({ delay:120 });
        await sleep(650);
        try { await handle.evaluate(el => el.removeAttribute('data-mayavi-turkish-add')); } catch {}
        return { ok:true, text:marked, clickMode:'REAL_ADD_OPTION_CLICK' };
      } catch {}
    }
    await sleep(350);
  }
  return { ok:false };
}

async function clickSearch(page, timeout=7000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    for (const frame of page.frames()) {
      try {
        const marked = await frame.evaluate(() => {
          for (const old of document.querySelectorAll('[data-mayavi-turkish-search]')) old.removeAttribute('data-mayavi-turkish-search');
          const norm = v => String(v || '').replace(/\s+/g,' ').trim();
          const visible = el => {
            const r = el.getBoundingClientRect();
            const st = getComputedStyle(el);
            return r.width > 3 && r.height > 3 && st.display !== 'none' && st.visibility !== 'hidden';
          };
          const matches = [...document.querySelectorAll('button,a,[role="button"],input[type="submit"],input[type="button"],div,span')]
            .filter(el => visible(el) && /^Search$/i.test(norm(el.innerText || el.textContent || el.value || '')));
          if (!matches.length) return false;
          matches.sort((a,b) => {
            const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
            const ac = a.matches('button,a,[role="button"],input[type="submit"],input[type="button"]') ? 0 : 1;
            const bc = b.matches('button,a,[role="button"],input[type="submit"],input[type="button"]') ? 0 : 1;
            return ac - bc || ar.width*ar.height - br.width*br.height;
          });
          const leaf = matches[0];
          const button = leaf.closest('button,a,[role="button"]') || leaf;
          if (button.disabled || button.getAttribute('aria-disabled') === 'true') return false;
          button.setAttribute('data-mayavi-turkish-search','1');
          button.scrollIntoView({ block:'center', behavior:'auto' });
          return true;
        });
        if (!marked) continue;
        const handle = await frame.$('[data-mayavi-turkish-search="1"]');
        if (!handle) continue;
        await handle.click({ delay:100 });
        try { await handle.evaluate(el => el.removeAttribute('data-mayavi-turkish-search')); } catch {}
        return { ok:true, text:'Search' };
      } catch {}
    }
    await sleep(300);
  }
  return { ok:false };
}

async function fillAddSearch(page, mawb) {
  const digits = digitsOnly(mawb);
  const prefix = digits.slice(0,3);
  const serial = digits.slice(3);

  for (const frame of page.frames()) {
    let inputs = [];
    try { inputs = await frame.$$('input:not([type="hidden"]),textarea'); } catch { continue; }
    const fields = [];
    for (const input of inputs) {
      try {
        const meta = await input.evaluate(el => {
          const r = el.getBoundingClientRect();
          return {
            visible:r.width > 3 && r.height > 3 && !el.disabled && !el.readOnly,
            max:Number(el.maxLength || -1),
            label:`${el.placeholder || ''} ${el.name || ''} ${el.id || ''} ${el.getAttribute('aria-label') || ''} ${el.labels?.[0]?.innerText || ''}`
          };
        });
        if (meta.visible) fields.push({ input, meta });
      } catch {}
    }

    const prefixField = fields.find(x => x.meta.max === 3 || /prefix|awb code|airline code/i.test(x.meta.label));
    let numberField = fields.find(x => x !== prefixField && (x.meta.max === 8 || /awb|air waybill|waybill/i.test(x.meta.label)));
    if (!numberField) numberField = fields.find(x => x !== prefixField && [11,12,14].includes(x.meta.max));
    if (!numberField) continue;

    if (prefixField) {
      const actualPrefix = await clearAndTypeInput(page, prefixField.input, prefix);
      if (actualPrefix !== prefix) return { ok:false, stage:'PREFIX_INPUT_MISMATCH', expectedPrefix:prefix, actualPrefix };
    }

    const wantedNumber = numberField.meta.max === 8 ? serial : (prefixField ? serial : digits);
    const actualNumber = await clearAndTypeInput(page, numberField.input, wantedNumber);
    if (actualNumber !== wantedNumber) return { ok:false, stage:'AWB_INPUT_MISMATCH', expectedNumber:wantedNumber, actualNumber };

    const add = await clickAddOption(page, serial, 9000);
    if (!add.ok) return { ok:false, stage:'ADD_OPTION_NOT_FOUND', expected:`Add: ${serial}` };

    await sleep(700);
    const search = await clickSearch(page, 7000);
    if (!search.ok) return { ok:false, stage:'SEARCH_BUTTON_NOT_FOUND', addText:add.text };

    return { ok:true, addMode:add.clickMode, addText:add.text, searchMode:'CLICK_SEARCH', tkSmartClicked:false };
  }
  return { ok:false, stage:'FORM_NOT_FOUND' };
}

async function pageText(page) {
  const parts = [];
  for (const frame of page.frames()) {
    try {
      const text = await frame.evaluate(() => document.body?.innerText || '');
      if (text) parts.push(text);
    } catch {}
  }
  return parts.join('\n');
}

async function waitForCargoTrackingInformation(page, timeout=20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const text = await pageText(page);
    if (/Cargo\s+Tracking\s+Information/i.test(text) && /TK\s*SMART/i.test(text)) return true;
    await sleep(500);
  }
  return false;
}

async function scrollToCargoTrackingInformation(page) {
  for (const frame of page.frames()) {
    try {
      const hit = await frame.evaluate(() => {
        const norm = v => String(v || '').replace(/\s+/g,' ').trim();
        const visible = el => {
          const r = el.getBoundingClientRect();
          const st = getComputedStyle(el);
          return r.width > 3 && r.height > 3 && st.display !== 'none' && st.visibility !== 'hidden';
        };
        const heading = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,div,span,p,section')]
          .find(el => visible(el) && /^Cargo Tracking Information$/i.test(norm(el.innerText || el.textContent || '')));
        if (!heading) return false;
        heading.scrollIntoView({ block:'start', behavior:'auto' });
        window.scrollBy({ top:80, left:0, behavior:'auto' });
        return true;
      });
      if (hit) {
        await sleep(700);
        return true;
      }
    } catch {}
  }
  return false;
}

async function readTkSmartCard(page, mawb) {
  const serial = digitsOnly(mawb).slice(3);
  let cardText = '';
  let bodyText = '';
  for (const frame of page.frames()) {
    try {
      const result = await frame.evaluate(awb => {
        const norm = v => String(v || '').replace(/\s+/g,' ').trim();
        const visible = el => {
          const r = el.getBoundingClientRect();
          const st = getComputedStyle(el);
          return r.width > 3 && r.height > 3 && st.display !== 'none' && st.visibility !== 'hidden';
        };
        const cards = [...document.querySelectorAll('section,article,div')]
          .map(el => ({ el, text:norm(el.innerText || el.textContent || '') }))
          .filter(x => visible(x.el) && /TK\s*SMART/i.test(x.text) && (x.text.includes(awb) || /(piece|kg|\bFrom\b|\bTo\b|Delivered)/i.test(x.text)))
          .filter(x => x.text.length >= 30 && x.text.length <= 6500)
          .sort((a,b) => a.text.length - b.text.length);
        return { card:cards[0]?.text || '', body:norm(document.body?.innerText || '') };
      }, serial);
      if (result.card && (!cardText || result.card.length < cardText.length)) cardText = result.card;
      if (result.body && result.body.length > bodyText.length) bodyText = result.body;
    } catch {}
  }
  const parsed = parseTkSmart(cardText, bodyText, mawb);
  if (parsed?.notFound) return { notFound:true, cardText, bodyText };
  return parsed?.shipment ? { shipment:parsed.shipment, cardText, bodyText } : null;
}

async function findTkSmartCard(page, mawb) {
  const serial = digitsOnly(mawb).slice(3);
  for (const frame of page.frames()) {
    try {
      const handles = await frame.$$('section,article,div');
      const candidates = [];
      for (const el of handles) {
        try {
          const meta = await el.evaluate((node, awb) => {
            const r = node.getBoundingClientRect();
            const st = getComputedStyle(node);
            const text = String(node.innerText || node.textContent || '').replace(/\s+/g,' ').trim();
            const good = /TK\s*SMART/i.test(text) && (text.includes(awb) || /(piece|kg|\bFrom\b|\bTo\b|Delivered)/i.test(text)) && text.length >= 30 && text.length <= 6500;
            return { good, visible:r.width > 80 && r.height > 50 && st.display !== 'none' && st.visibility !== 'hidden', len:text.length };
          }, serial);
          if (meta.good && meta.visible) candidates.push({ el, len:meta.len });
        } catch {}
      }
      candidates.sort((a,b) => a.len - b.len);
      if (candidates[0]) return candidates[0].el;
    } catch {}
  }
  return null;
}

async function screenshotOcr(page, mawb) {
  let worker;
  try {
    const card = await findTkSmartCard(page, mawb);
    let image;
    let mode = 'TK_SMART_CARD';
    if (card) {
      await card.evaluate(el => el.scrollIntoView({ block:'center', behavior:'auto' }));
      await sleep(500);
      image = await card.screenshot({ type:'png' });
    } else {
      mode = 'VISIBLE_CARGO_TRACKING_INFORMATION';
      await scrollToCargoTrackingInformation(page);
      image = await page.screenshot({ type:'png', fullPage:false });
    }

    worker = await createWorker('eng');
    const result = await worker.recognize(image);
    const text = result?.data?.text || '';
    const parsed = parseTkSmart(text, text, mawb);
    if (parsed?.notFound) return { notFound:true, screenshotCaptured:true, ocrUsed:true, mode, sample:clean(text).slice(0,7000) };
    if (parsed?.shipment) {
      parsed.shipment.source = 'Turkish Cargo TK SMART screenshot OCR / Cargo Tracking Information';
      return { shipment:parsed.shipment, screenshotCaptured:true, ocrUsed:true, mode, sample:clean(text).slice(0,7000) };
    }
    return { screenshotCaptured:true, ocrUsed:true, mode, sample:clean(text).slice(0,7000) };
  } catch (error) {
    return { screenshotCaptured:false, ocrUsed:true, error:error?.message || 'OCR failed' };
  } finally {
    if (worker) {
      try { await worker.terminate(); } catch {}
    }
  }
}

function mergeMissing(primary, fallback) {
  if (!primary) return fallback;
  if (!fallback) return primary;
  const out = { ...primary };
  for (const [key,value] of Object.entries(fallback)) {
    if ((out[key] === '' || out[key] === null || out[key] === undefined) && value !== '' && value !== null && value !== undefined) out[key] = value;
  }
  if (String(fallback.status || '').toUpperCase() === 'ARRIVED') out.status = 'ARRIVED';
  return out;
}

export async function trackTurkish(input) {
  const mawb = normalizeMawb(input);
  if (!mawb || !mawb.startsWith('235-')) return { ok:false, reason:'INVALID TURKISH MAWB', airline:AIRLINE };

  let browser;
  const debug = { prefix:'235', airline:'Turkish Cargo', url:URL, stage:'OPEN', tkSmartClicked:false };
  try {
    const mod = await import('puppeteer-core');
    const puppeteer = mod.default || mod;
    const launch = await browserConfig();
    browser = await puppeteer.launch({ ...launch, headless:true, defaultViewport:{ width:1440, height:1200, deviceScaleFactor:1.25 } });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36');
    await page.setExtraHTTPHeaders({ 'Accept-Language':'en-US,en;q=0.9' });
    await page.goto(URL, { waitUntil:'domcontentloaded', timeout:30000 });
    await sleep(1500);

    debug.cookieBefore = await dismissTurkishCookies(page);
    const flow = await fillAddSearch(page, mawb);
    if (!flow.ok) return { ok:false, reason:`TURKISH ${flow.stage || 'ADD/SEARCH FLOW NOT FOUND'}`, airline:AIRLINE, debug:{ ...debug, ...flow } };

    await sleep(700);
    debug.cookieAfterSearch = await dismissTurkishCookies(page);
    if (debug.cookieAfterSearch?.clicked) {
      await sleep(400);
      debug.searchRetryAfterCookie = await clickSearch(page, 7000);
      if (debug.searchRetryAfterCookie?.ok) await sleep(1200);
    }

    debug.cargoInfoFound = await waitForCargoTrackingInformation(page, 20000);
    debug.scrolled = debug.cargoInfoFound ? await scrollToCargoTrackingInformation(page) : false;
    await sleep(800);

    const direct = await readTkSmartCard(page, mawb);
    if (direct?.notFound) return { ok:false, notFound:true, reason:'NO SHIPMENT RECORD', airline:AIRLINE, debug:{ ...debug, ...flow, stage:'TK_SMART_NO_RECORD' } };

    const shipment = direct?.shipment || null;
    const complete = Boolean(shipment?.origin && shipment?.destination && (shipment?.pieces || shipment?.bags) && shipment?.weight && shipment?.arrivalDate && shipment?.arrivalTime);
    if (complete) {
      shipment.source = 'Turkish Cargo TK SMART direct card read / Cargo Tracking Information';
      return {
        ok:true,
        airline:AIRLINE,
        shipment,
        screenshotCaptured:false,
        screenshotVerified:false,
        screenshotOcrUsed:false,
        debug:{ ...debug, ...flow, stage:'TK_SMART_DIRECT_SUCCESS', sample:clean(direct.cardText).slice(0,7000), bodySample:clean(direct.bodyText).slice(0,12000) }
      };
    }

    const shot = await screenshotOcr(page, mawb);
    if (shot?.notFound) return { ok:false, notFound:true, reason:'NO SHIPMENT RECORD', airline:AIRLINE, screenshotCaptured:true, screenshotOcrUsed:true, debug:{ ...debug, ...flow, stage:'TK_SMART_SCREENSHOT_NO_RECORD', ocrSample:shot.sample } };

    const merged = mergeMissing(shipment, shot?.shipment);
    if (merged) {
      merged.source = shot?.shipment ? 'Turkish Cargo TK SMART direct read + screenshot OCR' : 'Turkish Cargo TK SMART direct card read';
      return {
        ok:true,
        airline:AIRLINE,
        shipment:merged,
        screenshotCaptured:Boolean(shot?.screenshotCaptured),
        screenshotVerified:Boolean(shot?.shipment),
        screenshotOcrUsed:Boolean(shot?.ocrUsed),
        debug:{ ...debug, ...flow, stage:shot?.shipment ? 'TK_SMART_OCR_SUCCESS' : 'TK_SMART_PARTIAL_DIRECT_SUCCESS', directSample:clean(direct?.cardText || '').slice(0,5000), bodySample:clean(direct?.bodyText || '').slice(0,12000), ocrSample:shot?.sample || '', ocrMode:shot?.mode || '', ocrError:shot?.error || '' }
      };
    }

    return { ok:false, reason:'TURKISH TK SMART RESULT NOT READABLE', airline:AIRLINE, screenshotCaptured:Boolean(shot?.screenshotCaptured), screenshotOcrUsed:Boolean(shot?.ocrUsed), debug:{ ...debug, ...flow, stage:'TK_SMART_UNREADABLE', ocrSample:shot?.sample || '', ocrError:shot?.error || '' } };
  } catch (error) {
    return { ok:false, reason:error?.message || 'TURKISH TRACKING FAILED', airline:AIRLINE, debug:{ ...debug, stage:'BROWSER_ERROR' } };
  } finally {
    if (browser) {
      try { await browser.close(); } catch {}
    }
  }
}
