import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { readTrackingScreenshot } from './screenshotOcr.js';

const HOME='https://eskycargo.emirates.com/app/offerandorder/';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
const digitsOnly=s=>String(s||'').replace(/\D/g,'');
const pad=v=>String(v).padStart(2,'0');
const MONTH={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};

function parseDate(s=''){
  const t=String(s).toUpperCase();let m=t.match(/(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})/);if(m)return`${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m=t.match(/(\d{1,2})[-\/.](\d{1,2})[-\/.](20\d{2})/);if(m)return`${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  m=t.match(/(\d{1,2})[\s\-]+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s\-,]+(20\d{2})/);if(m)return`${m[3]}-${MONTH[m[2]]}-${pad(m[1])}`;
  m=t.match(/(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s\-]+(\d{1,2})[\s\-,]+(20\d{2})/);if(m)return`${m[3]}-${MONTH[m[1]]}-${pad(m[2])}`;
  return'';
}
function parseTime(s=''){const m=String(s).match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);return m?`${pad(m[1])}:${m[2]}`:'';}
function around(text,rx,before=160,after=420){const m=rx.exec(text);if(!m)return'';return text.slice(Math.max(0,m.index-before),Math.min(text.length,m.index+after));}
function parseVisibleText(text='',mawb=''){
  const flat=clean(text),upper=flat.toUpperCase();
  const route=upper.match(/\bORIGIN\b\s*[:\-]?\s*([A-Z]{3})\b[\s\S]{0,160}?\bDESTINATION\b\s*[:\-]?\s*([A-Z]{3})\b/)||upper.match(/\b([A-Z]{3})\s*(?:→|->|—|-)\s*([A-Z]{3})\b/);
  const pieces=(flat.match(/(?:Pieces?|Pcs?|No\.?\s*of\s*Pieces)\s*[:\-]?\s*(\d{1,6})/i)||[])[1]||'';
  const weight=((flat.match(/(?:Gross\s*Weight|Weight)\s*[:\-]?\s*([\d,.]+)\s*(?:KG|KGS)?/i)||[])[1]||'').replace(/,/g,'');
  const fm=upper.match(/\bEK\s*[- ]?(\d{2,4})\b/);const flightNo=fm?`EK${fm[1]}`:'';
  const actual=around(flat,/ACTUAL\s+ARRIVAL|ARRIVED|LANDED|RECEIVED\s+FROM\s+FLIGHT|\bRCF\b/i);
  const eta=around(flat,/ETA|ESTIMATED\s+ARRIVAL|SCHEDULED\s+ARRIVAL|EXPECTED\s+ARRIVAL/i);
  let arrivalDate=parseDate(actual),arrivalTime=parseTime(actual),arrivalIsActual=Boolean(arrivalDate||arrivalTime);
  if(!arrivalDate&&!arrivalTime){arrivalDate=parseDate(eta);arrivalTime=parseTime(eta);arrivalIsActual=false;}
  let status='';
  if(/\bDELIVERED\b|\bDLV\b/i.test(actual||flat))status='DELIVERED';
  else if(/ACTUAL\s+ARRIVAL|\bARRIVED\b|\bLANDED\b|RECEIVED\s+FROM\s+FLIGHT|\bRCF\b/i.test(actual||flat))status='ARRIVED';
  else if(/\bDEPARTED\b|\bDEP\b|IN\s+TRANSIT/i.test(flat))status='IN TRANSIT';
  else if(/\bBOOKED\b|\bRCS\b|ACCEPTED/i.test(flat))status='BOOKED';
  const serial=digitsOnly(mawb).slice(3);const awbMatched=Boolean(serial&&digitsOnly(flat).includes(serial));
  return{mawb,carrierCode:'EK',airlineName:'Emirates SkyCargo',origin:route?.[1]||'',destination:route?.[2]||'',bags:pieces,pieces,weight,flightNo,arrivalDate,arrivalTime,arrivalIsActual,status,officialTracker:HOME,source:'Emirates eSkyCargo Tracking Details',awbMatched};
}
function merge(base={},next={}){const out={...base};for(const[k,v]of Object.entries(next||{})){if(v!==''&&v!==null&&v!==undefined)out[k]=v;}return out;}
function useful(s={}){return Boolean((s.origin&&s.destination)||s.pieces||s.weight||s.flightNo||s.arrivalDate||s.arrivalTime||s.status);}

