import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { normalizeMawb } from './airlines.js';

const URL='https://china.saudiacargo.com/e-services/track-shipment';
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
    .replace(/实际到达|到达|抵达|到港|已到达/g,'Arrived')
    .replace(/已从航班接收|从航班接收/g,'Received from Flight')
    .replace(/出发|离港|起飞|已起飞/g,'Departed')
    .replace(/日期/g,'Date')
    .replace(/时间/g,'Time')
    .replace(/已交付/g,'Delivered')
    .replace(/计划航班/g,'Planned For Flight')
    .replace(/已配载/g,'Manifested on Flight')
    .replace(/异常/g,'Discrepancy')
    .replace(/\s+/g,' ')
    .trim();
}
function isoDateFromCompact(day,mon,yy){
  const m=MONTHS[String(mon).slice(0,3).toUpperCase()];
  if(!m)return'';
  const year=String(yy).length===2?`20${yy}`:String(yy);
  return`${year}-${m}-${pad(day)}`;
}
function eventTimestamp(e={}){const t=Date.parse(`${e.date||''}T${e.time||'00:00'}:00Z`);return Number.isFinite(t)?t:0}
function timelineEvents(raw=''){
  const text=translate(raw).replace(/\s+/g,' ').trim();
  const anchors=[];
  for(const m of text.matchAll(/\b([01]?\d|2[0-3]):([0-5]\d)\s*[-–—]\s*([0-3]?\d)(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{2,4})\s+local\s+time\b/gi)){
    anchors.push({index:m.index||0,date:isoDateFromCompact(m[3],m[4],m[5]),time:`${pad(m[1])}:${m[2]}`,source:'compact'});
  }
  for(const m of text.matchAll(/\b([0-3]?\d)\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[A-Za-z]*\s+(20\d{2})\s+([01]?\d|2[0-3]):([0-5]\d)\b/gi)){
    anchors.push({index:m.index||0,date:`${m[3]}-${MONTHS[m[2].slice(0,3).toUpperCase()]}-${pad(m[1])}`,time:`${pad(m[4])}:${m[5]}`,source:'verbose'});
  }
  anchors.sort((a,b)=>a.index-b.index);
  const dedup=[];for(const a of anchors){if(!dedup.some(x=>Math.abs(x.index-a.index)<8))dedup.push(a)}
  const events=[];
  for(let i=0;i<dedup.length;i++){
    const a=dedup[i],end=i+1<dedup.length?dedup[i+1].index:Math.min(text.length,a.index+900);
    events.push({date:a.date,time:a.time,text:text.slice(a.index,end).trim(),source:a.source});
  }
  return events;
}
function eventFields(event={}){
  const text=String(event.text||''),upper=text.toUpperCase();
  const flight=upper.match(/\bSV[-\s]?(\d{2,4})\b/);
  const dest=upper.match(/\bTO\b[\s\S]{0,180}?\(([A-Z]{3})\)/)
    ||upper.match(/\bDESTINATION\b\s*[:\-]?\s*([A-Z]{3})\b/)
    ||upper.match(/,\s*([A-Z]{3})\b/);
  const locationCodes=[...upper.matchAll(/\(([A-Z]{3})\)/g)].map(m=>m[1]).filter(x=>!['ARR','RCF','MAN','DIS','DEP','RCS','DLV'].includes(x));
  const pieces=first(text,/(?:total\s+number\s+of\s+pieces|pieces?|pcs?|pieceCount|numberOfPieces)\s*[":=\-]?\s*"?(\d{1,6})/i);
  const weight=(first(text,/(?:weight|grossWeight|gross\s+weight)\s*[":=\-]?\s*"?([\d,.]+)/i)||'').replace(/,/g,'');
  return{flightNo:flight?`SV${flight[1]}`:'',destination:dest?.[1]||'',locationCodes,pieces,weight};
}
function isArrivalEvent(text=''){return /\bARRIVED?\b|\(ARR\)|\bRCF\b|RECEIVED\s+FROM\s+FLIGHT|RECEIVED\s+AT\s+DESTINATION|ACTUAL\s+ARRIVAL|LANDED/i.test(translate(text))}
function isDepartureEvent(text=''){return /\bDEPARTED?\b|\(DEP\)|AIRBORNE|IN\s+TRANSIT/i.test(translate(text))}
function isBookingEvent(text=''){return /\bRCS\b|RECEIVED\s+FROM\s+SHIPPER|\bBOOKED\b|\bACCEPTED\b/i.test(translate(text))}
function isManifestEvent(text=''){return /MANIFESTED\s+ON\s+FLIGHT|\(MAN\)|PLANNED\s+FOR\s+FLIGHT/i.test(translate(text))}
function isDelayEvent(text=''){return /DISCREPANCY|\(DIS\)|DELAY|LATE|OFFLOAD|EXCEPTION/i.test(translate(text))}

function parseResult(raw,mawb){
  const text=translate(raw),upper=text.toUpperCase(),events=timelineEvents(raw);
  const chronological=[...events].sort((a,b)=>eventTimestamp(a)-eventTimestamp(b)),latest=[...chronological].reverse();
  const headerDestination=first(upper,/\bDESTINATION\s*[:\-]?\s*([A-Z]{3})\b/);
  let arrivalEvent=latest.find(e=>isArrivalEvent(e.text)&&(eventFields(e).destination===headerDestination||!headerDestination))||latest.find(e=>isArrivalEvent(e.text))||null;
  const latestOperational=latest.find(e=>isArrivalEvent(e.text)||isDepartureEvent(e.text)||isManifestEvent(e.text)||isBookingEvent(e.text)||isDelayEvent(e.text))||latest[0]||null;
  const bookingEvent=chronological.find(e=>/\bRCS\b|RECEIVED\s+FROM\s+SHIPPER/i.test(e.text))||chronological.find(e=>isBookingEvent(e.text))||null;
  const af=eventFields(arrivalEvent||{}),lf=eventFields(latestOperational||{});
  const route=upper.match(/\bORIGIN\s*[:\-]?\s*([A-Z]{3})\b[\s\S]{0,260}?\bDESTINATION\s*[:\-]?\s*([A-Z]{3})\b/);
  let origin=route?.[1]||first(upper,/\bORIGIN\s*[:\-]?\s*([A-Z]{3})\b/),destination=af.destination||headerDestination||lf.destination||route?.[2]||'';
  if(!destination&&/INDIRA\s+GANDHI[\s\S]{0,60}?\(DEL\)/i.test(text))destination='DEL';
  if(!origin){for(const e of chronological){const f=eventFields(e),codes=f.locationCodes.filter(c=>c!==destination);if(codes.length){origin=codes[0];break;}}}
  if(!origin&&/KING\s+KHALED[\s\S]{0,60}?\(RUH\)/i.test(text))origin='RUH';
  const svRows=[...upper.matchAll(/\bSV[-\s]?(\d{2,4})\b/g)];
  const flightNo=af.flightNo||lf.flightNo||(svRows.length?`SV${svRows[svRows.length-1][1]}`:'');
  const pieces=af.pieces||lf.pieces||first(text,/(?:TOTAL\s+NUMBER\s+OF\s+PIECES|Pieces?|Pcs?)\s*[:\-]?\s*(\d{1,6})/i);
  const weight=(af.weight||lf.weight||first(text,/(?:Gross\s+Weight|Weight)\s*[:\-]?\s*([\d,.]+)/i)||'').replace(/,/g,'');
  let status='TRACKING';
  if(latestOperational){
    if(isArrivalEvent(latestOperational.text))status='ARRIVED';
    else if(isDepartureEvent(latestOperational.text))status='IN TRANSIT';
    else if(isDelayEvent(latestOperational.text))status='DELAYED';
    else if(isManifestEvent(latestOperational.text)||isBookingEvent(latestOperational.text))status='BOOKED';
  }else if(arrivalEvent)status='ARRIVED';
  const arrivalDate=arrivalEvent?.date||'',arrivalTime=arrivalEvent?.time||'',arrivalIsActual=Boolean(arrivalDate&&arrivalTime),bookingDate=bookingEvent?.date||'';
  const shipment={mawb,carrierCode:'SV',airlineName:'Saudia Cargo',origin,destination,bags:pieces,pieces,weight,flightNo,bookingDate,arrivalDate,arrivalTime,arrivalIsActual,status,officialTracker:URL,source:'Saudia Cargo direct track-shipment timeline'};
  const useful=events.length>0||Boolean(destination&&pieces)||Boolean(arrivalDate&&arrivalTime)||status!=='TRACKING';
  return useful?{shipment,events,arrivalEvent,latestOperational}:null;
}

async function deepText(frame){
  return frame.evaluate(()=>{
    const parts=[];const add=root=>{try{const t=root?.innerText||root?.textContent||'';if(t)parts.push(t);for(const e of root?.querySelectorAll?.('*')||[]){if(e.shadowRoot)add(e.shadowRoot)}}catch{}};add(document.body);return parts.join('\n');
  }).catch(()=> '');
}
async function snapshotText(page){
  const out=[];for(const frame of page.frames()){const t=await deepText(frame);if(t)out.push(t)}return out.join('\n');
}
async function crawlTimeline(page){
  const captures=[];let stable=0,last='';
  for(let i=0;i<24;i++){
    const text=await snapshotText(page);if(text)captures.push(text);
    const tail=translate(text).slice(-1200);stable=tail===last?stable+1:0;last=tail;
    await page.evaluate(()=>{
      try{window.scrollBy(0,Math.max(520,window.innerHeight*0.8));}catch{}
      const els=[...document.querySelectorAll('*')].filter(e=>e.scrollHeight>e.clientHeight+180);
      for(const e of els){try{e.scrollTop=Math.min(e.scrollHeight,e.scrollTop+Math.max(420,e.clientHeight*0.85));}catch{}}
    }).catch(()=>{});
    await new Promise(r=>setTimeout(r,260));
    if(stable>=5)break;
  }
  await page.evaluate(()=>{try{window.scrollTo(0,document.body?.scrollHeight||0);for(const e of document.querySelectorAll('*'))if(e.scrollHeight>e.clientHeight+180)e.scrollTop=e.scrollHeight}catch{}}).catch(()=>{});
  await new Promise(r=>setTimeout(r,500));captures.push(await snapshotText(page));
  return captures.join('\n');
}
async function findInput(page){
  return page.evaluate(()=>{
    const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>18&&r.height>10&&!e.disabled};
    const inputs=[...document.querySelectorAll('input')].filter(visible).filter(e=>!['hidden','checkbox','radio','submit','button'].includes((e.type||'text').toLowerCase()));
    const awb=inputs.find(e=>/awb|airway|shipment|065-000000/i.test(`${e.placeholder||''} ${e.name||''} ${e.id||''} ${e.getAttribute('aria-label')||''}`))||inputs[0];
    if(!awb)return false;awb.setAttribute('data-mayavi-awb','1');return true;
  }).catch(()=>false);
}
async function clickArrow(page){
  const marked=await page.evaluate(()=>{
    const awb=document.querySelector('[data-mayavi-awb="1"]');if(!awb)return false;
    const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>8&&r.height>8&&!e.disabled};
    const r=awb.getBoundingClientRect(),cy=r.top+r.height/2;
    const all=[...document.querySelectorAll('button,[role="button"],a,input[type="submit"]')].filter(visible).map(e=>{const q=e.getBoundingClientRect(),t=(e.innerText||e.value||e.getAttribute('aria-label')||e.title||'').replace(/\s+/g,' ').trim();return{e,t,left:q.left,dy:Math.abs(q.top+q.height/2-cy)};});
    let x=all.find(v=>/^(track|search|go|→|›|>)$/i.test(v.t)||/track\s*shipment|追踪货物/i.test(v.t));
    if(!x)x=all.filter(v=>v.left>=r.right-30&&v.left<=r.right+260&&v.dy<110).sort((a,b)=>a.dy-b.dy||a.left-b.left)[0];
    if(!x){const p=awb.parentElement;const e=p?[...p.querySelectorAll('button,[role="button"],a,input[type="submit"]')].find(visible):null;if(e)x={e,t:'parent'};}
    if(!x)return false;x.e.setAttribute('data-mayavi-track','1');return x.t||'icon';
  }).catch(()=>false);
  if(!marked)return false;await page.click('[data-mayavi-track="1"]').catch(()=>{});return marked;
}
async function makePage(browser){
  const page=await browser.newPage();
  const version=await browser.version().catch(()=> 'HeadlessChrome/140.0.0.0');
  const chrome=(version.match(/(?:Chrome|Chromium)\/([\d.]+)/)||[])[1]||'140.0.0.0';
  await page.setUserAgent(`Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`);
  await page.setExtraHTTPHeaders({'Accept-Language':'en-US,en;q=0.9'});
  await page.evaluateOnNewDocument(()=>{
    Object.defineProperty(navigator,'webdriver',{get:()=>undefined});
    Object.defineProperty(navigator,'languages',{get:()=>['en-US','en']});
    Object.defineProperty(navigator,'plugins',{get:()=>[1,2,3,4,5]});
    if(!window.chrome)window.chrome={runtime:{}};
  });
  return page;
}

