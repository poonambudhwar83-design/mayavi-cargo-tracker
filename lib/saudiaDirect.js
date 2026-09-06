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
function isoDate(y,m,d){return`${y}-${pad(m)}-${pad(d)}`}
function parseDate(s=''){
  let m=String(s).match(/(20\d{2})[-\/.]([01]?\d)[-\/.]([0-3]?\d)/);if(m)return isoDate(m[1],m[2],m[3]);
  m=String(s).match(/(20\d{2})年([01]?\d)月([0-3]?\d)日/);if(m)return isoDate(m[1],m[2],m[3]);
  m=String(s).match(/([0-3]?\d)[-\/.]([01]?\d)[-\.\/](20\d{2})/);if(m)return isoDate(m[3],m[2],m[1]);
  m=String(s).match(/\b([0-3]?\d)\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[A-Za-z]*\s+(20\d{2})\b/i);if(m)return`${m[3]}-${MONTHS[m[2].slice(0,3).toUpperCase()]}-${pad(m[1])}`;
  return'';
}
function parseTime(s=''){const m=String(s).match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);return m?`${pad(m[1])}:${m[2]}`:'';}
function eventTimestamp(e={}){const t=Date.parse(`${e.date||''}T${e.time||'00:00'}:00Z`);return Number.isFinite(t)?t:0}
function timelineEvents(raw=''){
  const text=translate(raw).replace(/\s+/g,' ').trim(),events=[];
  const display=/\b([0-3]?\d)\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[A-Za-z]*\s+(20\d{2})\s+([01]?\d|2[0-3]):([0-5]\d)\b/gi;
  const hits=[...text.matchAll(display)];
  for(let i=0;i<hits.length;i++){
    const h=hits[i],start=h.index||0,end=i+1<hits.length?(hits[i+1].index||text.length):Math.min(text.length,start+900);
    events.push({date:`${h[3]}-${MONTHS[h[2].slice(0,3).toUpperCase()]}-${pad(h[1])}`,time:`${pad(h[4])}:${h[5]}`,text:text.slice(start,end).trim(),source:'display'});
  }
  const iso=/\b(20\d{2})-(\d{2})-(\d{2})[T\s]([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?/g;
  for(const h of text.matchAll(iso)){
    const start=Math.max(0,(h.index||0)-180),end=Math.min(text.length,(h.index||0)+720);
    events.push({date:`${h[1]}-${h[2]}-${h[3]}`,time:`${h[4]}:${h[5]}`,text:text.slice(start,end).trim(),source:'iso'});
  }
  const seen=new Set();return events.filter(e=>{const k=`${e.date}|${e.time}|${e.text.slice(0,80)}`;if(seen.has(k))return false;seen.add(k);return true;});
}
function eventFields(event={}){
  const text=String(event.text||''),upper=text.toUpperCase();
  const flight=upper.match(/\bSV[-\s]?(\d{2,4})\b/);
  const dest=upper.match(/\bTO\b[\s\S]{0,180}?\(([A-Z]{3})\)/)||upper.match(/\bDESTINATION\b[\s\S]{0,80}?\b([A-Z]{3})\b/);
  const locationCodes=[...upper.matchAll(/\(([A-Z]{3})\)/g)].map(m=>m[1]).filter(x=>!['ARR','RCF','MAN','DIS','DEP','RCS','DLV'].includes(x));
  const pieces=first(text,/(?:pieces?|pcs?|pieceCount|numberOfPieces)\s*[":=\-]?\s*"?(\d{1,6})/i);
  const weight=(first(text,/(?:weight|grossWeight|gross weight)\s*[":=\-]?\s*"?([\d,.]+)/i)||'').replace(/,/g,'');
  return{flightNo:flight?`SV${flight[1]}`:'',destination:dest?.[1]||'',locationCodes,pieces,weight};
}
function isArrivalEvent(text=''){return /\bARRIVED?\b|\(ARR\)|\bRCF\b|RECEIVED\s+FROM\s+FLIGHT|RECEIVED\s+AT\s+DESTINATION|ACTUAL\s+ARRIVAL|LANDED/i.test(translate(text))}
function isDepartureEvent(text=''){return /\bDEPARTED?\b|\(DEP\)|AIRBORNE|IN\s+TRANSIT/i.test(translate(text))}
function isBookingEvent(text=''){return /\bRCS\b|RECEIVED\s+FROM\s+SHIPPER|\bBOOKED\b|\bACCEPTED\b/i.test(translate(text))}
function isManifestEvent(text=''){return /MANIFESTED\s+ON\s+FLIGHT|\(MAN\)|PLANNED\s+FOR\s+FLIGHT/i.test(translate(text))}
function aroundKeyword(text='',rx){
  const flat=translate(text);const m=rx.exec(flat);if(!m)return null;const at=m.index||0,w=flat.slice(Math.max(0,at-280),Math.min(flat.length,at+620));const date=parseDate(w),time=parseTime(w);return(date||time)?{date,time,text:w}:null;
}
function parseResult(raw,mawb){
  const text=translate(raw),upper=text.toUpperCase(),events=timelineEvents(raw);
  const chronological=[...events].sort((a,b)=>eventTimestamp(a)-eventTimestamp(b)),latest=[...chronological].reverse();
  let arrivalEvent=latest.find(e=>isArrivalEvent(e.text))||null;
  if(!arrivalEvent){const w=aroundKeyword(text,/\bARRIVED?\b|\(ARR\)|\bRCF\b|RECEIVED\s+FROM\s+FLIGHT|ACTUAL\s+ARRIVAL|LANDED/i);if(w)arrivalEvent=w;}
  const latestOperational=latest.find(e=>isArrivalEvent(e.text)||isDepartureEvent(e.text)||isManifestEvent(e.text)||isBookingEvent(e.text))||latest[0]||null;
  const bookingEvent=chronological.find(e=>isBookingEvent(e.text))||null;
  const chosen=arrivalEvent||latestOperational;
  const chosenFields=eventFields(chosen||{}),arrivalFields=eventFields(arrivalEvent||{}),latestFields=eventFields(latestOperational||{});
  const route=upper.match(/\bORIGIN\b\s*[:\-]?\s*([A-Z]{3})\b[\s\S]{0,220}?\bDESTINATION\b\s*[:\-]?\s*([A-Z]{3})\b/)||upper.match(/\b([A-Z]{3})\s*(?:→|->|—|-)\s*([A-Z]{3})\b/);
  let origin=route?.[1]||'',destination=arrivalFields.destination||chosenFields.destination||route?.[2]||'';
  if(!destination){const d=upper.match(/INDIRA\s+GANDHI[\s\S]{0,50}?\(DEL\)/);if(d)destination='DEL';}
  if(!origin){for(const e of chronological){const f=eventFields(e),codes=f.locationCodes.filter(c=>c!==destination);if(codes.length){origin=codes[0];break;}}}
  if(!origin&&/KING\s+KHALED[\s\S]{0,50}?\(RUH\)/i.test(text))origin='RUH';
  const svRows=[...upper.matchAll(/\bSV[-\s]?(\d{2,4})\b/g)];
  const flightNo=arrivalFields.flightNo||chosenFields.flightNo||latestFields.flightNo||(svRows.length?`SV${svRows[svRows.length-1][1]}`:'');
  const pieces=arrivalFields.pieces||chosenFields.pieces||latestFields.pieces||first(text,/(?:Pieces?|Pcs?)\s*[:\-]?\s*(\d{1,6})/i);
  const weight=(arrivalFields.weight||chosenFields.weight||latestFields.weight||first(text,/(?:Gross Weight|Weight)\s*[:\-]?\s*([\d,.]+)/i)).replace(/,/g,'');
  let status='TRACKING';if(arrivalEvent)status='ARRIVED';else if(latestOperational&&isDepartureEvent(latestOperational.text))status='IN TRANSIT';else if(latestOperational&&(isManifestEvent(latestOperational.text)||isBookingEvent(latestOperational.text)))status='BOOKED';else if(/DELIVERED|\bDLV\b/i.test(text))status='DELIVERED';
  const arrivalDate=arrivalEvent?.date||'',arrivalTime=arrivalEvent?.time||'',arrivalIsActual=Boolean(arrivalEvent&&arrivalDate&&arrivalTime),bookingDate=bookingEvent?.date||'';
  const shipment={mawb,carrierCode:'SV',airlineName:'Saudia Cargo',origin,destination,bags:pieces,pieces,weight,flightNo,bookingDate,arrivalDate,arrivalTime,arrivalIsActual,status,officialTracker:URL,source:'Saudia Cargo direct track-shipment timeline'};
  const useful=Boolean((origin&&destination)||pieces||weight||flightNo||bookingDate||arrivalDate||arrivalTime||(status&&status!=='TRACKING'));
  return useful?{shipment,events,arrivalEvent,latestOperational}:null;
}
async function deepText(frame){
  return frame.evaluate(()=>{
    const parts=[];const add=root=>{try{const t=root?.innerText||root?.textContent||'';if(t)parts.push(t);for(const e of root?.querySelectorAll?.('*')||[]){if(e.shadowRoot)add(e.shadowRoot)}}catch{}};add(document.body);return parts.join('\n');
  }).catch(()=> '');
}
async function collectAllText(page,networkBodies=[]){
  for(const frame of page.frames())await frame.evaluate(()=>{try{window.scrollTo(0,document.body?.scrollHeight||0);for(const e of document.querySelectorAll('*'))if(e.scrollHeight>e.clientHeight+150)e.scrollTop=e.scrollHeight}catch{}}).catch(()=>{});
  await new Promise(r=>setTimeout(r,650));
  const frameTexts=[];for(const frame of page.frames()){const t=await deepText(frame);if(t)frameTexts.push(t)}
  return `${frameTexts.join('\n')}\n${networkBodies.join('\n')}`;
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
    if(!x)x=all.filter(v=>v.left>=r.right-20&&v.left<=r.right+220&&v.dy<100).sort((a,b)=>a.dy-b.dy||a.left-b.left)[0];
    if(!x){const p=awb.parentElement;const e=p?[...p.querySelectorAll('button,[role="button"],a,input[type="submit"]')].find(visible):null;if(e)x={e,t:'parent'};}
    if(!x)return false;x.e.setAttribute('data-mayavi-track','1');return x.t||'icon';
  }).catch(()=>false);
  if(!marked)return false;await page.click('[data-mayavi-track="1"]').catch(()=>{});return marked;
}

export async function trackSaudiaDirect(input){
  const mawb=normalizeMawb(input);if(!mawb||!mawb.startsWith('065-'))return{ok:false,reason:'INVALID SAUDIA MAWB',officialTracker:URL};
  const digits=mawb.replace(/\D/g,''),serial=digits.slice(3),formats=[mawb,digits,serial];
  let browser;const networkBodies=[],networkUrls=[];
  try{
    chromium.setGraphicsMode=false;
    browser=await puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox'],defaultViewport:{width:1440,height:1100},executablePath:await chromium.executablePath(),headless:'shell'});
    const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36');
    await page.setExtraHTTPHeaders({'Accept-Language':'en-US,en;q=0.9'});
    page.on('response',async res=>{try{const u=res.url(),ct=String(res.headers()['content-type']||'');if(!/track|shipment|awb|cargo|e-services|api/i.test(u))return;networkUrls.push(`${res.status()} ${u}`);if(!/json|text|javascript|xml/i.test(ct))return;const body=await res.text();if(body&&body.length<200000)networkBodies.push(body.slice(0,50000));}catch{}});
    await page.goto(URL,{waitUntil:'domcontentloaded',timeout:22000});await new Promise(r=>setTimeout(r,1600));
    if(!await findInput(page))return{ok:false,reason:'SAUDIA AWB INPUT NOT FOUND',officialTracker:URL,debug:{stage:'NO_INPUT'}};
    const attempts=[];
    for(const value of formats){
      networkBodies.length=0;networkUrls.length=0;
      await page.click('[data-mayavi-awb="1"]',{clickCount:3}).catch(()=>{});await page.keyboard.press('Control+A').catch(()=>{});await page.keyboard.press('Backspace').catch(()=>{});await page.type('[data-mayavi-awb="1"]',value,{delay:28}).catch(()=>{});
      const clicked=await clickArrow(page);if(!clicked){await page.keyboard.press('Enter').catch(()=>{});}
      await Promise.race([page.waitForNetworkIdle({idleTime:700,timeout:7000}).catch(()=>{}),new Promise(r=>setTimeout(r,7000))]);await new Promise(r=>setTimeout(r,1200));
      const combined=await collectAllText(page,networkBodies),parsed=parseResult(combined,mawb);
      attempts.push({value,clicked:clicked||'enter',networkUrls:networkUrls.slice(-20),textSample:translate(combined).slice(-5000)});
      if(parsed?.shipment){
        const screenshotBase64=await page.screenshot({type:'jpeg',quality:68,fullPage:false,encoding:'base64'}).catch(()=>null);
        return{ok:true,shipment:parsed.shipment,screenshotBase64,debug:{stage:'SUCCESS',attempts,eventCount:parsed.events.length,arrivalEvent:parsed.arrivalEvent?.text?.slice(0,700)||'',latestEvent:parsed.latestOperational?.text?.slice(0,700)||'',networkUrls:networkUrls.slice(-30)}};
      }
    }
    const screenshotBase64=await page.screenshot({type:'jpeg',quality:68,fullPage:false,encoding:'base64'}).catch(()=>null);
    return{ok:false,reason:'SAUDIA RESULT DID NOT EXPOSE VERIFIED TIMELINE DATA',officialTracker:URL,screenshotBase64,debug:{stage:'NO_FIELDS',attempts}};
  }catch(e){return{ok:false,reason:`SAUDIA DIRECT BROWSER ERROR: ${e?.message||e}`,officialTracker:URL,debug:{stage:'ERROR',networkUrls:networkUrls.slice(-30)}};}
  finally{try{if(browser)await browser.close()}catch{}}
}
