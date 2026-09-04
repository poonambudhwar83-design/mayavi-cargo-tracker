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
function parseTime(s=''){const m=String(s).match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);return m?`${pad(m[1])}:${m[2]}`:'';}
function around(text,rx,before=120,after=360){const m=rx.exec(text);if(!m)return'';return text.slice(Math.max(0,m.index-before),Math.min(text.length,m.index+after));}

function parseVisibleResult(text='',mawb=''){
  const flat=clean(text),upper=flat.toUpperCase();
  const formatted=String(mawb||'').replace(/\D/g,'').replace(/^(\d{3})(\d{8})$/,'$1-$2');

  let pieces='',weight='',origin='',destination='';
  const header=flat.match(/\b098-\d{8}\b\s+(\d{1,6})\s+pcs\s+([\d,.]+)\s+kg[\s\S]{0,220}?\b([A-Z]{3})\s*-\s*Accepted[\s\S]{0,260}?\b([A-Z]{3})\s*-\s*Tracking\s+View/i);
  if(header){pieces=header[1]||'';weight=(header[2]||'').replace(/,/g,'');origin=(header[3]||'').toUpperCase();destination=(header[4]||'').toUpperCase();}

  if(!pieces)pieces=(flat.match(/(?:Pieces?|Pcs?)\s*[:\-]?\s*(\d{1,6})/i)||flat.match(/\b(\d{1,6})\s+(?:PCS|PIECES?)\b/i)||[])[1]||'';
  if(!weight)weight=((flat.match(/(?:Gross\s*Weight|Weight)\s*[:\-]?\s*([\d,.]+)\s*(?:KG|KGS)?/i)||flat.match(/\b([\d,.]+)\s*(?:KG|KGS)\b/i)||[])[1]||'').replace(/,/g,'');
  if(!origin||!destination){
    const r=upper.match(/\bORIGIN\b\s*[:\-]?\s*([A-Z]{3})\b[\s\S]{0,180}?\bDESTINATION\b\s*[:\-]?\s*([A-Z]{3})\b/)
      ||upper.match(/\bFROM\b\s*[:\-]?\s*([A-Z]{3})\b[\s\S]{0,180}?\bTO\b\s*[:\-]?\s*([A-Z]{3})\b/)
      ||upper.match(/\b([A-Z]{3})\s*(?:→|->|—|–)\s*([A-Z]{3})\b/);
    if(r){origin=origin||r[1]||'';destination=destination||r[2]||'';}
  }

  const flights=[...upper.matchAll(/\bAI\s*[- ]?(\d{2,4})[A-Z]?\b/g)].map(m=>`AI${m[1]}`);
  const flightNo=flights.length?flights[flights.length-1]:'';

  // Ignore the progress labels "Accepted / Departed / Arrived / Delivered" by themselves.
  const actual=around(flat,/ACTUAL\s+ARRIVAL|\bATA\b|RECEIVED\s+FROM\s+FLIGHT|\bRCF\b|\bLANDED\b|ARRIVAL\s+OF\s+SHIPMENT/i);
  const eta=around(flat,/ETA|ESTIMATED\s+ARRIVAL|EXPECTED\s+ARRIVAL|SCHEDULED\s+ARRIVAL/i);
  let arrivalDate=parseDate(actual),arrivalTime=parseTime(actual),arrivalIsActual=Boolean(arrivalDate||arrivalTime);
  if(!arrivalDate&&!arrivalTime){arrivalDate=parseDate(eta);arrivalTime=parseTime(eta);arrivalIsActual=false;}

  let status='TRACKING';
  const explicit=(flat.match(/\bStatus\s*[:\-]?\s*(Delivered|Arrived|In\s+Transit|Booked|Accepted)\b/i)||[])[1]||'';
  if(explicit){
    if(/Delivered/i.test(explicit))status='DELIVERED';
    else if(/Arrived/i.test(explicit))status='ARRIVED';
    else if(/In\s+Transit/i.test(explicit))status='IN TRANSIT';
    else status='BOOKED';
  }else if(/\bDLV\b/i.test(flat))status='DELIVERED';
  else if(actual&&(arrivalDate||arrivalTime||/\bRCF\b|RECEIVED\s+FROM\s+FLIGHT|\bLANDED\b|ACTUAL\s+ARRIVAL|\bATA\b/i.test(actual)))status='ARRIVED';
  else if(/\bDEP\b|IN\s+TRANSIT|AIRBORNE|IN\s+FLIGHT/i.test(flat))status='IN TRANSIT';
  else if(/\bRCS\b|RECEIVED\s+FROM\s+SHIPPER/i.test(flat))status='BOOKED';

  const serial=digitsOnly(mawb).slice(3),awbMatched=Boolean(serial&&digitsOnly(flat).includes(serial));
  return{mawb:formatted||mawb,carrierCode:'AI',airlineName:'Air India Cargo',origin,destination,bags:pieces,pieces,weight,flightNo,arrivalDate,arrivalTime,arrivalIsActual,status,awbMatched};
}
function useful(s={}){return Boolean((s.origin&&s.destination)||s.pieces||s.weight||s.flightNo||s.arrivalDate||s.arrivalTime||(s.status&&s.status!=='TRACKING'));}
async function launch(){
  chromium.setGraphicsMode=false;
  return puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox'],defaultViewport:{width:1440,height:1100,deviceScaleFactor:1},executablePath:await chromium.executablePath(),headless:'shell'});
}

