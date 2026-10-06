import fs from 'node:fs';
import { airlineForMawb, normalizeMawb } from '../airlines.js';

const INDIGO_URL = 'https://6ecargo.goindigo.in/FrmAWBTracking.aspx';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const clean = value => String(value || '').replace(/\s+/g, ' ').trim();

async function browserConfig() {
  for (const executablePath of [
    process.env.CHROME_EXECUTABLE_PATH,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable'
  ].filter(Boolean)) {
    if (fs.existsSync(executablePath)) {
      return { executablePath, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-zygote'] };
    }
  }
  const mod = await import('@sparticuz/chromium');
  const chromium = mod.default || mod;
  return { executablePath: await chromium.executablePath(), args: chromium.args };
}

function parseDmyDate(value = '') {
  const m = clean(value).match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})\b/);
  if (!m) return '';
  return `${m[3]}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
}

function parseEventDateTime(value = '') {
  const s = clean(value);
  const m = s.match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return { date: parseDmyDate(s), time: '', timestamp: null };
  const date = `${m[3]}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
  const time = `${String(m[4]).padStart(2, '0')}:${m[5]}`;
  const timestamp = Date.parse(`${date}T${time}:${m[6] || '00'}Z`);
  return { date, time, timestamp: Number.isFinite(timestamp) ? timestamp : null };
}

function numeric(value = '') {
  const m = clean(value).replace(/,/g, '').match(/\b(\d+(?:\.\d+)?)\b/);
  return m ? m[1] : '';
}

function weightValue(value = '') {
  const m = clean(value).replace(/,/g, '').match(/([\d.]+)\s*(?:KGS?|KG)\b/i);
  return m ? m[1] : '';
}

function flightValue(value = '') {
  const m = clean(value).match(/\b6E\s*[- ]?(\d{2,4})\b/i);
  return m ? `6E${m[1].padStart(3, '0')}` : '';
}

function routeFromText(text = '') {
  const route = clean(text).match(/\b([A-Z]{3})\s*[-–—]\s*([A-Z]{3})\b/);
  return route ? { origin: route[1], destination: route[2] } : { origin: '', destination: '' };
}

function summaryFromText(text = '', mawb = '') {
  const compact = clean(text);
  const route = routeFromText(compact);
  const digits = mawb.replace(/\D/g, '');
  const around = compact.includes(digits.slice(3)) ? compact.slice(Math.max(0, compact.indexOf(digits.slice(3)) - 120)) : compact;
  const total = around.match(/\b(\d{1,5})\s*P\s*\/\s*([\d,.]+)\s*KGS?\b/i) ||
    around.match(/\b(\d{1,5})\s*(?:PCS?|PIECES?)\s*\/\s*([\d,.]+)\s*KGS?\b/i);
  return {
    ...route,
    totalPieces: total?.[1] || '',
    totalWeight: total?.[2]?.replace(/,/g, '') || ''
  };
}

