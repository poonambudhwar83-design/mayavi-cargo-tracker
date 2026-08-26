import fs from 'node:fs';
import { airlineForMawb, normalizeMawb } from '../airlines.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const clean = value => String(value || '').replace(/\s+/g, ' ').trim();

const EXACT = {
  '065': {
    name: 'Saudia Cargo', iata: 'SV',
    url: 'https://saudiacargo.com/e-services/track-shipment', queryParam: 'awbNumber', settleMs: 2500,
    inputHints: /awb|air waybill|shipment|tracking/i, buttonHints: /track shipment|track|search/i,
    networkHints: /track|shipment|cargo|awb|status|api/i
  },
  '176': {
    name: 'Emirates SkyCargo', iata: 'EK',
    url: 'https://scekprd.emirates.com/skychain/app?initial=y&service=page%2Fnwp%3ATrackshipmt', settleMs: 6000,
    inputHints: /document no|document number|awb|air waybill|shipment/i, buttonHints: /track shipment|track|submit|search/i,
    networkHints: /track|shipment|skychain|awb|status|api/i
  },
  '098': {
    name: 'Air India Cargo', iata: 'AI',
    url: 'https://cargo.airindia.com/in/en/track-shipment.html', settleMs: 6000,
    inputHints: /awb|airline code|air waybill|shipment|track/i, buttonHints: /track shipment|track|submit|search/i,
    networkHints: /track|shipment|cargo|awb|status|api|icargo/i
  }
};

