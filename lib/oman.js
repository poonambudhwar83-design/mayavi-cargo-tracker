import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { normalizeMawb } from './airlines.js';

const OFFICIAL='https://cargo.omanair.com/track-shipment';
const SMART='https://omanair.smartkargo.com/';
const AIRLINE={name:'Oman Air Cargo',iata:'WY',url:OFFICIAL};
const MONTHS={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
const pad=v=>String(v).padStart(2,'0');
const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
const digits=s=>String(s||'').replace(/\D/g,'');
const first=(s,rx)=>(String(s).match(rx)||[])[1]||'';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function parseDate(s=''){
  const t=String(s).toUpperCase();
  let m=t.match(/\b(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})\b/);if(m)return`${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m=t.match(/\b(\d{1,2})[-\/.](\d{1,2})[-\/.](20\d{2})\b/);if(m)return`${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  m=t.match(/\b(\d{1,2})[\s\-]+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s\-,]+(20\d{2})\b/);if(m)return`${m[3]}-${MONTHS[m[2]]}-${pad(m[1])}`;
  return'';
}
function parseTime(s=''){const m=String(s).match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);return m?`${pad(m[1])}:${m[2]}`:'';}
function linked(text,full,serial){const d=digits(text);return Boolean((full&&d.includes(full))||(serial&&d.includes(serial)));}
function windowAround(text,rx,before=120,after=360){const m=rx.exec(String(text));if(!m)return'';const i=m.index||0;return String(text).slice(Math.max(0,i-before),Math.min(String(text).length,i+after));}
function statusFromText(text=''){
  const s=String(text).toUpperCase();
  if(/\bDLV\b|DELIVERED/.test(s))return'DELIVERED';
  if(/\bRCF\b|RECEIVED FROM FLIGHT|ACTUAL ARRIVAL|\bARRIVED\b|\bARR\b|LANDED/.test(s))return'ARRIVED';
  if(/DELAYED|OFFLOAD|SHORT SHIP|EXCEPTION/.test(s))return'DELAYED';
  if(/\bDEP\b|DEPARTED|IN TRANSIT|AIRBORNE|IN FLIGHT/.test(s))return'IN TRANSIT';
  if(/\bRCS\b|\bBKD\b|BOOKED|ACCEPTED|RECEIVED FROM SHIPPER/.test(s))return'BOOKED';
  return'TRACKING';
}
function parseShipment(text,mawb){
  const flat=clean(text),upper=flat.toUpperCase();
  const origin=(first(flat,/(?:\bOrigin\b|\bFrom\b|Departure\s*(?:Station|Airport)?)\s*[:\-]?\s*([A-Z]{3})\b/i)||'').toUpperCase();
  const destination=(first(flat,/(?:\bDestination\b|\bTo\b|Arrival\s*(?:Station|Airport)?)\s*[:\-]?\s*([A-Z]{3})\b/i)||'').toUpperCase();
  const pieces=first(flat,/(?:Pieces?|Pcs?|No\.?\s*of\s*Pieces|Piece Count|Total Pieces)\s*[:#\-]?\s*(\d{1,6})\b/i)||first(flat,/\b(\d{1,6})\s*(?:PCS|PIECES?)\b/i);
  const weight=(first(flat,/(?:Gross\s*Weight|Chargeable\s*Weight|Total\s*Weight|\bWeight\b)\s*[:#\-]?\s*([\d,.]+)\s*(?:KG|KGS)?/i)||first(flat,/\b([\d,.]+)\s*(?:KG|KGS)\b/i)).replace(/,/g,'');
  const flights=[...upper.matchAll(/\bWY\s*[- ]?(\d{2,4})\b/g)];const flightNo=flights.length?`WY${flights.at(-1)[1]}`:'';
  const booked=windowAround(flat,/BOOKING\s*DATE|BOOKED|\bRCS\b|ACCEPTED/i,80,320);
  const bookingDate=parseDate(booked);
  const actual=windowAround(flat,/ACTUAL\s+ARRIVAL|\bARRIVED\b|RECEIVED\s+FROM\s+FLIGHT|\bRCF\b|\bARR\b|LANDED/i,100,420);
  const estimated=windowAround(flat,/ESTIMATED\s+ARRIVAL|EXPECTED\s+ARRIVAL|\bETA\b|SCHEDULED\s+ARRIVAL|\bSTA\b/i,100,420);
  let arrivalDate=parseDate(actual),arrivalTime=parseTime(actual),arrivalIsActual=Boolean(arrivalDate||arrivalTime);
  if(!arrivalDate&&!arrivalTime){arrivalDate=parseDate(estimated);arrivalTime=parseTime(estimated);arrivalIsActual=false;}
  let status=statusFromText(flat);if(!arrivalIsActual&&(arrivalDate||arrivalTime)&&status==='TRACKING')status='IN TRANSIT';
  return{mawb,carrierCode:'WY',airlineName:AIRLINE.name,origin,destination,bags:pieces,pieces,weight,flightNo,bookingDate,arrivalDate,arrivalTime,arrivalIsActual,status,officialTracker:OFFICIAL,source:'Oman Air Cargo / SmartKargo verified AWB result'};
}
function useful(s={}){return Boolean((s.origin&&s.destination)||s.pieces||s.weight||s.flightNo||s.bookingDate||s.arrivalDate||s.arrivalTime||(s.status&&s.status!=='TRACKING'));}
async function launch(){chromium.setGraphicsMode=false;return puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox'],defaultViewport:{width:1440,height:1000,deviceScaleFactor:1},executablePath:await chromium.executablePath(),headless:'shell'});}
async function pageText(page){const chunks=[];for(const frame of page.frames()){try{const t=await frame.evaluate(()=>document.body?.innerText||'');if(t)chunks.push(t);}catch{}}return chunks.join('\n');}
async function fillOfficial(page,full,serial){
  const setup=await page.evaluate(({full,serial})=>{
    const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>3&&r.height>3&&!e.disabled};
    const inputs=[...document.querySelectorAll('input')].filter(visible).filter(e=>!['hidden','checkbox','radio','submit','button'].includes((e.type||'text').toLowerCase()));
    const desc=e=>`${e.name||''} ${e.id||''} ${e.placeholder||''} ${e.getAttribute('aria-label')||''}`.toLowerCase();
    const target=inputs.find(e=>/airway|awb|shipment|track/.test(desc(e)))||inputs[0];if(!target)return{filled:false,inputCount:inputs.length};
    target.focus();const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;setter?.call(target,full);
    target.dispatchEvent(new Event('input',{bubbles:true}));target.dispatchEvent(new Event('change',{bubbles:true}));target.dispatchEvent(new Event('blur',{bubbles:true}));
    const label=e=>(e.innerText||e.value||e.getAttribute('aria-label')||e.getAttribute('title')||'').replace(/\s+/g,' ').trim();
    const controls=[...document.querySelectorAll('button,input[type="submit"],input[type="button"],[role="button"]')].filter(visible);
    const btn=controls.find(e=>/track shipment|^track$|search|submit|go/i.test(label(e)));if(btn){btn.click();return{filled:true,submitted:true,button:label(btn),serial};}
    const form=target.form||target.closest('form');if(form&&typeof form.requestSubmit==='function'){form.requestSubmit();return{filled:true,submitted:true,button:'requestSubmit',serial};}
    return{filled:true,submitted:false,serial};
  },{full,serial}).catch(()=>({filled:false,submitted:false}));
  if(setup.filled&&!setup.submitted)await page.keyboard.press('Enter').catch(()=>{});
  return setup;
}
async function fillSmartKargo(page,prefix,serial,full){
  await page.goto(SMART,{waitUntil:'domcontentloaded',timeout:25000});await sleep(1800);
  return page.evaluate(({prefix,serial,full})=>{
    const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>3&&r.height>3&&!e.disabled&&!e.readOnly};
    const candidates=[...document.querySelectorAll('form,section,fieldset,div,table,td')].filter(e=>/Track your Air WayBill/i.test(e.innerText||''));
    let root=candidates.sort((a,b)=>(a.innerText||'').length-(b.innerText||'').length)[0]||document.body;
    let inputs=[...root.querySelectorAll('input')].filter(visible).filter(e=>!['hidden','password','checkbox','radio','submit','button'].includes((e.type||'text').toLowerCase()));
    if(!inputs.length)return{filled:false,reason:'NO_TRACK_INPUTS'};
    const set=(el,val)=>{el.focus();const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;setter?.call(el,val);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));};
    const desc=e=>`${e.name||''} ${e.id||''} ${e.placeholder||''} ${e.getAttribute('aria-label')||''}`.toLowerCase();
    const prefixField=inputs.find(e=>Number(e.maxLength)===3||/prefix|airline/.test(desc(e)));
    let numberField=inputs.find(e=>e!==prefixField&&(Number(e.maxLength)===8||/awb|airway|waybill|shipment|number/.test(desc(e))));
    if(prefixField&&numberField){set(prefixField,prefix);set(numberField,serial);}else if(inputs.length>=2){set(inputs[0],prefix);set(inputs[1],serial);numberField=inputs[1];}else{set(inputs[0],full);numberField=inputs[0];}
    const label=e=>(e.innerText||e.value||e.getAttribute('aria-label')||e.getAttribute('title')||'').replace(/\s+/g,' ').trim();
    const controls=[...root.querySelectorAll('button,input[type="submit"],input[type="button"],[role="button"]')].filter(visible);
    const btn=controls.find(e=>/track|search|go/i.test(label(e)));
    if(btn){btn.click();return{filled:true,submitted:true,button:label(btn),inputCount:inputs.length};}
    const form=numberField?.form||numberField?.closest('form');if(form&&typeof form.requestSubmit==='function'){form.requestSubmit();return{filled:true,submitted:true,button:'requestSubmit',inputCount:inputs.length};}
    return{filled:true,submitted:false,inputCount:inputs.length};
  },{prefix,serial,full}).catch(e=>({filled:false,reason:e?.message||'SMARTKARGO_FILL_ERROR'}));
}

export async function trackOman(input){
  const mawb=normalizeMawb(input);if(!mawb||!mawb.startsWith('910-'))return{ok:false,reason:'INVALID OMAN AIR CARGO MAWB',airline:AIRLINE,officialTracker:OFFICIAL};
  const full=digits(mawb),prefix=full.slice(0,3),serial=full.slice(3);let browser;let captureOn=false;const captured=[];
  try{
    browser=await launch();const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36');
    const attach=p=>p.on('response',async res=>{if(!captureOn)return;try{const type=res.request().resourceType();if(!['xhr','fetch','document'].includes(type))return;const ct=String(res.headers()['content-type']||'');if(!/json|text|javascript|html/i.test(ct))return;const body=await res.text();if(body&&body.length<1500000)captured.push({url:res.url(),body});}catch{}});
    attach(page);
    await page.goto(OFFICIAL,{waitUntil:'domcontentloaded',timeout:20000});await sleep(1000);
    const before=clean(await pageText(page));if(/captcha|verify you are human|security check|cloudflare|turnstile|access denied/i.test(before))return{ok:false,reason:'OMAN AIR SECURITY CHECK REQUIRES MANUAL CHECK',airline:AIRLINE,officialTracker:OFFICIAL,debug:{stage:'CAPTCHA'}};
    captureOn=true;const officialSetup=await fillOfficial(page,full,serial);await sleep(3500);

    for(const p of await browser.pages())if(p!==page)attach(p);
    const candidates=await browser.pages();
    const linkedSources=[];
    for(const p of candidates){try{const t=await pageText(p);if(linked(t,full,serial))linkedSources.push({kind:'page',url:p.url(),text:t});}catch{}}
    for(const r of captured)if(linked(r.body,full,serial))linkedSources.push({kind:'network',url:r.url,text:r.body});

    for(const src of linkedSources){const shipment=parseShipment(src.text,mawb);if(useful(shipment))return{ok:true,airline:AIRLINE,shipment,screenshotCaptured:false,screenshotVerified:false,screenshotOcrUsed:false,debug:{stage:'OFFICIAL_LINKED_SUCCESS',officialSetup,sourceKind:src.kind,sourceUrl:src.url,capturedUrls:captured.map(x=>x.url).slice(-12),textSample:clean(src.text).slice(0,4000)}};}

    const smart=await browser.newPage();attach(smart);const smartSetup=await fillSmartKargo(smart,prefix,serial,full);if(smartSetup.filled&&!smartSetup.submitted)await smart.keyboard.press('Enter').catch(()=>{});await sleep(3500);
    try{await smart.waitForNetworkIdle({idleTime:700,timeout:8000});}catch{}
    await sleep(1000);
    const smartPages=await browser.pages();const smartSources=[];
    for(const p of smartPages){try{const t=await pageText(p);if(linked(t,full,serial))smartSources.push({kind:'page',url:p.url(),text:t});}catch{}}
    for(const r of captured)if(linked(r.body,full,serial))smartSources.push({kind:'network',url:r.url,text:r.body});
    for(const src of smartSources){const shipment=parseShipment(src.text,mawb);if(useful(shipment))return{ok:true,airline:AIRLINE,shipment,screenshotCaptured:false,screenshotVerified:false,screenshotOcrUsed:false,debug:{stage:'SMARTKARGO_LINKED_SUCCESS',officialSetup,smartSetup,sourceKind:src.kind,sourceUrl:src.url,capturedUrls:captured.map(x=>x.url).slice(-16),textSample:clean(src.text).slice(0,5000)}};}

    return{ok:false,reason:'OMAN AIR RETURNED NO AWB-LINKED SHIPMENT DATA',airline:AIRLINE,officialTracker:OFFICIAL,debug:{stage:'NO_VERIFIED_AWB_RESULT',officialSetup,smartSetup,pages:(await browser.pages()).map(p=>p.url()),capturedUrls:captured.map(x=>x.url).slice(-20)}};
  }catch(e){return{ok:false,reason:`OMAN AIR TRACKING ERROR: ${e?.message||e}`,airline:AIRLINE,officialTracker:OFFICIAL,debug:{stage:'ERROR',message:e?.message||String(e)}};}
  finally{try{if(browser)await browser.close()}catch{}}
}