function extractTableEvent(row, route) {
  const cells = row.map(clean).filter(Boolean);
  if (!cells.length) return null;
  const milestoneIndex = cells.findIndex(v => /^(BOOKED|ACCEPTED|DEPARTED|OFFLOADED|ARRIVED|RECEIVED|DELIVERED)$/i.test(v) ||
    /\b(BOOKED|ACCEPTED|DEPARTED|OFFLOADED|ARRIVED|RECEIVED|DELIVERED)\b/i.test(v));
  if (milestoneIndex < 0) return null;

  const milestoneCell = cells[milestoneIndex];
  const mm = milestoneCell.match(/\b(BOOKED|ACCEPTED|DEPARTED|OFFLOADED|ARRIVED|RECEIVED|DELIVERED)\b/i);
  const milestone = (mm?.[1] || milestoneCell).toUpperCase();

  const before = cells.slice(0, milestoneIndex);
  const after = cells.slice(milestoneIndex + 1);
  const station = [...before, ...cells].map(v => (v.match(/^([A-Z]{3})$/) || [])[1]).find(Boolean) || route.origin || '';

  let pieces = '';
  for (const v of after.slice(0, 4)) {
    if (/^\d{1,5}$/.test(v)) { pieces = v; break; }
    const m = v.match(/\b(\d{1,5})\s*(?:P|PCS?|PIECES?)\b/i);
    if (m) { pieces = m[1]; break; }
  }
  if (!pieces) {
    const m = milestoneCell.match(/\((\d{1,5})\)/);
    if (m) pieces = m[1];
  }

  let weight = '';
  for (const v of after) {
    weight = weightValue(v);
    if (weight) break;
  }

  let flightNo = '';
  for (const v of cells) {
    flightNo = flightValue(v);
    if (flightNo) break;
  }

  const dateCells = cells.filter(v => /\b\d{1,2}[\/-]\d{1,2}[\/-]\d{4}\b/.test(v));
  const dateTimeCells = cells.filter(v => /\b\d{1,2}[\/-]\d{1,2}[\/-]\d{4}\s+\d{1,2}:\d{2}/.test(v));
  const flightDate = parseDmyDate(dateCells.find(v => !/\d{1,2}:\d{2}/.test(v)) || dateCells[0] || '');
  const eventDateTime = parseEventDateTime(dateTimeCells.at(-1) || dateCells.at(-1) || '');

  const airportCodes = cells.map(v => (v.match(/^([A-Z]{3})$/) || [])[1]).filter(Boolean);
  const origin = airportCodes.find(v => v === route.origin) || route.origin || station || '';
  const destination = airportCodes.find(v => v === route.destination) || route.destination || '';

  return {
    milestone,
    station,
    pieces,
    weight,
    flightNo,
    flightDate,
    origin,
    destination,
    eventDate: eventDateTime.date,
    eventTime: eventDateTime.time,
    timestamp: eventDateTime.timestamp,
    raw: cells.join(' | ')
  };
}

function eventKey(event = {}) {
  return [event.flightNo || '', event.flightDate || '', event.pieces || '', event.weight || ''].join('|');
}

function samePart(a = {}, b = {}) {
  if (a.flightNo && b.flightNo && a.flightNo !== b.flightNo) return false;
  if (a.flightDate && b.flightDate && a.flightDate !== b.flightDate) return false;
  if (a.pieces && b.pieces && a.pieces !== b.pieces) return false;
  if (a.weight && b.weight && Number(a.weight) !== Number(b.weight)) return false;
  return Boolean(a.pieces || a.weight || a.flightNo || a.flightDate);
}

