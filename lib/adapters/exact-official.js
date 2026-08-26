import fs from 'node:fs';
import { airlineForMawb, normalizeMawb } from '../airlines.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const clean = value => String(value || '').replace(/\s+/g, ' ').trim();

const EXACT = {
  '065': {
    name: 'Saudia Cargo',
    iata: 'SV',
    url: 'https://saudiacargo.com/e-services/track-shipment',
    queryParam: 'awbNumber',
    inputHints: /awb|air waybill|shipment|tracking/i,
    buttonHints: /track shipment|track|search/i,
    networkHints: /track|shipment|cargo|awb|status/i
  },
  '176': {
    name: 'Emirates SkyCargo',
    iata: 'EK',
    url: 'https://scekprd.emirates.com/skychain/app?initial=y&service=page%2Fnwp%3ATrackshipmt',
    inputHints: /document no|awb|air waybill|shipment/i,
    buttonHints: /track|submit|search/i,
    networkHints: /track|shipment|skychain|awb|status/i
  },
  '098': {
    name: 'Air India Cargo',
    iata: 'AI',
    url: 'https://cargo.airindia.com/content/cargo/in/en/track-shipment.html',
    inputHints: /awb|airline code|air waybill|shipment|track/i,
    buttonHints: /track|submit|search/i,
    networkHints: /track|shipment|cargo|awb|status/i
  }
};

async function browserConfig() {
  for (const executablePath of [process.env.CHROME_EXECUTABLE_PATH, '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'].filter(Boolean)) {
    if (fs.existsSync(executablePath)) return { executablePath, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-zygote'] };
  }
  const mod = await import('@sparticuz/chromium');
  const chromium = mod.default || mod;
  return { executablePath: await chromium.executablePath(), args: chromium.args };
}

function statusFromText(text = '') {
  if (/notified consignee/i.test(text)) return 'NOTIFIED CONSIGNEE';
  if (/received at destination|\bRCF\b/i.test(text)) return 'RECEIVED AT DESTINATION';
  if (/\bdelivered\b|\bDLV\b/i.test(text)) return 'DELIVERED';
  if (/\barrived\b|\blanded\b|actual arrival|\bARR\b/i.test(text)) return 'ARRIVED';
  if (/\bdelayed\b|\blate\b|exception/i.test(text)) return 'DELAYED';
  if (/\bdeparted\b|\bDEP\b|in[ -]?transit|airborne|in flight/i.test(text)) return 'IN TRANSIT';
  if (/\bbooked\b|\bRCS\b|manifested|received from shipper/i.test(text)) return 'BOOKED';
  return 'TRACKING';
}

function parseDateTime(text = '') {
  let m = clean(text).match(/\b(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})/);
  if (m) return { date: `${m[1]}-${m[2]}-${m[3]}`, time: `${String(m[4]).padStart(2, '0')}:${m[5]}` };
  m = clean(text).match(/\b(\d{1,2})[-\s/]([A-Za-z]{3,9})[-\s/,](\d{2,4})\s+(\d{1,2}):(\d{2})(?:\s*(AM|PM))?/i);
  if (!m) return { date: '', time: '' };
  const months = { jan:'01', feb:'02', mar:'03', apr:'04', may:'05', jun:'06', jul:'07', aug:'08', sep:'09', oct:'10', nov:'11', dec:'12' };
  const month = months[m[2].slice(0,3).toLowerCase()];
  if (!month) return { date:'', time:'' };
  let year = String(m[3]); if (year.length === 2) year = `20${year}`;
  let hour = Number(m[4]); const ap = String(m[6] || '').toUpperCase();
  if (ap === 'PM' && hour < 12) hour += 12; if (ap === 'AM' && hour === 12) hour = 0;
  return { date: `${year}-${month}-${String(m[1]).padStart(2,'0')}`, time: `${String(hour).padStart(2,'0')}:${m[5]}` };
}

