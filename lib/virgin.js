import fs from 'node:fs';
import { normalizeMawb } from './airlines.js';

const URL='https://www.virginatlanticcargo.com/';
const AIRLINE={name:'Virgin Atlantic Cargo',iata:'VS',url:URL};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clean=v=>String(v||'').replace(/\s+/g,' ').trim();
const digitsOnly=v=>String(v||'').replace(/\D/g,'');
const MONTH={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
const pad=v=>String(v).padStart(2,'0');

async function browserConfig(){
  for(const p of [process.env.CHROME_EXECUTABLE_PATH,'/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome','/usr/bin/google-chrome-stable'].filter(Boolean)){
    if(fs.existsSync(p))return{executablePath:p,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote']};
  }
  const mod=await import('@sparticuz/chromium');
  const chromium=mod.default||mod;
  return{executablePath:await chromium.executablePath(),args:chromium.args};
}
function dateOnly(value=''){
  const s=clean(value);let m;
  m=s.match(/\b(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})\b/);if(m)return`${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m=s.match(/\b(\d{1,2})[-\/.](\d{1,2})[-\/.](20\d{2})\b/);if(m)return`${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  m=s.match(/\b(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s,\-]+(20\d{2})\b/i);if(m)return`${m[3]}-${MONTH[m[2].slice(0,3).toUpperCase()]}-${pad(m[1])}`;
  m=s.match(/\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s+(\d{1,2})[\s,\-]+(20\d{2})\b/i);if(m)return`${m[3]}-${MONTH[m[1].slice(0,3).toUpperCase()]}-${pad(m[2])}`;
  return'';
}
function timeOnly(value=''){const m=String(value||'').match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);return m?`${pad(m[1])}:${m[2]}`:'';}
function first(text,patterns=[]){for(const rx of patterns){const m=String(text||'').match(rx);if(m?.[1])return clean(m[1]);}return'';}
function near(text='',rx){const flat=clean(text),m=flat.match(rx);if(!m)return{date:'',time:''};const at=m.index||0,w=flat.slice(Math.max(0,at-180),Math.min(flat.length,at+420));return{date:dateOnly(w),time:timeOnly(w)};}
function parseVirgin(text='',mawb=''){
  const flat=clean(text),upper=flat.toUpperCase();if(!flat)return null;
  if(/NO\s+(?:SHIPMENT|RESULT|RECORD)|NOT\s+FOUND|INVALID\s+(?:AWB|DOCUMENT|DOC)|NO\s+DATA/i.test(flat))return{notFound:true};
  const digits=digitsOnly(mawb),serial=digits.slice(3),allDigits=digitsOnly(flat);
  if(!allDigits.includes(digits)&&!allDigits.includes(serial)&&!/TRACKING\s+DETAILS|SEARCH\s+RESULTS|DOC\.?\s*NO\.?|JRN\s*NO/i.test(flat))return null;
  let origin=first(flat,[/\bOrigin\b\s*[:\-]?\s*([A-Z]{3})\b/i,/\bFrom\b\s*[:\-]?\s*([A-Z]{3})\b/i]);
  let destination=first(flat,[/\bDestination\b\s*[:\-]?\s*([A-Z]{3})\b/i,/\bTo\b\s*[:\-]?\s*([A-Z]{3})\b/i]);
  const route=flat.match(/\b([A-Z]{3})\s*(?:→|->|–|—|-)\s*([A-Z]{3})\b/);if(route){origin=origin||route[1];destination=destination||route[2];}
  origin=origin.toUpperCase();destination=destination.toUpperCase();
  const pieces=first(flat,[/(?:Pieces?|Pcs?|No\.?\s*of\s*Pieces|Piece Count)\s*[:\-]?\s*(\d{1,6})/i,/\b(\d{1,6})\s*(?:PCS|PIECES?)\b/i]);
  const weight=first(flat,[/(?:Gross\s*Weight|Chargeable\s*Weight|Weight)\s*[:\-]?\s*([\d,.]+)\s*(?:KG|KGS)?/i,/\b([\d,.]+)\s*(?:KG|KGS)\b/i]).replace(/,/g,'');
  const fm=upper.match(/\bVS\s*[- ]?(\d{1,4})\b/),flightNo=fm?`VS${fm[1].padStart(4,'0')}`:'';
  const booked=near(flat,/\bBooked(?:\s+on\s+Flight)?\b/i),accepted=near(flat,/\b(?:RCS|Accepted|Received\s+from\s+Shipper)\b/i);
  const bookingDate=booked.date||accepted.date||'';
  const actual=near(flat,/\b(?:Actual\s+Arrival|Arrived|RCF|Received\s+from\s+Flight|Landed)\b/i),estimated=near(flat,/\b(?:ETA|Estimated\s+Arrival|Expected\s+Arrival|Scheduled\s+Arrival)\b/i);
  const arrivalDate=actual.date||estimated.date||'',arrivalTime=actual.time||estimated.time||'',arrivalIsActual=Boolean(actual.date||actual.time);
  let status='BOOKED';
  if(/\bDLV\b|DELIVERED|PROOF\s+OF\s+DELIVERY/.test(upper))status='ARRIVED';
  else if(/\bRCF\b|RECEIVED\s+FROM\s+FLIGHT|\bARRIVED\b|\bLANDED\b|ACTUAL\s+ARRIVAL/.test(upper))status='ARRIVED';
  else if(/DELAY|LATE|OFFLOAD|EXCEPTION/.test(upper))status='DELAYED';
  else if(/\bDEP\b|DEPARTED|IN\s+TRANSIT|AIRBORNE|IN\s+FLIGHT/.test(upper))status='IN TRANSIT';
  const useful=Boolean((origin&&destination)||pieces||weight||flightNo||bookingDate||arrivalDate||arrivalTime||status!=='BOOKED');
  if(!useful)return null;
  return{shipment:{mawb,carrierCode:'VS',airlineName:'Virgin Atlantic Cargo',officialTracker:URL,origin,destination,bags:pieces,pieces,weight,flightNo,bookingDate,arrivalDate,arrivalTime,arrivalIsActual,status,source:'Virgin Atlantic Cargo Track Cargo → Tracking Details'}};
}
async function pageText(page){const p=[];for(const f of page.frames()){try{const t=await f.evaluate(()=>document.body?.innerText||'');if(t)p.push(t);}catch{}}return p.join('\n');}
async function clickText(page,patterns,timeout=9000){
  const end=Date.now()+timeout;
  while(Date.now()<end){
    for(const frame of page.frames()){
      try{
        const hit=await frame.evaluate(srcs=>{const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>4&&r.height>4&&s.display!=='none'&&s.visibility!=='hidden'};const norm=v=>String(v||'').replace(/\s+/g,' ').trim();const regs=srcs.map(s=>new RegExp(s,'i'));const nodes=[...document.querySelectorAll('button,a,[role="button"],input[type="submit"],input[type="button"],div,span')].filter(visible);const matches=nodes.map(e=>({e,t:norm(e.innerText||e.textContent||e.value||e.getAttribute('aria-label')||'')})).filter(x=>regs.some(r=>r.test(x.t)));if(!matches.length)return null;matches.sort((a,b)=>a.t.length-b.t.length);const leaf=matches[0].e,clickable=leaf.closest('button,a,[role="button"]')||leaf;clickable.scrollIntoView({block:'center',behavior:'auto'});clickable.click();return matches[0].t;},patterns.map(r=>r.source));
        if(hit)return hit;
      }catch{}
    }
    await sleep(300);
  }
  return'';
}
async function findDocField(page){
  for(const frame of page.frames()){
    try{
      const handles=await frame.$$('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"])');
      const c=[];
      for(const h of handles){try{const m=await h.evaluate(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e),d=`${e.placeholder||''} ${e.name||''} ${e.id||''} ${e.getAttribute('aria-label')||''} ${e.title||''} ${e.labels?.[0]?.innerText||''}`.toLowerCase();return{visible:r.width>10&&r.height>8&&s.display!=='none'&&s.visibility!=='hidden'&&!e.disabled&&!e.readOnly,d,max:e.maxLength||-1};});if(m.visible)c.push({h,m});}catch{}}
      const single=c.find(x=>/doc\.?\s*no|document|awb|airway|track/.test(x.m.d)&&!/prefix/.test(x.m.d));if(single)return{frame,handle:single.h,mode:'doc-no'};
      const prefix=c.find(x=>/prefix/.test(x.m.d)||x.m.max===3),number=c.find(x=>x!==prefix&&(/awb|document|number/.test(x.m.d)||x.m.max===8));if(prefix&&number)return{frame,prefix:prefix.h,handle:number.h,mode:'split'};
    }catch{}
  }
  return null;
}
async function typeDocNo(page,mawb){
  const digits=digitsOnly(mawb),prefix=digits.slice(0,3),serial=digits.slice(3),field=await findDocField(page);if(!field)return{ok:false};
  const type=async(h,v)=>{await h.click({clickCount:3}).catch(()=>{});await h.focus();await page.keyboard.down('Control').catch(()=>{});await page.keyboard.press('A').catch(()=>{});await page.keyboard.up('Control').catch(()=>{});await page.keyboard.press('Backspace').catch(()=>{});await h.type(v,{delay:55});};
  if(field.mode==='split'){await type(field.prefix,prefix);await type(field.handle,serial);}else await type(field.handle,digits);
  await field.handle.focus();await page.keyboard.press('Enter');await sleep(800);
  return{ok:true,mode:field.mode,value:await field.handle.evaluate(e=>e.value||'').catch(()=>''),pressedEnter:true};
}
async function waitForResult(page,timeout=22000){const end=Date.now()+timeout;while(Date.now()<end){const t=await pageText(page);if(/Search Results|Tracking Details|Booked on Flight|No shipment|No result|Not found|Invalid/i.test(t))return t;await sleep(500);}return pageText(page);}

