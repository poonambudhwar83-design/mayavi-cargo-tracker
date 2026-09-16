import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { normalizeMawb } from './airlines.js';

const ENTRY='https://www.iagcargo.com/iagcargo/portlet/en/html/601';
const AIRLINE_URL='https://www.iagcargo.com/';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clean=v=>String(v||'').replace(/\s+/g,' ').trim();
const pad=v=>String(v).padStart(2,'0');
const MONTH={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};

async function browserConfig(){
  for(const p of [process.env.CHROME_EXECUTABLE_PATH,'/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome','/usr/bin/google-chrome-stable'].filter(Boolean)){
    if(fs.existsSync(p))return{executablePath:p,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote']};
  }
  const mod=await import('@sparticuz/chromium');
  const chromium=mod.default||mod;
  chromium.setGraphicsMode=false;
  return{executablePath:await chromium.executablePath(),args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']};
}

function parseDate(s=''){
  const t=String(s).toUpperCase();let m;
  m=t.match(/\b(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})\b/);if(m)return`${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m=t.match(/\b(\d{1,2})[-\/.](\d{1,2})[-\/.](20\d{2})\b/);if(m)return`${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  m=t.match(/\b(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s+(20\d{2})\b/);if(m)return`${m[3]}-${MONTH[m[2]]}-${pad(m[1])}`;
  return'';
}
function parseTime(s=''){
  let m=String(s).match(/\b(1[0-2]|0?\d):([0-5]\d)\s*(AM|PM)\b/i);
  if(m){let h=Number(m[1])%12;if(m[3].toUpperCase()==='PM')h+=12;return`${pad(h)}:${m[2]}`;}
  m=String(s).match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);return m?`${pad(m[1])}:${m[2]}`:'';
}
function first(text,patterns=[]){for(const rx of patterns){const m=String(text||'').match(rx);if(m?.[1])return clean(m[1]);}return'';}
function around(text,token,radius=420){const flat=clean(text),m=flat.match(token);if(!m)return'';const i=m.index||0;return flat.slice(Math.max(0,i-radius),Math.min(flat.length,i+radius));}
function parseShipment(text='',mawb=''){
  const flat=clean(text),upper=flat.toUpperCase();
  let origin=first(flat,[/\bORIGIN\b\s*[:\-]?\s*([A-Z]{3})\b/i,/\bFROM\b\s*[:\-]?\s*([A-Z]{3})\b/i]).toUpperCase();
  let destination=first(flat,[/\bDESTINATION\b\s*[:\-]?\s*([A-Z]{3})\b/i,/\bTO\b\s*[:\-]?\s*([A-Z]{3})\b/i]).toUpperCase();
  const route=upper.match(/\b([A-Z]{3})\s*(?:TO|->|→|—|–)\s*([A-Z]{3})\b/);if(route){origin=origin||route[1];destination=destination||route[2];}
  const pieces=first(flat,[/\b(?:PIECES?|PCS)\b\s*[:\-]?\s*(\d{1,6}(?:\s*\/\s*\d{1,6})?)/i,/\b(\d{1,6})\s*(?:PCS|PIECES?)\b/i]).replace(/\s+/g,'');
  const weight=first(flat,[/\b(?:GROSS\s*WEIGHT|WEIGHT)\b\s*[:\-]?\s*([\d,.]+(?:\s*\/\s*[\d,.]+)?)\s*(?:KG|KGS)?/i,/\b([\d,.]+)\s*(?:KG|KGS)\b/i]).replace(/[\s,]+/g,'');
  const flightNo=first(upper,[/\b(BA\s*[- ]?\d{2,4})\b/]).replace(/[\s-]+/g,'');
  let bookingDate='';for(const tok of [/\bBOOKED\b/i,/\bRCS\b/i,/RECEIVED\s+FROM\s+SHIPPER/i,/\bACCEPTED\b/i]){const w=around(flat,tok);const d=parseDate(w);if(d){bookingDate=d;break;}}
  let arrivalDate='',arrivalTime='',arrivalIsActual=false,arrivalSource='';
  for(const tok of [/\bRCF\b/i,/\bARR\b/i,/RECEIVED\s+FROM\s+FLIGHT/i,/ACTUAL\s+ARRIVAL/i]){const w=around(flat,tok);const d=parseDate(w),t=parseTime(w);if(d||t){arrivalDate=d;arrivalTime=t;arrivalIsActual=true;arrivalSource=String(tok);break;}}
  if(!arrivalDate&&!arrivalTime){for(const tok of [/\bETA\b/i,/\bSTA\b/i,/EXPECTED\s+ARRIVAL/i,/SCHEDULED\s+ARRIVAL/i]){const w=around(flat,tok);const d=parseDate(w),t=parseTime(w);if(d||t){arrivalDate=d;arrivalTime=t;arrivalSource='ETA/STA';break;}}}
  let status='BOOKED';
  if(/\bDLV\b|\bNFD\b|\bRCF\b|\bARR\b|RECEIVED\s+FROM\s+FLIGHT|ACTUAL\s+ARRIVAL/i.test(flat))status='ARRIVED';
  else if(/\bOFFLOAD(?:ED)?\b|\bDELAY(?:ED)?\b|SHORT\s*SHIP/i.test(flat))status='DELAYED';
  else if(/\bDEP\b|\bDEPARTED\b|IN\s+TRANSIT|AIRBORNE|IN\s+FLIGHT/i.test(flat))status='IN TRANSIT';
  else if(/\bRCS\b|RECEIVED\s+FROM\s+SHIPPER|ACCEPTED|MANIFEST(?:ED)?|BOOKED/i.test(flat))status='BOOKED';
  const useful=Boolean((origin&&destination)||pieces||weight||flightNo||bookingDate||arrivalDate||arrivalTime||status!=='BOOKED');
  return useful?{mawb,carrierCode:'BA',airlineName:'British Airways / IAG Cargo',officialTracker:AIRLINE_URL,origin,destination,bags:pieces,pieces,weight,flightNo,bookingDate,arrivalDate,arrivalTime,arrivalIsActual,status,arrivalSource,source:'IAG Cargo official Track & Trace entry page'}:null;
}

async function pageText(page){let out='';for(const f of page.frames()){try{out+='\n'+await f.evaluate(()=>document.body?.innerText||'');}catch{}}return out;}
async function acceptCookies(page){for(const f of page.frames()){try{await f.evaluate(()=>{const vis=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>20&&r.height>10};const b=[...document.querySelectorAll('button,[role="button"],a')].filter(vis).find(x=>/accept all|accept cookies|allow all|agree/i.test((x.innerText||x.textContent||'').trim()));b?.click();});}catch{}}}
async function fill(page,mawb){const prefix=mawb.slice(0,3),serial=mawb.slice(4);for(const f of page.frames()){try{const r=await f.evaluate(({prefix,serial,mawb})=>{const vis=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>10&&r.height>8&&!e.disabled};const set=(e,v)=>{const d=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');d?.set?.call(e,v);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));};const p=document.querySelector('#awb_cia,input[name="awb_cia"],input[name="awb.cia"]');const n=document.querySelector('#awb_cod,input[name="awb_cod"],input[name="awb.cod"]');if(p&&n){set(p,prefix);set(n,serial);}else{const ins=[...document.querySelectorAll('input')].filter(vis);const one=ins.find(e=>/XXX-YYYYYYYY/i.test(e.placeholder||''))||ins.find(e=>/awb|airway|shipment|tracking/i.test(`${e.id} ${e.name} ${e.placeholder} ${e.getAttribute('aria-label')||''}`));if(!one)return{filled:false};set(one,mawb);}const els=[...document.querySelectorAll('input[type="submit"],input[type="button"],button,a,[role="button"]')].filter(vis);const label=e=>(e.innerText||e.value||e.textContent||'').trim();const b=els.find(e=>/^search$/i.test(label(e))||/^track$/i.test(label(e))||/track\s+shipment/i.test(label(e)));if(b){b.click();return{filled:true,clicked:label(b)};}const form=(n||p)?.form||document.querySelector('form');form?.requestSubmit?.();return{filled:true,clicked:'form'};},{prefix,serial,mawb});if(r?.filled)return{...r,frame:f.url()};}catch{}}return{filled:false};}

export async function trackBritishEntry(input){
  const mawb=normalizeMawb(input);if(!mawb||!mawb.startsWith('125-'))return{ok:false,reason:'INVALID BRITISH AIRWAYS MAWB'};
  let browser;const network=[];
  try{
    const cfg=await browserConfig();browser=await puppeteer.launch({headless:'shell',executablePath:cfg.executablePath,args:cfg.args,defaultViewport:{width:1440,height:1100,deviceScaleFactor:1}});
    const page=await browser.newPage();await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36');await page.setExtraHTTPHeaders({'Accept-Language':'en-GB,en;q=0.9'});await page.evaluateOnNewDocument(()=>{try{Object.defineProperty(navigator,'webdriver',{get:()=>undefined});}catch{}});
    page.on('response',async r=>{try{const u=r.url(),ct=(r.headers()['content-type']||'').toLowerCase();if(!/(json|text|html|xml)/.test(ct)&&!/track|shipment|awb|cargo|event|status|601/i.test(u))return;const b=await r.text();if(!b||b.length>350000)return;if(b.includes(mawb.slice(4))||/RCS|DEP|ARR|RCF|NFD|DLV|shipment|airway|pieces|weight|flight/i.test(b))network.push({url:u,status:r.status(),body:b.slice(0,160000)});}catch{}});
    await page.goto(ENTRY,{waitUntil:'domcontentloaded',timeout:30000});await sleep(2500);await acceptCookies(page);await sleep(500);
    const before=await pageText(page);if(/captcha|verify you are human|security check|cloudflare|turnstile|access denied/i.test(before))return{ok:false,reason:'IAG CARGO SECURITY/CAPTCHA REQUIRES MANUAL CHECK',officialTracker:AIRLINE_URL,debug:{stage:'CAPTCHA'}};
    const setup=await fill(page,mawb);if(!setup.filled)return{ok:false,reason:'IAG CARGO TRACK INPUT WAS NOT FOUND ON ENTRY PAGE',officialTracker:AIRLINE_URL,debug:{stage:'NO_INPUT',pageText:before.slice(0,6000)}};
    await Promise.race([page.waitForNetworkIdle({idleTime:1000,timeout:15000}).catch(()=>{}),sleep(15000)]);await sleep(1500);
    let text=await pageText(page);if(network.length)text+='\nIAG_NETWORK_CAPTURE\n'+network.map(x=>x.body).join('\n');
    const shipment=parseShipment(text,mawb);const screenshotBase64=await page.screenshot({type:'jpeg',quality:68,fullPage:false,encoding:'base64'}).catch(()=>null);
    if(shipment)return{ok:true,shipment,screenshotBase64,officialTracker:AIRLINE_URL,debug:{stage:'SUCCESS',url:page.url(),setup,pageText:text.slice(0,9000),network:network.slice(-12).map(x=>({url:x.url,status:x.status,sample:x.body.slice(0,1400)}))}};
    return{ok:false,reason:/SOMETHING WENT WRONG/i.test(text)?'IAG CARGO ITSELF RETURNED SOMETHING WENT WRONG FOR THIS SEARCH':'IAG CARGO RETURNED NO VERIFIED SHIPMENT FIELDS',officialTracker:AIRLINE_URL,screenshotBase64,debug:{stage:'NO_FIELDS',url:page.url(),setup,pageText:text.slice(0,9000),network:network.slice(-12).map(x=>({url:x.url,status:x.status,sample:x.body.slice(0,1400)}))}};
  }catch(e){return{ok:false,reason:`BA ENTRY TRACKING ERROR: ${e?.message||e}`,officialTracker:AIRLINE_URL,debug:{stage:'ERROR'}};}finally{try{if(browser)await browser.close()}catch{}}
}
