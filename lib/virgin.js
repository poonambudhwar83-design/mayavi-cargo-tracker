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

function yearFrom(text=''){
  const m=String(text).match(/\b(20\d{2})\b/);
  return m?m[1]:String(new Date().getFullYear());
}
function dateOnly(value='',fallbackYear=''){
  const s=clean(value);let m;
  m=s.match(/\b(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})\b/);if(m)return`${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m=s.match(/\b(\d{1,2})[-\/.](\d{1,2})[-\/.](20\d{2})\b/);if(m)return`${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  m=s.match(/\b(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s,\-]+(20\d{2})\b/i);if(m)return`${m[3]}-${MONTH[m[2].slice(0,3).toUpperCase()]}-${pad(m[1])}`;
  m=s.match(/\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s,\-]+(\d{1,2})[\s,\-]+(20\d{2})\b/i);if(m)return`${m[3]}-${MONTH[m[1].slice(0,3).toUpperCase()]}-${pad(m[2])}`;
  if(fallbackYear){
    m=s.match(/\b(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\b/i);if(m)return`${fallbackYear}-${MONTH[m[2].slice(0,3).toUpperCase()]}-${pad(m[1])}`;
    m=s.match(/\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s,\-]+(\d{1,2})\b/i);if(m)return`${fallbackYear}-${MONTH[m[1].slice(0,3).toUpperCase()]}-${pad(m[2])}`;
  }
  return'';
}
function timeOnly(value=''){
  let m=String(value||'').match(/\b(1[0-2]|0?\d):([0-5]\d)\s*(AM|PM)\b/i);
  if(m){let h=Number(m[1])%12;if(m[3].toUpperCase()==='PM')h+=12;return`${pad(h)}:${m[2]}`;}
  m=String(value||'').match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  return m?`${pad(m[1])}:${m[2]}`:'';
}
function first(text,patterns=[]){
  for(const rx of patterns){const m=String(text||'').match(rx);if(m?.[1])return clean(m[1]);}
  return'';
}
function near(text='',rx){
  const flat=clean(text),m=flat.match(rx);if(!m)return{date:'',time:''};
  const at=m.index||0,w=flat.slice(Math.max(0,at-220),Math.min(flat.length,at+600));
  return{date:dateOnly(w,yearFrom(flat)),time:timeOnly(w)};
}
function esc(value=''){return String(value).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}

