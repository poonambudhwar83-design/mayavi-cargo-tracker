import fs from 'node:fs';
import { normalizeMawb } from '../airlines.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const clean = value => String(value || '').replace(/\s+/g, ' ').trim();

const AIRLINE = {
  name: 'Vietnam Airlines Cargo',
  iata: 'VN',
  url: 'https://track.champ.aero/vn'
};

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
  const months = { jan:'01', feb:'02', mar:'03', apr:'04', may:'05', jun:'06', jul:'07', aug:'08', sep:'09', oct:'10', nov:'11', dec:'12' };
  return months[String(name).slice(0,3).toLowerCase()] || '';
}

function dateFromLong(value = '') {
  const m = String(value).match(/\b(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})\b/);
  if (!m) return '';
  const month = monthNumber(m[2]);
  return month ? `${m[3]}-${month}-${String(m[1]).padStart(2,'0')}` : '';
}

function dateFromFlightToken(value = '') {
  const m = String(value).match(/\b(\d{2})([A-Z]{3})(\d{2})\b/i);
  if (!m) return '';
  const month = monthNumber(m[2]);
  return month ? `20${m[3]}-${month}-${m[1]}` : '';
}

function addDays(date, days = 1) {
  const m = String(date).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2])-1, Number(m[3])));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0,10);
}

function eventTimestamp(date, time = '00:00') {
  const t = Date.parse(`${date}T${time}:00Z`);
  return Number.isFinite(t) ? t : 0;
}

function plannedVietnamArrival(flightNo, flightDate, origin, destination) {
  const f = String(flightNo || '').replace(/\s+/g,'').toUpperCase();
  const o = String(origin || '').toUpperCase();
  const d = String(destination || '').toUpperCase();

  // VN980 DEL -> HAN is an overnight service. CHAMP publishes the operating
  // flight date on MAN/pre-MAN/booking events; Mayavi converts that service
  // date to the next-day scheduled arrival until an actual arrival event exists.
  if (f === 'VN980' && o === 'DEL' && d === 'HAN' && flightDate) {
    const time = flightDate >= '2026-10-25' && flightDate <= '2027-03-27' ? '05:00' : '05:25';
    return {
      date: addDays(flightDate, 1),
      time,
      source: 'VN980 DEL-HAN published schedule'
    };
  }
  return { date:'', time:'', source:'' };
}

