import fs from 'node:fs';
import { createWorker } from 'tesseract.js';
import { normalizeMawb } from './airlines.js';
import { dismissTurkishCookies } from './turkish-cookie.js';

const URL = 'https://turkishcargo.com/en/cargo-tracking';
const AIRLINE = { name: 'Turkish Cargo', iata: 'TK', url: URL };
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
        executablePath: p,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-zygote']
      };
    }
  }
  const mod = await import('@sparticuz/chromium');
  const chromium = mod.default || mod;
  return { executablePath: await chromium.executablePath(), args: chromium.args };
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

function mergeShipment(a,b) {
  if (!a) return b;
  if (!b) return a;
  const out = { ...a };
  for (const [k,v] of Object.entries(b)) {
    if ((out[k] === undefined || out[k] === null || out[k] === '') && v !== undefined && v !== null && v !== '') out[k] = v;
  }
  if (String(b.status || '').toUpperCase() === 'ARRIVED') out.status = 'ARRIVED';
  out.arrivalIsActual = Boolean(a.arrivalIsActual || b.arrivalIsActual);
  return out;
}

function parseTkSmart(raw, mawb, { loose=false }={}) {
  const s = clean(raw);
  if (!s) return null;
  if (/no (?:shipment|record|result)|not found|invalid (?:awb|air waybill)|no data/i.test(s)) return { notFound:true };

  const digits = digitsOnly(mawb);
  const serial = digits.slice(3);
  const flat = digitsOnly(s);
  const awbMatched = s.includes(mawb) || s.includes(digits) || s.includes(serial) || flat.includes(digits) || flat.includes(serial);
  const looksLikeCard = /TK\s*SMART/i.test(s) && /(piece|kg|\bFrom\b|\bTo\b|Delivered|\bDLV\b|\bRCF\b)/i.test(s);
  if (!awbMatched && !(loose && looksLikeCard)) return null;

  let origin = (s.match(/\b(?:FROM|ORIGIN)\s*[:\-]?\s*([A-Z]{3})\b/i) || [])[1] || '';
  let destination = (s.match(/\b(?:TO|DESTINATION)\s*[:\-]?\s*([A-Z]{3})\b/i) || [])[1] || '';
  origin = origin.toUpperCase();
  destination = destination.toUpperCase();

  if (!origin || !destination) {
    const route = s.match(/\b([A-Z]{3})\s*(?:→|->|–|—|-)\s*([A-Z]{3})\b/);
    if (route) {
      origin = origin || route[1].toUpperCase();
      destination = destination || route[2].toUpperCase();
    }
  }

  const originName = clean((s.match(/\bFrom\s+[A-Z]{3}\s*[-–—]?\s*([^]*?)(?=\bTo\s+[A-Z]{3}\b|\bDelivered\b|$)/i) || [])[1] || '').slice(0,120);
  const destinationName = clean((s.match(/\bTo\s+[A-Z]{3}\s*[-–—]?\s*([^]*?)(?=\bDelivered\b|\bDLV\b|\bDEP\b|\bRCF\b|$)/i) || [])[1] || '').slice(0,120);

  const pieces = (s.match(/\b(\d{1,6})\s*piece\s*\(?s?\)?/i) || s.match(/\b(\d{1,6})\s*(?:pieces|pcs|bags)\b/i) || [])[1] || '';
  const weight = ((s.match(/\b([\d,.]+)\s*(?:kg|kgs)\b/i) || [])[1] || '').replace(/,/g,'');
  const volume = ((s.match(/\b([\d,.]+)\s*(?:m3|m³|cbm)\b/i) || [])[1] || '').replace(/,/g,'');

  const flights = [...s.matchAll(/\bTK\s*0*(\d{2,4})\b/ig)];
  const flightNo = flights.length ? `TK${flights.at(-1)[1].padStart(4,'0')}` : '';

  let flightDate = '';
  let arrivalDate = '';
  let arrivalTime = '';
  let scheduledDeparture = '';

  const flightRow = s.match(/\bTK\s*0*\d{2,4}\b\s+(\d{1,2}[.\/-]\d{1,2}[.\/-]\d{4})\s+(\d{1,2}[.\/-]\d{1,2}[.\/-]\d{4})\s+(\d{1,2}:\d{2})\s+(\d{1,2}[.\/-]\d{1,2}[.\/-]\d{4})\s+(\d{1,2}:\d{2})\s+([A-Z]{3})\s*[-–—]\s*([A-Z]{3})/i);
  if (flightRow) {
    flightDate = dateOnly(flightRow[1]);
    const depDate = dateOnly(flightRow[2]);
    scheduledDeparture = depDate ? `${depDate}T${flightRow[3]}:00` : '';
    arrivalDate = dateOnly(flightRow[4]);
    arrivalTime = flightRow[5];
    origin = origin || flightRow[6].toUpperCase();
    destination = destination || flightRow[7].toUpperCase();
  }

  let deliveryDate = '';
  let deliveryTime = '';
  let deliveryStation = '';
  const delivered = s.match(/Delivered\s*(?:-|–|—)?\s*([A-Z]{3})?\s*(\d{1,2}\s+[A-Za-z]{3}\s+\d{4}|\d{1,2}[.\/-]\d{1,2}[.\/-]\d{4})\s+(\d{1,2}:\d{2})/i);
  if (delivered) {
    deliveryStation = (delivered[1] || '').toUpperCase();
    deliveryDate = dateOnly(delivered[2]);
    deliveryTime = delivered[3];
  }

  if (!arrivalDate && deliveryDate) {
    arrivalDate = deliveryDate;
    arrivalTime = deliveryTime;
  }

  const bookingMatch = s.match(/(?:BOOKING\s*DATE|BOOKED\s*(?:ON|AT))\s*[:\-]?\s*(\d{1,2}\s+[A-Za-z]{3}\s+\d{4}|\d{1,2}[.\/-]\d{1,2}[.\/-]\d{4}|20\d{2}[.\/-]\d{1,2}[.\/-]\d{1,2})/i);
  const bookingDate = bookingMatch ? dateOnly(bookingMatch[1]) : '';

  const upper = s.toUpperCase();
  let status = 'BOOKED';
  if (/\bDLV\b|DELIVERED|RECEIVED FROM FLIGHT|\bRCF\b|\bARRIVED\b|\bARR\b/.test(upper)) status = 'ARRIVED';
  else if (/DELAY|LATE|EXCEPTION/.test(upper)) status = 'DELAYED';
  else if (/\bDEP\b|DEPARTED|IN TRANSIT|AIRBORNE|IN FLIGHT/.test(upper)) status = 'IN TRANSIT';

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
      scheduledDeparture,
      arrivalDate,
      arrivalTime,
      arrivalIsActual:Boolean(deliveryDate && !flightRow),
      deliveryStation,
      deliveryDate,
      deliveryTime,
      deliveredAt:deliveryDate ? `${deliveryDate}T${deliveryTime || '00:00'}:00` : '',
      status,
      source:'Turkish Cargo TK SMART / Cargo Tracking Information'
    }
  };
}