async function browserConfig() {
  for (const executablePath of [process.env.CHROME_EXECUTABLE_PATH, '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'].filter(Boolean)) {
    if (fs.existsSync(executablePath)) return { executablePath, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-zygote'] };
  }
  const mod = await import('@sparticuz/chromium'); const chromium = mod.default || mod;
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
  const month = months[m[2].slice(0,3).toLowerCase()]; if (!month) return { date:'', time:'' };
  let year = String(m[3]); if (year.length === 2) year = `20${year}`;
  let hour = Number(m[4]); const ap = String(m[6] || '').toUpperCase();
  if (ap === 'PM' && hour < 12) hour += 12; if (ap === 'AM' && hour === 12) hour = 0;
  return { date: `${year}-${month}-${String(m[1]).padStart(2,'0')}`, time: `${String(hour).padStart(2,'0')}:${m[5]}` };
}

function safeJson(raw='') {
  let text=String(raw||'').trim().replace(/^while\s*\(\s*1\s*\)\s*;?\s*/i,'').replace(/^for\s*\(\s*;;\s*\)\s*;?\s*/i,'');
  try { return JSON.parse(text); } catch { return null; }
}
function flatten(value,path='$',out=[],depth=0) {
  if (depth>14 || value===undefined || value===null) return out;
  if (typeof value==='string') {
    out.push({path,value}); const s=value.trim();
    if ((s.startsWith('{')&&s.endsWith('}'))||(s.startsWith('[')&&s.endsWith(']'))) { const nested=safeJson(s); if(nested) flatten(nested,`${path}.json`,out,depth+1); }
    return out;
  }
  if (typeof value==='number'||typeof value==='boolean') { out.push({path,value:String(value)}); return out; }
  if (Array.isArray(value)) { value.forEach((v,i)=>flatten(v,`${path}[${i}]`,out,depth+1)); return out; }
  if (typeof value==='object') Object.entries(value).forEach(([k,v])=>flatten(v,`${path}.${k}`,out,depth+1));
  return out;
}
function entryValue(entries,pathRx,valueRx=null) {
  for (const e of entries) if (pathRx.test(e.path) && (!valueRx || valueRx.test(String(e.value)))) return String(e.value);
  return '';
}
function airportCode(v='') { const m=String(v).toUpperCase().match(/\b([A-Z]{3})\b/); return m?m[1]:''; }
function numeric(v='') { const m=String(v).match(/[\d,.]+/); return m?m[0].replace(/,/g,''):''; }
function carrierFlight(v='',iata='') {
  const s=clean(v).toUpperCase(); const rx=iata?new RegExp(`\\b${iata}[-\\s]?(\\d{2,4})\\b`):null;
  const m=(rx&&s.match(rx))||s.match(/\b([A-Z0-9]{2})[-\s]?(\d{2,4})\b/);
  if (!m) return ''; return rx ? `${iata}${m[1]}` : `${m[1]}${m[2]}`;
}

function shipmentObject(mawb,config,{origin='',destination='',pieces='',weight='',flightNo='',arrival={date:'',time:''},actual=false,status='TRACKING',source='official website'}={}) {
  return { mawb, carrierCode:config.iata, airlineName:config.name, origin, destination, bags:pieces, pieces, weight, flightNo,
    arrivalDate:arrival.date, arrivalTime:arrival.time, arrivalIsActual:actual, status, officialTracker:config.url, source:`${config.name} ${source}` };
}

function parseStructured(raw,mawb,config) {
  const json=safeJson(raw); if(!json) return null;
  const entries=flatten(json); if(!entries.length) return null;
  const joined=clean(entries.map(e=>`${e.path} ${e.value}`).join(' '));
  if (/no (?:shipment|record|result)|not found|invalid (?:awb|air waybill)|unable to find|no data/i.test(joined)) return {notFound:true};
  const origin=airportCode(entryValue(entries,/(?:origin|fromStation|fromAirport|departure.*(?:station|airport|code))/i,/\b[A-Z]{3}\b/i));
  const destination=airportCode(entryValue(entries,/(?:destination|toStation|toAirport|arrival.*(?:station|airport|code))/i,/\b[A-Z]{3}\b/i));
  const pieces=numeric(entryValue(entries,/(?:piece|pieces|pieceCount|totalPieces|pcs|bag)/i,/\d/));
  const weight=numeric(entryValue(entries,/(?:grossWeight|chargeableWeight|weight)/i,/\d/));
  const flightNo=carrierFlight(entryValue(entries,/(?:flightNo|flightNumber|flight)/i,/\d/),config.iata)||carrierFlight(joined,config.iata);
  const actualRaw=entryValue(entries,/(?:actual.*arriv|arriv.*actual|actualArrivalDateTime|\bata\b)/i,/\d/);
  const estimatedRaw=entryValue(entries,/(?:estimated.*arriv|expected.*arriv|scheduled.*arriv|estimatedArrivalDateTime|\beta\b)/i,/\d/);
  let arrival=parseDateTime(actualRaw); const actual=Boolean(arrival.date); if(!arrival.date) arrival=parseDateTime(estimatedRaw);
  const st=statusFromText(joined); const useful=Boolean(origin||destination||pieces||weight||flightNo||arrival.date||st!=='TRACKING');
  if(!useful) return null;
  return { useful:true, shipment:shipmentObject(mawb,config,{origin,destination,pieces,weight,flightNo,arrival,actual,status:st,source:'official network response'}) };
}

function parseShipment(raw, mawb, config, trusted=false) {
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
  const actual = Boolean(arrival.date); if (!arrival.date) arrival = parseDateTime((text.match(/(?:estimatedArrival|expectedArrival|estimated arrival|expected arrival|\bETA\b|scheduled arrival)[\s\S]{0,240}/i) || [])[0] || '');
  const st = statusFromText(text); const details=Boolean(origin||destination||pieces||weight||flightNo||arrival.date||st!=='TRACKING');
  const useful = Boolean(details && (trusted || seen));
  return { useful, shipment:shipmentObject(mawb,config,{origin,destination,pieces,weight,flightNo,arrival,actual,status:st}) };
}

function parseNetwork(network,mawb,config) {
  for(let i=network.length-1;i>=0;i-=1) {
    const structured=parseStructured(network[i].body,mawb,config); if(structured?.notFound||structured?.useful) return structured;
    const text=parseShipment(network[i].body,mawb,config,true); if(text.notFound||text.useful) return text;
  }
  return null;
}

async function deepText(page) {
  const chunks = [];
  for (const frame of page.frames()) {
    try {
      const t = await frame.evaluate(() => {
        const out=[]; const walk=root=>{if(!root?.querySelectorAll)return;if(root instanceof ShadowRoot&&root.textContent?.trim())out.push(root.textContent);for(const el of root.querySelectorAll('*'))if(el.shadowRoot)walk(el.shadowRoot)};
        if(document.body?.innerText)out.push(document.body.innerText); walk(document); return out.join('\n');
      });
      if (t) chunks.push(t);
    } catch {}
  }
  return chunks.join('\n');
}

async function deepHandles(frame, selector) {
  const arrayHandle = await frame.evaluateHandle(sel => {
    const out = [], seen = new Set();
    const walk = root => {
      if (!root?.querySelectorAll) return;
      for (const element of root.querySelectorAll(sel)) {
        if (!seen.has(element)) { seen.add(element); out.push(element); }
      }
      for (const element of root.querySelectorAll('*')) if (element.shadowRoot) walk(element.shadowRoot);
    };
    walk(document);
    return out;
  }, selector);
  const props = await arrayHandle.getProperties();
  const elements = [];
  for (const prop of props.values()) {
    const element = prop.asElement();
    if (element) elements.push(element);
  }
  await arrayHandle.dispose();
  return elements;
}

async function visibleInputCandidates(page) {
  const candidates = [];
  for (const frame of page.frames()) {
    let inputs = [];
    try { inputs = await deepHandles(frame, 'input:not([type="hidden"]),textarea'); } catch { continue; }
    for (const input of inputs) {
      try {
        const meta = await frame.evaluate(el => {
          const r = el.getBoundingClientRect();
          const parent = el.parentElement?.innerText || '';
          const label = el.labels?.[0]?.innerText || el.closest('label')?.innerText || '';
          return {
            visible: r.width > 3 && r.height > 3 && !el.disabled && !el.readOnly,
            max: Number(el.maxLength || -1),
            type: String(el.type || 'text').toLowerCase(),
            value: String(el.value || ''),
            text: `${el.placeholder || ''} ${el.name || ''} ${el.id || ''} ${el.getAttribute('aria-label') || ''} ${el.title || ''} ${label} ${parent.slice(0,160)}`.replace(/\s+/g, ' ').trim()
          };
        }, input);
        if (meta.visible && !['checkbox','radio','file','password','email'].includes(meta.type)) candidates.push({ frame, input, meta });
      } catch {}
    }
  }
  return candidates;
}

async function clickTrackButton(page, config) {
  for (const frame of page.frames()) {
    let buttons = [];
    try { buttons = await deepHandles(frame, 'button,input[type="submit"],input[type="button"],[role="button"],a[role="button"],a.button'); } catch { continue; }
    for (const button of buttons) {
      try {
        const meta = await frame.evaluate(el => {
          const r = el.getBoundingClientRect();
          return { visible:r.width>3&&r.height>3&&!el.disabled, text:String(el.innerText||el.value||el.getAttribute('aria-label')||el.title||'').replace(/\s+/g,' ').trim() };
        }, button);
        if (meta.visible && config.buttonHints.test(meta.text)) {
          await button.click({ delay:50 });
          return meta.text || 'button';
        }
      } catch {}
    }
  }
  return '';
}

async function setInputValue(page, item, value) {
  await item.input.click({ clickCount:3 });
  await page.keyboard.press('Backspace');
  await item.input.type(value, { delay:35 });
  return item.input.evaluate(el => String(el.value || ''));
}

async function fillOfficialForm(page, mawb, config) {
  const digits = mawb.replace(/\D/g,''), prefix = digits.slice(0,3), serial = digits.slice(3);
  let lastCandidates = [];
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const candidates = await visibleInputCandidates(page);
    lastCandidates = candidates;
    if (candidates.length) {
      const prefixInput = candidates.find(x => x.meta.max === 3 || /airline code|prefix|carrier code/i.test(x.meta.text));
      let numberInput = candidates.find(x => x !== prefixInput && (x.meta.max === 8 || config.inputHints.test(x.meta.text)));
      if (!numberInput) numberInput = candidates.find(x => x !== prefixInput && [11,12,13,14].includes(x.meta.max));
      if (!numberInput) numberInput = candidates.find(x => x !== prefixInput && /document|waybill|shipment|tracking|awb/i.test(x.meta.text));

      if (prefixInput && numberInput) {
        await setInputValue(page, prefixInput, prefix);
        await setInputValue(page, numberInput, serial);
      } else if (numberInput) {
        const wantsHyphen = /document no|document number/i.test(numberInput.meta.text) && numberInput.meta.max !== 11;
        const value = numberInput.meta.max === 8 ? serial : wantsHyphen ? mawb : digits;
        await setInputValue(page, numberInput, value);
      } else {
        await sleep(1000);
        continue;
      }

      const clicked = await clickTrackButton(page, config);
      if (clicked) return { ok:true, button:clicked, inputCount:candidates.length };
      await page.keyboard.press('Enter');
      return { ok:true, button:'ENTER', inputCount:candidates.length };
    }
    await sleep(1000);
  }
  return { ok:false, inputCount:lastCandidates.length, inputs:lastCandidates.slice(0,8).map(x => ({ max:x.meta.max, type:x.meta.type, text:x.meta.text.slice(0,180) })) };
}

