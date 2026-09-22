import fs from 'node:fs';
import { createWorker } from 'tesseract.js';
import { normalizeMawb } from './airlines.js';
import { dismissTurkishCookies } from './turkish-cookie.js';

const URL = 'https://www.turkishcargo.com/en/cargo-tracking';
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


async function launchTurkishBrowser(puppeteer, launch) {
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      return await puppeteer.launch({
        ...launch,
        headless:true,
        defaultViewport:{ width:1440, height:1200, deviceScaleFactor:1.25 }
      });
    } catch (error) {
      lastError = error;
      const message = String(error?.message || error || '');
      if (!/ETXTBSY|EBUSY|EAGAIN|ENOENT/i.test(message) || attempt === 5) throw error;
      await sleep(450 * attempt);
    }
  }
  throw lastError || new Error('Turkish browser launch failed');
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

export function parseTkSmart(cardText='', bodyText='', mawb='') {
  const card = clean(cardText);
  const body = clean(bodyText);
  const combined = clean(`${card} ${body}`);
  if (!combined) return null;
  if (/no (?:shipment|record|result)|not found|invalid (?:awb|air waybill)|no data/i.test(combined)) return { notFound:true };

  const digits = digitsOnly(mawb);
  const serial = digits.slice(3);
  const flat = digitsOnly(combined);
  const awbMatched = combined.includes(mawb) || combined.includes(digits) || combined.includes(serial) || flat.includes(digits) || flat.includes(serial);
  const looksLikeTk = /TK\s*SMART|Cargo\s+Tracking\s+Information/i.test(combined) && /(piece|kg|\bFrom\b|\bTo\b|Delivered|Booked|Departure|Received)/i.test(combined);
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
  const firstLeg = reservationRows.length ? reservationRows[0] : null;
  const finalLeg = reservationRows.length ? reservationRows.at(-1) : null;
  if (reservationRows.length) {
    origin = origin || firstLeg?.origin || '';
    destination = destination || finalLeg?.destination || '';
  }
  const originLeg = reservationRows.find(r => r.origin === origin) || firstLeg;

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
  else if (/\bDEP\b|DEPARTED|AIRBORNE|IN FLIGHT/.test(upper)) status = 'DEPARTED';
  else if (/IN TRANSIT/.test(upper)) status = 'IN TRANSIT';

  const arrivalDate = actualArrival?.date || finalLeg?.etaDate || '';
  const arrivalTime = actualArrival?.time || finalLeg?.etaTime || '';
  const scheduledArrivalDate = finalLeg?.etaDate || '';
  const scheduledArrivalTime = finalLeg?.etaTime || '';
  const departureDate = originLeg?.etdDate || originLeg?.flightDate || '';
  const departureTime = originLeg?.etdTime || '';
  const scheduledDeparture = departureDate ? combineDateTime(departureDate, departureTime) : '';
  const departureFlightNo = originLeg?.flightNo || '';
  const flightNo = finalLeg?.flightNo || departureFlightNo || '';
  const flightDate = finalLeg?.flightDate || originLeg?.flightDate || '';

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
      departureFlightNo,
      departureOrigin:originLeg?.origin || origin || '',
      departureDestination:originLeg?.destination || '',
      departureDate,
      departureTime,
      departureTimeSource:'Turkish Cargo TK SMART origin-leg ETD',
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


const DIRECT_API_URL = 'https://www.turkishcargo.com/api/proxy/onlineServices/shipmentTracking';

function tkApiDateTime(value='') {
  const s = clean(value);
  if (!s) return null;
  let m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    const mon = MONTH[m[2].slice(0,3).toUpperCase()];
    if (mon) return { date:`${m[3]}-${mon}-${String(m[1]).padStart(2,'0')}`, time:`${String(m[4]).padStart(2,'0')}:${m[5]}` };
  }
  m = s.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})\s+(\d{1,2}):(\d{2})/);
  if (m) return { date:`${m[3]}-${String(m[2]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`, time:`${String(m[4]).padStart(2,'0')}:${m[5]}` };
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[T\s]+(\d{1,2}):(\d{2})/);
  if (m) return { date:`${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`, time:`${String(m[4]).padStart(2,'0')}:${m[5]}` };
  return null;
}

