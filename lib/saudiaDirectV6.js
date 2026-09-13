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
  if(s==='MAN'||s==='DEP')return'DEPARTED';
  if(s==='XXX'||s==='RCF')return'IN TRANSIT';
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
  const arrivalDate=first(t,/(?:estimated\s*arrival\s*date|planned\s*arrival\s*date|scheduled\s*arrival\s*date|arrival\s*date|etaDate|scheduledArrivalDate|plannedArrivalDate)\s*["':=\s-]*([0-3]?\d[A-Z]{3}\d{2,4}|20\d{2}[-\/.]\d{1,2}[-\/.]\d{1,2})\b/i).toUpperCase();
  const arrivalTime=first(t,/(?:estimated\s*arrival\s*time|planned\s*arrival\s*time|scheduled\s*arrival\s*time|arrival\s*time|etaTime|scheduledArrivalTime|plannedArrivalTime)\s*["':=\s-]*(\d{1,2}:\d{2})(?:\s*(AM|PM))?/i);
  if(!sourceStatus&&!destination&&!pieces&&!weight&&!flightNo)return null;
  return {mawb,carrierCode:'SV',airlineName:'Saudia Cargo',officialTracker:PUBLIC_URL,destination,bags:pieces,pieces,weight,flightNo,flightDate,sourceStatus,status:mapStatus(sourceStatus),arrivalDate:arrivalDate||flightDate,arrivalTime,etaTime:arrivalTime,arrivalIsActual:sourceStatus==='ARR'||sourceStatus==='DLV',departureIsActual:sourceStatus==='MAN'||sourceStatus==='DEP',bookingDate:'',source:'Saudia Cargo official tracking'};
}
async function bodyText(page){return page.evaluate(()=>document.body?.innerText||'').catch(()=> '');}
async function screenshotParse(page,mawb){const shot=await page.screenshot({type:'png',fullPage:true,encoding:'base64'}).catch(()=>null);if(!shot)return null;const r=await readSaudiaScreenshot({mawb,screenshotBase64:shot,timeoutMs:30000}).catch(()=>null);return r?.ok?r.shipment:null;}
async function markAwb(page){return page.evaluate(()=>{const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>40&&r.height>18&&!e.disabled&&!e.readOnly};const xs=[...document.querySelectorAll('input')].filter(visible).filter(e=>!['hidden','checkbox','radio','submit','button','password','email'].includes(String(e.type||'text').toLowerCase()));const x=xs.find(e=>/awb|air\s*waybill|shipment/i.test(`${e.placeholder||''} ${e.name||''} ${e.id||''} ${e.getAttribute('aria-label')||''} ${e.closest('form,section,div')?.innerText||''}`))||xs[0];if(!x)return false;x.dataset.mayaviSaudiaAwb='1';x.scrollIntoView({block:'center'});return true;}).catch(()=>false);}
async function fillAwb(page,mawb){const sel='[data-mayavi-saudia-awb="1"]';await page.click(sel,{clickCount:3}).catch(()=>{});await page.keyboard.press('Control+A').catch(()=>{});await page.keyboard.press('Backspace').catch(()=>{});await page.type(sel,digits(mawb),{delay:55});await page.keyboard.press('Tab').catch(()=>{});await sleep(700);}
async function waitSiteReady(page){await page.waitForFunction(()=>document.readyState==='complete'||document.readyState==='interactive',{timeout:12000}).catch(()=>{});await page.waitForFunction(()=>[...document.querySelectorAll('input')].some(e=>{const r=e.getBoundingClientRect();return r.width>40&&r.height>18&&!e.disabled}),{timeout:12000}).catch(()=>{});await sleep(1500);}
async function clickSubmit(page){const hit=await page.evaluate(()=>{const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>6&&r.height>6&&!e.disabled};const txt=e=>String(e.innerText||e.textContent||e.value||e.getAttribute('aria-label')||'').replace(/\s+/g,' ').trim();const xs=[...document.querySelectorAll('button,[role="button"],input[type="submit"],input[type="button"]')].filter(visible);for(const w of ['Submit','Search','Track Shipment','Track']){const x=xs.find(e=>txt(e).toLowerCase()===w.toLowerCase());if(x){x.dataset.mayaviSaudiaSubmit='1';x.scrollIntoView({block:'center'});return txt(x)}}return '';}).catch(()=> '');if(!hit)return null;const h=await page.$('[data-mayavi-saudia-submit="1"]');if(!h)return null;await h.focus().catch(()=>{});await h.click({delay:120});return hit;}
async function waitResult(page,mawb,network,timeout=26000){const end=Date.now()+timeout;let latest='';while(Date.now()<end){latest=`${await bodyText(page)}\n${network.map(x=>x.body).join('\n')}`;const parsed=parseResult(latest,mawb);if(parsed)return{shipment:parsed,text:latest};if(/CAPTCHA_REQUIRED|Captcha verification is required/i.test(latest))return{shipment:null,text:latest,captchaRequired:true};await sleep(600);}const shot=await screenshotParse(page,mawb);return{shipment:shot,text:latest};}
async function publicAttempt(page,mawb,network){network.length=0;await page.goto(PUBLIC_URL,{waitUntil:'domcontentloaded',timeout:35000});await waitSiteReady(page);if(!await markAwb(page))return{shipment:null,stage:'PUBLIC_AWB_INPUT_NOT_FOUND'};await fillAwb(page,mawb);const action=await clickSubmit(page);if(!action)return{shipment:null,stage:'PUBLIC_SUBMIT_NOT_FOUND'};const r=await waitResult(page,mawb,network,26000);if(r.shipment)return{shipment:{...r.shipment,bookingDate:r.shipment.bookingDate||''},stage:'PUBLIC_RESULT'};return{shipment:null,stage:r.captchaRequired?'PUBLIC_SERVER_VERIFICATION_REQUIRED':'PUBLIC_RESULT_NOT_READABLE',sample:clean(r.text).slice(0,1600)};}
async function tryConnect(page,mawb,network){const email=String(process.env.SAUDIA_CONNECT_EMAIL||'').trim(),password=String(process.env.SAUDIA_CONNECT_PASSWORD||'');if(!email||!password)return{shipment:null,stage:'CONNECT_NOT_CONFIGURED'};return{shipment:null,stage:'CONNECT_RESULT_NOT_READABLE'};}
export async function trackSaudiaDirect(input){const mawb=normalizeMawb(input);if(!mawb||!mawb.startsWith('065-'))return{ok:false,reason:'INVALID SAUDIA MAWB',officialTracker:PUBLIC_URL};let browser;const network=[];const debug={version:'6.1',attempts:[],networkMeta:[]};try{chromium.setGraphicsMode=false;browser=await puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox','--lang=en-US,en','--window-size=1440,1100'],defaultViewport:{width:1440,height:1100},executablePath:await chromium.executablePath(),headless:'shell'});const page=await browser.newPage();await page.setExtraHTTPHeaders({'Accept-Language':'en-US,en;q=0.9'});page.on('response',async r=>{try{const u=r.url(),ct=String(r.headers()['content-type']||'');if(!/saudiacargo/i.test(u)||!/json|text/i.test(ct))return;const body=await r.text();if(body&&body.length<300000)network.push({url:u,body});}catch{}});let pub=await publicAttempt(page,mawb,network);debug.attempts.push({stage:pub.stage,sample:pub.sample||''});if(pub.shipment)return{ok:true,shipment:pub.shipment,officialTracker:PUBLIC_URL,debug};if(pub.stage==='PUBLIC_SERVER_VERIFICATION_REQUIRED'){await sleep(1800);pub=await publicAttempt(page,mawb,network);if(pub.shipment)return{ok:true,shipment:pub.shipment,officialTracker:PUBLIC_URL,debug};}const connect=await tryConnect(page,mawb,network);return{ok:false,reason:connect.stage,officialTracker:PUBLIC_URL,debug};}catch(e){return{ok:false,reason:`SAUDIA TRACKING ERROR: ${e?.message||e}`,officialTracker:PUBLIC_URL,debug}}finally{try{if(browser)await browser.close()}catch{}}}
