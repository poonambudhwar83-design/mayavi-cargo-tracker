import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { normalizeMawb } from './airlines.js';

const OFFICIAL='https://www.qrcargo.com/s/track-your-shipment';
const AIRLINE={name:'Qatar Airways Cargo',iata:'QR',url:OFFICIAL};
const MONTHS={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
const pad=v=>String(v).padStart(2,'0');
const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
const first=(s,rx)=>(String(s).match(rx)||[])[1]||'';
function officialUrl(mawb=''){const serial=String(mawb).slice(4);return `${OFFICIAL}?documentNumber=${encodeURIComponent(serial)}&documentPrefix=157&documentType=MAWB`;}
function parseDate(segment=''){
  const s=String(segment).toUpperCase();let m=s.match(/(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})/);if(m)return`${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m=s.match(/(\d{1,2})[-\/.](\d{1,2})[-\/.](20\d{2})/);if(m)return`${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  m=s.match(/(\d{1,2})[\s\-]+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s\-,]+(20\d{2})/);if(m)return`${m[3]}-${MONTHS[m[2]]}-${pad(m[1])}`;
  m=s.match(/(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s\-]+(\d{1,2})[\s\-,]+(20\d{2})/);if(m)return`${m[3]}-${MONTHS[m[1]]}-${pad(m[2])}`;return'';
}
function parseTime(s=''){const m=String(s).match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);return m?`${pad(m[1])}:${m[2]}`:'';}
function statusFromText(text=''){
  const s=String(text).toUpperCase();
  if(/\bDLV\b|DELIVERED/.test(s))return'DELIVERED';
  if(/\bRCF\b|RECEIVED FROM FLIGHT|\bARRIVED\b|\bLANDED\b|ACTUAL ARRIVAL/.test(s))return'ARRIVED';
  if(/DELAY|LATE|OFFLOAD|SHORT SHIP|EXCEPTION/.test(s))return'DELAYED';
  if(/\bDEP\b|DEPARTED|IN TRANSIT|AIRBORNE|IN FLIGHT/.test(s))return'IN TRANSIT';
  if(/\bRCS\b|BOOKED|ACCEPTED|RECEIVED FROM SHIPPER/.test(s))return'BOOKED';
  return'TRACKING';
}
function dateCandidates(segment=''){
  const s=String(segment),out=[];
  for(const m of s.matchAll(/\b(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})\b/g))out.push({date:`${m[1]}-${pad(m[2])}-${pad(m[3])}`,index:m.index||0});
  for(const m of s.matchAll(/\b(\d{1,2})[-\/.](\d{1,2})[-\/.](20\d{2})\b/g))out.push({date:`${m[3]}-${pad(m[2])}-${pad(m[1])}`,index:m.index||0});
  for(const m of s.matchAll(/\b(\d{1,2})[\s\-]+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[A-Za-z]*[\s\-,]+(20\d{2})\b/gi))out.push({date:`${m[3]}-${MONTHS[m[2].slice(0,3).toUpperCase()]}-${pad(m[1])}`,index:m.index||0});
  return out;
}
function timeCandidates(segment=''){const out=[];for(const m of String(segment).matchAll(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g))out.push({time:`${pad(m[1])}:${m[2]}`,index:m.index||0});return out;}
function nearest(items=[],anchor=0,key='date'){if(!items.length)return'';return [...items].sort((a,b)=>Math.abs(a.index-anchor)-Math.abs(b.index-anchor))[0]?.[key]||'';}
function arrivalFromText(text='',flightNo=''){
  const flat=clean(text),hits=[...flat.matchAll(/actual\s+arrival|estimated\s+arrival|scheduled\s+arrival|arrival\s+date|arrival\s+time|\barrived\b|\blanded\b|received\s+from\s+flight|\bRCF\b/ig)];
  let best=null;
  for(const h of hits){const center=h.index||0,start=Math.max(0,center-300),window=flat.slice(start,Math.min(flat.length,center+450)),a=center-start,d=nearest(dateCandidates(window),a,'date'),t=nearest(timeCandidates(window),a,'time'),actual=/actual|arrived|landed|received\s+from\s+flight|\bRCF\b/i.test(h[0]),score=(d?8:0)+(t?4:0)+(actual?5:0);if((d||t)&&(!best||score>best.score))best={arrivalDate:d,arrivalTime:t,arrivalIsActual:actual,status:actual?'ARRIVED':'',score,snippet:window.slice(0,700)};}
  if((!best?.arrivalDate||!best?.arrivalTime)&&flightNo){const esc=String(flightNo).replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),m=new RegExp(`\\b${esc}\\b`,'i').exec(flat);if(m){const start=Math.max(0,(m.index||0)-350),window=flat.slice(start,Math.min(flat.length,(m.index||0)+650)),ds=dateCandidates(window),ts=timeCandidates(window),arrived=/\barrived\b|\blanded\b|actual\s+arrival|received\s+from\s+flight|\bRCF\b/i.test(window),d=ds.at(-1)?.date||'',t=ts.at(-1)?.time||'';if(d||t)best={arrivalDate:d,arrivalTime:t,arrivalIsActual:arrived,status:arrived?'ARRIVED':'',score:10,snippet:window.slice(0,700)};}}
  return best||{arrivalDate:'',arrivalTime:'',arrivalIsActual:false,status:'',snippet:''};
}
function parseShipment(text,mawb){
  const flat=clean(text),upper=flat.toUpperCase();
  const route=upper.match(/\bORIGIN\b\s*[:\-]?\s*([A-Z]{3})\b[\s\S]{0,180}?\bDESTINATION\b\s*[:\-]?\s*([A-Z]{3})\b/)||upper.match(/\bFROM\b\s*[:\-]?\s*([A-Z]{3})\b[\s\S]{0,180}?\bTO\b\s*[:\-]?\s*([A-Z]{3})\b/)||upper.match(/\b([A-Z]{3})\s*(?:→|->|—|-)\s*([A-Z]{3})\b/);
  const origin=route?.[1]||'',destination=route?.[2]||'';
  const pieces=first(flat,/(?:Pieces?|Pcs?|No\.?\s*of\s*Pieces|Piece Count)\s*[:\-]?\s*(\d{1,6})/i)||first(flat,/\b(\d{1,6})\s*(?:PCS|PIECES?)\b/i);
  const weight=(first(flat,/(?:Gross\s*Weight|Chargeable\s*Weight|Weight)\s*[:\-]?\s*([\d,.]+)\s*(?:KG|KGS)?/i)||first(flat,/\b([\d,.]+)\s*(?:KG|KGS)\b/i)).replace(/,/g,'');
  const fm=upper.match(/\bQR\s*[- ]?(\d{2,4})\b/),flightNo=fm?`QR${fm[1]}`:'';
  const arr=arrivalFromText(flat,flightNo);let status=statusFromText(flat);if(arr.status)status=arr.status;
  return{mawb,carrierCode:'QR',airlineName:AIRLINE.name,origin,destination,bags:pieces,pieces,weight,flightNo,arrivalDate:arr.arrivalDate,arrivalTime:arr.arrivalTime,arrivalIsActual:arr.arrivalIsActual,status,officialTracker:officialUrl(mawb),source:'Qatar Cargo dedicated official browser adapter',arrivalEvidence:arr.snippet};
}
function useful(s={}){return Boolean((s.origin&&s.destination)||s.pieces||s.weight||s.flightNo||s.arrivalDate||s.arrivalTime||(s.status&&s.status!=='TRACKING'));}
async function launch(){chromium.setGraphicsMode=false;return puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox'],defaultViewport:{width:1440,height:1100,deviceScaleFactor:1},executablePath:await chromium.executablePath(),headless:'shell'});}
async function acceptCookies(page){
  await page.evaluate(()=>{const els=[...document.querySelectorAll('button,[role="button"]')];const b=els.find(e=>/accept all|accept cookies|allow all|agree/i.test((e.innerText||e.getAttribute('aria-label')||'').trim()));if(b)b.click();}).catch(()=>{});
}

export async function trackQatar(input){
  const mawb=normalizeMawb(input);if(!mawb||!mawb.startsWith('157-'))return{ok:false,reason:'INVALID QATAR AIRWAYS CARGO MAWB',airline:AIRLINE,officialTracker:OFFICIAL};
  const url=officialUrl(mawb),serial=mawb.slice(4);let browser;
  try{
    browser=await launch();const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36');
    await page.goto(url,{waitUntil:'domcontentloaded',timeout:18000});await new Promise(r=>setTimeout(r,1800));
    await acceptCookies(page);await new Promise(r=>setTimeout(r,300));

    const setup=await page.evaluate(({serial})=>{
      const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>20&&r.height>10&&!e.disabled};
      const inputs=[...document.querySelectorAll('input')].filter(visible);
      const desc=e=>`${e.name||''} ${e.id||''} ${e.placeholder||''} ${e.getAttribute('aria-label')||''}`.toLowerCase();
      const set=(e,v)=>{const d=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');d?.set?.call(e,v);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));};
      const prefix=inputs.find(e=>/prefix/.test(desc(e)));
      let num=inputs.find(e=>/document|awb|airway|shipment/.test(desc(e))&&!/prefix/.test(desc(e)));
      if(!num)num=inputs.find(e=>String(e.value||'').replace(/\D/g,'').includes(serial));
      if(prefix&&String(prefix.value||'')!=='157')set(prefix,'157');
      if(num&&String(num.value||'').replace(/\D/g,'')!==serial)set(num,serial);
      return{hasNumber:Boolean(num),numberValue:num?.value||'',prefixValue:prefix?.value||'',inputCount:inputs.length};
    },{serial}).catch(()=>({hasNumber:false}));

    const clicked=await page.evaluate(()=>{
      const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>20&&r.height>10&&!e.disabled};
      const els=[...document.querySelectorAll('button,input[type="submit"],[role="button"]')].filter(visible);
      const label=e=>(e.innerText||e.value||e.getAttribute('aria-label')||e.getAttribute('title')||'').replace(/\s+/g,' ').trim();
      const candidates=els.map(e=>({e,t:label(e)}));
      const target=candidates.find(x=>/^track\s*shipment\s*\(?s\)?$/i.test(x.t))||candidates.find(x=>/track\s*shipment/i.test(x.t))||candidates.find(x=>/^track$/i.test(x.t));
      if(target){target.e.scrollIntoView({block:'center'});target.e.click();return target.t;}return'';
    }).catch(()=> '');

    if(clicked){await Promise.race([page.waitForNetworkIdle({idleTime:800,timeout:9000}).catch(()=>{}),new Promise(r=>setTimeout(r,9000))]);await new Promise(r=>setTimeout(r,1400));}
    else if(setup.hasNumber){await page.keyboard.press('Enter').catch(()=>{});await new Promise(r=>setTimeout(r,5000));}

    const text=await page.evaluate(()=>document.body?.innerText||'').catch(()=> '');
    if(/captcha|verify you are human|security check|cloudflare|turnstile|access denied/i.test(text))return{ok:false,reason:'QATAR SECURITY CHECK REQUIRES MANUAL CHECK',airline:AIRLINE,officialTracker:url,debug:{stage:'CAPTCHA',setup,clicked}};
    const shipment=parseShipment(text,mawb),screenshotBase64=await page.screenshot({type:'jpeg',quality:65,fullPage:false,encoding:'base64'}).catch(()=>null);
    if(useful(shipment))return{ok:true,airline:AIRLINE,shipment,screenshotCaptured:Boolean(screenshotBase64),screenshotVerified:Boolean(screenshotBase64),screenshotBase64,debug:{stage:'SUCCESS',url,setup,clicked,arrivalEvidence:shipment.arrivalEvidence||'',textSample:clean(text).slice(0,5000)}};
    return{ok:false,reason:'QATAR OFFICIAL PAGE RETURNED NO VERIFIED SHIPMENT DATA',airline:AIRLINE,officialTracker:url,screenshotBase64,debug:{stage:'NO_DATA',setup,clicked,textSample:clean(text).slice(0,5000)}};
  }catch(e){return{ok:false,reason:`QATAR TRACKING ERROR: ${e?.message||e}`,airline:AIRLINE,officialTracker:url,debug:{stage:'ERROR'}};}
  finally{try{if(browser)await browser.close()}catch{}}
}