export async function trackVirgin(input){
  const mawb=normalizeMawb(input);if(!mawb||!mawb.startsWith('932-'))return{ok:false,reason:'INVALID VIRGIN ATLANTIC MAWB',airline:AIRLINE};
  let browser;const debug={stage:'OPEN',flow:[]};
  try{
    const mod=await import('puppeteer-core'),puppeteer=mod.default||mod,launch=await browserConfig();browser=await puppeteer.launch({...launch,headless:true,defaultViewport:{width:1440,height:1100,deviceScaleFactor:1}});
    const page=await browser.newPage();await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36');await page.setExtraHTTPHeaders({'Accept-Language':'en-GB,en;q=0.9'});await page.goto(URL,{waitUntil:'domcontentloaded',timeout:30000});await sleep(1600);
    await clickText(page,[/accept all/i,/accept cookies/i,/agree/i],1600).catch(()=>null);
    const trackCargo=await clickText(page,[/^Track Cargo$/i,/Track\s+Cargo/i,/Track\s+and\s+trace/i],7000);debug.flow.push({step:'TRACK_CARGO',clicked:Boolean(trackCargo),text:trackCargo});if(trackCargo){await sleep(1300);}
    const fill=await typeDocNo(page,mawb);debug.flow.push({step:'DOC_NO',...fill});if(!fill.ok)return{ok:false,reason:'VIRGIN ATLANTIC DOC NO FIELD NOT FOUND',officialTracker:URL,debug};
    const search=await clickText(page,[/^Search$/i,/^Track$/i],7000);debug.flow.push({step:'SEARCH',clicked:Boolean(search),text:search});if(!search)return{ok:false,reason:'VIRGIN ATLANTIC SEARCH BUTTON NOT FOUND',officialTracker:URL,debug};
    let text=await waitForResult(page,22000);debug.afterSearch=clean(text).slice(0,5000);
    if(/no\s+(?:shipment|result|record)|not\s+found|invalid\s+(?:awb|document|doc)/i.test(text))return{ok:false,notFound:true,reason:'NOT TRACEABLE ON VIRGIN ATLANTIC CARGO',officialTracker:URL,debug:{...debug,stage:'NO_RECORD'}};
    const details=await clickText(page,[/^Tracking Details$/i,/Tracking\s+Details/i],9000);debug.flow.push({step:'TRACKING_DETAILS',clicked:Boolean(details),text:details});if(details){await sleep(1200);text=await waitForResult(page,10000);}else{text=await pageText(page);}
    const parsed=parseVirgin(text,mawb);const screenshotBase64=await page.screenshot({type:'jpeg',quality:68,fullPage:false,encoding:'base64'}).catch(()=>null);
    if(parsed?.notFound)return{ok:false,notFound:true,reason:'NOT TRACEABLE ON VIRGIN ATLANTIC CARGO',officialTracker:URL,screenshotBase64,debug:{...debug,stage:'NO_RECORD_AFTER_DETAILS'}};
    if(parsed?.shipment)return{ok:true,shipment:parsed.shipment,officialTracker:URL,screenshotBase64,screenshotCaptured:Boolean(screenshotBase64),screenshotVerified:Boolean(screenshotBase64),debug:{...debug,stage:details?'TRACKING_DETAILS_SUCCESS':'SEARCH_RESULT_SUCCESS',sample:clean(text).slice(0,10000)}};
    return{ok:false,reason:'VIRGIN ATLANTIC TRACKING DETAILS NOT READABLE',officialTracker:URL,screenshotBase64,screenshotCaptured:Boolean(screenshotBase64),debug:{...debug,stage:'NO_FIELDS',sample:clean(text).slice(0,10000)}};
  }catch(error){return{ok:false,reason:`VIRGIN ATLANTIC TRACKING ERROR: ${error?.message||error}`,officialTracker:URL,debug:{...debug,stage:'ERROR'}};}
  finally{try{if(browser)await browser.close();}catch{}}
}
