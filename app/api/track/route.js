export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const TRACKJET_URL = 'https://trackjet.world/';
const MONTHS = {jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clean = s => String(s || '').replace(/\s+/g, ' ').trim();

function normalizeMawb(v = '') {
  const d = String(v).replace(/\D/g, '');
  return d.length === 11 ? `${d.slice(0, 3)}-${d.slice(3)}` : '';
}
function esc(s = '') { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function isTrackJetUrl(value = '') {
  try {
    const h = new URL(value).hostname.toLowerCase();
    return h === 'trackjet.world' || h.endsWith('.trackjet.world');
  } catch { return false; }
}
function isExternalHttp(value = '') {
  return /^https?:\/\//i.test(value) && !isTrackJetUrl(value);
}
function localDate(m) {
  if (!m) return {date:'', time:''};
  let y = String(m[3]);
  if (y.length === 2) y = `20${y}`;
  return {
    date: `${y}-${MONTHS[String(m[2]).toLowerCase()] || '01'}-${String(m[1]).padStart(2,'0')}`,
    time: `${String(m[4]).padStart(2,'0')}:${m[5]}`
  };
}
function statusFromText(t = '') {
  if (/notified consignee/i.test(t)) return 'NOTIFIED CONSIGNEE';
  if (/received at destination/i.test(t)) return 'RECEIVED AT DESTINATION';
  if (/\bdelivered\b|\bdlv\b/i.test(t)) return 'DELIVERED';
  if (/\barrived\b|\brcf\b/i.test(t)) return 'ARRIVED';
  if (/\bdelay(?:ed)?\b|\blate\b/i.test(t)) return 'DELAYED';
  if (/\bdeparted\b|\bdep\b|\bin transit\b/i.test(t)) return 'IN_TRANSIT';
  if (/\breceived\b|\brcs\b|\bbooked\b/i.test(t)) return 'RECEIVED';
  return 'TRACKING';
}
function parseCarrierText(raw, mawb, iata = '') {
  const t = clean(raw);
  const compact = mawb.replace(/\D/g, '');
  const serial = compact.slice(3);
  const route =
    t.match(new RegExp(`${esc(mawb)}\\s*\\(\\s*([A-Z]{3})\\s*[-–—>→]+\\s*([A-Z]{3})\\s*\\)`, 'i')) ||
    t.match(/\b([A-Z]{3})\s*(?:-|–|—|→|>)\s*([A-Z]{3})\b/);

  const pcs =
    t.match(/(\d{1,6})\s*(?:Piece\(s\)|Pieces?|Pcs)\b/i) ||
    t.match(/(?:Piece\(s\)|Pieces?|Pcs)\s*[:#-]?\s*(\d{1,6})\b/i);
  const wt =
    t.match(/([\d,.]+)\s*(?:kg|kgs|kilograms?)\b/i) ||
    t.match(/(?:weight|gross weight)\s*[:#-]?\s*([\d,.]+)/i);

  const code = String(iata || '').toUpperCase();
  const flightRe = code
    ? new RegExp(`\\b(${esc(code)})[-\\s]?(\\d{2,4})\\b`, 'gi')
    : /\b([A-Z0-9]{2})[-\s]?(\d{2,4})\b/g;
  const flights = [...t.matchAll(flightRe)].map(m => `${m[1].toUpperCase()}${m[2]}`);
  const flightNo = flights.at(-1) || '';

  const arrived = t.match(/Arrived\s*\(\s*([A-Z]{3})\s*\)\s*(\d{1,2})-([A-Za-z]{3})-(\d{2,4})\s+(\d{1,2}):(\d{2})/i);
  let arrivalDate = '', arrivalTime = '', arrivalActual = false;
  if (arrived) {
    const p = localDate([arrived[0], arrived[2], arrived[3], arrived[4], arrived[5], arrived[6]]);
    arrivalDate = p.date; arrivalTime = p.time; arrivalActual = true;
  }

  if (!arrivalDate) {
    const finalArrival = [...t.matchAll(/(?:arriv(?:al|ed)|eta|estimated arrival)[^0-9]{0,60}(\d{1,2})-([A-Za-z]{3})-(\d{2,4})\s+(\d{1,2}):(\d{2})/gi)].at(-1);
    if (finalArrival) {
      const p = localDate(finalArrival);
      arrivalDate = p.date; arrivalTime = p.time;
      arrivalActual = /arrived/i.test(finalArrival[0]);
    }
  }

  if (!arrivalDate && flightNo) {
    const dashed = flightNo.replace(/([A-Z]+)(\d+)/, '$1-$2');
    const idx = Math.max(t.lastIndexOf(dashed), t.lastIndexOf(flightNo));
    const tail = idx >= 0 ? t.slice(idx, idx + 650) : t;
    const dates = [...tail.matchAll(/(\d{1,2})-([A-Za-z]{3})-(\d{2,4})\s+(\d{1,2}):(\d{2})/g)];
    if (dates.length) {
      const p = localDate(dates.at(-1));
      arrivalDate = p.date; arrivalTime = p.time;
    }
  }

  const status = statusFromText(t);
  const origin = route?.[1]?.toUpperCase() || '';
  const destination = (arrived?.[1] || route?.[2] || '').toUpperCase();
  const mawbSeen = t.includes(mawb) || t.includes(compact) || t.includes(serial);
  const useful = Boolean(
    mawbSeen && (origin || destination || pcs || wt || flightNo || arrivalDate || /notified consignee|received at destination|arrived|delivered|departed|tracking details/i.test(t))
  );

  return {
    useful,
    shipment: {
      mawb,
      carrierCode: code,
      origin,
      destination,
      bags: pcs?.[1] || '',
      pieces: pcs?.[1] || '',
      weight: (wt?.[1] || '').replace(/,/g, ''),
      flightNo,
      arrivalDate,
      arrivalTime,
      eta: null,
      actualArrival: null,
      arrivalIsActual: arrivalActual,
      status,
      source: 'TrackJet → official carrier result'
    }
  };
}

async function setInput(page, handle, value) {
  await page.evaluate((el, val) => {
    const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, val); else el.value = val;
    el.focus();
    ['input','change','blur'].forEach(name => el.dispatchEvent(new Event(name, {bubbles:true})));
  }, handle, value);
}

async function visibleInputs(page) {
  const all = await page.$$('input,textarea');
  const out = [];
  for (const h of all) {
    try {
      const m = await h.evaluate(el => {
        const r = el.getBoundingClientRect();
        return {
          visible: r.width > 5 && r.height > 5 && !el.disabled,
          type: (el.type || 'text').toLowerCase(),
          label: `${el.placeholder || ''} ${el.name || ''} ${el.id || ''} ${el.getAttribute('aria-label') || ''}`,
          max: el.maxLength || 0,
          value: el.value || ''
        };
      });
      if (m.visible && !['hidden','checkbox','radio','file','password'].includes(m.type)) out.push({h,m});
    } catch {}
  }
  return out;
}

async function findTrackingInput(page, purpose = 'trackjet') {
  const inputs = await visibleInputs(page);
  const good = inputs.find(x => /mawb|awb|waybill|tracking|track|shipment|number|paste/i.test(x.m.label));
  if (good) return good;
  if (purpose === 'trackjet') return inputs.find(x => x.m.max === 11 || x.m.max === 12 || x.m.max === 0) || null;
  return null;
}

async function getClickCandidates(page) {
  return page.evaluate(() => {
    const els = [...document.querySelectorAll('a,button,[role="button"],input[type="submit"],input[type="button"]')];
    let n = 0;
    return els.map(el => {
      const r = el.getBoundingClientRect();
      const visible = r.width > 4 && r.height > 4 && !el.disabled;
      const text = (el.innerText || el.value || el.getAttribute('aria-label') || el.title || '').trim();
      const href = el.href || el.getAttribute('href') || '';
      const dataUrl = el.getAttribute('data-href') || el.getAttribute('data-url') || el.getAttribute('data-target-url') || el.getAttribute('formaction') || '';
      const onclick = el.getAttribute('onclick') || '';
      if (!visible) return null;
      const id = `mayavi-${n++}`;
      el.setAttribute('data-mayavi-click-id', id);
      return {id,text,href,dataUrl,onclick,tag:el.tagName || ''};
    }).filter(Boolean);
  });
}

function embeddedExternalUrl(candidate = {}) {
  for (const value of [candidate.href, candidate.dataUrl]) {
    if (isExternalHttp(value)) return value;
  }
  const joined = `${candidate.onclick || ''} ${candidate.href || ''} ${candidate.dataUrl || ''}`;
  const urls = joined.match(/https?:\/\/[^'"\s)]+/gi) || [];
  return urls.find(isExternalHttp) || '';
}

function handoffScore(c = {}) {
  const s = `${c.text || ''} ${c.href || ''} ${c.dataUrl || ''}`.toLowerCase();
  let score = 0;
  if (embeddedExternalUrl(c)) score += 120;
  if (/open\s+tracking/.test(s)) score += 100;
  if (/official/.test(s)) score += 80;
  if (/track(?:ing)?\s+(?:on|with|at)/.test(s)) score += 75;
  if (/visit/.test(s)) score += 55;
  if (/track|tracking|shipment/.test(s)) score += 45;
  if (/cargo|airline|carrier/.test(s)) score += 30;
  if (/\/airline\//.test(s)) score += 35;
  if (/privacy|terms|cookie|about|contact|login|sign in|facebook|instagram|linkedin|youtube/.test(s)) score -= 150;
  return score;
}

async function waitForExternalPage(browser, trackJetPage, ms = 14000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    for (const p of await browser.pages()) {
      let u = '';
      try { u = p.url(); } catch {}
      if (isExternalHttp(u)) return p;
    }
    try {
      if (isExternalHttp(trackJetPage.url())) return trackJetPage;
    } catch {}
    await sleep(400);
  }
  return null;
}

async function clickCandidate(page, candidate) {
  const h = await page.$(`[data-mayavi-click-id="${candidate.id}"]`);
  if (!h) return false;
  try { await h.click({delay:90}); return true; } catch { return false; }
}

// Generic TrackJet router: do not hard-code Qatar, Saudia, Emirates, etc.
// It follows whatever official/track/visit button or external carrier link TrackJet exposes.
async function genericTrackJetHandoff(page, browser, mawb, debug) {
  for (let hop = 0; hop < 4; hop++) {
    debug.stage = `TRACKJET_HANDOFF_${hop + 1}`;
    await sleep(700);

    if (isExternalHttp(page.url())) return page;

    const candidates = (await getClickCandidates(page))
      .map(c => ({...c, score: handoffScore(c)}))
      .filter(c => c.score > 0)
      .sort((a,b) => b.score - a.score);

    debug[`handoffCandidates${hop + 1}`] = candidates.slice(0,6).map(c => ({text:c.text, href:c.href, dataUrl:c.dataUrl, score:c.score}));

    // Best case: TrackJet exposes the official carrier URL directly.
    const direct = candidates.map(embeddedExternalUrl).find(Boolean);
    if (direct) {
      debug.handoffMethod = 'DIRECT_EXTERNAL_LINK';
      debug.handoffUrl = direct;
      try {
        await page.goto(direct, {waitUntil:'domcontentloaded', timeout:25000});
        return page;
      } catch (e) {
        debug.directNavigationError = e?.message || String(e);
      }
    }

    // Otherwise use a real browser click on the best TrackJet button/link.
    let advancedInsideTrackJet = false;
    for (const candidate of candidates.slice(0,6)) {
      const beforeUrl = page.url();
      const beforePages = (await browser.pages()).length;
      const clicked = await clickCandidate(page, candidate);
      if (!clicked) continue;
      debug.handoffMethod = 'REAL_BROWSER_CLICK';
      debug.handoff = {text:candidate.text, href:candidate.href, dataUrl:candidate.dataUrl};

      const external = await waitForExternalPage(browser, page, 6500);
      if (external) return external;

      const pages = await browser.pages();
      debug.pageUrls = pages.map(p => { try { return p.url(); } catch { return ''; } }).slice(-8);

      const afterUrl = page.url();
      if (afterUrl !== beforeUrl && isTrackJetUrl(afterUrl)) {
        advancedInsideTrackJet = true;
        break;
      }

      // A blank popup may later be populated by TrackJet JS. Give it one more chance.
      if (pages.length > beforePages && pages.some(p => p.url() === 'about:blank')) {
        const ext2 = await waitForExternalPage(browser, page, 5000);
        if (ext2) return ext2;
      }
    }

    if (advancedInsideTrackJet) continue;

    // If the current page has an airline-directory link, use it as another generic TrackJet hop.
    const airlineDir = candidates.find(c => /\/airline\//i.test(c.href || c.dataUrl || ''));
    if (airlineDir) {
      const url = airlineDir.href || airlineDir.dataUrl;
      debug.handoffMethod = 'TRACKJET_AIRLINE_DIRECTORY';
      try {
        await page.goto(url, {waitUntil:'domcontentloaded', timeout:25000});
        continue;
      } catch {}
    }

    return null;
  }
  return null;
}

async function maybeSubmitCarrier(page, mawb) {
  const compact = mawb.replace(/\D/g, '');
  const prefix = compact.slice(0,3);
  const serial = compact.slice(3);
  let text = clean(await page.evaluate(() => document.body?.innerText || ''));
  if ((text.includes(mawb) || text.includes(compact) || text.includes(serial)) && /Piece\(s\)|Pieces?|Pcs|Arrived|Received|Notified consignee|Tracking Details|flight/i.test(text)) {
    return {attempted:false, reason:'result already visible'};
  }

  const inputs = await visibleInputs(page);
  let pre = inputs.find(x => x.m.max === 3 || /prefix/i.test(x.m.label));
  let num = inputs.find(x => x.m.max === 8 || /awb|mawb|waybill|shipment|tracking number/i.test(x.m.label));
  let one = inputs.find(x => /awb|mawb|waybill|shipment|tracking|track/i.test(x.m.label));

  try {
    if (pre && num && pre.h !== num.h) {
      await setInput(page, pre.h, prefix);
      await setInput(page, num.h, serial);
    } else if (one) {
      const value = one.m.max === 8 ? serial : compact;
      await setInput(page, one.h, value);
    } else {
      return {attempted:false, reason:'no carrier tracking input found'};
    }

    const candidates = (await getClickCandidates(page))
      .map(c => ({...c, score:/track shipment|^track$|search|submit|find shipment|track cargo/i.test(c.text || '') ? 100 : 0}))
      .filter(c => c.score > 0);
    if (candidates.length) {
      await clickCandidate(page, candidates[0]);
      await sleep(5500);
      try { await page.waitForNetworkIdle({idleTime:700, timeout:8000}); } catch {}
      return {attempted:true, clicked:candidates[0].text};
    }

    const target = num?.h || one?.h;
    if (target) {
      try { await page.evaluate(el => el.form?.requestSubmit?.(), target); } catch {}
      await sleep(5000);
      return {attempted:true, clicked:'form submit'};
    }
  } catch (e) {
    return {attempted:true, error:e?.message || String(e)};
  }
  return {attempted:true, clicked:''};
}

async function runTrackJet(mawb) {
  let browser;
  const debug = {stage:'START', mawb};
  try {
    const chromiumMod = await import('@sparticuz/chromium');
    const puppeteerMod = await import('puppeteer-core');
    const chromium = chromiumMod.default || chromiumMod;
    const puppeteer = puppeteerMod.default || puppeteerMod;

    browser = await puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
      defaultViewport: {width:1440, height:1000}
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({'Accept-Language':'en-US,en;q=0.9'});

    debug.stage = 'TRACKJET_OPEN';
    await page.goto(TRACKJET_URL, {waitUntil:'domcontentloaded', timeout:25000});
    await sleep(900);

    const input = await findTrackingInput(page, 'trackjet');
    if (!input) return {ok:false, error:'TrackJet tracking input was not found.', debug:{...debug, stage:'TRACKJET_INPUT'}};
    await setInput(page, input.h, mawb);

    const buttons = (await getClickCandidates(page))
      .filter(c => /^track$/i.test(c.text || '') || /track shipment|track cargo/i.test(c.text || ''));
    if (buttons.length) await clickCandidate(page, buttons[0]);
    else {
      try { await page.evaluate(el => el.form?.requestSubmit?.(), input.h); } catch {}
    }

    debug.stage = 'TRACKJET_RESULT';
    for (let i = 0; i < 20; i++) {
      await sleep(400);
      if (!isTrackJetUrl(page.url())) break;
      const text = clean(await page.evaluate(() => document.body?.innerText || ''));
      if (/We found your carrier|Open tracking on|IATA\s+[A-Z0-9]{2}|official|carrier|airline/i.test(text) || /\/track\//i.test(page.url())) break;
    }

    const trackJetText = clean(await page.evaluate(() => document.body?.innerText || ''));
    debug.trackjetUrl = page.url();
    debug.trackjetHint = trackJetText.slice(0,900);
    const iata = (trackJetText.match(/\bIATA\s+([A-Z0-9]{2})\b/i) || [])[1] || '';
    debug.iata = iata;

    debug.stage = 'TRACKJET_HANDOFF';
    const carrierPage = await genericTrackJetHandoff(page, browser, mawb, debug);
    if (!carrierPage) {
      return {
        ok:false,
        error:'TrackJet identified the carrier, but no official-carrier button/link produced a usable handoff.',
        debug:{...debug, stage:'TRACKJET_HANDOFF_UNAVAILABLE'}
      };
    }

    debug.stage = 'CARRIER_OPEN';
    await sleep(1800);
    try { await carrierPage.waitForNetworkIdle({idleTime:800, timeout:9000}); } catch {}
    debug.carrierUrl = carrierPage.url();

    if (!isExternalHttp(debug.carrierUrl)) {
      return {
        ok:false,
        error:`TrackJet click did not reach an official external carrier page (${debug.carrierUrl || 'blank'}).`,
        debug:{...debug, stage:'TRACKJET_HANDOFF_NOT_EXTERNAL'}
      };
    }

    let carrierText = clean(await carrierPage.evaluate(() => document.body?.innerText || ''));
    if (/captcha|verify you are human|access denied|forbidden|robot check|one moment please|unusual traffic/i.test(carrierText)) {
      return {
        ok:false,
        error:'Official carrier page presented an access/CAPTCHA challenge. Mayavi will not bypass it.',
        debug:{...debug, stage:'CARRIER_CHALLENGE', carrierHint:carrierText.slice(0,700)}
      };
    }

    debug.stage = 'CARRIER_SUBMIT';
    debug.carrierSubmit = await maybeSubmitCarrier(carrierPage, mawb);
    await sleep(900);
    carrierText = clean(await carrierPage.evaluate(() => document.body?.innerText || ''));
    debug.carrierHint = carrierText.slice(0,1200);

    const parsed = parseCarrierText(carrierText, mawb, iata);
    if (!parsed.useful) {
      return {
        ok:false,
        error:'Official carrier page opened, but readable shipment details were not found yet.',
        debug:{...debug, stage:'PARSE_CARRIER'}
      };
    }

    return {ok:true, shipment:parsed.shipment, debug:{...debug, stage:'SUCCESS'}};
  } catch (e) {
    return {ok:false, error:e?.message || String(e), debug:{...debug, stage:'BROWSER_ERROR', message:e?.message || String(e)}};
  } finally {
    if (browser) try { await browser.close(); } catch {}
  }
}

function waiting(mawb, stage = '') {
  return {
    mawb,
    carrierCode:'', origin:'', destination:'', bags:'', weight:'', flightNo:'',
    arrivalDate:'', arrivalTime:'', eta:null, actualArrival:null,
    status:'WAITING FOR LIVE DATA',
    source:`TrackJet → official carrier${stage ? ` · ${stage}` : ''}`
  };
}

async function handleMawb(mawb) {
  const r = await runTrackJet(mawb);
  if (r.ok) {
    return Response.json({
      ok:true,
      configured:true,
      provider:'TrackJet → official carrier',
      source:'TrackJet → official carrier result',
      airlinePrimary:true,
      shipment:r.shipment,
      trackingDebug:r.debug
    });
  }
  return Response.json({
    ok:true,
    configured:true,
    provider:'TrackJet → official carrier',
    source:'TrackJet generic handoff diagnostic',
    airlinePrimary:true,
    trackingError:r.error,
    trackingDebug:r.debug,
    shipment:waiting(mawb, r.debug?.stage || '')
  });
}

export async function GET(request) {
  const u = new URL(request.url);
  const q = u.searchParams.get('mawb');
  if (!q) return Response.json({configured:true, provider:'TrackJet → official carrier', apiKeyRequired:false, mode:'generic TrackJet official-button handoff'});
  const m = normalizeMawb(q);
  if (!m) return Response.json({ok:false, error:'Enter a valid 11-digit MAWB.'}, {status:400});
  return handleMawb(m);
}

export async function POST(request) {
  let b = {};
  try { b = await request.json(); } catch { return Response.json({ok:false, error:'Invalid request body.'}, {status:400}); }
  const m = normalizeMawb(b?.mawb);
  if (!m) return Response.json({ok:false, error:'Enter a valid 11-digit MAWB.'}, {status:400});
  return handleMawb(m);
}
