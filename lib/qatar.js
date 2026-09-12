import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { normalizeMawb } from './airlines.js';

const OFFICIAL='https://www.qrcargo.com/s/track-your-shipment';
const AIRLINE={name:'Qatar Airways Cargo',iata:'QR',url:OFFICIAL};
const MONTHS={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
const pad=v=>String(v).padStart(2,'0');
const clean=s=>String(s||'').replace(/\s+/g,' ').trim();

function officialUrl(mawb=''){
  const serial=String(mawb).slice(4);
  return `${OFFICIAL}?documentNumber=${encodeURIComponent(serial)}&documentPrefix=157&documentType=MAWB`;
}

function parseDate(s=''){
  const x=String(s).toUpperCase();
  let m=x.match(/\b(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})\b/);
  if(m)return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m=x.match(/\b(\d{1,2})[-\/.](\d{1,2})[-\/.](20\d{2})\b/);
  if(m)return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  m=x.match(/\b(\d{1,2})[-\s]+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[-\s,]+(20\d{2})\b/);
  if(m)return `${m[3]}-${MONTHS[m[2]]}-${pad(m[1])}`;
  return '';
}

function parseTime(s=''){
  const m=String(s).match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  return m?`${pad(m[1])}:${m[2]}`:'';
}

function routeFromText(flat=''){
  const m=flat.match(/\b157[-\s]?\d{8}\s*\(\s*([A-Z]{3})\s*-\s*([A-Z]{3})\s*\)/i)
    ||flat.match(/\b([A-Z]{3})\s*(?:→|->|—|-)\s*([A-Z]{3})\b/i);
  return {origin:(m?.[1]||'').toUpperCase(),destination:(m?.[2]||'').toUpperCase()};
}

function headerTotals(flat=''){
  const m=flat.match(/\b(\d{1,6})\s*Piece\(s\)\s*\|\s*([\d,.]+)\s*Kg/i)
    ||flat.match(/\b(\d{1,6})\s*(?:PCS|PIECES?)\s*\|?\s*([\d,.]+)\s*KG/i);
  return {pieces:m?.[1]||'',weight:(m?.[2]||'').replace(/,/g,'')};
}

function shipmentHeaderStatus(flat='',mawb=''){
  const serial=String(mawb).replace(/\D/g,'').slice(-8);
  const idx=flat.indexOf(serial);
  const window=idx>=0?flat.slice(idx,idx+500):flat.slice(0,700);
  if(/\bDelivered\b/i.test(window))return 'DELIVERED';
  if(/\bDelayed\b|\bLate\b|Offload|Exception/i.test(window))return 'DELAYED';
  if(/\bIn Transit\b/i.test(window))return 'IN TRANSIT';
  if(/\bBooked\b|\bAccepted\b/i.test(window))return 'BOOKED';
  return 'TRACKING';
}

function scheduledArrival(flat='',destination=''){
  if(!destination)return null;
  const esc=destination.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const rx=new RegExp(`(?:Estimated|Scheduled)\\s+Arrival\\s*\\(\\s*${esc}\\s*\\)\\s*([^|]{0,80})`,'i');
  const m=flat.match(rx);
  if(!m)return null;
  const arrivalDate=parseDate(m[1]);
  const arrivalTime=parseTime(m[1]);
  if(!arrivalDate&&!arrivalTime)return null;
  return {arrivalDate,arrivalTime,arrivalIsActual:false,source:'Qatar scheduled/estimated arrival',snippet:m[0]};
}

function actualDestinationArrival(flat='',destination=''){
  if(!destination)return null;
  const esc=destination.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const patterns=[
    new RegExp(`(?:Arrived|Landed|Received from flight|RCF|Delivered)[^.!]{0,80}\\b${esc}\\b[^.!]{0,140}`,'ig'),
    new RegExp(`\\b${esc}\\b[^.!]{0,80}(?:Arrived|Landed|Received from flight|RCF|Delivered)[^.!]{0,140}`,'ig')
  ];
  const candidates=[];
  for(const rx of patterns){for(const m of flat.matchAll(rx)){const s=m[0];const d=parseDate(s),t=parseTime(s);if(d||t)candidates.push({arrivalDate:d,arrivalTime:t,arrivalIsActual:true,source:'Qatar destination actual arrival event',snippet:s,index:m.index||0});}}
  return candidates.sort((a,b)=>a.index-b.index).at(-1)||null;
}