function buildParts(events, totalPieces, route) {
  const ordered = [...events].sort((a, b) => {
    if (a.timestamp !== null && b.timestamp !== null && a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
    return 0;
  });
  // The IndiGo result page can render the same physical DEPARTED event more
  // than once. Collapse exact movement duplicates before deciding that a MAWB is
  // a part load. Distinct quantities / weights / flight dates / flight numbers
  // still remain separate physical parts.
  const departures = [];
  const seenDepartures = new Set();
  for (const event of ordered.filter(e => e.milestone === 'DEPARTED')) {
    const key = eventKey(event) || [
      event.eventDate || '',
      event.eventTime || '',
      event.station || '',
      event.pieces || '',
      event.weight || ''
    ].join('|');
    if (seenDepartures.has(key)) continue;
    seenDepartures.add(key);
    departures.push(event);
  }

  const parts = [];

  for (const dep of departures) {
    const later = ordered.filter(e => samePart(dep, e) && (dep.timestamp === null || e.timestamp === null || e.timestamp >= dep.timestamp));
    const arrived = [...later].reverse().find(e => /ARRIVED|RECEIVED|DELIVERED/.test(e.milestone));
    const offloaded = [...later].reverse().find(e => e.milestone === 'OFFLOADED');
    const terminal = [arrived, offloaded].filter(Boolean).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))[0] || null;

    // IndiGo Status History is authoritative. If the carrier says
    // DEPARTED, that physical part has actually departed. Do not downgrade
    // the event to a generic IN TRANSIT label. A later OFFLOADED/ARRIVED
    // event may supersede DEPARTED for that same part.
    let status = 'DEPARTED';
    let arrivalDate = '';
    let arrivalTime = '';
    let arrivalIsActual = false;
    let remarks = 'Part shipment departed (actual carrier event)';

    if (terminal && /ARRIVED|RECEIVED|DELIVERED/.test(terminal.milestone)) {
      status = 'ARRIVED';
      arrivalDate = terminal.eventDate || '';
      arrivalTime = terminal.eventTime || '';
      arrivalIsActual = Boolean(arrivalDate);
      remarks = 'Part shipment arrived';
    } else if (terminal?.milestone === 'OFFLOADED') {
      status = 'OFFLOADED';
      remarks = `Part shipment offloaded at ${terminal.station || dep.station || route.origin || 'origin'}`;
    }

    const partPieces = dep.pieces || terminal?.pieces || '';
    parts.push({
      partKey: eventKey(dep) || `part-${parts.length + 1}`,
      pieces: partPieces,
      bags: totalPieces && partPieces ? `${partPieces}/${totalPieces}` : partPieces,
      totalPieces: totalPieces || '',
      weight: dep.weight || terminal?.weight || '',
      flightNo: dep.flightNo || terminal?.flightNo || '',
      flightDate: dep.flightDate || terminal?.flightDate || dep.eventDate || '',
      origin: dep.origin || route.origin || '',
      destination: dep.destination || route.destination || '',
      departureDate: dep.eventDate || dep.flightDate || '',
      departureTime: dep.eventTime || '',
      arrivalDate,
      arrivalTime,
      arrivalIsActual,
      actualArrival: arrivalIsActual && arrivalDate ? `${arrivalDate}T${arrivalTime || '00:00'}:00` : null,
      eta: null,
      status,
      remarks,
      source: 'IndiGo CarGo official status history'
    });
  }

  // Some IndiGo timelines can show OFFLOADED without a preceding machine-readable
  // DEPARTED row. Preserve that part instead of losing it.
  for (const off of ordered.filter(e => e.milestone === 'OFFLOADED')) {
    if (parts.some(p => samePart(p, off))) continue;
    const partPieces = off.pieces || '';
    parts.push({
      partKey: `offloaded|${eventKey(off)}`,
      pieces: partPieces,
      bags: totalPieces && partPieces ? `${partPieces}/${totalPieces}` : partPieces,
      totalPieces: totalPieces || '',
      weight: off.weight || '',
      flightNo: off.flightNo || '',
      flightDate: off.flightDate || off.eventDate || '',
      origin: off.origin || route.origin || '',
      destination: off.destination || route.destination || '',
      departureDate: '',
      departureTime: '',
      arrivalDate: '',
      arrivalTime: '',
      arrivalIsActual: false,
      actualArrival: null,
      eta: null,
      status: 'OFFLOADED',
      remarks: `Part shipment offloaded at ${off.station || route.origin || 'origin'}`,
      source: 'IndiGo CarGo official status history'
    });
  }

  return parts.sort((a, b) => String(a.flightDate || a.departureDate).localeCompare(String(b.flightDate || b.departureDate)));
}

function parseIndigoSnapshot(mawb, text, rows) {
  const compact = clean(text);
  if (/no (?:record|shipment|data)|not found|invalid (?:awb|air waybill)|awb does not exist/i.test(compact)) return { notFound: true };

  const summary = summaryFromText(compact, mawb);
  const events = rows.map(row => extractTableEvent(row, summary)).filter(Boolean);

  // Fallback for pages whose ASP.NET table is rendered as non-table divs.
  if (!events.length) {
    const chunks = String(text || '').split(/\n+/).map(clean).filter(Boolean);
    for (let i = 0; i < chunks.length; i++) {
      if (!/\b(Booked|Accepted|Departed|Offloaded|Arrived|Received|Delivered)\b/i.test(chunks[i])) continue;
      const pseudo = chunks.slice(Math.max(0, i - 1), Math.min(chunks.length, i + 10));
      const event = extractTableEvent(pseudo, summary);
      if (event) events.push(event);
    }
  }

  const accepted = events.find(e => e.milestone === 'ACCEPTED');
  const booked = events.find(e => e.milestone === 'BOOKED');
  const totalPieces = summary.totalPieces || accepted?.pieces || booked?.pieces || '';
  const totalWeight = summary.totalWeight || accepted?.weight || booked?.weight || '';
  const parts = buildParts(events, totalPieces, summary);

  if (!parts.length && !totalPieces && !totalWeight && !summary.origin && !summary.destination) return null;

  const latest = [...events].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))[0] || null;
  const activePart = [...parts].reverse().find(p => p.status !== 'OFFLOADED') || parts.at(-1) || null;
  const piecesSum = parts.reduce((sum, p) => sum + (Number(p.pieces) || 0), 0);
  const partialQuantity = Boolean(totalPieces) && parts.some(p => Number(p.pieces || 0) > 0 && Number(p.pieces) < Number(totalPieces));
  const distinctMovements = new Set(parts.map(p => p.partKey).filter(Boolean)).size;
  const partLoad = partialQuantity || distinctMovements > 1;

  let status = latest?.milestone || 'TRACKING';
  if (partLoad) status = 'PART LOAD';
  else if (activePart?.status) status = activePart.status;

  const bookingDate = booked?.eventDate || accepted?.eventDate || '';
  const shipment = {
    mawb,
    carrierCode: '6E',
    airlineName: 'IndiGo CarGo',
    origin: summary.origin || activePart?.origin || '',
    destination: summary.destination || activePart?.destination || '',
    bookingDate,
    bags: totalPieces || activePart?.pieces || '',
    pieces: totalPieces || activePart?.pieces || '',
    totalPieces: totalPieces || (piecesSum ? String(piecesSum) : ''),
    weight: totalWeight || activePart?.weight || '',
    totalWeight: totalWeight || '',
    flightNo: activePart?.flightNo || '',
    arrivalDate: activePart?.arrivalDate || '',
    arrivalTime: activePart?.arrivalTime || '',
    arrivalIsActual: Boolean(activePart?.arrivalIsActual),
    actualArrival: activePart?.actualArrival || null,
    eta: activePart?.eta || null,
    status,
    partLoad,
    parts,
    lastActivity: latest?.milestone || '',
    lastActivityStation: latest?.station || '',
    officialTracker: INDIGO_URL,
    source: 'IndiGo CarGo official shipment page'
  };

  return { useful: true, shipment, events };
}

