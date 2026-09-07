import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { normalizeMawb } from './airlines.js';

const URL='https://saudiacargo.com/en/digital-services';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clean=v=>String(v||'').replace(/\s+/g,' ').trim();
const first=(s,rx)=>(String(s||'').match(rx)||[])[1]||'';

function parseInfo(text='',mawb=''){
  const s=clean(text);
  const pieces=first(s,/(?:Total\s+Pieces|Total\s+(?:number\s+of\s+)?pieces|Number\s+of\s+pieces|Pieces?|Pcs?)\s*[:#\-]?\s*(\d{1,6})\b/i);
  const weight=(first(s,/(?:Gross\s+Weight|Total\s+Weight|Weight)\s*[:#\-]?\s*([\d,.]+)\s*(?:kg|kgs|kilograms?)?\b/i)).replace(/,/g,'');
  let flightNo=first(s,/(?:Flight\s+(?:number|no\.?|#)?|Flight\s+No\.?)\s*[:#\-]?\s*((?:SV|SVA)\s*[- ]?\d{2,4})\b/i)
    || first(s,/\b((?:SV|SVA)\s*[- ]?\d{2,4})\b/i);
  flightNo=clean(flightNo).toUpperCase().replace(/^SVA/,'SV').replace(/\s|-/g,'');
  return {mawb,carrierCode:'SV',airlineName:'Saudia Cargo',bags:pieces,pieces,weight,flightNo,status:'TRACKING',officialTracker:URL,source:'Saudia official digital-services result — pieces, weight and flight only'};
}
function useful(s={}){return Boolean(s.pieces||s.weight||s.flightNo);}

async function markAwb(page){
  return page.evaluate(()=>{
    const vis=e=>{try{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>20&&r.height>10&&!e.disabled}catch{return false}};
    const inputs=[...document.querySelectorAll('input')].filter(vis).filter(e=>!['hidden','checkbox','radio','submit','button'].includes(String(e.type||'text').toLowerCase()));
    const input=inputs.find(e=>/awb|airway|shipment/i.test(`${e.placeholder||''} ${e.name||''} ${e.id||''} ${e.getAttribute('aria-label')||''}`))||inputs[0];
    if(!input)return false;
    input.dataset.mayaviAwb='1';
    return true;
  }).catch(()=>false);
}

async function setAwb(page,value){
  return page.evaluate(v=>{
    const input=document.querySelector('[data-mayavi-awb="1"]');
    if(!input)return false;
    const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
    setter?.call(input,v);
    input.dispatchEvent(new Event('input',{bubbles:true}));
    input.dispatchEvent(new Event('change',{bubbles:true}));
    input.focus();
    return true;
  },value).catch(()=>false);
}

async function clickSubmit(page){
  const marked=await page.evaluate(()=>{
    const input=document.querySelector('[data-mayavi-awb="1"]');
    if(!input)return false;
    const vis=e=>{try{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>8&&r.height>8&&!e.disabled}catch{return false}};
    const txt=e=>String(e?.innerText||e?.textContent||e?.value||e?.getAttribute?.('aria-label')||'').replace(/\s+/g,' ').trim();
    const form=input.closest('form');
    let btn=form ? [...form.querySelectorAll('button,input[type="submit"],[role="button"]')].filter(vis).find(e=>/submit|track shipment|track|go|→|›/i.test(txt(e))||e.type==='submit') : null;
    if(!btn){
      const r=input.getBoundingClientRect(),cy=r.top+r.height/2;
      btn=[...document.querySelectorAll('button,input[type="submit"],[role="button"]')].filter(vis).map(e=>({e,r:e.getBoundingClientRect(),t:txt(e)})).filter(v=>/submit|track shipment|track|go|→|›/i.test(v.t)||Math.abs(v.r.top+v.r.height/2-cy)<100).sort((a,b)=>Math.abs(a.r.top-r.top)-Math.abs(b.r.top-r.top))[0]?.e||null;
    }
    if(!btn)return false;
    btn.dataset.mayaviSubmit='1';
    return true;
  }).catch(()=>false);
  if(!marked)return false;
  await page.click('[data-mayavi-submit="1"]').catch(()=>page.evaluate(()=>document.querySelector('[data-mayavi-submit="1"]')?.click()).catch(()=>{}));
  return true;
}

async function resultText(page,mawb){
  const digits=String(mawb).replace(/\D/g,'');
  const serial=digits.slice(3);
  for(let i=0;i<24;i++){
    const text=await page.evaluate(()=>document.body?.innerText||'').catch(()=> '');
    const flat=clean(text);
    const nd=flat.replace(/\D/g,'');
    if((nd.includes(digits)||nd.includes(serial))&&/(Total\s+Pieces|Flight\s+No|Weight)/i.test(flat))return flat;
    await sleep(500);
  }
  return '';
}

export async function trackSaudiaCardStep(input){
  const mawb=normalizeMawb(input);
  if(!mawb||!mawb.startsWith('065-'))return{ok:false,reason:'INVALID SAUDIA MAWB',officialTracker:URL};
  let browser;
  try{
    chromium.setGraphicsMode=false;
    browser=await puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox','--lang=en-US,en','--window-size=1440,1100'],defaultViewport:{width:1440,height:1100},executablePath:await chromium.executablePath(),headless:'shell'});
    const page=await browser.newPage();
    await page.setExtraHTTPHeaders({'Accept-Language':'en-US,en;q=0.9'});
    await page.goto(URL,{waitUntil:'domcontentloaded',timeout:30000});
    await sleep(3000);
    if(!await markAwb(page))return{ok:false,reason:'SAUDIA AWB INPUT NOT FOUND',officialTracker:URL};
    await setAwb(page,mawb.replace(/\D/g,''));
    await sleep(500);
    if(!await clickSubmit(page))return{ok:false,reason:'SAUDIA SUBMIT BUTTON NOT FOUND',officialTracker:URL};
    const text=await resultText(page,mawb);
    const shipment=parseInfo(text,mawb);
    const screenshotBase64=await page.screenshot({type:'png',fullPage:false,encoding:'base64'}).catch(()=>null);
    if(!useful(shipment))return{ok:false,reason:'SAUDIA OFFICIAL RESULT DID NOT SHOW PIECES / WEIGHT / FLIGHT',officialTracker:URL,screenshotBase64,debug:{stage:'NO_CORE_FIELDS',resultSample:clean(text).slice(0,3000)}};
    return{ok:true,shipment,screenshotBase64,debug:{stage:shipment.pieces&&shipment.weight&&shipment.flightNo?'ALL_3_CORE_FIELDS_FOUND':'PARTIAL_CORE_FIELDS_FOUND',resultSample:clean(text).slice(0,3000)}};
  }catch(e){return{ok:false,reason:`SAUDIA OFFICIAL DIGITAL-SERVICES ERROR: ${e?.message||e}`,officialTracker:URL};}
  finally{try{if(browser)await browser.close()}catch{}}
}