function finalFlightNo(flat='',destination=''){
  const sched=destination?scheduledArrival(flat,destination):null;
  const start=sched?Math.max(0,flat.indexOf(sched.snippet)-500):0;
  const endIdx=flat.indexOf('Tracking Details');
  const block=flat.slice(start,endIdx>start?endIdx:start+2200);
  const all=[...block.matchAll(/\bQR\s*[- ]?(\d{2,4})\b/gi)];
  if(all.length)return `QR${all.at(-1)[1].padStart(4,'0')}`;
  return '';
}

function bookingDateFromText(flat='',origin=''){
  const esc=origin?origin.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'):'[A-Z]{3}';
  const m=flat.match(new RegExp(`Received from shipper in\\s+${esc}[^.!]{0,160}`,'i'));
  return m?parseDate(m[0]):'';
}

function parseShipment(text,mawb){
  const flat=clean(text);
  const {origin,destination}=routeFromText(flat);
  const {pieces,weight}=headerTotals(flat);
  const actual=actualDestinationArrival(flat,destination);
  const sched=scheduledArrival(flat,destination);
  const arrival=actual||sched||{arrivalDate:'',arrivalTime:'',arrivalIsActual:false,source:'',snippet:''};
  let status=shipmentHeaderStatus(flat,mawb);
  if(actual)status=/Delivered/i.test(actual.snippet)?'DELIVERED':'ARRIVED';
  else if(status==='ARRIVED')status='IN TRANSIT';
  const flightNo=finalFlightNo(flat,destination);
  const bookingDate=bookingDateFromText(flat,origin);
  return {
    mawb,carrierCode:'QR',airlineName:AIRLINE.name,officialTracker:officialUrl(mawb),
    origin,destination,bags:pieces,pieces,weight,flightNo,
    arrivalDate:arrival.arrivalDate,arrivalTime:arrival.arrivalTime,
    arrivalIsActual:arrival.arrivalIsActual,arrivalTimeSource:arrival.source,
    bookingDate,bookingDateSource:bookingDate?'Official received-from-shipper event':'',
    status,source:'Qatar Cargo dedicated official browser adapter',arrivalEvidence:arrival.snippet
  };
}

function useful(s={}){
  return Boolean((s.origin&&s.destination)||s.pieces||s.weight||s.flightNo||s.arrivalDate||s.arrivalTime||(s.status&&s.status!=='TRACKING'));
}

async function launch(){
  chromium.setGraphicsMode=false;
  return puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox'],defaultViewport:{width:1440,height:1100,deviceScaleFactor:1},executablePath:await chromium.executablePath(),headless:'shell'});
}

async function acceptCookies(page){
  await page.evaluate(()=>{
    const els=[...document.querySelectorAll('button,[role="button"]')];
    const b=els.find(e=>/accept all|accept cookies|allow all|agree/i.test((e.innerText||e.getAttribute('aria-label')||'').trim()));
    if(b)b.click();
  }).catch(()=>{});
}