function extractRoute(text = '') {
  const route = text.match(/\b([A-Z]{3})\s*-\s*([A-Z]{3})\b/);
  if (route) return { origin: route[1], destination: route[2] };

  const stations = [...text.matchAll(/\b([A-Z]{3})\s*-\s*[A-Za-z][A-Za-z .'-]+(?:\([A-Z]{2}\))?/g)]
    .map(m => m[1])
    .filter((v,i,a) => a.indexOf(v) === i);
  return { origin: stations[0] || '', destination: stations[1] || '' };
}

function parseEvents(text = '') {
  const source = String(text || '').replace(/\r/g,'');
  const rows = source.split(/\n+/).map(clean).filter(Boolean);
  const events = [];

  const labelRe = /^(Booked|Booking On Hold|Received from shipper|Pre-manifested on flight|Manifested on flight|Departed|Flight departed|Arrived|Flight arrived|Received from flight|Consignee\/?Agent notified of arrival|Delivered)\b/i;
  const dtRe = /\b(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})\s*-\s*(\d{1,2}:\d{2})\b/;

  for (const row of rows) {
    const label = row.match(labelRe)?.[1] || '';
    const dt = row.match(dtRe);
    if (!label || !dt) continue;

    const date = dateFromLong(dt[1]);
    const time = dt[2].padStart(5,'0');
    const qty = row.match(/\b(\d{1,6})\s+pieces?\s+([\d,.]+)\s*Kg\b/i);
    const flight = row.match(/\b(VN\s?\d{2,4})\s+(\d{2}[A-Z]{3}\d{2})\b/i);

    events.push({
      label: clean(label),
      date,
      time,
      pieces: qty ? qty[1] : '',
      weight: qty ? qty[2].replace(/,/g,'') : '',
      flightNo: flight ? flight[1].replace(/\s+/g,'').toUpperCase() : '',
      flightDate: flight ? dateFromFlightToken(flight[2]) : '',
      row
    });
  }

  // CHAMP sometimes renders label + details in one collapsed text run rather
  // than separate lines. Capture those too, while de-duplicating by row facts.
  const broad = /(Booked|Booking On Hold|Received from shipper|Pre-manifested on flight|Manifested on flight|Departed|Flight departed|Arrived|Flight arrived|Received from flight|Consignee\/?Agent notified of arrival|Delivered)\s+(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})\s*-\s*(\d{1,2}:\d{2})([\s\S]{0,180}?)(?=(?:Booked|Booking On Hold|Received from shipper|Pre-manifested on flight|Manifested on flight|Departed|Flight departed|Arrived|Flight arrived|Received from flight|Consignee\/?Agent notified of arrival|Delivered)\s+\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}\s*-|$)/gi;
  for (const m of source.matchAll(broad)) {
    const tail = clean(m[4]);
    const qty = tail.match(/\b(\d{1,6})\s+pieces?\s+([\d,.]+)\s*Kg\b/i);
    const flight = tail.match(/\b(VN\s?\d{2,4})\s+(\d{2}[A-Z]{3}\d{2})\b/i);
    const event = {
      label: clean(m[1]),
      date: dateFromLong(m[2]),
      time: m[3].padStart(5,'0'),
      pieces: qty ? qty[1] : '',
      weight: qty ? qty[2].replace(/,/g,'') : '',
      flightNo: flight ? flight[1].replace(/\s+/g,'').toUpperCase() : '',
      flightDate: flight ? dateFromFlightToken(flight[2]) : '',
      row: clean(`${m[1]} ${m[2]} - ${m[3]} ${tail}`)
    };
    if (!events.some(e => e.label.toLowerCase()===event.label.toLowerCase() && e.date===event.date && e.time===event.time && e.flightNo===event.flightNo)) {
      events.push(event);
    }
  }

  return events.sort((a,b) => eventTimestamp(a.date,a.time) - eventTimestamp(b.date,b.time));
}

function statusForEvent(label = '') {
  if (/delivered/i.test(label)) return 'DELIVERED';
  if (/notified.*arrival|received from flight|flight arrived|^arrived$/i.test(label)) return 'ARRIVED';
  if (/depart/i.test(label)) return 'IN TRANSIT';
  if (/manifest/i.test(label)) return 'MANIFESTED';
  if (/received from shipper/i.test(label)) return 'RECEIVED';
  if (/booking on hold/i.test(label)) return 'BOOKING ON HOLD';
  if (/booked/i.test(label)) return 'BOOKED';
  return 'TRACKING';
}

