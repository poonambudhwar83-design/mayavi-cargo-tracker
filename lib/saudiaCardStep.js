import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { normalizeMawb } from './airlines.js';

const URL='https://china.saudiacargo.com/e-services';
const TRACK_API=/\/apis\/api\/eservices\/track-shipment/i;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clean=v=>String(v||'').replace(/\s+/g,' ').trim();
const first=(s,rx)=>(String(s||'').match(rx)||[])[1]||'';

function parseInfo(text='',mawb=''){
  const s=clean(text);
  const pieces=first(s,/(?:Total\s+(?:number\s+of\s+)?pieces|Number\s+of\s+pieces|Pieces?|Pcs?|件数|总件数)\s*[:#\-]?\s*(\d{1,6})\b/i)
    || first(s,/"(?:totalPieces|totalNumberOfPieces|numberOfPieces|pieceCount|pieces|pcs)"\s*:\s*"?(\d{1,6})/i)
    || first(s,/<(?:totalPieces|totalNumberOfPieces|numberOfPieces|pieceCount|pieces|pcs)>\s*(\d{1,6})\s*</i);
  const weight=(first(s,/(?:Gross\s+Weight|Total\s+Weight|Weight|重量|总重量|毛重)\s*[:#\-]?\s*([\d,.]+)\s*(?:kg|kgs|kilograms?|公斤)?\b/i)
    || first(s,/"(?:grossWeight|totalWeight|weight|shipmentWeight)"\s*:\s*"?([\d,.]+)/i)
    || first(s,/<(?:grossWeight|totalWeight|weight|shipmentWeight)>\s*([\d,.]+)\s*</i)).replace(/,/g,'');
  let flightNo=first(s,/(?:Flight\s+(?:number|no\.?|#)?|Flight|航班号|航班)\s*[:#\-]?\s*((?:SV|SVA)\s*[- ]?\d{2,4})\b/i)
    || first(s,/"(?:flightNo|flightNumber|flight|flightNumberText)"\s*:\s*"?((?:SV|SVA)\s*[- ]?\d{2,4})/i)
    || first(s,/<(?:flightNo|flightNumber|flight|flightNumberText)>\s*((?:SV|SVA)\s*[- ]?\d{2,4})\s*</i)
    || first(s,/\b((?:SV|SVA)\s*[- ]?\d{2,4})\b/i);
  flightNo=clean(flightNo).toUpperCase().replace(/^SVA/,'SV').replace(/\s|-/g,'');
  return {mawb,carrierCode:'SV',airlineName:'Saudia Cargo',bags:pieces,pieces,weight,flightNo,status:'TRACKING',officialTracker:URL,source:'Saudia normal browser result — pieces, weight and flight only'};
}
function useful(s={}){return Boolean(s.pieces||s.weight||s.flightNo);}
function complete(s={}){return Boolean(s.pieces&&s.weight&&s.flightNo);}
function mergeCore(base={},next={}){
  const out={...base};
  if(!out.pieces&&next.pieces){out.pieces=next.pieces;out.bags=next.pieces;}
  if(!out.bags&&next.bags)out.bags=next.bags;
  if(!out.weight&&next.weight)out.weight=next.weight;
  if(!out.flightNo&&next.flightNo)out.flightNo=next.flightNo;
  return out;
}

async function acceptCookies(page){
  await page.evaluate(()=>{
    const vis=e=>{try{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>5&&r.height>5}catch{return false}};
    const txt=e=>String(e?.innerText||e?.textContent||'').replace(/\s+/g,' ').trim();
    const b=[...document.querySelectorAll('button,[role="button"]')].filter(vis).find(e=>/^(ok|accept|agree|同意|确定)$/i.test(txt(e)));
    b?.click();
  }).catch(()=>{});
}

async function markAwb(page){
  return page.evaluate(()=>{
    const vis=e=>{try{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>20&&r.height>10&&!e.disabled}catch{return false}};
    const inputs=[...document.querySelectorAll('input')].filter(vis).filter(e=>!['hidden','checkbox','radio','submit','button'].includes(String(e.type||'text').toLowerCase()));
    const input=inputs.find(e=>/065-0|awb|airway|shipment/i.test(`${e.placeholder||''} ${e.name||''} ${e.id||''} ${e.getAttribute('aria-label')||''}`));
    if(!input)return false;input.dataset.mayaviAwb='1';return true;
  }).catch(()=>false);
}

async function setAwb(page,value){
  return page.evaluate(v=>{
    const input=document.querySelector('[data-mayavi-awb="1"]');if(!input)return false;
    const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
    setter?.call(input,v);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));input.focus();return true;
  },value).catch(()=>false);
}

async function clickTrackerSubmit(page){
  const marked=await page.evaluate(()=>{
    const input=document.querySelector('[data-mayavi-awb="1"]');if(!input)return false;
    const vis=e=>{try{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>8&&r.height>8&&!e.disabled}catch{return false}};
    const txt=e=>String(e?.innerText||e?.textContent||e?.getAttribute?.('aria-label')||e?.title||'').replace(/\s+/g,' ').trim();
    const form=input.closest('form');
    let button=form ? [...form.querySelectorAll('button,input[type="submit"],[role="button"]')].filter(vis).find(e=>e.type==='submit'||/track|追踪|search|go|→|›/i.test(txt(e))) : null;
    if(!button){
      const r=input.getBoundingClientRect(),cy=r.top+r.height/2;
      button=[...document.querySelectorAll('button,input[type="submit"],[role="button"]')].filter(vis).map(e=>({e,r:e.getBoundingClientRect(),t:txt(e)})).filter(v=>v.r.left>=r.right-30&&v.r.left<=r.right+240&&Math.abs(v.r.top+v.r.height/2-cy)<100).sort((a,b)=>Math.abs(a.r.left-r.right)-Math.abs(b.r.left-r.right))[0]?.e||null;
    }
    if(!button)return false;button.dataset.mayaviTrackSubmit='1';return true;
  }).catch(()=>false);
  if(!marked)return false;
  await page.click('[data-mayavi-track-submit="1"]').catch(()=>page.evaluate(()=>document.querySelector('[data-mayavi-track-submit="1"]')?.click()).catch(()=>{}));
  return true;
}

async function submitAndCapture(page){
  let body='';
  const responsePromise=new Promise(resolve=>{
    const timer=setTimeout(()=>resolve(''),18000);
    const handler=async r=>{
      if(!TRACK_API.test(r.url()))return;
      try{body=await r.text();}catch{}
      clearTimeout(timer);page.off('response',handler);resolve(body);
    };
    page.on('response',handler);
  });
  const clicked=await clickTrackerSubmit(page);
  if(!clicked)return{clicked:false,apiText:''};
  const apiText=await responsePromise;
  await sleep(1200);
  return{clicked:true,apiText};
}

async function resultRowText(page,mawb,mark=false){
  const digits=String(mawb).replace(/\D/g,''),serial=digits.slice(3);
  return page.evaluate(({digits,serial,mark})=>{
    const vis=e=>{try{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>20&&r.height>10}catch{return false}};
    const txt=e=>String(e?.innerText||e?.textContent||'').replace(/\s+/g,' ').trim();
    const all=[...document.querySelectorAll('tr,[role="row"],li,[class*="row"],[class*="card"],section,article,div')].filter(vis).map(e=>({e,t:txt(e)}));
    const rows=all.filter(v=>v.t.length>=8&&v.t.length<=3500).filter(v=>{const nd=v.t.replace(/\D/g,'');const hasAwb=nd.includes(digits)||nd.includes(serial);const hasFields=/(Total\s+number\s+of\s+pieces|pieces?|pcs?|More\s+information|件数|更多信息|附加信息|weight|重量|flight|航班)/i.test(v.t);return hasAwb&&hasFields;}).sort((a,b)=>a.t.length-b.t.length);
    const row=rows[0];if(!row)return'';if(mark)row.e.dataset.mayaviResultRow='1';return row.t;
  },{digits,serial,mark}).catch(()=> '');
}
async function waitForResultRow(page,mawb){for(let i=0;i<20;i++){const t=await resultRowText(page,mawb,true);if(t)return t;await sleep(500);}return'';}

async function clickMore(page){
  const ok=await page.evaluate(()=>{
    const row=document.querySelector('[data-mayavi-result-row="1"]');if(!row)return false;
    const vis=e=>{try{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>8&&r.height>8}catch{return false}};
    const txt=e=>String(e?.innerText||e?.textContent||e?.getAttribute?.('aria-label')||e?.title||'').replace(/\s+/g,' ').trim();
    let x=[...row.querySelectorAll('button,[role="button"],a,[tabindex],span,div')].filter(vis).find(e=>/more\s+information|附加信息|更多信息/i.test(txt(e)));
    if(!x)return false;x=x.closest('button,[role="button"],a,[tabindex]')||x;x.dataset.mayaviMore='1';return true;
  }).catch(()=>false);
  if(!ok)return false;await page.click('[data-mayavi-more="1"]').catch(()=>page.evaluate(()=>document.querySelector('[data-mayavi-more="1"]')?.click()).catch(()=>{}));return true;
}
async function detailsText(page){
  return page.evaluate(()=>{
    const vis=e=>{try{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>20&&r.height>10}catch{return false}};
    const txt=e=>String(e?.innerText||e?.textContent||'').replace(/\s+/g,' ').trim();
    const all=[...document.querySelectorAll('[role="dialog"],[class*="modal"],[class*="drawer"],[class*="detail"],[class*="expand"],section,article,div')].filter(vis).map(e=>({e,t:txt(e)}));
    return all.filter(v=>v.t.length>=10&&v.t.length<=6000).filter(v=>/(weight|重量|flight|航班|pieces?|件数)/i.test(v.t)).sort((a,b)=>a.t.length-b.t.length)[0]?.t||'';
  }).catch(()=> '');
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
    await sleep(3500);await acceptCookies(page);await sleep(500);
    if(!await markAwb(page))return{ok:false,reason:'SAUDIA AWB INPUT NOT FOUND',officialTracker:URL};

    const digits=mawb.replace(/\D/g,'');
    await setAwb(page,digits);
    await sleep(700);
    let submit=await submitAndCapture(page);
    if(!submit.clicked)return{ok:false,reason:'SAUDIA TRACK BUTTON NOT FOUND',officialTracker:URL};

    if(/invalidCaptcha/i.test(submit.apiText||'')){
      await sleep(2500);
      submit=await submitAndCapture(page);
    }

    const rowText=await waitForResultRow(page,mawb);
    let shipment=parseInfo(`${submit.apiText||''}\n${rowText}`,mawb);
    let moreClicked=false,detail='';
    if(rowText&&!complete(shipment)){
      moreClicked=await clickMore(page);
      if(moreClicked){await sleep(1300);detail=await detailsText(page);shipment=mergeCore(shipment,parseInfo(detail,mawb));}
    }

    const screenshotBase64=await page.screenshot({type:'png',fullPage:false,encoding:'base64'}).catch(()=>null);
    if(/invalidCaptcha/i.test(submit.apiText||'')&&!rowText)return{ok:false,reason:'SAUDIA NORMAL BROWSER SUBMIT WAS REJECTED BY SITE VALIDATION',officialTracker:URL,screenshotBase64,debug:{stage:'SITE_VALIDATION_REJECTED',apiSample:clean(submit.apiText).slice(0,1500)}};
    if(!useful(shipment))return{ok:false,reason:'SAUDIA RESULT DID NOT SHOW VERIFIED PIECES / WEIGHT / FLIGHT',officialTracker:URL,screenshotBase64,debug:{stage:'NO_CORE_FIELDS',row:clean(rowText).slice(0,1400),detail:clean(detail).slice(0,1400),apiSample:clean(submit.apiText).slice(0,3000)}};
    return{ok:true,shipment,screenshotBase64,debug:{stage:complete(shipment)?'ALL_3_CORE_FIELDS_FOUND':'PARTIAL_CORE_FIELDS_FOUND',moreClicked,row:clean(rowText).slice(0,1400),detail:clean(detail).slice(0,1400),apiSample:clean(submit.apiText).slice(0,3000)}};
  }catch(e){return{ok:false,reason:`SAUDIA NORMAL BROWSER ERROR: ${e?.message||e}`,officialTracker:URL};}
  finally{try{if(browser)await browser.close()}catch{}}
}