async function markAndClick(frame, predicateArgs, predicateSource, marker) {
  try {
    const found = await frame.evaluate(({ args, source, markerName }) => {
      for (const old of document.querySelectorAll(`[data-mayavi-target="${markerName}"]`)) old.removeAttribute('data-mayavi-target');
      const norm = v => String(v || '').replace(/\s+/g,' ').trim();
      const visible = el => {
        const r = el.getBoundingClientRect();
        const st = getComputedStyle(el);
        return r.width > 3 && r.height > 3 && st.display !== 'none' && st.visibility !== 'hidden';
      };
      const predicate = new Function('el','text','args', `return (${source})(el,text,args);`);
      const nodes = [...document.querySelectorAll('button,a,li,div,span,p,[role="button"],[role="option"],[onclick],[tabindex]')];
      const matches = [];
      for (const el of nodes) {
        if (!visible(el)) continue;
        const text = norm(el.innerText || el.textContent || el.value || '');
        let ok = false;
        try { ok = Boolean(predicate(el,text,args)); } catch {}
        if (!ok) continue;
        const r = el.getBoundingClientRect();
        matches.push({ el, text, area:r.width*r.height });
      }
      if (!matches.length) return null;
      matches.sort((a,b) => a.text.length - b.text.length || a.area - b.area);
      const leaf = matches[0].el;
      const clickable = leaf.closest('button,a,[role="button"],[role="option"],li,[onclick],[tabindex]') || leaf;
      clickable.setAttribute('data-mayavi-target', markerName);
      clickable.scrollIntoView({ block:'center', inline:'center', behavior:'auto' });
      return matches[0].text;
    }, { args:predicateArgs, source:predicateSource, markerName:marker });

    if (!found) return null;
    const handle = await frame.$(`[data-mayavi-target="${marker}"]`);
    if (!handle) return null;
    await handle.click({ delay:60 });
    try { await handle.evaluate(el => el.removeAttribute('data-mayavi-target')); } catch {}
    return found;
  } catch {
    return null;
  }
}

