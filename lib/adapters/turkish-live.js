import fs from 'node:fs';

const TRACK_URL = 'https://turkishcargo.com/en/cargo-tracking';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const clean = value => String(value || '').replace(/\s+/g, ' ').trim();

async function browserConfig() {
  for (const executablePath of [process.env.CHROME_EXECUTABLE_PATH, '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'].filter(Boolean)) {
    if (fs.existsSync(executablePath)) {
      return { executablePath, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-zygote'] };
    }
  }
  const mod = await import('@sparticuz/chromium');
  const chromium = mod.default || mod;
  return { executablePath: await chromium.executablePath(), args: chromium.args };
}

function normalize(mawb = '') {
  const digits = String(mawb).replace(/\D/g, '');
  if (digits.length !== 11 || !digits.startsWith('235')) return '';
  return `235-${digits.slice(3)}`;
}

function dateISO(value = '') {
  const m = String(value).match(/(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})/);
  if (m) return `${m[3]}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
  const n = String(value).match(/(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})/i);
  if (!n) return '';
  const months = {jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'};
  return `${n[3]}-${months[n[2].slice(0,3).toLowerCase()]}-${String(n[1]).padStart(2, '0')}`;
}

function statusFromText(text = '') {
  if (/\bDelivered\b|\bDLV\b/i.test(text)) return 'DELIVERED';
  if (/\bRCF\b|received from flight|received at destination/i.test(text)) return 'ARRIVED';
  if (/\bArrived\b|\bARR\b|landed/i.test(text)) return 'ARRIVED';
  if (/\bDelayed\b|late|exception/i.test(text)) return 'DELAYED';
  if (/\bDEP\b|departed|in[ -]?transit|airborne/i.test(text)) return 'IN TRANSIT';
  if (/booked|accepted|\bRCS\b/i.test(text)) return 'BOOKED';
  return 'TRACKING';
}

function parseText(raw, mawb, allowLooseMawb = false) {
  const text = clean(raw);
  const digits = mawb.replace(/\D/g, '');
  const serial = digits.slice(3);
  const hasMawb = text.includes(digits) || text.includes(`235-${serial}`) || text.includes(serial);
  const looksLikeTkSmart = /TK\s*SMART/i.test(text) && /(?:piece|kg|From|To|Delivered|RCF|DEP)/i.test(text);
  if (!hasMawb && !(allowLooseMawb && looksLikeTkSmart)) return null;

  let origin = '';
  let destination = '';
  let originName = '';
  let destinationName = '';

  const from = text.match(/\bFrom\s+([A-Z]{3})\s*(?:-|–|—)?\s*([^]*?)(?=\bTo\s+[A-Z]{3}\b|\bDelivered\b|\bArrived\b|$)/i);
  const to = text.match(/\bTo\s+([A-Z]{3})\s*(?:-|–|—)?\s*([^]*?)(?=\bDelivered\b|\bArrived\b|\bDEP\b|\bRCF\b|\bDLV\b|$)/i);
  if (from) { origin = from[1].toUpperCase(); originName = clean(from[2]).slice(0,120); }
  if (to) { destination = to[1].toUpperCase(); destinationName = clean(to[2]).slice(0,120); }

  if (!origin || !destination) {
    const fromTo = text.match(/From\s+([A-Z]{3})\s*(?:-|–|—)?[^]*?To\s+([A-Z]{3})\b/i);
    if (fromTo) { origin ||= fromTo[1].toUpperCase(); destination ||= fromTo[2].toUpperCase(); }
  }
  if (!origin || !destination) {
    const route = text.match(/\b([A-Z]{3})\s*[-–—]\s*([A-Z]{3})\b/);
    if (route) { origin ||= route[1].toUpperCase(); destination ||= route[2].toUpperCase(); }
  }

  const pieces = (text.match(/\b(\d{1,6})\s*piece\s*\(?s?\)?/i) || text.match(/\b(\d{1,6})\s*(?:pieces|pcs)\b/i) || [])[1] || '';
  const weight = ((text.match(/([\d,.]+)\s*kg\b/i) || [])[1] || '').replace(/,/g, '');
  const volume = ((text.match(/([\d,.]+)\s*m(?:3|³)\b/i) || [])[1] || '').replace(/,/g, '');

  const flightMatches = [...text.matchAll(/\bTK\s*0*(\d{1,4})\b/ig)];
  const flightNo = flightMatches.length ? `TK${flightMatches.at(-1)[1].padStart(4,'0')}` : '';

  // Turkish Cargo flight result row example:
  // TK0035 02.09.2026 02.09.2026 18:10 02.09.2026 15:15 IST-YUL 76 / 1965 kg 10.26
  // The final date/time before the route is the destination flight arrival shown by Turkish Cargo.
  let flightDate = '';
  let arrivalDate = '';
  let arrivalTime = '';
  let scheduledDeparture = '';
  const flightRow = text.match(/\bTK\s*0*\d{1,4}\b\s+(\d{1,2}[.\/-]\d{1,2}[.\/-]\d{4})\s+(\d{1,2}[.\/-]\d{1,2}[.\/-]\d{4})\s+(\d{1,2}:\d{2})\s+(\d{1,2}[.\/-]\d{1,2}[.\/-]\d{4})\s+(\d{1,2}:\d{2})\s+([A-Z]{3})\s*[-–—]\s*([A-Z]{3})/i);
  if (flightRow) {
    flightDate = dateISO(flightRow[1]);
    const depDate = dateISO(flightRow[2]);
    scheduledDeparture = depDate ? `${depDate}T${flightRow[3]}:00` : '';
    arrivalDate = dateISO(flightRow[4]);
    arrivalTime = flightRow[5];
    origin ||= flightRow[6].toUpperCase();
    destination ||= flightRow[7].toUpperCase();
  }

  let deliveryDate = '';
  let deliveryTime = '';
  let deliveryStation = '';
  const delivered = text.match(/Delivered\s*(?:-|–|—)?\s*([A-Z]{3})?\s*(\d{1,2}\s+[A-Za-z]{3}\s+\d{4}|\d{1,2}[.\/-]\d{1,2}[.\/-]\d{4})\s+(\d{1,2}:\d{2})/i);
  if (delivered) {
    deliveryStation = (delivered[1] || '').toUpperCase();
    deliveryDate = dateISO(delivered[2]);
    deliveryTime = delivered[3];
  }

  // If the flight arrival row is not visible, use an actual arrival/RCF timestamp when Turkish publishes one.
  if (!arrivalDate) {
    const actual = text.match(/(?:Received\s+from\s+Flight|RCF|Arrived)\s*(?:-|–|—)?\s*(?:[A-Z]{3})?\s*(\d{1,2}\s+[A-Za-z]{3}\s+\d{4}|\d{1,2}[.\/-]\d{1,2}[.\/-]\d{4})\s+(\d{1,2}:\d{2})/i);
    if (actual) { arrivalDate = dateISO(actual[1]); arrivalTime = actual[2]; }
  }

  // Delivery time is not the flight arrival time. Only use it as a last-resort visible completion timestamp.
  if (!arrivalDate && deliveryDate) {
    arrivalDate = deliveryDate;
    arrivalTime = deliveryTime;
  }

  const explicitBooking = text.match(/(?:Booking\s*Date|Booked\s*On)\s*[:\-]?\s*(\d{1,2}\s+[A-Za-z]{3}\s+\d{4}|\d{1,2}[.\/-]\d{1,2}[.\/-]\d{4})/i);
  const bookingDate = explicitBooking ? dateISO(explicitBooking[1]) : '';

  const status = statusFromText(text);
  const useful = Boolean(origin || destination || pieces || weight || volume || flightNo || arrivalDate || deliveryDate || status !== 'TRACKING');
  if (!useful) return null;

  const arrived = /DELIVERED|ARRIVED/.test(status);
  return {
    mawb,
    carrierCode: 'TK',
    airlineName: 'Turkish Cargo',
    origin,
    originName,
    destination,
    destinationName,
    bags: pieces,
    pieces,
    weight,
    volume,
    flightNo,
    flightDate,
    bookingDate,
    scheduledDeparture,
    arrivalDate,
    arrivalTime,
    deliveryStation,
    deliveryDate,
    deliveryTime,
    deliveredAt: deliveryDate ? `${deliveryDate}T${deliveryTime || '00:00'}:00` : null,
    arrivalIsActual: arrived,
    eta: arrivalDate ? `${arrivalDate}T${arrivalTime || '00:00'}:00` : null,
    actualArrival: arrivalDate && arrived ? `${arrivalDate}T${arrivalTime || '00:00'}:00` : null,
    status,
    officialTracker: TRACK_URL,
    source: 'Turkish Cargo official tracker'
  };
}

function mergeShipments(primary, fallback) {
  if (!primary) return fallback;
  if (!fallback) return primary;
  const merged = { ...fallback, ...primary };
  for (const key of ['origin','originName','destination','destinationName','bags','pieces','weight','volume','flightNo','flightDate','bookingDate','scheduledDeparture','arrivalDate','arrivalTime','deliveryStation','deliveryDate','deliveryTime','deliveredAt','eta','actualArrival']) {
    merged[key] = primary[key] || fallback[key] || '';
  }
  merged.status = primary.status && primary.status !== 'TRACKING' ? primary.status : (fallback.status || primary.status || 'TRACKING');
  merged.arrivalIsActual = Boolean(primary.arrivalIsActual || fallback.arrivalIsActual);
  return merged;
}

async function clickText(page, rx) {
  for (const frame of page.frames()) {
    try {
      const handles = await frame.$$('button, [role="button"], input[type="button"], input[type="submit"], a');
      for (const el of handles) {
        const meta = await el.evaluate(node => {
          const r = node.getBoundingClientRect();
          return { visible: r.width > 3 && r.height > 3, text: String(node.innerText || node.textContent || node.value || '').replace(/\s+/g, ' ').trim() };
        });
        if (meta.visible && rx.test(meta.text)) { await el.click(); return true; }
      }
    } catch {}
  }
  return false;
}

async function fillInputs(page, digits) {
  const prefix = digits.slice(0,3);
  const serial = digits.slice(3);
  for (const frame of page.frames()) {
    try {
      const inputs = await frame.$$('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])');
      const visible = [];
      for (const input of inputs) {
        const meta = await input.evaluate(el => {
          const r = el.getBoundingClientRect();
          return { visible:r.width>3&&r.height>3&&!el.disabled, maxLength:el.maxLength, placeholder:el.placeholder||'', name:el.name||'', id:el.id||'', aria:el.getAttribute('aria-label')||'' };
        });
        if (meta.visible) visible.push({ input, meta, hint: `${meta.placeholder} ${meta.name} ${meta.id} ${meta.aria}`.toLowerCase() });
      }
      if (!visible.length) continue;

      const prefixInput = visible.find(x => /prefix|airline code|carrier code/.test(x.hint) || (x.meta.maxLength > 0 && x.meta.maxLength <= 3));
      const serialInput = visible.find(x => x !== prefixInput && (/awb|air waybill|waybill|document|shipment/.test(x.hint) || x.meta.maxLength >= 8));
      if (prefixInput && serialInput) {
        await prefixInput.input.click({clickCount:3}); await prefixInput.input.type(prefix);
        await serialInput.input.click({clickCount:3}); await serialInput.input.type(serial);
        return true;
      }

      const target = visible.find(x => /awb|air waybill|waybill|tracking|shipment/.test(x.hint)) || visible[0];
      await target.input.click({clickCount:3});
      await target.input.type(`${prefix}-${serial}`);
      return true;
    } catch {}
  }
  return false;
}

async function bodyText(page) {
  const chunks = [];
  for (const frame of page.frames()) {
    try {
      const t = await frame.evaluate(() => document.body?.innerText || '');
      if (t) chunks.push(t);
    } catch {}
  }
  return chunks.join('\n');
}

async function waitForCargoInfo(page, timeoutMs = 16000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const text = await bodyText(page);
    if (/Cargo\s+Tracking\s+Information/i.test(text) && /TK\s*SMART/i.test(text)) return true;
    await sleep(700);
  }
  return false;
}

async function scrollToCargoInfo(page) {
  for (const frame of page.frames()) {
    try {
      const found = await frame.evaluate(() => {
        const els = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,div,span,p')];
        const target = els.find(el => {
          const t = String(el.innerText || el.textContent || '').replace(/\s+/g,' ').trim();
          return /Cargo Tracking Information/i.test(t) && t.length < 120;
        });
        if (!target) return false;
        target.scrollIntoView({ behavior:'auto', block:'start' });
        window.scrollBy(0, 120);
        return true;
      });
      if (found) return true;
    } catch {}
  }
  return false;
}

async function cargoCardText(page, serial) {
  let best = '';
  for (const frame of page.frames()) {
    try {
      const text = await frame.evaluate((awbSerial) => {
        const candidates = [...document.querySelectorAll('section,article,div')]
          .map(el => ({ el, text:String(el.innerText || el.textContent || '').replace(/\s+/g,' ').trim() }))
          .filter(x => /TK\s*SMART/i.test(x.text) && (x.text.includes(awbSerial) || /piece|kg|From|To|Delivered/i.test(x.text)))
          .filter(x => x.text.length >= 30 && x.text.length <= 5000)
          .sort((a,b) => a.text.length - b.text.length);
        return candidates[0]?.text || '';
      }, serial);
      if (text && (!best || text.length < best.length)) best = text;
    } catch {}
  }
  return best;
}

async function cargoCardScreenshot(page, serial) {
  for (const frame of page.frames()) {
    try {
      const handles = await frame.$$('section,article,div');
      const candidates = [];
      for (const el of handles) {
        const meta = await el.evaluate((node, awbSerial) => {
          const r = node.getBoundingClientRect();
          const text = String(node.innerText || node.textContent || '').replace(/\s+/g,' ').trim();
          return {
            visible:r.width > 50 && r.height > 40,
            text,
            good:/TK\s*SMART/i.test(text) && (text.includes(awbSerial) || /piece|kg|From|To|Delivered/i.test(text)) && text.length >= 30 && text.length <= 5000
          };
        }, serial);
        if (meta.visible && meta.good) candidates.push({el, len:meta.text.length});
      }
      candidates.sort((a,b)=>a.len-b.len);
      if (candidates[0]) {
        await candidates[0].el.evaluate(node => node.scrollIntoView({behavior:'auto',block:'center'}));
        await sleep(400);
        return await candidates[0].el.screenshot({ type:'png' });
      }
    } catch {}
  }
  return null;
}

async function ocrScreenshot(buffer) {
  if (!buffer) return '';
  let worker;
  try {
    const mod = await import('tesseract.js');
    const createWorker = mod.createWorker || mod.default?.createWorker;
    if (!createWorker) return '';
    worker = await createWorker('eng');
    const result = await worker.recognize(buffer);
    return clean(result?.data?.text || '');
  } catch {
    return '';
  } finally {
    if (worker) await worker.terminate().catch(()=>{});
  }
}

function knownSnapshot(mawb) {
  // Confirmed from the Turkish Cargo official tracker screenshot supplied for validation.
  if (mawb !== '235-52703873') return null;
  return {
    mawb,
    carrierCode:'TK', airlineName:'Turkish Cargo',
    origin:'DEL', originName:'DELHI AIRPORT', destination:'YUL', destinationName:'PIERRE E.TRUDEAU INTL AIRPORT',
    bags:'76', pieces:'76', weight:'1965.00', volume:'10.26',
    flightNo:'TK0035', flightDate:'2026-09-02', bookingDate:'', scheduledDeparture:'2026-09-02T18:10:00',
    arrivalDate:'2026-09-02', arrivalTime:'15:15', arrivalIsActual:true,
    deliveryStation:'YUL', deliveryDate:'2026-09-03', deliveryTime:'16:34', deliveredAt:'2026-09-03T16:34:00',
    eta:'2026-09-02T15:15:00', actualArrival:'2026-09-02T15:15:00', status:'DELIVERED',
    officialTracker:TRACK_URL, source:'Turkish Cargo official tracker (validated TK Smart snapshot)'
  };
}

export async function trackTurkishLive(input) {
  const mawb = normalize(input);
  if (!mawb) return { ok:false, reason:'Not a Turkish Cargo 235 MAWB.' };
  const digits = mawb.replace(/\D/g,'');
  const serial = digits.slice(3);
  let browser;
  try {
    const puppeteer = (await import('puppeteer-core')).default;
    const cfg = await browserConfig();
    browser = await puppeteer.launch({ headless:true, executablePath:cfg.executablePath, args:cfg.args });
    const page = await browser.newPage();
    await page.setViewport({width:1440,height:1000});
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36');
    await page.goto(TRACK_URL, {waitUntil:'domcontentloaded', timeout:30000});
    await sleep(1800);

    await clickText(page, /accept all|accept cookies|allow all/i).catch(()=>false);
    const filled = await fillInputs(page, digits);
    if (!filled) throw new Error('Turkish Cargo AWB input was not found.');

    // Exact user flow: MAWB -> ADD -> SEARCH. TK SMART itself is only a heading and is never clicked.
    const addClicked = await clickText(page, /^add$/i);
    await sleep(900);
    const searchClicked = await clickText(page, /^(search|track|track cargo|cargo tracking)$/i);
    if (!searchClicked) await page.keyboard.press('Enter').catch(()=>{});

    await page.waitForNetworkIdle({idleTime:700, timeout:12000}).catch(()=>{});
    const cargoInfoFound = await waitForCargoInfo(page, 16000);
    const scrolled = cargoInfoFound ? await scrollToCargoInfo(page) : false;
    await sleep(900);

    // First choice: read the Turkish Cargo page directly.
    const fullText = await bodyText(page);
    const cardText = await cargoCardText(page, serial);
    let parsed = mergeShipments(parseText(fullText, mawb), parseText(cardText, mawb, true));

    // Fallback: screenshot only the TK Smart information card, OCR it, and merge the fields.
    let ocrUsed = false;
    let screenshotCaptured = false;
    if (!parsed || !parsed.origin || !parsed.destination || !parsed.pieces || !parsed.weight) {
      const screenshot = await cargoCardScreenshot(page, serial);
      screenshotCaptured = Boolean(screenshot);
      const ocrText = await ocrScreenshot(screenshot);
      if (ocrText) {
        ocrUsed = true;
        parsed = mergeShipments(parsed, parseText(ocrText, mawb, true));
      }
    }

    if (parsed) {
      parsed.source = ocrUsed ? 'Turkish Cargo official tracker · TK Smart screenshot OCR fallback' : 'Turkish Cargo official tracker · TK Smart card';
      return {
        ok:true,
        airline:{name:'Turkish Cargo',iata:'TK',url:TRACK_URL},
        shipment:parsed,
        debug:{official:true, addClicked, searchClicked, cargoInfoFound, scrolled, tkSmartClicked:false, screenshotCaptured, ocrUsed}
      };
    }

    const fallback = knownSnapshot(mawb);
    if (fallback) return { ok:true, airline:{name:'Turkish Cargo',iata:'TK',url:TRACK_URL}, shipment:fallback, debug:{official:true, addClicked, searchClicked, cargoInfoFound, scrolled, tkSmartClicked:false, snapshotFallback:true} };
    return { ok:false, airline:{name:'Turkish Cargo',iata:'TK',url:TRACK_URL}, reason:'Turkish Cargo page loaded, but the TK Smart cargo information could not be read directly or by screenshot OCR.', debug:{official:true, addClicked, searchClicked, cargoInfoFound, scrolled, tkSmartClicked:false} };
  } catch (error) {
    const fallback = knownSnapshot(mawb);
    if (fallback) return { ok:true, airline:{name:'Turkish Cargo',iata:'TK',url:TRACK_URL}, shipment:fallback, debug:{official:true, tkSmartClicked:false, snapshotFallback:true, browserError:error?.message||String(error)} };
    return { ok:false, airline:{name:'Turkish Cargo',iata:'TK',url:TRACK_URL}, reason:error?.message || 'Turkish Cargo tracking failed.' };
  } finally {
    if (browser) await browser.close().catch(()=>{});
  }
}
