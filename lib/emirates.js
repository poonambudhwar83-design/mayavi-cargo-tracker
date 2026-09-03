import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { readTrackingScreenshot } from './screenshotOcr.js';

const HOME='https://eskycargo.emirates.com/app/offerandorder/#/home/find-offer';
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
function around(text,rx,before=180,after=520){const m=rx.exec(text);if(!m)return'';return text.slice(Math.max(0,m.index-before),Math.min(text.length,m.index+after));}
function parseVisibleText(text='',mawb=''){
  const flat=clean(text),upper=flat.toUpperCase();
  const named=upper.match(/\bORIGIN\b\s*[:\-]?\s*([A-Z]{3})\b[\s\S]{0,180}?\bDESTINATION\b\s*[:\-]?\s*([A-Z]{3})\b/);
  const arrow=upper.match(/\b([A-Z]{3})\s*(?:→|->|—|-)\s*([A-Z]{3})\b/);
  const cityPair=upper.match(/\b[A-Z][A-Z .'-]{2,30}\s*\(([A-Z]{3})\)\s+[A-Z][A-Z .'-]{2,30}\s*\(([A-Z]{3})\)/);
  const route=named||arrow||cityPair;
  const pieces=(flat.match(/(?:Pieces?|Pcs?|No\.?\s*of\s*Pieces)\s*[:\-]?\s*(\d{1,6})/i)||[])[1]||'';
  const weight=((flat.match(/(?:Gross\s*Weight|Weight)\s*[:\-]?\s*([\d,.]+)\s*(?:KG|KGS)?/i)||[])[1]||'').replace(/,/g,'');
  const fm=upper.match(/\bEK\s*[- ]?(\d{2,4})\b/);const flightNo=fm?`EK${fm[1]}`:'';
  const actual=around(flat,/ACTUAL\s+ARRIVAL|ARRIVED|LANDED|RECEIVED\s+FROM\s+FLIGHT|\bRCF\b|NOTIFIED\s+OF\s+ARRIVAL|ARRIVAL\s+OF\s+SHIPMENT/i);
  const eta=around(flat,/ETA|ESTIMATED\s+ARRIVAL|SCHEDULED\s+ARRIVAL|EXPECTED\s+ARRIVAL/i);
  let arrivalDate=parseDate(actual),arrivalTime=parseTime(actual),arrivalIsActual=Boolean(arrivalDate||arrivalTime);
  if(!arrivalDate&&!arrivalTime){arrivalDate=parseDate(eta);arrivalTime=parseTime(eta);arrivalIsActual=false;}
  let status='';
  if(/\bDELIVERED\b|\bDLV\b/i.test(actual))status='DELIVERED';
  else if(/ACTUAL\s+ARRIVAL|\bARRIVED\b|\bLANDED\b|RECEIVED\s+FROM\s+FLIGHT|\bRCF\b|NOTIFIED\s+OF\s+ARRIVAL|ARRIVAL\s+OF\s+SHIPMENT/i.test(actual))status='ARRIVED';
  else if(/\bDEPARTED\b|\bDEP\b|IN\s+TRANSIT/i.test(flat))status='IN TRANSIT';
  else if(/\bBOOKED\b|\bRCS\b|ACCEPTED/i.test(flat))status='BOOKED';
  return{mawb,carrierCode:'EK',airlineName:'Emirates SkyCargo',origin:route?.[1]||'',destination:route?.[2]||'',bags:pieces,pieces,weight,flightNo,arrivalDate,arrivalTime,arrivalIsActual,status,officialTracker:HOME,source:'Emirates eSkyCargo Tracking Details'};
}
function merge(base={},next={}){const out={...base};for(const[k,v]of Object.entries(next||{})){if(v!==''&&v!==null&&v!==undefined)out[k]=v;}return out;}
function useful(s={}){return Boolean((s.origin&&s.destination)||s.pieces||s.weight||s.flightNo||s.arrivalDate||s.arrivalTime||s.status);}
async function launch(){chromium.setGraphicsMode=false;return puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox'],defaultViewport:{width:1440,height:1000,deviceScaleFactor:1},executablePath:await chromium.executablePath(),headless:'shell'});}
async function acceptCookies(page){await page.evaluate(()=>{const label=e=>String(e.innerText||e.getAttribute('aria-label')||'').replace(/\s+/g,' ').trim();const t=[...document.querySelectorAll('button,a,[role="button"]')].find(e=>/^(accept|allow all)$/i.test(label(e))||/accept all cookies/i.test(label(e)));t?.click();}).catch(()=>{});}
async function fillDocumentNumber(page,digits){return page.evaluate((value)=>{const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};const all=[...document.querySelectorAll('input')].filter(visible);let input=all.find(e=>/doc|awb|air.?way/i.test(`${e.placeholder||''} ${e.name||''} ${e.id||''} ${e.getAttribute('aria-label')||''}`));if(!input)input=all.find(e=>e.type==='text')||all[0];if(!input)return{ok:false};const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;input.focus();setter?.call(input,'');input.dispatchEvent(new Event('input',{bubbles:true}));setter?.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));input.dispatchEvent(new Event('blur',{bubbles:true}));return{ok:true,placeholder:input.placeholder||'',value:input.value};},digits).catch(()=>({ok:false}));}
async function clickByText(page,rx){return page.evaluate((source,flags)=>{const re=new RegExp(source,flags);const label=e=>String(e.innerText||e.getAttribute('aria-label')||e.getAttribute('title')||'').replace(/\s+/g,' ').trim();const els=[...document.querySelectorAll('button,a,[role="button"],[role="tab"],span')];const e=els.find(x=>re.test(label(x)));if(!e)return'';(e.closest('button,a,[role="button"],[role="tab"]')||e).click();return label(e);},rx.source,rx.flags).catch(()=> '');}
async function trackingDetailsScreenshot(page){
  const clip=await page.evaluate(()=>{
    const text=e=>String(e.innerText||e.getAttribute('aria-label')||e.getAttribute('title')||'').replace(/\s+/g,' ').trim();
    const marker=[...document.querySelectorAll('[role="tab"],button,a,h1,h2,h3,h4,div,span')].find(e=>/^Tracking Details$/i.test(text(e)));
    if(!marker)return null;
    let el=marker.closest('section,article,.card,.panel,[class*="detail"],[class*="track"]')||marker.parentElement;
    for(let i=0;i<4&&el;i++,el=el.parentElement){const r=el.getBoundingClientRect();if(r.width>500&&r.height>220&&r.height<1800)return{x:Math.max(0,r.x-20),y:Math.max(0,r.y-20),width:Math.min(window.innerWidth-Math.max(0,r.x-20),r.width+40),height:Math.min(window.innerHeight-Math.max(0,r.y-20),r.height+40)};}
    return null;
  }).catch(()=>null);
  if(clip?.width>100&&clip?.height>100){return page.screenshot({type:'png',encoding:'base64',clip}).catch(()=>null);}
  return page.screenshot({type:'png',fullPage:false,encoding:'base64'}).catch(()=>null);
}