function tkApiObjects(value, out=[]) {
  if (!value || typeof value !== 'object') return out;
  out.push(value);
  if (Array.isArray(value)) value.forEach(v => tkApiObjects(v, out));
  else Object.values(value).forEach(v => tkApiObjects(v, out));
  return out;
}

function tkApiFirst(obj, names=[]) {
  if (!obj || typeof obj !== 'object') return '';
  for (const name of names) {
    const v = obj[name];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return '';
}

function tkApiEventLabel(node={}) {
  return clean([
    tkApiFirst(node,['status','statusCode','eventCode','milestoneCode','code']),
    tkApiFirst(node,['description','eventName','eventDetail','milestone','activity'])
  ].filter(Boolean).join(' ')).toUpperCase();
}

function tkApiTime(node={}, modes=['actualDatetime','actualDateTime','eventDatetime','eventDateTime','dateTime','datetime']) {
  for (const key of modes) {
    const p = tkApiDateTime(node?.[key]);
    if (p) return p;
  }
  return null;
}

function parseTurkishApiResponse(data, mawb) {
  const shipments = data?.result?.shipmentTrackings || data?.shipmentTrackings || [];
  const shipment = Array.isArray(shipments) ? shipments[0] : null;
  if (!shipment || typeof shipment !== 'object') return null;

  const origin = clean(tkApiFirst(shipment,['originCode','origin','originAirport','from'])).toUpperCase();
  const destination = clean(tkApiFirst(shipment,['destinationCode','destination','destinationAirport','to'])).toUpperCase();
  const pieces = clean(tkApiFirst(shipment,['pieces','pieceCount','piecesCount','pcs','bags']));
  const weight = clean(tkApiFirst(shipment,['weight','grossWeight','totalWeight','chargeableWeight'])).replace(/,/g,'');
  const rawStatus = clean(tkApiFirst(shipment,['actualStatus','status','statusName','latestStatus']));

  const nodes = tkApiObjects(shipment);
  const history = Array.isArray(shipment.trackingHistoryDetails) ? shipment.trackingHistoryDetails : [];
  const diagram = Array.isArray(shipment.trackingDiagramDetails) ? shipment.trackingDiagramDetails : [];
  const events = [...history, ...diagram, ...nodes.filter(n => n !== shipment)];

  const stationOf = n => clean(tkApiFirst(n,['station','stationCode','airport','airportCode','location'])).toUpperCase();
  const flightOf = n => clean(tkApiFirst(n,['flightNo','flightNumber','flight','flightCode'])).replace(/\s+/g,'').toUpperCase();
  const actualNodes = events
    .map(n => ({ n, label:tkApiEventLabel(n), when:tkApiTime(n) }))
    .filter(x => x.when);

  const arrivalCandidates = actualNodes.filter(x => {
    const station = stationOf(x.n);
    return /(^|\W)ARR($|\W)|ARRIVED|RECEIVED FROM FLIGHT|(^|\W)RCF($|\W)|DELIVERED|(^|\W)DLV($|\W)/i.test(x.label)
      && (!destination || !station || station === destination);
  });
  const departureCandidates = actualNodes.filter(x => {
    const station = stationOf(x.n);
    return /(^|\W)DEP($|\W)|DEPARTED|AIRBORNE|FLIGHT DEPART/i.test(x.label)
      && (!origin || !station || station === origin);
  });
  const bookedCandidates = actualNodes.filter(x => /(^|\W)BKD($|\W)|BOOKED|BOOKING/i.test(x.label));

  const actualArrival = arrivalCandidates.at(-1) || arrivalCandidates[0] || null;
  const actualDeparture = departureCandidates.at(-1) || departureCandidates[0] || null;
  const booked = bookedCandidates[0] || null;

  let scheduledArrival = null;
  let scheduledDeparture = null;
  for (const n of events) {
    const label = tkApiEventLabel(n);
    if (!scheduledArrival && /ARR|ARRIVAL|ETA/i.test(label)) {
      scheduledArrival = tkApiTime(n,['estimatedDatetime','estimatedDateTime','scheduledDatetime','scheduledDateTime','plannedDatetime','plannedDateTime','eta','arrivalDatetime','arrivalDateTime']);
    }
    if (!scheduledDeparture && /DEP|DEPARTURE|ETD/i.test(label)) {
      scheduledDeparture = tkApiTime(n,['estimatedDatetime','estimatedDateTime','scheduledDatetime','scheduledDateTime','plannedDatetime','plannedDateTime','etd','departureDatetime','departureDateTime']);
    }
  }

  if (!scheduledArrival) {
    for (const n of nodes) {
      scheduledArrival = tkApiTime(n,['estimatedArrivalDatetime','estimatedArrivalDateTime','scheduledArrivalDatetime','scheduledArrivalDateTime','plannedArrivalDatetime','plannedArrivalDateTime','etaDateTime','eta']);
      if (scheduledArrival) break;
    }
  }
  if (!scheduledDeparture) {
    for (const n of nodes) {
      scheduledDeparture = tkApiTime(n,['estimatedDepartureDatetime','estimatedDepartureDateTime','scheduledDepartureDatetime','scheduledDepartureDateTime','plannedDepartureDatetime','plannedDepartureDateTime','etdDateTime','etd']);
      if (scheduledDeparture) break;
    }
  }

  const arrival = actualArrival?.when || scheduledArrival || null;
  const departure = actualDeparture?.when || scheduledDeparture || null;
  const flightNo = flightOf(actualArrival?.n || {}) || flightOf(actualDeparture?.n || {}) ||
    clean(tkApiFirst(shipment,['flightNo','flightNumber','flight','flightCode'])).replace(/\s+/g,'').toUpperCase() ||
    events.map(flightOf).find(Boolean) || '';

  let status = rawStatus.toUpperCase();
  const labels = events.map(tkApiEventLabel).join(' ');
  if (actualArrival || /DELIVERED|(^|\W)DLV($|\W)|ARRIVED|RECEIVED FROM FLIGHT|(^|\W)RCF($|\W)/i.test(`${status} ${labels}`)) status = 'ARRIVED';
  else if (actualDeparture || /DEPARTED|AIRBORNE|(^|\W)DEP($|\W)/i.test(`${status} ${labels}`)) status = 'DEPARTED';
  else if (/DELAY|LATE|EXCEPTION/i.test(`${status} ${labels}`)) status = 'DELAYED';
  else if (/BOOK|ACCEPT|RCS|RECEIVED/i.test(`${status} ${labels}`)) status = rawStatus || 'BOOKED';
  else if (!status) status = 'TRACKING';

  const useful = Boolean(origin || destination || pieces || weight || flightNo || arrival || departure || history.length || diagram.length);
  if (!useful) return null;

  return {
    mawb,
    carrierCode:'TK',
    airlineName:'Turkish Cargo',
    officialTracker:URL,
    origin,
    destination,
    bags:pieces,
    pieces,
    weight,
    flightNo,
    bookingDate:booked?.when?.date || '',
    departureDate:departure?.date || '',
    departureTime:departure?.time || '',
    departureTimeSource:actualDeparture ? 'Turkish Cargo official API actual departure' : (scheduledDeparture ? 'Turkish Cargo official API scheduled departure' : ''),
    scheduledArrivalDate:scheduledArrival?.date || '',
    scheduledArrivalTime:scheduledArrival?.time || '',
    arrivalDate:arrival?.date || '',
    arrivalTime:arrival?.time || '',
    arrivalIsActual:Boolean(actualArrival),
    actualArrivalDate:actualArrival?.when?.date || '',
    actualArrivalTime:actualArrival?.when?.time || '',
    actualArrival:actualArrival?.when ? combineDateTime(actualArrival.when.date, actualArrival.when.time) : '',
    status,
    source:'Turkish Cargo official shipmentTracking API'
  };
}

async function fetchTurkishDirectApi(mawb) {
  const digits = digitsOnly(mawb);
  if (digits.length !== 11 || !digits.startsWith('235')) return { ok:false, reason:'INVALID TURKISH MAWB' };
  const prefix = digits.slice(0,3);
  const serial = digits.slice(3);
  try {
    const response = await fetch(DIRECT_API_URL, {
      method:'POST',
      headers:{
        'content-type':'application/json',
        'accept':'application/json, text/plain, */*',
        'origin':'https://www.turkishcargo.com',
        'referer':'https://www.turkishcargo.com/en/cargo-tracking',
        'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36'
      },
      body:JSON.stringify({ trackingFilters:[{ shipmentPrefix:prefix, masterDocumentNumber:serial }] }),
      cache:'no-store',
      signal:AbortSignal.timeout(18000)
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch {}
    if (!response.ok) return { ok:false, reason:`TURKISH API HTTP ${response.status}`, httpStatus:response.status, sample:clean(text).slice(0,800) };
    const shipment = parseTurkishApiResponse(data, mawb);
    if (!shipment) return { ok:false, reason:'TURKISH API RETURNED NO USABLE SHIPMENT', httpStatus:response.status, sample:clean(text).slice(0,800) };
    return { ok:true, shipment, httpStatus:response.status };
  } catch (error) {
    return { ok:false, reason:error?.message || 'TURKISH API REQUEST FAILED' };
  }
}


async function fetchTurkishFromBrowserSession(page, mawb) {
  const digits = digitsOnly(mawb);
  if (digits.length !== 11 || !digits.startsWith('235')) return { ok:false, reason:'INVALID TURKISH MAWB' };
  const prefix = digits.slice(0,3);
  const serial = digits.slice(3);
  try {
    const result = await page.evaluate(async ({ apiUrl, prefix, serial }) => {
      try {
        const response = await fetch(apiUrl, {
          method:'POST',
          credentials:'include',
          headers:{
            'content-type':'application/json',
            'accept':'application/json, text/plain, */*'
          },
          body:JSON.stringify({ trackingFilters:[{ shipmentPrefix:prefix, masterDocumentNumber:serial }] })
        });
        const text = await response.text();
        return { ok:response.ok, status:response.status, text:text.slice(0,120000) };
      } catch (error) {
        return { ok:false, status:0, error:error?.message || String(error), text:'' };
      }
    }, { apiUrl:DIRECT_API_URL, prefix, serial });

    let data = null;
    try { data = result?.text ? JSON.parse(result.text) : null; } catch {}
    if (!result?.ok) return { ok:false, reason:result?.error || `TURKISH BROWSER API HTTP ${result?.status || 0}`, httpStatus:result?.status || 0, sample:clean(result?.text || '').slice(0,900) };
    const shipment = parseTurkishApiResponse(data, mawb);
    if (!shipment) return { ok:false, reason:'TURKISH BROWSER API RETURNED NO USABLE SHIPMENT', httpStatus:result.status, sample:clean(result?.text || '').slice(0,900) };
    shipment.source = 'Turkish Cargo official API via browser session';
    shipment.officialTracker = URL;
    return { ok:true, shipment, httpStatus:result.status };
  } catch (error) {
    return { ok:false, reason:error?.message || 'TURKISH BROWSER SESSION API FAILED' };
  }
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
          const clickable = el => el.closest('button,a,[role="button"],mat-option,.mat-mdc-option,.mat-option,[role="option"],li') || el;
          const nodes = [...document.querySelectorAll('button,a,[role="button"],input[type="button"],input[type="submit"],mat-option,.mat-mdc-option,.mat-option,[role="option"],li,[class*="option"],[class*="autocomplete"],div,span,p')];
          const matches = [];
          for (const el of nodes) {
            if (!visible(el)) continue;
            const text = norm(el.innerText || el.textContent || el.value || '');
            const exactAdd = /^Add$/i.test(text);
            const addSerial = /^Add\s*:/i.test(text) && text.replace(/\D/g,'').includes(awb);
            if (!exactAdd && !addSerial) continue;
            const target = clickable(el);
            if (!visible(target) || target.disabled || target.getAttribute('aria-disabled') === 'true') continue;
            const tagPreferred = target.matches('button,a,[role="button"],input[type="button"],input[type="submit"]') ? 0 : 1;
            matches.push({ target, text, score:(exactAdd ? 0 : 10) + tagPreferred });
          }
          if (!matches.length) return null;
          matches.sort((a,b) => a.score - b.score || a.text.length - b.text.length);
          const chosen = matches[0];
          chosen.target.setAttribute('data-mayavi-turkish-add','1');
          chosen.target.scrollIntoView({ block:'center', inline:'center', behavior:'auto' });
          return { text:chosen.text, mode:/^Add$/i.test(chosen.text) ? 'PLAIN_ADD_BUTTON' : 'ADD_SERIAL_OPTION' };
        }, serial);
        if (!marked) continue;
        const handle = await frame.$('[data-mayavi-turkish-add="1"]');
        if (!handle) continue;
        await handle.hover().catch(()=>{});
        await sleep(120);
        await handle.click({ delay:120 });
        await sleep(700);
        try { await handle.evaluate(el => el.removeAttribute('data-mayavi-turkish-add')); } catch {}
        return { ok:true, text:marked.text, clickMode:marked.mode };
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
  const end = Date.now() + 15000;

  while (Date.now() < end) {
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
              value:String(el.value || ''),
              type:String(el.type || '').toLowerCase(),
              inputMode:String(el.inputMode || '').toLowerCase(),
              label:`${el.placeholder || ''} ${el.name || ''} ${el.id || ''} ${el.getAttribute('aria-label') || ''} ${el.labels?.[0]?.innerText || ''}`,
              x:r.x, y:r.y, w:r.width, h:r.height
            };
          });
          if (meta.visible) fields.push({ input, meta });
        } catch {}
      }
      if (!fields.length) continue;

      const usable = x => !/password|email|search/i.test(x.meta.type) && !/site search|search site|newsletter|email|password/i.test(x.meta.label);
      const prefixField = fields.find(x =>
        x.meta.max === 3 ||
        /prefix|awb code|airline code/i.test(x.meta.label) ||
        digitsOnly(x.meta.value) === prefix
      );

      let numberField = fields.find(x => x !== prefixField && (
        x.meta.max === 8 ||
        /awb|air waybill|waybill|shipment|master document|document number|tracking number/i.test(x.meta.label)
      ));
      if (!numberField) numberField = fields.find(x => x !== prefixField && [11,12,14].includes(x.meta.max));

      if (!numberField && prefixField) {
        const candidates = fields
          .filter(x => x !== prefixField && usable(x))
          .map(x => ({ x, distance:Math.abs(x.meta.y - prefixField.meta.y) * 4 + Math.abs(x.meta.x - prefixField.meta.x) }))
          .sort((a,b) => a.distance - b.distance);
        numberField = candidates[0]?.x || null;
      }

      if (!numberField) {
        numberField = fields.find(x => usable(x) && (
          x.meta.type === 'tel' ||
          x.meta.type === 'number' ||
          x.meta.inputMode === 'numeric' ||
          (x.meta.type === 'text' && (x.meta.max === -1 || x.meta.max >= 8))
        )) || null;
      }
      if (!numberField) continue;

      // Turkish normally pre-fills prefix 235. Preserve it when already correct.
      if (prefixField) {
        let actualPrefix = digitsOnly(prefixField.meta.value);
        if (actualPrefix !== prefix) {
          actualPrefix = await prefixField.input.evaluate((el, wanted) => {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
            if (setter) setter.call(el, wanted); else el.value = wanted;
            el.dispatchEvent(new Event('input', { bubbles:true }));
            el.dispatchEvent(new Event('change', { bubbles:true }));
            el.dispatchEvent(new Event('blur', { bubbles:true }));
            return String(el.value || '').replace(/\D/g,'');
          }, prefix);
          await sleep(250);
        }
        if (actualPrefix !== prefix) continue;
      }

      const wantedNumber = prefixField ? serial : (numberField.meta.max === 8 ? serial : digits);
      const actualNumber = await clearAndTypeInput(page, numberField.input, wantedNumber);
      if (digitsOnly(actualNumber) !== digitsOnly(wantedNumber)) continue;

      await sleep(700);

      // Exact Turkish UI flow: enter MAWB -> click Add -> click Search.
      const add = await clickAddOption(page, serial, 9000);
      if (!add.ok) {
        // Older Turkish builds exposed the add action as an autocomplete selection.
        await numberField.input.press('ArrowDown').catch(()=>{});
        await numberField.input.press('Enter').catch(()=>{});
        await sleep(650);
      }

      const search = await clickSearch(page, 8000);
      if (!search.ok) return { ok:false, stage:'SEARCH_BUTTON_NOT_FOUND', addText:add.text || '', addMode:add.clickMode || 'KEYBOARD_FALLBACK' };

      return {
        ok:true,
        prefixMode:prefixField ? 'KEEP_PREFILLED_235' : 'SINGLE_AWB_FIELD',
        addMode:add.clickMode || 'KEYBOARD_FALLBACK',
        addText:add.text || '',
        searchMode:'CLICK_SEARCH',
        tkSmartClicked:false
      };
    }
    await sleep(500);
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

