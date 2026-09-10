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

function yearFrom(text=''){return (String(text).match(/\b(20\d{2})\b/)||[])[1]||String(new Date().getFullYear());}
function dateOnly(value='',fallbackYear=''){
  const s=clean(value);let m;
  m=s.match(/\b(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})\b/);if(m)return`${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m=s.match(/\b(\d{1,2})[-\/.](\d{1,2})[-\/.](20\d{2})\b/);if(m)return`${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  m=s.match(/\b(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s,\-]+(20\d{2})\b/i);if(m)return`${m[3]}-${MONTH[m[2].slice(0,3).toUpperCase()]}-${pad(m[1])}`;
  if(fallbackYear){m=s.match(/\b(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\b/i);if(m)return`${fallbackYear}-${MONTH[m[2].slice(0,3).toUpperCase()]}-${pad(m[1])}`;}
  return'';
}
function timeOnly(value=''){
  let m=String(value||'').match(/\b(1[0-2]|0?\d):([0-5]\d)\s*(AM|PM)\b/i);
  if(m){let h=Number(m[1])%12;if(m[3].toUpperCase()==='PM')h+=12;return`${pad(h)}:${m[2]}`;}
  m=String(value||'').match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);return m?`${pad(m[1])}:${m[2]}`:'';
}
function first(text,patterns=[]){for(const rx of patterns){const m=String(text||'').match(rx);if(m?.[1])return clean(m[1]);}return'';}
function near(text='',rx){const flat=clean(text),m=flat.match(rx);if(!m)return{date:'',time:''};const i=m.index||0,w=flat.slice(Math.max(0,i-200),Math.min(flat.length,i+550));return{date:dateOnly(w,yearFrom(flat)),time:timeOnly(w)};}

