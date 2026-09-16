import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { normalizeMawb } from './airlines.js';

const ENTRY='https://www.iagcargo.com/iagcargo/portlet/en/html/601';
const AIRLINE_URL='https://www.iagcargo.com/';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const pad=v=>String(v).padStart(2,'0');

async function browserConfig(){
  for(const p of [process.env.CHROME_EXECUTABLE_PATH,'/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome','/usr/bin/google-chrome-stable'].filter(Boolean)){
    if(fs.existsSync(p))return{executablePath:p,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote']};
  }
  const mod=await import('@sparticuz/chromium');
  const chromium=mod.default||mod;
  chromium.setGraphicsMode=false;
  return{executablePath:await chromium.executablePath(),args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']};
}

function isoDate(v=''){
  const m=String(v).match(/\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](20\d{2})\b/);
  return m?`${m[3]}-${pad(m[2])}-${pad(m[1])}`:'';
}
function cleanTime(v=''){
  const m=String(v).match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  return m?`${pad(m[1])}:${m[2]}`:'';
}
function cleanFlight(v=''){
  const m=String(v).toUpperCase().match(/\bBA\s*0*(\d{2,4})\b/);
  return m?`BA${m[1].padStart(3,'0')}`:'';
}
function containsMawb(text='',mawb=''){
  const digits=String(text).replace(/\D/g,''),full=String(mawb).replace(/\D/g,''),serial=full.slice(3);
  return Boolean(full&&(digits.includes(full)||digits.includes(serial)));
}
function packageWeight(text=''){
  const m=String(text).match(/\b(\d{1,6})\s*(?:Package\/s|Packages?|Piece\/s|Pieces?|PCS)\b(?:\s*[-–:]?\s*)?([\d,.]+)?\s*(?:kg|kgs)?/i);
  if(!m)return{pieces:'',weight:''};
  return{pieces:m[1]||'',weight:String(m[2]||'').replace(/,/g,'')};
}
function stationDetail(line=''){
  const s=String(line).replace(/\s+/g,' ').trim();
  const m=s.match(/^(.+?)\s+([A-Z]{3})\s+(\d{1,2}[\/.\-]\d{1,2}[\/.\-]20\d{2})(?:\s+(\d{1,2}:\d{2}))?(?:\s+Flight\s+(BA\s*0*\d{2,4}))?/i);
  if(!m)return null;
  const pw=packageWeight(s);
  return{city:m[1].trim(),station:m[2].toUpperCase(),date:isoDate(m[3]),time:cleanTime(m[4]||''),flightNo:cleanFlight(m[5]||''),...pw,raw:s};
}
function routeDetail(line=''){
  const s=String(line).replace(/\s+/g,' ').trim();
  const m=s.match(/^(.+?)\s+([A-Z]{3})\s+to\s+(.+?)\s+([A-Z]{3})\s+(\d{1,2}[\/.\-]\d{1,2}[\/.\-]20\d{2})(?:\s+(\d{1,2}:\d{2}))?(?:\s+Flight\s+(BA\s*0*\d{2,4}))?/i);
  if(!m)return null;
  const pw=packageWeight(s);
  return{fromCity:m[1].trim(),from:m[2].toUpperCase(),toCity:m[3].trim(),to:m[4].toUpperCase(),date:isoDate(m[5]),time:cleanTime(m[6]||''),flightNo:cleanFlight(m[7]||''),...pw,raw:s};
}
function inferJourney(routes=[],header=null){
  const unique=[];const seen=new Set();
  for(const r of routes){const key=`${r.from}-${r.to}`;if(!seen.has(key)){seen.add(key);unique.push(r);}}
  if(unique.length){
    const fromSet=new Set(unique.map(r=>r.from)),toSet=new Set(unique.map(r=>r.to));
    const origins=[...fromSet].filter(x=>!toSet.has(x));
    const destinations=[...toSet].filter(x=>!fromSet.has(x));
    const origin=origins.length===1?origins[0]:unique.at(-1)?.from||'';
    const destination=destinations.length===1?destinations[0]:unique[0]?.to||'';
    return{origin,destination};
  }
  return{origin:header?.origin||'',destination:header?.destination||''};
}
function parseIagShipment(text='',mawb=''){
  const raw=String(text||'');
  if(!raw||!containsMawb(raw,mawb))return null;
  const lines=raw.split(/\r?\n/).map(x=>x.replace(/\s+/g,' ').trim()).filter(Boolean);
  const joined=lines.join(' ');

  let header=null;
  for(const line of lines){
    const m=line.match(/^(.+?)\s*\(([A-Z]{3})\)\s+to\s+(.+?)\s*\(([A-Z]{3})\)$/i);
    if(m){header={origin:m[2].toUpperCase(),destination:m[4].toUpperCase(),raw:line};break;}
  }

  const routes=[];
  for(const line of lines){const r=routeDetail(line);if(r)routes.push(r);}
  const journey=inferJourney(routes,header);

  const events=[];
  for(let i=0;i<lines.length;i++){
    const label=lines[i].toUpperCase();
    if(!['DELIVERED','ARRIVED','DEPARTED','RECEIVED ON FLIGHT','RECEIVED FROM FLIGHT','RECEIVED FROM SHIPPER','ACCEPTED','BOOKED','DOCUMENTATION','CONSIGNEE INFORMED'].includes(label))continue;
    const detail=stationDetail(lines[i+1]||'')||routeDetail(lines[i+1]||'');
    events.push({type:label,detail,index:i});
  }

  let pieces='',weight='';
  for(const line of lines){
    if(!/\bTotal\b/i.test(line)&&!/Package\/s|Packages?|Piece\/s|Pieces?|PCS/i.test(line))continue;
    const pw=packageWeight(line);if(!pieces&&pw.pieces)pieces=pw.pieces;if(!weight&&pw.weight)weight=pw.weight;
    if(pieces&&weight)break;
  }

  const arrivalEvents=events.filter(e=>e.type==='ARRIVED'&&e.detail?.station);
  const destinationArrival=arrivalEvents.find(e=>e.detail.station===journey.destination)||arrivalEvents[0]||null;
  const deliveredEvents=events.filter(e=>e.type==='DELIVERED'&&e.detail?.station);
  const destinationDelivered=deliveredEvents.find(e=>e.detail.station===journey.destination)||deliveredEvents[0]||null;

  let flightNo=destinationArrival?.detail?.flightNo||'';
  if(!flightNo){
    const finalLeg=routes.find(r=>r.to===journey.destination)||routes[0];
    flightNo=finalLeg?.flightNo||'';
  }
  if(!flightNo){const m=joined.match(/\bFlight\s+(BA\s*0*\d{2,4})\b/i);flightNo=cleanFlight(m?.[1]||'');}

  let bookingDate='',bookingTime='';
  const bookingEvent=events.find(e=>['BOOKED','ACCEPTED','RECEIVED FROM SHIPPER'].includes(e.type)&&e.detail?.date);
  if(bookingEvent){bookingDate=bookingEvent.detail.date;bookingTime=bookingEvent.detail.time||'';}

  const arrivalDate=destinationArrival?.detail?.date||'';
  const arrivalTime=destinationArrival?.detail?.time||'';
  const arrivalIsActual=Boolean(arrivalDate||arrivalTime);

  let status='BOOKED';
  if(destinationDelivered||/\bDELIVERED\b/i.test(joined))status='DELIVERED';
  else if(destinationArrival)status='ARRIVED';
  else if(/\bOFFLOAD(?:ED)?\b|\bDELAY(?:ED)?\b|SHORT\s*SHIP|EXCEPTION/i.test(joined))status='DELAYED';
  else if(routes.length||events.some(e=>['DEPARTED','RECEIVED ON FLIGHT','RECEIVED FROM FLIGHT'].includes(e.type)))status='IN TRANSIT';
  else if(events.some(e=>['BOOKED','ACCEPTED','RECEIVED FROM SHIPPER'].includes(e.type)))status='BOOKED';

  if(!pieces||!weight){
    const candidates=[destinationDelivered?.detail,destinationArrival?.detail,...routes].filter(Boolean);
    for(const c of candidates){if(!pieces&&c.pieces)pieces=c.pieces;if(!weight&&c.weight)weight=c.weight;if(pieces&&weight)break;}
  }

  const useful=Boolean((journey.origin&&journey.destination)||pieces||weight||flightNo||bookingDate||arrivalDate||arrivalTime||status!=='BOOKED');
  if(!useful)return null;
  return{
    mawb,
    carrierCode:'BA',
    airlineName:'British Airways / IAG Cargo',
    officialTracker:AIRLINE_URL,
    origin:journey.origin,
    destination:journey.destination,
    bags:pieces,
    pieces,
    weight,
    flightNo,
    bookingDate,
    bookingTime,
    arrivalDate,
    arrivalTime,
    arrivalIsActual,
    status,
    arrivalSource:arrivalIsActual?'IAG destination ARRIVED event':'',
    source:'IAG Cargo official Track & Trace',
    iagDeliveredDate:destinationDelivered?.detail?.date||'',
    iagDeliveredTime:destinationDelivered?.detail?.time||''
  };
}

async function pageText(page){let out='';for(const f of page.frames()){try{out+='\n'+await f.evaluate(()=>document.body?.innerText||'');}catch{}}return out;}
async function acceptCookies(page){for(const f of page.frames()){try{await f.evaluate(()=>{const vis=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>20&&r.height>10};const b=[...document.querySelectorAll('button,[role="button"],a')].filter(vis).find(x=>/accept all|accept cookies|allow all|agree/i.test((x.innerText||x.textContent||'').trim()));b?.click();});}catch{}}}
async function realType(el,value){await el.click({clickCount:3}).catch(()=>{});await el.press('Control+A').catch(()=>{});await el.press('Backspace').catch(()=>{});await el.type(value,{delay:70});await el.press('Tab').catch(()=>{});}
async function fillReal(page,mawb){
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
      if(!one)continue;
      await realType(one,mawb);await sleep(400);
      const clicked=await f.evaluate(()=>{const vis=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>20&&r.height>10&&!e.disabled};const label=e=>(e.innerText||e.value||e.textContent||e.getAttribute('aria-label')||'').replace(/\s+/g,' ').trim();const b=[...document.querySelectorAll('button,input[type="submit"],input[type="button"],a,[role="button"]')].filter(vis).find(e=>/^SEARCH$/i.test(label(e))||/^TRACK(?:\s+SHIPMENT)?$/i.test(label(e)));if(!b)return'';b.click();return label(b);}).catch(()=> '');
      if(!clicked)await one.press('Enter').catch(()=>{});
      return{filled:true,clicked:clicked||'Enter',mode:'single-visible',frame:f.url(),value:mawb};
    }catch{}
  }
  return{filled:false,mode:'no-visible-input'};
}