async function inspectAddState(page, serial) {
  const out = [];
  for (const frame of page.frames()) {
    try {
      const state = await frame.evaluate(awb => {
        const norm = v => String(v || '').replace(/\s+/g,' ').trim();
        const visible = el => {
          const r = el.getBoundingClientRect();
          const st = getComputedStyle(el);
          return r.width > 3 && r.height > 3 && st.display !== 'none' && st.visibility !== 'hidden';
        };
        const nodes = [...document.querySelectorAll('button,a,li,div,span,p,mat-option,[role="option"],[role="button"],input')];
        const texts = nodes.filter(visible).map(el => norm(el.innerText || el.textContent || el.value || '')).filter(Boolean);
        const addTexts = texts.filter(t => /^Add\s*:/i.test(t) && t.replace(/\D/g,'').includes(awb)).slice(0,8);
        const serialTexts = texts.filter(t => !/^Add\s*:/i.test(t) && t.replace(/\D/g,'').includes(awb) && t.length <= 80).slice(0,12);
        const search = nodes.find(el => visible(el) && /^Search$/i.test(norm(el.innerText || el.textContent || el.value || '')));
        const inputs = [...document.querySelectorAll('input:not([type="hidden"])')].filter(visible).map(el => ({value:el.value || '', disabled:Boolean(el.disabled)}));
        return {
          addStillVisible:addTexts.length > 0,
          addTexts,
          serialTexts,
          searchDisabled:search ? Boolean(search.disabled || search.getAttribute('aria-disabled') === 'true') : null,
          inputs
        };
      }, serial);
      out.push(state);
    } catch {}
  }
  return out;
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
            const aOpt = a.matches('mat-option,.mat-mdc-option,.mat-option,[role="option"],li,[class*="option"]') ? 0 : 1;
            const bOpt = b.matches('mat-option,.mat-mdc-option,.mat-option,[role="option"],li,[class*="option"]') ? 0 : 1;
            if (aOpt !== bOpt) return aOpt - bOpt;
            const at = norm(a.innerText || a.textContent || '');
            const bt = norm(b.innerText || b.textContent || '');
            return at.length - bt.length;
          });
          const leaf = matches[0];
          const option = leaf.closest('mat-option,.mat-mdc-option,.mat-option,[role="option"],li,[class*="option"],[class*="autocomplete"]') || leaf;
          option.setAttribute('data-mayavi-turkish-add','1');
          option.scrollIntoView({block:'center',inline:'center',behavior:'auto'});
          return norm(option.innerText || option.textContent || leaf.innerText || leaf.textContent || '');
        }, serial);
        if (!marked) continue;
        const handle = await frame.$('[data-mayavi-turkish-add="1"]');
        if (!handle) continue;
        await handle.hover().catch(()=>{});
        await sleep(120);
        await handle.click({delay:120});
        await sleep(650);
        const state = await inspectAddState(page, serial);
        try { await handle.evaluate(el => el.removeAttribute('data-mayavi-turkish-add')); } catch {}
        return {ok:true,text:marked,state,clickMode:'REAL_OPTION_MOUSE_CLICK'};
      } catch {}
    }
    await sleep(350);
  }
  return {ok:false,state:await inspectAddState(page, serial)};
}

