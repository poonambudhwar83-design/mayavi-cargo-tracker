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
function around(text,token,radius=360){const flat=clean(text),m=flat.match(token);if(!m)return'';const i=m.index||0;return flat.slice(Math.max(0,i-radius),Math.min(flat.length,i+radius));}
function containsMawb(text,mawb){const d=String(text||'').replace(/\D/g,'');const full=mawb.replace(/\D/g,''),serial=full.slice(3);return d.includes(full)||d.includes(serial);}
function allMatches(text,rx){const out=[];let m;while((m=rx.exec(String(text||'')))!==null){out.push(m);if(m.index===rx.lastIndex)rx.lastIndex++;}return out;}
function parseShipment(text='',mawb=''){
  const raw=String(text||'');
  const flat=clean(raw),upper=flat.toUpperCase();
  if(!flat||!containsMawb(flat,mawb))return null;
  if(/AWB\s+INVALID|PLEASE\s+ENTER\s+A\s+VALID\s+AWB/i.test(flat)&&!/\bARRIVED\b|\bDEPARTED\b|\bDELIVERED\b|RECEIVED\s+ON\s+FLIGHT/i.test(flat))return null;

  let headerOrigin='',destination='';
  const routeHeader=flat.match(/SHIPMENT\s+DETAILS\s+\d{3}-?\d{8}\s+[^()]{1,80}\(([A-Z]{3})\)\s+to\s+[^()]{1,80}\(([A-Z]{3})\)/i)
    ||flat.match(/\b([A-Z]{3})\s*(?:TO|->|→|—|–)\s*([A-Z]{3})\b/i);
  if(routeHeader){headerOrigin=String(routeHeader[1]||'').toUpperCase();destination=String(routeHeader[2]||'').toUpperCase();}

  const departures=allMatches(flat,/DEPARTED\s+([A-Z][A-Z .'-]{1,60}?)\s+([A-Z]{3})\s+to\s+([A-Z][A-Z .'-]{1,60}?)\s+([A-Z]{3})\s+(\d{2}\/\d{2}\/\d{4})(?:\s+(\d{2}:\d{2}))?(?:\s+Flight\s+(BA\s*\d{2,4}))?/gi);
  let origin=headerOrigin;
  if(departures.length)origin=String(departures[departures.length-1][2]||origin).toUpperCase();

  const total=flat.match(/\b(\d{1,6})\s+Package\/s\s+([\d,.]+)\s*kg\s+Total\b/i)
    ||flat.match(/\b(\d{1,6})\s+(?:PCS|PIECES?|PACKAGES?)\s*[-–]?\s*([\d,.]+)\s*kg\b/i);
  const pieces=total?String(total[1]||''):first(flat,[/\b(?:PIECES?|PCS|PACKAGES?)\b\s*[:\-]?\s*(\d{1,6})/i]);
  const weight=total?String(total[2]||'').replace(/,/g,''):first(flat,[/\b(?:GROSS\s*WEIGHT|WEIGHT)\b\s*[:\-]?\s*([\d,.]+)\s*(?:KG|KGS)?/i]).replace(/,/g,'');

  const arrivals=allMatches(flat,/ARRIVED\s+([A-Z][A-Z .'-]{1,60}?)\s+([A-Z]{3})\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2})(?:\s+Flight\s+(BA\s*\d{2,4}))?/gi);
  const delivered=allMatches(flat,/DELIVERED\s+([A-Z][A-Z .'-]{1,60}?)\s+([A-Z]{3})\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2})/gi);
  const received=allMatches(flat,/RECEIVED\s+ON\s+FLIGHT\s+([A-Z][A-Z .'-]{1,60}?)\s+([A-Z]{3})\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2})(?:\s+Flight\s+(BA\s*\d{2,4}))?/gi);

  // For connecting shipments, an intermediate ARRIVED/RECEIVED milestone must not be
  // treated as final-destination arrival. Only accept those milestones when their
  // station matches the shipment destination; fall back to the first event only
  // when the destination itself is unknown.
  const finalArrival=destination?(arrivals.find(m=>String(m[2]).toUpperCase()===destination)||null):(arrivals[0]||null);
  const finalDelivered=destination?(delivered.find(m=>String(m[2]).toUpperCase()===destination)||null):(delivered[0]||null);
  const finalReceived=destination?(received.find(m=>String(m[2]).toUpperCase()===destination)||null):(received[0]||null);

  let arrivalDate='',arrivalTime='',arrivalIsActual=false,arrivalSource='';
  if(finalArrival){arrivalDate=parseDate(finalArrival[3]);arrivalTime=parseTime(finalArrival[4]);arrivalIsActual=true;arrivalSource='ARRIVED at destination';}
  else if(finalReceived){arrivalDate=parseDate(finalReceived[3]);arrivalTime=parseTime(finalReceived[4]);arrivalIsActual=true;arrivalSource='RECEIVED ON FLIGHT at destination';}
  else{
    for(const tok of [/\bETA\b/i,/\bSTA\b/i,/EXPECTED\s+ARRIVAL/i,/SCHEDULED\s+ARRIVAL/i]){const w=around(flat,tok);const d=parseDate(w),t=parseTime(w);if(d||t){arrivalDate=d;arrivalTime=t;arrivalSource='ETA/STA';break;}}
  }

  let flightNo='';
  if(finalArrival?.[5])flightNo=String(finalArrival[5]).replace(/[\s-]+/g,'').toUpperCase();
  else if(finalReceived?.[5])flightNo=String(finalReceived[5]).replace(/[\s-]+/g,'').toUpperCase();
  else if(destination&&departures.length){const d=departures.find(m=>String(m[4]).toUpperCase()===destination&&m[7]);if(d)flightNo=String(d[7]).replace(/[\s-]+/g,'').toUpperCase();}
  if(!flightNo)flightNo=first(upper,[/\b(BA\s*[- ]?\d{2,4})\b/]).replace(/[\s-]+/g,'');

  let bookingDate='';
  for(const tok of [/\bBOOKED\b/i,/\bRCS\b/i,/RECEIVED\s+FROM\s+SHIPPER/i,/\bACCEPTED\b/i]){const w=around(flat,tok);const d=parseDate(w);if(d){bookingDate=d;break;}}

  // Export departure must come from the first-leg DEPARTED milestone timestamp,
  // not from the later operational date printed inside the route line.
  let departureDate='',departureTime='';
  if(origin){
    const depEventRx=new RegExp('(\\d{2}\\/\\d{2}\\/\\d{4})\\s+(\\d{2}:\\d{2})\\s+DEPARTED\\s+[A-Z][A-Z .\\\'-]{1,60}?\\s+'+origin+'\\s+to\\s+','i');
    const dm=flat.match(depEventRx);
    if(dm){departureDate=parseDate(dm[1]);departureTime=parseTime(dm[2]);}
  }

  let status='BOOKED';
  if(finalDelivered)status='DELIVERED';
  else if(finalArrival||finalReceived)status='ARRIVED';
  else if(/\bOFFLOAD(?:ED)?\b|\bDELAY(?:ED)?\b|SHORT\s*SHIP/i.test(flat))status='DELAYED';
  else if(departures.length||/\bDEPARTED\b|IN\s+TRANSIT|AIRBORNE|IN\s+FLIGHT/i.test(flat))status='IN TRANSIT';

  const deliveredDate=finalDelivered?parseDate(finalDelivered[3]):'';
  const deliveredTime=finalDelivered?parseTime(finalDelivered[4]):'';
  const useful=Boolean((origin&&destination)||pieces||weight||flightNo||bookingDate||arrivalDate||arrivalTime||deliveredDate||departures.length||arrivals.length);
  return useful?{mawb,carrierCode:'BA',airlineName:'British Airways / IAG Cargo',officialTracker:AIRLINE_URL,origin,destination,bags:pieces,pieces,weight,flightNo,bookingDate,departureDate,departureTime,arrivalDate,arrivalTime,arrivalIsActual,status,arrivalSource,deliveredDate,deliveredTime,source:'IAG Cargo official Track & Trace'}:null;
}
async function pageText(page){let out='';for(const f of page.frames()){try{out+='\n'+await f.evaluate(()=>document.body?.innerText||'');}catch{}}return out;}
async function acceptCookies(page){for(const f of page.frames()){try{await f.evaluate(()=>{const vis=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>20&&r.height>10};const b=[...document.querySelectorAll('button,[role="button"],a')].filter(vis).find(x=>/accept all|accept cookies|allow all|agree/i.test((x.innerText||x.textContent||'').trim()));b?.click();});}catch{}}}
async function inspectInputs(page){const rows=[];for(const f of page.frames()){try{const a=await f.evaluate(()=>[...document.querySelectorAll('input')].map((e,i)=>({i,id:e.id,name:e.name,type:e.type,placeholder:e.placeholder,value:e.value,aria:e.getAttribute('aria-label')||'',visible:!!(e.offsetWidth||e.offsetHeight||e.getClientRects().length)})));rows.push({frame:f.url(),inputs:a});}catch{}}return rows;}
async function realType(el,value){await el.click({clickCount:3}).catch(()=>{});await el.press('Control+A').catch(()=>{});await el.press('Backspace').catch(()=>{});await el.type(value,{delay:85});await el.press('Tab').catch(()=>{});}
async function fillReal(page,mawb){
  const prefix=mawb.slice(0,3),serial=mawb.slice(4);
  for(const f of page.frames()){
    try{
      let one=await f.$('#search-by-awb');
      if(!one){
        const handles=await f.$$('input');
        for(const h of handles){
          const meta=await h.evaluate(e=>({type:(e.type||'text').toLowerCase(),desc:`${e.id||''} ${e.name||''} ${e.placeholder||''} ${e.getAttribute('aria-label')||''}`,visible:!!(e.offsetWidth||e.offsetHeight||e.getClientRects().length)}));
          if(!meta.visible||['hidden','checkbox','radio','submit','button'].includes(meta.type))continue;
          if(/XXX-YYYYYYYY|AWB|AIR\s*WAYBILL|AIRWAY|SHIPMENT|TRACKING/i.test(meta.desc)){one=h;break;}
        }
      }
      let mode='';
      let n=null;
      if(one){await realType(one,mawb);mode='single-visible';}
      else{
        let p=await f.$('#awb_cia');if(!p)p=await f.$('input[name="awb_cia"]');if(!p)p=await f.$('input[name="awb.cia"]');
        n=await f.$('#awb_cod');if(!n)n=await f.$('input[name="awb_cod"]');if(!n)n=await f.$('input[name="awb.cod"]');
        if(!(p&&n))continue;
        await p.evaluate((e,v)=>{e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));},prefix);
        await n.evaluate((e,v)=>{e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));},serial);
        mode='split-hidden-fallback';
      }
      await sleep(500);
      const clicked=await f.evaluate(()=>{const vis=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>20&&r.height>10&&!e.disabled};const label=e=>(e.innerText||e.value||e.textContent||e.getAttribute('aria-label')||'').replace(/\s+/g,' ').trim();const b=[...document.querySelectorAll('button,input[type="submit"],input[type="button"],a,[role="button"]')].filter(vis).find(e=>/^SEARCH$/i.test(label(e))||/^TRACK(?:\s+SHIPMENT)?$/i.test(label(e))||/TRACK\s+YOUR\s+SHIPMENT/i.test(label(e)));if(!b)return'';b.click();return label(b);}).catch(()=> '');
      if(clicked)return{filled:true,clicked,mode,frame:f.url(),value:mawb};
      if(one)await one.press('Enter').catch(()=>{});else if(n)await n.press('Enter').catch(()=>{});
      return{filled:true,clicked:'Enter',mode,frame:f.url(),value:mawb};
    }catch{}
  }
  return{filled:false,mode:'no-input'};
}
export async function trackBritishEntry(input){
  const mawb=normalizeMawb(input);if(!mawb||!mawb.startsWith('125-'))return{ok:false,reason:'INVALID BRITISH AIRWAYS MAWB'};
  let browser;const network=[];
  try{
    const cfg=await browserConfig();browser=await puppeteer.launch({headless:'shell',executablePath:cfg.executablePath,args:cfg.args,defaultViewport:{width:1440,height:1100,deviceScaleFactor:1}});
    const page=await browser.newPage();await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36');await page.setExtraHTTPHeaders({'Accept-Language':'en-GB,en;q=0.9'});await page.evaluateOnNewDocument(()=>{try{Object.defineProperty(navigator,'webdriver',{get:()=>undefined});}catch{}});
    const full=mawb.replace(/\D/g,''),serial=full.slice(3);
    page.on('response',async r=>{try{const ct=(r.headers()['content-type']||'').toLowerCase();if(!/json|text\/plain|xml/.test(ct))return;const b=await r.text();if(!b||b.length>250000)return;const digits=b.replace(/\D/g,'');if(digits.includes(full)||digits.includes(serial))network.push({url:r.url(),status:r.status(),body:b.slice(0,140000)});}catch{}});
    await page.goto(ENTRY,{waitUntil:'domcontentloaded',timeout:30000});await sleep(2600);await acceptCookies(page);await sleep(500);
    const before=await pageText(page),inputs=await inspectInputs(page);if(/captcha|verify you are human|security check|cloudflare|turnstile|access denied/i.test(before))return{ok:false,reason:'IAG CARGO SECURITY/CAPTCHA REQUIRES MANUAL CHECK',officialTracker:AIRLINE_URL,debug:{stage:'CAPTCHA'}};
    const setup=await fillReal(page,mawb);if(!setup.filled)return{ok:false,reason:'IAG CARGO TRACK INPUT WAS NOT FOUND ON ENTRY PAGE',officialTracker:AIRLINE_URL,debug:{stage:'NO_INPUT',inputs,pageText:before.slice(0,6000)}};
    await Promise.race([page.waitForNetworkIdle({idleTime:1000,timeout:15000}).catch(()=>{}),sleep(15000)]);await sleep(1800);
    const visible=await pageText(page);const relevantNetwork=network.map(x=>x.body).join('\n');const evidence=visible+(relevantNetwork?`\nIAG_RESULT_NETWORK\n${relevantNetwork}`:'');
    const shipment=parseShipment(evidence,mawb);const screenshotBase64=await page.screenshot({type:'jpeg',quality:68,fullPage:false,encoding:'base64'}).catch(()=>null);
    if(shipment)return{ok:true,shipment,screenshotBase64,officialTracker:AIRLINE_URL,debug:{stage:'SUCCESS',url:page.url(),setup,inputs,pageText:visible.slice(0,9000),network:network.slice(-10).map(x=>({url:x.url,status:x.status,sample:x.body.slice(0,1600)}))}};
    const invalid=/AWB\s+INVALID|PLEASE\s+ENTER\s+A\s+VALID\s+AWB/i.test(visible);
    return{ok:false,reason:invalid?'IAG CARGO FORM DID NOT ACCEPT THE AUTOMATED ENTRY':'IAG CARGO RETURNED NO VERIFIED SHIPMENT FIELDS',officialTracker:AIRLINE_URL,screenshotBase64,automationRejected:invalid,debug:{stage:invalid?'FORM_REJECTED':'NO_FIELDS',url:page.url(),setup,inputs,pageText:visible.slice(0,9000),network:network.slice(-10).map(x=>({url:x.url,status:x.status,sample:x.body.slice(0,1600)}))}};
  }catch(e){return{ok:false,reason:`BA ENTRY TRACKING ERROR: ${e?.message||e}`,officialTracker:AIRLINE_URL,debug:{stage:'ERROR'}};}finally{try{if(browser)await browser.close()}catch{}}
}
