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
function timeOnly(value=''){
  const m=String(value||'').match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);return m?`${pad(m[1])}:${m[2]}`:'';
}
function first(text,patterns=[]){for(const rx of patterns){const m=String(text||'').match(rx);if(m?.[1])return clean(m[1]);}return'';}
function nearestDateTime(text='',anchorRx){
  const flat=clean(text),m=flat.match(anchorRx);if(!m)return{date:'',time:''};
  const at=m.index||0,window=flat.slice(Math.max(0,at-180),Math.min(flat.length,at+360));
  return{date:dateOnly(window),time:timeOnly(window)};
}
function parseVirgin(text='',mawb=''){
  const flat=clean(text),upper=flat.toUpperCase();
  if(!flat)return null;
  if(/NO\s+(?:SHIPMENT|RESULT|RECORD)|NOT\s+FOUND|INVALID\s+(?:AWB|DOCUMENT|DOC)|NO\s+DATA/i.test(flat))return{notFound:true};
  const digits=digitsOnly(mawb),serial=digits.slice(3);
  if(!digitsOnly(flat).includes(digits)&&!digitsOnly(flat).includes(serial)&&!/TRACKING\s+DETAILS|DOC\.?\s*NO\.?|JRN\s*NO/i.test(flat))return null;

  let origin=first(flat,[/\bOrigin\b\s*[:\-]?\s*([A-Z]{3})\b/i,/\bFrom\b\s*[:\-]?\s*([A-Z]{3})\b/i]);
  let destination=first(flat,[/\bDestination\b\s*[:\-]?\s*([A-Z]{3})\b/i,/\bTo\b\s*[:\-]?\s*([A-Z]{3})\b/i]);
  const route=flat.match(/\b([A-Z]{3})\s*(?:→|->|–|—|-)\s*([A-Z]{3})\b/);
  if(route){origin=origin||route[1];destination=destination||route[2];}
  origin=origin.toUpperCase();destination=destination.toUpperCase();

  const pieces=first(flat,[/(?:Pieces?|Pcs?|No\.?\s*of\s*Pieces|Piece Count)\s*[:\-]?\s*(\d{1,6})/i,/\b(\d{1,6})\s*(?:PCS|PIECES?)\b/i]);
  const weight=first(flat,[/(?:Gross\s*Weight|Chargeable\s*Weight|Weight)\s*[:\-]?\s*([\d,.]+)\s*(?:KG|KGS)?/i,/\b([\d,.]+)\s*(?:KG|KGS)\b/i]).replace(/,/g,'');
  const flightMatch=upper.match(/\bVS\s*[- ]?(\d{1,4})\b/);
  const flightNo=flightMatch?`VS${flightMatch[1].padStart(4,'0')}`:'';

  const booked=nearestDateTime(flat,/\bBooked(?:\s+on\s+Flight)?\b/i);
  const accepted=nearestDateTime(flat,/\b(?:RCS|Accepted|Received\s+from\s+Shipper)\b/i);
  const bookingDate=booked.date||accepted.date||'';

  const actual=nearestDateTime(flat,/\b(?:Actual\s+Arrival|Arrived|RCF|Received\s+from\s+Flight|Landed)\b/i);
  const estimated=nearestDateTime(flat,/\b(?:ETA|Estimated\s+Arrival|Expected\s+Arrival|Scheduled\s+Arrival)\b/i);
  const arrivalDate=actual.date||estimated.date||'';
  const arrivalTime=actual.time||estimated.time||'';
  const arrivalIsActual=Boolean(actual.date||actual.time);

  let status='BOOKED';
  if(/\bDLV\b|DELIVERED|POD|PROOF\s+OF\s+DELIVERY/.test(upper))status='ARRIVED';
  else if(/\bRCF\b|RECEIVED\s+FROM\s+FLIGHT|\bARRIVED\b|\bLANDED\b|ACTUAL\s+ARRIVAL/.test(upper))status='ARRIVED';
  else if(/DELAY|LATE|OFFLOAD|EXCEPTION/.test(upper))status='DELAYED';
  else if(/\bDEP\b|DEPARTED|IN\s+TRANSIT|AIRBORNE|IN\s+FLIGHT/.test(upper))status='IN TRANSIT';

  const useful=Boolean((origin&&destination)||pieces||weight||flightNo||bookingDate||arrivalDate||arrivalTime||status!=='BOOKED');
  if(!useful)return null;
  return{shipment:{mawb,carrierCode:'VS',airlineName:'Virgin Atlantic Cargo',officialTracker:URL,origin,destination,bags:pieces,pieces,weight,flightNo,bookingDate,arrivalDate,arrivalTime,arrivalIsActual,status,source:'Virgin Atlantic Cargo Track Cargo → Tracking Details'}};
}

