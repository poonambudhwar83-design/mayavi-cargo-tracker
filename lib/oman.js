import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { normalizeMawb } from './airlines.js';

const OFFICIAL='https://cargo.omanair.com/track-shipment';
const SMARTTRACK='https://omanair.smartkargo.com/FrmAWBTracking.aspx';
const AIRLINE={name:'Oman Air Cargo',iata:'WY',url:OFFICIAL};
const MONTHS={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
const digits=s=>String(s||'').replace(/\D/g,'');
const first=(s,rx)=>(String(s).match(rx)||[])[1]||'';
const pad=v=>String(v).padStart(2,'0');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function parseDate(s=''){
  const t=String(s).toUpperCase();let m=t.match(/\b(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})\b/);if(m)return`${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m=t.match(/\b(\d{1,2})[-\/.](\d{1,2})[-\/.](20\d{2})\b/);if(m)return`${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  m=t.match(/\b(\d{1,2})[\s\-]+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s\-,]+(20\d{2})\b/);if(m)return`${m[3]}-${MONTHS[m[2]]}-${pad(m[1])}`;
  return'';
}
function parseTime(s=''){const m=String(s).match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);return m?`${pad(m[1])}:${m[2]}`:'';}
function linked(text,full,serial){const d=digits(text);return Boolean(d.includes(full)||d.includes(serial));}
function around(text,rx,before=120,after=480){const m=rx.exec(String(text));if(!m)return'';const i=m.index||0;return String(text).slice(Math.max(0,i-before),Math.min(String(text).length,i+after));}
function statusFrom(text=''){
  const s=String(text).toUpperCase();
  if(/\bDLV\b|DELIVERED/.test(s))return'DELIVERED';
  if(/\bRCF\b|RECEIVED FROM FLIGHT|ACTUAL ARRIVAL|\bARRIVED\b|\bARR\b|LANDED/.test(s))return'ARRIVED';
  if(/\bDELAYED\b|OFFLOAD|SHORT SHIP|EXCEPTION/.test(s))return'DELAYED';
  if(/\bDEP\b|DEPARTED|IN TRANSIT|AIRBORNE|IN FLIGHT/.test(s))return'IN TRANSIT';
  if(/\bRCS\b|\bBKD\b|BOOKED|ACCEPTED|RECEIVED FROM SHIPPER/.test(s))return'BOOKED';
  return'TRACKING';
}
function parseShipment(text,mawb){
  const flat=clean(text),upper=flat.toUpperCase();
  const origin=(first(flat,/(?:\bOrigin\b|Departure\s*(?:Station|Airport)?)\s*[:\-]?\s*([A-Z]{3})\b/i)||first(flat,/\bFrom\b\s*[:\-]?\s*([A-Z]{3})\b/i)||'').toUpperCase();
  const destination=(first(flat,/(?:\bDestination\b|Arrival\s*(?:Station|Airport)?)\s*[:\-]?\s*([A-Z]{3})\b/i)||first(flat,/\bTo\b\s*[:\-]?\s*([A-Z]{3})\b/i)||'').toUpperCase();
  const pieces=first(flat,/(?:Pieces?|Pcs?|No\.?\s*of\s*Pieces|Piece Count|Total Pieces)\s*[:#\-]?\s*(\d{1,6})\b/i)||first(flat,/\b(\d{1,6})\s*(?:PCS|PIECES?)\b/i);
  const weight=(first(flat,/(?:Gross\s*Weight|Chargeable\s*Weight|Total\s*Weight|\bWeight\b)\s*[:#\-]?\s*([\d,.]+)\s*(?:KG|KGS)?/i)||first(flat,/\b([\d,.]+)\s*(?:KG|KGS)\b/i)).replace(/,/g,'');
  const flights=[...upper.matchAll(/\bWY\s*[- ]?(\d{2,4})\b/g)];const flightNo=flights.length?`WY${flights.at(-1)[1]}`:'';
  const bookingDate=parseDate(around(flat,/BOOKING\s*DATE|BOOKED|\bRCS\b|ACCEPTED/i,100,360));
  const actual=around(flat,/ACTUAL\s+ARRIVAL|\bARRIVED\b|RECEIVED\s+FROM\s+FLIGHT|\bRCF\b|\bARR\b|LANDED/i);
  const eta=around(flat,/ESTIMATED\s+ARRIVAL|EXPECTED\s+ARRIVAL|\bETA\b|SCHEDULED\s+ARRIVAL|\bSTA\b/i);
  let arrivalDate=parseDate(actual),arrivalTime=parseTime(actual),arrivalIsActual=Boolean(arrivalDate||arrivalTime);
  if(!arrivalIsActual){arrivalDate=parseDate(eta);arrivalTime=parseTime(eta);}
  let status=statusFrom(flat);if(!arrivalIsActual&&(arrivalDate||arrivalTime)&&status==='TRACKING')status='IN TRANSIT';
  return{mawb,carrierCode:'WY',airlineName:AIRLINE.name,origin,destination,bags:pieces,pieces,weight,flightNo,bookingDate,arrivalDate,arrivalTime,arrivalIsActual,status,officialTracker:OFFICIAL,source:'Oman Air Cargo SmartKargo AWB tracking result'};
}
function useful(s={}){return Boolean((s.origin&&s.destination)||s.pieces||s.weight||s.flightNo||s.bookingDate||s.arrivalDate||s.arrivalTime||(s.status&&s.status!=='TRACKING'));}
async function launch(){chromium.setGraphicsMode=false;return puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox'],defaultViewport:{width:1440,height:1100},executablePath:await chromium.executablePath(),headless:'shell'});}
async function renderedSources(browser,full,serial){const out=[];for(const p of await browser.pages()){for(const f of p.frames()){try{const t=await f.evaluate(()=>document.body?.innerText||'');if(t&&linked(t,full,serial))out.push({url:f.url(),text:t});}catch{}}}return out;}
async function scanInputs(page){const out=[];for(const f of page.frames()){try{out.push(await f.evaluate(()=>({url:location.href,text:(document.body?.innerText||'').replace(/\s+/g,' ').slice(0,1200),inputs:[...document.querySelectorAll('input')].map((e,i)=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return{i,type:e.type||'',name:e.name||'',id:e.id||'',ph:e.placeholder||'',max:e.maxLength,visible:r.width>2&&r.height>2&&s.display!=='none'&&s.visibility!=='hidden',value:e.value||''}}),buttons:[...document.querySelectorAll('button,input[type=button],input[type=submit],[role=button]')].map((e,i)=>({i,text:(e.innerText||e.value||'').trim(),id:e.id||'',name:e.name||''}))})));}catch{}}return out;}
async function fillTrackingPage(page,prefix,serial,full){
  await page.goto(SMARTTRACK,{waitUntil:'domcontentloaded',timeout:25000});await sleep(3500);
  const scans=await scanInputs(page);
  for(const f of page.frames()){
    try{
      const r=await f.evaluate(({prefix,serial,full})=>{
        const vis=e=>{const b=e.getBoundingClientRect(),s=getComputedStyle(e);return b.width>2&&b.height>2&&s.display!=='none'&&s.visibility!=='hidden'&&!e.disabled&&!e.readOnly};
        let inputs=[...document.querySelectorAll('input')].filter(vis).filter(e=>!['hidden','password','checkbox','radio','button','submit'].includes((e.type||'text').toLowerCase()));
        inputs=inputs.filter(e=>!/captcha|user|login|password/i.test(`${e.name} ${e.id} ${e.placeholder} ${e.getAttribute('aria-label')}`));
        if(!inputs.length)return{ok:false,reason:'NO_INPUTS'};
        const setVal=(e,v)=>{const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;set?.call(e,v);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));};
        const desc=e=>`${e.name} ${e.id} ${e.placeholder} ${e.getAttribute('aria-label')}`.toLowerCase();
        const pf=inputs.find(e=>Number(e.maxLength)===3||/prefix|airline/.test(desc(e)));
        let nf=inputs.find(e=>e!==pf&&(Number(e.maxLength)===8||/awb|airway|waybill|shipment|number/.test(desc(e))));
        if(pf&&nf){setVal(pf,prefix);setVal(nf,serial);}else if(inputs.length>=2){setVal(inputs[0],prefix);setVal(inputs[1],serial);nf=inputs[1];}else{setVal(inputs[0],full);nf=inputs[0];}
        const buttons=[...document.querySelectorAll('button,input[type=button],input[type=submit],[role=button]')].filter(vis);
        const b=buttons.find(e=>/track|search|submit|go/i.test((e.innerText||e.value||'').trim()));if(b){b.click();return{ok:true,button:(b.innerText||b.value||'').trim(),count:inputs.length};}
        const form=nf?.form||nf?.closest('form');if(form?.requestSubmit){form.requestSubmit();return{ok:true,button:'requestSubmit',count:inputs.length};}
        return{ok:true,button:'enter',count:inputs.length};
      },{prefix,serial,full});
      if(r.ok){if(r.button==='enter')await page.keyboard.press('Enter').catch(()=>{});return{...r,frameUrl:f.url(),scans};}
    }catch{}
  }
  return{ok:false,reason:'NO_TRACK_FRAME',scans};
}

export async function trackOman(input){
  const mawb=normalizeMawb(input);if(!mawb||!mawb.startsWith('910-'))return{ok:false,reason:'INVALID OMAN AIR CARGO MAWB',airline:AIRLINE,officialTracker:OFFICIAL};
  const full=digits(mawb),prefix=full.slice(0,3),serial=full.slice(3);let browser;
  try{
    browser=await launch();const page=await browser.newPage();await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36');
    const setup=await fillTrackingPage(page,prefix,serial,full);await sleep(4500);try{await page.waitForNetworkIdle({idleTime:700,timeout:7000});}catch{}await sleep(1000);
    const sources=await renderedSources(browser,full,serial);
    for(const s of sources){const shipment=parseShipment(s.text,mawb);if(useful(shipment))return{ok:true,airline:AIRLINE,shipment,screenshotCaptured:false,screenshotVerified:false,screenshotOcrUsed:false,debug:{stage:'SMARTKARGO_DIRECT_SUCCESS',setup:{...setup,scans:undefined},sourceUrl:s.url,textSample:clean(s.text).slice(0,6000)}};}
    return{ok:false,reason:'OMAN AIR SMARTKARGO RETURNED NO VERIFIED AWB RESULT',airline:AIRLINE,officialTracker:OFFICIAL,debug:{stage:'SMARTKARGO_NO_RESULT',setup,pages:(await browser.pages()).map(p=>p.url())}};
  }catch(e){return{ok:false,reason:`OMAN AIR TRACKING ERROR: ${e?.message||e}`,airline:AIRLINE,officialTracker:OFFICIAL,debug:{stage:'ERROR',message:e?.message||String(e)}};}
  finally{try{if(browser)await browser.close()}catch{}}
}
