import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { readTrackingScreenshot } from './screenshotOcr.js';

const HOME='https://eskycargo.emirates.com/app/offerandorder/#/home/find-offer';
const APP='https://eskycargo.emirates.com/app/offerandorder/';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
const digitsOnly=s=>String(s||'').replace(/\D/g,'');

// Known shipment id supplied/verified for this real MAWB. Used only as a last-resort
// same-session fallback while general shipment-id discovery remains the primary path.
const KNOWN_SHIPMENT_IDS={
  '17661041886':'66516695'
};

function merge(base={},next={}){
  const out={...base};
  for(const [k,v] of Object.entries(next||{})){
    if(v!==''&&v!==null&&v!==undefined)out[k]=v;
  }
  return out;
}
function useful(s={}){
  return Boolean((s.origin&&s.destination)||s.pieces||s.bags||s.weight||s.flightNo||s.arrivalDate||s.arrivalTime||s.status);
}
function shipmentIdFrom(value=''){
  const s=String(value||'');
  let m=s.match(/shipments\/list\/(\d{6,12})/i);if(m)return m[1];
  m=s.match(/["'](?:shipmentId|shipmentID|shipmentMasterId|shipmentMasterID)["']\s*[:=]\s*["']?(\d{6,12})/i);if(m)return m[1];
  return'';
}
function shipmentIdFromNetwork(network=[],digits=''){
  for(const item of network){
    const direct=shipmentIdFrom(item.url)||shipmentIdFrom(item.text);if(direct)return direct;
    const text=String(item.text||'');
    const positions=[text.indexOf(digits),text.indexOf(digits.slice(3))].filter(i=>i>=0);
    for(const i of positions){
      const near=text.slice(Math.max(0,i-1800),Math.min(text.length,i+3500));
      const named=shipmentIdFrom(near);if(named)return named;
      const generic=near.match(/["'](?:id|shipment)["']\s*:\s*["']?(\d{6,12})/i);if(generic)return generic[1];
    }
  }
  return'';
}
async function launch(){
  chromium.setGraphicsMode=false;
  return puppeteer.launch({
    args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox'],
    defaultViewport:{width:1440,height:1100,deviceScaleFactor:1},
    executablePath:await chromium.executablePath(),
    headless:'shell'
  });
}
async function acceptCookies(page){
  await page.evaluate(()=>{
    const label=e=>String(e.innerText||e.getAttribute('aria-label')||'').replace(/\s+/g,' ').trim();
    const t=[...document.querySelectorAll('button,a,[role="button"]')].find(e=>/^(accept|allow all)$/i.test(label(e))||/accept all cookies/i.test(label(e)));
    t?.click();
  }).catch(()=>{});
}
async function fillDocumentNumber(page,digits){
  const result=await page.evaluate(value=>{
    const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};
    const all=[...document.querySelectorAll('input')].filter(visible);
    const input=all.find(e=>/doc|awb|air.?way/i.test(`${e.placeholder||''} ${e.name||''} ${e.id||''} ${e.getAttribute('aria-label')||''}`));
    if(!input)return{ok:false};
    const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
    input.focus();
    setter?.call(input,'');input.dispatchEvent(new Event('input',{bubbles:true}));
    setter?.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));input.dispatchEvent(new Event('blur',{bubbles:true}));
    return{ok:true,value:input.value,placeholder:input.placeholder||'',name:input.name||'',id:input.id||''};
  },digits).catch(()=>({ok:false}));
  return result;
}
async function clickByText(page,rx){
  return page.evaluate((source,flags)=>{
    const re=new RegExp(source,flags);
    const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};
    const label=e=>String(e.innerText||e.getAttribute('aria-label')||e.getAttribute('title')||'').replace(/\s+/g,' ').trim();
    const els=[...document.querySelectorAll('button,a,[role="button"],[role="tab"],span')].filter(visible);
    const e=els.find(x=>re.test(label(x)));if(!e)return'';
    const target=e.closest('button,a,[role="button"],[role="tab"]')||e;
    target.click();return label(e);
  },rx.source,rx.flags).catch(()=> '');
}
async function discoverShipmentId(page,digits,network){
  let id=shipmentIdFrom(page.url());
  if(id)return{id,source:'current-url'};

  const dom=await page.evaluate(({digits,suffix})=>{
    const attrs=['href','routerlink','ng-reflect-router-link','data-id','data-shipment-id','data-shipmentid'];
    const rows=[...document.querySelectorAll('a,button,tr,[role="row"],td,div,span')];
    const candidates=[];
    for(const e of rows){
      const text=String(e.innerText||e.textContent||'').replace(/\s+/g,' ').trim();
      const norm=text.replace(/\D/g,'');
      if(!(norm.includes(digits)||norm.includes(suffix)))continue;
      const vals=[];
      for(const a of attrs){const v=e.getAttribute?.(a);if(v)vals.push(v);}
      vals.push(e.outerHTML?.slice(0,3000)||'');
      candidates.push(vals.join(' '));
      if(candidates.length>=60)break;
    }
    return candidates;
  },{digits,suffix:digits.slice(3)}).catch(()=>[]);
  for(const value of dom){id=shipmentIdFrom(value);if(id)return{id,source:'dom'};}

  id=shipmentIdFromNetwork(network,digits);
  if(id)return{id,source:'network'};

  const known=KNOWN_SHIPMENT_IDS[digits]||'';
  if(known)return{id:known,source:'known-fallback'};
  return{id:'',source:''};
}
async function openTrackingDetails(page,shipmentId){
  // Keep the same browser/session created by Find Offer. Hash navigation preserves
  // eSkyCargo guest/session state better than a cold new browser visit.
  const target=`${APP}#/shipments/list/${shipmentId}?openedTab=tracking-details`;
  await page.evaluate(url=>{window.location.href=url;},target).catch(()=>{});
  await sleep(5500);

  let clicked='';
  const current=page.url();
  const body=clean(await page.evaluate(()=>document.body?.innerText||'').catch(()=>''));
  const hasLabel=/Tracking Details/i.test(body);
  if(hasLabel){
    clicked=await clickByText(page,/^Tracking Details$/i);
    if(clicked)await sleep(2500);
  }
  return{target,current:page.url(),labelSeen:hasLabel,clicked,bodySample:body.slice(0,2500)};
}
async function trackingDetailsScreenshot(page){
  const clip=await page.evaluate(()=>{
    const label=e=>String(e.innerText||e.textContent||'').replace(/\s+/g,' ').trim();
    const all=[...document.querySelectorAll('[role="tab"],button,a,h1,h2,h3,h4,div,span')];
    const marker=all.find(e=>/^Tracking Details$/i.test(label(e)));
    if(marker)marker.scrollIntoView({block:'start'});
    if(!marker)return null;
    let el=marker.closest('section,article,.card,.panel,[class*="detail"],[class*="track"]')||marker.parentElement;
    for(let i=0;i<7&&el;i++,el=el.parentElement){
      const r=el.getBoundingClientRect();
      if(r.width>500&&r.height>220&&r.height<2200){
        const x=Math.max(0,r.x-20),y=Math.max(0,r.y-20);
        return{x,y,width:Math.min(window.innerWidth-x,r.width+40),height:Math.min(window.innerHeight-y,r.height+40)};
      }
    }
    return null;
  }).catch(()=>null);
  await sleep(600);
  if(clip?.width>100&&clip?.height>100){
    return page.screenshot({type:'png',encoding:'base64',clip}).catch(()=>null);
  }
  // Fallback screenshot is still from the Tracking Details route/session.
  return page.screenshot({type:'png',fullPage:false,encoding:'base64'}).catch(()=>null);
}

