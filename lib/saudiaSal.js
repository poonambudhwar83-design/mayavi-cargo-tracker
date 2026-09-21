import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { normalizeMawb } from './airlines.js';

const URL='https://sal.sa/trackshipment';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clean=v=>String(v||'').replace(/\s+/g,' ').trim();
const digits=v=>String(v||'').replace(/\D/g,'');
const first=(text,rx)=>clean((String(text||'').match(rx)||[])[1]||'');
const pad=v=>String(v).padStart(2,'0');
function normalizeDate(value=''){
  const s=clean(value).toUpperCase();
  let m=s.match(/\b(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})\b/);if(m)return`${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  // SAL DateTime_LT is month/day/year.
  m=s.match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](20\d{2})\b/);if(m)return`${m[3]}-${pad(m[1])}-${pad(m[2])}`;
  const mon={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
  m=s.match(/\b(\d{1,2})[-\s](JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[-\s,]+(\d{2}|20\d{2})\b/);
  if(m){const y=m[3].length===2?`20${m[3]}`:m[3];return`${y}-${mon[m[2]]}-${pad(m[1])}`;}
  return'';
}
function bookingDateFromSal(text=''){
  const s=String(text||'');
  const date='(20\\d{2}[-\\/.]\\d{1,2}[-\\/.]\\d{1,2}|\\d{1,2}[\\/-]\\d{1,2}[\\/-]20\\d{2}|\\d{1,2}[-\\s](?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[-\\s,]+(?:\\d{2}|20\\d{2}))';
  const code='(?:\\bRCS\\b|\\bBKD\\b|RECEIVED\\s+FROM\\s+SHIPPER|READY\\s+FOR\\s+CARRIAGE|ACCEPTED)';
  const candidates=[];
  for(const match of s.matchAll(new RegExp(code,'ig'))){
    const at=match.index||0;
    const window=s.slice(at,Math.min(s.length,at+140));
    // Never let a later FOW/MAN/Flight Date be mistaken for the booking date.
    const stop=window.search(/\\b(?:FOW|MAN|DEP|ARR|RCF|FIW|FLIGHT\\s+DATE|ARRIVAL\\s+DATE)\\b/i);
    const local=stop>=0?window.slice(0,stop):window;
    const dm=local.match(new RegExp(date,'i'));
    if(dm)candidates.push(dm[1]);
  }
  if(!candidates.length){
    for(const match of s.matchAll(new RegExp(date,'ig'))){
      const at=match.index||0;
      const after=s.slice(at,Math.min(s.length,at+90));
      if(new RegExp(code,'i').test(after)&&!/\\b(?:FOW|MAN|DEP|ARR|RCF|FIW|FLIGHT\\s+DATE|ARRIVAL\\s+DATE)\\b/i.test(after))candidates.push(match[1]);
    }
  }
  return normalizeDate(candidates[0]||'');
}

function mapStatus(raw='',airport='',flightDestination=''){
  const s=String(raw||'').toUpperCase(),a=String(airport||'').toUpperCase(),d=String(flightDestination||'').toUpperCase();
  if(/DLV|DELIVER|ARRIVED|RECEIVED FROM FLIGHT|ARRIVAL|\bARR\b|\bRCF\b/.test(s))return'ARRIVED';
  if(/DEPARTED|\bDEP\b|AIRBORNE/.test(s))return'DEPARTED';
  // Saudia via RUH: while the load is at/in the RUH transit leg it remains IN TRANSIT.
  if(a==='RUH'&&d&&d!=='RUH'){
    if(/\bFOW\b|\bMAN\b|MANIFEST|FLIGHT|IN TRANSIT/.test(s))return'IN TRANSIT';
  }
  if(/IN TRANSIT|\bFOW\b|\bFIW\b/.test(s))return'IN TRANSIT';
  if(/\bMAN\b|MANIFEST/.test(s))return'BOOKED';
  if(/DELAY|LATE|EXCEPTION/.test(s))return'DELAYED';
  if(/BOOKED|BKD|RCS|RECEIVED FROM SHIPPER/.test(s))return'BOOKED';
  return'TRACKING';
}

function parseSal(text='',mawb=''){
  const t=clean(text);if(!t)return null;
  const full=digits(mawb),serial=full.slice(3),flat=digits(t);
  if(full&&!flat.includes(full)&&serial&&!flat.includes(serial))return null;

  const destination=first(t,/(?:\bDESTINATION\b|\bDestination\b)\s*[:\-]?\s*([A-Z]{3})\b/i).toUpperCase();
  const origin=first(t,/(?:\bORIGIN\b|\bOrigin\b)\s*[:\-]?\s*([A-Z]{3})\b/i).toUpperCase();
  const statusRaw=first(t,/\bStatus\b\s*[:\-]?\s*([^]*?)(?=\bDate\b|\bTotal\s+Pieces\b|\bTotal\s+Weight\b|\bTotal\s+Volume\b|\bMore\s+Shipment\s+Details\b)/i);
  const pieces=first(t,/(?:\bTotal\s+Pieces\b|\bNo\.\s*of\s*Pieces\b|\bPieces\b)\s*[:\-]?\s*(\d{1,6})\b/i);
  const weight=first(t,/(?:\bTotal\s+Weight\b|\bWeight\b)\s*[:\-]?\s*([\d,.]+)\s*(?:KG|KGS?)?/i).replace(/,/g,'');
  const volume=first(t,/(?:\bTotal\s+Volume\b|\bVolume\b)\s*[:\-]?\s*([\d,.]+)\s*(?:M3|M³|CBM)?/i).replace(/,/g,'');
  const eventMatches=[...t.matchAll(/\b(BKD|RCS|MAN|FOW|DIS|DEP|ARR|RCF|FIW|DLV)\b/gi)];
  const latestEventCode=(eventMatches.at(-1)?.[1]||'').toUpperCase();
  const disMatches=[...t.matchAll(/\bDIS\b/gi)];
  const latestDisAt=disMatches.at(-1)?.index ?? -1;
  const latestFowAt=[...t.matchAll(/\bFOW\b/gi)].at(-1)?.index ?? -1;
  const disAfterFow=latestDisAt>=0&&latestFowAt>=0&&latestDisAt>latestFowAt;
  const fowMatches=[...t.matchAll(/\bFOW\b/gi)];
  const fowAt=fowMatches.at(-1)?.index ?? -1;
  const fowBlock=fowAt>=0?t.slice(Math.max(0,fowAt-500),Math.min(t.length,fowAt+1400)):'';

  // Flight number must come from the latest/current FOW block. Do not fall
  // back to an older leg elsewhere in SAL history (e.g. domestic SV1167).
  const flightNo=first(fowBlock,/\b(?:Flight\s*(?:Number|No\.?)\s*[:\-]?\s*)?(SV\s*\d{1,4})\b/i).replace(/\s+/g,'').toUpperCase();
  const flightDate=first(fowBlock,/\bFlight\s+Date\b\s*[:\-]?\s*([^]*?)(?=\bArrival\s+Date\b|\bArrival\s+Time\b|\bDestination\b|\bNo\.\s*of\s*Pieces\b|\bWeight\b|\bPrint\b)/i)||
    first(t,/\bFlight\s+Date\b\s*[:\-]?\s*([^]*?)(?=\bArrival\s+Date\b|\bArrival\s+Time\b|\bNo\.\s*of\s*Pieces\b|\bWeight\b|\bPrint\b)/i);
  let arrivalDate=first(fowBlock,/\b(?:Expected|Estimated|Scheduled)?\s*Arrival\s+Date\b\s*[:\-]?\s*([^]*?)(?=\bArrival\s+Time\b|\bDestination\b|\bNo\.\s*of\s*Pieces\b|\bWeight\b|\bPrint\b)/i)||
    first(t,/\bArrival\s+Date\b\s*[:\-]?\s*([^]*?)(?=\bArrival\s+Time\b|\bNo\.\s*of\s*Pieces\b|\bWeight\b|\bPrint\b)/i);
  // Never let an older date (for example an earlier RCF/previous leg) become the
  // ETA for the current FOW. The current FOW flight date is the minimum valid
  // arrival date; if SAL has no separate arrival date, use that FOW date.
  const normalizedFowDate=normalizeDate(flightDate);
  const normalizedArrivalDate=normalizeDate(arrivalDate);
  if(normalizedFowDate&&(!normalizedArrivalDate||normalizedArrivalDate<normalizedFowDate))arrivalDate=normalizedFowDate;
  const arrivalTime=first(fowBlock,/\b(?:Expected|Estimated|Scheduled)?\s*Arrival\s+Time\b\s*[:\-]?\s*(\d{1,2}:\d{2})\b/i)||
    first(t,/\bArrival\s+Time\b\s*[:\-]?\s*(\d{1,2}:\d{2})\b/i);
  const segmentNo=first(fowBlock,/\bSegment\s+Number\b\s*[:\-]?\s*(\d+)\b/i)||first(t,/\bSegment\s+Number\b\s*[:\-]?\s*(\d+)\b/i);
  const airport=first(fowBlock,/\bAirport\b\s*[:\-]?\s*([A-Z]{3})\b/i).toUpperCase()||first(t,/\bAirport\b\s*[:\-]?\s*([A-Z]{3})\b/i).toUpperCase();
  const flightDestination=first(fowBlock,/(?:\bDestination\b|\bFlight\s+Destination\b)\s*[:\-]?\s*([A-Z]{3})\b/i).toUpperCase()||destination;
  const explicitBookingDate=normalizeDate(first(t,/\bBooking\s+Date\b\s*[:\-]?\s*(20\d{2}[-\/.]\d{1,2}[-\/.]\d{1,2}|\d{1,2}[\/-]\d{1,2}[\/-]20\d{2}|\d{1,2}[-\s](?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[-\s,]+(?:\d{2}|20\d{2}))/i));
  const bookingDate=explicitBookingDate||bookingDateFromSal(t);

  const useful=Boolean(destination||origin||pieces||weight||flightNo||flightDate||arrivalDate||arrivalTime||statusRaw||bookingDate);
  if(!useful)return null;
  return {
    mawb,
    carrierCode:'SV',
    airlineName:'Saudia Cargo',
    officialTracker:URL,
    origin,
    destination,
    bags:pieces,
    pieces,
    weight,
    volume,
    flightNo,
    flightDate,
    flightDestination,
    bookingDate,
    bookingDateSource:bookingDate?'SAL RCS/acceptance event':'',
    // DIS after FOW means the shipment was removed/not loaded from that flight.
    // Never keep that FOW flight's ETA in Mayavi because it is no longer valid.
    arrivalDate:disAfterFow?'':arrivalDate,
    arrivalTime:disAfterFow?'':arrivalTime,
    arrivalIsActual:!disAfterFow&&Boolean(arrivalDate&&arrivalTime&&/ARR|DLV|ARRIVED|DELIVERED|RECEIVED FROM FLIGHT/i.test(latestEventCode||statusRaw)),
    segmentNo,
    airport,
    sourceStatus:latestEventCode||statusRaw,
    latestEventCode:latestEventCode||'',
    status:disAfterFow?'BOOKED':mapStatus(latestEventCode||statusRaw,airport,flightDestination),
    remarks:disAfterFow?'Offloaded / not loaded to flight':'',
    disAfterFow,
    source:'SAL public shipment tracking'
  };
}

async function bodyText(page){return page.evaluate(()=>document.body?.innerText||'').catch(()=> '');}

async function expandAndScrollSal(page){
  const snapshots=[];let lastHeight=0,stable=0;
  for(let step=0;step<12;step++){
    await page.evaluate(()=>{
      const visible=e=>{try{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>6&&r.height>6&&!e.disabled}catch{return false}};
      const txt=e=>String(e.innerText||e.textContent||e.getAttribute?.('aria-label')||e.title||'').replace(/\s+/g,' ').trim();
      const candidates=[...document.querySelectorAll('button,a,[role="button"],[aria-expanded="false"],summary,div,span')].filter(visible);
      const seen=new Set();
      for(const el of candidates){
        const t=txt(el);
        if(!/more\s+(shipment\s+)?details|more\s+information|show\s+more|view\s+details|expand/i.test(t))continue;
        const target=el.closest('button,a,[role="button"],[aria-expanded],[onclick],[tabindex],summary')||el;
        if(seen.has(target))continue;seen.add(target);
        try{target.click()}catch{}
      }
      const amount=Math.max(500,Math.floor(window.innerHeight*0.8));
      window.scrollBy(0,amount);
      for(const el of document.querySelectorAll('div,section,main')){
        try{
          const s=getComputedStyle(el);
          if(!/(auto|scroll)/.test(s.overflowY))continue;
          if(el.scrollHeight<=el.clientHeight+80)continue;
          el.scrollTop=Math.min(el.scrollHeight,el.scrollTop+amount);
        }catch{}
      }
    }).catch(()=>{});
    await sleep(450);
    const height=await page.evaluate(()=>document.documentElement?.scrollHeight||document.body?.scrollHeight||0).catch(()=>0);
    const text=await bodyText(page);snapshots.push(text);
    if(height===lastHeight)stable++;else stable=0;
    lastHeight=height;
    const atBottom=await page.evaluate(()=>Math.ceil(window.scrollY+window.innerHeight)>=((document.documentElement?.scrollHeight||document.body?.scrollHeight||0)-20)).catch(()=>false);
    if(atBottom&&stable>=2)break;
  }
  return snapshots.join('\n');
}

async function markAwbInput(page){
  return page.evaluate(()=>{
    const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>40&&r.height>18&&!e.disabled&&!e.readOnly};
    const inputs=[...document.querySelectorAll('input')].filter(visible).filter(e=>!['hidden','checkbox','radio','submit','button','password','email'].includes(String(e.type||'text').toLowerCase()));
    const found=inputs.find(e=>/awb|air\s*waybill|shipment/i.test(`${e.placeholder||''} ${e.name||''} ${e.id||''} ${e.getAttribute('aria-label')||''} ${e.closest('form,section,div')?.innerText||''}`))||inputs[0];
    if(!found)return false;found.dataset.mayaviSalAwb='1';found.scrollIntoView({block:'center'});return true;
  }).catch(()=>false);
}

async function fillAwb(page,mawb){
  await page.click('[data-mayavi-sal-awb="1"]',{clickCount:3}).catch(()=>{});
  await page.keyboard.press('Control+A').catch(()=>{});await page.keyboard.press('Backspace').catch(()=>{});
  await page.type('[data-mayavi-sal-awb="1"]',digits(mawb),{delay:30});
  await page.evaluate(()=>{const e=document.querySelector('[data-mayavi-sal-awb="1"]');if(!e)return;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));e.blur();}).catch(()=>{});
}

async function clickTrack(page,timeout=12000){
  const end=Date.now()+timeout;
  while(Date.now()<end){
    const hit=await page.evaluate(()=>{
      const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>6&&r.height>6&&!e.disabled};
      const txt=e=>String(e.innerText||e.textContent||e.value||e.getAttribute('aria-label')||'').replace(/\s+/g,' ').trim();
      const all=[...document.querySelectorAll('button,a,[role="button"],input[type="submit"],input[type="button"]')].filter(visible);
      for(const label of ['Track Shipment','Track a Shipment','Track','Search','Submit']){
        const x=all.find(e=>txt(e).toLowerCase()===label.toLowerCase());
        if(x){x.dataset.mayaviSalTrack='1';x.scrollIntoView({block:'center'});return txt(x);}
      }
      return'';
    }).catch(()=> '');
    if(hit){try{await page.click('[data-mayavi-sal-track="1"]')}catch{await page.evaluate(()=>document.querySelector('[data-mayavi-sal-track="1"]')?.click()).catch(()=>{})}return hit;}
    await sleep(300);
  }
  return'';
}

export async function trackSaudiaViaSal(input){
  const mawb=normalizeMawb(input);
  if(!mawb||!mawb.startsWith('065-'))return{ok:false,reason:'INVALID SAUDIA MAWB',officialTracker:URL};

  // HARD STOP: SAL automated network access is intentionally disabled.
  // Do not add browser/API requests here unless SAL provides explicit written
  // authorization or an approved integration endpoint.
  return{
    ok:false,
    reason:'SAL AUTOMATION HARD-DISABLED - USE OFFICIAL TRACKER / AUTHORIZED API',
    officialTracker:URL,
    safeMode:true
  };
}
