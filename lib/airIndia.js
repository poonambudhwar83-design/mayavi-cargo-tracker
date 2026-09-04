import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { readTrackingScreenshot } from './screenshotOcr.js';

const START='https://cargo.airindia.com/in/en/track-shipment.html';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
const digitsOnly=s=>String(s||'').replace(/\D/g,'');
const pad=v=>String(v).padStart(2,'0');
const MONTH={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};

function parseDate(s=''){
  const t=String(s).toUpperCase();
  let m=t.match(/(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})/);if(m)return`${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m=t.match(/(\d{1,2})[-\/.](\d{1,2})[-\/.](20\d{2})/);if(m)return`${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  m=t.match(/(\d{1,2})[\s\-]+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s\-,]+(20\d{2})/);if(m)return`${m[3]}-${MONTH[m[2]]}-${pad(m[1])}`;
  m=t.match(/(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s\-]+(\d{1,2})[\s\-,]+(20\d{2})/);if(m)return`${m[3]}-${MONTH[m[1]]}-${pad(m[2])}`;
  return'';
}
function parseTime(s=''){
  const m=String(s).match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);return m?`${pad(m[1])}:${m[2]}`:'';
}
function routeFromTracking(text=''){
  const flat=clean(text),upper=flat.toUpperCase();
  let m=upper.match(/DEPARTURE\s*:?[^A-Z0-9]{0,20}[\s\S]{0,160}?\b([A-Z]{3})\s*(?:→|->|–|—|-)\s*([A-Z]{3})\b[\s\S]{0,120}?ARRIVAL/i);
  if(m)return{origin:m[1],destination:m[2]};
  m=upper.match(/\b([A-Z]{3})\b[\s\S]{0,120}?\bACCEPTED\b[\s\S]{0,260}?\b([A-Z]{3})\b[\s\S]{0,100}?TRACKING VIEW/i);
  if(m)return{origin:m[1],destination:m[2]};
  const origin=(upper.match(/\b([A-Z]{3})\s*-\s*ACCEPTED\b/)||[])[1]||'';
  const destination=(upper.match(/\bDELIVERED\b[\s\S]{0,260}?\b([A-Z]{3})\s*-\s*TRACKING VIEW\b/)||[])[1]||'';
  if(origin&&destination)return{origin,destination};
  const segment=(upper.match(/\b\d{3}-\d{8}\b[\s\S]{0,900}?TRACKING VIEW/)||[])[0]||upper;
  const codes=[...segment.matchAll(/\b([A-Z]{3})\b/g)].map(x=>x[1]).filter(x=>!['CBM','PCS','BKG','AGC'].includes(x));
  return{origin:codes[0]||'',destination:codes.length>1?codes[codes.length-1]:''};
}
function piecesWeight(text=''){
  const flat=clean(text);
  const m=flat.match(/\b\d{3}-\d{8}\b\s+(\d{1,6})\s+pcs\s+([\d,.]+)\s+kg\b/i)
    ||flat.match(/\b(\d{1,6})\s+pcs\s+([\d,.]+)\s+kg\b/i);
  return{pieces:m?.[1]||'',weight:(m?.[2]||'').replace(/,/g,'')};
}
function timelineOnly(activity=''){
  const flat=clean(activity);const i=flat.toUpperCase().indexOf('AWB ACTIVITY TIMELINE');
  return i>=0?flat.slice(i):flat;
}
function finalArrivalEvent(activity='',destination=''){
  const flat=timelineOnly(activity),dest=String(destination||'').toUpperCase();
  if(!dest)return null;
  const rx=new RegExp(`\\bARRIVAL\\s+Arrived([\\s\\S]{0,420}?)\\bat\\s+${dest}\\b`,'i');
  const m=rx.exec(flat);if(!m)return null;
  const segment=clean(`${m[0]} ${flat.slice(m.index,Math.min(flat.length,m.index+650))}`);
  const fm=segment.match(/\bon\s+([A-Z0-9]{2})[- ]?(\d{2,4})[A-Z]?\b/i);
  const flightNo=fm?`${String(fm[1]).toUpperCase()}${fm[2]}`:'';
  const pieces=(segment.match(/\b(\d{1,6})\s+pcs\b/i)||[])[1]||'';
  const weight=((segment.match(/\b([\d,.]+)\s+kg\b/i)||[])[1]||'').replace(/,/g,'');
  return{segment,flightNo,pieces,weight,arrivalDate:parseDate(segment),arrivalTime:parseTime(segment),status:'ARRIVED'};
}
function deliveredEvent(activity='',destination=''){
  const flat=timelineOnly(activity),dest=String(destination||'').toUpperCase();
  if(!dest)return false;
  return new RegExp(`\\bDELIVERY\\s+Delivered([\\s\\S]{0,420}?)\\bat\\s+${dest}\\b`,'i').test(flat);
}
function statusFromActivity(activity='',destination=''){
  const timeline=timelineOnly(activity);
  if(deliveredEvent(timeline,destination))return'DELIVERED';
  if(finalArrivalEvent(timeline,destination))return'ARRIVED';
  if(/\bDEPARTURE\s+Departed\b/i.test(timeline))return'IN TRANSIT';
  if(/\bACCEPTED\b|RECEIVED FROM SHIPPER|\bRCS\b/i.test(timeline))return'BOOKED';
  return'TRACKING';
}
function useful(s={}){
  return Boolean((s.origin&&s.destination)||s.pieces||s.weight||s.flightNo||s.arrivalDate||s.arrivalTime||(s.status&&s.status!=='TRACKING'));
}
function preferOcr(ocr={},dom={}){
  const out={...dom};
  for(const k of ['origin','destination','pieces','bags','weight','flightNo','arrivalDate','arrivalTime']){
    const v=ocr?.[k];
    if(v!==''&&v!==null&&v!==undefined)out[k]=v;
  }
  if(ocr?.arrivalDate||ocr?.arrivalTime)out.arrivalIsActual=Boolean(ocr.arrivalIsActual);
  return out;
}
async function launch(){
  chromium.setGraphicsMode=false;
  return puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox'],defaultViewport:{width:1440,height:1100,deviceScaleFactor:1},executablePath:await chromium.executablePath(),headless:'shell'});
}
async function bodyText(page){return clean(await page.evaluate(()=>document.body?.innerText||'').catch(()=>''));}