function parseVirgin(text='',mawb=''){
  const flat=clean(text),upper=flat.toUpperCase();if(!flat)return null;
  if(/NO\s+(?:SHIPMENT|RESULT|RECORD)|NOT\s+FOUND|INVALID\s+(?:AWB|DOCUMENT|DOC)|NO\s+DATA/i.test(flat))return{notFound:true};
  const digits=digitsOnly(mawb),serial=digits.slice(3),allDigits=digitsOnly(flat),year=yearFrom(flat);
  if(!allDigits.includes(digits)&&!allDigits.includes(serial)&&!/TRACKING\s+DETAILS|DOC\.?\s*NO\.?|JRN\s*NO/i.test(flat))return null;

  let origin='',destination='';
  const route=flat.match(/([A-Z][A-Z .'-]{1,50})\s*\(([A-Z]{3})\)\s*(?:[-–—.>]+|→)\s*([A-Z][A-Z .'-]{1,50})\s*\(([A-Z]{3})\)/i);
  if(route){origin=route[2].toUpperCase();destination=route[4].toUpperCase();}
  if(!origin||!destination){
    const places=[...flat.matchAll(/([A-Z][A-Z .'-]{1,50})\s*\(([A-Z]{3})\)/ig)].filter(m=>!/HOUR|MINUTE|STOP/i.test(m[1]));
    if(places.length>=2){origin=origin||places[0][2].toUpperCase();destination=destination||places[1][2].toUpperCase();}
  }
  origin=origin||first(flat,[/\bOrigin\b\s*[:\-]?\s*([A-Z]{3})\b/i]).toUpperCase();
  destination=destination||first(flat,[/\bDestination\b\s*[:\-]?\s*([A-Z]{3})\b/i]).toUpperCase();

  // IMPORTANT: read the explicit expanded summary first: "Pieces 22".
  // Do not use a loose "number + Pieces" match because dates such as "Sep 2026 Pieces 22"
  // can otherwise make the year 2026 look like the piece count.
  let pieces=first(flat,[/\bPieces?\s*[:\-]?\s*(\d{1,6})\b/i,/(?:Total Pieces|Piece Count|No\.?\s*of\s*Pieces)\s*[:\-]?\s*(\d{1,6})\b/i]);
  if(!pieces){const pw=flat.match(/\b(\d{1,6})\s+Pieces?\s+[\d,.]+\s*(?:K|KG|KGS)\b/i);if(pw)pieces=pw[1];}

  let weight=first(flat,[/\bGross\s*Weight\s*[:\-]?\s*([\d,.]+)\s*(?:K|KG|KGS|KILO(?:GRAM)?S?)?\b/i,/(?:Chargeable\s*Weight|Weight)\s*[:\-]?\s*([\d,.]+)\s*(?:KG|KGS|KILO(?:GRAM)?S?)?\b/i]).replace(/,/g,'');
  if(!weight){const pw=flat.match(/\b\d{1,6}\s+Pieces?\s+([\d,.]+)\s*(?:K|KG|KGS)\b/i);if(pw)weight=pw[1].replace(/,/g,'');}

  let bookingDate='';
  const bkd=flat.match(/\bBKD\b[^,]*,\s*\d{1,2}:\d{2}\s*(?:AM|PM)\s*,\s*([A-Za-z]{3}\s+\d{1,2}\s*,\s*20\d{2})/i);
  if(bkd)bookingDate=dateOnly(bkd[1],year);
  if(!bookingDate){const booking=near(flat,/\bBooking\s*Date\b/i);bookingDate=booking.date||'';}

  let arrivalDate='',arrivalTime='',arrivalIsActual=false;
  if(destination){
    const arrRx=new RegExp(`\\bARR\\s+${esc(destination)}\\s*,\\s*(\\d{1,2}:\\d{2}\\s*(?:AM|PM))\\s*,\\s*([A-Za-z]{3}\\s+\\d{1,2}\\s*,\\s*20\\d{2})`,'i');
    const arr=flat.match(arrRx);
    if(arr){arrivalTime=timeOnly(arr[1]);arrivalDate=dateOnly(arr[2],year);arrivalIsActual=true;}
  }
  if(!arrivalIsActual){
    const expected=flat.match(/Expected\s+to\s+arrive\s+at\s+[A-Z]{3}\s+on\s+[^,]*,\s*(\d{1,2}\s+[A-Za-z]{3}\s+20\d{2})\s+(\d{1,2}:\d{2})/i);
    if(expected){arrivalDate=dateOnly(expected[1],year);arrivalTime=timeOnly(expected[2]);}
  }
  if(!arrivalDate||!arrivalTime){
    const eta=near(flat,/\b(?:ETA|Estimated\s+Arrival|Expected\s+Arrival|Scheduled\s+Arrival)\b/i);
    if(!arrivalDate)arrivalDate=eta.date;if(!arrivalTime)arrivalTime=eta.time;
  }

  let flightNo='';
  if(destination){
    const destEsc=esc(destination);
    const arrFlight=new RegExp(`Arrived\\s+at\\s+${destEsc}\\s+on\\s+Flight\\s+VS[- ]?(\\d{1,4})`,'i');
    const am=flat.match(arrFlight);if(am)flightNo=`VS${am[1].padStart(4,'0')}`;
    if(!flightNo){const bookedFinal=new RegExp(`Booked\\s+on\\s+Flight\\s+VS[- ]?(\\d{1,4})[^.]{0,160}[-–—]${destEsc}\\b`,'i');const bm=flat.match(bookedFinal);if(bm)flightNo=`VS${bm[1].padStart(4,'0')}`;}
  }
  if(!flightNo){const flights=[...upper.matchAll(/\bVS\s*[- ]?(\d{1,4})\b/g)];if(flights.length)flightNo=`VS${flights.at(-1)[1].padStart(4,'0')}`;}

  let status='BOOKED';
  if(/\bDLV\b|\bDELIVERED\b|PROOF\s+OF\s+DELIVERY/.test(upper))status='ARRIVED';
  else if(destination&&new RegExp(`\\bARR\\s+${esc(destination)}\\b`,'i').test(flat))status='ARRIVED';
  else if(/\bDELAY(?:ED)?\b|\bLATE\b|\bOFFLOAD(?:ED)?\b|\bEXCEPTION\b/.test(upper))status='DELAYED';
  else if(/\bDEP\b|\bDEPARTED\b|\bIN\s+TRANSIT\b|\bAIRBORNE\b|\bIN\s+FLIGHT\b/.test(upper))status='IN TRANSIT';

  const useful=Boolean((origin&&destination)||pieces||weight||flightNo||bookingDate||arrivalDate||arrivalTime);
  if(!useful)return null;
  return{shipment:{mawb,carrierCode:'VS',airlineName:'Virgin Atlantic Cargo',officialTracker:URL,origin,destination,bags:pieces,pieces,weight,flightNo,bookingDate,arrivalDate,arrivalTime,arrivalIsActual,status,source:'Virgin Atlantic Cargo Track Cargo → Search → Tracking Details → Show Details'}};
}

async function pageText(page){
  const parts=[];for(const frame of page.frames()){try{const t=await frame.evaluate(()=>document.body?.innerText||'');if(t)parts.push(t);}catch{}}
  return parts.join('\n');
}
async function waitForText(page,rx,timeout=20000){
  const end=Date.now()+timeout;while(Date.now()<end){const t=await pageText(page);if(rx.test(t))return t;await sleep(500);}return pageText(page);
}
async function clickText(page,patterns,timeout=9000){
  const end=Date.now()+timeout;
  while(Date.now()<end){
    for(const frame of page.frames()){
      try{
        const hit=await frame.evaluate(srcs=>{
          const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>4&&r.height>4&&s.display!=='none'&&s.visibility!=='hidden'};
          const norm=v=>String(v||'').replace(/\s+/g,' ').trim();
          const regs=srcs.map(s=>new RegExp(s,'i'));
          const nodes=[...document.querySelectorAll('button,a,[role="button"],input[type="submit"],input[type="button"],div,span')].filter(visible);
          const hits=nodes.map(e=>({e,t:norm(e.innerText||e.textContent||e.value||e.getAttribute('aria-label')||'')})).filter(x=>regs.some(r=>r.test(x.t))).sort((a,b)=>a.t.length-b.t.length);
          if(!hits.length)return null;
          const el=hits[0].e.closest('button,a,[role="button"]')||hits[0].e;el.scrollIntoView({block:'center'});el.click();return hits[0].t;
        },patterns.map(r=>r.source));
        if(hit)return hit;
      }catch{}
    }
    await sleep(300);
  }
  return'';
}
async function clickExactReal(page,label,timeout=12000,allowAny=false){
  const end=Date.now()+timeout,selector=allowAny?'button,a,[role="button"],input[type="submit"],input[type="button"],div,span':'button,a,[role="button"],input[type="submit"],input[type="button"]';
  while(Date.now()<end){
    for(const frame of page.frames()){
      try{
        const handles=await frame.$$(selector),hits=[];
        for(const h of handles){
          const meta=await h.evaluate((e,wanted)=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e),t=String(e.innerText||e.textContent||e.value||e.getAttribute('aria-label')||'').replace(/\s+/g,' ').trim();return{visible:r.width>4&&r.height>4&&s.display!=='none'&&s.visibility!=='hidden',exact:t.toLowerCase()===wanted.toLowerCase(),text:t,href:e.href||e.closest('a')?.href||'',tag:e.tagName};},label).catch(()=>null);
          if(meta?.visible&&meta.exact)hits.push({h,meta});
        }
        if(hits.length){hits.sort((a,b)=>((a.meta.tag==='BUTTON'||a.meta.tag==='A')?0:1)-((b.meta.tag==='BUTTON'||b.meta.tag==='A')?0:1));const pick=hits[0];await pick.h.evaluate(e=>e.scrollIntoView({block:'center'})).catch(()=>{});await sleep(120);await pick.h.click({delay:80});return pick.meta;}
      }catch{}
    }
    await sleep(300);
  }
  return null;
}
async function waitForDetailNavigation(page,beforeUrl,timeout=20000){
  const end=Date.now()+timeout;
  while(Date.now()<end){const url=page.url(),text=await pageText(page);if((url!==beforeUrl&&(/\/shipments\/list\//i.test(url)||/openedTab=tracking-details/i.test(url)))||/Your\s+order\s+is\s+confirmed|Shipment\s+is\s+not\s+ready\s+for\s+Movement|Flight\s+Details/i.test(text))return{ok:true,url,text};await sleep(500);}
  return{ok:false,url:page.url(),text:await pageText(page)};
}
async function findDocField(page,timeout=15000){
  const end=Date.now()+timeout;
  while(Date.now()<end){
    for(const frame of page.frames()){
      try{
        for(const h of await frame.$$('input:not([type="hidden"]):not([type="submit"]):not([type="button"])')){
          const m=await h.evaluate(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e),p=e.closest('label,div,section,form,td');return{visible:r.width>10&&r.height>8&&s.display!=='none'&&s.visibility!=='hidden'&&!e.disabled&&!e.readOnly,desc:`${e.placeholder||''} ${e.name||''} ${e.id||''} ${e.getAttribute('aria-label')||''} ${p?.innerText||''}`.toLowerCase()};}).catch(()=>null);
          if(m?.visible&&/doc\.?\s*no|awb|air\s*waybill|document/.test(m.desc))return h;
        }
      }catch{}
    }
    await sleep(350);
  }
  return null;
}
async function typeAndCommitDoc(page,mawb){
  const h=await findDocField(page),digits=digitsOnly(mawb);if(!h)return{ok:false};
  await h.focus();await h.click({clickCount:3}).catch(()=>{});await page.keyboard.down('Control').catch(()=>{});await page.keyboard.press('A').catch(()=>{});await page.keyboard.up('Control').catch(()=>{});await page.keyboard.press('Backspace').catch(()=>{});await h.type(digits,{delay:60});await sleep(350);await page.keyboard.press('Enter').catch(()=>{});await sleep(700);
  const value=await h.evaluate(e=>e.value||'').catch(()=>''),body=await pageText(page);
  return{ok:true,value,pressedEnter:true,tokenVisible:digitsOnly(body).includes(digits)};
}
async function clickCommittedSearch(page,mawb,timeout=10000){
  const wanted=digitsOnly(mawb),end=Date.now()+timeout;
  while(Date.now()<end){
    for(const frame of page.frames()){
      try{
        const hit=await frame.evaluate(wanted=>{
          const norm=v=>String(v||'').replace(/\s+/g,' ').trim(),dig=v=>String(v||'').replace(/\D/g,''),visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>4&&r.height>4&&s.display!=='none'&&s.visibility!=='hidden'};
          const findSearch=root=>[...root.querySelectorAll('button,[role="button"],input[type="submit"],input[type="button"],a')].filter(visible).find(b=>norm(b.innerText||b.textContent||b.value)==='Search');
          const tokens=[...document.querySelectorAll('span,div,li,p')].filter(visible).filter(e=>dig(e.innerText||e.textContent).includes(wanted)&&norm(e.innerText||e.textContent).length<120).sort((a,b)=>norm(a.innerText||a.textContent).length-norm(b.innerText||b.textContent).length);
          for(const token of tokens){let node=token;for(let d=0;node&&d<10;d++,node=node.parentElement){const button=findSearch(node);if(button){button.scrollIntoView({block:'center'});button.click();return{mode:'TOKEN_CONTAINER',text:'Search'};}}}
          return null;
        },wanted);
        if(hit)return hit;
      }catch{}
    }
    await sleep(300);
  }
  return null;
}

export async function trackVirgin(input){
  const mawb=normalizeMawb(input);if(!mawb||!mawb.startsWith('932-'))return{ok:false,reason:'INVALID VIRGIN ATLANTIC MAWB',airline:AIRLINE};
  let browser;const debug={stage:'OPEN',flow:[]};
  try{
    const mod=await import('puppeteer-core'),puppeteer=mod.default||mod,launch=await browserConfig();
    browser=await puppeteer.launch({...launch,headless:true,defaultViewport:{width:1440,height:1100}});
    let page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36');
    await page.setExtraHTTPHeaders({'Accept-Language':'en-GB,en;q=0.9'});
    await page.goto(URL,{waitUntil:'domcontentloaded',timeout:30000});await sleep(1600);
    await clickText(page,[/accept all/i,/accept cookies/i,/agree/i],1600).catch(()=>null);

    const track=await clickText(page,[/^Track\s+cargo$/i],9000);debug.flow.push({step:'TRACK_CARGO',clicked:Boolean(track),text:track});
    if(!track)return{ok:false,reason:'VIRGIN ATLANTIC TRACK CARGO TILE NOT FOUND',officialTracker:URL,debug};
    await sleep(1400);

    const fill=await typeAndCommitDoc(page,mawb);debug.flow.push({step:'DOC_NO',...fill});
    if(!fill.ok)return{ok:false,reason:'VIRGIN ATLANTIC DOC NO FIELD NOT FOUND',officialTracker:URL,debug};

    const search=await clickCommittedSearch(page,mawb);debug.flow.push({step:'SEARCH',clicked:Boolean(search),...(search||{})});
    if(!search)return{ok:false,reason:'VIRGIN ATLANTIC SEARCH BUTTON NOT FOUND IN SEARCH & TRACK',officialTracker:URL,debug};

    let text=await waitForText(page,/Tracking\s+Details|Search\s+Results|Booked\s+on\s+Flight|Ready\s+for\s+Carriage|No\s+(?:shipment|result|record)|Not\s+found|Invalid/i,25000);
    debug.afterSearch=clean(text).slice(0,9000);
    if(/no\s+(?:shipment|result|record)|not\s+found|invalid\s+(?:awb|document|doc)/i.test(text))return{ok:false,notFound:true,reason:'NOT TRACEABLE ON VIRGIN ATLANTIC CARGO',officialTracker:URL,debug:{...debug,stage:'NO_RECORD'}};

    const beforeUrl=page.url(),details=await clickExactReal(page,'Tracking Details',12000);debug.flow.push({step:'TRACKING_DETAILS',clicked:Boolean(details),text:details?.text||'',href:details?.href||'',tag:details?.tag||''});
    if(!details)return{ok:false,reason:'VIRGIN ATLANTIC TRACKING DETAILS BUTTON NOT FOUND',officialTracker:URL,debug:{...debug,stage:'DETAIL_BUTTON_MISSING'}};
    await sleep(500);const pages=await browser.pages();if(pages.length>1)page=pages.at(-1);
    const nav=await waitForDetailNavigation(page,beforeUrl,20000);debug.detailUrl=nav.url;debug.afterTrackingDetails=clean(nav.text).slice(0,13000);
    if(!nav.ok)return{ok:false,reason:'VIRGIN ATLANTIC TRACKING DETAILS PAGE DID NOT OPEN',officialTracker:URL,debug:{...debug,stage:'DETAIL_NAVIGATION_FAILED'}};
    text=nav.text;

    const show=await clickExactReal(page,'Show Details',7000,true);debug.flow.push({step:'SHOW_DETAILS',clicked:Boolean(show),text:show?.text||'',href:show?.href||'',tag:show?.tag||''});
    if(show){const before=clean(text).length,end=Date.now()+7000;while(Date.now()<end){const newer=await pageText(page);text=newer;if(clean(newer).length>before+40||/Pieces|Gross\s*Weight|Commodity|Dimensions|Volume/i.test(newer))break;await sleep(450);}}
    else text=await pageText(page);
    debug.afterShowDetails=clean(text).slice(0,18000);

    const parsed=parseVirgin(text,mawb),screenshotBase64=await page.screenshot({type:'jpeg',quality:68,fullPage:false,encoding:'base64'}).catch(()=>null);
    if(parsed?.shipment)return{ok:true,shipment:parsed.shipment,officialTracker:URL,screenshotBase64,screenshotCaptured:Boolean(screenshotBase64),screenshotVerified:Boolean(screenshotBase64),debug:{...debug,stage:show?'SHOW_DETAILS_SUCCESS':'TRACKING_DETAILS_SUCCESS',detailSample:clean(text).slice(0,18000)}};
    return{ok:false,reason:'VIRGIN ATLANTIC TRACKING DETAILS NOT READABLE',officialTracker:URL,screenshotBase64,debug:{...debug,stage:'NO_FIELDS',detailSample:clean(text).slice(0,18000)}};
  }catch(error){
    return{ok:false,reason:`VIRGIN ATLANTIC TRACKING ERROR: ${error?.message||error}`,officialTracker:URL,debug:{...debug,stage:'ERROR'}};
  }finally{try{if(browser)await browser.close();}catch{}}
}
