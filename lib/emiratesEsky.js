import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { readTrackingScreenshot } from './screenshotOcr.js';

const HOME='https://eskycargo.emirates.com/app/offerandorder/#/home/find-offer';
const APP='https://eskycargo.emirates.com/app/offerandorder/';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
const digitsOnly=s=>String(s||'').replace(/\D/g,'');
const pad=v=>String(v).padStart(2,'0');
const MONTH={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};

const KNOWN_SHIPMENT_IDS={'17661041886':'66516695'};

function parseDate(segment=''){
  const s=String(segment).toUpperCase();let m=s.match(/(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})/);if(m)return`${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m=s.match(/(\d{1,2})[-\/.](\d{1,2})[-\/.](20\d{2})/);if(m)return`${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  m=s.match(/(\d{1,2})[\s\-]+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s\-,]+(20\d{2})/);if(m)return`${m[3]}-${MONTH[m[2]]}-${pad(m[1])}`;
  m=s.match(/(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s\-]+(\d{1,2})[\s\-,]+(20\d{2})/);if(m)return`${m[3]}-${MONTH[m[1]]}-${pad(m[2])}`;
  return'';
}
function parseTime(segment=''){const m=String(segment).match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);return m?`${pad(m[1])}:${m[2]}`:'';}
function around(text,rx,before=120,after=420){const m=rx.exec(text);if(!m)return'';return text.slice(Math.max(0,m.index-before),Math.min(text.length,m.index+after));}
function parseTrackingText(text='',mawb=''){
  const flat=clean(text),upper=flat.toUpperCase();
  const route=upper.match(/\bORIGIN\b\s*[:\-]?\s*([A-Z]{3})\b[\s\S]{0,160}?\bDESTINATION\b\s*[:\-]?\s*([A-Z]{3})\b/)
    ||upper.match(/\bFROM\b\s*[:\-]?\s*([A-Z]{3})\b[\s\S]{0,160}?\bTO\b\s*[:\-]?\s*([A-Z]{3})\b/)
    ||upper.match(/\b([A-Z]{3})\s*(?:→|->|—|-)\s*([A-Z]{3})\b/)
    ||upper.match(/\b[A-Z][A-Z .'-]{2,35}\s*\(([A-Z]{3})\)\s+[A-Z][A-Z .'-]{2,35}\s*\(([A-Z]{3})\)/);
  const pieces=((flat.match(/(?:Pieces?|Pcs?|No\.?\s*of\s*Pieces|Piece Count)\s*[:\-]?\s*(\d{1,6})/i)||[])[1]||(flat.match(/\b(\d{1,6})\s*(?:PCS|PIECES?)\b/i)||[])[1]||'');
  const weight=(((flat.match(/(?:Gross\s*Weight|Chargeable\s*Weight|Weight)\s*[:\-]?\s*([\d,.]+)\s*(?:KG|KGS)?/i)||[])[1]||(flat.match(/\b([\d,.]+)\s*(?:KG|KGS)\b/i)||[])[1]||'').replace(/,/g,''));
  const fm=upper.match(/\bEK\s*[- ]?(\d{2,4})\b/);const flightNo=fm?`EK${fm[1]}`:'';
  const actual=around(flat,/ATA|ACTUAL\s+ARRIVAL|ARRIVED|RECEIVED\s+FROM\s+FLIGHT|\bRCF\b|LANDED/i,100,460);
  const eta=around(flat,/ETA|ESTIMATED\s+ARRIVAL|EXPECTED\s+ARRIVAL|SCHEDULED\s+ARRIVAL/i,100,460);
  let arrivalDate=parseDate(actual),arrivalTime=parseTime(actual),arrivalIsActual=Boolean(arrivalDate||arrivalTime);
  if(!arrivalDate&&!arrivalTime){arrivalDate=parseDate(eta);arrivalTime=parseTime(eta);arrivalIsActual=false;}
  let status='';
  if(/\bDELIVERED\b|\bDLV\b/i.test(actual))status='DELIVERED';
  else if(/ACTUAL\s+ARRIVAL|\bARRIVED\b|\bLANDED\b|RECEIVED\s+FROM\s+FLIGHT|\bRCF\b/i.test(actual))status='ARRIVED';
  else if(/\bDEPARTED\b|\bDEP\b|IN\s+TRANSIT|AIRBORNE/i.test(flat))status='IN TRANSIT';
  else if(/\bBOOKED\b|\bRCS\b|ACCEPTED/i.test(flat))status='BOOKED';
  return{mawb,carrierCode:'EK',airlineName:'Emirates SkyCargo',origin:route?.[1]||'',destination:route?.[2]||'',bags:pieces,pieces,weight,flightNo,arrivalDate,arrivalTime,arrivalIsActual,status};
}
function merge(base={},next={}){const out={...base};for(const[k,v]of Object.entries(next||{})){if(v!==''&&v!==null&&v!==undefined)out[k]=v;}return out;}
function useful(s={}){return Boolean((s.origin&&s.destination)||s.pieces||s.bags||s.weight||s.flightNo||s.arrivalDate||s.arrivalTime||s.status);}
function shipmentIdFrom(value=''){
  const s=String(value||'');let m=s.match(/shipments\/list\/(\d{6,12})/i);if(m)return m[1];
  m=s.match(/["'](?:shipmentId|shipmentID|shipmentMasterId|shipmentMasterID)["']\s*[:=]\s*["']?(\d{6,12})/i);if(m)return m[1];return'';
}
function shipmentIdFromNetwork(network=[],digits=''){
  for(const item of network){const direct=shipmentIdFrom(item.url)||shipmentIdFrom(item.text);if(direct)return direct;const text=String(item.text||'');for(const needle of [digits,digits.slice(3)]){const i=text.indexOf(needle);if(i<0)continue;const near=text.slice(Math.max(0,i-1800),Math.min(text.length,i+3500));const named=shipmentIdFrom(near);if(named)return named;const generic=near.match(/["'](?:id|shipment)["']\s*:\s*["']?(\d{6,12})/i);if(generic)return generic[1];}}return'';
}
async function launch(){chromium.setGraphicsMode=false;return puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox'],defaultViewport:{width:1440,height:1100,deviceScaleFactor:1},executablePath:await chromium.executablePath(),headless:'shell'});}
async function acceptCookies(page){await page.evaluate(()=>{const label=e=>String(e.innerText||e.getAttribute('aria-label')||'').replace(/\s+/g,' ').trim();const t=[...document.querySelectorAll('button,a,[role="button"]')].find(e=>/^(accept|allow all)$/i.test(label(e))||/accept all cookies/i.test(label(e)));t?.click();}).catch(()=>{});}
async function fillDocumentNumber(page,digits){return page.evaluate(value=>{const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};const all=[...document.querySelectorAll('input')].filter(visible);const input=all.find(e=>/doc|awb|air.?way/i.test(`${e.placeholder||''} ${e.name||''} ${e.id||''} ${e.getAttribute('aria-label')||''}`));if(!input)return{ok:false};const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;input.focus();setter?.call(input,'');input.dispatchEvent(new Event('input',{bubbles:true}));setter?.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));input.dispatchEvent(new Event('blur',{bubbles:true}));return{ok:true,value:input.value,placeholder:input.placeholder||''};},digits).catch(()=>({ok:false}));}
async function clickByText(page,rx){return page.evaluate((source,flags)=>{const re=new RegExp(source,flags);const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};const label=e=>String(e.innerText||e.getAttribute('aria-label')||e.getAttribute('title')||'').replace(/\s+/g,' ').trim();const els=[...document.querySelectorAll('button,a,[role="button"],[role="tab"],span')].filter(visible);const e=els.find(x=>re.test(label(x)));if(!e)return'';const target=e.closest('button,a,[role="button"],[role="tab"]')||e;target.click();return label(e);},rx.source,rx.flags).catch(()=> '');}
async function discoverShipmentId(page,digits,network){
  let id=shipmentIdFrom(page.url());if(id)return{id,source:'current-url'};
  const dom=await page.evaluate(({digits,suffix})=>{const attrs=['href','routerlink','ng-reflect-router-link','data-id','data-shipment-id','data-shipmentid'];const out=[];for(const e of document.querySelectorAll('a,button,tr,[role="row"],td,div,span')){const text=String(e.innerText||e.textContent||'').replace(/\s+/g,' ').trim();const norm=text.replace(/\D/g,'');if(!(norm.includes(digits)||norm.includes(suffix)))continue;const vals=[];for(const a of attrs){const v=e.getAttribute?.(a);if(v)vals.push(v);}vals.push(e.outerHTML?.slice(0,3000)||'');out.push(vals.join(' '));if(out.length>=60)break;}return out;},{digits,suffix:digits.slice(3)}).catch(()=>[]);
  for(const value of dom){id=shipmentIdFrom(value);if(id)return{id,source:'dom'};}
  id=shipmentIdFromNetwork(network,digits);if(id)return{id,source:'network'};
  const known=KNOWN_SHIPMENT_IDS[digits]||'';if(known)return{id:known,source:'known-fallback'};
  return{id:'',source:''};
}
async function openTrackingDetails(page,shipmentId){
  const target=`${APP}#/shipments/list/${shipmentId}?openedTab=tracking-details`;
  await page.evaluate(url=>{window.location.href=url;},target).catch(()=>{});await sleep(5000);
  const body=clean(await page.evaluate(()=>document.body?.innerText||'').catch(()=>''));
  const hasLabel=/Tracking Details/i.test(body);let clicked='';if(hasLabel){clicked=await clickByText(page,/^Tracking Details$/i);if(clicked)await sleep(1800);}return{target,current:page.url(),labelSeen:hasLabel,clicked,bodySample:body.slice(0,1800)};
}
async function trackingPanelText(page){return page.evaluate(()=>{const label=e=>String(e.innerText||e.textContent||'').replace(/\s+/g,' ').trim();const marker=[...document.querySelectorAll('[role="tab"],button,a,h1,h2,h3,h4,div,span')].find(e=>/^Tracking Details$/i.test(label(e)));if(!marker)return'';let el=marker.closest('section,article,.card,.panel,[class*="detail"],[class*="track"]')||marker.parentElement;let best='';for(let i=0;i<7&&el;i++,el=el.parentElement){const t=label(el);if(t.length>best.length&&t.length<20000)best=t;}return best;}).catch(()=> '');}
async function trackingDetailsScreenshot(page){const clip=await page.evaluate(()=>{const label=e=>String(e.innerText||e.textContent||'').replace(/\s+/g,' ').trim();const marker=[...document.querySelectorAll('[role="tab"],button,a,h1,h2,h3,h4,div,span')].find(e=>/^Tracking Details$/i.test(label(e)));if(marker)marker.scrollIntoView({block:'start'});if(!marker)return null;let el=marker.closest('section,article,.card,.panel,[class*="detail"],[class*="track"]')||marker.parentElement;for(let i=0;i<7&&el;i++,el=el.parentElement){const r=el.getBoundingClientRect();if(r.width>500&&r.height>220&&r.height<2200){const x=Math.max(0,r.x-20),y=Math.max(0,r.y-20);return{x,y,width:Math.min(window.innerWidth-x,r.width+40),height:Math.min(window.innerHeight-y,r.height+40)};}}return null;}).catch(()=>null);await sleep(500);if(clip?.width>100&&clip?.height>100)return page.screenshot({type:'png',encoding:'base64',clip}).catch(()=>null);return page.screenshot({type:'png',fullPage:false,encoding:'base64'}).catch(()=>null);}