export async function trackQatar(input){
  const mawb=normalizeMawb(input);
  if(!mawb||!mawb.startsWith('157-'))return{ok:false,reason:'INVALID QATAR AIRWAYS CARGO MAWB',airline:AIRLINE,officialTracker:OFFICIAL};
  const url=officialUrl(mawb),serial=mawb.slice(4);let browser;
  try{
    browser=await launch();
    const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36');
    await page.goto(url,{waitUntil:'domcontentloaded',timeout:18000});
    await new Promise(r=>setTimeout(r,1800));
    await acceptCookies(page);
    await new Promise(r=>setTimeout(r,300));

    const setup=await page.evaluate(({serial})=>{
      const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>20&&r.height>10&&!e.disabled};
      const inputs=[...document.querySelectorAll('input')].filter(visible);
      const desc=e=>`${e.name||''} ${e.id||''} ${e.placeholder||''} ${e.getAttribute('aria-label')||''}`.toLowerCase();
      const set=(e,v)=>{const d=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');d?.set?.call(e,v);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));};
      const prefix=inputs.find(e=>/prefix/.test(desc(e)));
      let num=inputs.find(e=>/document|awb|airway|shipment/.test(desc(e))&&!/prefix/.test(desc(e)));
      if(!num)num=inputs.find(e=>String(e.value||'').replace(/\D/g,'').includes(serial));
      if(prefix&&String(prefix.value||'')!=='157')set(prefix,'157');
      if(num&&String(num.value||'').replace(/\D/g,'')!==serial)set(num,serial);
      return{hasNumber:Boolean(num),numberValue:num?.value||'',prefixValue:prefix?.value||'',inputCount:inputs.length};
    },{serial}).catch(()=>({hasNumber:false}));

    let clicked=await page.evaluate(()=>{
      const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>20&&r.height>10&&!e.disabled};
      const els=[...document.querySelectorAll('button,input[type="submit"],[role="button"]')].filter(visible);
      const label=e=>(e.innerText||e.value||e.getAttribute('aria-label')||e.getAttribute('title')||'').replace(/\s+/g,' ').trim();
      const target=els.map(e=>({e,t:label(e)})).find(x=>/track\s*shipment/i.test(x.t));
      if(target){target.e.scrollIntoView({block:'center'});target.e.click();return target.t;}return'';
    }).catch(()=> '');

    if(!clicked){
      for(const selector of ['button::-p-text(Track Shipment(s))','::-p-aria(Track Shipment(s))','::-p-text(Track Shipment(s))']){
        try{await page.locator(selector).click({timeout:3500});clicked=`shadow:${selector}`;break;}catch{}
      }
    }

    if(clicked){
      await Promise.race([page.waitForNetworkIdle({idleTime:800,timeout:10000}).catch(()=>{}),new Promise(r=>setTimeout(r,10000))]);
      await new Promise(r=>setTimeout(r,1400));
    }else if(setup.hasNumber){
      await page.keyboard.press('Enter').catch(()=>{});
      await new Promise(r=>setTimeout(r,5000));
    }

    const text=await page.evaluate(()=>document.body?.innerText||'').catch(()=> '');
    if(/captcha|verify you are human|security check|cloudflare|turnstile|access denied/i.test(text))return{ok:false,reason:'QATAR SECURITY CHECK REQUIRES MANUAL CHECK',airline:AIRLINE,officialTracker:url,debug:{stage:'CAPTCHA',setup,clicked}};

    const shipment=parseShipment(text,mawb);
    const screenshotBase64=await page.screenshot({type:'jpeg',quality:65,fullPage:false,encoding:'base64'}).catch(()=>null);
    if(useful(shipment))return{ok:true,airline:AIRLINE,shipment,screenshotCaptured:Boolean(screenshotBase64),screenshotVerified:Boolean(screenshotBase64),screenshotBase64,debug:{stage:'SUCCESS',url,setup,clicked,arrivalEvidence:shipment.arrivalEvidence||'',textSample:clean(text).slice(0,5000)}};
    return{ok:false,reason:'QATAR OFFICIAL PAGE RETURNED NO VERIFIED SHIPMENT DATA',airline:AIRLINE,officialTracker:url,screenshotBase64,debug:{stage:'NO_DATA',setup,clicked,textSample:clean(text).slice(0,5000)}};
  }catch(e){
    return{ok:false,reason:`QATAR TRACKING ERROR: ${e?.message||e}`,airline:AIRLINE,officialTracker:url,debug:{stage:'ERROR'}};
  }finally{
    try{if(browser)await browser.close()}catch{}
  }
}
