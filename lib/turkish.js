import fs from 'node:fs';
import { createWorker } from 'tesseract.js';
import { normalizeMawb } from './airlines.js';

const URL='https://turkishcargo.com/en/cargo-tracking';
const QUICK='https://www.turkishcargo.com/en/online-services/shipment-tracking';
const AIRLINE={name:'Turkish Cargo',iata:'TK',url:URL};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clean=v=>String(v||'').replace(/\s+/g,' ').trim();
const digitsOnly=v=>String(v||'').replace(/\D/g,'');
const MONTH={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};

async function browserConfig(){
  for(const p of [process.env.CHROME_EXECUTABLE_PATH,'/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome','/usr/bin/google-chrome-stable'].filter(Boolean)){
    if(fs.existsSync(p))return{executablePath:p,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote']};
  }
  const mod=await import('@sparticuz/chromium');const chromium=mod.default||mod;
  return{executablePath:await chromium.executablePath(),args:chromium.args};
}
function parseDateTime(v=''){
  const s=clean(v);let m;
  m=s.match(/(20\d{2})[-\/.]([01]?\d)[-\/.]([0-3]?\d)[T\s,]+(\d{1,2}):(\d{2})/);if(m)return{date:`${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`,time:`${String(m[4]).padStart(2,'0')}:${m[5]}`};
  m=s.match(/([0-3]?\d)[-\/.]([01]?\d)[-\/.](20\d{2})[T\s,]+(\d{1,2}):(\d{2})/);if(m)return{date:`${m[3]}-${String(m[2]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`,time:`${String(m[4]).padStart(2,'0')}:${m[5]}`};
  m=s.match(/\b([0-3]?\d)\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s+(20\d{2})[\s,]+(\d{1,2}):(\d{2})\b/i);if(m)return{date:`${m[3]}-${MONTH[m[2].slice(0,3).toUpperCase()]}-${String(m[1]).padStart(2,'0')}`,time:`${String(m[4]).padStart(2,'0')}:${m[5]}`};
  m=s.match(/\b(JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER)\s+([0-3]?\d)(?:ST|ND|RD|TH)?,?\s+(20\d{2})[\s,]+(\d{1,2}):(\d{2})\b/i);if(m)return{date:`${m[3]}-${MONTH[m[1].slice(0,3).toUpperCase()]}-${String(m[2]).padStart(2,'0')}`,time:`${String(m[4]).padStart(2,'0')}:${m[5]}`};
  return{date:'',time:''};
}
function around(text,rx,before=180,after=440){const m=rx.exec(text);if(!m)return'';return text.slice(Math.max(0,m.index-before),Math.min(text.length,m.index+after));}
function lastFlight(text=''){const all=[...clean(text).toUpperCase().matchAll(/\bTK[-\s]?(\d{2,4})\b/g)];return all.length?`TK${all.at(-1)[1]}`:'';}
function shipmentStatus(text='',destination=''){
  const s=clean(text).toUpperCase(),dest=String(destination||'').toUpperCase();
  if(/\bDLV\b|SHIPMENT DELIVERED|DELIVERED\s*-?\s*[A-Z]{3}/.test(s))return'ARRIVED';
  if(dest&&new RegExp(`\\b(?:RCF|ARR)\\s+${dest}\\b|${dest}[^.]{0,140}(?:RECEIVED FROM FLIGHT|ARRIVED)`,'i').test(s))return'ARRIVED';
  if(/\bDEP\b|DEPARTED|IN TRANSIT|AIRBORNE|IN FLIGHT/.test(s))return'IN TRANSIT';
  if(/DELAY|LATE|EXCEPTION/.test(s))return'DELAYED';
  return'BOOKED';
}
function parseTkSmart(text,mawb){
  const s=clean(text),upper=s.toUpperCase(),digits=digitsOnly(mawb),serial=digits.slice(3),flatDigits=digitsOnly(s);
  if(/no (?:shipment|record|result)|not found|invalid (?:awb|air waybill)|no data/i.test(s))return{notFound:true};
  const awbMatched=s.includes(mawb)||s.includes(digits)||s.includes(serial)||flatDigits.includes(digits)||flatDigits.includes(serial);
  const visualContext=/TK\s*SMART|CARGO\s+TRACKING\s+INFORMATION|TURKISH\s+CARGO/i.test(s);
  if(!awbMatched&&!visualContext)return null;

  let origin=((s.match(/\bFROM\s*[:\-]?\s*([A-Z]{3})\b/i)||s.match(/\bORIGIN\s*[:\-]?\s*([A-Z]{3})\b/i)||[])[1]||'').toUpperCase();
  let destination=((s.match(/\bTO\s*[:\-]?\s*([A-Z]{3})\b/i)||s.match(/\bDESTINATION\s*[:\-]?\s*([A-Z]{3})\b/i)||[])[1]||'').toUpperCase();
  if(!origin||!destination){const route=upper.match(/\b([A-Z]{3})\s*(?:→|->|–|—|-)\s*([A-Z]{3})\b/);if(route){origin=origin||route[1];destination=destination||route[2];}}
  const pieces=(s.match(/\b(\d{1,6})\s*PIECE\s*\(?S\)?/i)||s.match(/(?:PIECES?|PCS?|BAGS?)\s*[:\-]?\s*(\d{1,6})/i)||s.match(/\b(\d{1,6})\s*(?:PIECES?|PCS?|BAGS?)\b/i)||[])[1]||'';
  const weight=((s.match(/(?:GROSS\s+)?WEIGHT\s*[:\-]?\s*([\d,.]+)\s*(?:KG|KGS)?/i)||s.match(/\b([\d,.]+)\s*(?:KG|KGS)\b/i)||[])[1]||'').replace(/,/g,'');
  const volume=((s.match(/(?:VOLUME|VOL)\s*[:\-]?\s*([\d,.]+)\s*(?:M3|M³|CBM)?/i)||s.match(/\b([\d,.]+)\s*(?:M3|M³|CBM)\b/i)||[])[1]||'').replace(/,/g,'');
  const flightNo=lastFlight(s),status=shipmentStatus(s,destination);

  let arrival={date:'',time:''},arrivalIsActual=false;
  if(status==='ARRIVED'){
    let block=around(s,/\bDLV\b|SHIPMENT DELIVERED|DELIVERED\s*-?\s*[A-Z]{3}/i,220,520);
    if(!block&&destination)block=around(s,new RegExp(`\\b(?:RCF|ARR)\\s+${destination}\\b|${destination}[^.]{0,140}(?:RECEIVED FROM FLIGHT|ARRIVED)`,'i'),220,520);
    arrival=parseDateTime(block||s);if(!arrival.date&&!arrival.time)arrival=parseDateTime(s);arrivalIsActual=Boolean(arrival.date||arrival.time);
  }else{
    const eta=around(s,/ETA|ESTIMATED ARRIVAL|EXPECTED ARRIVAL|SCHEDULED ARRIVAL/i,100,420);arrival=parseDateTime(eta);
  }
  const bookingBlock=around(s,/BOOKED|BOOKING|ACCEPTED|\bRCS\b/i,100,420),bookingDate=parseDateTime(bookingBlock).date;
  const useful=Boolean((origin&&destination)||pieces||weight||volume||flightNo||arrival.date||arrival.time||/TK\s*SMART|\bDLV\b|DELIVERED/i.test(s));
  if(!useful)return null;
  return{useful:true,shipment:{mawb,carrierCode:'TK',airlineName:'Turkish Cargo',origin,destination,bags:pieces,pieces,weight,volume,flightNo,bookingDate,arrivalDate:arrival.date,arrivalTime:arrival.time,arrivalIsActual,status,officialTracker:URL,source:'Turkish Cargo TK SMART / Cargo Tracking Information'}};
}
async function pageText(page){const out=[];for(const f of page.frames())try{const t=await f.evaluate(()=>document.body?.innerText||'');if(t)out.push(t)}catch{}return out.join('\n');}
async function clickText(frame,wanted){
  try{return await frame.evaluate((label)=>{
    const norm=s=>String(s||'').replace(/\s+/g,' ').trim().toLowerCase(),target=norm(label),found=[];
    const scan=root=>{for(const el of root.querySelectorAll('button,input[type="submit"],input[type="button"],[role="button"],a,[onclick],li,[role="option"],[role="menuitem"],div,span')){const r=el.getBoundingClientRect(),text=norm(el.innerText||el.value||el.textContent||'');if(r.width>3&&r.height>3&&text===target)found.push({el,area:r.width*r.height});if(el.shadowRoot)scan(el.shadowRoot);}};
    scan(document);found.sort((a,b)=>a.area-b.area);if(!found.length)return false;found[0].el.click();return true;
  },wanted)}catch{return false}
}
async function bodyHas(frame,needle){try{return await frame.evaluate(n=>String(document.body?.innerText||'').includes(n),needle)}catch{return false}}
async function submitCargoSearch(frame){if(await clickText(frame,'Search'))return'CLICK_SEARCH';return'';}
async function tkSmartText(page,serial){
  for(const frame of page.frames())try{const result=await frame.evaluate((awb)=>{
    const norm=s=>String(s||'').replace(/\s+/g,' ').trim(),candidates=[];
    const scan=root=>{for(const el of root.querySelectorAll('section,article,div')){const t=norm(el.innerText||el.textContent);if(t.length>=40&&t.length<=18000&&/TK SMART/i.test(t)&&t.includes(awb)&&(/PIECE\s*\(?S\)?|PIECES?|\bFROM\b|\bTO\b|\bDLV\b/i.test(t)))candidates.push({el,text:t,len:t.length});if(el.shadowRoot)scan(el.shadowRoot);}};
    scan(document);candidates.sort((a,b)=>a.len-b.len);const hit=candidates[0];if(!hit)return'';hit.el.scrollIntoView({block:'center',behavior:'auto'});return hit.text;
  },serial);if(result)return result;}catch{}return'';
}
async function fillAddSearch(page,mawb){
  const digits=digitsOnly(mawb),prefix=digits.slice(0,3),serial=digits.slice(3);
  for(const frame of page.frames()){
    const inputs=await frame.$$('input:not([type="hidden"]),textarea'),fields=[];
    for(const input of inputs)try{const meta=await input.evaluate(el=>{const r=el.getBoundingClientRect();return{visible:r.width>3&&r.height>3&&!el.disabled&&!el.readOnly,max:Number(el.maxLength||-1),label:`${el.placeholder||''} ${el.name||''} ${el.id||''} ${el.getAttribute('aria-label')||''} ${el.labels?.[0]?.innerText||''}`}});if(meta.visible)fields.push({input,meta});}catch{}
    const pf=fields.find(x=>x.meta.max===3||/prefix|awb code|airline code/i.test(x.meta.label));let nf=fields.find(x=>x!==pf&&(x.meta.max===8||/awb|air waybill/i.test(x.meta.label)));if(!nf)nf=fields.find(x=>[11,12,14].includes(x.meta.max));if(!nf)continue;
    if(pf){await pf.input.click({clickCount:3});await page.keyboard.press('Backspace');await pf.input.type(prefix,{delay:35});}
    await nf.input.click({clickCount:3});await page.keyboard.press('Backspace');await nf.input.type(nf.meta.max===8?serial:(pf?serial:digits),{delay:35});await sleep(900);
    let addMode='CLICK_ADD';if(!await clickText(frame,`Add: ${serial}`)){await nf.input.press('ArrowDown');await nf.input.press('Enter');addMode='ARROWDOWN_ENTER_ADD';await sleep(500);if(!await bodyHas(frame,serial)){await nf.input.click();await nf.input.press('Enter');addMode='ENTER_ADD';}}
    await sleep(700);const searchMode=await submitCargoSearch(frame);return{ok:true,stage:'ADD_THEN_CARGO_SEARCH',addMode,searchMode:searchMode||'SEARCH_NOT_CLICKED',serialVisible:await bodyHas(frame,serial)};
  }
  return{ok:false,stage:'FORM_NOT_FOUND'};
}
async function scrapeResult(page,mawb,stage,flow,debug){
  const serial=digitsOnly(mawb).slice(3);
  for(let i=0;i<8;i++){
    await sleep(i?650:1200);const card=await tkSmartText(page,serial);
    if(card){const parsed=parseTkSmart(card,mawb);if(parsed?.notFound)return{ok:false,notFound:true,reason:'NO SHIPMENT RECORD',airline:AIRLINE,debug:{...debug,...flow,stage:`${stage}_NO_RECORD`}};if(parsed?.useful)return{ok:true,airline:AIRLINE,shipment:parsed.shipment,debug:{...debug,...flow,stage:`${stage}_TK_SMART_SUCCESS`,tkSmartSample:clean(card).slice(0,8000)}};}
    if(i===3||i===6)for(const frame of page.frames())try{await frame.evaluate(()=>window.scrollBy({top:420,left:0,behavior:'auto'}))}catch{}
  }
  return null;
}
async function scrollToCargoInformation(page){
  let found=false;
  for(const frame of page.frames())try{const hit=await frame.evaluate(()=>{
    const norm=s=>String(s||'').replace(/\s+/g,' ').trim().toLowerCase();
    const els=[...document.querySelectorAll('h1,h2,h3,h4,h5,section,div,p,span')];
    const target=els.find(el=>{const t=norm(el.innerText||el.textContent);return t==='cargo tracking information'||t.startsWith('cargo tracking information ')});
    if(target){target.scrollIntoView({block:'start',behavior:'auto'});window.scrollBy({top:360,left:0,behavior:'auto'});return true;}
    window.scrollBy({top:520,left:0,behavior:'auto'});return false;
  });found=found||hit;}catch{}
  await sleep(700);return found;
}
async function ocrTkSmartScreens(page,mawb,stage,flow,debug){
  await scrollToCargoInformation(page);
  let worker;const samples=[];
  try{
    worker=await createWorker('eng');
    for(let i=0;i<3;i++){
      if(i){for(const frame of page.frames())try{await frame.evaluate(()=>window.scrollBy({top:430,left:0,behavior:'auto'}))}catch{}await sleep(450);}
      const shot=await page.screenshot({type:'png',fullPage:false});
      const result=await worker.recognize(shot);const text=result?.data?.text||'';const flat=clean(text);samples.push(flat.slice(0,3000));
      const parsed=parseTkSmart(text,mawb);
      if(parsed?.notFound)return{ok:false,notFound:true,reason:'NO SHIPMENT RECORD',airline:AIRLINE,screenshotCaptured:true,screenshotOcrUsed:true,debug:{...debug,...flow,stage:`${stage}_SCREENSHOT_NO_RECORD`,ocrSample:flat.slice(0,5000)}};
      if(parsed?.useful){parsed.shipment.source='Turkish Cargo TK SMART screenshot OCR / Cargo Tracking Information';return{ok:true,airline:AIRLINE,shipment:parsed.shipment,screenshotCaptured:true,screenshotVerified:true,screenshotOcrUsed:true,debug:{...debug,...flow,stage:`${stage}_TK_SMART_SCREENSHOT_OCR_SUCCESS`,ocrSample:flat.slice(0,8000),screenshotIndex:i+1}};}
    }
    return{ok:false,reason:'TURKISH TK SMART SCREENSHOT OCR FOUND NO SHIPMENT FIELDS',airline:AIRLINE,screenshotCaptured:true,screenshotOcrUsed:true,debug:{...debug,...flow,stage:`${stage}_SCREENSHOT_OCR_EMPTY`,ocrSamples:samples}};
  }catch(e){return{ok:false,reason:e?.message||'TURKISH SCREENSHOT OCR FAILED',airline:AIRLINE,screenshotCaptured:true,screenshotOcrUsed:true,debug:{...debug,...flow,stage:`${stage}_SCREENSHOT_OCR_ERROR`,ocrSamples:samples}};}
  finally{if(worker)try{await worker.terminate()}catch{}}
}

export async function trackTurkish(input){
  const mawb=normalizeMawb(input);if(!mawb||!mawb.startsWith('235-'))return{ok:false,reason:'INVALID TURKISH MAWB',airline:AIRLINE};
  let browser;const debug={prefix:'235',airline:'Turkish Cargo',url:URL,stage:'OPEN'};
  try{
    const mod=await import('puppeteer-core');const puppeteer=mod.default||mod,launch=await browserConfig();browser=await puppeteer.launch({...launch,headless:true,defaultViewport:{width:1440,height:1200,deviceScaleFactor:1.25}});const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36');await page.setExtraHTTPHeaders({'Accept-Language':'en-US,en;q=0.9'});
    await page.goto(URL,{waitUntil:'domcontentloaded',timeout:30000});await sleep(1800);for(const frame of page.frames())await clickText(frame,'Accept all');
    const before=await pageText(page);if(/captcha|verify you are human|access denied|cloudflare|security check/i.test(before))return{ok:false,reason:'OFFICIAL SITE BLOCKED AUTOMATION',airline:AIRLINE,debug:{...debug,stage:'BLOCKED'}};
    const flow=await fillAddSearch(page,mawb);if(!flow.ok)return{ok:false,reason:'TURKISH ADD/SEARCH FLOW NOT FOUND',airline:AIRLINE,debug:{...debug,...flow}};

    const normal=await scrapeResult(page,mawb,'NORMAL',flow,debug);if(normal)return normal;
    const screenshot=await ocrTkSmartScreens(page,mawb,'NORMAL',flow,debug);if(screenshot.ok||screenshot.notFound)return screenshot;

    const quickUrl=`${QUICK}?awbInput=${encodeURIComponent(mawb)}&quick=True`;
    await page.goto(quickUrl,{waitUntil:'domcontentloaded',timeout:30000});await sleep(2200);for(const frame of page.frames())await clickText(frame,'Accept all');
    const quick=await scrapeResult(page,mawb,'QUICK_OFFICIAL',flow,{...debug,quickUrl});if(quick)return quick;
    const quickShot=await ocrTkSmartScreens(page,mawb,'QUICK_OFFICIAL',flow,{...debug,quickUrl});if(quickShot.ok||quickShot.notFound)return quickShot;

    const finalText=await pageText(page),parsed=parseTkSmart(finalText,mawb);if(parsed?.useful)return{ok:true,airline:AIRLINE,shipment:parsed.shipment,debug:{...debug,...flow,stage:'QUICK_FULL_PAGE_SUCCESS',quickUrl}};
    return{ok:false,reason:'TURKISH TK SMART RESULT NOT READABLE FROM DOM OR SCREENSHOT',airline:AIRLINE,screenshotCaptured:true,screenshotOcrUsed:true,debug:{...debug,...flow,stage:'TK_SMART_UNREADABLE',quickUrl,screenOcrReason:screenshot.reason,quickScreenOcrReason:quickShot.reason,preview:clean(finalText).slice(0,5000)}};
  }catch(e){return{ok:false,reason:e?.message||'TURKISH TRACKING FAILED',airline:AIRLINE,debug:{...debug,stage:'BROWSER_ERROR'}}}
  finally{if(browser)try{await browser.close()}catch{}}
}