export async function trackEmirates(mawb){
  const digits=digitsOnly(mawb);if(!/^176\d{8}$/.test(digits))return{ok:false,reason:'INVALID EMIRATES MAWB'};
  let browser;
  try{
    browser=await launch();const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36');
    const network=[];const tasks=[];
    page.on('response',res=>{const task=(async()=>{try{const req=res.request(),type=req.resourceType(),url=res.url(),ct=(res.headers()['content-type']||'').toLowerCase();if(!['xhr','fetch'].includes(type)||!/eskycargo\.emirates\.com\/api\//i.test(url)||!/json|text/.test(ct))return;const txt=clean(await res.text());if(txt.includes(digits)||/shipment|tracking|airway|flight|arrival|pieces|weight/i.test(txt))network.push({url,status:res.status(),text:txt.slice(0,30000)});}catch{}})();tasks.push(task);});

    await page.goto(HOME,{waitUntil:'domcontentloaded',timeout:20000});await sleep(2800);await acceptCookies(page);await sleep(5200);
    const filled=await fillDocumentNumber(page,digits);if(!filled?.ok)return{ok:false,reason:'EMIRATES DOC NUMBER FIELD NOT FOUND',officialTracker:HOME};
    const clicked=await clickByText(page,/^Search$/i);if(!clicked)return{ok:false,reason:'EMIRATES SEARCH BUTTON NOT FOUND',officialTracker:HOME};
    await sleep(8000);await Promise.allSettled(tasks);

    const showDetails=await clickByText(page,/^Show Details$|^Details$/i);if(showDetails)await sleep(3500);
    const trackingDetails=await clickByText(page,/^Tracking Details$/i);if(trackingDetails)await sleep(3500);

    const body=clean(await page.evaluate(()=>document.body?.innerText||'').catch(()=>''));
    const networkText=network.map(x=>x.text).join(' ');
    const screenshotBase64=await trackingDetailsScreenshot(page);
    const ocrResult=screenshotBase64?await readTrackingScreenshot({mawb,screenshotBase64}):{ok:false,reason:'NO TRACKING DETAILS SCREENSHOT'};

    let shipment={mawb,carrierCode:'EK',airlineName:'Emirates SkyCargo',officialTracker:page.url(),source:'Emirates eSkyCargo Tracking Details screenshot OCR'};
    shipment=merge(shipment,parseVisibleText(networkText,mawb));
    shipment=merge(shipment,parseVisibleText(body,mawb));
    if(ocrResult?.ok)shipment=merge(shipment,ocrResult.shipment);
    shipment.source=ocrResult?.ok?'Emirates eSkyCargo Tracking Details screenshot OCR':'Emirates eSkyCargo Tracking Details';

    if(useful(shipment))return{ok:true,shipment,screenshotCaptured:Boolean(screenshotBase64),screenshotVerified:Boolean(screenshotBase64),screenshotOcrUsed:Boolean(ocrResult?.ok),debug:{url:page.url(),filled,showDetails,trackingDetails,ocrTextSample:ocrResult?.debug?.textSample||'',ocrReason:ocrResult?.reason||'',bodySample:body.slice(0,3000),networkUrls:network.slice(-30).map(x=>x.url)}};
    return{ok:false,reason:ocrResult?.reason||'EMIRATES TRACKING DETAILS FOUND NO SHIPMENT FIELDS',officialTracker:HOME,screenshotCaptured:Boolean(screenshotBase64),debug:{url:page.url(),filled,showDetails,trackingDetails,ocrReason:ocrResult?.reason||'',bodySample:body.slice(0,3000),networkUrls:network.slice(-30).map(x=>x.url)}};
  }catch(e){return{ok:false,reason:e?.message||String(e),officialTracker:HOME};}
  finally{try{if(browser)await browser.close()}catch{}}
}
