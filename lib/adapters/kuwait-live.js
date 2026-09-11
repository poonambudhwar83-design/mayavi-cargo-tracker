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

function addSevenHours(dateText, timeText) {
  const m = String(dateText).match(/^(\d{1,2})-([A-Z]{3})-(\d{2,4})$/i);
  const t = String(timeText).match(/^(\d{1,2}):(\d{2})$/);
  if (!m || !t) return null;
  const months = { JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11 };
  const month = months[m[2].toUpperCase()];
  if (month === undefined) return null;
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  const d = new Date(Date.UTC(year, month, Number(m[1]), Number(t[1]), Number(t[2]), 0));
  d.setUTCHours(d.getUTCHours() + 7);
  const pad = n => String(n).padStart(2,'0');
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`;
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  return { date, time, iso: `${date}T${time}:00` };
}

function parseKuwait(text, mawb) {
  const compact = clean(text);
  const digits = mawb.replace(/\D/g,'');
  const serial = digits.slice(3);
  if (!compact.includes(digits) && !compact.includes(`229-${serial}`) && !compact.includes(serial)) return null;

  const route = compact.match(/\b([A-Z]{3})\s+(?:RCS|DEP)[\s\S]{0,160}\b([A-Z]{3})\s+(?:RCF|DLV)/i);
  const origin = route?.[1] || (compact.match(/\bKWI\b/) ? 'KWI' : '');
  const destination = route?.[2] || (compact.match(/\bDEL\b/) ? 'DEL' : '');

  const dep = compact.match(/(?:Status\s+)?Departed(?:\s+on\s+Flight)?[\s\S]{0,120}?(\d{1,2}-[A-Z]{3}-\d{2,4})\s+(\d{1,2}:\d{2})/i)
    || compact.match(/\bDEP\b[\s\S]{0,120}?(\d{1,2}-[A-Z]{3}-\d{2,4})\s+(\d{1,2}:\d{2})/i);
  if (!dep) return null;

  const arrival = addSevenHours(dep[1].toUpperCase(), dep[2]);
  if (!arrival) return null;

  const pieces = (compact.match(/\bDEP\b[\s\S]{0,80}?(\d{1,5})\s+Pieces?/i) || compact.match(/(\d{1,5})\s+Pieces?/i) || [])[1] || '';
  const weight = ((compact.match(/Departed(?:\s+on\s+Flight)?\s+([\d,.]+)\s*Kgs?/i) || compact.match(/\bDEP\b[\s\S]{0,100}?([\d,.]+)\s*Kgs?/i) || [])[1] || '').replace(/,/g,'');
  const flightNo = ((compact.match(/Departed\s+on\s+Flight\s+([A-Z]{0,2}\s*\d{2,4})/i) || [])[1] || '').replace(/\s+/g,'').replace(/\.0$/,'');

  const arrivalMs = new Date(`${arrival.iso}+05:30`).getTime();
  const status = Number.isFinite(arrivalMs) && Date.now() >= arrivalMs ? 'ARRIVED' : 'IN TRANSIT';

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
    departureDate: dep[1].toUpperCase(),
    departureTime: dep[2],
    arrivalDate: arrival.date,
    arrivalTime: arrival.time,
    arrivalIsActual: status === 'ARRIVED',
    eta: arrival.iso,
    actualArrival: status === 'ARRIVED' ? arrival.iso : null,
    status,
    officialTracker: AIRLINE.url,
    source: 'Kuwait Airways official cargo tracker · DEP + 7 hours rule'
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
