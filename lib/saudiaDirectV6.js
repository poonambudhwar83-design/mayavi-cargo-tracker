import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { normalizeMawb } from './airlines.js';
import { readSaudiaScreenshot } from './saudiaScreenshotOcr.js';

const PUBLIC_URL='https://saudiacargo.com/en/digital-services?tab=trackShipment';
const CONNECT_LOGIN='https://connect.saudiacargo.com/SignIn?returnUrl=%2Fawb-tracking';
const CONNECT_TRACK='https://connect.saudiacargo.com/awb-tracking/';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clean=v=>String(v||'').replace(/\s+/g,' ').trim();
const digits=v=>String(v||'').replace(/\D/g,'');
function first(text,rx){return clean((String(text||'').match(rx)||[])[1]||'');}
function mapStatus(raw=''){
  const s=String(raw||'').trim().toUpperCase();
  if(s==='DLV'||s==='ARR')return'ARRIVED';
  if(s==='XXX'||s==='DEP'||s==='RCF'||s==='MAN')return'IN TRANSIT';
  if(s==='BKD'||s==='RCS')return'BOOKED';
  if(s==='DLY')return'DELAYED';
  return s||'TRACKING';
}
function parseResult(text='',mawb=''){
  const t=clean(text);if(!t)return null;
  const full=digits(mawb),serial=full.slice(3),flat=digits(t);
  if(full&&!flat.includes(full)&&serial&&!flat.includes(serial))return null;
  const destination=first(t,/(?:\bDestination\b|["']destination["'])\s*["':=\s-]*([A-Z]{3})\b/i).toUpperCase();
  const sourceStatus=first(t,/(?:\bStatus\b|["']status["']|["']state["'])\s*["':=\s-]*(DLV|XXX|BKD|ARR|DEP|RCF|MAN|RCS|DLY)\b/i).toUpperCase();
  const pieces=first(t,/(?:\bTotal\s*(?:Number\s*Of\s*)?Pieces\b|["'](?:totalPieces|pieceCount|pieces|totalNoOfPieces)["'])\s*["':=\s-]*(\d{1,6})\b/i);
  const weight=first(t,/(?:\bWeight\b|["'](?:weight|grossWeight)["'])\s*["':=\s-]*([\d,.]+)(?:\s*(?:KG|KGS?))?/i).replace(/,/g,'');
  const f=first(t,/(?:\bFlight\s*No\.?\b|["'](?:flightNo|flightNumber)["'])\s*["':=\s-]*(?:SV\s*[- ]?)?(\d{1,4})\b/i);
  const flightNo=f?`SV${f}`:'';
  const flightDate=first(t,/(?:\bFlight\s*Date\b|["']flightDate["'])\s*["':=\s-]*([0-3]?\d[A-Z]{3}\d{2,4}|20\d{2}[-\/.]\d{1,2}[-\/.]\d{1,2})\b/i).toUpperCase();
  if(!sourceStatus&&!destination&&!pieces&&!weight&&!flightNo)return null;
  return {mawb,carrierCode:'SV',airlineName:'Saudia Cargo',officialTracker:PUBLIC_URL,destination,bags:pieces,pieces,weight,flightNo,flightDate,sourceStatus,status:mapStatus(sourceStatus),arrivalDate:'',arrivalTime:'',arrivalIsActual:false,bookingDate:'',source:'Saudia Cargo official tracking'};
}
async function bodyText(page){return page.evaluate(()=>document.body?.innerText||'').catch(()=> '');}
async function screenshotParse(page,mawb){
  const shot=await page.screenshot({type:'png',fullPage:true,encoding:'base64'}).catch(()=>null);
  if(!shot)return null;
  const r=await readSaudiaScreenshot({mawb,screenshotBase64:shot,timeoutMs:30000}).catch(()=>null);
  return r?.ok?r.shipment:null;
}
async function markAwb(page){
  return page.evaluate(()=>{
    const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>40&&r.height>18&&!e.disabled&&!e.readOnly};
    const xs=[...document.querySelectorAll('input')].filter(visible).filter(e=>!['hidden','checkbox','radio','submit','button','password','email'].includes(String(e.type||'text').toLowerCase()));
    const x=xs.find(e=>/awb|air\s*waybill|shipment/i.test(`${e.placeholder||''} ${e.name||''} ${e.id||''} ${e.getAttribute('aria-label')||''} ${e.closest('form,section,div')?.innerText||''}`))||xs[0];
    if(!x)return false;x.dataset.mayaviSaudiaAwb='1';x.scrollIntoView({block:'center'});return true;
  }).catch(()=>false);
}
async function fillAwb(page,mawb){
  const sel='[data-mayavi-saudia-awb="1"]';
  await page.click(sel,{clickCount:3}).catch(()=>{});
  await page.keyboard.press('Control+A').catch(()=>{});await page.keyboard.press('Backspace').catch(()=>{});
  await page.type(sel,digits(mawb),{delay:55});
  await page.keyboard.press('Tab').catch(()=>{});
  await sleep(700);
}
async function waitSiteReady(page){
  await page.waitForFunction(()=>document.readyState==='complete'||document.readyState==='interactive',{timeout:12000}).catch(()=>{});
  await page.waitForFunction(()=>[...document.querySelectorAll('input')].some(e=>{const r=e.getBoundingClientRect();return r.width>40&&r.height>18&&!e.disabled}),{timeout:12000}).catch(()=>{});
  const hasRecaptcha=await page.evaluate(()=>Boolean([...document.scripts].some(s=>/recaptcha/i.test(s.src||'')))).catch(()=>false);
  if(hasRecaptcha){
    await page.waitForFunction(()=>typeof window.grecaptcha!=='undefined',{timeout:10000}).catch(()=>{});
    await sleep(2500);
  }else await sleep(1200);
}
async function clickSubmit(page){
  const hit=await page.evaluate(()=>{
    const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>6&&r.height>6&&!e.disabled};
    const txt=e=>String(e.innerText||e.textContent||e.value||e.getAttribute('aria-label')||'').replace(/\s+/g,' ').trim();
    const xs=[...document.querySelectorAll('button,[role="button"],input[type="submit"],input[type="button"]')].filter(visible);
    const wanted=['Submit','Search','Track Shipment','Track'];
    for(const w of wanted){const x=xs.find(e=>txt(e).toLowerCase()===w.toLowerCase());if(x){x.dataset.mayaviSaudiaSubmit='1';x.scrollIntoView({block:'center'});return txt(x)}}
    return '';
  }).catch(()=> '');
  if(!hit)return null;
  const h=await page.$('[data-mayavi-saudia-submit="1"]');if(!h)return null;
  await h.focus().catch(()=>{});await sleep(350);await h.click({delay:120});
  return hit;
}
async function waitResult(page,mawb,network,timeout=26000){
  const end=Date.now()+timeout;let latest='';
  while(Date.now()<end){
    latest=`${await bodyText(page)}\n${network.map(x=>x.body).join('\n')}`;
    const parsed=parseResult(latest,mawb);if(parsed)return{shipment:parsed,text:latest};
    if(/CAPTCHA_REQUIRED|Captcha verification is required/i.test(latest))return{shipment:null,text:latest,captchaRequired:true};
    await sleep(600);
  }
  const shot=await screenshotParse(page,mawb);return{shipment:shot,text:latest};
}
async function publicAttempt(page,mawb,network){
  network.length=0;
  await page.goto(PUBLIC_URL,{waitUntil:'domcontentloaded',timeout:35000});
  await waitSiteReady(page);
  if(!await markAwb(page))return{shipment:null,stage:'PUBLIC_AWB_INPUT_NOT_FOUND'};
  await fillAwb(page,mawb);
  const action=await clickSubmit(page);if(!action)return{shipment:null,stage:'PUBLIC_SUBMIT_NOT_FOUND'};
  const r=await waitResult(page,mawb,network,26000);
  if(r.shipment)return{shipment:{...r.shipment,arrivalDate:'',arrivalTime:'',arrivalIsActual:false,bookingDate:''},stage:'PUBLIC_RESULT'};
  return{shipment:null,stage:r.captchaRequired?'PUBLIC_SERVER_VERIFICATION_REQUIRED':'PUBLIC_RESULT_NOT_READABLE',sample:clean(r.text).slice(0,1600)};
}
async function tryConnect(page,mawb,network){
  const email=String(process.env.SAUDIA_CONNECT_EMAIL||'').trim(),password=String(process.env.SAUDIA_CONNECT_PASSWORD||'');
  if(!email||!password)return{shipment:null,stage:'CONNECT_NOT_CONFIGURED'};
  network.length=0;
  try{
    await page.goto(CONNECT_LOGIN,{waitUntil:'domcontentloaded',timeout:35000});await sleep(1800);
    const ok=await page.evaluate(()=>{const xs=[...document.querySelectorAll('input')];const e=xs.find(x=>String(x.type||'').toLowerCase()==='email'||/email/i.test(`${x.name||''} ${x.id||''} ${x.placeholder||''}`));const p=xs.find(x=>String(x.type||'').toLowerCase()==='password'||/password/i.test(`${x.name||''} ${x.id||''} ${x.placeholder||''}`));if(!e||!p)return false;e.dataset.mayaviConnectEmail='1';p.dataset.mayaviConnectPassword='1';return true;}).catch(()=>false);
    if(!ok)return{shipment:null,stage:'CONNECT_LOGIN_FIELDS_NOT_FOUND'};
    await page.type('[data-mayavi-connect-email="1"]',email,{delay:35});await page.type('[data-mayavi-connect-password="1"]',password,{delay:35});
    const signed=await page.evaluate(()=>{const xs=[...document.querySelectorAll('button,input[type="submit"]')];const x=xs.find(e=>/^(sign in|login)$/i.test(String(e.innerText||e.value||'').trim()));if(!x)return false;x.dataset.mayaviSignIn='1';return true;}).catch(()=>false);
    if(!signed)return{shipment:null,stage:'CONNECT_SIGNIN_NOT_FOUND'};
    await page.click('[data-mayavi-sign-in="1"]');await sleep(3500);
    await page.goto(CONNECT_TRACK,{waitUntil:'domcontentloaded',timeout:35000});await sleep(1800);
    if(!await markAwb(page))return{shipment:null,stage:'CONNECT_AWB_INPUT_NOT_FOUND'};
    await fillAwb(page,mawb);
    const action=await clickSubmit(page);if(!action)return{shipment:null,stage:'CONNECT_TRACK_NOT_FOUND'};
    const r=await waitResult(page,mawb,network,26000);
    if(!r.shipment)return{shipment:null,stage:'CONNECT_RESULT_NOT_READABLE',sample:clean(r.text).slice(0,1600)};
    return{shipment:{...r.shipment,source:'Saudia Cargo Connect official tracking'},stage:'CONNECT_RESULT'};
  }catch(e){return{shipment:null,stage:'CONNECT_ERROR',error:e?.message||String(e)}}
}
export async function trackSaudiaDirect(input){
  const mawb=normalizeMawb(input);if(!mawb||!mawb.startsWith('065-'))return{ok:false,reason:'INVALID SAUDIA MAWB',officialTracker:PUBLIC_URL};
  let browser;const network=[];const debug={version:'6.0',attempts:[],networkMeta:[]};
  try{
    chromium.setGraphicsMode=false;
    browser=await puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox','--lang=en-US,en','--window-size=1440,1100'],defaultViewport:{width:1440,height:1100},executablePath:await chromium.executablePath(),headless:'shell'});
    const page=await browser.newPage();await page.setExtraHTTPHeaders({'Accept-Language':'en-US,en;q=0.9'});
    page.on('response',async r=>{try{const u=r.url(),ct=String(r.headers()['content-type']||'');if(!/saudiacargo/i.test(u)||!/json|text/i.test(ct))return;const body=await r.text();if(body&&body.length<300000){network.push({url:u,body});if(/track|shipment|awb|api/i.test(u))debug.networkMeta.push({url:u,status:r.status(),sample:clean(body).slice(0,220)})}}catch{}});

    let pub=await publicAttempt(page,mawb,network);debug.attempts.push({stage:pub.stage,sample:pub.sample||''});
    if(pub.shipment)return{ok:true,shipment:pub.shipment,officialTracker:PUBLIC_URL,debug};

    if(pub.stage==='PUBLIC_SERVER_VERIFICATION_REQUIRED'){
      await sleep(1800);
      pub=await publicAttempt(page,mawb,network);debug.attempts.push({stage:`RETRY_${pub.stage}`,sample:pub.sample||''});
      if(pub.shipment)return{ok:true,shipment:pub.shipment,officialTracker:PUBLIC_URL,debug};
    }

    const connect=await tryConnect(page,mawb,network);debug.attempts.push({stage:connect.stage,sample:connect.sample||'',error:connect.error||''});
    if(connect.shipment)return{ok:true,shipment:connect.shipment,officialTracker:CONNECT_TRACK,debug};

    const reason=connect.stage==='CONNECT_NOT_CONFIGURED'?(pub.stage==='PUBLIC_SERVER_VERIFICATION_REQUIRED'?'SAUDIA PUBLIC TRACKING REQUIRES SERVER VERIFICATION; CONNECT ACCOUNT NOT CONFIGURED':'SAUDIA RESULT NOT AVAILABLE; CONNECT ACCOUNT NOT CONFIGURED'):connect.stage;
    return{ok:false,reason,officialTracker:PUBLIC_URL,debug};
  }catch(e){return{ok:false,reason:`SAUDIA TRACKING ERROR: ${e?.message||e}`,officialTracker:PUBLIC_URL,debug}}
  finally{try{if(browser)await browser.close()}catch{}}
}
