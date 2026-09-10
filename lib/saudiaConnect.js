import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { normalizeMawb } from './airlines.js';

const LOGIN_URL='https://connect.saudiacargo.com/SignIn?returnUrl=%2Fawb-tracking';
const TRACK_URL='https://connect.saudiacargo.com/awb-tracking/';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clean=v=>String(v||'').replace(/\s+/g,' ').trim();
const digits=v=>String(v||'').replace(/\D/g,'');
const first=(text,rx)=>clean((String(text||'').match(rx)||[])[1]||'');

const session=globalThis.__MAYAVI_SAUDIA_CONNECT_SESSION||(globalThis.__MAYAVI_SAUDIA_CONNECT_SESSION={cookies:[],savedAt:0});

function mapStatus(raw=''){
  const s=String(raw||'').trim().toUpperCase();
  if(/\bDLV\b|DELIVERED|ARRIVED|RECEIVED FROM FLIGHT|ARRIVAL/.test(s))return'ARRIVED';
  if(/\bXXX\b|\bDEP\b|DEPARTED|IN TRANSIT|AIRBORNE|MANIFEST|\bRCF\b|\bMAN\b/.test(s))return'IN TRANSIT';
  if(/DELAY|LATE|EXCEPTION/.test(s))return'DELAYED';
  if(/\bBKD\b|BOOKED|\bRCS\b|RECEIVED FROM SHIPPER/.test(s))return'BOOKED';
  return'TRACKING';
}