async function pageText(page){
  const parts=[];for(const frame of page.frames()){try{const t=await frame.evaluate(()=>document.body?.innerText||'');if(t)parts.push(t);}catch{}}return parts.join('\n');
}
async function clickText(page,patterns,timeout=9000){
  const end=Date.now()+timeout;
  while(Date.now()<end){
    for(const frame of page.frames()){
      try{
        const hit=await frame.evaluate(regexes=>{
          const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>5&&r.height>5&&s.display!=='none'&&s.visibility!=='hidden'};
          const norm=v=>String(v||'').replace(/\s+/g,' ').trim();
          const regs=regexes.map(x=>new RegExp(x,'i'));
          const els=[...document.querySelectorAll('button,a,[role="button"],input[type="submit"],input[type="button"],div,span')].filter(visible);
          const candidates=els.map(e=>({e,t:norm(e.innerText||e.textContent||e.value||e.getAttribute('aria-label')||'')})).filter(x=>regs.some(r=>r.test(x.t)));
          if(!candidates.length)return null;
          candidates.sort((a,b)=>a.t.length-b.t.length);
          const leaf=candidates[0].e,clickable=leaf.closest('button,a,[role="button"]')||leaf;
          const href=clickable.href||'';
          clickable.scrollIntoView({block:'center',behavior:'auto'});
          clickable.click();
          return{ text:candidates[0].t, href };
        },patterns.map(r=>r.source));
        if(hit)return hit;
      }catch{}
    }
    await sleep(350);
  }
  return null;
}
async function fillDocNo(page,mawb,timeout=9000){
  const digits=digitsOnly(mawb),prefix=digits.slice(0,3),serial=digits.slice(3),end=Date.now()+timeout;
  while(Date.now()<end){
    for(const frame of page.frames()){
      try{
        const result=await frame.evaluate(({digits,prefix,serial})=>{
          const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>10&&r.height>8&&s.display!=='none'&&s.visibility!=='hidden'&&!e.disabled&&!e.readOnly};
          const desc=e=>`${e.placeholder||''} ${e.name||''} ${e.id||''} ${e.getAttribute('aria-label')||''} ${e.title||''} ${e.labels?.[0]?.innerText||''}`.toLowerCase();
          const set=(e,v)=>{const d=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');d?.set?.call(e,v);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));};
          const inputs=[...document.querySelectorAll('input')].filter(visible).filter(e=>!['hidden','submit','button','checkbox','radio'].includes((e.type||'text').toLowerCase()));
          const prefixInput=inputs.find(e=>/prefix/.test(desc(e))||e.maxLength===3);
          const numberInput=inputs.find(e=>e!==prefixInput&&(/doc\.?\s*no|document|awb|airway|number/.test(desc(e))||e.maxLength===8));
          if(prefixInput&&numberInput){set(prefixInput,prefix);set(numberInput,serial);return{ok:true,mode:'split',prefix:prefixInput.value,number:numberInput.value};}
          const single=inputs.find(e=>/doc\.?\s*no|document|awb|airway|track/.test(desc(e)))||inputs.find(e=>[11,12,14].includes(e.maxLength));
          if(single){set(single,digits);return{ok:true,mode:'doc-no',value:single.value};}
          return{ok:false,inputs:inputs.map(e=>({d:desc(e),max:e.maxLength})).slice(0,12)};
        },{digits,prefix,serial});
        if(result?.ok)return result;
      }catch{}
    }
    await sleep(350);
  }
  return{ok:false};
}

