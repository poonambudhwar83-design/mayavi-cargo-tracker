import { normalizeMawb } from './airlines.js';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const BASE='https://www.cathaycargoterminal.com/en-us/Shipment-Tracking';
const CATHAY='https://www.cathaycargo.com/en-us/track-and-trace.html';
const AIRLINE={name:'Cathay Cargo',iata:'CX',url:CATHAY};
const months={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
const pad=v=>String(v).padStart(2,'0');
const clean=s=>String(s||'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/\s+/g,' ').trim();

function dt(v=''){
  const s=String(v).toUpperCase();
  let m=s.match(/(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s,]+(20\d{2})(?:\s+(\d{1,2}):(\d{2}))?/);
  if(m)return{date:`${m[3]}-${months[m[2]]}-${pad(m[1])}`,time:m[4]?`${pad(m[4])}:${m[5]}`:''};
  m=s.match(/(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})(?:[T\s][^0-9]*(\d{1,2}):(\d{2}))?/);
  return m?{date:`${m[1]}-${pad(m[2])}-${pad(m[3])}`,time:m[4]?`${pad(m[4])}:${m[5]}`:''}:{date:'',time:''};
}

function dateFromDayMonth(v='',year=''){
  const m=String(v).toUpperCase().match(/(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)/);
  if(!m)return'';
  return `${year||new Date().getFullYear()}-${months[m[2]]}-${pad(m[1])}`;
}

function parseTerminal(html,mawb){
  const text=clean(html),digits=mawb.replace(/\D/g,''),serial=digits.slice(3);
  if((!text.includes(digits)&&!text.includes(mawb)&&!text.includes(serial))||/Reject Reason|is not found/i.test(text))return null;
  const od=text.match(/AWB Type\s+Origin\s+Destination(?:\s+Charge Details)?\s+(?:Import|Export)\s+([A-Z]{3})\s+([A-Z]{3})/i)||text.match(/(?:Import|Export)\s+([A-Z]{3})\s+([A-Z]{3})\s+(?:Received from Shipper|Received from Flight|Departure Flight)/i);
  const rcs=text.match(/Received from Shipper(?:\s*\(RCS\))?[\s\S]{0,500}?(\d{1,2}\s+[A-Z]{3}\s+20\d{2}\s+\d{1,2}:\d{2})\s+(\d{1,6})\s+([\d,.]+)/i);
  const depSection=(text.match(/Departure Flight(?:\s*\(DEP\))?[\s\S]{0,1000}?(?=Received from Flight|Cargo Delivered|Last Update|$)/i)||[])[0]||'';
  const deps=[...depSection.matchAll(/\b(CX\d{2,4})\s+(\d{1,2}\s+[A-Z]{3}\s+20\d{2})\s+(\d{1,2}:\d{2})\s*\(STD\)\s+(\d{1,6})\s+([\d,.]+)/gi)];
  const dep=deps.at(-1);
  const rcfSection=(text.match(/Received from Flight(?:\s*\(RCF\))?[\s\S]{0,1800}?(?=Cargo Delivered|Last Update|$)/i)||[])[0]||'';
  const rcfs=[...rcfSection.matchAll(/\b(CX\d{2,4})\s+(\d{1,2}\s+[A-Z]{3}\s+20\d{2})\s+(\d{1,6})\s+([\d,.]+)\s+(\d{1,2}\s+[A-Z]{3}\s+20\d{2}\s+\d{1,2}:\d{2})/gi)];
  const rcf=rcfs.at(-1);
  const arrival=rcf?dt(rcf[5]):{date:'',time:''};
  const delivered=/Cargo Delivered(?:\s*\(DLV\))?/i.test(text);
  const booking=rcs?dt(rcs[1]):{date:'',time:''};
  const pieces=rcf?.[3]||dep?.[4]||rcs?.[2]||'';
  const weight=(rcf?.[4]||dep?.[5]||rcs?.[3]||'').replace(/,/g,'');
  const flightNo=(rcf?.[1]||dep?.[1]||'').toUpperCase();
  return {mawb,carrierCode:'CX',airlineName:'Cathay Cargo',origin:od?.[1]||'',destination:od?.[2]||'',bags:pieces,pieces,weight,bookingDate:booking.date,bookingTime:booking.time,flightNo,arrivalDate:arrival.date,arrivalTime:arrival.time,arrivalIsActual:Boolean(rcf&&arrival.date),status:delivered?'DELIVERED':rcf?'ARRIVED':dep?'IN TRANSIT':rcs?'BOOKED':'TRACKING',officialTracker:CATHAY,source:'Cathay Cargo Terminal official tracking'};
}

function parseOfficialText(raw='',mawb='',referenceYear=''){
  const text=String(raw||'').replace(/\s+/g,' ').trim();
  const route=text.match(/\b([A-Z]{3})\s+to\s+([A-Z]{3})\s*\|\s*(\d+)\s*pc(?:\(s\)|s)?\s*\|\s*([\d,.]+)\s*kg/i);
  const origin=(route?.[1]||'').toUpperCase(),destination=(route?.[2]||'').toUpperCase();
  const pieces=route?.[3]||'';
  const weight=(route?.[4]||'').replace(/,/g,'');
  const flightMatches=[...text.matchAll(/\b(CX\d{2,4})\b\s+(\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC))\s+(\d{1,2}:\d{2})[\s\S]{0,90}?(\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC))\s+(\d{1,2}:\d{2})/gi)];
  const flight=flightMatches.at(-1);
  const year=referenceYear||String(new Date().getFullYear());
  const flightNo=(flight?.[1]||'').toUpperCase();
  const arrivalDate=flight?dateFromDayMonth(flight[4],year):'';
  const arrivalTime=flight?.[5]||'';
  const finalArrived=destination?new RegExp(`\\b${destination}\\s+Arrived\\b`,'i').test(text):/\bArrived\b/i.test(text);
  const delivered=destination?new RegExp(`\\b${destination}[\\s\\S]{0,120}Delivered\\b`,'i').test(text)&&!/0\s*\/\s*\d+\s+Delivered/i.test(text):/\bDelivered\b/i.test(text);
  const current=(text.match(/Current status:\s*([^|]+?)(?=\s+\d+\s*pc|\s+Booking received|\s+Overview|$)/i)||[])[1]?.trim()||'';
  let status='';
  if(delivered)status='DELIVERED';
  else if(finalArrived)status='ARRIVED';
  else if(/delay/i.test(current))status='DELAYED';
  else if(/progress|transit|depart/i.test(current)||/\bDeparted\b/i.test(text))status='IN TRANSIT';
  else if(/booking|booked|received/i.test(current)||/Booking received/i.test(text))status='BOOKED';
  return {mawb,carrierCode:'CX',airlineName:'Cathay Cargo',origin,destination,bags:pieces,pieces,weight,flightNo,arrivalDate:finalArrived?arrivalDate:'',arrivalTime:finalArrived?arrivalTime:'',arrivalIsActual:Boolean(finalArrived&&arrivalDate),status,officialTracker:CATHAY,source:'Cathay Cargo official Track & Trace'};
}