async function readPage(page) {
  const textParts = [];
  const rows = [];
  for (const frame of page.frames()) {
    try {
      const snapshot = await frame.evaluate(() => {
        const visible = el => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        };
        const text = document.body?.innerText || '';
        const rows = [...document.querySelectorAll('table tr')].filter(visible).map(tr =>
          [...tr.querySelectorAll('th,td')].map(td => String(td.innerText || td.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean)
        ).filter(r => r.length);
        return { text, rows };
      });
      if (snapshot.text) textParts.push(snapshot.text);
      rows.push(...snapshot.rows);
    } catch {}
  }
  return { text: textParts.join('\n'), rows };
}

async function fillAndSubmit(page, mawb) {
  const digits = mawb.replace(/\D/g, '');
  const prefix = digits.slice(0, 3);
  const serial = digits.slice(3);

  for (const frame of page.frames()) {
    const inputs = await frame.$$('input:not([type="hidden"]),textarea');
    const candidates = [];
    for (const input of inputs) {
      try {
        const meta = await input.evaluate(el => {
          const r = el.getBoundingClientRect();
          return {
            visible: r.width > 3 && r.height > 3 && !el.disabled && !el.readOnly,
            max: Number(el.maxLength || -1),
            type: String(el.type || '').toLowerCase(),
            text: `${el.placeholder || ''} ${el.name || ''} ${el.id || ''} ${el.getAttribute('aria-label') || ''} ${el.labels?.[0]?.innerText || ''}`
          };
        });
        if (meta.visible && !/button|submit|checkbox|radio/.test(meta.type)) candidates.push({ input, meta });
      } catch {}
    }
    if (!candidates.length) continue;

    const prefixInput = candidates.find(x => x.meta.max === 3 || /prefix|airline code/i.test(x.meta.text));
    let awbInput = candidates.find(x => x !== prefixInput && (x.meta.max === 8 || /awb|air waybill|tracking|shipment/i.test(x.meta.text)));
    if (!awbInput) awbInput = candidates.find(x => [11, 12, 14].includes(x.meta.max)) || candidates[0];

    if (prefixInput && awbInput && prefixInput !== awbInput) {
      await prefixInput.input.click({ clickCount: 3 });
      await page.keyboard.press('Backspace');
      await prefixInput.input.type(prefix, { delay: 25 });
      await awbInput.input.click({ clickCount: 3 });
      await page.keyboard.press('Backspace');
      await awbInput.input.type(serial, { delay: 25 });
    } else {
      const value = awbInput.meta.max === 8 ? serial : digits;
      await awbInput.input.click({ clickCount: 3 });
      await page.keyboard.press('Backspace');
      await awbInput.input.type(value, { delay: 25 });
    }

    const controls = await frame.$$('button,input[type="submit"],input[type="button"],a[role="button"],a');
    for (const control of controls) {
      try {
        const meta = await control.evaluate(el => {
          const r = el.getBoundingClientRect();
          return {
            visible: r.width > 3 && r.height > 3 && !el.disabled,
            text: String(el.innerText || el.value || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim()
          };
        });
        if (meta.visible && /track|search|submit|go/i.test(meta.text)) {
          await control.click({ delay: 40 });
          return true;
        }
      } catch {}
    }
    await page.keyboard.press('Enter');
    return true;
  }
  return false;
}

export async function trackIndigoLive(inputMawb) {
  const mawb = normalizeMawb(inputMawb);
  const airline = airlineForMawb(mawb) || { name: 'IndiGo CarGo', iata: '6E', url: INDIGO_URL };
  if (!mawb || mawb.replace(/\D/g, '').slice(0, 3) !== '312') {
    return { ok: false, technical: false, reason: 'NOT INDIGO MAWB', airline, debug: { stage: 'INDIGO_NOT_MAPPED' } };
  }

  let browser;
  const debug = { stage: 'INDIGO_OPEN', officialUrl: INDIGO_URL };
  try {
    const mod = await import('puppeteer-core');
    const puppeteer = mod.default || mod;
    const launch = await browserConfig();
    browser = await puppeteer.launch({ ...launch, headless: true, defaultViewport: { width: 1440, height: 1050 } });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36');
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });

    await page.goto(INDIGO_URL, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await sleep(1200);

    const initial = await readPage(page);
    let parsed = parseIndigoSnapshot(mawb, initial.text, initial.rows);
    if (parsed?.notFound) return { ok: false, notFound: true, technical: false, reason: 'IndiGo returned no shipment record.', airline, debug: { ...debug, stage: 'INDIGO_NO_RECORD_INITIAL' } };
    if (parsed?.useful && initial.text.includes(mawb.replace(/-/g, ''))) {
      return { ok: true, airline, shipment: parsed.shipment, debug: { ...debug, stage: 'INDIGO_SUCCESS_INITIAL', eventCount: parsed.events.length } };
    }

    const submitted = await fillAndSubmit(page, mawb);
    debug.submitted = submitted;
    if (!submitted) return { ok: false, technical: true, reason: 'IndiGo tracking form was not accessible.', airline, debug: { ...debug, stage: 'INDIGO_FORM_NOT_FOUND' } };

    for (let attempt = 0; attempt < 16; attempt += 1) {
      await sleep(attempt === 0 ? 1800 : 700);
      const snap = await readPage(page);
      const block = clean(snap.text);
      if (/captcha|verify you are human|access denied|forbidden|request blocked/i.test(block)) {
        return { ok: false, technical: true, reason: 'IndiGo official tracker blocked automated access.', airline, debug: { ...debug, stage: 'INDIGO_TECHNICAL_BLOCK' } };
      }
      parsed = parseIndigoSnapshot(mawb, snap.text, snap.rows);
      if (parsed?.notFound) return { ok: false, notFound: true, technical: false, reason: 'IndiGo returned no shipment record.', airline, debug: { ...debug, stage: 'INDIGO_NO_RECORD' } };
      if (parsed?.useful) {
        return {
          ok: true,
          airline,
          shipment: parsed.shipment,
          debug: {
            ...debug,
            stage: 'INDIGO_SUCCESS',
            eventCount: parsed.events.length,
            partCount: parsed.shipment.parts?.length || 0,
            partLoad: Boolean(parsed.shipment.partLoad),
            lastActivity: parsed.shipment.lastActivity
          }
        };
      }
    }

    const finalSnap = await readPage(page);
    return {
      ok: false,
      technical: true,
      reason: 'IndiGo accepted the MAWB but its shipment result was not machine-readable.',
      airline,
      debug: { ...debug, stage: 'INDIGO_RESULT_UNREADABLE', preview: clean(finalSnap.text).slice(0, 700), tableRows: finalSnap.rows.length }
    };
  } catch (error) {
    return { ok: false, technical: true, reason: error?.message || 'IndiGo official tracker failed.', airline, debug: { ...debug, stage: 'INDIGO_BROWSER_ERROR' } };
  } finally {
    if (browser) try { await browser.close(); } catch {}
  }
}