export async function trackVirgin(input){
  const mawb=normalizeMawb(input);
  if(!mawb||!mawb.startsWith('932-'))return{ok:false,reason:'INVALID VIRGIN ATLANTIC MAWB',airline:AIRLINE};
  let browser;
  const debug={stage:'OPEN',flow:[]};
  try{
    const mod=await import('puppeteer-core'),puppeteer=mod.default||mod,launch=await browserConfig();
    browser=await puppeteer.launch({...launch,headless:true,defaultViewport:{width:1440,height:1100,deviceScaleFactor:1}});
    const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36');
    await page.setExtraHTTPHeaders({'Accept-Language':'en-GB,en;q=0.9'});
    await page.goto(URL,{waitUntil:'domcontentloaded',timeout:30000});
    await sleep(1600);
    await clickText(page,[/accept all/i,/accept cookies/i,/agree/i],1800).catch(()=>null);

    const trackCargo=await clickText(page,[/^Track Cargo$/i,/Track\s+Cargo/i,/Track\s+and\s+trace/i],7000);
    debug.flow.push({step:'TRACK_CARGO',clicked:Boolean(trackCargo),text:trackCargo?.text||''});
    if(trackCargo){await Promise.race([page.waitForNetworkIdle({idleTime:800,timeout:7000}).catch(()=>{}),sleep(7000)]);await sleep(1000);}

    const fill=await fillDocNo(page,mawb,9000);
    debug.flow.push({step:'DOC_NO',...fill});
    if(!fill.ok)return{ok:false,reason:'VIRGIN ATLANTIC DOC NO FIELD NOT FOUND',officialTracker:URL,debug};

    const search=await clickText(page,[/^Search$/i,/^Track$/i],7000);
    debug.flow.push({step:'SEARCH',clicked:Boolean(search),text:search?.text||''});
    if(!search)return{ok:false,reason:'VIRGIN ATLANTIC SEARCH BUTTON NOT FOUND',officialTracker:URL,debug};
    await Promise.race([page.waitForNetworkIdle({idleTime:900,timeout:9000}).catch(()=>{}),sleep(9000)]);await sleep(1200);

    let text=await pageText(page);
    if(/no\s+(?:shipment|result|record)|not\s+found|invalid\s+(?:awb|document|doc)/i.test(text))return{ok:false,notFound:true,reason:'NOT TRACEABLE ON VIRGIN ATLANTIC CARGO',officialTracker:URL,debug:{...debug,stage:'NO_RECORD'}};

    const details=await clickText(page,[/^Tracking Details$/i,/Tracking\s+Details/i],8000);
    debug.flow.push({step:'TRACKING_DETAILS',clicked:Boolean(details),text:details?.text||''});
    if(details){await sleep(700);await Promise.race([page.waitForNetworkIdle({idleTime:700,timeout:7000}).catch(()=>{}),sleep(7000)]);await sleep(900);}

    text=await pageText(page);
    const parsed=parseVirgin(text,mawb);
    const screenshotBase64=await page.screenshot({type:'jpeg',quality:68,fullPage:false,encoding:'base64'}).catch(()=>null);
    if(parsed?.notFound)return{ok:false,notFound:true,reason:'NOT TRACEABLE ON VIRGIN ATLANTIC CARGO',officialTracker:URL,screenshotBase64,debug:{...debug,stage:'NO_RECORD_AFTER_DETAILS'}};
    if(parsed?.shipment)return{ok:true,shipment:parsed.shipment,officialTracker:URL,screenshotBase64,debug:{...debug,stage:'TRACKING_DETAILS_SUCCESS',sample:clean(text).slice(0,10000)}};
    return{ok:false,reason:'VIRGIN ATLANTIC TRACKING DETAILS NOT READABLE',officialTracker:URL,screenshotBase64,debug:{...debug,stage:'NO_FIELDS',sample:clean(text).slice(0,10000)}};
  }catch(error){return{ok:false,reason:`VIRGIN ATLANTIC TRACKING ERROR: ${error?.message||error}`,officialTracker:URL,debug:{...debug,stage:'ERROR'}};}
  finally{try{if(browser)await browser.close();}catch{}}
}