function parseVirgin(text='',mawb=''){
  const flat=clean(text),upper=flat.toUpperCase();if(!flat)return null;
  if(/NO\s+(?:SHIPMENT|RESULT|RECORD)|NOT\s+FOUND|INVALID\s+(?:AWB|DOCUMENT|DOC)|NO\s+DATA/i.test(flat))return{notFound:true};
  const digits=digitsOnly(mawb),serial=digits.slice(3),all=digitsOnly(flat),year=yearFrom(flat);
  if(!all.includes(digits)&&!all.includes(serial)&&!/TRACKING\s+DETAILS|DOC\.?\s*NO\.?|JRN\s*NO/i.test(flat))return null;

  let origin='',destination='';
  const route=flat.match(/([A-Z][A-Z .'-]{1,50})\s*\(([A-Z]{3})\)\s*(?:[-–—.>]+|→)\s*([A-Z][A-Z .'-]{1,50})\s*\(([A-Z]{3})\)/i);
  if(route){origin=route[2].toUpperCase();destination=route[4].toUpperCase();}
  origin=origin||first(flat,[/\bOrigin\b\s*[:\-]?\s*([A-Z]{3})\b/i,/\bFrom\b\s*[:\-]?\s*([A-Z]{3})\b/i]).toUpperCase();
  destination=destination||first(flat,[/\bDestination\b\s*[:\-]?\s*([A-Z]{3})\b/i,/\bTo\b\s*[:\-]?\s*([A-Z]{3})\b/i]).toUpperCase();

  const pieces=first(flat,[/(?:Pieces?|Pcs?|No\.?\s*of\s*Pieces|Piece Count)\s*[:\-]?\s*(\d{1,6})/i,/\b(\d{1,6})\s*(?:PCS|PIECES?)\b/i]);
  const weight=first(flat,[/(?:Gross\s*Weight|Chargeable\s*Weight|Weight)\s*[:\-]?\s*([\d,.]+)\s*(?:KG|KGS)?/i,/\b([\d,.]+)\s*(?:KG|KGS)\b/i]).replace(/,/g,'');
  const flights=[...upper.matchAll(/\bVS\s*[- ]?(\d{1,4})\b/g)];
  const flightNo=flights.length?`VS${flights.at(-1)[1].padStart(4,'0')}`:'';
  const booking=near(flat,/\b(?:Booking\s*Date|Booked\s*(?:On|At))\b/i),bookingDate=booking.date||'';

  let arrivalDate='',arrivalTime='',arrivalIsActual=false;
  const actual=near(flat,/\b(?:Actual\s+Arrival|Arrived|RCF|Received\s+from\s+Flight|Landed)\b/i);
  if(actual.date||actual.time){arrivalDate=actual.date;arrivalTime=actual.time;arrivalIsActual=true;}
  const eta=near(flat,/\b(?:ETA|Estimated\s+Arrival|Expected\s+Arrival|Scheduled\s+Arrival)\b/i);
  if(!arrivalDate)arrivalDate=eta.date;if(!arrivalTime)arrivalTime=eta.time;
  if((!arrivalDate||!arrivalTime)&&destination){
    const idx=upper.lastIndexOf(destination);if(idx>=0){const w=flat.slice(Math.max(0,idx-300),Math.min(flat.length,idx+360));arrivalDate=arrivalDate||dateOnly(w,year);const times=[...w.matchAll(/\b(1[0-2]|0?\d):([0-5]\d)\s*(AM|PM)\b/ig)];if(!arrivalTime&&times.length){const m=times.at(-1);let h=Number(m[1])%12;if(m[3].toUpperCase()==='PM')h+=12;arrivalTime=`${pad(h)}:${m[2]}`;}}
  }

  let status='BOOKED';
  if(/\bDLV\b|DELIVERED|PROOF\s+OF\s+DELIVERY/.test(upper))status='ARRIVED';
  else if(/\bRCF\b|RECEIVED\s+FROM\s+FLIGHT|\bARRIVED\b|\bLANDED\b|ACTUAL\s+ARRIVAL/.test(upper))status='ARRIVED';
  else if(/DELAY|LATE|OFFLOAD|EXCEPTION/.test(upper))status='DELAYED';
  else if(/\bDEP\b|DEPARTED|IN\s+TRANSIT|AIRBORNE|IN\s+FLIGHT/.test(upper))status='IN TRANSIT';

  if(!((origin&&destination)||pieces||weight||flightNo||bookingDate||arrivalDate||arrivalTime))return null;
  return{shipment:{mawb,carrierCode:'VS',airlineName:'Virgin Atlantic Cargo',officialTracker:URL,origin,destination,bags:pieces,pieces,weight,flightNo,bookingDate,arrivalDate,arrivalTime,arrivalIsActual,status,source:'Virgin Atlantic Cargo Track Cargo → Search → Tracking Details → Show Details'}};
}

async function pageText(page){const out=[];for(const f of page.frames()){try{const t=await f.evaluate(()=>document.body?.innerText||'');if(t)out.push(t);}catch{}}return out.join('\n');}
async function waitForText(page,rx,timeout=20000){const end=Date.now()+timeout;while(Date.now()<end){const t=await pageText(page);if(rx.test(t))return t;await sleep(500);}return pageText(page);}

async function clickText(page,patterns,timeout=9000){
  const end=Date.now()+timeout;
  while(Date.now()<end){for(const frame of page.frames()){try{const hit=await frame.evaluate(srcs=>{const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>4&&r.height>4&&s.display!=='none'&&s.visibility!=='hidden'};const norm=v=>String(v||'').replace(/\s+/g,' ').trim();const regs=srcs.map(s=>new RegExp(s,'i'));const nodes=[...document.querySelectorAll('button,a,[role="button"],input[type="submit"],input[type="button"],div,span')].filter(visible);const hits=nodes.map(e=>({e,t:norm(e.innerText||e.textContent||e.value||e.getAttribute('aria-label')||'')})).filter(x=>regs.some(r=>r.test(x.t))).sort((a,b)=>a.t.length-b.t.length);if(!hits.length)return null;const el=hits[0].e.closest('button,a,[role="button"]')||hits[0].e;el.scrollIntoView({block:'center'});el.click();return hits[0].t;},patterns.map(r=>r.source));if(hit)return hit;}catch{}}await sleep(300);}return'';
}