export async function trackSaudiaDirect(input){
  const mawb=normalizeMawb(input);if(!mawb||!mawb.startsWith('065-'))return{ok:false,reason:'INVALID SAUDIA MAWB',officialTracker:URL};
  const digits=mawb.replace(/\D/g,''),serial=digits.slice(3),formats=[digits,mawb,serial];
  let browser;const networkBodies=[],networkUrls=[],requestBodies=[];
  try{
    chromium.setGraphicsMode=false;
    browser=await puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox','--disable-blink-features=AutomationControlled','--lang=en-US,en','--window-size=1365,900'],defaultViewport:{width:1365,height:900},executablePath:await chromium.executablePath(),headless:'shell'});
    const page=await makePage(browser);
    page.on('request',req=>{try{if(/\/apis\/api\/eservices\/track-shipment/i.test(req.url()))requestBodies.push(req.postData()||'');}catch{}});
    page.on('response',async res=>{try{const u=res.url(),ct=String(res.headers()['content-type']||'');if(!/track|shipment|awb|cargo|e-services|api/i.test(u))return;networkUrls.push(`${res.status()} ${u}`);if(!/json|text|javascript|xml/i.test(ct))return;const body=await res.text();if(body&&body.length<250000)networkBodies.push(body.slice(0,70000));}catch{}});
    await page.goto(URL,{waitUntil:'domcontentloaded',timeout:24000});await new Promise(r=>setTimeout(r,3200));
    if(!await findInput(page))return{ok:false,reason:'SAUDIA AWB INPUT NOT FOUND',officialTracker:URL,debug:{stage:'NO_INPUT'}};
    const attempts=[];
    for(const value of formats){
      networkBodies.length=0;networkUrls.length=0;requestBodies.length=0;
      await page.click('[data-mayavi-awb="1"]',{clickCount:3}).catch(()=>{});await page.keyboard.press('Control+A').catch(()=>{});await page.keyboard.press('Backspace').catch(()=>{});await page.type('[data-mayavi-awb="1"]',value,{delay:45}).catch(()=>{});
      await new Promise(r=>setTimeout(r,650));
      const clicked=await clickArrow(page);if(!clicked)await page.keyboard.press('Enter').catch(()=>{});
      await Promise.race([page.waitForNetworkIdle({idleTime:750,timeout:9000}).catch(()=>{}),new Promise(r=>setTimeout(r,9000))]);await new Promise(r=>setTimeout(r,1100));
      const visible=await crawlTimeline(page),combined=`${visible}\n${networkBodies.join('\n')}`,parsed=parseResult(combined,mawb);
      const invalidCaptcha=networkBodies.some(b=>/invalidCaptcha/i.test(b));
      attempts.push({value,clicked:clicked||'enter',invalidCaptcha,eventCount:parsed?.events?.length||0,networkUrls:networkUrls.slice(-15),requestBody:requestBodies.slice(-1)[0]?.slice(0,900)||'',textSample:translate(visible).slice(-3500)});
      if(parsed?.shipment){
        const screenshotBase64=await page.screenshot({type:'jpeg',quality:70,fullPage:false,encoding:'base64'}).catch(()=>null);
        return{ok:true,shipment:parsed.shipment,screenshotBase64,debug:{stage:'SUCCESS',attempts,eventCount:parsed.events.length,arrivalEvent:parsed.arrivalEvent?.text?.slice(0,700)||'',latestEvent:parsed.latestOperational?.text?.slice(0,700)||'',networkUrls:networkUrls.slice(-20)}};
      }
      if(invalidCaptcha)await new Promise(r=>setTimeout(r,1600));
    }
    const screenshotBase64=await page.screenshot({type:'jpeg',quality:70,fullPage:false,encoding:'base64'}).catch(()=>null);
    const captchaBlocked=attempts.some(a=>a.invalidCaptcha);
    return{ok:false,reason:captchaBlocked?'SAUDIA INVISIBLE CAPTCHA BLOCKED SERVER AUTOMATION':'SAUDIA RESULT DID NOT EXPOSE VERIFIED TIMELINE DATA',officialTracker:URL,screenshotBase64,debug:{stage:captchaBlocked?'CAPTCHA_BLOCKED':'NO_FIELDS',attempts}};
  }catch(e){return{ok:false,reason:`SAUDIA DIRECT BROWSER ERROR: ${e?.message||e}`,officialTracker:URL,debug:{stage:'ERROR',networkUrls:networkUrls.slice(-20)}};}
  finally{try{if(browser)await browser.close()}catch{}}
}