async function clickSearch(page, timeout=7000) {
  const end = Date.now() + timeout;
  const source = `(el,text,args) => /^Search$/i.test(String(text || '').trim())`;
  while (Date.now() < end) {
    for (const frame of page.frames()) {
      const text = await markAndClick(frame, {}, source, 'turkish-search');
      if (text) return { ok:true, text };
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
        if (meta.visible) fields.push({input,meta});
      } catch {}
    }

    const prefixField = fields.find(x => x.meta.max === 3 || /prefix|awb code|airline code/i.test(x.meta.label));
    let numberField = fields.find(x => x !== prefixField && (x.meta.max === 8 || /awb|air waybill|waybill/i.test(x.meta.label)));
    if (!numberField) numberField = fields.find(x => x !== prefixField && [11,12,14].includes(x.meta.max));
    if (!numberField) continue;

    if (prefixField) {
      await prefixField.input.click({clickCount:3});
      await page.keyboard.press('Backspace');
      await prefixField.input.type(prefix,{delay:35});
    }
    await numberField.input.click({clickCount:3});
    await page.keyboard.press('Backspace');
    await numberField.input.type(numberField.meta.max === 8 ? serial : (prefixField ? serial : digits),{delay:35});

    const add = await clickAddOption(page, serial, 9000);
    if (!add.ok) return {ok:false,stage:'ADD_OPTION_NOT_FOUND',expected:`Add: ${serial}`,postAddState:add.state || []};

    const postAddState = add.state || await inspectAddState(page, serial);
    await sleep(700);
    const search = await clickSearch(page, 7000);
    if (!search.ok) return {ok:false,stage:'SEARCH_BUTTON_NOT_FOUND',addMode:add.clickMode,addText:add.text,postAddState};

    return {
      ok:true,
      addMode:add.clickMode || 'CLICK_ADD_OPTION',
      addText:add.text,
      postAddState,
      searchMode:'CLICK_SEARCH',
      tkSmartClicked:false
    };
  }
  return {ok:false,stage:'FORM_NOT_FOUND'};
}

async function pageText(page) {
  const parts = [];
  for (const frame of page.frames()) {
    try {
      const t = await frame.evaluate(() => document.body?.innerText || '');
      if (t) parts.push(t);
    } catch {}
  }
  return parts.join('\n');
}