async function fillNative(page,selector,value){
  await page.waitForSelector(selector,{visible:true,timeout:12000});
  const h=await page.$(selector);
  if(!h)return false;
  await h.click({clickCount:3}).catch(()=>{});
  await page.keyboard.press('Control+A').catch(()=>{});
  await page.keyboard.press('Backspace').catch(()=>{});
  await h.type(value,{delay:60}).catch(()=>{});
  await page.evaluate((el,v)=>{
    const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
    if(String(el.value||'')!==String(v)&&setter)setter.call(el,v);
    el.dispatchEvent(new Event('input',{bubbles:true}));
    el.dispatchEvent(new Event('change',{bubbles:true}));
  },h,value);
  return String(await h.evaluate(e=>e.value||''))===String(value);
}

async function cathayOfficial(mawb,referenceYear=''){
  let browser;
  const serial=mawb.replace(/\D/g,'').slice(3);
  try{
    chromium.setGraphicsMode=false;
    browser=await puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox'],defaultViewport:{width:1440,height:1100},executablePath:await chromium.executablePath(),headless:'shell'});
    const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36');
    await page.goto(CATHAY,{waitUntil:'domcontentloaded',timeout:25000});
    await new Promise(r=>setTimeout(r,2200));

    const prefixSelector='input[id$="_airlinecodefield"],input[name$="_airlinecodefield"]';
    const awbSelector='input[id$="_airwaybill"],input[name$="_airwaybill"]';
    const prefix=await fillNative(page,prefixSelector,'160');
    await new Promise(r=>setTimeout(r,700));
    const ph=await page.$(prefixSelector);
    if(ph){await ph.focus().catch(()=>{});await page.keyboard.press('ArrowDown').catch(()=>{});await page.keyboard.press('Enter').catch(()=>{});}
    await new Promise(r=>setTimeout(r,1000));
    const number=await fillNative(page,awbSelector,serial);
    await new Promise(r=>setTimeout(r,300));

    const clicked=await page.evaluate(()=>{
      const all=[...document.querySelectorAll('input[type="submit"],button')];
      const el=all.find(e=>/track\s*now/i.test((e.value||e.innerText||e.textContent||'').trim()));
      if(!el)return false;
      el.click();
      return true;
    });
    if(!clicked)return{ok:false,reason:'TRACK NOW BUTTON NOT FOUND',debug:{prefix,number}};

    await page.waitForFunction((serial)=>{const t=document.body?.innerText||'';return t.includes(`160-${serial}`)||/Current status:/i.test(t);},{timeout:22000},serial).catch(()=>{});
    await new Promise(r=>setTimeout(r,1200));

    const showDetailsClicked=await page.evaluate(()=>{
      const all=[...document.querySelectorAll('button,a,[role="button"]')];
      const el=all.find(e=>/show\s+all\s+details/i.test((e.innerText||e.textContent||e.getAttribute('aria-label')||'').trim()));
      if(!el)return false;
      el.click();
      return true;
    });
    if(showDetailsClicked)await new Promise(r=>setTimeout(r,1200));

    const text=await page.evaluate(()=>document.body?.innerText||'');
    const result=parseOfficialText(text,mawb,referenceYear);
    const hasResult=Boolean(result.origin&&result.destination&&(result.pieces||result.weight));
    if(!hasResult)return{ok:false,reason:'CATHAY RESULT DETAILS NOT VISIBLE',debug:{prefix,number,showDetailsClicked,text:text.slice(0,6000)}};
    return{ok:true,shipment:result,debug:{prefix,number,showDetailsClicked,text:text.slice(0,6000)}};
  }catch(e){
    return{ok:false,reason:e?.message||String(e)};
  }finally{
    if(browser)await browser.close().catch(()=>{});
  }
}