async function findDocField(page,timeout=15000){
  const end=Date.now()+timeout;
  while(Date.now()<end){for(const frame of page.frames()){try{const hs=await frame.$$('input:not([type="hidden"]):not([type="submit"]):not([type="button"])');for(const h of hs){const m=await h.evaluate(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e),p=e.closest('label,div,section,form,td');return{v:r.width>10&&r.height>8&&s.display!=='none'&&s.visibility!=='hidden'&&!e.disabled&&!e.readOnly,d:`${e.placeholder||''} ${e.name||''} ${e.id||''} ${e.getAttribute('aria-label')||''} ${p?.innerText||''}`.toLowerCase()};}).catch(()=>null);if(m?.v&&/doc\.?\s*no|awb|air\s*waybill|document/.test(m.d))return h;}}catch{}}await sleep(350);}return null;
}

async function typeAndCommitDoc(page,mawb){
  const h=await findDocField(page),digits=digitsOnly(mawb);if(!h)return{ok:false};
  await h.focus();await h.click({clickCount:3}).catch(()=>{});await page.keyboard.down('Control').catch(()=>{});await page.keyboard.press('A').catch(()=>{});await page.keyboard.up('Control').catch(()=>{});await page.keyboard.press('Backspace').catch(()=>{});await h.type(digits,{delay:60});await sleep(350);await page.keyboard.press('Enter').catch(()=>{});await sleep(700);
  const value=await h.evaluate(e=>e.value||'').catch(()=>'');const body=await pageText(page);return{ok:true,value,pressedEnter:true,tokenVisible:digitsOnly(body).includes(digits)};
}

async function clickCommittedSearch(page,mawb,timeout=10000){
  const wanted=digitsOnly(mawb),end=Date.now()+timeout;
  while(Date.now()<end){for(const frame of page.frames()){try{const hit=await frame.evaluate(wanted=>{
    const norm=v=>String(v||'').replace(/\s+/g,' ').trim();const dig=v=>String(v||'').replace(/\D/g,'');const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>4&&r.height>4&&s.display!=='none'&&s.visibility!=='hidden'};
    const exactSearch=root=>[...root.querySelectorAll('button,[role="button"],input[type="submit"],input[type="button"],a')].filter(visible).find(b=>norm(b.innerText||b.textContent||b.value)==='Search');
    const tokens=[...document.querySelectorAll('span,div,li,p')].filter(visible).filter(e=>dig(e.innerText||e.textContent).includes(wanted)&&norm(e.innerText||e.textContent).length<120).sort((a,b)=>norm(a.innerText||a.textContent).length-norm(b.innerText||b.textContent).length);
    for(const token of tokens){let n=token;for(let d=0;n&&d<10;d++,n=n.parentElement){const b=exactSearch(n);if(b){b.scrollIntoView({block:'center'});b.click();return{mode:'TOKEN_CONTAINER',text:'Search'};}}}
    const buttons=[...document.querySelectorAll('button,[role="button"],input[type="submit"],input[type="button"],a')].filter(visible).filter(b=>norm(b.innerText||b.textContent||b.value)==='Search');
    const candidates=[];for(const b of buttons){let n=b;for(let d=0;n&&d<10;d++,n=n.parentElement){const t=norm(n.innerText||n.textContent);if(/Search\s*&\s*Track/i.test(t)){candidates.push({b,len:t.length});break;}}}
    candidates.sort((a,b)=>a.len-b.len);if(candidates.length){candidates[0].b.scrollIntoView({block:'center'});candidates[0].b.click();return{mode:'SEARCH_TRACK_CONTAINER',text:'Search'};}
    return null;
  },wanted);if(hit)return hit;}catch{}}await sleep(300);}return null;
}

