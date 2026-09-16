import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { normalizeMawb } from './airlines.js';

const HOME='https://www.iagcargo.com/en/home/';
const TRACK='https://www.iagcargo.com/iagcargo/portlet/en/html/601/main/search';
const AIRLINE={name:'British Airways / IAG Cargo',iata:'BA',url:'https://www.iagcargo.com/'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clean=v=>String(v||'').replace(/\s+/g,' ').trim();
const digitsOnly=v=>String(v||'').replace(/\D/g,'');
const pad=v=>String(v).padStart(2,'0');
const MONTH={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};

async function browserConfig(){
  for(const p of [process.env.CHROME_EXECUTABLE_PATH,'/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome','/usr/bin/google-chrome-stable'].filter(Boolean)){
    if(fs.existsSync(p))return{executablePath:p,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote']};
  }
  const mod=await import('@sparticuz/chromium');
  const chromium=mod.default||mod;
  chromium.setGraphicsMode=false;
  return{executablePath:await chromium.executablePath(),args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']};
}

function dateOnly(value='',fallbackYear=''){
  const s=clean(value);let m;
  m=s.match(/\b(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})\b/);if(m)return`${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m=s.match(/\b(\d{1,2})[-\/.](\d{1,2})[-\/.](20\d{2})\b/);if(m)return`${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  m=s.match(/\b(\d{1,2})[\s\-,]+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s\-,]+(20\d{2})\b/i);if(m)return`${m[3]}-${MONTH[m[2].slice(0,3).toUpperCase()]}-${pad(m[1])}`;
  m=s.match(/\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s\-,]+(\d{1,2})[\s\-,]+(20\d{2})\b/i);if(m)return`${m[3]}-${MONTH[m[1].slice(0,3).toUpperCase()]}-${pad(m[2])}`;
  if(fallbackYear){
    m=s.match(/\b(\d{1,2})[\s\-,]+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\b/i);if(m)return`${fallbackYear}-${MONTH[m[2].slice(0,3).toUpperCase()]}-${pad(m[1])}`;
    m=s.match(/\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s\-,]+(\d{1,2})\b/i);if(m)return`${fallbackYear}-${MONTH[m[1].slice(0,3).toUpperCase()]}-${pad(m[2])}`;
  }
  return'';
}
function timeOnly(value=''){
  let m=String(value||'').match(/\b(1[0-2]|0?\d):([0-5]\d)\s*(AM|PM)\b/i);
  if(m){let h=Number(m[1])%12;if(m[3].toUpperCase()==='PM')h+=12;return`${pad(h)}:${m[2]}`;}
  m=String(value||'').match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  return m?`${pad(m[1])}:${m[2]}`:'';
}
function yearFrom(text=''){
  return String(text).match(/\b(20\d{2})\b/)?.[1]||String(new Date().getUTCFullYear());
}
function first(text,patterns=[]){for(const rx of patterns){const m=String(text||'').match(rx);if(m?.[1])return clean(m[1]);}return'';}
function esc(value=''){return String(value).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}
function near(text='',token='',radius=420){
  const flat=clean(text),rx=token instanceof RegExp?token:new RegExp(esc(token),'i'),m=flat.match(rx);if(!m)return'';
  const at=m.index||0;return flat.slice(Math.max(0,at-radius),Math.min(flat.length,at+radius));
}
function airportNear(window=''){
  const w=clean(window).toUpperCase();
  return first(w,[/\b(?:STATION|AIRPORT|LOCATION|AT|TO|FROM)\s*[:\-]?\s*([A-Z]{3})\b/i,/\b([A-Z]{3})\b\s*(?:ARR|RCF|DEP|RCS|NFD|DLV)\b/i]).toUpperCase();
}
function eventWindow(text='',code=''){
  const flat=clean(text),rx=new RegExp(`\\b${esc(code)}\\b`,'ig'),matches=[...flat.matchAll(rx)];
  return matches.map(m=>{const at=m.index||0;return flat.slice(Math.max(0,at-260),Math.min(flat.length,at+520));});
}
function bestEvent(text='',codes=[],destination=''){
  const year=yearFrom(text),dest=String(destination||'').toUpperCase();
  const candidates=[];
  for(const code of codes){
    for(const w of eventWindow(text,code)){
      const station=airportNear(w);
      const d=dateOnly(w,year),t=timeOnly(w);
      const destMatch=!dest||!station||station===dest||new RegExp(`\\b${esc(dest)}\\b`,'i').test(w);
      if((d||t)&&destMatch)candidates.push({code,station,date:d,time:t,window:w});
    }
  }
  return candidates.at(-1)||null;
}