export function hasExactOfficialAdapter(prefix = '') { return Boolean(EXACT[prefix]); }

export async function trackExactOfficial(inputMawb) {
  const mawb = normalizeMawb(inputMawb); const prefix = mawb.replace(/\D/g,'').slice(0,3); const config = EXACT[prefix]; const airline = airlineForMawb(mawb) || config;
  if (!mawb || !config) return { ok:false, technical:false, reason:'NO EXACT OFFICIAL ADAPTER', airline, debug:{ stage:'EXACT_NOT_MAPPED' } };
  let browser; const debug = { stage:'EXACT_OPEN', prefix, officialUrl:config.url };
  try {
    const mod = await import('puppeteer-core'); const puppeteer = mod.default || mod; const launch = await browserConfig();
    browser = await puppeteer.launch({ ...launch, headless:true, defaultViewport:{ width:1440, height:1050 } }); const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36'); await page.setExtraHTTPHeaders({ 'Accept-Language':'en-US,en;q=0.9' });
    const network = []; let capture = Boolean(config.queryParam);
    page.on('response', async response => { if(!capture)return; try {
      const url = response.url(), ct = String(response.headers()['content-type'] || ''); if (!config.networkHints.test(url) && !/json/i.test(ct)) return;
      const body = await response.text(); if (body && body.length < 300000 && /(awb|shipment|origin|destination|arrival|pieces|weight|status|milestone|event|RCF|DLV|DEP)/i.test(body)) network.push({url,body});
    } catch {} });
    let target = config.url; if (config.queryParam) { const u = new URL(config.url); u.searchParams.set(config.queryParam, mawb.replace(/\D/g,'')); target = u.toString(); }
    await page.goto(target, { waitUntil:'domcontentloaded', timeout:30000 }); await sleep(config.settleMs || 2500);
    debug.finalUrl = page.url();
    let n=parseNetwork(network,mawb,config); if(n?.notFound)return{ok:false,notFound:true,technical:false,reason:`${config.name} returned no shipment record.`,airline:config,debug:{...debug,stage:'EXACT_NO_RECORD_DIRECT'}};
    if(n?.useful)return{ok:true,airline:config,shipment:n.shipment,debug:{...debug,stage:'EXACT_SUCCESS_NETWORK_DIRECT',networkResponses:network.length}};
    let parsed = parseShipment(await deepText(page), mawb, config, false); if (parsed.useful) return { ok:true, airline:config, shipment:parsed.shipment, debug:{ ...debug, stage:'EXACT_SUCCESS_PAGE_DIRECT', networkResponses:network.length } };
    capture=true; const submit = await fillOfficialForm(page, mawb, config); debug.submitted = submit.ok; debug.submit = submit;
    if (!submit.ok && !config.queryParam) return { ok:false, technical:true, reason:'Official tracking form was not accessible.', airline:config, debug:{ ...debug, stage:'EXACT_FORM_NOT_FOUND', preview:clean(await deepText(page)).slice(0,700) } };
    for (let attempt=0; attempt<16; attempt+=1) {
      await sleep(attempt===0 ? 1200 : 750);
      n=parseNetwork(network,mawb,config); if(n?.notFound)return{ok:false,notFound:true,technical:false,reason:`${config.name} returned no shipment record.`,airline:config,debug:{...debug,stage:'EXACT_NO_RECORD_NETWORK',networkResponses:network.length}};
      if(n?.useful)return{ok:true,airline:config,shipment:n.shipment,debug:{...debug,stage:'EXACT_SUCCESS_NETWORK',networkResponses:network.length}};
      parsed = parseShipment(await deepText(page), mawb, config, false);
      if (parsed.notFound) return { ok:false, notFound:true, technical:false, reason:`${config.name} returned no shipment record.`, airline:config, debug:{ ...debug, stage:'EXACT_NO_RECORD_PAGE', networkResponses:network.length } };
      if (parsed.useful) return { ok:true, airline:config, shipment:parsed.shipment, debug:{ ...debug, stage:'EXACT_SUCCESS_PAGE', networkResponses:network.length } };
    }
    return { ok:false, technical:true, reason:`${config.name} accepted the MAWB but the shipment result was not machine-readable.`, airline:config, debug:{ ...debug, stage:'EXACT_RESULT_UNREADABLE', networkResponses:network.length, networkUrls:[...new Set(network.map(x=>{try{return new URL(x.url).pathname}catch{return x.url}}))].slice(0,8), preview:clean(await deepText(page)).slice(0,700) } };
  } catch (error) {
    return { ok:false, technical:true, reason:error?.message || `${config.name} official tracker failed.`, airline:config, debug:{ ...debug, stage:'EXACT_BROWSER_ERROR' } };
  } finally { if (browser) try { await browser.close(); } catch {} }
}
