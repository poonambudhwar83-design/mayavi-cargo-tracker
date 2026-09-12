import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { airlineForMawb, normalizeMawb } from './airlines.js';

const MONTHS={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
const pad=v=>String(v).padStart(2,'0');
const first=(s,rx)=>(String(s).match(rx)||[])[1]||'';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function parseDate(segment=''){
  const s=String(segment).toUpperCase();let m=s.match(/(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})/);if(m)return`${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m=s.match(/(\d{1,2})[-\/.](\d{1,2})[-\/.](20\d{2})/);if(m)return`${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  m=s.match(/(\d{1,2})[\s\-]+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s\-,]+(20\d{2})/);if(m)return`${m[3]}-${MONTHS[m[2]]}-${pad(m[1])}`;
  m=s.match(/(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s\-]+(\d{1,2})[\s\-,]+(20\d{2})/);if(m)return`${m[3]}-${MONTHS[m[1]]}-${pad(m[2])}`;return'';
}
function parseTime(s=''){const m=String(s).match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);return m?`${pad(m[1])}:${m[2]}`:''}
function statusFromText(text=''){
  const s=String(text).toUpperCase();
  if(/\bDLV\b|DELIVERED/.test(s))return'DELIVERED';
  if(/\bRCF\b|RECEIVED FROM FLIGHT|\bARRIVED\b|\bLANDED\b|ACTUAL ARRIVAL/.test(s))return'ARRIVED';
  if(/DELAY|LATE|OFFLOAD|SHORT SHIP|EXCEPTION/.test(s))return'DELAYED';
  if(/\bDEP\b|DEPARTED|IN TRANSIT|AIRBORNE|IN FLIGHT/.test(s))return'IN TRANSIT';
  if(/\bRCS\b|BOOKED|ACCEPTED|RECEIVED FROM SHIPPER/.test(s))return'BOOKED';
  return'TRACKING';
}

