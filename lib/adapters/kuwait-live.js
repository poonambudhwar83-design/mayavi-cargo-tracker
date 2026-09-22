import fs from 'node:fs';

const AIRLINE = {
  name: 'Kuwait Airways Cargo',
  iata: 'KU',
  url: 'https://www.kuwaitairways.com/en/cargo/tracking'
};

const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function browserConfig() {
  for (const executablePath of [process.env.CHROME_EXECUTABLE_PATH, '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'].filter(Boolean)) {
    if (fs.existsSync(executablePath)) return { executablePath, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-zygote'] };
  }
  const mod = await import('@sparticuz/chromium');
  const chromium = mod.default || mod;
  return { executablePath: await chromium.executablePath(), args: chromium.args };
}

function addHours(dateText, timeText, hours = 0) {
  const m = String(dateText).match(/^(\d{1,2})-([A-Z]{3})-(\d{2,4})$/i);
  const t = String(timeText).match(/^(\d{1,2}):(\d{2})$/);
  if (!m || !t) return null;
  const months = { JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11 };
  const month = months[m[2].toUpperCase()];
  if (month === undefined) return null;
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  const d = new Date(Date.UTC(year, month, Number(m[1]), Number(t[1]), Number(t[2]), 0));
  d.setUTCHours(d.getUTCHours() + hours);
  const pad = n => String(n).padStart(2,'0');
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`;
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  return { date, time, iso: `${date}T${time}:00` };
}

function addSevenHours(dateText, timeText) {
  return addHours(dateText, timeText, 7);
}

function normalizeKuwaitDate(value) {
  return String(value || '').toUpperCase().replace(/\s*[-–—]\s*/g, '-').trim();
}

function findLabeledDateTime(text, kind, fallbackDate = '') {
  const DATE = '(\\d{1,2}\\s*[-–—]\\s*[A-Z]{3}\\s*[-–—]\\s*\\d{2,4})';
  const TIME = '(\\d{1,2}:\\d{2})';
  const label = kind === 'arrival'
    ? '(?:scheduled\\s+arrival|expected\\s+arrival|arrival\\s+date(?:\\s*\\/\\s*time)?|arrival\\s+time|\\bSTA\\b)'
    : '(?:scheduled\\s+departure|expected\\s+departure|departure\\s+date(?:\\s*\\/\\s*time)?|departure\\s+time|\\bSTD\\b)';

  let m = String(text || '').match(new RegExp(label + '[\\s:–—-]{0,20}' + DATE + '[\\s,|/:-]{1,30}' + TIME, 'i'));
  if (m) return { date: normalizeKuwaitDate(m[1]), time: m[2] };

  const dateMatch = String(text || '').match(new RegExp(label + '[\\s:–—-]{0,25}' + DATE, 'i'));
  const timeMatch = String(text || '').match(new RegExp(label + '[\\s:–—-]{0,25}' + TIME, 'i'));
  if (timeMatch) return { date: normalizeKuwaitDate(dateMatch?.[1] || fallbackDate), time: timeMatch[1] };

  return null;
}

function findRcfDateTime(text) {
  const DATE = '(\\d{1,2}\\s*[-–—]\\s*[A-Z]{3}\\s*[-–—]\\s*\\d{2,4})';
  const TIME = '(\\d{1,2}:\\d{2})';
  const patterns = [
    new RegExp('(?:\\bRCF\\b|received\\s+from\\s+flight)[\\s\\S]{0,140}?' + DATE + '[\\s,|/-]{1,30}' + TIME, 'i'),
    new RegExp(DATE + '[\\s,|/-]{1,30}' + TIME + '[\\s\\S]{0,80}?(?:\\bRCF\\b|received\\s+from\\s+flight)', 'i')
  ];
  for (const re of patterns) {
    const m = String(text || '').match(re);
    if (m) return { date: normalizeKuwaitDate(m[1]), time: m[2] };
  }
  return null;
}

function parseKuwait(text, mawb) {
  const compact = clean(text);
  const lines = String(text || '').split(/\r?\n/).map(clean).filter(Boolean);
  const digits = mawb.replace(/\D/g,'');
  const serial = digits.slice(3);
  if (!compact.includes(digits) && !compact.includes(`229-${serial}`) && !compact.includes(serial)) return null;

  const route = compact.match(/\b([A-Z]{3})\s+(?:RCS|DEP)[\s\S]{0,160}\b([A-Z]{3})\s+(?:RCF|DLV)/i);

  // Kuwait's flight card/table is available before DEP is posted. Keep this
  // generic for every future 229 MAWB rather than tying the parser to one AWB.
  // Typical row example: KU381 19-SEP-26 KWI DEL 80 2557.0 ...
  const flightRow = compact.match(/\b(KU\s*\d{2,4})\b\s+(\d{1,2}\s*[-–—]\s*[A-Z]{3}\s*[-–—]\s*\d{2,4})\s+([A-Z]{3})\s+([A-Z]{3})\s+(\d{1,5})\s+([\d,.]+)/i);

  const rowFlightNo = (flightRow?.[1] || '').replace(/\s+/g,'').toUpperCase();
  const rowDate = normalizeKuwaitDate(flightRow?.[2] || '');
  const rowOrigin = (flightRow?.[3] || '').toUpperCase();
  const rowDestination = (flightRow?.[4] || '').toUpperCase();

  const origin = route?.[1] || rowOrigin || (compact.match(/\bKWI\b/) ? 'KWI' : '');
  const destination = route?.[2] || rowDestination || (compact.match(/\bDEL\b/) ? 'DEL' : '');

  const flightLineIndex = rowFlightNo
    ? lines.findIndex(line => line.replace(/\s+/g,'').toUpperCase().includes(rowFlightNo))
    : -1;
  const cardWindow = flightLineIndex >= 0
    ? lines.slice(Math.max(0, flightLineIndex - 5), Math.min(lines.length, flightLineIndex + 14)).join(' ')
    : compact;
  const cardDeparture = findLabeledDateTime(cardWindow, 'departure', rowDate)
    || findLabeledDateTime(compact, 'departure', rowDate);
  const cardArrival = findLabeledDateTime(cardWindow, 'arrival', rowDate)
    || findLabeledDateTime(compact, 'arrival', rowDate);
  const rcf = findRcfDateTime(compact);

  // Treat departure as confirmed only when Kuwait publishes an actual departure
  // milestone with its own date/time. Do not let a generic DEP table/header match
  // a later scheduled flight-card date/time.
  const departedText = compact.match(/(?:Status\s+)?Departed(?:\s+on\s+Flight)?[^|]{0,160}?(\d{1,2}\s*[-–—]\s*[A-Z]{3}\s*[-–—]\s*\d{2,4})\s+(\d{1,2}:\d{2})/i);
  const depLine = lines.find(line =>
    /\bDEP\b/i.test(line) &&
    !/scheduled|expected|\bSTD\b|pre[\s-]?manifest/i.test(line) &&
    /\b\d{1,2}\s*[-–—]\s*[A-Z]{3}\s*[-–—]\s*\d{2,4}\b/i.test(line) &&
    /\b\d{1,2}:\d{2}\b/.test(line)
  ) || '';
  const depLineMatch = depLine.match(/(\d{1,2}\s*[-–—]\s*[A-Z]{3}\s*[-–—]\s*\d{2,4})[^0-9]{0,30}(\d{1,2}:\d{2})/i);
  const dep = departedText || depLineMatch;

  const pieces = (compact.match(/\bDEP\b[\s\S]{0,80}?(\d{1,5})\s+Pieces?/i) || compact.match(/(\d{1,5})\s+Pieces?/i) || [])[1] || flightRow?.[5] || '';
  const weight = ((compact.match(/Departed(?:\s+on\s+Flight)?\s+([\d,.]+)\s*Kgs?/i) || compact.match(/\bDEP\b[\s\S]{0,100}?([\d,.]+)\s*Kgs?/i) || [])[1] || flightRow?.[6] || '').replace(/,/g,'');
  const depFlightNo = ((compact.match(/Departed\s+on\s+Flight\s+([A-Z]{0,2}\s*\d{2,4})/i) || [])[1] || '').replace(/\s+/g,'').replace(/\.0$/,'').toUpperCase();
  const flightNo = depFlightNo || rowFlightNo;
  const preManifested = /\bPre[\s-]?Manifested\b/i.test(compact);

  let arrival = null;
  let departureDate = '';
  let departureTime = '';
  let status = preManifested ? 'PRE-MANIFESTED' : 'SCHEDULED';
  let arrivalIsActual = false;
  let sourceRule = '';

  // 1) RCF is the strongest signal: use the airline's actual received-from-flight
  // date/time exactly and do not overwrite it with a calculated ETA.
  if (rcf?.date && rcf?.time) {
    arrival = addHours(rcf.date, rcf.time, 0);
    status = 'ARRIVED';
    arrivalIsActual = true;
    sourceRule = 'RCF actual arrival';
  }

  // 2) Once DEP is published, calculate Delhi arrival from the actual Kuwait
  // departure timestamp using the agreed +7 hour operational rule.
  if (!arrival && dep) {
    departureDate = normalizeKuwaitDate(dep[1]);
    departureTime = dep[2];
    arrival = addSevenHours(departureDate, departureTime);
    sourceRule = 'DEP + 7 hours rule';
  }

  // 3) Before actual DEP/RCF, do NOT publish an arrival date/time.
  // A scheduled flight card can be stale or can refer to a timetable rather than
  // this shipment's confirmed movement. Keep only the scheduled departure clock
  // as context; Mayavi will fill arrival only after DEP (+7h) or RCF.
  if (!arrival && cardDeparture?.date && cardDeparture?.time) {
    departureDate = cardDeparture.date;
    departureTime = cardDeparture.time;
    sourceRule = 'scheduled flight card · departure not confirmed';
  }

  if (!arrival && !dep && !rcf) {
    sourceRule = sourceRule || 'departure not confirmed';
  }

  if (preManifested && !dep && !rcf) {
    sourceRule = sourceRule
      ? `Pre-Manifested · departure not confirmed · ${sourceRule}`
      : 'Pre-Manifested · departure not confirmed';
  }

  if (!arrivalIsActual && dep) {
    const arrivalMs = new Date(`${arrival.iso}+05:30`).getTime();
    status = Number.isFinite(arrivalMs) && Date.now() >= arrivalMs ? 'ARRIVED' : 'IN TRANSIT';
  }

  return {
    mawb,
    carrierCode: 'KU',
    airlineName: AIRLINE.name,
    origin,
    destination,
    bags: pieces,
    pieces,
    weight,
    flightNo,
    departureDate,
    departureTime,
    arrivalDate: arrival?.date || '',
    arrivalTime: arrival?.time || '',
    arrivalIsActual,
    eta: arrival?.iso || null,
    actualArrival: arrivalIsActual ? arrival.iso : null,
    status,
    officialTracker: AIRLINE.url,
    source: `Kuwait Airways official cargo tracker · ${sourceRule}`
  };
}

async function setValue(page, el, value) {
  await page.evaluate((node, next) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(node, next); else node.value = next;
    node.dispatchEvent(new Event('input', { bubbles:true }));
    node.dispatchEvent(new Event('change', { bubbles:true }));
  }, el, value);
}

export async function trackKuwaitLive(mawb) {
  const digits = String(mawb).replace(/\D/g,'');
  if (!digits.startsWith('229') || digits.length !== 11) return { ok:false, airline:AIRLINE, reason:'NOT A KUWAIT AIRWAYS MAWB' };
  let browser;
  try {
    const puppeteer = await import('puppeteer-core');
    browser = await puppeteer.launch({ headless:true, ...(await browserConfig()) });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125 Safari/537.36');
    await page.goto(AIRLINE.url, { waitUntil:'domcontentloaded', timeout:45000 });
    await sleep(2500);

    const inputs = await page.$$('input');
    const visible = [];
    for (const el of inputs) {
      try {
        const meta = await page.evaluate(node => {
          const r=node.getBoundingClientRect();
          return { visible:r.width>3&&r.height>3&&!node.disabled, max:Number(node.maxLength||0), label:`${node.placeholder||''} ${node.name||''} ${node.id||''}` };
        }, el);
        if (meta.visible) visible.push({el,meta});
      } catch {}
    }

    const prefixInput = visible.find(x => x.meta.max===3 || /prefix|airline/i.test(x.meta.label));
    const serialInput = visible.find(x => x !== prefixInput && (x.meta.max===8 || /awb|waybill|shipment|number/i.test(x.meta.label)));
    if (!serialInput) return { ok:false, airline:AIRLINE, reason:'KUWAIT TRACKING FORM NOT ACCESSIBLE' };

    if (prefixInput) await setValue(page, prefixInput.el, '229');
    await setValue(page, serialInput.el, digits.slice(3));

    const buttons = await page.$$('button,input[type="submit"],input[type="button"]');
    let clicked=false;
    for (const b of buttons) {
      try {
        const text=await page.evaluate(node=>String(node.innerText||node.value||'').trim(),b);
        if (/submit|track|search/i.test(text)) { await b.click(); clicked=true; break; }
      } catch {}
    }
    if (!clicked) await serialInput.el.press('Enter');

    await sleep(3500);
    const body = await page.evaluate(() => document.body?.innerText || '');
    const shipment = parseKuwait(body, `229-${digits.slice(3)}`);
    if (!shipment) return { ok:false, airline:AIRLINE, reason:'KUWAIT DEPARTURE DETAILS NOT FOUND', debug:{ stage:'parse', sample:clean(body).slice(0,1200) } };
    return { ok:true, airline:AIRLINE, shipment, debug:{ stage:'kuwait-dep-plus-7', departure:`${shipment.departureDate} ${shipment.departureTime}`, calculatedArrival:`${shipment.arrivalDate} ${shipment.arrivalTime}` } };
  } catch (e) {
    return { ok:false, airline:AIRLINE, reason:e?.message || 'KUWAIT TRACKING FAILED' };
  } finally {
    try { if (browser) await browser.close(); } catch {}
  }
}
