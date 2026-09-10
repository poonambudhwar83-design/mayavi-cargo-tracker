import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { normalizeMawb } from './airlines.js';
import { readSaudiaScreenshot } from './saudiaScreenshotOcr.js';

const URL='https://saudiacargo.com/en/digital-services?tab=trackShipment';
const DEEP_LINKS=[
  'https://saudiacargo.com/e-services/track-shipment',
  'https://china.saudiacargo.com/e-services/track-shipment'
];
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
function parseResultCard(text='',mawb=''){
  const t=clean(text);if(!t)return null;
  const full=digits(mawb),serial=full.slice(3),seen=digits(t);
  if(full&&!seen.includes(full)&&serial&&!seen.includes(serial))return null;
  const destination=first(t,/(?:\bDestination\b|["']destination["'])\s*["':=\s-]*([A-Z]{3})\b/i).toUpperCase();
  const sourceStatus=first(t,/(?:\bStatus\b|["']status["']|["']state["'])\s*["':=\s-]*(DLV|XXX|BKD|ARR|DEP|RCF|MAN|RCS|DLY)\b/i).toUpperCase();
  const pieces=first(t,/(?:\bTotal\s*(?:Number\s*Of\s*)?Pieces\b|["'](?:totalPieces|pieceCount|pieces|totalNoOfPieces)["'])\s*["':=\s-]*(\d{1,6})\b/i);
  const weight=first(t,/(?:\bWeight\b|["'](?:weight|grossWeight)["'])\s*["':=\s-]*([\d,.]+)(?:\s*(?:KG|KGS?))?/i).replace(/,/g,'');
  const fd=first(t,/(?:\bFlight\s*No\.?\b|["'](?:flightNo|flightNumber)["'])\s*["':=\s-]*(?:SV\s*[- ]?)?(\d{1,4})\b/i);
  const flightNo=fd?`SV${fd}`:'';
  const flightDate=first(t,/(?:\bFlight\s*Date\b|["']flightDate["'])\s*["':=\s-]*([0-3]?\d[A-Z]{3}\d{2,4}|20\d{2}[-\/.]\d{1,2}[-\/.]\d{1,2})\b/i).toUpperCase();
  const volume=first(t,/(?:\bVolume\b|["']volume["'])\s*["':=\s-]*([\d,.]+)/i).replace(/,/g,'');
  const segmentNo=first(t,/(?:\bSegment\s*No\.?\b|["']segmentNo["'])\s*["':=\s-]*(\d+)\b/i);
  const strong=Boolean(sourceStatus||(destination&&pieces)||(destination&&flightNo)||(pieces&&flightNo));
  if(!strong)return null;
  return {mawb,carrierCode:'SV',airlineName:'Saudia Cargo',officialTracker:URL,destination,bags:pieces,pieces,weight,flightNo,flightDate,volume,segmentNo,sourceStatus,status:mapStatus(sourceStatus),arrivalDate:'',arrivalTime:'',arrivalIsActual:false,bookingDate:'',source:'Saudia Cargo official result card'};
}
async function pageText(page){return page.evaluate(()=>document.body?.innerText||'').catch(()=> '');}
async function diag(page){return page.evaluate(()=>({
  href:location.href,
  scripts:[...document.scripts].map(s=>s.src).filter(Boolean).filter(u=>/_next\/static|track|shipment|api/i.test(u)).slice(-60),
  resources:performance.getEntriesByType('resource').map(e=>e.name).filter(u=>/_next\/static|track|shipment|api/i.test(u)).slice(-80),
  nextData:window.__NEXT_DATA__?{buildId:window.__NEXT_DATA__.buildId,page:window.__NEXT_DATA__.page,query:window.__NEXT_DATA__.query}:null
})).catch(()=>({}));}
async function screenshotShipment(page,mawb){const shot=await page.screenshot({type:'png',fullPage:true,encoding:'base64'}).catch(()=>null);if(!shot)return null;const ocr=await readSaudiaScreenshot({mawb,screenshotBase64:shot,timeoutMs:30000}).catch(()=>null);return ocr?.ok?ocr.shipment:null;}
async function tryDeepLink(page,base,mawb,network){
  const target=`${base}?awbNumber=${encodeURIComponent(digits(mawb))}`;network.length=0;
  await page.goto(target,{waitUntil:'domcontentloaded',timeout:30000});
  for(let i=0;i<5;i++){await sleep(i?700:1800);const text=`${await pageText(page)}\n${network.map(x=>x.body).join('\n')}`;const parsed=parseResultCard(text,mawb);if(parsed)return{shipment:parsed,stage:'DEEPLINK_RESULT',target,text:clean(text).slice(0,1400),diag:await diag(page)};}
  const shotShipment=await screenshotShipment(page,mawb);if(shotShipment)return{shipment:{...shotShipment,arrivalDate:'',arrivalTime:'',arrivalIsActual:false,bookingDate:''},stage:'DEEPLINK_SCREENSHOT',target,text:clean(await pageText(page)).slice(0,1400),diag:await diag(page)};
  return{shipment:null,stage:'DEEPLINK_NO_RESULT',target,text:clean(await pageText(page)).slice(0,1400),diag:await diag(page)};
}
async function markAwbInput(page){return page.evaluate(()=>{const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>40&&r.height>18&&!e.disabled&&!e.readOnly};const inputs=[...document.querySelectorAll('input')].filter(visible).filter(e=>!['hidden','checkbox','radio','submit','button'].includes(String(e.type||'text').toLowerCase()));const found=inputs.find(e=>/awb|air\s*waybill|shipment/i.test(`${e.placeholder||''} ${e.name||''} ${e.id||''} ${e.getAttribute('aria-label')||''} ${e.closest('section,form,div')?.innerText||''}`))||inputs[0];if(!found)return false;found.dataset.mayaviSaudiaAwb='1';found.scrollIntoView({block:'center'});return true}).catch(()=>false)}
async function clickSubmit(page,timeout=10000){const end=Date.now()+timeout;while(Date.now()<end){const hit=await page.evaluate(()=>{const input=document.querySelector('[data-mayavi-saudia-awb="1"]');if(!input)return null;const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>6&&r.height>6&&!e.disabled};const txt=e=>String(e.innerText||e.textContent||e.value||e.getAttribute('aria-label')||'').replace(/\s+/g,' ').trim();const xs=[...document.querySelectorAll('button,a,[role="button"],input[type="submit"],input[type="button"],span,div')].filter(visible);const exact=xs.filter(e=>/^Submit$/i.test(txt(e))).sort((a,b)=>txt(a).length-txt(b).length)[0];if(!exact)return null;const clickable=exact.closest('button,a,[role="button"]')||exact;clickable.dataset.mayaviSaudiaSubmit='1';clickable.scrollIntoView({block:'center'});return{mode:'EXACT_SUBMIT',text:txt(exact)}}).catch(()=>null);if(hit){try{await page.click('[data-mayavi-saudia-submit="1"]')}catch{await page.evaluate(()=>document.querySelector('[data-mayavi-saudia-submit="1"]')?.click()).catch(()=>{})}return hit}await sleep(300)}return null}
async function waitForResult(page,mawb,network,timeout=22000){const end=Date.now()+timeout;let latest='';while(Date.now()<end){latest=`${await pageText(page)}\n${network.map(x=>x.body).join('\n')}`;if(parseResultCard(latest,mawb))return latest;await sleep(500)}return latest}

export async function trackSaudiaDirect(input){
  const mawb=normalizeMawb(input);if(!mawb||!mawb.startsWith('065-'))return{ok:false,reason:'INVALID SAUDIA MAWB',officialTracker:URL};
  let browser;const debug={stage:'OPEN',submit:null,deepLinks:[],networkMeta:[]},network=[];
  try{
    chromium.setGraphicsMode=false;browser=await puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox','--lang=en-US,en','--window-size=1440,1100'],defaultViewport:{width:1440,height:1100},executablePath:await chromium.executablePath(),headless:'shell'});
    const page=await browser.newPage();await page.setExtraHTTPHeaders({'Accept-Language':'en-US,en;q=0.9'});
    page.on('response',async r=>{try{const u=r.url(),ct=String(r.headers()['content-type']||'');if(!/saudiacargo/i.test(u)||!/json|text|javascript/i.test(ct))return;const body=await r.text();if(body&&body.length<500000){network.push({url:u,body});if(/track|shipment|awb|api/i.test(u)||/track|shipment|awb|status|totalPieces|flightNo/i.test(body))debug.networkMeta.push({url:u,status:r.status(),ct,sample:clean(body).slice(0,260)})}}catch{}});

    for(const base of DEEP_LINKS){const deep=await tryDeepLink(page,base,mawb,network).catch(e=>({shipment:null,stage:'DEEPLINK_ERROR',target:base,text:String(e?.message||e),diag:{}}));debug.deepLinks.push({stage:deep.stage,target:deep.target,sample:deep.text,diag:deep.diag});if(deep.shipment)return{ok:true,shipment:deep.shipment,officialTracker:URL,debug:{...debug,stage:deep.stage}};}

    network.length=0;debug.networkMeta=[];await page.goto(URL,{waitUntil:'domcontentloaded',timeout:30000});await sleep(1800);
    if(!await markAwbInput(page))return{ok:false,reason:'SAUDIA AWB INPUT NOT FOUND',officialTracker:URL,debug:{...debug,stage:'AWB_INPUT_NOT_FOUND',diag:await diag(page)}};
    await page.click('[data-mayavi-saudia-awb="1"]',{clickCount:3}).catch(()=>{});await page.keyboard.press('Control+A').catch(()=>{});await page.keyboard.press('Backspace').catch(()=>{});await page.type('[data-mayavi-saudia-awb="1"]',digits(mawb),{delay:35});
    const submit=await clickSubmit(page);debug.submit=submit;if(!submit)return{ok:false,reason:'SAUDIA SUBMIT BUTTON NOT FOUND',officialTracker:URL,debug:{...debug,stage:'SUBMIT_NOT_FOUND',diag:await diag(page)}};
    const text=await waitForResult(page,mawb,network,22000);debug.resultSample=clean(text).slice(0,3000);debug.diag=await diag(page);
    let shipment=parseResultCard(text,mawb);if(!shipment)shipment=await screenshotShipment(page,mawb);
    if(!shipment)return{ok:false,reason:'SAUDIA SUBMIT RESULT CARD NOT READABLE',officialTracker:URL,debug:{...debug,stage:'RESULT_NOT_READABLE'}};
    shipment={...shipment,arrivalDate:'',arrivalTime:'',arrivalIsActual:false,bookingDate:''};return{ok:true,shipment,officialTracker:URL,debug:{...debug,stage:'RESULT_CARD_SUCCESS'}};
  }catch(e){return{ok:false,reason:`SAUDIA TRACKING ERROR: ${e?.message||e}`,officialTracker:URL,debug:{...debug,stage:'ERROR'}}}
  finally{try{if(browser)await browser.close()}catch{}}
}
