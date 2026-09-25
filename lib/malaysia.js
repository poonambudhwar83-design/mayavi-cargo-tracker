import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { normalizeMawb } from './airlines.js';

const OFFICIAL='https://www.maskargo.com/en/home.html';
const MONTH={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
const pad=v=>String(v).padStart(2,'0');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clean=s=>String(s||'').replace(/\s+/g,' ').trim();

function parseDate(v=''){
  const s=String(v||'').toUpperCase();
  let m=s.match(/\b(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})\b/);if(m)return`${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m=s.match(/\b(\d{1,2})[-\/.](\d{1,2})[-\.\/](20\d{2})\b/);if(m)return`${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  m=s.match(/\b(\d{1,2})[\s\-,]+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s\-,]+(20\d{2})\b/);if(m)return`${m[3]}-${MONTH[m[2]]}-${pad(m[1])}`;
  m=s.match(/\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s\-,]+(\d{1,2})[\s\-,]+(20\d{2})\b/);if(m)return`${m[3]}-${MONTH[m[1]]}-${pad(m[2])}`;
  return'';
}
function parseTime(v=''){
  const s=String(v||'').toUpperCase();
  let m=s.match(/\b(1[0-2]|0?\d):([0-5]\d)\s*(AM|PM)\b/);
  if(m){let h=Number(m[1]);if(m[3]==='PM'&&h<12)h+=12;if(m[3]==='AM'&&h===12)h=0;return`${pad(h)}:${m[2]}`;}
  m=s.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);return m?`${pad(m[1])}:${m[2]}`:'';
}
function station(v=''){return String(v||'').toUpperCase().match(/\b[A-Z]{3}\b/)?.[0]||'';}
function flight(v=''){const m=String(v||'').toUpperCase().match(/\bMH\s*[- ]?(\d{1,4})\b/);return m?`MH${m[1]}`:'';}
function eventWindow(text,labelRx){
  const flat=clean(text),hits=[...flat.matchAll(labelRx)];if(!hits.length)return'';
  const at=hits.at(-1).index||0;return flat.slice(Math.max(0,at-180),Math.min(flat.length,at+520));
}
function statusFrom(text=''){
  const s=String(text||'').toUpperCase();
  if(/DELIVERED|\bDLV\b/.test(s))return'DELIVERED';
  if(/ARRIVED|RECEIVED FROM FLIGHT|\bRCF\b|LANDED/.test(s))return'ARRIVED';
  if(/DELAY|LATE|OFFLOAD|SHORT SHIP|EXCEPTION/.test(s))return'DELAYED';
  if(/DEPARTED|\bDEP\b|AIRBORNE|IN FLIGHT|IN TRANSIT|UPLIFTED/.test(s))return'IN TRANSIT';
  if(/BOOKED|ACCEPTED|RECEIVED FROM SHIPPER|\bRCS\b|MANIFESTED/.test(s))return'BOOKED';
  return'TRACKING';
}
function parseShipment(text,mawb){
  const flat=clean(text),upper=flat.toUpperCase(),serial=mawb.slice(4),digits=mawb.replace(/\D/g,'');
  if(!flat||/NO (?:SHIPMENT|RECORD|AWB).*FOUND|INVALID (?:AWB|AIRWAY)|NO DATA FOUND/i.test(flat))return null;
  if(!(flat.includes(serial)||flat.replace(/\D/g,'').includes(digits)))return null;

  let origin='',destination='';
  let route=upper.match(/\bORIGIN\b\s*[:\-]?\s*([A-Z]{3})\b[\s\S]{0,180}?\bDESTINATION\b\s*[:\-]?\s*([A-Z]{3})\b/)
    ||upper.match(/\bFROM\b\s*[:\-]?\s*([A-Z]{3})\b[\s\S]{0,180}?\bTO\b\s*[:\-]?\s*([A-Z]{3})\b/)
    ||upper.match(/\b([A-Z]{3})\s*(?:→|->|–|—)\s*([A-Z]{3})\b/);
  if(route){origin=route[1];destination=route[2];}

  const pieces=(flat.match(/(?:Pieces?|Pcs?|No\.?\s*of\s*Pieces|Total\s*Pieces)\s*[:#\-]?\s*(\d{1,6})/i)||flat.match(/\b(\d{1,6})\s*(?:PCS|PIECES?)\b/i)||[])[1]||'';
  const weight=((flat.match(/(?:Gross\s*Weight|Chargeable\s*Weight|Total\s*Weight|\bWeight\b)\s*[:#\-]?\s*([\d,.]+)\s*(?:KG|KGS)?/i)||flat.match(/\b([\d,.]+)\s*(?:KG|KGS)\b/i)||[])[1]||'').replace(/,/g,'');
  const flights=[...upper.matchAll(/\bMH\s*[- ]?(\d{1,4})\b/g)].map(m=>`MH${m[1]}`);
  const flightNo=flights.at(-1)||'';

  const bookingWin=eventWindow(flat,/BOOKED|BOOKING|RECEIVED FROM SHIPPER|\bRCS\b/ig);
  const departureWin=eventWindow(flat,/DEPARTED|\bDEP\b|AIRBORNE|UPLIFTED/ig);
  const actualArrivalWin=eventWindow(flat,/ARRIVED|RECEIVED FROM FLIGHT|\bRCF\b|LANDED|DELIVERED/ig);
  const estimatedArrivalWin=eventWindow(flat,/ETA|EXPECTED ARRIVAL|ESTIMATED ARRIVAL|SCHEDULED ARRIVAL/ig);

  const bookingDate=parseDate(bookingWin);
  const departureDate=parseDate(departureWin),departureTime=parseTime(departureWin);
  let arrivalDate=parseDate(actualArrivalWin),arrivalTime=parseTime(actualArrivalWin),arrivalIsActual=Boolean(arrivalDate||arrivalTime);
  if(!arrivalIsActual){arrivalDate=parseDate(estimatedArrivalWin);arrivalTime=parseTime(estimatedArrivalWin);}
  const status=statusFrom(flat);

  if(!origin||!destination){
    const nearAwb=flat.slice(Math.max(0,flat.indexOf(serial)-500),Math.max(0,flat.indexOf(serial)-500)+1800).toUpperCase();
    route=nearAwb.match(/\b([A-Z]{3})\s*(?:-|→|->|–|—|TO)\s*([A-Z]{3})\b/);
    if(route){origin=origin||route[1];destination=destination||route[2];}
  }

  const useful=Boolean((origin&&destination)||pieces||weight||flightNo||bookingDate||departureDate||arrivalDate||arrivalTime||status!=='TRACKING');
  if(!useful)return null;
  return{
    mawb,carrierCode:'MH',airlineName:'Malaysia Airlines Cargo / MASkargo',
    origin,destination,pieces,bags:pieces,weight,flightNo,bookingDate,
    departureDate,departureTime,departureIsActual:Boolean(departureDate||departureTime),
    arrivalDate,arrivalTime,arrivalIsActual,status,
    officialTracker:OFFICIAL,source:'MASkargo official shipment tracking'
  };
}
async function launch(){
  chromium.setGraphicsMode=false;
  return puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox','--disable-blink-features=AutomationControlled'],defaultViewport:{width:1440,height:1200,deviceScaleFactor:1},executablePath:await chromium.executablePath(),headless:'shell'});
}
async function acceptCookies(page){
  for(const frame of page.frames()){try{await frame.evaluate(()=>{const txt=e=>(e?.innerText||e?.value||e?.getAttribute?.('aria-label')||'').replace(/\s+/g,' ').trim();const b=[...document.querySelectorAll('button,a,[role="button"]')].find(e=>/accept all|accept cookies|allow all|agree/i.test(txt(e)));if(b)b.click();});}catch{}}
}
async function clickShipmentTracking(page){
  for(const frame of page.frames()){try{
    const clicked=await frame.evaluate(()=>{const txt=e=>(e?.innerText||e?.textContent||e?.value||e?.getAttribute?.('aria-label')||'').replace(/\s+/g,' ').trim();const els=[...document.querySelectorAll('button,a,[role="button"],div,span')];const target=els.find(e=>/^shipment tracking$/i.test(txt(e)))||els.find(e=>/track your shipment/i.test(txt(e)));if(!target)return'';let clickable=target.closest('a,button,[role="button"]')||target;clickable.click();return txt(target);});
    if(clicked)return clicked;
  }catch{}}
  return'';
}
async function fillAndSubmit(page,prefix,serial){
  const attempts=[{prefix,awb:serial},{prefix:'',awb:`${prefix}-${serial}`},{prefix:'',awb:`${prefix}${serial}`}];
  for(const attempt of attempts){
    for(const frame of page.frames()){try{
      const fill=await frame.evaluate(({prefix,awb})=>{
        const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>18&&r.height>10&&!e.disabled};
        const inputs=[...document.querySelectorAll('input,textarea')].filter(visible).filter(e=>!['hidden','checkbox','radio','submit','button'].includes((e.type||'text').toLowerCase()));
        const desc=e=>`${e.name||''} ${e.id||''} ${e.placeholder||''} ${e.getAttribute('aria-label')||''} ${e.getAttribute('title')||''}`.toLowerCase();
        const set=(e,v)=>{if(!e)return;const p=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;const d=Object.getOwnPropertyDescriptor(p,'value');d?.set?.call(e,v);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));};
        const p=inputs.find(e=>/prefix|airline\s*code/.test(desc(e)));
        let a=inputs.find(e=>/(awb|airway|shipment|tracking).*(number|no|serial)|awb|airway bill/.test(desc(e))&&!/prefix|airline\s*code/.test(desc(e)));
        if(!a)a=inputs.find(e=>e!==p);
        if(!a)return{ok:false,count:inputs.length};
        if(prefix&&p)set(p,prefix);set(a,awb);return{ok:true,prefixFound:Boolean(p),awbValue:a.value||'',prefixValue:p?.value||'',count:inputs.length};
      },attempt);
      if(!fill.ok)continue;
      const clicked=await frame.evaluate(()=>{const txt=e=>(e?.innerText||e?.value||e?.textContent||e?.getAttribute?.('aria-label')||'').replace(/\s+/g,' ').trim();const els=[...document.querySelectorAll('button,input[type="submit"],a,[role="button"]')];const b=els.find(e=>/^track$/i.test(txt(e))||/^search$/i.test(txt(e))||/^submit$/i.test(txt(e))||/track shipment|shipment tracking|track cargo|search shipment/i.test(txt(e)));if(!b)return'';b.click();return txt(b);});
      if(clicked||fill.ok)return{fill,clicked,attempt,frameUrl:frame.url()};
    }catch{}}
  }
  return null;
}
async function extract(page,network=[]){
  const texts=[];for(const frame of page.frames()){try{const t=await frame.evaluate(()=>document.body?.innerText||'');if(t)texts.push(t);}catch{}}
  for(const n of network){if(n?.body)texts.push(n.body)}
  return texts.join('\n');
}

export async function trackMalaysia(input){
  const mawb=normalizeMawb(input);if(!mawb||!mawb.startsWith('232-'))return{ok:false,reason:'INVALID MALAYSIA AIRLINES MAWB',officialTracker:OFFICIAL};
  const prefix='232',serial=mawb.slice(4),digits=mawb.replace(/\D/g,'');let browser,lastDebug={};
  try{
    browser=await launch();const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36');
    const network=[];
    page.on('response',async response=>{try{const u=response.url(),ct=(response.headers()['content-type']||'').toLowerCase();if(!/(json|text|javascript|xml)/.test(ct)&&!/track|shipment|awb|cargo|event|status/i.test(u))return;const body=await response.text();if(!body||body.length>220000)return;if(body.includes(serial)||body.replace(/\D/g,'').includes(digits)||/awb|shipment|flight|pieces|weight|arrival|departure/i.test(body))network.push({url:u,status:response.status(),body:body.slice(0,100000)});}catch{}});
    await page.goto(OFFICIAL,{waitUntil:'domcontentloaded',timeout:30000});
    await sleep(2200);await acceptCookies(page);await sleep(400);
    const tile=await clickShipmentTracking(page);if(tile)await sleep(1000);
    const submitted=await fillAndSubmit(page,prefix,serial);
    if(!submitted)return{ok:false,reason:'MASKARGO SHIPMENT TRACKING FORM NOT FOUND',officialTracker:OFFICIAL,debug:{stage:'FORM_NOT_FOUND',tile,frames:page.frames().map(f=>f.url())}};
    await Promise.race([page.waitForNetworkIdle({idleTime:900,timeout:12000}).catch(()=>{}),sleep(9000)]);await sleep(900);
    const text=await extract(page,network),shipment=parseShipment(text,mawb);
    lastDebug={stage:'MASKARGO_RESULT',tile,submitted,resultUrl:page.url(),network:network.map(x=>({url:x.url,status:x.status,sample:clean(x.body).slice(0,800)})).slice(-10),textSample:clean(text).slice(0,7000)};
    if(!shipment)return{ok:false,reason:'MASKARGO RETURNED NO VERIFIED SHIPMENT DATA',officialTracker:OFFICIAL,debug:lastDebug};
    const screenshotBase64=await page.screenshot({type:'jpeg',quality:68,fullPage:false,encoding:'base64'}).catch(()=>null);
    return{ok:true,shipment,screenshotBase64,screenshotCaptured:Boolean(screenshotBase64),screenshotVerified:true,debug:lastDebug};
  }catch(e){return{ok:false,reason:`MALAYSIA AIRLINES TRACKING ERROR: ${e?.message||e}`,officialTracker:OFFICIAL,debug:{...lastDebug,stage:'ERROR'}};}
  finally{try{if(browser)await browser.close()}catch{}}
}