export async function trackAirIndia(mawb){
  const digits=digitsOnly(mawb);
  if(!/^098\d{8}$/.test(digits))return{ok:false,reason:'INVALID AIR INDIA MAWB',officialTracker:START};
  let browser;
  try{
    browser=await launch();const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36');
    await page.goto(START,{waitUntil:'domcontentloaded',timeout:25000});
    await page.waitForSelector('#shipmentValue',{timeout:18000});
    await sleep(1200);
    const input=await page.$('#shipmentValue');
    if(!input)return{ok:false,reason:'AIR INDIA AWB INPUT NOT FOUND',officialTracker:page.url(),debug:{stage:'input'}};
    await input.click({clickCount:3});await page.keyboard.press('Backspace');await input.type(digits,{delay:20});
    const submit='[data-testid="shipment-search-form-panel__submit-button"]';
    await page.waitForFunction(sel=>{const e=document.querySelector(sel);return e&&!e.disabled;},{timeout:6000},submit).catch(()=>{});
    const enabled=await page.$eval(submit,e=>!e.disabled).catch(()=>false);
    if(!enabled)return{ok:false,reason:'AIR INDIA NEXT BUTTON NOT ENABLED',officialTracker:page.url(),debug:{stage:'submit',value:await input.evaluate(e=>e.value).catch(()=> '')}};

    // Exact required flow: official Air India link -> MAWB -> Next -> visible result screen -> screenshot -> extract -> tracker.
    await page.click(submit);
    await page.waitForFunction(serial=>String(document.body?.innerText||'').replace(/\D/g,'').includes(serial),{timeout:15000},digits.slice(3)).catch(()=>{});
    await sleep(2200);
    const tracking=await bodyText(page);
    const awbMatched=digitsOnly(tracking).includes(digits)||digitsOnly(tracking).includes(digits.slice(3));
    if(!awbMatched)return{ok:false,reason:'AIR INDIA RESULT DID NOT MATCH MAWB',officialTracker:page.url(),debug:{stage:'result',bodySample:tracking.slice(0,2500)}};
    const resultScreenshotBase64=await page.screenshot({type:'jpeg',quality:78,fullPage:false,encoding:'base64'}).catch(()=>null);

    let activity=tracking;let activityClicked=false;
    const activitySel='[data-testid="tabs-panel__tab-activityView"]';
    if(await page.$(activitySel)){await page.click(activitySel);activityClicked=true;await sleep(1700);activity=await bodyText(page);}
    const activityScreenshotBase64=await page.screenshot({type:'jpeg',quality:80,fullPage:false,encoding:'base64'}).catch(()=>null);
    const screenshotBase64=activityScreenshotBase64||resultScreenshotBase64;
    const ocrResult=screenshotBase64?await readTrackingScreenshot({mawb,screenshotBase64,timeoutMs:30000}):{ok:false,reason:'NO AIR INDIA SCREENSHOT'};

    const route=routeFromTracking(activity||tracking),pw=piecesWeight(activity||tracking);
    const finalArrival=finalArrivalEvent(activity,route.destination);
    const verifiedStatus=statusFromActivity(activity,route.destination);
    let shipment={
      mawb,carrierCode:'AI',airlineName:'Air India Cargo',officialTracker:page.url(),
      origin:route.origin,destination:route.destination,
      bags:finalArrival?.pieces||pw.pieces,pieces:finalArrival?.pieces||pw.pieces,
      weight:finalArrival?.weight||pw.weight,
      flightNo:finalArrival?.flightNo||'',
      arrivalDate:finalArrival?.arrivalDate||'',arrivalTime:finalArrival?.arrivalTime||'',arrivalIsActual:Boolean(finalArrival),
      status:verifiedStatus,source:'Air India Cargo Portal screenshot OCR + same-screen Activity View verification'
    };
    if(ocrResult?.ok&&ocrResult.shipment)shipment=preferOcr(ocrResult.shipment,shipment);
    // Status is taken only from the actual Activity Timeline, never from generic milestone labels.
    shipment.status=verifiedStatus;
    if(finalArrival){
      shipment.flightNo=finalArrival.flightNo||shipment.flightNo;
      shipment.arrivalDate=finalArrival.arrivalDate||shipment.arrivalDate;
      shipment.arrivalTime=finalArrival.arrivalTime||shipment.arrivalTime;
      shipment.arrivalIsActual=true;
      shipment.pieces=finalArrival.pieces||shipment.pieces;
      shipment.bags=finalArrival.pieces||shipment.bags;
      shipment.weight=finalArrival.weight||shipment.weight;
    }

    if(!useful(shipment))return{ok:false,reason:'AIR INDIA SCREENSHOT FOUND NO VERIFIED SHIPMENT FIELDS',officialTracker:page.url(),screenshotCaptured:Boolean(screenshotBase64),screenshotOcrUsed:Boolean(ocrResult?.ok),debug:{stage:'parse',ocrReason:ocrResult?.reason||'',trackingSample:tracking.slice(0,2600),activitySample:activity.slice(0,3500)}};
    return{ok:true,shipment,screenshotCaptured:Boolean(screenshotBase64),screenshotVerified:Boolean(screenshotBase64),screenshotOcrUsed:Boolean(ocrResult?.ok),debug:{stage:'done',url:page.url(),activityClicked,awbMatched,resultScreenshotCaptured:Boolean(resultScreenshotBase64),activityScreenshotCaptured:Boolean(activityScreenshotBase64),ocrReason:ocrResult?.reason||'',ocrSample:ocrResult?.debug?.textSample||'',trackingSample:tracking.slice(0,2600),activitySample:activity.slice(0,3500),finalArrival:finalArrival||null}};
  }catch(e){return{ok:false,reason:e?.message||String(e),officialTracker:START,debug:{stage:'exception'}};}
  finally{try{if(browser)await browser.close()}catch{}}
}
