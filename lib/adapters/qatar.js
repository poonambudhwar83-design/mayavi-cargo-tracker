import fs from 'node:fs';
import { normalizeMawb } from '../airlines.js';

const QATAR_URL = 'https://www.qrcargo.com/s/track-your-shipment';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const clean = value => String(value || '').replace(/\s+/g, ' ').trim();

async function browserConfig() {
  const candidates = [
    process.env.CHROME_EXECUTABLE_PATH,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable'
  ].filter(Boolean);
  for (const executablePath of candidates) {
    if (fs.existsSync(executablePath)) {
      return { executablePath, args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote'] };
    }
  }
  const mod = await import('@sparticuz/chromium');
  const chromium = mod.default || mod;
  return { executablePath:await chromium.executablePath(), args:chromium.args };
}

function monthNumber(name='') {
  return ({jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'})[String(name).slice(0,3).toLowerCase()] || '';
}

function parseDateTime(raw='') {
  const s = clean(raw);
  let m = s.match(/\b(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})/);
  if (m) return { date:`${m[1]}-${m[2]}-${m[3]}`, time:`${String(m[4]).padStart(2,'0')}:${m[5]}` };
  m = s.match(/\b(\d{1,2})[-\s/]([A-Za-z]{3,9})[-\s/,](\d{2,4})\s+(\d{1,2}):(\d{2})(?:\s*(AM|PM))?/i);
  if (!m) return {date:'',time:''};
  let y = String(m[3]);
  if (y.length === 2) y = `20${y}`;
  const mo = monthNumber(m[2]);
  if (!mo) return {date:'',time:''};
  let h = Number(m[4]);
  const ap = String(m[6]||'').toUpperCase();
  if (ap === 'PM' && h < 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  return { date:`${y}-${mo}-${String(m[1]).padStart(2,'0')}`, time:`${String(h).padStart(2,'0')}:${m[5]}` };
}

function statusFromText(text='') {
  if (/notified consignee/i.test(text)) return 'NOTIFIED CONSIGNEE';
  if (/received at destination|\bRCF\b/i.test(text)) return 'RECEIVED AT DESTINATION';
  if (/\bdelivered\b|\bDLV\b/i.test(text)) return 'DELIVERED';
  if (/\barrived\b|\blanded\b|\bARR\b/i.test(text)) return 'ARRIVED';
  if (/\bdelayed\b|\blate\b|exception/i.test(text)) return 'DELAYED';
  if (/\bdeparted\b|\bDEP\b|in[ -]?transit|airborne|in flight/i.test(text)) return 'IN TRANSIT';
  if (/\bbooked\b|\bRCS\b|manifested|received from shipper/i.test(text)) return 'BOOKED';
  return 'TRACKING';
}

function parseQatarText(raw,mawb) {
  const text = clean(raw), digits = mawb.replace(/\D/g,''), serial = digits.slice(3);
  if (/no (?:shipment|record|result)|not found|invalid (?:awb|mawb|air waybill)|unable to find|no data/i.test(text)) return {notFound:true};

  const seen = text.includes(mawb) || text.includes(digits) || text.includes(serial);
  const route = text.match(/\b([A-Z]{3})\s*(?:-|–|—|→|>)\s*([A-Z]{3})\b/);
  const origin = ((text.match(/(?:origin|from|departure(?: airport)?)\s*[:\-]?\s*([A-Z]{3})\b/i)||[])[1] || route?.[1] || '').toUpperCase();
  const destination = ((text.match(/(?:destination|to|arrival(?: airport| station)?)\s*[:\-]?\s*([A-Z]{3})\b/i)||[])[1] || route?.[2] || '').toUpperCase();
  const pieces = (text.match(/(?:pieces?|pcs?|bags?)\s*[:#-]?\s*(\d{1,6})\b/i) || text.match(/\b(\d{1,6})\s*(?:pieces?|pcs?|bags?)\b/i) || [])[1] || '';
  const weight = ((text.match(/(?:gross\s+weight|weight)\s*[:#-]?\s*([\d,.]+)\s*(?:kg|kgs|kilograms?)?/i) || text.match(/([\d,.]+)\s*(?:kg|kgs|kilograms?)\b/i) || [])[1] || '').replace(/,/g,'');
  const flights = [...text.matchAll(/\bQR[-\s]?(\d{2,4})\b/ig)];
  const flightNo = flights.length ? `QR${flights.at(-1)[1]}` : '';

  let arrival = parseDateTime((text.match(/(?:actual arrival|arrived(?: at)?|landed(?: at)?|\bARR\b)[\s\S]{0,300}/i)||[])[0]||'');
  const actual = Boolean(arrival.date);
  if (!arrival.date) arrival = parseDateTime((text.match(/(?:estimated arrival|expected arrival|\bETA\b|scheduled arrival|arrival date(?:\/time)?)[\s\S]{0,320}/i)||[])[0]||'');
  const status = statusFromText(text);
  const useful = Boolean(seen && (origin || destination || pieces || weight || flightNo || arrival.date || status !== 'TRACKING'));

  return { useful, shipment:{
    mawb, carrierCode:'QR', airlineName:'Qatar Airways Cargo', origin, destination,
    bags:pieces, pieces, weight, flightNo, arrivalDate:arrival.date, arrivalTime:arrival.time,
    arrivalIsActual:actual, status, officialTracker:QATAR_URL, source:'Qatar Airways Cargo official website'
  }};
}

async function deepText(page) {
  return page.evaluate(() => {
    const parts=[];
    const walk=root=>{
      if (!root) return;
      if (root instanceof ShadowRoot && root.textContent?.trim()) parts.push(root.textContent);
      if (!root.querySelectorAll) return;
      for (const el of root.querySelectorAll('*')) if (el.shadowRoot) walk(el.shadowRoot);
    };
    if (document.body?.innerText) parts.push(document.body.innerText);
    walk(document);
    return parts.join('\n');
  });
}

async function deepHandles(page, selector) {
  const arrayHandle = await page.evaluateHandle(sel => {
    const out=[], seen=new Set();
    const walk=root=>{
      if (!root?.querySelectorAll) return;
      for (const el of root.querySelectorAll(sel)) {
        if (!seen.has(el)) { seen.add(el); out.push(el); }
      }
      for (const el of root.querySelectorAll('*')) if (el.shadowRoot) walk(el.shadowRoot);
    };
    walk(document);
    return out;
  }, selector);
  const props = await arrayHandle.getProperties();
  const handles=[];
  for (const prop of props.values()) {
    const el = prop.asElement();
    if (el) handles.push(el);
  }
  await arrayHandle.dispose();
  return handles;
}

async function inputMeta(handle) {
  return handle.evaluate(el => {
    const r=el.getBoundingClientRect();
    return {
      visible:r.width>3&&r.height>3&&!el.disabled,
      maxLength:Number(el.maxLength||-1),
      value:String(el.value||''),
      readOnly:Boolean(el.readOnly)
    };
  });
}

async function visibleTextInputs(page) {
  const inputs=await deepHandles(page,'input[type="text"]');
  const visible=[];
  for (const handle of inputs) {
    try {
      const meta=await inputMeta(handle);
      if (meta.visible) visible.push({handle,meta});
    } catch {}
  }
  return visible;
}

async function clearAndType(page, handle, value, blur=false) {
  await handle.click({clickCount:3});
  await page.keyboard.press('Backspace');
  await handle.type(value,{delay:65});
  const typed=await handle.evaluate(el => String(el.value||''));
  if (blur) await page.keyboard.press('Tab');
  return typed;
}

async function fillAndSubmit(page,mawb) {
  const digits=mawb.replace(/\D/g,''), prefix=digits.slice(0,3), serial=digits.slice(3);
  let fields=await visibleTextInputs(page);
  if (!fields.length) return {ok:false,reason:'QATAR_AWB_INPUTS_NOT_FOUND',inputCount:0};

  let prefixField=fields.find(x=>x.meta.maxLength===3||x.meta.value==='157') || null;
  let numberField=prefixField ? fields.find(x=>x!==prefixField&&!x.meta.readOnly) || null : null;
  let prefixMode='separate-prefix';
  let prefixValue='157';

  if (!prefixField && fields.length===1) {
    prefixMode='dynamic-prefix-first';
    prefixField=fields[0];
    prefixValue=await clearAndType(page,prefixField.handle,prefix,true);
    if (prefixValue!==prefix) {
      return {ok:false,reason:'QATAR_PREFIX_VALUE_DID_NOT_STICK',prefixMode,enteredLength:prefixValue.length,expectedLength:3};
    }
    await sleep(900);
    fields=await visibleTextInputs(page);
    numberField=fields.find(x=>x.meta.value!=='157'&&!x.meta.readOnly) || null;
  } else if (prefixField) {
    if (prefixField.meta.value!=='157') {
      prefixValue=await clearAndType(page,prefixField.handle,prefix,true);
      if (prefixValue!==prefix) return {ok:false,reason:'QATAR_PREFIX_VALUE_DID_NOT_STICK',prefixMode,enteredLength:prefixValue.length,expectedLength:3};
      await sleep(650);
      fields=await visibleTextInputs(page);
    } else {
      await prefixField.handle.click();
      await page.keyboard.press('Tab');
      await sleep(350);
      fields=await visibleTextInputs(page);
    }
    numberField=fields.find(x=>x.meta.value!=='157'&&!x.meta.readOnly) || numberField;
  }

  if (!numberField) {
    return {ok:false,reason:'QATAR_AWB_NUMBER_INPUT_NOT_RENDERED',prefixMode,prefixValue,inputCount:fields.length,fieldValues:fields.map(x=>x.meta.value)};
  }

  const serialValue=await clearAndType(page,numberField.handle,serial,false);
  if (serialValue!==serial) {
    return {ok:false,reason:'QATAR_AWB_VALUE_DID_NOT_STICK',prefixMode,prefixValue,enteredLength:serialValue.length,expectedLength:8};
  }

  const buttons=await deepHandles(page,'button,input[type="submit"],[role="button"]');
  let trackButton=null,buttonText='';
  for (const button of buttons) {
    try {
      const meta=await button.evaluate(el=>{
        const r=el.getBoundingClientRect();
        return {visible:r.width>3&&r.height>3&&!el.disabled,text:String(el.innerText||el.value||el.getAttribute('aria-label')||'').replace(/\s+/g,' ').trim()};
      });
      if (meta.visible&&/track shipment/i.test(meta.text)) {trackButton=button;buttonText=meta.text;break;}
    } catch {}
  }
  if (!trackButton) return {ok:false,reason:'QATAR_TRACK_BUTTON_NOT_FOUND',enteredLength:serialValue.length,expectedLength:8};

  await trackButton.click({delay:70});
  return {ok:true,prefixMode,prefixValue,enteredLength:serialValue.length,expectedLength:8,button:buttonText};
}

export async function trackQatar(inputMawb) {
  const mawb=normalizeMawb(inputMawb);
  const airline={name:'Qatar Airways Cargo',iata:'QR',url:QATAR_URL};
  if (!/^157-\d{8}$/.test(mawb)) return {ok:false,technical:false,reason:'INVALID QATAR MAWB',airline,debug:{stage:'QATAR_INVALID_MAWB'}};

  let browser;
  const debug={stage:'QATAR_OPEN',airline:airline.name,officialUrl:QATAR_URL};
  try {
    const mod=await import('puppeteer-core'), puppeteer=mod.default||mod, config=await browserConfig();
    debug.browser=config.executablePath;
    browser=await puppeteer.launch({...config,headless:true,defaultViewport:{width:1440,height:1050}});
    const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36');
    await page.setExtraHTTPHeaders({'Accept-Language':'en-US,en;q=0.9'});
    await page.goto(QATAR_URL,{waitUntil:'domcontentloaded',timeout:30000});
    await sleep(3500);

    debug.stage='QATAR_SUBMIT';
    const submit=await fillAndSubmit(page,mawb);
    debug.submit=submit;
    if (!submit.ok) return {ok:false,technical:true,reason:submit.reason,airline,debug:{...debug,stage:'QATAR_FORM_FAILED'}};

    debug.stage='QATAR_WAIT_RESULT';
    let last='';
    for (let attempt=0;attempt<15;attempt+=1) {
      await sleep(attempt===0?1400:900);
      last=clean(await deepText(page));
      const parsed=parseQatarText(last,mawb);
      if (parsed.notFound) return {ok:false,notFound:true,technical:false,reason:'Qatar Airways Cargo returned no shipment record.',airline,debug:{...debug,stage:'QATAR_NO_RECORD'}};
      if (parsed.useful) return {ok:true,airline,shipment:parsed.shipment,debug:{...debug,stage:'QATAR_SUCCESS'}};
    }

    return {ok:false,technical:true,reason:'Qatar MAWB was submitted, but no machine-readable result was returned.',airline,debug:{...debug,stage:'QATAR_RESULT_UNREADABLE',resultPreview:last.slice(0,500)}};
  } catch(error) {
    return {ok:false,technical:true,reason:error?.message||'Qatar official tracker failed.',airline,debug:{...debug,stage:'QATAR_BROWSER_ERROR'}};
  } finally {
    if (browser) try {await browser.close();} catch{}
  }
}
