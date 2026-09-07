import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { normalizeMawb } from './airlines.js';

const URL='https://saudiacargo.com/en/digital-services';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clean=v=>String(v||'').replace(/\s+/g,' ').trim();
const first=(s,rx)=>(String(s||'').match(rx)||[])[1]||'';

function parseInfo(text='',mawb=''){
  const s=clean(text);
  const pieces=first(s,/(?:Total\s*Pieces|Total\s+(?:number\s+of\s+)?pieces|Number\s+of\s+pieces|Pieces?|Pcs?)\s*[:#\-]?\s*(\d{1,6})\b/i)
    || first(s,/"(?:totalPieces|totalPiece|pieceCount|pieces|pcs)"\s*:\s*"?(\d{1,6})/i);
  const weight=(first(s,/(?:Gross\s*Weight|Total\s*Weight|Weight)\s*[:#\-]?\s*([\d,.]+)\s*(?:kg|kgs|kilograms?)?\b/i)
    || first(s,/"(?:grossWeight|totalWeight|weight|shipmentWeight)"\s*:\s*"?([\d,.]+)/i)).replace(/,/g,'');
  let flightNo=first(s,/(?:Flight\s+(?:number|no\.?|#)?|Flight\s*No\.?)\s*[:#\-]?\s*((?:SV|SVA)\s*[- ]?\d{2,4})\b/i)
    || first(s,/"(?:flightNo|flightNumber|flight)"\s*:\s*"?((?:SV|SVA)\s*[- ]?\d{2,4})/i)
    || first(s,/\b((?:SV|SVA)\s*[- ]?\d{2,4})\b/i);
  flightNo=clean(flightNo).toUpperCase().replace(/^SVA/,'SV').replace(/\s|-/g,'');
  return {mawb,carrierCode:'SV',airlineName:'Saudia Cargo',bags:pieces,pieces,weight,flightNo,status:'TRACKING',officialTracker:URL,source:'Saudia official digital-services result — pieces, weight and flight only'};
}
function useful(s={}){return Boolean(s.pieces||s.weight||s.flightNo);}
function complete(s={}){return Boolean(s.pieces&&s.weight&&s.flightNo);}

async function markAwb(page){
  return page.evaluate(()=>{
    const vis=e=>{try{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>20&&r.height>10&&!e.disabled}catch{return false}};
    const inputs=[...document.querySelectorAll('input')].filter(vis).filter(e=>!['hidden','checkbox','radio','submit','button'].includes(String(e.type||'text').toLowerCase()));
    const input=inputs.find(e=>/awb|airway|shipment/i.test(`${e.placeholder||''} ${e.name||''} ${e.id||''} ${e.getAttribute('aria-label')||''}`))||inputs[0];
    if(!input)return false;input.dataset.mayaviAwb='1';return true;
  }).catch(()=>false);
}

async function typeAwb(page,value){
  try{
    await page.click('[data-mayavi-awb="1"]');
    await page.keyboard.down('Control');await page.keyboard.press('A');await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    await page.type('[data-mayavi-awb="1"]',value,{delay:35});
    await sleep(300);
    return true;
  }catch{
    return page.evaluate(v=>{
      const input=document.querySelector('[data-mayavi-awb="1"]');if(!input)return false;
      const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
      setter?.call(input,v);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));return true;
    },value).catch(()=>false);
  }
}

async function clickSubmit(page){
  const marked=await page.evaluate(()=>{
    const input=document.querySelector('[data-mayavi-awb="1"]');if(!input)return false;
    const vis=e=>{try{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>6&&r.height>6&&!e.disabled}catch{return false}};
    const txt=e=>String(e?.innerText||e?.textContent||e?.value||e?.getAttribute?.('aria-label')||e?.title||'').replace(/\s+/g,' ').trim();
    const ir=input.getBoundingClientRect(),icy=ir.top+ir.height/2;
    const all=[...document.querySelectorAll('button,a,[role="button"],input[type="submit"],input[type="button"],span,div')].filter(vis).map(e=>({e,t:txt(e),r:e.getBoundingClientRect()}));
    const scored=all.filter(v=>/^submit$/i.test(v.t)||/submit\s*[›→]?$/i.test(v.t)).map(v=>({...v,score:Math.abs(v.r.top+v.r.height/2-icy)+Math.max(0,ir.left-v.r.left)*2})).sort((a,b)=>a.score-b.score);
    let btn=scored[0]?.e||null;
    if(!btn){
      const near=all.filter(v=>v.r.top>=ir.top-30&&v.r.top<=ir.bottom+140&&v.r.left>=ir.left-50).sort((a,b)=>Math.abs(a.r.top-ir.bottom)-Math.abs(b.r.top-ir.bottom));
      btn=near.find(v=>/submit|go|track/i.test(v.t))?.e||null;
    }
    if(!btn)return false;
    btn=btn.closest('button,a,[role="button"]')||btn;
    btn.dataset.mayaviSubmit='1';return true;
  }).catch(()=>false);
  if(!marked)return false;
  await page.click('[data-mayavi-submit="1"]').catch(()=>page.evaluate(()=>document.querySelector('[data-mayavi-submit="1"]')?.click()).catch(()=>{}));
  return true;
}

async function frameText(page){
  const parts=[];
  for(const frame of page.frames()){
    try{const t=await frame.evaluate(()=>document.body?.innerText||'');if(t)parts.push(t);}catch{}
  }
  return clean(parts.join('\n'));
}

function looksLikeResult(text='',mawb=''){
  const s=clean(text),digits=String(mawb).replace(/\D/g,''),serial=digits.slice(3),nd=s.replace(/\D/g,'');
  return (nd.includes(digits)||nd.includes(serial))&&/(Total\s*Pieces|Flight\s*No|Weight)/i.test(s);
}

async function waitForResult(page,mawb,networkParts){
  for(let i=0;i<44;i++){
    const dom=await frameText(page);
    const net=clean(networkParts.join('\n'));
    const combined=clean(`${dom}\n${net}`);
    if(looksLikeResult(combined,mawb)||complete(parseInfo(combined,mawb)))return combined;
    if(i===12){try{await page.focus('[data-mayavi-awb="1"]');await page.keyboard.press('Enter');}catch{}}
    await sleep(500);
  }
  return clean(`${await frameText(page)}\n${networkParts.join('\n')}`);
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
    await sleep(3500);
    if(!await markAwb(page))return{ok:false,reason:'SAUDIA AWB INPUT NOT FOUND',officialTracker:URL};

    const networkParts=[];
    const onResponse=async r=>{
      try{
        const u=r.url(),ct=String(r.headers()['content-type']||'');
        if(!/(json|text|javascript)/i.test(ct)&&!/saudia|cargo|shipment|track|awb|digital/i.test(u))return;
        const body=await r.text();
        if(body&&body.length<250000)networkParts.push(`${u}\n${body}`);
      }catch{}
    };
    page.on('response',onResponse);

    const digits=mawb.replace(/\D/g,'');
    if(!await typeAwb(page,digits))return{ok:false,reason:'SAUDIA AWB COULD NOT BE ENTERED',officialTracker:URL};
    if(!await clickSubmit(page)){
      try{await page.keyboard.press('Enter');}catch{}
    }

    const text=await waitForResult(page,mawb,networkParts);
    page.off('response',onResponse);
    const shipment=parseInfo(text,mawb);
    const screenshotBase64=await page.screenshot({type:'png',fullPage:false,encoding:'base64'}).catch(()=>null);
    if(!useful(shipment))return{ok:false,reason:'SAUDIA OFFICIAL RESULT DID NOT SHOW PIECES / WEIGHT / FLIGHT',officialTracker:URL,screenshotBase64,debug:{stage:'NO_CORE_FIELDS',resultSample:clean(text).slice(0,5000),networkCount:networkParts.length}};
    return{ok:true,shipment,screenshotBase64,debug:{stage:complete(shipment)?'ALL_3_CORE_FIELDS_FOUND':'PARTIAL_CORE_FIELDS_FOUND',resultSample:clean(text).slice(0,5000),networkCount:networkParts.length}};
  }catch(e){return{ok:false,reason:`SAUDIA OFFICIAL DIGITAL-SERVICES ERROR: ${e?.message||e}`,officialTracker:URL};}
  finally{try{if(browser)await browser.close()}catch{}}
}
