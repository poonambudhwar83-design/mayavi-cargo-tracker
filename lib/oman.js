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
  const route=upper.match(/\bORIGIN\b\s*[:\-]?\s*([A-Z]{3})\b[\s\S]{0,220}?\bDESTINATION\b\s*[:\-]?\s*([A-Z]{3})\b/)||upper.match(/\bFROM\b\s*[:\-]?\s*([A-Z]{3})\b[\s\S]{0,220}?\bTO\b\s*[:\-]?\s*([A-Z]{3})\b/)||upper.match(/\b([A-Z]{3})\s*(?:→|->|—|-)\s*([A-Z]{3})\b/);
  const origin=route?.[1]||'',destination=route?.[2]||'';
  const pieces=first(flat,/(?:Pieces?|Pcs?|No\.?\s*of\s*Pieces|Piece Count|Total Pieces)\s*[:\-]?\s*(\d{1,6})/i)||first(flat,/\b(\d{1,6})\s*(?:PCS|PIECES?)\b/i);
  const weight=(first(flat,/(?:Gross\s*Weight|Chargeable\s*Weight|Weight|Total Weight)\s*[:\-]?\s*([\d,.]+)\s*(?:KG|KGS)?/i)||first(flat,/\b([\d,.]+)\s*(?:KG|KGS)\b/i)).replace(/,/g,'');
  const fm=upper.match(/\bWY\s*[- ]?(\d{2,4})\b/);const flightNo=fm?`WY${fm[1]}`:'';
  const actual=(flat.match(/(?:Actual Arrival|Arrived|\bARR\b|Received from Flight|RCF|Landed)[\s\S]{0,300}/i)||[])[0]||'';
  const estimated=(flat.match(/(?:ETA|Estimated Arrival|Expected Arrival|Scheduled Arrival|STA)[\s\S]{0,300}/i)||[])[0]||'';
  let arrivalDate=parseDate(actual),arrivalTime=parseTime(actual),arrivalIsActual=Boolean(arrivalDate||arrivalTime);
  if(!arrivalDate&&!arrivalTime){arrivalDate=parseDate(estimated);arrivalTime=parseTime(estimated);arrivalIsActual=false;}
  let status=statusFromText(flat);
  if(!arrivalIsActual&&(arrivalDate||arrivalTime)&&status!=='DELAYED')status='IN TRANSIT';
  return{mawb,carrierCode:'WY',airlineName:AIRLINE.name,origin,destination,bags:pieces,pieces,weight,flightNo,arrivalDate,arrivalTime,arrivalIsActual,status,officialTracker:OFFICIAL,source:'Oman Air Cargo official website direct extraction'};
}
function useful(s={}){return Boolean((s.origin&&s.destination)||s.pieces||s.weight||s.flightNo||s.arrivalDate||s.arrivalTime||(s.status&&s.status!=='TRACKING'));}
async function launch(){chromium.setGraphicsMode=false;return puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox'],defaultViewport:{width:1365,height:900,deviceScaleFactor:1},executablePath:await chromium.executablePath(),headless:'shell'});}

export async function trackOman(input){
  const mawb=normalizeMawb(input);if(!mawb||!mawb.startsWith('910-'))return{ok:false,reason:'INVALID OMAN AIR CARGO MAWB',airline:AIRLINE,officialTracker:OFFICIAL};
  const full=mawb.replace(/\D/g,''),serial=mawb.slice(4);let browser;const captured=[];
  try{
    browser=await launch();const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36');
    page.on('response',async res=>{try{const type=res.request().resourceType();if(!['xhr','fetch','document'].includes(type))return;const ct=String(res.headers()['content-type']||'');if(!/json|text|javascript|html/i.test(ct))return;const body=await res.text();if(body&&body.length<1200000&&(body.includes(serial)||body.replace(/\D/g,'').includes(full)||/shipment|airway|awb|flight|arrival|pieces|weight/i.test(body)))captured.push(body);}catch{}});
    await page.goto(OFFICIAL,{waitUntil:'domcontentloaded',timeout:20000});await new Promise(r=>setTimeout(r,1200));
    const before=clean(await page.evaluate(()=>document.body?.innerText||'').catch(()=>''));
    if(/captcha|verify you are human|security check|cloudflare|turnstile|access denied/i.test(before))return{ok:false,reason:'OMAN AIR SECURITY CHECK REQUIRES MANUAL CHECK',airline:AIRLINE,officialTracker:OFFICIAL,debug:{stage:'CAPTCHA'}};

    const setup=await page.evaluate(({full,serial})=>{
      const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>3&&r.height>3&&!e.disabled};
      const inputs=[...document.querySelectorAll('input')].filter(visible).filter(e=>!['hidden','checkbox','radio','submit','button'].includes((e.type||'text').toLowerCase()));
      const desc=e=>`${e.name||''} ${e.id||''} ${e.placeholder||''} ${e.getAttribute('aria-label')||''}`.toLowerCase();
      const target=inputs.find(e=>/airway|awb|shipment|track/.test(desc(e)))||inputs[0];
      if(!target)return{filled:false,inputCount:inputs.length};
      target.focus();
      const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;setter?.call(target,full);
      target.dispatchEvent(new Event('input',{bubbles:true}));target.dispatchEvent(new Event('change',{bubbles:true}));target.dispatchEvent(new KeyboardEvent('keyup',{bubbles:true,key:'Tab'}));target.dispatchEvent(new Event('blur',{bubbles:true}));
      return{filled:true,value:target.value,inputCount:inputs.length,serial,form:Boolean(target.form||target.closest('form'))};
    },{full,serial}).catch(()=>({filled:false}));
    if(!setup.filled)return{ok:false,reason:'OMAN AIR AWB INPUT NOT FOUND',airline:AIRLINE,officialTracker:OFFICIAL,debug:{stage:'NO_INPUT',setup}};

    const submit=await page.evaluate(()=>{
      const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>3&&r.height>3&&!e.disabled};
      const inputs=[...document.querySelectorAll('input')].filter(visible).filter(e=>!['hidden','checkbox','radio','submit','button'].includes((e.type||'text').toLowerCase()));
      const desc=e=>`${e.name||''} ${e.id||''} ${e.placeholder||''} ${e.getAttribute('aria-label')||''}`.toLowerCase();
      const field=inputs.find(e=>/airway|awb|shipment|track/.test(desc(e)))||inputs[0];
      if(!field)return{submitted:false,method:'NO_FIELD'};
      const form=field.form||field.closest('form');
      const label=e=>(e.innerText||e.value||e.getAttribute('aria-label')||e.getAttribute('title')||'').replace(/\s+/g,' ').trim();
      if(form){
        const controls=[...form.querySelectorAll('button,input[type="submit"],input[type="button"],[role="button"]')].filter(visible);
        const btn=controls.find(e=>/track shipment|track|search|submit|go/i.test(label(e)));
        if(btn){btn.click();return{submitted:true,method:'FORM_BUTTON',button:label(btn)};}
        if(typeof form.requestSubmit==='function'){form.requestSubmit();return{submitted:true,method:'FORM_REQUEST_SUBMIT'};}
        form.submit();return{submitted:true,method:'FORM_SUBMIT'};
      }
      const controls=[...document.querySelectorAll('button,input[type="submit"],input[type="button"],[role="button"]')].filter(visible);
      const btn=controls.find(e=>/track shipment|track|search|submit|go/i.test(label(e)));
      if(btn){btn.click();return{submitted:true,method:'PAGE_BUTTON',button:label(btn)};}
      field.focus();return{submitted:false,method:'NO_SUBMIT_CONTROL'};
    }).catch(()=>({submitted:false,method:'ERROR'}));
    if(!submit.submitted){await page.keyboard.press('Enter').catch(()=>{});submit.method='ENTER_FALLBACK';}

    try{await page.waitForNetworkIdle({idleTime:800,timeout:12000});}catch{}
    await new Promise(r=>setTimeout(r,2200));
    const text=await page.evaluate(()=>document.body?.innerText||'').catch(()=>'');
    const combined=[text,...captured].join(' ');
    const shipment=parseShipment(combined,mawb);
    if(useful(shipment))return{ok:true,airline:AIRLINE,shipment,screenshotCaptured:false,screenshotVerified:false,screenshotOcrUsed:false,debug:{stage:'DIRECT_SUCCESS',setup,submit,captured:captured.length,textSample:clean(combined).slice(0,5000)}};
    return{ok:false,reason:'OMAN AIR OFFICIAL PAGE RETURNED NO VERIFIED SHIPMENT DATA',airline:AIRLINE,officialTracker:OFFICIAL,debug:{stage:'NO_DATA',setup,submit,captured:captured.length,textSample:clean(combined).slice(0,5000)}};
  }catch(e){return{ok:false,reason:`OMAN AIR TRACKING ERROR: ${e?.message||e}`,airline:AIRLINE,officialTracker:OFFICIAL,debug:{stage:'ERROR',message:e?.message||String(e)}};}
  finally{try{if(browser)await browser.close()}catch{}}
}