function parseResult(text='',mawb=''){
  const t=clean(text);if(!t)return null;
  const full=digits(mawb),serial=full.slice(3),flat=digits(t);
  if(full&&!flat.includes(full)&&serial&&!flat.includes(serial))return null;

  const destination=first(t,/(?:\bDestination\b|["']destination["'])\s*["':=\s-]*([A-Z]{3})\b/i).toUpperCase();
  const origin=first(t,/(?:\bOrigin\b|["']origin["'])\s*["':=\s-]*([A-Z]{3})\b/i).toUpperCase();
  const sourceStatus=first(t,/(?:\bStatus\b|["']status["']|["']state["'])\s*["':=\s-]*(DLV|XXX|BKD|ARR|DEP|RCF|MAN|RCS|DLY|[A-Z][A-Z ]{2,32})\b/i).toUpperCase();
  const pieces=first(t,/(?:\bTotal\s*(?:Number\s*Of\s*)?Pieces\b|\bPieces\b|\bPCS\b|["'](?:totalPieces|pieceCount|pieces|totalNoOfPieces)["'])\s*["':=\s-]*(\d{1,6})\b/i);
  const weight=first(t,/(?:\b(?:Gross\s*)?Weight\b|["'](?:weight|grossWeight)["'])\s*["':=\s-]*([\d,.]+)(?:\s*(?:KG|KGS?))?/i).replace(/,/g,'');
  const f=first(t,/(?:\bFlight\s*(?:No\.?|Number)\b|["'](?:flightNo|flightNumber)["'])\s*["':=\s-]*(?:SV\s*[- ]?)?(\d{1,4})\b/i);
  const flightNo=f?`SV${f}`:'';
  const flightDate=first(t,/(?:\bFlight\s*Date\b|["']flightDate["'])\s*["':=\s-]*([0-3]?\d[A-Z]{3}\d{2,4}|20\d{2}[-\/.]\d{1,2}[-\/.]\d{1,2})\b/i).toUpperCase();
  const bookingDate=first(t,/(?:\bBooking\s*Date\b|["']bookingDate["'])\s*["':=\s-]*([0-3]?\d[A-Z]{3}\d{2,4}|20\d{2}[-\/.]\d{1,2}[-\/.]\d{1,2})\b/i).toUpperCase();
  const arrivalDate=first(t,/(?:\bArrival\s*Date\b|["']arrivalDate["'])\s*["':=\s-]*([0-3]?\d[A-Z]{3}\d{2,4}|20\d{2}[-\/.]\d{1,2}[-\/.]\d{1,2})\b/i).toUpperCase();
  const arrivalTime=first(t,/(?:\bArrival\s*Time\b|["']arrivalTime["'])\s*["':=\s-]*(\d{1,2}:\d{2}(?:\s*[AP]M)?)/i).toUpperCase();
  const useful=Boolean(destination||origin||sourceStatus||pieces||weight||flightNo||flightDate||arrivalDate||arrivalTime);
  if(!useful)return null;
  return {
    mawb,carrierCode:'SV',airlineName:'Saudia Cargo',officialTracker:TRACK_URL,
    origin,destination,bags:pieces,pieces,weight,flightNo,flightDate,bookingDate,arrivalDate,arrivalTime,
    arrivalIsActual:Boolean(arrivalDate&&/DLV|DELIVERED|ARRIVED|RECEIVED FROM FLIGHT/i.test(sourceStatus)),
    sourceStatus,status:mapStatus(sourceStatus),source:'Saudia Cargo Connect official tracking'
  };
}

async function bodyText(page){return page.evaluate(()=>document.body?.innerText||'').catch(()=> '');}

async function applyCachedSession(page){
  if(!session.cookies?.length)return false;
  if(Date.now()-Number(session.savedAt||0)>6*60*60*1000){session.cookies=[];session.savedAt=0;return false;}
  try{await page.setCookie(...session.cookies);return true}catch{return false;}
}
async function cacheSession(page){
  try{session.cookies=await page.cookies('https://connect.saudiacargo.com');session.savedAt=Date.now();}catch{}
}

async function isSignedIn(page){
  const text=clean(await bodyText(page));
  if(/For access to our services, please register/i.test(text))return false;
  if(/Login to your account/i.test(text)&&/Password/i.test(text))return false;
  return /AWB Tracking/i.test(text)&&!/register\s*[—-]\s*or sign in/i.test(text);
}

async function login(page){
  const email=String(process.env.SAUDIA_CONNECT_EMAIL||'').trim();
  const password=String(process.env.SAUDIA_CONNECT_PASSWORD||'');
  if(!email||!password)return{ok:false,stage:'CONNECT_NOT_CONFIGURED'};

  await page.goto(LOGIN_URL,{waitUntil:'domcontentloaded',timeout:35000});
  await sleep(1200);
  const fields=await page.evaluate(()=>{
    const inputs=[...document.querySelectorAll('input')];
    const email=inputs.find(x=>String(x.type||'').toLowerCase()==='email'||/email/i.test(`${x.name||''} ${x.id||''} ${x.placeholder||''} ${x.getAttribute('aria-label')||''}`));
    const password=inputs.find(x=>String(x.type||'').toLowerCase()==='password'||/password/i.test(`${x.name||''} ${x.id||''} ${x.placeholder||''} ${x.getAttribute('aria-label')||''}`));
    if(!email||!password)return false;
    email.dataset.mayaviConnectEmail='1';password.dataset.mayaviConnectPassword='1';return true;
  }).catch(()=>false);
  if(!fields)return{ok:false,stage:'CONNECT_LOGIN_FIELDS_NOT_FOUND'};

  await page.click('[data-mayavi-connect-email="1"]',{clickCount:3}).catch(()=>{});
  await page.keyboard.press('Control+A').catch(()=>{});await page.keyboard.press('Backspace').catch(()=>{});
  await page.type('[data-mayavi-connect-email="1"]',email,{delay:25});
  await page.click('[data-mayavi-connect-password="1"]',{clickCount:3}).catch(()=>{});
  await page.keyboard.press('Control+A').catch(()=>{});await page.keyboard.press('Backspace').catch(()=>{});
  await page.type('[data-mayavi-connect-password="1"]',password,{delay:25});

  await page.evaluate(()=>{
    const cb=[...document.querySelectorAll('input[type="checkbox"]')].find(x=>/remember/i.test(`${x.name||''} ${x.id||''} ${x.closest('label,div')?.innerText||''}`));
    if(cb&&!cb.checked)cb.click();
  }).catch(()=>{});

  const submit=await page.evaluate(()=>{
    const all=[...document.querySelectorAll('button,input[type="submit"],[role="button"]')];
    const txt=e=>String(e.innerText||e.value||e.textContent||'').replace(/\s+/g,' ').trim();
    const x=all.find(e=>/^(sign in|login)$/i.test(txt(e)));if(!x)return false;x.dataset.mayaviConnectSignIn='1';return true;
  }).catch(()=>false);
  if(!submit)return{ok:false,stage:'CONNECT_SIGNIN_NOT_FOUND'};

  await Promise.allSettled([
    page.waitForNavigation({waitUntil:'domcontentloaded',timeout:18000}),
    page.click('[data-mayavi-connect-sign-in="1"]',{delay:80})
  ]);
  await sleep(1400);
  const after=clean(await bodyText(page));
  if(/verification code|multi[- ]factor|one[- ]time|captcha/i.test(after))return{ok:false,stage:'CONNECT_INTERACTIVE_VERIFICATION_REQUIRED'};
  if(/invalid|incorrect|failed|not recognized/i.test(after)&&/password|email|sign in|login/i.test(after))return{ok:false,stage:'CONNECT_LOGIN_REJECTED'};

  await page.goto(TRACK_URL,{waitUntil:'domcontentloaded',timeout:35000});
  await sleep(1200);
  if(!await isSignedIn(page))return{ok:false,stage:'CONNECT_LOGIN_NOT_ACTIVE'};
  await cacheSession(page);
  return{ok:true,stage:'CONNECT_SIGNED_IN'};
}

async function ensureSignedIn(page){
  await applyCachedSession(page);
  await page.goto(TRACK_URL,{waitUntil:'domcontentloaded',timeout:35000});
  await sleep(900);
  if(await isSignedIn(page)){await cacheSession(page);return{ok:true,stage:'CONNECT_SESSION_REUSED'};}
  session.cookies=[];session.savedAt=0;
  return login(page);
}

async function locateAwb(page){
  return page.evaluate(()=>{
    const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>40&&r.height>18&&!e.disabled&&!e.readOnly};
    const inputs=[...document.querySelectorAll('input')].filter(visible).filter(e=>!['hidden','checkbox','radio','submit','button','password','email'].includes(String(e.type||'text').toLowerCase()));
    const x=inputs.find(e=>/awb|air\s*waybill|shipment|tracking/i.test(`${e.placeholder||''} ${e.name||''} ${e.id||''} ${e.getAttribute('aria-label')||''} ${e.closest('form,section,div')?.innerText||''}`))||inputs[0];
    if(!x)return false;x.dataset.mayaviConnectAwb='1';x.scrollIntoView({block:'center'});return true;
  }).catch(()=>false);
}

async function fillAwb(page,mawb){
  const sel='[data-mayavi-connect-awb="1"]';
  await page.click(sel,{clickCount:3}).catch(()=>{});await page.keyboard.press('Control+A').catch(()=>{});await page.keyboard.press('Backspace').catch(()=>{});
  await page.type(sel,mawb,{delay:30});
  await page.evaluate(s=>{const e=document.querySelector(s);if(!e)return;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));e.blur();},sel).catch(()=>{});
}

async function clickTrack(page){
  const found=await page.evaluate(()=>{
    const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>6&&r.height>6&&!e.disabled};
    const txt=e=>String(e.innerText||e.textContent||e.value||e.getAttribute('aria-label')||'').replace(/\s+/g,' ').trim();
    const all=[...document.querySelectorAll('button,a,[role="button"],input[type="submit"],input[type="button"]')].filter(visible);
    for(const label of ['Track Shipment','Track','Search','Submit']){
      const x=all.find(e=>txt(e).toLowerCase()===label.toLowerCase());if(x){x.dataset.mayaviConnectTrack='1';x.scrollIntoView({block:'center'});return txt(x);}
    }
    return'';
  }).catch(()=> '');
  if(!found)return'';
  await page.click('[data-mayavi-connect-track="1"]',{delay:80}).catch(()=>page.evaluate(()=>document.querySelector('[data-mayavi-connect-track="1"]')?.click()));
  return found;
}

export async function trackSaudiaViaConnect(input){
  const mawb=normalizeMawb(input);
  if(!mawb||!mawb.startsWith('065-'))return{ok:false,reason:'INVALID SAUDIA MAWB',officialTracker:TRACK_URL};
  if(!process.env.SAUDIA_CONNECT_EMAIL||!process.env.SAUDIA_CONNECT_PASSWORD)return{ok:false,reason:'SAUDIA CONNECT ACCOUNT NOT CONFIGURED',officialTracker:TRACK_URL,debug:{stage:'CONNECT_NOT_CONFIGURED'}};

  let browser;const network=[];const debug={version:'1.0',stage:'OPEN',network:[]};
  try{
    chromium.setGraphicsMode=false;
    browser=await puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox','--lang=en-US,en','--window-size=1440,1100'],defaultViewport:{width:1440,height:1100},executablePath:await chromium.executablePath(),headless:'shell'});
    const page=await browser.newPage();await page.setExtraHTTPHeaders({'Accept-Language':'en-US,en;q=0.9'});
    page.on('response',async r=>{try{
      const u=r.url(),ct=String(r.headers()['content-type']||'');if(!/connect\.saudiacargo\.com/i.test(u)||!/json|text|html/i.test(ct))return;
      const body=await r.text().catch(()=> '');if(body&&body.length<400000){network.push(body);if(/awb|track|shipment|flight|status/i.test(`${u} ${body}`))debug.network.push({url:u,status:r.status(),sample:clean(body).slice(0,360)});}
    }catch{}});

    const auth=await ensureSignedIn(page);debug.auth=auth.stage;
    if(!auth.ok)return{ok:false,reason:auth.stage,officialTracker:TRACK_URL,debug:{...debug,stage:auth.stage}};
    if(!await locateAwb(page))return{ok:false,reason:'CONNECT AWB INPUT NOT FOUND',officialTracker:TRACK_URL,debug:{...debug,stage:'INPUT_NOT_FOUND',sample:clean(await bodyText(page)).slice(0,1600)}};
    await fillAwb(page,mawb);
    const action=await clickTrack(page);debug.action=action;
    if(!action)return{ok:false,reason:'CONNECT TRACK BUTTON NOT FOUND',officialTracker:TRACK_URL,debug:{...debug,stage:'TRACK_BUTTON_NOT_FOUND'}};

    const end=Date.now()+30000;let combined='';
    while(Date.now()<end){
      combined=`${await bodyText(page)}\n${network.join('\n')}`;
      const shipment=parseResult(combined,mawb);if(shipment){await cacheSession(page);return{ok:true,shipment,officialTracker:TRACK_URL,debug:{...debug,stage:'CONNECT_RESULT_SUCCESS'}};}
      if(/no shipment|not found|invalid awb|no result/i.test(combined))return{ok:false,reason:'CONNECT RETURNED NO SHIPMENT RESULT',officialTracker:TRACK_URL,debug:{...debug,stage:'NO_RESULT'}};
      await sleep(500);
    }
    return{ok:false,reason:'CONNECT RESULT NOT READABLE',officialTracker:TRACK_URL,debug:{...debug,stage:'RESULT_TIMEOUT',sample:clean(combined).slice(0,2200)}};
  }catch(e){return{ok:false,reason:`SAUDIA CONNECT ERROR: ${e?.message||e}`,officialTracker:TRACK_URL,debug:{...debug,stage:'ERROR'}}}
  finally{try{if(browser)await browser.close()}catch{}}
}