async function waitForCargoTrackingInformation(page, timeout=20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const t = await pageText(page);
    if (/Cargo\s+Tracking\s+Information/i.test(t) && /TK\s*SMART/i.test(t)) return true;
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
        const nodes = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,div,span,p,section')];
        const heading = nodes.find(el => visible(el) && /^Cargo Tracking Information$/i.test(norm(el.innerText || el.textContent || '')));
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

async function directCardRead(page, mawb) {
  const serial = digitsOnly(mawb).slice(3);
  let best = '';
  let whole = '';

  for (const frame of page.frames()) {
    try {
      const result = await frame.evaluate(awb => {
        const norm = v => String(v || '').replace(/\s+/g,' ').trim();
        const visible = el => {
          const r = el.getBoundingClientRect();
          const st = getComputedStyle(el);
          return r.width > 3 && r.height > 3 && st.display !== 'none' && st.visibility !== 'hidden';
        };
        const all = [...document.querySelectorAll('section,article,div')];
        const cards = all
          .map(el => ({ el, text:norm(el.innerText || el.textContent || '') }))
          .filter(x => visible(x.el) && /TK\s*SMART/i.test(x.text) && (x.text.includes(awb) || /(piece|kg|\bFrom\b|\bTo\b|Delivered|DLV|RCF)/i.test(x.text)))
          .filter(x => x.text.length >= 30 && x.text.length <= 6500)
          .sort((a,b) => a.text.length - b.text.length);
        return { card:cards[0]?.text || '', body:norm(document.body?.innerText || '') };
      }, serial);

      if (result.card && (!best || result.card.length < best.length)) best = result.card;
      if (result.body && result.body.length > whole.length) whole = result.body;
    } catch {}
  }

  const cardParsed = parseTkSmart(best, mawb, { loose:true });
  const bodyParsed = parseTkSmart(whole, mawb);
  if (cardParsed?.notFound || bodyParsed?.notFound) return { notFound:true, cardText:best, bodyText:whole };
  const shipment = mergeShipment(cardParsed?.shipment, bodyParsed?.shipment);
  return shipment ? { shipment, cardText:best, bodyText:whole } : null;
}

async function findCardHandle(page, mawb) {
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
            const good = /TK\s*SMART/i.test(text) && (text.includes(awb) || /(piece|kg|\bFrom\b|\bTo\b|Delivered|DLV|RCF)/i.test(text)) && text.length >= 30 && text.length <= 6500;
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
    const card = await findCardHandle(page, mawb);
    let image;
    let mode = 'TK_SMART_CARD';

    if (card) {
      await card.evaluate(el => el.scrollIntoView({ block:'center', behavior:'auto' }));
      await sleep(500);
      image = await card.screenshot({ type:'png' });
    } else {
      mode = 'VISIBLE_CARGO_INFORMATION_AREA';
      await scrollToCargoTrackingInformation(page);
      image = await page.screenshot({ type:'png', fullPage:false });
    }

    worker = await createWorker('eng');
    const result = await worker.recognize(image);
    const text = result?.data?.text || '';
    const parsed = parseTkSmart(text, mawb, { loose:true });

    if (parsed?.notFound) return { notFound:true, screenshotCaptured:true, ocrUsed:true, mode, sample:clean(text).slice(0,7000) };
    if (parsed?.useful) {
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

export async function trackTurkish(input) {
  const mawb = normalizeMawb(input);
  if (!mawb || !mawb.startsWith('235-')) return { ok:false, reason:'INVALID TURKISH MAWB', airline:AIRLINE };

  let browser;
  const debug = { prefix:'235', airline:'Turkish Cargo', url:URL, stage:'OPEN', tkSmartClicked:false };

  try {
    const mod = await import('puppeteer-core');
    const puppeteer = mod.default || mod;
    const launch = await browserConfig();
    browser = await puppeteer.launch({
      ...launch,
      headless:true,
      defaultViewport:{ width:1440, height:1200, deviceScaleFactor:1.25 }
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36');
    await page.setExtraHTTPHeaders({ 'Accept-Language':'en-US,en;q=0.9' });

    await page.goto(URL, { waitUntil:'domcontentloaded', timeout:30000 });
    await sleep(1500);
    debug.cookieBefore = await dismissTurkishCookies(page);

    const flow = await fillAddSearch(page, mawb);
    if (!flow.ok) {
      return { ok:false, reason:`TURKISH ${flow.stage || 'ADD/SEARCH FLOW NOT FOUND'}`, airline:AIRLINE, debug:{ ...debug, ...flow } };
    }

    await sleep(700);
    debug.cookieAfterSearch = await dismissTurkishCookies(page);

    // Turkish can render its cookie banner only after the first Search click.
    // If Mayavi had to accept it, press Search once more before reading Cargo Tracking Information.
    if (debug.cookieAfterSearch?.clicked) {
      await sleep(400);
      const searchRetry = await clickSearch(page, 7000);
      debug.searchRetryAfterCookie = searchRetry;
      if (searchRetry?.ok) await sleep(1200);
    }

    const cargoInfoFound = await waitForCargoTrackingInformation(page, 20000);
    const scrolled = cargoInfoFound ? await scrollToCargoTrackingInformation(page) : false;
    debug.cargoInfoFound = cargoInfoFound;
    debug.scrolled = scrolled;
    await sleep(800);

    // PRIMARY: read the visible Cargo Tracking Information -> TK SMART card directly.
    // TK SMART is a heading only and is never clicked.
    const direct = await directCardRead(page, mawb);
    if (direct?.notFound) {
      return { ok:false, notFound:true, reason:'NO SHIPMENT RECORD', airline:AIRLINE, debug:{ ...debug, ...flow, stage:'TK_SMART_NO_RECORD' } };
    }

    const directShipment = direct?.shipment || null;
    const directComplete = Boolean(
      directShipment?.origin &&
      directShipment?.destination &&
      (directShipment?.pieces || directShipment?.bags) &&
      directShipment?.weight
    );

    if (directComplete) {
      directShipment.source = 'Turkish Cargo TK SMART direct card read / Cargo Tracking Information';
      return {
        ok:true,
        airline:AIRLINE,
        shipment:directShipment,
        screenshotCaptured:false,
        screenshotVerified:false,
        screenshotOcrUsed:false,
        debug:{
          ...debug,
          ...flow,
          stage:'TK_SMART_DIRECT_SUCCESS',
          sample:clean(direct.cardText).slice(0,7000),
          bodySample:clean(direct.bodyText).slice(0,10000)
        }
      };
    }

    // FALLBACK ONLY: if direct DOM reading is insufficient, screenshot the TK SMART card and OCR it.
    const shot = await screenshotOcr(page, mawb);
    if (shot?.notFound) {
      return {
        ok:false,
        notFound:true,
        reason:'NO SHIPMENT RECORD',
        airline:AIRLINE,
        screenshotCaptured:true,
        screenshotOcrUsed:true,
        debug:{ ...debug, ...flow, stage:'TK_SMART_SCREENSHOT_NO_RECORD', ocrSample:shot.sample }
      };
    }

    const merged = mergeShipment(directShipment, shot?.shipment);
    if (merged) {
      merged.source = shot?.shipment
        ? 'Turkish Cargo TK SMART direct read + screenshot OCR'
        : 'Turkish Cargo TK SMART direct card read';
      return {
        ok:true,
        airline:AIRLINE,
        shipment:merged,
        screenshotCaptured:Boolean(shot?.screenshotCaptured),
        screenshotVerified:Boolean(shot?.shipment),
        screenshotOcrUsed:Boolean(shot?.ocrUsed),
        debug:{
          ...debug,
          ...flow,
          stage:shot?.shipment ? 'TK_SMART_OCR_SUCCESS' : 'TK_SMART_PARTIAL_DIRECT_SUCCESS',
          directSample:clean(direct?.cardText || '').slice(0,5000),
          bodySample:clean(direct?.bodyText || '').slice(0,10000),
          ocrSample:shot?.sample || '',
          ocrMode:shot?.mode || '',
          ocrError:shot?.error || ''
        }
      };
    }

    return {
      ok:false,
      reason:'TURKISH TK SMART RESULT NOT READABLE',
      airline:AIRLINE,
      screenshotCaptured:Boolean(shot?.screenshotCaptured),
      screenshotOcrUsed:Boolean(shot?.ocrUsed),
      debug:{ ...debug, ...flow, stage:'TK_SMART_UNREADABLE', ocrSample:shot?.sample || '', ocrError:shot?.error || '' }
    };
  } catch (error) {
    return { ok:false, reason:error?.message || 'TURKISH TRACKING FAILED', airline:AIRLINE, debug:{ ...debug, stage:'BROWSER_ERROR' } };
  } finally {
    if (browser) {
      try { await browser.close(); } catch {}
    }
  }
}
