// Gulf Air Falcon Cargo (GF / 072) - official CHAMP air waybill tracker.
// This adapter does not manufacture schedule/arrival data when CHAMP is unavailable.
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { normalizeMawb } from './airlines.js';
import { normalizeShipmentTimesToIst } from './exportIst.js';

export const GULF_AIR_TRACK_URL='https://ebooking.champ.aero/webtracking/gf/tracking.asp';
// CHAMP's newer, publicly published multi-airline Track & Trace portal.
export const GULF_AIR_MODERN_TRACK_URL='https://track.champ.aero/';
const MONTHS={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
const pad=n=>String(n).padStart(2,'0');
const clean=s=>String(s??'').replace(/\s+/g,' ').trim();
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function dateFrom(s=''){
  const t=String(s).toUpperCase();
  let m=t.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if(m)return m[1]+'-'+pad(m[2])+'-'+pad(m[3]);
  m=t.match(/\b(\d{1,2})[-/](\d{1,2})[-/](20\d{2})\b/);
  if(m)return m[3]+'-'+pad(m[2])+'-'+pad(m[1]);
  m=t.match(/\b(\d{1,2})[\s-]*(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s,\-]*(20\d{2}|\d{2})\b/);
  if(m)return (m[3].length===2?'20'+m[3]:m[3])+'-'+MONTHS[m[2]]+'-'+pad(m[1]);
  m=t.match(/\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s,\-]+(\d{1,2})[,\s-]+(20\d{2}|\d{2})\b/);
  if(m)return (m[3].length===2?'20'+m[3]:m[3])+'-'+MONTHS[m[1]]+'-'+pad(m[2]);
  return '';
}
function timeFrom(s=''){
  const raw=String(s).toUpperCase();
  const twelve=raw.match(/\b(1[0-2]|0?[1-9]):([0-5]\d)\s*(AM|PM)\b/);
  if(twelve){
    let hour=Number(twelve[1])%12+(twelve[3]==='PM'?12:0);
    return pad(hour)+':'+twelve[2];
  }
  const m=raw.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  return m?pad(m[1])+':'+m[2]:'';
}
function stationCode(s=''){
  const t=String(s).toUpperCase().trim();
  // Do not mistake the OCT in an event date (27-OCT-2026) for an airport.
  const exact=t.match(/^\(?([A-Z]{3})\)?(?:\s*[-–]\s*[A-Z ]+)?$/);
  return exact?.[1]||t.match(/\(([A-Z]{3})\)/)?.[1]||'';
}
function codeFor(s=''){
  const t=clean(s).toUpperCase();
  if(/\bDLV\b|DELIVERED TO|^DELIVERED\b/.test(t))return 'DLV';
  if(/\bRCF\b|RECEIVED FROM FLIGHT|RECEIVED AT DESTINATION/.test(t))return 'RCF';
  if(/\bARR\b|^ARRIVED\b|FLIGHT ARRIVED/.test(t))return 'ARR';
  if(/\bDEP\b|DEPARTED|FLIGHT DEPARTURE/.test(t))return 'DEP';
  if(/\bOFF\b|OFFLOADED|OFFLOADING/.test(t))return 'OFF';
  if(/\bMAN\b|MANIFESTED|PRE-MANIFEST/.test(t))return 'MAN';
  if(/\bRCS\b|RECEIVED FROM SHIPPER|CARGO ACCEPTED/.test(t))return 'RCS';
  if(/\bBKD\b|^BOOKED\b/.test(t))return 'BKD';
  return '';
}
function field(text,rx){
  return clean(text.match(rx)?.[1]||'');
}
function weightValue(text){
  const m=String(text).match(/\b(?:GROSS\s+)?WEIGHT\s*[:\-]?\s*([\d,]+(?:\.\d+)?)\s*(?:KGS?|KILOGRAMS?)?/i)
    ||String(text).match(/\b([\d,]+(?:\.\d+)?)\s*KGS?\b/i);
  return m?m[1].replace(/,/g,''):'';
}
function piecesValue(text){
  const m=String(text).match(/\b(?:NO\.?\s*OF\s*)?(?:PCS|PIECES|BAGS)\s*[:\-]?\s*(\d{1,6})\b/i)
    ||String(text).match(/\b(\d{1,6})\s*(?:PCS|PIECES|BAGS)\b/i);
  return m?m[1]:'';
}
function awbVisible(text,mawb){
  const serial=mawb.slice(4);
  return new RegExp('(?:^|\\D)072[\\s-]*'+serial+'(?:\\D|$)').test(text)
    ||new RegExp('\\bAWB\\s*(?:NUMBER|NO\\.?|#)?\\s*[:#-]?\\s*'+serial+'\\b','i').test(text);
}
function rowsFromDom(dom={}){
  return (Array.isArray(dom.tables)?dom.tables:[])
    .flatMap(table=>Array.isArray(table)?table:table.rows||[])
    .filter(row=>Array.isArray(row)&&row.some(Boolean));
}
function eventFromRow(cells){
  const content=cells.map(clean);
  const text=content.join(' | ');
  const code=codeFor(content[0]||'')||codeFor(text);
  if(!code)return null;
  const station=content.slice(1).map(stationCode).find(Boolean)||'';
  const date=dateFrom(text),time=timeFrom(text);
  const flight=text.toUpperCase().match(/\bGF[\s-]?(\d{2,4})\b/);
  if(!date&&!station&&!flight)return null;
  return {code,station,date,time,flightNo:flight?'GF'+flight[1]:'',pieces:piecesValue(text),weight:weightValue(text),description:text};
}
function newest(events){
  return [...events].sort((a,b)=>{
    const stamp=e=>e.date?Date.parse(e.date+'T'+(e.time||'00:00')+':00Z')||0:0;
    return stamp(a)-stamp(b);
  }).at(-1)||null;
}
export function parseGulfAirTrackingPage(dom={},mawbInput=''){
  const mawb=normalizeMawb(mawbInput),text=String(dom.text||'');
  if(!mawb||!mawb.startsWith('072-'))return {ok:false,reason:'INVALID GULF AIR MAWB'};
  if(/no (?:shipment|records?|results?) found|awb not found|invalid (?:airway|air waybill|awb)|no data available/i.test(text))
    return {ok:false,reason:'GULF AIR CHAMP NO SHIPMENT RECORD'};
  // The empty search form contains 072 but not the entered serial in visible text.
  // An exact AWB on the result is mandatory; never accept a generic site shell.
  if(!awbVisible(text,mawb))return {ok:false,reason:'GULF AIR CHAMP AWB NOT VERIFIED'};
  const tables=rowsFromDom(dom);
  const fromRows=tables.map(eventFromRow).filter(Boolean);
  // New CHAMP Track & Trace renders some event descriptions as cards instead
  // of <table> cells. Accept those only when the exact AWB is on the page.
  const eventNames='Received from Shipper|Received from Flight|Pre-manifested on flight|Manifested on flight|Flight Departed|Flight Arrived|Booking On Hold|Booked|Departed|Arrived|Offloaded|Delivered|RCS|RCF|MAN|DEP|ARR|DLV';
  const dates='\\d{1,2}[\\s-]*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[\\s,-]*20\\d{2}';
  const eventRx=new RegExp('\\b('+eventNames+')\\s+('+dates+')\\s*[-–]?\\s*(\\d{1,2}:\\d{2})([^\\n]{0,170})','gi');
  const textEvents=[];
  for(const match of text.matchAll(eventRx)){
    const raw=[match[1],match[2],match[3],match[4]].join(' ');
    const code=codeFor(match[1]),date=dateFrom(match[2]),time=timeFrom(match[3]);
    const station=stationCode(match[4].match(/\b(?:AT|IN|AIRPORT)\s+([A-Z]{3})\b/i)?.[1]||'')
      ||stationCode((text.slice(Math.max(0,match.index-10),match.index).match(/\b([A-Z]{3})\s*$/)||[])[1]||'');
    const f=raw.match(/\bGF[\s-]?(\d{2,4})\b/i);
    if(code&&date)textEvents.push({code,station,date,time,flightNo:f?'GF'+f[1]:'',pieces:piecesValue(raw),weight:weightValue(raw),description:clean(raw)});
  }
  const events=[...fromRows,...textEvents];
  const unique=[...new Map(events.map(e=>[[e.code,e.station,e.date,e.time,e.flightNo,e.pieces,e.weight].join('|'),e])).values()];
  const header=clean(text.slice(0,4000));
  const route=text.match(/\b([A-Z]{3})\s*[-–]\s*([A-Z]{3})\b/);
  const origin=stationCode(field(header,/\b(?:ORIGIN|FROM)\s*[:\-]?\s*([A-Z]{3})\b/i))||route?.[1]||unique.find(e=>e.code==='RCS')?.station||'';
  const destination=stationCode(field(header,/\b(?:DESTINATION|TO)\s*[:\-]?\s*([A-Z]{3})\b/i))||route?.[2]||'';
  const flightCells=tables.map(r=>r.join(' | '));
  const allFlightNos=[...(flightCells.join('\n')+'\n'+text).matchAll(/\bGF[\s-]?(\d{2,4})\b/gi)].map(m=>'GF'+m[1]);
  const latestFlight=newest(unique.filter(e=>e.flightNo));
  const flightNo=latestFlight?.flightNo||allFlightNos.at(-1)||'';
  const lastAccepted=newest(unique.filter(e=>e.code==='RCS'||e.code==='BKD'));
  const lastDeparted=newest(unique.filter(e=>e.code==='DEP'));
  const lastOffloaded=newest(unique.filter(e=>e.code==='OFF'));
  const lastFinal=newest(unique.filter(e=>(e.code==='RCF'||e.code==='ARR'||e.code==='DLV')&&destination&&e.station===destination));
  const lastDelivered=newest(unique.filter(e=>e.code==='DLV'&&destination&&e.station===destination));
  const latestQty=[...unique].reverse().find(e=>e.pieces||e.weight)||{};
  const pieces=piecesValue(header)||latestQty.pieces||'';
  const weight=weightValue(header)||latestQty.weight||'';
  const meaningful=Boolean(unique.length||(origin&&destination)||(flightNo&&(pieces||weight))||(pieces&&weight));
  if(!meaningful)return {ok:false,reason:'GULF AIR CHAMP RESULT HAS NO VERIFIED TRACKING DETAILS'};
  const current=newest(unique),status=lastDelivered?'DELIVERED':lastFinal?'ARRIVED'
    :lastDeparted&&(current?.code!=='OFF')?'IN TRANSIT'
    :lastOffloaded?'OFFLOADED'
    :unique.some(e=>e.code==='MAN')?'MANIFESTED'
    :lastAccepted?'BOOKED':'TRACKING';
  const via=unique.map(e=>e.station).find(code=>code&&code!==origin&&code!==destination)||'';
  const shipment={
    mawb,carrierCode:'GF',airlineName:'Gulf Air Cargo',
    officialTracker:dom.officialTracker||GULF_AIR_TRACK_URL,source:'Gulf Air Falcon Cargo official CHAMP AWB tracking',
    origin,destination,via,flightNo,flightDate:latestFlight?.date||'',
    pieces,bags:pieces,weight,masterWeight:weight,
    bookingDate:lastAccepted?.date||'',
    departureDate:lastDeparted?.date||'',departureTime:lastDeparted?.time||'',
    departureIsActual:Boolean(lastDeparted),
    departureOrigin:lastDeparted?.station||origin,
    departureTimeZone:'LOCAL',departureTimeSource:lastDeparted?'Gulf Air CHAMP DEP event':'',
    arrivalDate:lastFinal?.date||'',arrivalTime:lastFinal?.time||'',
    arrivalIsActual:Boolean(lastFinal),arrivalTimeZone:'LOCAL',
    arrivalTimeSource:lastFinal?'Gulf Air CHAMP final destination '+lastFinal.code+' event':'',
    status,shipmentEvents:unique.slice(-30)
  };
  // CHAMP event clocks are local to their event airports; preserve exact date
  // without inventing an arrival time for a merely manifested flight.
  const adjusted=normalizeShipmentTimesToIst(shipment);
  return {ok:true,shipment:adjusted,events:unique};
}
async function extract(page){
  const pages=[page,...(await page.browser().pages()).filter(p=>p!==page&&!p.isClosed())];
  const texts=[],tables=[];
  for(const p of pages){
    for(const frame of p.frames()){
      try{
        const result=await frame.evaluate(()=>({
          text:document.body?.innerText||'',
          tables:[...document.querySelectorAll('table')].map(table=>
            [...table.querySelectorAll('tr')].map(tr=>
              [...tr.querySelectorAll('th,td')].map(td=>(td.innerText||td.textContent||'').trim())
            ).filter(row=>row.some(Boolean))
          )
        }));
        if(result.text)texts.push(result.text);
        tables.push(...result.tables);
      }catch{}
    }
  }
  return {text:texts.join('\n'),tables};
}
async function submit(page,serial){
  for(const frame of page.frames()){
    try{
      const result=await frame.evaluate(serialValue=>{
        const visible=el=>{
          const r=el.getBoundingClientRect(),s=getComputedStyle(el);
          return r.width>8&&r.height>8&&s.visibility!=='hidden'&&s.display!=='none'&&!el.disabled;
        };
        const inputs=[...document.querySelectorAll('input')].filter(el=>
          visible(el)&&!/^(hidden|button|submit|image|checkbox|radio)$/i.test(el.type||'text')
        );
        const desc=el=>[el.name,el.id,el.placeholder,el.getAttribute('aria-label')].join(' ').toLowerCase();
        const prefix=inputs.find(el=>/prefix|airline/.test(desc(el))||el.maxLength===3);
        let serial=inputs.find(el=>el!==prefix&&(el.maxLength===8||/awb|waybill|serial/.test(desc(el))));
        if(!serial&&inputs.length>=2)serial=inputs.find(el=>el!==prefix)||inputs[1];
        if(!serial&&inputs.length===1)serial=inputs[0];
        if(!serial)return {ok:false,reason:'AWB INPUT NOT FOUND',inputs:inputs.length};
        const set=(el,value)=>{
          const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
          setter?.call(el,value);
          el.dispatchEvent(new Event('input',{bubbles:true}));
          el.dispatchEvent(new Event('change',{bubbles:true}));
          el.dispatchEvent(new Event('blur',{bubbles:true}));
        };
        if(prefix)set(prefix,'072');
        set(serial,prefix||serial.maxLength===8?serialValue:'072'+serialValue);
        const controls=[...document.querySelectorAll('button,input[type="submit"],input[type="button"],input[type="image"],a,[role="button"]')].filter(visible);
        const title=el=>[el.innerText,el.value,el.alt,el.title,el.getAttribute('aria-label')].join(' ').trim();
        const button=controls.find(el=>/^\s*(GO|TRACK|SEARCH)\s*$/i.test(title(el)))||
          controls.find(el=>/\bGO\b|TRACK|SEARCH/i.test(title(el)))||
          controls.find(el=>el.type==='image'||el.type==='submit');
        if(button){button.click();return {ok:true,method:'CLICK',inputs:inputs.length};}
        if(serial.form&&serial.form.requestSubmit){serial.form.requestSubmit();return {ok:true,method:'FORM',inputs:inputs.length};}
        return {ok:false,reason:'SUBMIT BUTTON NOT FOUND',inputs:inputs.length};
      },serial);
      if(result?.ok)return result;
    }catch(e){return {ok:false,reason:'GULF AIR FORM ERROR: '+String(e?.message||e)};}
  }
  return {ok:false,reason:'GULF AIR CHAMP FORM NOT FOUND'};
}
// Expand the public new CHAMP result cards; this does not interact with a
// CAPTCHA or any human-verification challenge.
async function revealResultDetails(page){
  for(const frame of page.frames()){
    await frame.evaluate(()=>{
      const entries=[...document.querySelectorAll('summary,button,a,[role="button"]')];
      for(const element of entries){
        const label=(element.innerText||element.textContent||element.getAttribute('aria-label')||'').trim();
        if(/^details$|^view details$|^show details$/i.test(label))element.click();
      }
    }).catch(()=>{});
  }
}