async function terminalFallback(mawb){
  const suffix=mawb.replace(/\D/g,'').slice(3);
  for(const url of [`${BASE}/AWBPrefix/160/AWBSuffix/${suffix}`,`${BASE}?AWBPrefix=160&AWBSuffix=${suffix}`]){
    try{
      const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0','accept-language':'en-US,en;q=0.9'},cache:'no-store',signal:AbortSignal.timeout(12000)});
      if(!r.ok)continue;
      const parsed=parseTerminal(await r.text(),mawb);
      if(parsed)return parsed;
    }catch{}
  }
  return null;
}

export async function trackCathay(input){
  const mawb=normalizeMawb(input);
  if(!mawb||!mawb.startsWith('160-'))return{ok:false,reason:'INVALID CATHAY MAWB',airline:AIRLINE};

  const terminal=await terminalFallback(mawb);
  const referenceYear=terminal?.bookingDate?.slice(0,4)||'';
  const official=await cathayOfficial(mawb,referenceYear);

  if(official.ok){
    const s={...(terminal||{}),...official.shipment,mawb,carrierCode:'CX',airlineName:'Cathay Cargo',officialTracker:CATHAY};
    if(!s.bookingDate&&terminal?.bookingDate)s.bookingDate=terminal.bookingDate;
    if(!s.bookingTime&&terminal?.bookingTime)s.bookingTime=terminal.bookingTime;
    if(!s.flightNo&&terminal?.flightNo)s.flightNo=terminal.flightNo;
    if(!s.status)s.status=terminal?.status||'TRACKING';
    return{ok:true,airline:AIRLINE,shipment:s,debug:{stage:'SUCCESS',source:'cathay-official-show-all-details',official:official.debug,terminalFallback:Boolean(terminal)}};
  }

  if(terminal)return{ok:true,airline:AIRLINE,shipment:terminal,debug:{stage:'TERMINAL_FALLBACK',officialReason:official.reason,official:official.debug||null}};
  return{ok:false,reason:'CATHAY TRACKING RETURNED NO VERIFIED SHIPMENT DATA',airline:AIRLINE,debug:{officialReason:official.reason,official:official.debug||null}};
}