async function launch(){
  chromium.setGraphicsMode=false;
  return puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox'],defaultViewport:{width:1280,height:900,deviceScaleFactor:1},executablePath:await chromium.executablePath(),headless:'shell'});
}
async function acceptCookies(page){
  await page.evaluate(()=>{const label=e=>String(e.innerText||e.getAttribute('aria-label')||'').replace(/\s+/g,' ').trim();const t=[...document.querySelectorAll('button,a,[role="button"]')].find(e=>/^(accept|allow all)$/i.test(label(e))||/accept all cookies/i.test(label(e)));t?.click();}).catch(()=>{});
}
function idsFromText(text='',digits=''){
  const out=[];const add=v=>{if(/^\d{5,12}$/.test(String(v||''))&&!out.includes(String(v)))out.push(String(v));};
  let m;const patterns=[/shipments\/list\/(\d{5,12})/g,/"shipmentId"\s*:\s*"?(\d{5,12})"?/gi,/"shipmentID"\s*:\s*"?(\d{5,12})"?/gi,/"id"\s*:\s*"?(\d{5,12})"?/gi];
  for(const rx of patterns){while((m=rx.exec(text))!==null)add(m[1]);}
  if(digits&&!text.includes(digits))return out.filter(()=>false);
  return out;
}