export async function trackAirIndia(mawb){
  const digits=digitsOnly(mawb);
  if(!/^098\d{8}$/.test(digits))return{ok:false,reason:'INVALID AIR INDIA MAWB',officialTracker:START};
  let browser;
  try{
    browser=await launch();
    const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36');

    // Exact flow requested: Air India link -> MAWB -> Next -> details screen -> screenshot -> extract.
    await page.goto(START,{waitUntil:'domcontentloaded',timeout:30000});
    await page.waitForSelector('#shipmentValue',{timeout:22000});
    const input=await page.$('#shipmentValue');
    if(!input)return{ok:false,reason:'AIR INDIA AWB INPUT NOT FOUND',officialTracker:page.url(),debug:{stage:'input'}};
    await input.click({clickCount:3});
    await page.keyboard.press('Backspace');
    await input.type(digits,{delay:18});

    const nextSel='[data-testid="shipment-search-form-panel__submit-button"]';
    await page.waitForFunction(sel=>{const e=document.querySelector(sel);return e&&!e.disabled;},{timeout:7000},nextSel).catch(()=>{});
    const enabled=await page.$eval(nextSel,e=>!e.disabled).catch(()=>false);
    if(!enabled)return{ok:false,reason:'AIR INDIA NEXT BUTTON NOT ENABLED',officialTracker:page.url(),debug:{stage:'next'}};
    await page.click(nextSel);

    await page.waitForFunction(serial=>String(document.body?.innerText||'').replace(/\D/g,'').includes(serial),{timeout:18000},digits.slice(3)).catch(()=>{});
    await sleep(1800);
    const details=clean(await page.evaluate(()=>document.body?.innerText||'').catch(()=>''));
    const visible=parseVisibleResult(details,mawb);
    if(!visible.awbMatched)return{ok:false,reason:'AIR INDIA RESULT DID NOT MATCH MAWB',officialTracker:page.url(),debug:{stage:'details',bodySample:details.slice(0,2800)}};

    const screenshotBase64=await page.screenshot({type:'jpeg',quality:82,fullPage:false,encoding:'base64'}).catch(()=>null);
    if(!screenshotBase64)return{ok:false,reason:'AIR INDIA DETAILS SCREENSHOT FAILED',officialTracker:page.url(),debug:{stage:'screenshot'}};

    let ocrResult={ok:false,reason:'OCR NOT RUN'};
    try{
      ocrResult=await Promise.race([
        readTrackingScreenshot({mawb,screenshotBase64,timeoutMs:24000}),
        new Promise(resolve=>setTimeout(()=>resolve({ok:false,reason:'AIR INDIA SCREENSHOT OCR TIMEOUT'}),26000))
      ]);
    }catch(e){ocrResult={ok:false,reason:e?.message||String(e)};}

    const shipment={...visible,officialTracker:page.url(),source:'Air India Cargo result-screen screenshot + rendered details'};
    if(ocrResult?.ok&&ocrResult.shipment){
      const o=ocrResult.shipment;
      // OCR can fill missing values, but must not replace clearer rendered values.
      for(const k of ['origin','destination','pieces','bags','weight','flightNo','arrivalDate','arrivalTime'])if(!shipment[k]&&o[k])shipment[k]=o[k];
      if((!shipment.arrivalDate&&!shipment.arrivalTime)&&(o.arrivalDate||o.arrivalTime))shipment.arrivalIsActual=Boolean(o.arrivalIsActual);
      // Air India progress labels contain every milestone, so generic Arrived/Delivered OCR is not enough.
      const snippet=String(o.screenshotSnippet||'');
      const strongEvent=/ACTUAL\s+ARRIVAL|\bATA\b|RECEIVED\s+FROM\s+FLIGHT|\bRCF\b|\bDLV\b|\bLANDED\b/i.test(snippet);
      if(strongEvent&&o.status&&o.statusEvidence==='strong')shipment.status=o.status;
      shipment.source='Air India Cargo result-screen screenshot OCR + rendered details';
    }

    if(!useful(shipment))return{ok:false,reason:ocrResult?.reason||'AIR INDIA DETAILS FOUND NO VERIFIED SHIPMENT FIELDS',officialTracker:page.url(),screenshotCaptured:true,screenshotVerified:true,debug:{stage:'parse',bodySample:details.slice(0,3400),ocr:ocrResult?.debug||null}};
    return{ok:true,shipment,screenshotCaptured:true,screenshotVerified:true,screenshotOcrUsed:Boolean(ocrResult?.ok),debug:{stage:'done',url:page.url(),awbMatched:true,bodySample:details.slice(0,3400),ocrReason:ocrResult?.reason||'',ocrSample:ocrResult?.debug?.textSample||''}};
  }catch(e){return{ok:false,reason:e?.message||String(e),officialTracker:START,debug:{stage:'exception'}};}
  finally{try{if(browser)await browser.close()}catch{}}
}