export function parseVietnamChampText(rawText, mawb) {
  const text = String(rawText || '');
  const compact = clean(text);
  const digits = String(mawb || '').replace(/\D/g,'');
  const serial = digits.slice(3);

  if (/AWB number\(s\).*not found|not found|no record/i.test(compact) && !compact.includes(serial)) {
    return { notFound:true };
  }

  const route = extractRoute(text);
  const events = parseEvents(text);
  const booked = events.filter(e => /^Booked$/i.test(e.label));
  const latest = events.at(-1) || {};
  const latestQty = [...events].reverse().find(e => e.pieces || e.weight) || {};
  const latestFlightEvent = [...events].reverse().find(e => e.flightNo) || {};

  // Prefer the latest MAN/pre-MAN assignment over older booking/rebooking rows.
  const currentFlightEvent =
    [...events].reverse().find(e => /Manifested on flight/i.test(e.label) && e.flightNo) ||
    [...events].reverse().find(e => /Pre-manifested on flight/i.test(e.label) && e.flightNo) ||
    latestFlightEvent;

  const bookingDate = booked.length ? booked[0].date : '';
  const actualArrivalEvent =
    [...events].reverse().find(e => /Consignee\/?Agent notified of arrival|Received from flight|Flight arrived|^Arrived$/i.test(e.label)) ||
    null;

  const flightNo = currentFlightEvent?.flightNo || '';
  const flightDate = currentFlightEvent?.flightDate || '';
  const planned = actualArrivalEvent ? {date:'',time:'',source:''} : plannedVietnamArrival(flightNo, flightDate, route.origin, route.destination);
  const arrivalDate = actualArrivalEvent?.date || planned.date || '';
  const arrivalTime = actualArrivalEvent?.time || planned.time || '';
  const actualArrival = actualArrivalEvent && arrivalDate
    ? `${arrivalDate}T${arrivalTime || '00:00'}:00`
    : null;

  const seen = compact.includes(digits) || compact.includes(serial) || events.length > 0;
  const useful = Boolean(seen && (events.length || route.origin || route.destination));

  return {
    useful,
    shipment: {
      mawb,
      carrierCode: 'VN',
      airlineName: AIRLINE.name,
      origin: route.origin,
      destination: route.destination,
      bookingDate,
      bags: latestQty.pieces || '',
      pieces: latestQty.pieces || '',
      weight: latestQty.weight || '',
      flightNo,
      arrivalDate,
      arrivalTime,
      arrivalIsActual: Boolean(actualArrivalEvent),
      arrivalPlanned: Boolean(!actualArrivalEvent && planned.date),
      arrivalPlanSource: planned.source,
      eta: arrivalDate && arrivalTime && !actualArrivalEvent ? `${arrivalDate}T${arrivalTime}:00+07:00` : null,
      actualArrival,
      status: statusForEvent(latest.label),
      officialTracker: AIRLINE.url,
      source: 'Vietnam Airlines CHAMP official Track & Trace'
    },
    events
  };
}

async function setInput(page, handle, value) {
  await page.evaluate((el, v) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
    if (setter) setter.call(el, v); else el.value = v;
    el.dispatchEvent(new Event('input',{bubbles:true}));
    el.dispatchEvent(new Event('change',{bubbles:true}));
  }, handle, value);
}

async function submitMawb(page, mawb) {
  const digits = mawb.replace(/\D/g,'');
  const prefix = digits.slice(0,3);
  const serial = digits.slice(3);

  const inputs = await page.$$('input:not([type="hidden"]):not([disabled])');
  const visible = [];
  for (const input of inputs) {
    try {
      const meta = await page.evaluate(el => {
        const r = el.getBoundingClientRect();
        return {
          visible:r.width>3&&r.height>3,
          max:Number(el.maxLength||0),
          label:`${el.placeholder||''} ${el.name||''} ${el.id||''} ${el.getAttribute('aria-label')||''}`
        };
      }, input);
      if (meta.visible) visible.push({input,meta});
    } catch {}
  }

  const prefixInput = visible.find(x => x.meta.max===3 || /prefix|airline/i.test(x.meta.label));
  const serialInput = visible.find(x => x!==prefixInput && (x.meta.max===8 || /awb|waybill|number/i.test(x.meta.label)));

  if (prefixInput && serialInput) {
    await setInput(page,prefixInput.input,prefix);
    await setInput(page,serialInput.input,serial);
  } else if (visible.length >= 2) {
    await setInput(page,visible[0].input,prefix);
    await setInput(page,visible[1].input,serial);
  } else if (visible.length === 1) {
    await setInput(page,visible[0].input,digits);
  } else {
    return {ok:false,reason:'CHAMP tracking inputs not found'};
  }

  const clicked = await page.evaluate(() => {
    const candidates = [...document.querySelectorAll('button,input[type="submit"],input[type="button"],a,[role="button"]')];
    const target = candidates.find(el => /\btrack\b/i.test(String(el.innerText||el.value||el.getAttribute('aria-label')||'')));
    if (!target) return false;
    target.click();
    return true;
  });
  if (!clicked) return {ok:false,reason:'CHAMP TRACK button not found'};
  return {ok:true};
}