function parseShipment(raw, mawb, config) {
  const text = clean(raw), digits = mawb.replace(/\D/g,''), serial = digits.slice(3);
  if (/no (?:shipment|record|result)|not found|invalid (?:awb|air waybill)|unable to find|no data/i.test(text)) return { notFound: true };
  const seen = text.includes(mawb) || text.includes(digits) || text.includes(serial);
  const route = text.match(/\b([A-Z]{3})\s*(?:-|–|—|→|>)\s*([A-Z]{3})\b/);
  const origin = ((text.match(/(?:origin|from|departure(?: airport| station)?)['"\s:_-]{0,20}['"]?([A-Z]{3})\b/i) || [])[1] || route?.[1] || '').toUpperCase();
  const destination = ((text.match(/(?:destination|to|arrival(?: airport| station)?)['"\s:_-]{0,20}['"]?([A-Z]{3})\b/i) || [])[1] || route?.[2] || '').toUpperCase();
  const pieces = (text.match(/(?:pieces?|pcs?|bags?|pieceCount|totalPieces)['"\s:#_-]{0,20}['"]?(\d{1,6})\b/i) || text.match(/\b(\d{1,6})\s*(?:pieces?|pcs?|bags?)\b/i) || [])[1] || '';
  const weight = ((text.match(/(?:gross\s*weight|weight|grossWeight)['"\s:#_-]{0,20}['"]?([\d,.]+)\s*(?:kg|kgs|kilograms?)?/i) || text.match(/([\d,.]+)\s*(?:kg|kgs|kilograms?)\b/i) || [])[1] || '').replace(/,/g,'');
  const flightMatches = config.iata ? [...text.matchAll(new RegExp(`\\b${config.iata}[-\\s]?(\\d{2,4})\\b`, 'ig'))] : [];
  const flightNo = flightMatches.length ? `${config.iata}${flightMatches.at(-1)[1]}` : '';
  let arrival = parseDateTime((text.match(/(?:actualArrival|actual arrival|arrived(?: at)?|landed(?: at)?|\bARR\b)[\s\S]{0,220}/i) || [])[0] || '');
  const actual = Boolean(arrival.date);
  if (!arrival.date) arrival = parseDateTime((text.match(/(?:estimatedArrival|expectedArrival|estimated arrival|expected arrival|\bETA\b|scheduled arrival)[\s\S]{0,240}/i) || [])[0] || '');
  const status = statusFromText(text);
  const useful = Boolean(seen && (origin || destination || pieces || weight || flightNo || arrival.date || status !== 'TRACKING'));
  return { useful, shipment: { mawb, carrierCode: config.iata, airlineName: config.name, origin, destination, bags: pieces, pieces, weight, flightNo, arrivalDate: arrival.date, arrivalTime: arrival.time, arrivalIsActual: actual, status, officialTracker: config.url, source: `${config.name} official website` } };
}

async function deepText(page) {
  const chunks = [];
  for (const frame of page.frames()) {
    try {
      const t = await frame.evaluate(() => document.body?.innerText || document.documentElement?.innerText || '');
      if (t) chunks.push(t);
    } catch {}
  }
  return chunks.join('\n');
}

async function fillOfficialForm(page, mawb, config) {
  const digits = mawb.replace(/\D/g,''), prefix = digits.slice(0,3), serial = digits.slice(3);
  for (const frame of page.frames()) {
    const inputs = await frame.$$('input:not([type="hidden"]),textarea');
    const candidates = [];
    for (const input of inputs) {
      try {
        const meta = await input.evaluate(el => { const r=el.getBoundingClientRect(); return { visible:r.width>3&&r.height>3&&!el.disabled&&!el.readOnly, max:Number(el.maxLength||-1), text:`${el.placeholder||''} ${el.name||''} ${el.id||''} ${el.getAttribute('aria-label')||''} ${el.labels?.[0]?.innerText||''}` }; });
        if (meta.visible) candidates.push({ input, meta });
      } catch {}
    }
    if (!candidates.length) continue;

    let prefixInput = candidates.find(x => x.meta.max === 3 || /airline code|prefix/i.test(x.meta.text));
    let numberInput = candidates.find(x => x !== prefixInput && (x.meta.max === 8 || config.inputHints.test(x.meta.text)));
    if (!numberInput) numberInput = candidates.find(x => [11,12,14].includes(x.meta.max));

    if (prefixInput && numberInput) {
      await prefixInput.input.click({ clickCount:3 }); await page.keyboard.press('Backspace'); await prefixInput.input.type(prefix, { delay:35 });
      await numberInput.input.click({ clickCount:3 }); await page.keyboard.press('Backspace'); await numberInput.input.type(serial, { delay:35 });
    } else if (numberInput) {
      const value = numberInput.meta.max === 8 ? serial : digits;
      await numberInput.input.click({ clickCount:3 }); await page.keyboard.press('Backspace'); await numberInput.input.type(value, { delay:35 });
    } else continue;

    const buttons = await frame.$$('button,input[type="submit"],input[type="button"],[role="button"]');
    for (const button of buttons) {
      try {
        const meta = await button.evaluate(el => { const r=el.getBoundingClientRect(); return { visible:r.width>3&&r.height>3&&!el.disabled, text:String(el.innerText||el.value||el.getAttribute('aria-label')||'').trim() }; });
        if (meta.visible && config.buttonHints.test(meta.text)) { await button.click({ delay:50 }); return true; }
      } catch {}
    }
    await page.keyboard.press('Enter');
    return true;
  }
  return false;
}

export function hasExactOfficialAdapter(prefix = '') { return Boolean(EXACT[prefix]); }

export async function trackExactOfficial(inputMawb) {
  const mawb = normalizeMawb(inputMawb);
  const prefix = mawb.replace(/\D/g,'').slice(0,3);
  const config = EXACT[prefix];
  const airline = airlineForMawb(mawb) || config;
  if (!mawb || !config) return { ok:false, technical:false, reason:'NO EXACT OFFICIAL ADAPTER', airline, debug:{ stage:'EXACT_NOT_MAPPED' } };

  let browser;
  const debug = { stage:'EXACT_OPEN', prefix, officialUrl:config.url };
  try {
    const mod = await import('puppeteer-core'); const puppeteer = mod.default || mod; const launch = await browserConfig();
    browser = await puppeteer.launch({ ...launch, headless:true, defaultViewport:{ width:1440, height:1050 } });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36');
    await page.setExtraHTTPHeaders({ 'Accept-Language':'en-US,en;q=0.9' });

    const network = [];
    page.on('response', async response => {
      try {
        const url = response.url(), ct = String(response.headers()['content-type'] || '');
        if (!config.networkHints.test(url) && !/json|text/i.test(ct)) return;
        const body = await response.text();
        if (body && body.length < 300000 && /(awb|shipment|origin|destination|arrival|pieces|weight|status|RCF|DLV|DEP)/i.test(body)) network.push(body);
      } catch {}
    });

    let target = config.url;
    if (config.queryParam) {
      const u = new URL(config.url); u.searchParams.set(config.queryParam, mawb.replace(/\D/g,'')); target = u.toString();
    }
    await page.goto(target, { waitUntil:'domcontentloaded', timeout:30000 });
    await sleep(2200);

    let combined = `${await deepText(page)}\n${network.join('\n')}`;
    let parsed = parseShipment(combined, mawb, config);
    if (parsed.useful) return { ok:true, airline:config, shipment:parsed.shipment, debug:{ ...debug, stage:'EXACT_SUCCESS_DIRECT', networkResponses:network.length } };

    const submitted = await fillOfficialForm(page, mawb, config);
    debug.submitted = submitted;
    if (!submitted && !config.queryParam) return { ok:false, technical:true, reason:'Official tracking form was not accessible.', airline:config, debug:{ ...debug, stage:'EXACT_FORM_NOT_FOUND' } };

    for (let attempt=0; attempt<16; attempt+=1) {
      await sleep(attempt===0 ? 1200 : 750);
      combined = `${await deepText(page)}\n${network.join('\n')}`;
      parsed = parseShipment(combined, mawb, config);
      if (parsed.notFound) return { ok:false, notFound:true, technical:false, reason:`${config.name} returned no shipment record.`, airline:config, debug:{ ...debug, stage:'EXACT_NO_RECORD' } };
      if (parsed.useful) return { ok:true, airline:config, shipment:parsed.shipment, debug:{ ...debug, stage:'EXACT_SUCCESS', networkResponses:network.length } };
    }
    return { ok:false, technical:true, reason:`${config.name} accepted the MAWB but the shipment result was not machine-readable.`, airline:config, debug:{ ...debug, stage:'EXACT_RESULT_UNREADABLE', networkResponses:network.length, preview:clean(combined).slice(0,700) } };
  } catch (error) {
    return { ok:false, technical:true, reason:error?.message || `${config.name} official tracker failed.`, airline:config, debug:{ ...debug, stage:'EXACT_BROWSER_ERROR' } };
  } finally { if (browser) try { await browser.close(); } catch {} }
}