export async function trackVirgin(input){
  const mawb=normalizeMawb(input);if(!mawb||!mawb.startsWith('932-'))return{ok:false,reason:'INVALID VIRGIN ATLANTIC MAWB',airline:AIRLINE};
  let browser;const debug={stage:'OPEN',flow:[]};
  try{
    const mod=await import('puppeteer-core'),puppeteer=mod.default||mod,launch=await browserConfig();browser=await puppeteer.launch({...launch,headless:true,defaultViewport:{width:1440,height:1100}});const page=await browser.newPage();await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36');await page.setExtraHTTPHeaders({'Accept-Language':'en-GB,en;q=0.9'});await page.goto(URL,{waitUntil:'domcontentloaded',timeout:30000});await sleep(1600);await clickText(page,[/accept all/i,/accept cookies/i,/agree/i],1600).catch(()=>null);
    const trackCargo=await clickText(page,[/^Track\s+cargo$/i],9000);debug.flow.push({step:'TRACK_CARGO',clicked:Boolean(trackCargo),text:trackCargo});if(!trackCargo)return{ok:false,reason:'VIRGIN ATLANTIC TRACK CARGO TILE NOT FOUND',officialTracker:URL,debug};await sleep(1400);
    const fill=await typeAndCommitDoc(page,mawb);debug.flow.push({step:'DOC_NO',...fill});if(!fill.ok)return{ok:false,reason:'VIRGIN ATLANTIC DOC NO FIELD NOT FOUND',officialTracker:URL,debug};
    const search=await clickCommittedSearch(page,mawb);debug.flow.push({step:'SEARCH',clicked:Boolean(search),...(search||{})});if(!search)return{ok:false,reason:'VIRGIN ATLANTIC SEARCH BUTTON NOT FOUND IN SEARCH & TRACK',officialTracker:URL,debug};
    let text=await waitForText(page,/Tracking\s+Details|Search\s+Results|Booked\s+on\s+Flight|No\s+(?:shipment|result|record)|Not\s+found|Invalid/i,25000);debug.afterSearch=clean(text).slice(0,9000);if(/no\s+(?:shipment|result|record)|not\s+found|invalid\s+(?:awb|document|doc)/i.test(text))return{ok:false,notFound:true,reason:'NOT TRACEABLE ON VIRGIN ATLANTIC CARGO',officialTracker:URL,debug:{...debug,stage:'NO_RECORD'}};
    const details=await clickText(page,[/^Tracking\s+Details$/i],12000);debug.flow.push({step:'TRACKING_DETAILS',clicked:Boolean(details),text:details});if(!details)return{ok:false,reason:'VIRGIN ATLANTIC TRACKING DETAILS BUTTON NOT FOUND',officialTracker:URL,debug:{...debug,stage:'DETAIL_BUTTON_MISSING'}};await sleep(1200);text=await waitForText(page,/Your\s+order\s+is\s+confirmed|Shipment\s+is\s+not\s+ready|Show\s+Details|Flight\s+Details/i,18000);
    const show=await clickText(page,[/^Show\s+Details$/i],10000);debug.flow.push({step:'SHOW_DETAILS',clicked:Boolean(show),text:show});if(show)await sleep(1200);text=await pageText(page);debug.afterShowDetails=clean(text).slice(0,15000);
    const parsed=parseVirgin(text,mawb),screenshotBase64=await page.screenshot({type:'jpeg',quality:68,fullPage:false,encoding:'base64'}).catch(()=>null);if(parsed?.shipment)return{ok:true,shipment:parsed.shipment,officialTracker:URL,screenshotBase64,screenshotCaptured:Boolean(screenshotBase64),screenshotVerified:Boolean(screenshotBase64),debug:{...debug,stage:show?'SHOW_DETAILS_SUCCESS':'TRACKING_DETAILS_SUCCESS',sample:clean(text).slice(0,15000)}};
    return{ok:false,reason:'VIRGIN ATLANTIC TRACKING DETAILS NOT READABLE',officialTracker:URL,screenshotBase64,debug:{...debug,stage:'NO_FIELDS',sample:clean(text).slice(0,15000)}};
  }catch(error){return{ok:false,reason:`VIRGIN ATLANTIC TRACKING ERROR: ${error?.message||error}`,officialTracker:URL,debug:{...debug,stage:'ERROR'}};}finally{try{if(browser)await browser.close();}catch{}}
}