async function revealDetails(page) {
  try {
    await page.evaluate(() => {
      const candidates = [...document.querySelectorAll('summary,button,a,[role="button"],div,span')];
      const details = candidates.find(el => /^details$/i.test(String(el.innerText||'').trim()));
      if (details) details.click();
    });
  } catch {}
  try {
    await page.evaluate(async() => {
      for (let y=0;y<document.body.scrollHeight;y+=700) {
        window.scrollTo(0,y);
        await new Promise(r=>setTimeout(r,80));
      }
      window.scrollTo(0,document.body.scrollHeight);
    });
  } catch {}
}

export async function trackVietnamChamp(inputMawb) {
  const mawb = normalizeMawb(inputMawb);
  if (!mawb || !mawb.startsWith('738-')) {
    return {ok:false,technical:false,reason:'INVALID VIETNAM AIRLINES MAWB',airline:AIRLINE,debug:{stage:'INVALID_MAWB'}};
  }

  let browser;
  const debug = {stage:'CHAMP_OPEN',officialUrl:AIRLINE.url};
  try {
    const puppeteerModule = await import('puppeteer-core');
    const puppeteer = puppeteerModule.default || puppeteerModule;
    const config = await browserConfig();
    debug.browser = config.executablePath;

    browser = await puppeteer.launch({...config,headless:true,defaultViewport:{width:1440,height:1100}});
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131 Safari/537.36');
    await page.setExtraHTTPHeaders({'Accept-Language':'en-US,en;q=0.9'});
    await page.goto(AIRLINE.url,{waitUntil:'domcontentloaded',timeout:30000});
    await sleep(900);

    debug.stage='CHAMP_SUBMIT';
    const submitted = await submitMawb(page,mawb);
    debug.submit=submitted;
    if (!submitted.ok) return {ok:false,technical:true,reason:submitted.reason,airline:AIRLINE,debug};

    let bodyText='';
    for (let i=0;i<16;i+=1) {
      await sleep(i===0?1000:700);
      bodyText = await page.evaluate(() => document.body?.innerText || '');
      if (/AWB number\(s\).*not found/i.test(bodyText)) {
        return {ok:false,technical:false,notFound:true,reason:'CHAMP returned no shipment record.',airline:AIRLINE,debug:{...debug,stage:'CHAMP_NO_RECORD'}};
      }
      if (/Booked|Received from shipper|Manifested on flight|Arrived|Delivered/i.test(bodyText)) break;
    }

    await revealDetails(page);
    await sleep(500);
    bodyText = await page.evaluate(() => document.body?.innerText || bodyText);

    const parsed = parseVietnamChampText(bodyText,mawb);
    debug.stage='CHAMP_PARSED';
    debug.eventCount=parsed.events?.length||0;
    debug.latestEvent=parsed.events?.at(-1)?.label||'';
    debug.arrivalPlanned=Boolean(parsed.shipment?.arrivalPlanned);

    if (parsed.notFound) return {ok:false,technical:false,notFound:true,reason:'CHAMP returned no shipment record.',airline:AIRLINE,debug};
    if (!parsed.useful) return {ok:false,technical:true,reason:'CHAMP result opened but shipment events were not machine-readable.',airline:AIRLINE,debug};

    return {ok:true,airline:AIRLINE,shipment:parsed.shipment,debug};
  } catch (error) {
    return {ok:false,technical:true,reason:error?.message||'Vietnam CHAMP browser failed.',airline:AIRLINE,debug:{...debug,stage:'CHAMP_BROWSER_ERROR'}};
  } finally {
    if (browser) {
      try { await browser.close(); } catch {}
    }
  }
}