export async function trackEmirates(mawb){
  const digits=digitsOnly(mawb);if(!/^176\d{8}$/.test(digits))return{ok:false,reason:'INVALID EMIRATES MAWB'};
  let browser;
  try{
    browser=await launch();const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36');
    const network=[];const tasks=[];
    page.on('response',res=>{const task=(async()=>{try{const req=res.request(),type=req.resourceType(),url=res.url(),ct=(res.headers()['content-type']||'').toLowerCase();if(!['xhr','fetch'].includes(type)||!/eskycargo\.emirates\.com\/api\//i.test(url))return;if(!/json|text/.test(ct))return;const txt=clean(await res.text());if(txt.includes(digits)||/shipment|tracking|airway|flight|arrival|pieces|weight/i.test(txt))network.push({url,status:res.status(),text:txt.slice(0,18000)});}catch{}})();tasks.push(task);});

    await page.goto(HOME,{waitUntil:'domcontentloaded',timeout:20000});await sleep(2800);await acceptCookies(page);await sleep(5200);
    const input=await page.$('input[placeholder*="Doc. No."]');if(!input)return{ok:false,reason:'EMIRATES DOC NUMBER FIELD NOT FOUND',officialTracker:HOME};
    await input.click({clickCount:3});await input.type(digits,{delay:12});await page.keyboard.press('Enter').catch(()=>{});await sleep(500);
    const clicked=await page.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(e=>/^Search$/i.test(String(e.innerText||'').trim()));if(b){b.click();return true}return false;});
    if(!clicked)return{ok:false,reason:'EMIRATES SEARCH BUTTON NOT FOUND',officialTracker:HOME};
    await sleep(7000);await Promise.allSettled(tasks);

    let shipmentId=await page.evaluate(()=>{const fromUrl=location.href.match(/shipments\/list\/(\d{5,12})/);if(fromUrl)return fromUrl[1];const a=[...document.querySelectorAll('a[href*="shipments/list/"]')][0];const m=(a?.href||'').match(/shipments\/list\/(\d{5,12})/);return m?.[1]||'';}).catch(()=> '');

    if(!shipmentId){
      const clickedResult=await page.evaluate((digits)=>{const serial=digits.slice(3);const els=[...document.querySelectorAll('a,button,[role="button"],tr,div')];const t=els.find(e=>{const x=String(e.innerText||'').replace(/\D/g,'');return x.includes(digits)||x.includes(serial);});if(t){(t.closest('a,button,[role="button"],tr')||t).click();return true;}return false;},digits).catch(()=>false);
      if(clickedResult){await sleep(4500);shipmentId=(await page.url().match(/shipments\/list\/(\d{5,12})/)?.[1])||'';}
    }
    if(!shipmentId){
      const html=await page.content().catch(()=> '');const candidates=idsFromText(html,digits);
      if(candidates.length)shipmentId=candidates[0];
    }
    if(!shipmentId){
      for(const n of network){const ids=idsFromText(n.text,digits);if(ids.length){shipmentId=ids[0];break;}}
    }
    if(!shipmentId)return{ok:false,reason:'EMIRATES SHIPMENT ID NOT FOUND AFTER SEARCH',officialTracker:HOME,debug:{clicked,networkUrls:network.slice(-20).map(x=>x.url)}};

    // Keep the initialized guest session alive; only change the SPA hash to Tracking Details.
    await page.evaluate((id)=>{location.hash=`#/shipments/list/${id}?openedTab=tracking-details`;},shipmentId);await sleep(6500);
    await page.evaluate(()=>{const label=e=>String(e.innerText||e.getAttribute('aria-label')||'').replace(/\s+/g,' ').trim();const t=[...document.querySelectorAll('button,a,[role="tab"],[role="button"]')].find(e=>/^Tracking Details$/i.test(label(e)));t?.click();}).catch(()=>{});await sleep(2500);

    const body=clean(await page.evaluate(()=>document.body?.innerText||'').catch(()=>''));
    if(/Initialization failed/i.test(body))return{ok:false,reason:'EMIRATES TRACKING DETAILS INITIALIZATION FAILED',officialTracker:HOME,debug:{shipmentId,url:page.url()}};

    await page.evaluate(()=>{const all=[...document.querySelectorAll('*')];const t=all.find(e=>/^Tracking Details$/i.test(String(e.innerText||'').replace(/\s+/g,' ').trim()));t?.scrollIntoView({block:'start'});}).catch(()=>{});await sleep(500);
    const screenshotBase64=await page.screenshot({type:'png',fullPage:false,encoding:'base64'}).catch(()=>null);
    const domShipment=parseVisibleText(body,mawb);
    let ocrResult={ok:false,reason:'EMIRATES SCREENSHOT NOT CAPTURED'};
    if(screenshotBase64)ocrResult=await readTrackingScreenshot({mawb,screenshotBase64});
    const ocrShipment=ocrResult?.ok?ocrResult.shipment:null;
    let shipment=merge({mawb,carrierCode:'EK',airlineName:'Emirates SkyCargo',officialTracker:`https://eskycargo.emirates.com/app/offerandorder/#/shipments/list/${shipmentId}?openedTab=tracking-details`},domShipment);
    if(ocrShipment)shipment=merge(shipment,ocrShipment);
    // Never allow a generic DELAYED word to override verified arrived evidence.
    if(/ACTUAL\s+ARRIVAL|\bARRIVED\b|\bLANDED\b|RECEIVED\s+FROM\s+FLIGHT|\bRCF\b/i.test(body))shipment.status='ARRIVED';
    shipment.source=ocrResult?.ok?'Emirates eSkyCargo Tracking Details screenshot OCR':'Emirates eSkyCargo Tracking Details visible text';
    if(!useful(shipment))return{ok:false,reason:ocrResult?.reason||'EMIRATES TRACKING DETAILS FOUND NO SHIPMENT FIELDS',officialTracker:shipment.officialTracker,screenshotCaptured:Boolean(screenshotBase64),debug:{shipmentId,url:page.url(),bodySample:body.slice(0,1600),ocr:ocrResult?.debug||null}};
    return{ok:true,shipment,screenshotCaptured:Boolean(screenshotBase64),screenshotVerified:Boolean(screenshotBase64),screenshotOcrUsed:Boolean(ocrResult?.ok),debug:{shipmentId,url:page.url(),bodySample:body.slice(0,1800),ocrTextSample:ocrResult?.debug?.textSample||''}};
  }catch(e){return{ok:false,reason:e?.message||String(e),officialTracker:HOME};}
  finally{try{if(browser)await browser.close()}catch{}}
}
