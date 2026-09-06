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
  const text=translate(raw).replace(/\s+/g,' ').trim();
  const rx=/\b([0-3]?\d)\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[A-Za-z]*\s+(20\d{2})\s+([01]?\d|2[0-3]):([0-5]\d)\b/gi;
  const hits=[...text.matchAll(rx)],events=[];
  for(let i=0;i<hits.length;i++){
    const h=hits[i],start=h.index||0,end=i+1<hits.length?(hits[i+1].index||text.length):text.length;
    const segment=text.slice(start,end).trim();
    events.push({
      date:`${h[3]}-${MONTHS[h[2].slice(0,3).toUpperCase()]}-${pad(h[1])}`,
      time:`${pad(h[4])}:${h[5]}`,
      text:segment
    });
  }
  return events;
}
function eventFields(event={}){
  const text=String(event.text||''),upper=text.toUpperCase();
  const flight=upper.match(/\bSV[-\s]?(\d{2,4})\b/);
  const dest=upper.match(/\bTO\b[\s\S]{0,140}?\(([A-Z]{3})\)/)||upper.match(/\bDESTINATION\b\s*[:\-]?\s*([A-Z]{3})\b/);
  const locationCodes=[...upper.matchAll(/\(([A-Z]{3})\)/g)].map(m=>m[1]).filter(x=>!['ARR','RCF','MAN','DIS','DEP','RCS'].includes(x));
  const pieces=first(text,/(?:pieces?|pcs?)\s*[:\-]?\s*(\d{1,6})/i);
  const weight=(first(text,/(?:weight|gross weight)\s*[:\-]?\s*([\d,.]+)/i)||'').replace(/,/g,'');
  return{flightNo:flight?`SV${flight[1]}`:'',destination:dest?.[1]||'',locationCodes,pieces,weight};
}
function isArrivalEvent(text=''){
  return /\bARRIVED?\b|\(ARR\)|\bRCF\b|RECEIVED\s+FROM\s+FLIGHT|RECEIVED\s+AT\s+DESTINATION|ACTUAL\s+ARRIVAL|LANDED/i.test(text);
}
function isDepartureEvent(text=''){return /\bDEPARTED?\b|\(DEP\)|AIRBORNE|IN\s+TRANSIT/i.test(text)}
function isBookingEvent(text=''){return /\bRCS\b|RECEIVED\s+FROM\s+SHIPPER|\bBOOKED\b|\bACCEPTED\b/i.test(text)}
function isManifestEvent(text=''){return /MANIFESTED\s+ON\s+FLIGHT|\(MAN\)|PLANNED\s+FOR\s+FLIGHT/i.test(text)}