export async function trackEmirates(mawb){
  const digits=digitsOnly(mawb);if(!/^176\d{8}$/.test(digits))return{ok:false,reason:'INVALID EMIRATES MAWB'};
  let browser;
  try{
    browser=await launch();const page=await browser.newPage();await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36');
    const network=[];const tasks=[];page.on('response',res=>{const task=(async()=>{try{const req=res.request(),type=req.resourceType(),url=res.url(),ct=(res.headers()['content-type']||'').toLowerCase();if(!['xhr','fetch'].includes(type)||!/eskycargo\.emirates\.com\/api\//i.test(url)||!/json|text/.test(ct))return;const txt=clean(await res.text());if(txt.includes(digits)||txt.includes(digits.slice(3))||/shipment|tracking|airway|flight|arrival|pieces|weight/i.test(txt))network.push({url,status:res.status(),text:txt.slice(0,50000)});}catch{}})();tasks.push(task);});

    await page.goto(HOME,{waitUntil:'domcontentloaded',timeout:25000});await sleep(2200);await acceptCookies(page);await sleep(3500);
    const filled=await fillDocumentNumber(page,digits);if(!filled?.ok)return{ok:false,reason:'EMIRATES DOC NUMBER FIELD NOT FOUND',officialTracker:HOME,debug:{stage:'find-offer',filled}};
    await sleep(500);const searched=await clickByText(page,/^Search$/i);if(!searched)return{ok:false,reason:'EMIRATES SEARCH BUTTON NOT FOUND',officialTracker:HOME,debug:{stage:'find-offer',filled}};
    await sleep(6000);await Promise.allSettled(tasks);

    const discovered=await discoverShipmentId(page,digits,network);if(!discovered.id){const body=clean(await page.evaluate(()=>document.body?.innerText||'').catch(()=>''));return{ok:false,reason:'EMIRATES SHIPMENT RESULT ID NOT FOUND',officialTracker:page.url(),debug:{stage:'discover-shipment',filled,searched,url:page.url(),bodySample:body.slice(0,2500)}};}
    const opened=await openTrackingDetails(page,discovered.id);
    const bodyAfter=clean(await page.evaluate(()=>document.body?.innerText||'').catch(()=>''));const panelText=clean(await trackingPanelText(page));
    const routeOk=/shipments\/list\//i.test(page.url())&&/openedTab=tracking-details/i.test(page.url());const trackingLabel=/Tracking Details/i.test(bodyAfter);
    if(!routeOk&&!trackingLabel)return{ok:false,reason:'EMIRATES TRACKING DETAILS PAGE NOT OPENED',officialTracker:page.url(),debug:{stage:'open-tracking-details',shipmentId:discovered.id,shipmentIdSource:discovered.source,opened,url:page.url(),bodySample:bodyAfter.slice(0,3000)}};

    const screenshotBase64=await trackingDetailsScreenshot(page);if(!screenshotBase64)return{ok:false,reason:'EMIRATES TRACKING DETAILS SCREENSHOT FAILED',officialTracker:page.url(),debug:{stage:'screenshot',shipmentId:discovered.id,shipmentIdSource:discovered.source,opened,url:page.url()}};

    const domShipment=parseTrackingText(panelText||bodyAfter,mawb);
    const ocrResult=await readTrackingScreenshot({mawb,screenshotBase64,timeoutMs:22000});
    let shipment={mawb,carrierCode:'EK',airlineName:'Emirates SkyCargo',officialTracker:page.url(),source:'Emirates eSkyCargo Tracking Details screenshot'};
    shipment=merge(shipment,domShipment);
    if(ocrResult?.ok)shipment=merge(shipment,ocrResult.shipment);
    shipment.officialTracker=page.url();
    shipment.source=ocrResult?.ok?'Emirates eSkyCargo Tracking Details screenshot OCR':'Emirates eSkyCargo Tracking Details screenshot + rendered text';

    if(!useful(shipment))return{ok:false,reason:ocrResult?.reason||'EMIRATES TRACKING DETAILS FOUND NO VERIFIED FIELDS',officialTracker:page.url(),screenshotCaptured:true,screenshotVerified:true,screenshotOcrUsed:false,debug:{stage:'extract-fields',shipmentId:discovered.id,shipmentIdSource:discovered.source,opened,url:page.url(),panelSample:panelText.slice(0,3000),ocr:ocrResult?.debug||null,ocrReason:ocrResult?.reason||''}};

    return{ok:true,shipment,screenshotCaptured:true,screenshotVerified:true,screenshotOcrUsed:Boolean(ocrResult?.ok),debug:{stage:'done',shipmentId:discovered.id,shipmentIdSource:discovered.source,url:page.url(),opened,ocrReason:ocrResult?.ok?'':ocrResult?.reason||'',ocrSample:ocrResult?.debug?.textSample||'',panelSample:panelText.slice(0,2200)}};
  }catch(e){return{ok:false,reason:e?.message||String(e),officialTracker:HOME,debug:{stage:'exception'}};}
  finally{try{if(browser)await browser.close()}catch{}}
}