function etihadFromText(text='',mawb='',airline={}){
  const flat=String(text||'').replace(/\s+/g,' ').trim(),upper=flat.toUpperCase();
  if(/ENTER A VALID AIRWAY BILL PREFIX|PAGE NOT FOUND|LOOKS LIKE THIS PAGE DOESN'T EXIST|PAGE TOOK OFF WITHOUT US/i.test(flat))return{mawb,carrierCode:'EY',airlineName:'Etihad Cargo',origin:'',destination:'',bags:'',pieces:'',weight:'',flightNo:'',arrivalDate:'',arrivalTime:'',arrivalIsActual:false,status:'TRACKING',officialTracker:airline?.url||'',source:'Etihad Cargo official shipment result page',arrivalSource:'etihad-no-result',arrivalSnippet:flat.slice(0,1500)};
  const piecesPair=flat.match(/(?:Pieces?|Pcs?)\s*[:\-]?\s*(\d{1,5})\s*\/\s*(\d{1,5})/i)||[];
  const weightPair=flat.match(/Weight\s*[:\-]?\s*([\d,.]+)\s*\/\s*([\d,.]+)\s*(?:KG|KGS)/i)||[];
  const pieces=piecesPair[1]&&piecesPair[2]?`${piecesPair[1]}/${piecesPair[2]}`:(first(flat,/(?:Pieces?|Pcs?)\s*[:\-]?\s*(\d{1,6})/i)||'');
  const weight=weightPair[1]&&weightPair[2]?`${weightPair[1].replace(/,/g,'')}/${weightPair[2].replace(/,/g,'')}`:(first(flat,/Weight\s*[:\-]?\s*([\d,.]+)/i)||'').replace(/,/g,'');
  const airports=[...flat.matchAll(/\b(?:[A-Za-z][A-Za-z .'-]{1,40},\s*)?([A-Z]{3})\b/g)].map(m=>m[1]).filter(x=>!['THE','AND','FOR','PCS','KGS','AWB','HUB','OUT'].includes(x));
  let origin='',destination='';
  const route=upper.match(/\b([A-Z]{3})\s+(?:TO|→|->|-)\s+([A-Z]{3})\b/);if(route){origin=route[1];destination=route[2];}
  if(!origin&&airports.length)origin=airports[0];if(!destination&&airports.length>1)destination=airports[airports.length-1];
  let flightNo='';const fm=upper.match(/\b(EY\s*\d{2,4})\b/);if(fm)flightNo=fm[1].replace(/\s+/g,'');
  let arrivalDate='',arrivalTime='',arrivalIsActual=false;
  const arrived=[...flat.matchAll(/(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[A-Za-z]*\s+20\d{2})\s+(\d{1,2}:\d{2})\s*,?\s*([A-Z]{3})?\s*(?:Shipment\s+arrived|Shipment\s+received\s+from\s+flight|Received\s+from\s+flight)/gi)];
  if(arrived.length){const a=arrived[arrived.length-1];arrivalDate=parseDate(a[1]);arrivalTime=parseTime(a[2]);arrivalIsActual=true;if(a[3])destination=a[3].toUpperCase();}
  if(!arrivalDate||!arrivalTime){const m=flat.match(/(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[A-Za-z]*\s+20\d{2})\s+(\d{1,2}:\d{2})\s*,?\s*([A-Z]{3})?\s*Shipment\s+arrived/i);if(m){arrivalDate=parseDate(m[1]);arrivalTime=parseTime(m[2]);arrivalIsActual=true;if(m[3])destination=m[3].toUpperCase();}}
  const status=/your shipment has been delivered|shipment delivered/i.test(flat)?'DELIVERED':statusFromText(flat);
  return{mawb,carrierCode:'EY',airlineName:'Etihad Cargo',origin,destination,bags:pieces,pieces,weight,flightNo,arrivalDate,arrivalTime,arrivalIsActual,status,officialTracker:airline?.url||'',source:'Etihad Cargo official shipment result page',arrivalSource:arrivalIsActual?'etihad-shipment-arrived':'etihad-result-page',arrivalSnippet:flat.slice(0,1800)};
}

function parseVisibleText(text,mawb,airline){
  const raw=String(text||''),flat=raw.replace(/\s+/g,' ').trim(),upper=flat.toUpperCase(),iata=String(airline?.iata||'').toUpperCase();
  if(iata==='EY')return etihadFromText(raw,mawb,airline);
  let route=upper.match(/\bORIGIN\b\s*[:\-]?\s*([A-Z]{3})\b[\s\S]{0,120}?\bDESTINATION\b\s*[:\-]?\s*([A-Z]{3})\b/)||upper.match(/\bFROM\b\s*[:\-]?\s*([A-Z]{3})\b[\s\S]{0,120}?\bTO\b\s*[:\-]?\s*([A-Z]{3})\b/)||upper.match(/\b([A-Z]{3})\s*(?:→|->|—|-)\s*([A-Z]{3})\b/);
  const origin=route?.[1]||'',destination=route?.[2]||'';
  const pieces=first(flat,/(?:Pieces?|Pcs?|No\.?\s*of\s*Pieces|Piece Count)\s*[:\-]?\s*(\d{1,6})/i)||first(flat,/\b(\d{1,6})\s*(?:PCS|PIECES?)\b/i);
  const weight=(first(flat,/(?:Gross\s*Weight|Chargeable\s*Weight|Weight)\s*[:\-]?\s*([\d,.]+)\s*(?:KG|KGS)?/i)||first(flat,/\b([\d,.]+)\s*(?:KG|KGS)\b/i)).replace(/,/g,'');
  let flightNo='';if(iata){const esc=iata.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');const m=upper.match(new RegExp(`\\b${esc}\\s*[- ]?(\\d{2,4})\\b`));if(m)flightNo=`${iata}${m[1]}`;}if(!flightNo)flightNo=first(upper,/\b([A-Z]{2}\d{2,4})\b/);
  const actual=(flat.match(/(?:ATA|Actual Arrival|Arrived|Received from Flight|RCF|Landed)[\s\S]{0,220}/i)||[])[0]||'';
  const estimated=(flat.match(/(?:ETA|Estimated Arrival|Expected Arrival|Scheduled Arrival|Arrival)[\s\S]{0,220}/i)||[])[0]||'';
  let arrivalDate=parseDate(actual),arrivalTime=parseTime(actual),arrivalIsActual=Boolean(arrivalDate||arrivalTime),arrivalSource='generic-arrival-block';
  if(!arrivalDate&&!arrivalTime){arrivalDate=parseDate(estimated);arrivalTime=parseTime(estimated);arrivalIsActual=false;arrivalSource='generic-estimated-block';}
  return{mawb,carrierCode:iata,airlineName:airline?.name||'',origin,destination,bags:pieces,pieces,weight,flightNo,arrivalDate,arrivalTime,arrivalIsActual,status:statusFromText(flat),officialTracker:airline?.url||'',source:'Official airline browser capture',arrivalSource,arrivalSnippet:''};
}
function useful(s={}){return Boolean((s.origin&&s.destination)||s.pieces||s.weight||s.flightNo||s.arrivalDate||s.arrivalTime||(s.status&&s.status!=='TRACKING'));}
function officialUrl(mawb,airline){
  const prefix=mawb.slice(0,3),serial=mawb.slice(4);
  if(prefix==='607')return'https://www.etihadcargo.com/en/e-services/shipment-tracking';
  if(prefix==='160')return`https://www.cathaycargoterminal.com/en-us/Shipment-Tracking/AWBPrefix/160/AWBSuffix/${serial}`;
  if(prefix==='157')return`https://www.qrcargo.com/s/track-your-shipment?documentNumber=${serial}&documentPrefix=157&documentType=MAWB`;
  return airline?.url||'';
}
async function launchBrowser(){
  chromium.setGraphicsMode=false;
  const executablePath=await chromium.executablePath();
  const options={args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox'],defaultViewport:{width:1440,height:1100,deviceScaleFactor:1},executablePath,headless:'shell'};
  let lastError;
  for(let attempt=1;attempt<=4;attempt++){
    try{return await puppeteer.launch(options);}catch(e){
      lastError=e;
      if(!/ETXTBSY|text file busy/i.test(String(e?.message||e))||attempt===4)throw e;
      await sleep(400*attempt);
    }
  }
  throw lastError;
}
async function acceptCookies(page){await page.evaluate(()=>{const buttons=[...document.querySelectorAll('button,[role="button"]')];const b=buttons.find(x=>/accept all|accept cookies|allow all|agree/i.test((x.innerText||x.getAttribute('aria-label')||'').trim()));if(b)b.click();}).catch(()=>{});}

async function etihadFrameFlow(page,{digits,serial}){
  const result={filled:false,mode:'etihad-human-typing',value:'',frame:'',clicked:'',verified:false,attempts:[]};
  for(const frame of page.frames()){
    try{
      const handles=await frame.$$('input,textarea,[contenteditable="true"],[role="textbox"]');
      let best=null,bestScore=-1;
      for(const h of handles){
        const meta=await h.evaluate(e=>{const s=getComputedStyle(e),b=e.getBoundingClientRect(),d=`${e.name||''} ${e.id||''} ${e.placeholder||''} ${e.getAttribute('aria-label')||''} ${e.getAttribute('title')||''}`.toLowerCase();return{visible:s.display!=='none'&&s.visibility!=='hidden'&&b.width>20&&b.height>10&&!e.disabled,desc:d,value:String(e.value||'')}}).catch(()=>null);
        if(!meta?.visible)continue;
        const score=(/airway|awb/.test(meta.desc)?10:0)+(/shipment|track/.test(meta.desc)?4:0)+(/enter/.test(meta.desc)?2:0)+(meta.value==='607'?-20:0);
        if(score>bestScore){bestScore=score;best=h;}
      }
      if(!best)continue;
      await best.click({clickCount:3}).catch(()=>{});
      await page.keyboard.press('Backspace').catch(()=>{});
      await sleep(250);
      await best.type(serial,{delay:140});
      const actual=await best.evaluate(e=>String(e.value||e.textContent||'')).catch(()=> '');
      result.attempts.push({value:serial,frame:frame.url(),actual,mode:'click-clear-key-by-key'});
      if(actual!==serial)continue;
      result.filled=true;result.value=serial;result.frame=frame.url();
      await sleep(5000);
      const clicked=await frame.evaluate(()=>{const visible=e=>{const s=getComputedStyle(e),b=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&b.width>20&&b.height>10&&!e.disabled};const els=[...document.querySelectorAll('button,input[type="submit"],input[type="button"],a,[role="button"]')].filter(visible);const b=els.find(e=>/^track$/i.test((e.innerText||e.value||e.textContent||e.getAttribute('aria-label')||'').trim()));if(!b)return'';const t=(b.innerText||b.value||b.textContent||'').trim();b.click();return t;}).catch(()=> '');
      if(clicked){result.clicked=clicked;await Promise.race([page.waitForNetworkIdle({idleTime:900,timeout:9000}).catch(()=>{}),sleep(9000)]);await sleep(2500);const text=[];for(const f of page.frames()){try{text.push(await f.evaluate(()=>document.body?.innerText||''));}catch{}}const merged=text.join('\n');if(/your shipment|shipment delivered|shipment arrived|tracking history|\d+\s*\/\s*\d+\s*Pcs|\d+\s*\/\s*\d+\s*Kg/i.test(merged)&&!/Enter a valid Airway bill prefix/i.test(merged)){result.verified=true;return result;}}
    }catch{}
  }
  return result;
}

export async function trackWithBrowser(input){
  const mawb=normalizeMawb(input),airline=airlineForMawb(mawb);if(!mawb||!airline)return{ok:false,reason:'INVALID OR UNMAPPED MAWB'};
  const url=officialUrl(mawb,airline);if(!url)return{ok:false,reason:'NO OFFICIAL TRACKER URL',officialTracker:null};
  const prefix=mawb.slice(0,3),serial=mawb.slice(4),digits=mawb.replace(/\D/g,'');let browser;
  try{
    browser=await launchBrowser();const page=await browser.newPage();await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36');await page.goto(url,{waitUntil:'domcontentloaded',timeout:22000});await sleep(prefix==='607'?4200:1800);await acceptCookies(page);await sleep(700);
    let bodyBefore='';for(const f of page.frames()){try{bodyBefore+=`\n${await f.evaluate(()=>document.body?.innerText||'')}`;}catch{}}
    if(/captcha|verify you are human|security check|cloudflare|turnstile|access denied/i.test(bodyBefore)){const shot=await page.screenshot({type:'jpeg',quality:65,fullPage:false,encoding:'base64'}).catch(()=>null);return{ok:false,reason:'AIRLINE SECURITY/CAPTCHA REQUIRES MANUAL CHECK',officialTracker:url,screenshotBase64:shot,debug:{stage:'CAPTCHA'}};}

    let fill={filled:false};let clicked='';
    if(prefix==='607'){
      const already=/your shipment|shipment delivered|shipment arrived|tracking history|\d+\s*\/\s*\d+\s*Pcs|\d+\s*\/\s*\d+\s*Kg/i.test(bodyBefore)&&!/Enter a valid Airway bill prefix/i.test(bodyBefore);
      if(already){fill={filled:true,mode:'etihad-deep-link',value:digits,verified:true};}
      else{fill=await etihadFrameFlow(page,{digits,serial});clicked=fill.clicked||'';}
    }else{
      fill=await page.evaluate(({mawb,prefix,serial})=>{const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>20&&r.height>10&&!e.disabled};const inputs=[...document.querySelectorAll('input')].filter(visible).filter(e=>!['hidden','checkbox','radio','submit','button'].includes((e.type||'text').toLowerCase()));const desc=e=>`${e.name||''} ${e.id||''} ${e.placeholder||''} ${e.getAttribute('aria-label')||''} ${e.getAttribute('title')||''}`.toLowerCase();const set=(e,v)=>{const d=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');d?.set?.call(e,v);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));};const prefixInput=inputs.find(e=>/prefix/.test(desc(e))),numberInput=inputs.find(e=>/(awb|airway|document|tracking|shipment).*(number|no|serial)|documentnumber|awbnumber/.test(desc(e))&&!/prefix/.test(desc(e)));if(prefixInput&&numberInput){set(prefixInput,prefix);set(numberInput,serial);return{filled:true,mode:'split'};}const best=inputs.map(e=>({e,score:(/(awb|airway|tracking|shipment|document)/.test(desc(e))?5:0)+(/number|no|serial/.test(desc(e))?2:0)})).sort((a,b)=>b.score-a.score)[0];if(best?.e&&best.score>0){set(best.e,mawb);return{filled:true,mode:'single'};}return{filled:false};},{mawb,prefix,serial}).catch(()=>({filled:false}));
      if(fill.filled){await sleep(500);clicked=await page.evaluate(()=>{const els=[...document.querySelectorAll('button,input[type="submit"],a,[role="button"]')];const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>20&&r.height>10&&!e.disabled};const candidates=els.filter(visible).map(e=>({e,t:(e.innerText||e.value||e.getAttribute('aria-label')||e.getAttribute('title')||'').replace(/\s+/g,' ').trim()}));const target=candidates.find(x=>/^track$/i.test(x.t)||/^(search|submit|go)$/i.test(x.t)||/track\s+shipment|track\s+cargo|track\s+awb|search\s+shipment/i.test(x.t));if(target){target.e.click();return target.t;}return'';}).catch(()=> '');if(clicked){await Promise.race([page.waitForNetworkIdle({idleTime:900,timeout:10000}).catch(()=>{}),sleep(10000)]);await sleep(1200);}else await sleep(2500);}
    }

    let text='';for(const f of page.frames()){try{text+=`\n${await f.evaluate(()=>document.body?.innerText||'')}`;}catch{}}
    const screenshotBase64=await page.screenshot({type:'jpeg',quality:68,fullPage:false,encoding:'base64'}).catch(()=>null);
    const shipment=parseVisibleText(text,mawb,airline),arrivalSnippet=shipment.arrivalSnippet||'',arrivalSource=shipment.arrivalSource||'';delete shipment.arrivalSnippet;
    if(useful(shipment))return{ok:true,shipment,screenshotBase64,debug:{stage:'SUCCESS',url,filled:fill.filled,mode:fill.mode||'',value:fill.value||'',verified:Boolean(fill.verified),clicked,arrivalSource,arrivalSnippet,pageText:text.slice(0,7000),attempts:fill.attempts||[]}};
    return{ok:false,reason:'BROWSER OPENED AIRLINE PAGE BUT NO VERIFIED SHIPMENT FIELDS FOUND',officialTracker:url,screenshotBase64,pageText:text.slice(0,7000),debug:{stage:'NO_FIELDS',filled:fill.filled,mode:fill.mode||'',value:fill.value||'',verified:Boolean(fill.verified),clicked,arrivalSource,arrivalSnippet,pageText:text.slice(0,7000),attempts:fill.attempts||[]}};
  }catch(e){return{ok:false,reason:`BROWSER TRACKING ERROR: ${e?.message||e}`,officialTracker:url,debug:{stage:'ERROR'}};}finally{try{if(browser)await browser.close()}catch{}}
}

export async function inspectCathayFlightPage(flightNo='CX665',date='2026-09-01'){return{ok:false,reason:'CATHAY FLIGHT PAGE INSPECTION DISABLED IN COMPACT BROWSER TRACKER',flightNo,date};}
export async function trackCathayFlightStatus(flightNo='CX665',date='2026-09-01'){return{ok:false,reason:'CATHAY FLIGHT STATUS HELPER DISABLED IN COMPACT BROWSER TRACKER',flightNo,date};}