import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { airlineForMawb, normalizeMawb } from './airlines.js';

const MONTHS={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
const pad=v=>String(v).padStart(2,'0');
const first=(s,rx)=>(String(s).match(rx)||[])[1]||'';

function parseDate(segment=''){
  const s=String(segment).toUpperCase();let m=s.match(/(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})/);if(m)return`${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m=s.match(/(\d{1,2})[-\/.](\d{1,2})[-\/.](20\d{2})/);if(m)return`${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  m=s.match(/(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s+(20\d{2})/);if(m)return`${m[3]}-${MONTHS[m[2]]}-${pad(m[1])}`;
  m=s.match(/(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s+(\d{1,2}),?\s+(20\d{2})/);if(m)return`${m[3]}-${MONTHS[m[1]]}-${pad(m[2])}`;return'';
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
function parseVisibleText(text,mawb,airline){
  const flat=String(text||'').replace(/\s+/g,' ').trim(), upper=flat.toUpperCase(), iata=String(airline?.iata||'').toUpperCase();
  let route=upper.match(/\bORIGIN\b\s*[:\-]?\s*([A-Z]{3})\b[\s\S]{0,120}?\bDESTINATION\b\s*[:\-]?\s*([A-Z]{3})\b/)
    ||upper.match(/\bFROM\b\s*[:\-]?\s*([A-Z]{3})\b[\s\S]{0,120}?\bTO\b\s*[:\-]?\s*([A-Z]{3})\b/)
    ||upper.match(/\b([A-Z]{3})\s*(?:→|->|—|-)\s*([A-Z]{3})\b/);
  const origin=route?.[1]||'',destination=route?.[2]||'';
  const pieces=first(flat,/(?:Pieces?|Pcs?|No\.?\s*of\s*Pieces|Piece Count)\s*[:\-]?\s*(\d{1,6})/i)||first(flat,/\b(\d{1,6})\s*(?:PCS|PIECES?)\b/i);
  const weight=(first(flat,/(?:Gross\s*Weight|Chargeable\s*Weight|Weight)\s*[:\-]?\s*([\d,.]+)\s*(?:KG|KGS)?/i)||first(flat,/\b([\d,.]+)\s*(?:KG|KGS)\b/i)).replace(/,/g,'');
  let flightNo='';if(iata){const esc=iata.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');const m=upper.match(new RegExp(`\\b${esc}\\s*[- ]?(\\d{2,4})\\b`));if(m)flightNo=`${iata}${m[1]}`;}
  if(!flightNo)flightNo=first(upper,/\b([A-Z]{2}\d{2,4})\b/);
  const actual=(flat.match(/(?:ATA|Actual Arrival|Arrived|Received from Flight|RCF|Landed)[\s\S]{0,220}/i)||[])[0]||'';
  const estimated=(flat.match(/(?:ETA|Estimated Arrival|Expected Arrival|Scheduled Arrival|Arrival)[\s\S]{0,220}/i)||[])[0]||'';
  let arrivalDate=parseDate(actual),arrivalTime=parseTime(actual),arrivalIsActual=Boolean(arrivalDate||arrivalTime);
  if(!arrivalDate&&!arrivalTime){arrivalDate=parseDate(estimated);arrivalTime=parseTime(estimated);arrivalIsActual=false;}
  const status=statusFromText(flat);
  return {mawb,carrierCode:iata,airlineName:airline?.name||'',origin,destination,bags:pieces,pieces,weight,flightNo,arrivalDate,arrivalTime,arrivalIsActual,status,officialTracker:airline?.url||'',source:'Official airline browser capture'};
}
function useful(s={}){return Boolean((s.origin&&s.destination)||s.pieces||s.weight||s.flightNo||s.arrivalDate||s.arrivalTime||(s.status&&s.status!=='TRACKING'));}
function officialUrl(mawb,airline){
  const prefix=mawb.slice(0,3),serial=mawb.slice(4);
  if(prefix==='160')return`https://www.cathaycargoterminal.com/en-us/Shipment-Tracking/AWBPrefix/160/AWBSuffix/${serial}`;
  if(prefix==='157')return`https://www.qrcargo.com/s/track-your-shipment?documentNumber=${serial}&documentPrefix=157&documentType=MAWB`;
  return airline?.url||'';
}

export async function trackWithBrowser(input){
  const mawb=normalizeMawb(input),airline=airlineForMawb(mawb);if(!mawb||!airline)return{ok:false,reason:'INVALID OR UNMAPPED MAWB'};
  const url=officialUrl(mawb,airline);if(!url)return{ok:false,reason:'NO OFFICIAL TRACKER URL',officialTracker:null};
  const prefix=mawb.slice(0,3),serial=mawb.slice(4),digits=mawb.replace(/\D/g,'');
  let browser;
  try{
    chromium.setGraphicsMode=false;
    browser=await puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox'],defaultViewport:{width:1440,height:1100,deviceScaleFactor:1},executablePath:await chromium.executablePath(),headless:'shell'});
    const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36');
    await page.goto(url,{waitUntil:'domcontentloaded',timeout:18000});
    await new Promise(r=>setTimeout(r,1800));

    await page.evaluate(()=>{
      const buttons=[...document.querySelectorAll('button,[role="button"]')];
      const b=buttons.find(x=>/accept all|accept cookies|allow all|agree/i.test((x.innerText||x.getAttribute('aria-label')||'').trim()));if(b)b.click();
    }).catch(()=>{});
    await new Promise(r=>setTimeout(r,300));

    const bodyBefore=await page.evaluate(()=>document.body?.innerText||'').catch(()=> '');
    if(/captcha|verify you are human|security check|cloudflare|turnstile|access denied/i.test(bodyBefore)){
      const shot=await page.screenshot({type:'jpeg',quality:65,fullPage:false,encoding:'base64'}).catch(()=>null);
      return{ok:false,reason:'AIRLINE SECURITY/CAPTCHA REQUIRES MANUAL CHECK',officialTracker:url,screenshotBase64:shot,debug:{stage:'CAPTCHA'}};
    }

    let fill=await page.evaluate(({mawb,prefix,serial})=>{
      const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>20&&r.height>10&&!e.disabled};
      const inputs=[...document.querySelectorAll('input')].filter(visible).filter(e=>!['hidden','checkbox','radio','submit','button'].includes((e.type||'text').toLowerCase()));
      const desc=e=>`${e.name||''} ${e.id||''} ${e.placeholder||''} ${e.getAttribute('aria-label')||''} ${e.getAttribute('title')||''}`.toLowerCase();
      const set=(e,v)=>{const d=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');d?.set?.call(e,v);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));};
      const prefixInput=inputs.find(e=>/prefix/.test(desc(e))), numberInput=inputs.find(e=>/(awb|airway|document|tracking|shipment).*(number|no|serial)|documentnumber|awbnumber/.test(desc(e))&&!/prefix/.test(desc(e)));
      if(prefixInput&&numberInput){set(prefixInput,prefix);set(numberInput,serial);return{filled:true,mode:'split'};}
      const best=inputs.map(e=>({e,score:(/(awb|airway|tracking|shipment|document)/.test(desc(e))?5:0)+(/number|no|serial/.test(desc(e))?2:0)})).sort((a,b)=>b.score-a.score)[0];
      if(best?.e&&best.score>0){set(best.e,mawb);return{filled:true,mode:'single'};}return{filled:false};
    },{mawb,prefix,serial}).catch(()=>({filled:false}));

    const compactBefore=bodyBefore.replace(/\D/g,'');
    const prefilled=compactBefore.includes(digits)||compactBefore.includes(serial)||page.url().includes(`documentNumber=${encodeURIComponent(serial)}`);
    if(!fill.filled&&prefilled)fill={filled:true,mode:'prefilled'};

    let clicked='';
    if(fill.filled){
      await new Promise(r=>setTimeout(r,300));
      clicked=await page.evaluate(()=>{
        const els=[...document.querySelectorAll('button,input[type="submit"],a,[role="button"]')];
        const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>20&&r.height>10&&!e.disabled};
        const candidates=els.filter(visible).map(e=>({e,t:(e.innerText||e.value||e.getAttribute('aria-label')||e.getAttribute('title')||'').replace(/\s+/g,' ').trim()}));
        const target=candidates.find(x=>/^(track|search|submit|go)$/i.test(x.t)||/track\s+shipment(?:\(s\)|s)?|track\s+cargo|track\s+awb|search\s+shipment/i.test(x.t));
        if(target){target.e.click();return target.t;}return'';
      }).catch(()=> '');
      if(clicked){
        await Promise.race([page.waitForNetworkIdle({idleTime:900,timeout:8500}).catch(()=>{}),new Promise(r=>setTimeout(r,8500))]);
        await new Promise(r=>setTimeout(r,1200));
      } else await new Promise(r=>setTimeout(r,2200));
    }

    const text=await page.evaluate(()=>document.body?.innerText||'').catch(()=> '');
    if(/captcha|verify you are human|security check|cloudflare|turnstile|access denied/i.test(text)){
      const shot=await page.screenshot({type:'jpeg',quality:65,fullPage:false,encoding:'base64'}).catch(()=>null);
      return{ok:false,reason:'AIRLINE SECURITY/CAPTCHA REQUIRES MANUAL CHECK',officialTracker:url,screenshotBase64:shot,debug:{stage:'CAPTCHA_AFTER_SUBMIT',filled:fill.filled,mode:fill.mode||'',clicked}};
    }
    const screenshotBase64=await page.screenshot({type:'jpeg',quality:68,fullPage:false,encoding:'base64'}).catch(()=>null);
    const shipment=parseVisibleText(text,mawb,airline);
    if(useful(shipment))return{ok:true,shipment,screenshotBase64,debug:{stage:'SUCCESS',url,filled:fill.filled,mode:fill.mode||'',clicked}};
    return{ok:false,reason:'BROWSER OPENED AIRLINE PAGE BUT NO VERIFIED SHIPMENT FIELDS FOUND',officialTracker:url,screenshotBase64,pageText:text.slice(0,6000),debug:{stage:'NO_FIELDS',filled:fill.filled,mode:fill.mode||'',clicked}};
  }catch(e){return{ok:false,reason:`BROWSER TRACKING ERROR: ${e?.message||e}`,officialTracker:url,debug:{stage:'ERROR'}};}
  finally{try{if(browser)await browser.close()}catch{}}
}
