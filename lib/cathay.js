import { normalizeMawb } from './airlines.js';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const BASE='https://www.cathaycargoterminal.com/en-us/Shipment-Tracking';
const CATHAY='https://www.cathaycargo.com/en-us/track-and-trace.html';
const AIRLINE={name:'Cathay Cargo',iata:'CX',url:CATHAY};
const months={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
const pad=v=>String(v).padStart(2,'0');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clean=s=>String(s||'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/\s+/g,' ').trim();

function dt(v=''){
  const s=String(v).toUpperCase();
  let m=s.match(/(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s,]+(20\d{2})(?:\s+(\d{1,2}):(\d{2}))?/);
  if(m)return{date:`${m[3]}-${months[m[2]]}-${pad(m[1])}`,time:m[4]?`${pad(m[4])}:${m[5]}`:''};
  m=s.match(/(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})(?:[T\s][^0-9]*(\d{1,2}):(\d{2}))?/);
  return m?{date:`${m[1]}-${pad(m[2])}-${pad(m[3])}`,time:m[4]?`${pad(m[4])}:${m[5]}`:''}:{date:'',time:''};
}
function dm(v='',year=''){
  const m=String(v).toUpperCase().match(/(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*(?:\s+(\d{1,2}):(\d{2}))?/);
  if(!m)return{date:'',time:''};
  return{date:`${year||new Date().getUTCFullYear()}-${months[m[2]]}-${pad(m[1])}`,time:m[3]?`${pad(m[3])}:${m[4]}`:''};
}

function parseTerminal(html,mawb){
  const text=clean(html),digits=mawb.replace(/\D/g,''),serial=digits.slice(3);
  if((!text.includes(digits)&&!text.includes(serial))||/Reject Reason|is not found/i.test(text))return null;
  const od=text.match(/AWB Type\s+(?:Import|Export)\s+([A-Z]{3})\s+([A-Z]{3})/i)||text.match(/Origin\s+Destination\s+([A-Z]{3})\s+([A-Z]{3})/i);
  const rcs=text.match(/Received from Shipper[\s\S]{0,500}?(\d{1,2}\s+[A-Z]{3}\s+20\d{2}\s+\d{1,2}:\d{2})\s+(\d{1,6})\s+([\d,.]+)/i);
  const depSection=(text.match(/Departure Flight[\s\S]{0,1000}?(?=Received from Flight|Cargo Delivered|Last Update|$)/i)||[])[0]||'';
  const deps=[...depSection.matchAll(/\b(CX\d{2,4})\s+(\d{1,2}\s+[A-Z]{3}\s+20\d{2})\s+(\d{1,2}:\d{2})\s*\(STD\)\s+(\d{1,6})\s+([\d,.]+)/gi)],dep=deps.at(-1);
  const rcfSection=(text.match(/Received from Flight[\s\S]{0,1900}?(?=Cargo Delivered|Last Update|$)/i)||[])[0]||'';
  const rcfs=[...rcfSection.matchAll(/\b(CX\d{2,4})\s+(\d{1,2}\s+[A-Z]{3}\s+20\d{2})(?:\s+\d{1,2}:\d{2})?\s+(\d{1,6})\s+([\d,.]+)\s+(\d{1,2}\s+[A-Z]{3}\s+20\d{2}\s+\d{1,2}:\d{2})/gi)],rcf=rcfs.at(-1);
  const arrival=rcf?dt(rcf[5]):{date:'',time:''};
  const delivered=/Cargo Delivered\s*\(DLV\)|Cargo Delivered/i.test(text);
  const pieces=rcf?.[3]||dep?.[4]||rcs?.[2]||'';
  const weight=(rcf?.[4]||dep?.[5]||rcs?.[3]||'').replace(/,/g,'');
  const flightNo=(rcf?.[1]||dep?.[1]||'').toUpperCase();
  const bookingDate=rcs?dt(rcs[1]).date:'';
  const status=delivered?'DELIVERED':rcf?'ARRIVED':dep?'IN TRANSIT':rcs?'BOOKED':'TRACKING';
  return{mawb,carrierCode:'CX',airlineName:'Cathay Cargo',origin:od?.[1]||'',destination:od?.[2]||'',bags:pieces,pieces,weight,bookingDate,flightNo,arrivalDate:arrival.date,arrivalTime:arrival.time,arrivalIsActual:Boolean(rcf&&arrival.date),status,officialTracker:CATHAY,source:'Cathay Cargo Terminal official tracking'};
}

function parseBookingCard(raw='',mawb=''){
  const text=clean(raw);
  const route=text.match(/\b([A-Z]{3})\s+to\s+([A-Z]{3})\b/i);
  const origin=route?.[1]?.toUpperCase()||'';
  const destination=route?.[2]?.toUpperCase()||'';
  const flightNo=((text.match(/\b(CX\s*\d{2,4})\b/i)||[])[1]||'').replace(/\s+/g,'').toUpperCase();
  const pieces=(text.match(/\b(\d{1,5})\s*pc(?:\(s\)|s)?\b/i)||[])[1]||'';
  const weight=((text.match(/\b([\d,.]+)\s*kg\b/i)||[])[1]||'').replace(/,/g,'');
  const fullDate=(text.match(/\b(\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s+20\d{2})\b/i)||[])[1]||'';
  const bookingDate=fullDate?dt(fullDate).date:'';
  const year=(fullDate.match(/20\d{2}/)||[])[0]||String(new Date().getUTCFullYear());
  let arrivalDate='',arrivalTime='',arrivalIsActual=false;
  if(destination){
    const esc=destination.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    let m=text.match(new RegExp(`\\b${esc}\\b[\\s\\S]{0,140}?(\\d{1,2}\\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\\s+\\d{1,2}:\\d{2})[\\s\\S]{0,45}?\\bActual\\b`,'i'));
    if(m){const x=dm(m[1],year);arrivalDate=x.date;arrivalTime=x.time;arrivalIsActual=true;}
    if(!arrivalDate){
      m=text.match(new RegExp(`\\b${esc}\\b[\\s\\S]{0,180}?(\\d{1,2}\\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\\s+\\d{1,2}:\\d{2})`,'i'));
      if(m){const x=dm(m[1],year);arrivalDate=x.date;arrivalTime=x.time;}
    }
  }
  if(!arrivalDate){
    const eta=text.match(/(?:estimated\s+arrival|\bETA\b)[\s:.-]{0,30}(\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*(?:\s+20\d{2})?\s+\d{1,2}:\d{2})/i);
    if(eta){const x=/20\d{2}/.test(eta[1])?dt(eta[1]):dm(eta[1],year);arrivalDate=x.date;arrivalTime=x.time;}
  }
  const topArrived=destination?new RegExp(`\\b${destination}\\s+Arrived\\b`,'i').test(text):false;
  if(topArrived&&arrivalDate)arrivalIsActual=true;
  return{mawb,carrierCode:'CX',airlineName:'Cathay Cargo',origin,destination,bags:pieces,pieces,weight,bookingDate,flightNo,arrivalDate,arrivalTime,arrivalIsActual,status:arrivalIsActual?'ARRIVED':'IN TRANSIT',officialTracker:CATHAY,source:'Cathay Cargo official Track & Trace'};
}

async function getTerminal(mawb){
  const suffix=mawb.replace(/\D/g,'').slice(3);let last='';
  for(const url of [`${BASE}/AWBPrefix/160/AWBSuffix/${suffix}`,`${BASE}?AWBPrefix=160&AWBSuffix=${suffix}`]){
    try{
      const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0','accept-language':'en-US,en;q=0.9'},cache:'no-store',signal:AbortSignal.timeout(5000)});
      last=`HTTP ${r.status}`;if(!r.ok)continue;
      const parsed=parseTerminal(await r.text(),mawb);if(parsed)return{ok:true,shipment:parsed,last};
    }catch(e){last=e?.message||String(e);}
  }
  return{ok:false,last};
}

async function officialCathay(mawb){
  let browser,killTimer;const digits=mawb.replace(/\D/g,'');
  const debug={fillMode:'',trackClicked:false,bookingFound:false,registered:false};
  try{
    chromium.setGraphicsMode=false;
    browser=await puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox','--disable-http2','--disable-quic'],defaultViewport:{width:1440,height:1100},executablePath:await chromium.executablePath(),headless:'shell'});
    const proc=browser.process?.();
    killTimer=setTimeout(()=>{try{proc?.kill('SIGKILL');}catch{}},32000);
    const page=await browser.newPage();page.setDefaultTimeout(6000);
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36');
    await page.goto(CATHAY,{waitUntil:'domcontentloaded',timeout:14000});await sleep(1300);

    for(const label of ['Reject all','Accept all']){
      try{await page.locator(`::-p-aria([name="${label}"][role="button"])`).click();debug.cookie=label;await sleep(300);break;}catch{}
    }

    let filled=false;
    for(const selector of [
      '::-p-aria([name="Air Waybill number(s)"][role="textbox"])',
      '::-p-aria([name="Air Waybill number(s)"])'
    ]){
      try{
        await page.locator(selector).fill(digits);
        debug.fillMode=`aria:${selector}`;filled=true;break;
      }catch{}
    }
    if(!filled){
      try{
        const label=await page.waitForSelector('::-p-text("Air Waybill number(s)")',{timeout:3500});
        if(label){await label.click();await sleep(250);await page.keyboard.type(digits,{delay:45});debug.fillMode='text-label';filled=true;}
      }catch{}
    }
    if(!filled)return{ok:false,reason:'CATHAY AWB CONTROL NOT EDITABLE',debug};
    await page.keyboard.press('Tab').catch(()=>{});await sleep(650);

    debug.registration=await page.evaluate(d=>{
      const norm=s=>String(s||'').replace(/\D/g,'');
      const body=norm(document.body?.innerText||'');
      const vals=[...document.querySelectorAll('input,textarea')].map(e=>String(e.value||'')).filter(Boolean);
      return{bodyHas:body.includes(d),values:vals.slice(0,12),valuesHave:vals.map(norm).some(v=>v.includes(d))};
    },digits).catch(()=>({bodyHas:false,values:[],valuesHave:false}));
    debug.registered=Boolean(debug.registration.bodyHas||debug.registration.valuesHave);

    try{await page.locator('::-p-aria([name="Track now"][role="button"])').click();debug.trackClicked=true;}catch{
      try{await page.locator('::-p-text("Track now")').click();debug.trackClicked=true;}catch{}
    }
    if(!debug.trackClicked)return{ok:false,reason:'CATHAY TRACK NOW NOT CLICKED',debug};

    await page.waitForFunction(()=>/Booking Status|Current status:|Shipment In Progress/i.test(document.body?.innerText||''),{timeout:11000}).catch(()=>{});
    await sleep(900);

    let bookingText='';
    try{
      const h=await page.waitForSelector('::-p-text("Booking Status")',{timeout:4500});
      if(h){
        debug.bookingFound=true;
        bookingText=await h.evaluate(el=>{
          let p=el,best='';
          for(let i=0;i<8&&p;i++,p=p.parentElement){
            const t=(p.innerText||p.textContent||'').trim();
            if(t.length>best.length&&t.length<9000)best=t;
            if(/CX\s*\d{2,4}/i.test(t)&&/\b[A-Z]{3}\s+to\s+[A-Z]{3}\b/i.test(t)&&/pc\(s\)|kg/i.test(t))return t;
          }
          return best;
        }).catch(()=>'');
      }
    }catch{}
    const bodyText=await page.evaluate(()=>document.body?.innerText||'').catch(()=>'');
    const combined=`${bookingText}\n${bodyText}`;
    debug.bookingText=clean(bookingText).slice(0,4500);
    debug.bodyText=clean(bodyText).slice(0,4500);
    const shipment=parseBookingCard(combined,mawb);
    if(!shipment.origin||!shipment.destination||!shipment.flightNo)return{ok:false,reason:'CATHAY BOOKING STATUS NOT READ',debug,shipment};
    return{ok:true,shipment,debug};
  }catch(e){return{ok:false,reason:e?.message||String(e),debug};}
  finally{
    if(killTimer)clearTimeout(killTimer);
    if(browser){
      try{await Promise.race([browser.close(),sleep(1200)]);}catch{}
      try{browser.process?.()?.kill('SIGKILL');}catch{}
    }
  }
}

export async function trackCathay(input){
  const mawb=normalizeMawb(input);
  if(!mawb||!mawb.startsWith('160-'))return{ok:false,reason:'INVALID CATHAY MAWB',airline:AIRLINE};

  const [terminal,live]=await Promise.all([getTerminal(mawb),officialCathay(mawb)]);
  if(live.ok){
    const t=terminal.ok?terminal.shipment:{};const s=live.shipment||{};
    const shipment={...t,...s,origin:s.origin||t.origin||'',destination:s.destination||t.destination||'',bags:s.bags||t.bags||'',pieces:s.pieces||t.pieces||'',weight:s.weight||t.weight||'',bookingDate:s.bookingDate||t.bookingDate||'',flightNo:s.flightNo||t.flightNo||'',arrivalDate:s.arrivalDate||t.arrivalDate||'',arrivalTime:s.arrivalTime||t.arrivalTime||'',arrivalIsActual:Boolean(s.arrivalIsActual||t.arrivalIsActual),status:s.arrivalIsActual?'ARRIVED':(t.status||s.status||'IN TRANSIT'),source:'Cathay Cargo official Track & Trace'};
    if(shipment.arrivalIsActual)shipment.status='ARRIVED';
    return{ok:true,airline:AIRLINE,shipment,debug:{stage:'SUCCESS',source:'cathay-official-booking-status',live:live.debug,terminal:terminal.last}};
  }
  if(terminal.ok)return{ok:true,airline:AIRLINE,shipment:terminal.shipment,debug:{stage:'SUCCESS',source:'cathay-terminal',browserFallback:live.reason,live:live.debug}};
  return{ok:false,reason:'CATHAY TRACKING FAILED',airline:AIRLINE,debug:{live,terminal}};
}