export async function trackBritishEntryV2(input){
  const mawb=normalizeMawb(input);
  if(!mawb||!mawb.startsWith('125-'))return{ok:false,reason:'INVALID BRITISH AIRWAYS MAWB'};
  let browser;
  try{
    const cfg=await browserConfig();
    browser=await puppeteer.launch({headless:'shell',executablePath:cfg.executablePath,args:cfg.args,defaultViewport:{width:1440,height:1100,deviceScaleFactor:1}});
    const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({'Accept-Language':'en-GB,en;q=0.9'});
    await page.evaluateOnNewDocument(()=>{try{Object.defineProperty(navigator,'webdriver',{get:()=>undefined});}catch{}});
    await page.goto(ENTRY,{waitUntil:'domcontentloaded',timeout:30000});await sleep(2400);await acceptCookies(page);await sleep(400);
    const before=await pageText(page);
    if(/captcha|verify you are human|security check|cloudflare|turnstile|access denied/i.test(before))return{ok:false,reason:'IAG CARGO SECURITY/CAPTCHA REQUIRES MANUAL CHECK',officialTracker:AIRLINE_URL,debug:{stage:'CAPTCHA'}};
    const setup=await fillReal(page,mawb);
    if(!setup.filled)return{ok:false,reason:'IAG CARGO TRACK INPUT WAS NOT FOUND',officialTracker:AIRLINE_URL,debug:{stage:'NO_INPUT',pageText:before.slice(0,5000)}};
    await Promise.race([page.waitForNetworkIdle({idleTime:1000,timeout:15000}).catch(()=>{}),sleep(15000)]);await sleep(1400);
    const visible=await pageText(page);
    const shipment=parseIagShipment(visible,mawb);
    const screenshotBase64=await page.screenshot({type:'jpeg',quality:66,fullPage:false,encoding:'base64'}).catch(()=>null);
    if(shipment)return{ok:true,shipment,screenshotBase64,officialTracker:AIRLINE_URL,debug:{stage:'SUCCESS_V2',url:page.url(),setup,pageText:visible.slice(0,12000)}};
    const invalid=/AWB\s+INVALID|PLEASE\s+ENTER\s+A\s+VALID\s+AWB/i.test(visible);
    return{ok:false,reason:invalid?'IAG CARGO FORM DID NOT ACCEPT THE AUTOMATED ENTRY':'IAG CARGO RETURNED NO VERIFIED SHIPMENT FIELDS',officialTracker:AIRLINE_URL,screenshotBase64,automationRejected:invalid,debug:{stage:invalid?'FORM_REJECTED':'NO_FIELDS',url:page.url(),setup,pageText:visible.slice(0,12000)}};
  }catch(e){return{ok:false,reason:`BA ENTRY TRACKING ERROR: ${e?.message||e}`,officialTracker:AIRLINE_URL,debug:{stage:'ERROR'}};}finally{try{if(browser)await browser.close()}catch{}}
}