function parseIag(text='',mawb=''){
  const flat=clean(text),upper=flat.toUpperCase();
  if(!flat)return null;
  if(/AWB\s+INVALID|AIRWAY\s*BILL\s+NOT\s+FOUND|NO\s+(?:SHIPMENT|RESULT|RECORD)|NO\s+DATA/i.test(flat))return{notFound:true};
  const digits=digitsOnly(mawb),serial=digits.slice(3),pageDigits=digitsOnly(flat);
  if(!pageDigits.includes(digits)&&!pageDigits.includes(serial)&&!/TRACK(?:ING)?\s*(?:AND\s*TRACE|DETAILS|YOUR\s+SHIPMENT)|AIR\s*WAYBILL/i.test(flat))return null;

  let origin=first(flat,[/\bOrigin\b\s*[:\-]?\s*(?:[A-Za-z .'-]+\s*\()?([A-Z]{3})\)?/i,/\bFrom\b\s*[:\-]?\s*([A-Z]{3})\b/i]).toUpperCase();
  let destination=first(flat,[/\bDestination\b\s*[:\-]?\s*(?:[A-Za-z .'-]+\s*\()?([A-Z]{3})\)?/i,/\bTo\b\s*[:\-]?\s*([A-Z]{3})\b/i]).toUpperCase();
  const route=upper.match(/\b([A-Z]{3})\s*(?:→|->|—|–|\bTO\b)\s*([A-Z]{3})\b/);if(route){origin=origin||route[1];destination=destination||route[2];}

  let pieces=first(flat,[/\b(?:Pieces?|Pcs?|No\.?\s*of\s*Pieces|Piece\s*Count)\b\s*[:\-]?\s*(\d{1,6}(?:\s*\/\s*\d{1,6})?)/i,/\b(\d{1,6}(?:\s*\/\s*\d{1,6})?)\s*(?:PCS|PIECES?)\b/i]).replace(/\s+/g,'');
  let weight=first(flat,[/\b(?:Gross\s*Weight|Weight|Chargeable\s*Weight)\b\s*[:\-]?\s*([\d,.]+(?:\s*\/\s*[\d,.]+)?)\s*(?:KG|KGS|KILOGRAMS?)?/i,/\b([\d,.]+(?:\s*\/\s*[\d,.]+)?)\s*(?:KG|KGS)\b/i]).replace(/[\s,]+/g,'');
  let flightNo=first(upper,[/\b(BA\s*[- ]?\d{2,4})\b/]).replace(/[\s-]+/g,'');

  const year=yearFrom(flat);
  let bookingDate='';
  for(const token of [/\bBOOK(?:ED|ING)?\b/i,/\bRCS\b/i,/RECEIVED\s+FROM\s+SHIPPER/i,/\bACCEPTED\b/i]){
    const w=near(flat,token,340),d=dateOnly(w,year);if(d){bookingDate=d;break;}
  }

  const actual=bestEvent(flat,['ARR','RCF'],destination);
  const delivered=bestEvent(flat,['NFD','DLV'],destination);
  const departed=bestEvent(flat,['DEP'],destination);
  let arrivalDate=actual?.date||'',arrivalTime=actual?.time||'',arrivalIsActual=Boolean(actual&&(actual.date||actual.time)),arrivalSource=actual?.code||'';
  if(!arrivalDate&&!arrivalTime){
    for(const token of [/\bETA\b/i,/\bSTA\b/i,/EXPECTED\s+ARRIVAL/i,/SCHEDULED\s+ARRIVAL/i,/ARRIVAL\s+(?:DATE|TIME)/i]){
      const w=near(flat,token,380),d=dateOnly(w,year),t=timeOnly(w);if(d||t){arrivalDate=d;arrivalTime=t;arrivalIsActual=false;arrivalSource='ETA/STA';break;}
    }
  }

  let status='BOOKED';
  const finalArrival=Boolean(actual&&(arrivalIsActual)&&(!destination||!actual.station||actual.station===destination||new RegExp(`\\b${esc(destination)}\\b`,'i').test(actual.window)));
  const finalDelivery=Boolean(delivered&&(!destination||!delivered.station||delivered.station===destination||new RegExp(`\\b${esc(destination)}\\b`,'i').test(delivered.window)));
  if(finalDelivery||finalArrival)status='ARRIVED';
  else if(/\bOFFLOAD(?:ED)?\b|\bDELAY(?:ED)?\b|\bSHORT\s*SHIP(?:PED)?\b|\bEXCEPTION\b/i.test(flat))status='DELAYED';
  else if(departed||/\bDEPARTED\b|\bIN\s+TRANSIT\b|\bAIRBORNE\b|\bIN\s+FLIGHT\b/i.test(flat))status='IN TRANSIT';
  else if(/\bRCS\b|RECEIVED\s+FROM\s+SHIPPER|\bACCEPTED\b|\bMANIFEST(?:ED)?\b|\bBOOKED\b/i.test(flat))status='BOOKED';

  if(!flightNo){const all=[...upper.matchAll(/\bBA\s*[- ]?(\d{2,4})\b/g)];if(all.length)flightNo=`BA${all.at(-1)[1]}`;}
  if(!origin||!destination){
    const stations=[...upper.matchAll(/\b(?:RCS|DEP|ARR|RCF|NFD|DLV)\b[^A-Z0-9]{0,25}([A-Z]{3})\b/g)].map(m=>m[1]).filter(x=>!['THE','AND','FOR','PCS','KGS','AWB'].includes(x));
    if(stations.length){origin=origin||stations[0];destination=destination||stations.at(-1);}
  }
  const useful=Boolean((origin&&destination)||pieces||weight||flightNo||bookingDate||arrivalDate||arrivalTime||status!=='BOOKED'||/\bRCS\b|\bMANIFEST(?:ED)?\b|\bBOOKED\b/i.test(flat));
  if(!useful)return null;
  return{shipment:{mawb,carrierCode:'BA',airlineName:AIRLINE.name,officialTracker:AIRLINE.url,origin,destination,bags:pieces,pieces,weight,flightNo,bookingDate,arrivalDate,arrivalTime,arrivalIsActual,status,arrivalSource,source:'IAG Cargo official Track & Trace'}};
}

async function pageText(page){
  const parts=[];for(const frame of page.frames()){try{const t=await frame.evaluate(()=>document.body?.innerText||'');if(t)parts.push(t);}catch{}}
  return parts.join('\n');
}
async function acceptCookies(page){
  for(const frame of page.frames()){
    try{await frame.evaluate(()=>{const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>20&&r.height>10};const b=[...document.querySelectorAll('button,[role="button"],a')].filter(visible).find(x=>/accept all|accept cookies|allow all|agree/i.test((x.innerText||x.textContent||'').trim()));b?.click();});}catch{}
  }
}
async function fillAndSubmit(page,mawb){
  const prefix=mawb.slice(0,3),serial=mawb.slice(4),digits=digitsOnly(mawb);
  for(const frame of page.frames()){
    try{
      const result=await frame.evaluate(({mawb,prefix,serial,digits})=>{
        const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>20&&r.height>10&&!e.disabled};
        const set=(e,v)=>{const proto=e instanceof HTMLInputElement?HTMLInputElement.prototype:HTMLTextAreaElement.prototype;const d=Object.getOwnPropertyDescriptor(proto,'value');d?.set?.call(e,v);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));};
        const p=document.querySelector('#awb_cia,input[name="awb_cia"]');
        const n=document.querySelector('#awb_cod,input[name="awb_cod"]');
        let mode='';
        if(p&&n&&visible(p)&&visible(n)){set(p,prefix);set(n,serial);mode='legacy-split';}
        else{
          const inputs=[...document.querySelectorAll('input')].filter(visible).filter(e=>!['hidden','checkbox','radio','submit','button'].includes((e.type||'text').toLowerCase()));
          const desc=e=>`${e.id||''} ${e.name||''} ${e.placeholder||''} ${e.getAttribute('aria-label')||''} ${e.getAttribute('title')||''}`.toLowerCase();
          const best=inputs.map(e=>({e,score:(/awb|air\s*waybill|airway|shipment|tracking/.test(desc(e))?8:0)+(/xxx|yyyy|number|no/.test(desc(e))?3:0)})).sort((a,b)=>b.score-a.score)[0];
          if(!best?.e||best.score<5)return{filled:false,mode:'no-input'};
          const placeholder=String(best.e.placeholder||'');
          const value=/xxx[-\s]?yyyy/i.test(placeholder)?mawb:mawb;
          set(best.e,value);mode='single';
        }
        const els=[...document.querySelectorAll('button,input[type="submit"],input[type="button"],a,[role="button"]')].filter(visible);
        const label=e=>(e.innerText||e.value||e.textContent||e.getAttribute('aria-label')||e.getAttribute('title')||'').replace(/\s+/g,' ').trim();
        const b=els.find(e=>/^search$/i.test(label(e))||/^track(?:\s+shipment)?$/i.test(label(e))||/track\s+shipment|track\s+your\s+shipment/i.test(label(e)));
        if(b){b.click();return{filled:true,clicked:label(b),mode};}
        const form=(n||p)?.form||document.querySelector('form');
        if(form){form.requestSubmit?.();return{filled:true,clicked:'form.requestSubmit',mode};}
        return{filled:true,clicked:'',mode};
      },{mawb,prefix,serial,digits});
      if(result?.filled)return{...result,frame:frame.url()};
    }catch{}
  }
  return{filled:false,mode:'no-frame-input'};
}

export async function trackBritish(input){
  const mawb=normalizeMawb(input);if(!mawb||!mawb.startsWith('125-'))return{ok:false,reason:'INVALID BRITISH AIRWAYS MAWB'};
  let browser;const network=[];
  try{
    const cfg=await browserConfig();
    browser=await puppeteer.launch({headless:'shell',executablePath:cfg.executablePath,args:cfg.args,defaultViewport:{width:1440,height:1100,deviceScaleFactor:1}});
    const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({'Accept-Language':'en-GB,en;q=0.9'});
    await page.evaluateOnNewDocument(()=>{try{Object.defineProperty(navigator,'webdriver',{get:()=>undefined});}catch{}try{window.chrome=window.chrome||{runtime:{}};}catch{}});
    page.on('response',async response=>{try{const u=response.url(),ct=(response.headers()['content-type']||'').toLowerCase();if(!/(json|text|html|javascript|xml)/.test(ct)&&!/track|shipment|awb|cargo|event|status/i.test(u))return;const body=await response.text();if(!body||body.length>300000)return;const serial=digitsOnly(mawb).slice(3);if(body.includes(serial)||/\b(?:RCS|DEP|ARR|RCF|NFD|DLV)\b|air\s*waybill|shipment|pieces|weight|flight/i.test(body))network.push({url:u,status:response.status(),body:body.slice(0,140000)});}catch{}});

    let opened='';
    for(const url of [HOME,TRACK]){
      try{await page.goto(url,{waitUntil:'domcontentloaded',timeout:26000});opened=url;await sleep(2600);await acceptCookies(page);await sleep(500);const before=await pageText(page);if(/captcha|verify you are human|security check|cloudflare|turnstile|access denied/i.test(before))return{ok:false,reason:'IAG CARGO SECURITY/CAPTCHA REQUIRES MANUAL CHECK',officialTracker:AIRLINE.url,debug:{stage:'CAPTCHA',url}};const fill=await fillAndSubmit(page,mawb);if(!fill.filled)continue;await Promise.race([page.waitForNetworkIdle({idleTime:900,timeout:12000}).catch(()=>{}),sleep(12000)]);await sleep(1600);let text=await pageText(page);if(network.length)text+=`\nIAG_NETWORK_CAPTURE\n${network.map(x=>x.body).join('\n')}`;const parsed=parseIag(text,mawb);const shot=await page.screenshot({type:'jpeg',quality:68,fullPage:false,encoding:'base64'}).catch(()=>null);if(parsed?.notFound)return{ok:false,reason:'IAG CARGO RETURNED NO SHIPMENT RECORD',officialTracker:AIRLINE.url,screenshotBase64:shot,debug:{stage:'NOT_FOUND',url:page.url(),fill,pageText:text.slice(0,7000),network:network.slice(-10).map(x=>({url:x.url,status:x.status,sample:x.body.slice(0,1200)}))}};if(parsed?.shipment)return{ok:true,shipment:parsed.shipment,officialTracker:AIRLINE.url,screenshotBase64:shot,screenshotCaptured:Boolean(shot),screenshotVerified:Boolean(shot),debug:{stage:'SUCCESS',url:page.url(),opened,fill,pageText:text.slice(0,7000),network:network.slice(-12).map(x=>({url:x.url,status:x.status,sample:x.body.slice(0,1200)}))}};
      }catch{}
    }
    const text=await pageText(page).catch(()=> '');
    const shot=await page.screenshot({type:'jpeg',quality:68,fullPage:false,encoding:'base64'}).catch(()=>null);
    return{ok:false,reason:'IAG CARGO OPENED BUT NO VERIFIED BA SHIPMENT FIELDS FOUND',officialTracker:AIRLINE.url,screenshotBase64:shot,debug:{stage:'NO_FIELDS',url:page.url(),opened,pageText:text.slice(0,7000),network:network.slice(-12).map(x=>({url:x.url,status:x.status,sample:x.body.slice(0,1200)}))}};
  }catch(e){return{ok:false,reason:`BRITISH AIRWAYS TRACKING ERROR: ${e?.message||e}`,officialTracker:AIRLINE.url,debug:{stage:'ERROR'}};}finally{try{if(browser)await browser.close()}catch{}}
}