async function searchOfficial(page,url,mawb){
  const serial=mawb.slice(4);
  let submitResult=null,dom={},stage='OPEN';
  try{
    await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
    await sleep(850);
    stage='FORM';
    submitResult=await submit(page,serial);
    if(!submitResult?.ok){
      const snapshot=await extract(page).catch(()=>({text:'',tables:[]}));
      return {ok:false,reason:submitResult?.reason||'GULF AIR FORM SUBMISSION FAILED',
        debug:{stage,submitResult,url,landedUrl:page.url(),pageSample:snapshot.text.slice(0,1300),
          frames:page.frames().map(f=>f.url()).slice(0,6)}};
    }
    stage='RESULT';
    // Wait for the XHR/results transition; avoid accepting the blank search shell.
    await Promise.race([page.waitForNetworkIdle({idleTime:600,timeout:7000}).catch(()=>{}),sleep(6500)]);
    await revealResultDetails(page);
    let result={ok:false,reason:'GULF AIR CHAMP AWB NOT VERIFIED'};
    for(let attempt=0;attempt<3;attempt++){
      if(attempt)await sleep(900);
      dom=await extract(page);
      if(/I'm not a robot|reCAPTCHA|captcha|verify you are human|access denied/i.test(dom.text)){
        const quota=/exceeding reCAPTCHA Enterprise free quota/i.test(dom.text);
        return {ok:false,reason:quota?'GULF AIR CHAMP RECAPTCHA QUOTA EXCEEDED':'GULF AIR CHAMP REQUIRES MANUAL VERIFICATION',
          manualHint:quota?'The legacy CHAMP provider has exceeded its reCAPTCHA quota. Mayavi cannot retrieve cargo events from that page until the provider restores service.':'The official CHAMP portal requires a human verification.',
          debug:{stage,submitResult,url,challenge:true,quota,sample:dom.text.slice(0,340)}};
      }
      result=parseGulfAirTrackingPage({...dom,officialTracker:url},mawb);
      if(result.ok||/NO SHIPMENT RECORD/.test(result.reason))break;
    }
    if(result.ok)return {ok:true,shipment:result.shipment,officialTracker:url,
      screenshotCaptured:false,screenshotVerified:false,
      debug:{stage:'VERIFIED',sourceUrl:url,eventCount:result.events.length,submitResult}};
    return {ok:false,reason:result.reason,debug:{stage,submitResult,url,
      pageSample:dom.text.slice(0,1000),tableCount:dom.tables.length}};
  }catch(e){return {ok:false,reason:'GULF AIR OFFICIAL TRACKER ERROR: '+String(e?.message||e),
    debug:{stage,submitResult,url}};}
}
export async function trackGulfAir(input){
  const mawb=normalizeMawb(input);
  if(!mawb||!mawb.startsWith('072-'))return{ok:false,reason:'INVALID GULF AIR MAWB',officialTracker:GULF_AIR_TRACK_URL};
  let browser;
  try{
    chromium.setGraphicsMode=false;
    browser=await puppeteer.launch({
      args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox'],
      executablePath:await chromium.executablePath(),
      headless:'shell',defaultViewport:{width:1366,height:1000}
    });
    const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36');
    await page.setExtraHTTPHeaders({'Accept-Language':'en-US,en;q=0.9'});
    // Use CHAMP's public new tracking system first. Legacy Gulf Air WEB+
    // currently reports the provider's reCAPTCHA Enterprise quota failure.
    const newPortal=await searchOfficial(page,GULF_AIR_MODERN_TRACK_URL,mawb);
    if(newPortal.ok)return newPortal;
    const legacy=await searchOfficial(page,GULF_AIR_TRACK_URL,mawb);
    if(legacy.ok)return legacy;
    return{ok:false,reason:legacy.reason||newPortal.reason,
      officialTracker:GULF_AIR_TRACK_URL,
      manualHint:legacy.manualHint||newPortal.manualHint||
        'No verified Gulf Air 072 shipment details were returned from either official CHAMP portal; existing data is preserved.',
      debug:{stage:'OFFICIAL_SOURCE_CHECKED',newPortal:newPortal.debug||{},legacy:legacy.debug||{},
        sourceErrors:[newPortal.reason,legacy.reason]}};
  }catch(e){return{ok:false,reason:'GULF AIR TRACKING FAILED: '+String(e?.message||e),
    officialTracker:GULF_AIR_TRACK_URL,debug:{stage:'BROWSER_ERROR'}};
  }finally{try{await browser?.close()}catch{}}
}