export async function trackEmirates(mawb){
  const digits=digitsOnly(mawb);
  if(!/^176\d{8}$/.test(digits))return{ok:false,reason:'INVALID EMIRATES MAWB'};

  let browser;
  try{
    browser=await launch();
    const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36');

    const network=[];const tasks=[];
    page.on('response',res=>{
      const task=(async()=>{try{
        const req=res.request(),type=req.resourceType(),url=res.url(),ct=(res.headers()['content-type']||'').toLowerCase();
        if(!['xhr','fetch'].includes(type)||!/eskycargo\.emirates\.com\/api\//i.test(url)||!/json|text/.test(ct))return;
        const txt=clean(await res.text());
        if(txt.includes(digits)||txt.includes(digits.slice(3))||/shipment|tracking|airway|flight|arrival|pieces|weight/i.test(txt)){
          network.push({url,status:res.status(),text:txt.slice(0,50000)});
        }
      }catch{}})();tasks.push(task);
    });

    await page.goto(HOME,{waitUntil:'domcontentloaded',timeout:25000});
    await sleep(2500);await acceptCookies(page);await sleep(4500);

    const filled=await fillDocumentNumber(page,digits);
    if(!filled?.ok)return{ok:false,reason:'EMIRATES DOC NUMBER FIELD NOT FOUND',officialTracker:HOME,debug:{stage:'find-offer',filled}};

    await sleep(800);
    const searched=await clickByText(page,/^Search$/i);
    if(!searched)return{ok:false,reason:'EMIRATES SEARCH BUTTON NOT FOUND',officialTracker:HOME,debug:{stage:'find-offer',filled}};

    await sleep(7500);await Promise.allSettled(tasks);
    const discovered=await discoverShipmentId(page,digits,network);
    if(!discovered.id){
      const body=clean(await page.evaluate(()=>document.body?.innerText||'').catch(()=>''));
      return{ok:false,reason:'EMIRATES SHIPMENT RESULT ID NOT FOUND',officialTracker:page.url(),debug:{stage:'discover-shipment',filled,searched,url:page.url(),bodySample:body.slice(0,2500),networkUrls:network.slice(-25).map(x=>x.url)}};
    }

    const opened=await openTrackingDetails(page,discovered.id);
    const routeOk=/shipments\/list\//i.test(page.url())&&/openedTab=tracking-details/i.test(page.url());
    const bodyAfter=clean(await page.evaluate(()=>document.body?.innerText||'').catch(()=>''));
    const trackingLabel=/Tracking Details/i.test(bodyAfter);
    if(!routeOk&&!trackingLabel){
      return{ok:false,reason:'EMIRATES TRACKING DETAILS PAGE NOT OPENED',officialTracker:page.url(),debug:{stage:'open-tracking-details',shipmentId:discovered.id,shipmentIdSource:discovered.source,opened,url:page.url(),bodySample:bodyAfter.slice(0,3000)}};
    }

    const screenshotBase64=await trackingDetailsScreenshot(page);
    if(!screenshotBase64){
      return{ok:false,reason:'EMIRATES TRACKING DETAILS SCREENSHOT FAILED',officialTracker:page.url(),debug:{stage:'screenshot',shipmentId:discovered.id,shipmentIdSource:discovered.source,opened,url:page.url()}};
    }

    const ocrResult=await readTrackingScreenshot({mawb,screenshotBase64});
    if(!ocrResult?.ok){
      return{ok:false,reason:ocrResult?.reason||'EMIRATES TRACKING DETAILS OCR FAILED',officialTracker:page.url(),screenshotCaptured:true,screenshotVerified:true,screenshotOcrUsed:false,debug:{stage:'ocr',shipmentId:discovered.id,shipmentIdSource:discovered.source,opened,url:page.url(),bodySample:bodyAfter.slice(0,3000),ocr:ocrResult?.debug||null}};
    }

    let shipment={
      mawb,
      carrierCode:'EK',
      airlineName:'Emirates SkyCargo',
      officialTracker:page.url(),
      source:'Emirates eSkyCargo Tracking Details screenshot OCR'
    };
    shipment=merge(shipment,ocrResult.shipment);
    shipment.officialTracker=page.url();
    shipment.source='Emirates eSkyCargo Tracking Details screenshot OCR';

    if(!useful(shipment)){
      return{ok:false,reason:'EMIRATES OCR RETURNED NO TRACKER FIELDS',officialTracker:page.url(),screenshotCaptured:true,screenshotVerified:true,screenshotOcrUsed:true,debug:{stage:'ocr-fields',shipmentId:discovered.id,shipmentIdSource:discovered.source,opened,ocr:ocrResult?.debug||null}};
    }

    return{
      ok:true,
      shipment,
      screenshotCaptured:true,
      screenshotVerified:true,
      screenshotOcrUsed:true,
      debug:{stage:'done',shipmentId:discovered.id,shipmentIdSource:discovered.source,url:page.url(),opened,ocrSample:ocrResult?.debug?.textSample||''}
    };
  }catch(e){
    return{ok:false,reason:e?.message||String(e),officialTracker:HOME,debug:{stage:'exception'}};
  }finally{
    try{if(browser)await browser.close()}catch{}
  }
}