function parseResult(raw,mawb){
  const text=translate(raw),upper=text.toUpperCase(),events=timelineEvents(raw);
  const chronological=[...events].sort((a,b)=>eventTimestamp(a)-eventTimestamp(b));
  const latest=[...chronological].reverse();
  const arrivalEvent=latest.find(e=>isArrivalEvent(e.text))||null;
  const latestOperational=latest.find(e=>isArrivalEvent(e.text)||isDepartureEvent(e.text)||isManifestEvent(e.text)||isBookingEvent(e.text))||latest[0]||null;
  const bookingEvent=chronological.find(e=>isBookingEvent(e.text))||null;
  const chosen=arrivalEvent||latestOperational;
  const chosenFields=eventFields(chosen||{}),arrivalFields=eventFields(arrivalEvent||{}),latestFields=eventFields(latestOperational||{});

  const route=upper.match(/\bORIGIN\b\s*[:\-]?\s*([A-Z]{3})\b[\s\S]{0,220}?\bDESTINATION\b\s*[:\-]?\s*([A-Z]{3})\b/)
    ||upper.match(/\b([A-Z]{3})\s*(?:→|->|—|-)\s*([A-Z]{3})\b/);
  let origin=route?.[1]||'',destination=arrivalFields.destination||chosenFields.destination||route?.[2]||'';

  if(!destination){
    const destEvent=latest.find(e=>/\bTO\b[\s\S]{0,160}?\([A-Z]{3}\)/i.test(e.text));
    if(destEvent)destination=eventFields(destEvent).destination||'';
  }
  if(!origin){
    const knownDest=destination;
    for(const e of chronological){
      const f=eventFields(e),codes=f.locationCodes.filter(c=>c!==knownDest);
      if(codes.length){origin=codes[0];break;}
    }
  }

  const svRows=[...upper.matchAll(/\bSV[-\s]?(\d{2,4})\b/g)];
  const flightNo=arrivalFields.flightNo||chosenFields.flightNo||latestFields.flightNo||(svRows.length?`SV${svRows[svRows.length-1][1]}`:'');
  const pieces=arrivalFields.pieces||chosenFields.pieces||latestFields.pieces||first(text,/(?:Pieces?|Pcs?|Number of Pieces)\s*[:\-]?\s*(\d{1,6})/i)||first(text,/\b(\d{1,6})\s*(?:PCS|PIECES?)\b/i);
  const weight=(arrivalFields.weight||chosenFields.weight||latestFields.weight||first(text,/(?:Gross Weight|Weight)\s*[:\-]?\s*([\d,.]+)\s*(?:KG|KGS)?/i)||first(text,/\b([\d,.]+)\s*(?:KG|KGS)\b/i)).replace(/,/g,'');
  const segmentNo=first(text,/(?:Segment(?: No\.?| Number)?)\s*[:#\-]?\s*([A-Z0-9-]+)/i);

  let status='TRACKING';
  if(arrivalEvent)status='ARRIVED';
  else if(latestOperational&&isDepartureEvent(latestOperational.text))status='IN TRANSIT';
  else if(latestOperational&&(isManifestEvent(latestOperational.text)||isBookingEvent(latestOperational.text)))status='BOOKED';
  else if(/DELIVERED|\bDLV\b/i.test(text))status='DELIVERED';

  const arrivalDate=arrivalEvent?.date||'',arrivalTime=arrivalEvent?.time||'',arrivalIsActual=Boolean(arrivalEvent&&arrivalDate&&arrivalTime);
  const bookingDate=bookingEvent?.date||'';
  const shipment={mawb,carrierCode:'SV',airlineName:'Saudia Cargo',origin,destination,bags:pieces,pieces,weight,flightNo,bookingDate,arrivalDate,arrivalTime,arrivalIsActual,status,segmentNo,officialTracker:URL,source:'Saudia Cargo direct track-shipment timeline'};
  const useful=Boolean((origin&&destination)||pieces||weight||flightNo||bookingDate||arrivalDate||arrivalTime||(status&&status!=='TRACKING'));
  return useful?{shipment,events,arrivalEvent,latestOperational}:null;
}

export async function trackSaudiaWithBrowser(input){
  const mawb=normalizeMawb(input);if(!mawb||!mawb.startsWith('065-'))return{ok:false,reason:'INVALID SAUDIA MAWB',officialTracker:URL};
  let browser;
  try{
    chromium.setGraphicsMode=false;
    browser=await puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox'],defaultViewport:{width:1440,height:1100},executablePath:await chromium.executablePath(),headless:'shell'});
    const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36');
    await page.setExtraHTTPHeaders({'Accept-Language':'en-US,en;q=0.9'});
    await page.goto(URL,{waitUntil:'domcontentloaded',timeout:22000});
    await new Promise(r=>setTimeout(r,1800));

    const setup=await page.evaluate((mawb)=>{
      const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>18&&r.height>10&&!e.disabled};
      const set=(e,v)=>{const d=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');d?.set?.call(e,v);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));};
      const inputs=[...document.querySelectorAll('input')].filter(visible).filter(e=>!['hidden','checkbox','radio','submit','button'].includes((e.type||'text').toLowerCase()));
      const awb=inputs.find(e=>/065-000000|awb|airway|shipment/i.test(`${e.placeholder||''} ${e.name||''} ${e.id||''} ${e.getAttribute('aria-label')||''}`))||inputs[0];
      if(!awb)return{filled:false,clicked:false,reason:'AWB input not found'};
      set(awb,mawb);awb.focus();
      const r=awb.getBoundingClientRect(),cy=r.top+r.height/2;
      const candidates=[...document.querySelectorAll('button,[role="button"],a,input[type="submit"]')].filter(visible).map(e=>{const q=e.getBoundingClientRect(),t=(e.innerText||e.value||e.getAttribute('aria-label')||e.title||'').replace(/\s+/g,' ').trim();return{e,t,left:q.left,top:q.top,w:q.width,h:q.height,dy:Math.abs((q.top+q.height/2)-cy)};});
      let btn=candidates.find(x=>/^(track|search|go|→|›|>)$/i.test(x.t)||/track\s*shipment|追踪货物/i.test(x.t));
      if(!btn)btn=candidates.filter(x=>x.left>=r.right-10&&x.left<=r.right+180&&x.dy<90).sort((a,b)=>a.dy-b.dy||a.left-b.left)[0];
      if(!btn){
        const parent=awb.parentElement;const local=parent?[...parent.querySelectorAll('button,[role="button"],a,input[type="submit"]')].find(visible):null;
        if(local){local.click();return{filled:true,clicked:true,mode:'near-input-parent'};}
        const form=awb.closest('form');if(form&&typeof form.requestSubmit==='function'){form.requestSubmit();return{filled:true,clicked:true,mode:'requestSubmit'};}
        return{filled:true,clicked:false,mode:'keyboard-enter'};
      }
      btn.e.click();return{filled:true,clicked:true,mode:`arrow:${btn.t||'icon'}`};
    },mawb);

    if(!setup.filled)return{ok:false,reason:'SAUDIA AWB INPUT NOT FOUND',officialTracker:URL,debug:{stage:'NO_INPUT',setup}};
    if(!setup.clicked&&setup.mode==='keyboard-enter')await page.keyboard.press('Enter');

    await Promise.race([page.waitForNetworkIdle({idleTime:800,timeout:10000}).catch(()=>{}),new Promise(r=>setTimeout(r,10000))]);
    await new Promise(r=>setTimeout(r,1400));

    await page.evaluate(async()=>{
      const sleep=ms=>new Promise(r=>setTimeout(r,ms));
      for(let i=0;i<8;i++){window.scrollTo(0,document.body.scrollHeight);await sleep(220);}
      const scrollables=[...document.querySelectorAll('*')].filter(e=>e.scrollHeight>e.clientHeight+150);
      for(const e of scrollables.slice(-8)){try{e.scrollTop=e.scrollHeight}catch{}}
    }).catch(()=>{});
    await new Promise(r=>setTimeout(r,900));

    const text=await page.evaluate(()=>document.body?.innerText||'').catch(()=> '');
    const screenshotBase64=await page.screenshot({type:'jpeg',quality:68,fullPage:false,encoding:'base64'}).catch(()=>null);
    const parsed=parseResult(text,mawb);
    if(parsed?.shipment){
      const s=parsed.shipment;
      return{ok:true,shipment:s,screenshotBase64,debug:{stage:'SUCCESS',setup,eventCount:parsed.events.length,arrivalEvent:parsed.arrivalEvent?.text?.slice(0,500)||'',latestEvent:parsed.latestOperational?.text?.slice(0,500)||'',pageText:translate(text).slice(0,12000)}};
    }
    return{ok:false,reason:'SAUDIA RESULT OPENED BUT NO VERIFIED TIMELINE FIELDS FOUND',officialTracker:URL,screenshotBase64,debug:{stage:'NO_FIELDS',setup,pageText:translate(text).slice(0,12000)}};
  }catch(e){return{ok:false,reason:`SAUDIA BROWSER ERROR: ${e?.message||e}`,officialTracker:URL,debug:{stage:'ERROR'}};}
  finally{try{if(browser)await browser.close()}catch{}}
}