function isHumanVerificationText(text='') {
  return /Press\s*&\s*Hold|confirm\s+you\s+are\s+a\s+human|verify\s+you\s+are\s+human|human\s+verification|not\s+a\s+bot/i.test(String(text||''));
}
async function waitForCargoTrackingInformation(page, timeout=20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const text = await pageText(page);
    // The Turkish page can render its result card while a human-verification
    // widget is also present. Do not fail early: prefer the actual TK SMART card.
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
        const cards = [...document.querySelectorAll('section,article,div,main,table,mat-card,[class*=cargo],[class*=tracking],[class*=shipment]')]
          .map(el => ({ el, text:norm(el.innerText || el.textContent || '') }))
          .filter(x => visible(x.el) && /TK\s*SMART|Cargo\s+Tracking\s+Information/i.test(x.text) && (x.text.includes(awb) || /(piece|kg|\bFrom\b|\bTo\b|Delivered|Booked|Departure|Received)/i.test(x.text)))
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
      const handles = await frame.$('section,article,div,main,table,mat-card,[class*=cargo],[class*=tracking],[class*=shipment]');
      const candidates = [];
      for (const el of handles) {
        try {
          const meta = await el.evaluate((node, awb) => {
            const r = node.getBoundingClientRect();
            const st = getComputedStyle(node);
            const text = String(node.innerText || node.textContent || '').replace(/\s+/g,' ').trim();
            const good = /TK\s*SMART|Cargo\s+Tracking\s+Information/i.test(text) && (text.includes(awb) || /(piece|kg|\bFrom\b|\bTo\b|Delivered|Booked|Departure|Received)/i.test(text)) && text.length >= 30 && text.length <= 6500;
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

  const directApi = await fetchTurkishDirectApi(mawb);
  if (directApi?.ok && directApi?.shipment) {
    return {
      ok:true,
      airline:AIRLINE,
      shipment:directApi.shipment,
      screenshotCaptured:false,
      screenshotVerified:false,
      screenshotOcrUsed:false,
      debug:{ prefix:'235', airline:'Turkish Cargo', url:DIRECT_API_URL, stage:'DIRECT_API_SUCCESS', httpStatus:directApi.httpStatus || 200 }
    };
  }

  let browser;
  const debug = { prefix:'235', airline:'Turkish Cargo', url:URL, stage:'OPEN', tkSmartClicked:false, directApiReason:directApi?.reason || '', directApiHttpStatus:directApi?.httpStatus || 0 };
  try {
    const mod = await import('puppeteer-core');
    const puppeteer = mod.default || mod;
    const launch = await browserConfig();
    browser = await launchTurkishBrowser(puppeteer, launch);

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36');
    await page.setExtraHTTPHeaders({ 'Accept-Language':'en-US,en;q=0.9' });
    await page.goto(URL, { waitUntil:'domcontentloaded', timeout:30000 });
    await sleep(1500);

    debug.cookieBefore = await dismissTurkishCookies(page);
    await sleep(350);

    const browserApi = await fetchTurkishFromBrowserSession(page, mawb);
    debug.browserApiStatus = browserApi?.httpStatus || 0;
    debug.browserApiReason = browserApi?.ok ? '' : (browserApi?.reason || '');
    if (browserApi?.ok && browserApi?.shipment) {
      return {
        ok:true,
        airline:AIRLINE,
        shipment:browserApi.shipment,
        screenshotCaptured:false,
        screenshotVerified:false,
        screenshotOcrUsed:false,
        debug:{ ...debug, stage:'BROWSER_SESSION_API_SUCCESS' }
      };
    }

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
    const verificationText = await pageText(page);
    debug.humanVerificationPresent = isHumanVerificationText(verificationText);
    if (debug.humanVerificationPresent) debug.verificationSample = clean(verificationText).slice(0,1200);
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
    return { ok:false, reason:error?.message || 'TURKISH TRACKING FAILED', airline:AIRLINE, debug:{ ...debug, stage:'BROWSER_ERROR', error:error?.message || String(error), stack:String(error?.stack || '').slice(0,1800) } };
  } finally {
    if (browser) {
      try { await browser.close(); } catch {}
    }
  }
}
