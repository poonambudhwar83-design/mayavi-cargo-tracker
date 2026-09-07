import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { normalizeMawb } from './airlines.js';

const OFFICIAL='https://cargo.omanair.com/track-shipment';
const AIRLINE={name:'Oman Air Cargo',iata:'WY',url:OFFICIAL};
const MONTHS={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
const pad=v=>String(v).padStart(2,'0');
const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
const first=(s,rx)=>(String(s).match(rx)||[])[1]||'';

function parseDate(s=''){
  const t=String(s).toUpperCase();
  let m=t.match(/\b(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})\b/);if(m)return`${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m=t.match(/\b(\d{1,2})[-\/.](\d{1,2})[-\/.](20\d{2})\b/);if(m)return`${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  m=t.match(/\b(\d{1,2})[\s\-]+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s\-,]+(20\d{2})\b/);if(m)return`${m[3]}-${MONTHS[m[2]]}-${pad(m[1])}`;
  return'';
}
function parseTime(s=''){const m=String(s).match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);return m?`${pad(m[1])}:${m[2]}`:'';}
function statusFromText(text=''){
  const s=String(text).toUpperCase();
  if(/\bDLV\b|DELIVERED/.test(s))return'DELIVERED';
  if(/\bARR\b|\bARRIVED\b|RECEIVED FROM FLIGHT|\bRCF\b|ACTUAL ARRIVAL|LANDED/.test(s))return'ARRIVED';
  if(/DELAY|LATE|OFFLOAD|SHORT SHIP|EXCEPTION/.test(s))return'DELAYED';
  if(/\bDEP\b|DEPARTED|IN TRANSIT|AIRBORNE|IN FLIGHT/.test(s))return'IN TRANSIT';
  if(/\bBKD\b|\bACC\b|BOOKED|ACCEPTED|RECEIVED FROM SHIPPER/.test(s))return'BOOKED';
  return'TRACKING';
}
function parseShipment(text,mawb){
  const flat=clean(text),upper=flat.toUpperCase();
  const route=upper.match(/\bORIGIN\b\s*[:\-]?\s*([A-Z]{3})\b[\s\S]{0,160}?\bDESTINATION\b\s*[:\-]?\s*([A-Z]{3})\b/)||upper.match(/\bFROM\b\s*[:\-]?\s*([A-Z]{3})\b[\s\S]{0,160}?\bTO\b\s*[:\-]?\s*([A-Z]{3})\b/)||upper.match(/\b([A-Z]{3})\s*(?:→|->|—|-)\s*([A-Z]{3})\b/);
  const origin=route?.[1]||'',destination=route?.[2]||'';
  const pieces=first(flat,/(?:Pieces?|Pcs?|No\.?\s*of\s*Pieces|Piece Count)\s*[:\-]?\s*(\d{1,6})/i)||first(flat,/\b(\d{1,6})\s*(?:PCS|PIECES?)\b/i);
  const weight=(first(flat,/(?:Gross\s*Weight|Chargeable\s*Weight|Weight)\s*[:\-]?\s*([\d,.]+)\s*(?:KG|KGS)?/i)||first(flat,/\b([\d,.]+)\s*(?:KG|KGS)\b/i)).replace(/,/g,'');
  const fm=upper.match(/\bWY\s*[- ]?(\d{2,4})\b/);const flightNo=fm?`WY${fm[1]}`:'';
  const actual=(flat.match(/(?:Actual Arrival|Arrived|\bARR\b|Received from Flight|RCF|Landed)[\s\S]{0,240}/i)||[])[0]||'';
  const estimated=(flat.match(/(?:ETA|Estimated Arrival|Expected Arrival|Scheduled Arrival)[\s\S]{0,240}/i)||[])[0]||'';
  let arrivalDate=parseDate(actual),arrivalTime=parseTime(actual),arrivalIsActual=Boolean(arrivalDate||arrivalTime);
  if(!arrivalDate&&!arrivalTime){arrivalDate=parseDate(estimated);arrivalTime=parseTime(estimated);arrivalIsActual=false;}
  let status=statusFromText(flat);
  if(!arrivalIsActual&&(arrivalDate||arrivalTime)&&status!=='DELAYED')status='IN TRANSIT';
  return{mawb,carrierCode:'WY',airlineName:AIRLINE.name,origin,destination,bags:pieces,pieces,weight,flightNo,arrivalDate,arrivalTime,arrivalIsActual,status,officialTracker:OFFICIAL,source:'Oman Air Cargo dedicated official tracker'};
}
function useful(s={}){return Boolean((s.origin&&s.destination)||s.pieces||s.weight||s.flightNo||s.arrivalDate||s.arrivalTime||(s.status&&s.status!=='TRACKING'));}
async function launch(){chromium.setGraphicsMode=false;return puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox'],defaultViewport:{width:1365,height:900,deviceScaleFactor:1},executablePath:await chromium.executablePath(),headless:'shell'});}

export async function trackOman(input){
  const mawb=normalizeMawb(input);if(!mawb||!mawb.startsWith('910-'))return{ok:false,reason:'INVALID OMAN AIR CARGO MAWB',airline:AIRLINE,officialTracker:OFFICIAL};
  const full=mawb.replace(/\D/g,''),serial=mawb.slice(4);let browser;
  try{
    browser=await launch();const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36');
    await page.goto(OFFICIAL,{waitUntil:'domcontentloaded',timeout:12000});await new Promise(r=>setTimeout(r,700));
    const before=clean(await page.evaluate(()=>document.body?.innerText||'').catch(()=>''));
    if(/captcha|verify you are human|security check|cloudflare|turnstile|access denied/i.test(before))return{ok:false,reason:'OMAN AIR SECURITY CHECK REQUIRES MANUAL CHECK',airline:AIRLINE,officialTracker:OFFICIAL,debug:{stage:'CAPTCHA'}};
    const fill=await page.evaluate(({full,serial})=>{
      const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>20&&r.height>10&&!e.disabled};
      const inputs=[...document.querySelectorAll('input')].filter(visible).filter(e=>!['hidden','checkbox','radio','submit','button'].includes((e.type||'text').toLowerCase()));
      const desc=e=>`${e.name||''} ${e.id||''} ${e.placeholder||''} ${e.getAttribute('aria-label')||''}`.toLowerCase();
      const target=inputs.find(e=>/airway|awb|shipment|track/.test(desc(e)))||inputs[0];
      if(!target)return{filled:false,inputCount:inputs.length};
      const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;setter?.call(target,full);target.dispatchEvent(new Event('input',{bubbles:true}));target.dispatchEvent(new Event('change',{bubbles:true}));
      return{filled:true,value:target.value,inputCount:inputs.length,serial};
    },{full,serial}).catch(()=>({filled:false}));
    if(!fill.filled)return{ok:false,reason:'OMAN AIR AWB INPUT NOT FOUND',airline:AIRLINE,officialTracker:OFFICIAL,debug:{stage:'NO_INPUT',fill}};
    let clicked=await page.evaluate(()=>{
      const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>20&&r.height>10&&!e.disabled};
      const els=[...document.querySelectorAll('button,input[type="submit"],[role="button"]')].filter(visible);
      const label=e=>(e.innerText||e.value||e.getAttribute('aria-label')||'').replace(/\s+/g,' ').trim();
      const x=els.map(e=>({e,t:label(e)})).find(x=>/track|search|submit/i.test(x.t));if(!x)return'';x.e.click();return x.t;
    }).catch(()=>'');
    if(!clicked){await page.keyboard.press('Enter').catch(()=>{});clicked='ENTER';}
    await Promise.race([page.waitForNetworkIdle({idleTime:500,timeout:6000}).catch(()=>{}),new Promise(r=>setTimeout(r,6000))]);
    await new Promise(r=>setTimeout(r,600));
    const text=await page.evaluate(()=>document.body?.innerText||'').catch(()=>'');
    const shipment=parseShipment(text,mawb);const screenshotBase64=await page.screenshot({type:'jpeg',quality:60,fullPage:false,encoding:'base64'}).catch(()=>null);
    if(useful(shipment))return{ok:true,airline:AIRLINE,shipment,screenshotCaptured:Boolean(screenshotBase64),screenshotVerified:Boolean(screenshotBase64),screenshotBase64,debug:{stage:'SUCCESS',clicked,fill,textSample:clean(text).slice(0,4000)}};
    return{ok:false,reason:'OMAN AIR OFFICIAL PAGE RETURNED NO VERIFIED SHIPMENT DATA',airline:AIRLINE,officialTracker:OFFICIAL,screenshotBase64,debug:{stage:'NO_DATA',clicked,fill,textSample:clean(text).slice(0,4000)}};
  }catch(e){return{ok:false,reason:`OMAN AIR TRACKING ERROR: ${e?.message||e}`,airline:AIRLINE,officialTracker:OFFICIAL,debug:{stage:'ERROR'}};}
  finally{try{if(browser)await browser.close()}catch{}}
}
