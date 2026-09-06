import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { normalizeMawb } from './airlines.js';

const EN_URL='https://saudiacargo.com/e-services/track-shipment';
const CN_URL='https://china.saudiacargo.com/e-services/track-shipment';
const MONTHS={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
const pad=v=>String(v).padStart(2,'0');
const first=(s,rx)=>(String(s).match(rx)||[])[1]||'';

function translate(s=''){
  return String(s)
    .replace(/货物追踪|追踪货物/g,'Track Shipment')
    .replace(/目的地/g,'Destination')
    .replace(/始发地|起点|出发地/g,'Origin')
    .replace(/件数/g,'Pieces')
    .replace(/航段/g,'Segment')
    .replace(/航班/g,'Flight')
    .replace(/重量/g,'Weight')
    .replace(/到达|抵达|到港/g,'Arrived')
    .replace(/出发|离港|起飞/g,'Departed')
    .replace(/日期/g,'Date')
    .replace(/时间/g,'Time')
    .replace(/已交付/g,'Delivered')
    .replace(/计划航班/g,'Planned For Flight')
    .replace(/已配载/g,'Manifested on Flight')
    .replace(/异常/g,'Discrepancy')
    .replace(/\s+/g,' ')
    .trim();
}
function parseDate(s=''){
  let m=String(s).match(/\b([0-3]?\d)\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[A-Za-z]*\s+(20\d{2})\b/i);
  if(m)return`${m[3]}-${MONTHS[m[2].slice(0,3).toUpperCase()]}-${pad(m[1])}`;
  m=String(s).match(/\b(20\d{2})[-\/.]([01]?\d)[-\/.]([0-3]?\d)\b/);if(m)return`${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m=String(s).match(/\b([0-3]?\d)[-\/.]([01]?\d)[-\/.](20\d{2})\b/);if(m)return`${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  return'';
}
function parseTime(s=''){const m=String(s).match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);return m?`${pad(m[1])}:${m[2]}`:'';}
function stamp(e={}){const t=Date.parse(`${e.date||''}T${e.time||'00:00'}:00Z`);return Number.isFinite(t)?t:0;}
function timelineEvents(raw=''){
  const text=translate(raw),rx=/\b([0-3]?\d)\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[A-Za-z]*\s+(20\d{2})\s+([01]?\d|2[0-3]):([0-5]\d)\b/gi;
  const hits=[...text.matchAll(rx)],events=[];
  for(let i=0;i<hits.length;i++){
    const h=hits[i],start=h.index||0,end=i+1<hits.length?(hits[i+1].index||text.length):text.length;
    events.push({date:`${h[3]}-${MONTHS[h[2].slice(0,3).toUpperCase()]}-${pad(h[1])}`,time:`${pad(h[4])}:${h[5]}`,text:text.slice(start,end).trim()});
  }
  return events;
}
function isArrival(t=''){return /\bARRIVED?\b|\(ARR\)|\bRCF\b|RECEIVED\s+FROM\s+FLIGHT|RECEIVED\s+AT\s+DESTINATION|ACTUAL\s+ARRIVAL|LANDED/i.test(t);}
function isDeparture(t=''){return /\bDEPARTED?\b|\(DEP\)|AIRBORNE|IN\s+TRANSIT/i.test(t);}
function isBooking(t=''){return /\bRCS\b|RECEIVED\s+FROM\s+SHIPPER|\bBOOKED\b|\bACCEPTED\b/i.test(t);}
function isManifest(t=''){return /MANIFESTED\s+ON\s+FLIGHT|\(MAN\)|PLANNED\s+FOR\s+FLIGHT/i.test(t);}
function eventFields(e={}){
  const text=String(e.text||''),upper=text.toUpperCase();
  const fm=upper.match(/\bSV[-\s]?(\d{2,4})\b/);
  const dest=upper.match(/\bTO\b[\s\S]{0,160}?\(([A-Z]{3})\)/)||upper.match(/\bDESTINATION\b\s*[:\-]?\s*([A-Z]{3})\b/);
  const locs=[...upper.matchAll(/\(([A-Z]{3})\)/g)].map(m=>m[1]).filter(x=>!['ARR','RCF','MAN','DIS','DEP','RCS'].includes(x));
  return{flightNo:fm?`SV${fm[1]}`:'',destination:dest?.[1]||'',locations:locs,pieces:first(text,/(?:pieces?|pcs?)\s*[:\-]?\s*(\d{1,6})/i),weight:(first(text,/(?:weight|gross weight)\s*[:\-]?\s*([\d,.]+)/i)||'').replace(/,/g,'')};
}
function parseResult(raw,mawb){
  const text=translate(raw),upper=text.toUpperCase(),events=timelineEvents(raw),chron=[...events].sort((a,b)=>stamp(a)-stamp(b)),latest=[...chron].reverse();
  const arrival=latest.find(e=>isArrival(e.text))||null;
  const operational=latest.find(e=>isArrival(e.text)||isDeparture(e.text)||isManifest(e.text)||isBooking(e.text))||latest[0]||null;
  const booking=chron.find(e=>isBooking(e.text))||chron.find(e=>isManifest(e.text))||null;
  const af=eventFields(arrival||{}),of=eventFields(operational||{});
  const route=upper.match(/\bORIGIN\b\s*[:\-]?\s*([A-Z]{3})\b[\s\S]{0,240}?\bDESTINATION\b\s*[:\-]?\s*([A-Z]{3})\b/);
  let destination=af.destination||of.destination||route?.[2]||'',origin=route?.[1]||'';
  if(!destination){for(const e of latest){const f=eventFields(e);if(f.destination){destination=f.destination;break;}}}
  if(!origin){for(const e of chron){const f=eventFields(e),c=f.locations.find(x=>x!==destination);if(c){origin=c;break;}}}
  const sv=[...upper.matchAll(/\bSV[-\s]?(\d{2,4})\b/g)];
  const flightNo=af.flightNo||of.flightNo||(sv.length?`SV${sv[sv.length-1][1]}`:'');
  const pieces=af.pieces||of.pieces||first(text,/(?:Pieces?|Pcs?|Number of Pieces)\s*[:\-]?\s*(\d{1,6})/i);
  const weight=(af.weight||of.weight||first(text,/(?:Gross Weight|Weight)\s*[:\-]?\s*([\d,.]+)/i)||'').replace(/,/g,'');
  let status='TRACKING';
  if(arrival)status='ARRIVED';else if(operational&&isDeparture(operational.text))status='IN TRANSIT';else if(operational&&(isManifest(operational.text)||isBooking(operational.text)))status='BOOKED';
  const shipment={mawb,carrierCode:'SV',airlineName:'Saudia Cargo',origin,destination,bags:pieces,pieces,weight,flightNo,bookingDate:booking?.date||'',arrivalDate:arrival?.date||'',arrivalTime:arrival?.time||'',arrivalIsActual:Boolean(arrival?.date&&arrival?.time),status,officialTracker:CN_URL,source:'Saudia Cargo direct shipment timeline'};
  return{shipment,events,arrival,operational,useful:Boolean(origin||destination||pieces||weight||flightNo||shipment.bookingDate||shipment.arrivalDate||shipment.arrivalTime||status!=='TRACKING')};
}
async function collectText(page){
  const parts=[];
  for(const frame of page.frames()){
    try{const t=await frame.evaluate(()=>document.body?.innerText||'');if(t)parts.push(t);}catch{}
  }
  return parts.join('\n');
}
async function fillAndSubmit(page,mawb){
  const inputs=await page.$$('input');
  let target=null;
  for(const input of inputs){
    const meta=await input.evaluate(e=>`${e.placeholder||''} ${e.name||''} ${e.id||''} ${e.getAttribute('aria-label')||''}`);
    if(/065-000000|awb|airway|shipment/i.test(meta)){target=input;break;}
  }
  if(!target&&inputs.length)target=inputs[0];
  if(!target)return{filled:false,clicked:false,mode:'no-input'};
  await target.click({clickCount:3}).catch(()=>{});await page.keyboard.press('Control+A').catch(()=>{});await page.keyboard.type(mawb,{delay:25});
  const info=await target.boundingBox();
  const buttons=await page.$$('button,[role="button"],a,input[type="submit"]');
  for(const b of buttons){
    try{
      const v=await b.evaluate(e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return{visible:s.display!=='none'&&s.visibility!=='hidden'&&r.width>12&&r.height>8,text:(e.innerText||e.value||e.getAttribute('aria-label')||e.title||'').replace(/\s+/g,' ').trim(),left:r.left,top:r.top,width:r.width,height:r.height};});
      if(!v.visible)continue;
      const label=v.text;
      const near=info&&v.left>=info.x+info.width-12&&v.left<=info.x+info.width+180&&Math.abs((v.top+v.height/2)-(info.y+info.height/2))<90;
      if(/track\s*shipment|追踪货物|^(track|search|go|→|›|>)$/i.test(label)||near){await b.click().catch(()=>{});return{filled:true,clicked:true,mode:label||'arrow-icon'};}
    }catch{}
  }
  await target.press('Enter').catch(()=>{});return{filled:true,clicked:true,mode:'enter'};
}
async function runOne(browser,url,mawb){
  const page=await browser.newPage(),network=[];
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36');
  await page.setExtraHTTPHeaders({'Accept-Language':'en-US,en;q=0.9'});
  page.on('response',async r=>{try{const ct=r.headers()['content-type']||'',u=r.url();if((/json|text/i.test(ct)||/track|shipment|awb/i.test(u))&&network.length<20){const t=await r.text();if(t&&t.length<50000)network.push(t);}}catch{}});
  try{
    await page.goto(url,{waitUntil:'domcontentloaded',timeout:22000});await new Promise(r=>setTimeout(r,1800));
    const setup=await fillAndSubmit(page,mawb);
    await Promise.race([page.waitForNetworkIdle({idleTime:900,timeout:12000}).catch(()=>{}),new Promise(r=>setTimeout(r,12000))]);
    await new Promise(r=>setTimeout(r,1800));
    await page.evaluate(async()=>{const sleep=ms=>new Promise(r=>setTimeout(r,ms));for(let i=0;i<10;i++){window.scrollTo(0,document.body.scrollHeight);await sleep(220);}for(const e of [...document.querySelectorAll('*')].filter(e=>e.scrollHeight>e.clientHeight+120).slice(-12)){try{e.scrollTop=e.scrollHeight}catch{}}}).catch(()=>{});
    await new Promise(r=>setTimeout(r,900));
    const visible=await collectText(page),combined=`${visible}\n${network.join('\n')}`,parsed=parseResult(combined,mawb);
    const screenshotBase64=await page.screenshot({type:'jpeg',quality:68,fullPage:false,encoding:'base64'}).catch(()=>null);
    return{...parsed,setup,screenshotBase64,pageText:translate(visible).slice(0,12000)};
  }finally{await page.close().catch(()=>{});}
}
export async function trackSaudiaWithBrowser(input){
  const mawb=normalizeMawb(input);if(!mawb||!mawb.startsWith('065-'))return{ok:false,reason:'INVALID SAUDIA MAWB',officialTracker:CN_URL};
  let browser;
  try{
    chromium.setGraphicsMode=false;
    browser=await puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox'],defaultViewport:{width:1440,height:1100},executablePath:await chromium.executablePath(),headless:'shell'});
    for(const url of [EN_URL,CN_URL]){
      const r=await runOne(browser,url,mawb);
      if(r.useful&&r.shipment?.arrivalDate&&r.shipment?.arrivalTime)return{ok:true,shipment:r.shipment,screenshotBase64:r.screenshotBase64,debug:{stage:'SUCCESS_ARRIVAL',url,setup:r.setup,eventCount:r.events.length,arrivalEvent:r.arrival?.text?.slice(0,600)||'',pageText:r.pageText}};
      if(r.useful&&r.shipment?.status!=='TRACKING')return{ok:true,shipment:r.shipment,screenshotBase64:r.screenshotBase64,debug:{stage:'SUCCESS_PARTIAL',url,setup:r.setup,eventCount:r.events.length,latestEvent:r.operational?.text?.slice(0,600)||'',pageText:r.pageText}};
    }
    return{ok:false,reason:'SAUDIA RESULT OPENED BUT NO VERIFIED TIMELINE FIELDS FOUND',officialTracker:CN_URL,debug:{stage:'NO_FIELDS'}};
  }catch(e){return{ok:false,reason:`SAUDIA BROWSER ERROR: ${e?.message||e}`,officialTracker:CN_URL,debug:{stage:'ERROR'}};}
  finally{try{if(browser)await browser.close()}catch{}}
}
