import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { readTrackingScreenshot } from './screenshotOcr.js';

const HOME='https://eskycargo.emirates.com/app/offerandorder/#/home/find-offer';
const APP='https://eskycargo.emirates.com/app/offerandorder/';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
const digitsOnly=s=>String(s||'').replace(/\D/g,'');

function merge(base={},next={}){
  const out={...base};
  for(const [k,v] of Object.entries(next||{})) if(v!==''&&v!==null&&v!==undefined) out[k]=v;
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
    const text=String(item.text||'');const i=text.indexOf(digits);
    if(i>=0){
      const near=text.slice(Math.max(0,i-1200),Math.min(text.length,i+2500));
      const named=shipmentIdFrom(near);if(named)return named;
      const generic=near.match(/["']id["']\s*:\s*["']?(\d{6,12})/i);if(generic)return generic[1];
    }
  }
  return'';
}
async function launch(){
  chromium.setGraphicsMode=false;
  return puppeteer.launch({
    args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox'],
    defaultViewport:{width:1440,height:1000,deviceScaleFactor:1},
    executablePath:await chromium.executablePath(),headless:'shell'
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
  const selector='input[placeholder*="Doc. No."]';
  const input=await page.$(selector);
  if(input){await input.click({clickCount:3});await input.type(digits,{delay:15});return{ok:true,selector};}
  return page.evaluate(value=>{
    const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};
    const all=[...document.querySelectorAll('input')].filter(visible);
    const input=all.find(e=>/doc|awb|air.?way/i.test(`${e.placeholder||''} ${e.name||''} ${e.id||''} ${e.getAttribute('aria-label')||''}`));
    if(!input)return{ok:false};
    const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
    input.focus();setter?.call(input,'');input.dispatchEvent(new Event('input',{bubbles:true}));setter?.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
    return{ok:true,selector:'semantic',value:input.value};
  },digits).catch(()=>({ok:false}));
}
async function clickByText(page,rx){
  return page.evaluate((source,flags)=>{
    const re=new RegExp(source,flags);const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};
    const label=e=>String(e.innerText||e.getAttribute('aria-label')||e.getAttribute('title')||'').replace(/\s+/g,' ').trim();
    const els=[...document.querySelectorAll('button,a,[role="button"],[role="tab"],span')].filter(visible);
    const e=els.find(x=>re.test(label(x)));if(!e)return'';
    const target=e.closest('button,a,[role="button"],[role="tab"]')||e;target.click();return label(e);
  },rx.source,rx.flags).catch(()=> '');
}
async function waitForShipmentOrTracking(page){
  await page.waitForFunction(()=>{
    if(/shipments\/list\//i.test(location.href))return true;
    return [...document.querySelectorAll('[role="tab"],button,a,h1,h2,h3,h4,div,span')].some(e=>/^Tracking Details$/i.test(String(e.innerText||e.textContent||'').replace(/\s+/g,' ').trim()));
  },{timeout:8000}).catch(()=>{});
}
async function openShipmentResult(page,digits,network){
  const suffix=digits.slice(3);
  const result=await page.evaluate(({digits,suffix})=>{
    const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};
    const text=e=>String(e.innerText||e.textContent||'').replace(/\s+/g,' ').trim();
    const norm=e=>text(e).replace(/\D/g,'');

    const shipmentLinks=[...document.querySelectorAll('a[href*="shipments/list"],a[href*="/shipments/"]')].filter(visible);
    const direct=shipmentLinks.find(a=>norm(a).includes(digits)||norm(a).includes(suffix))||shipmentLinks[0];
    if(direct){const href=direct.href||direct.getAttribute('href')||'';direct.click();return{clicked:'shipment-link',href,text:text(direct).slice(0,500)};}

    const rows=[...document.querySelectorAll('tr,[role="row"],.mat-row,[class*="table-row"],[class*="result-row"],[class*="shipment-row"]')].filter(visible);
    const row=rows.find(r=>norm(r).includes(digits)||norm(r).includes(suffix));
    if(row){
      const controls=[...row.querySelectorAll('a[href],button,[role="button"],[tabindex]')].filter(visible);
      const preferred=controls.find(c=>/detail|track|shipment|open|view/i.test(text(c)))||controls.find(c=>/shipments\/list/i.test(c.getAttribute('href')||''))||controls[0];
      const target=preferred||row;
      const href=target.href||target.getAttribute?.('href')||'';
      target.click();
      return{clicked:preferred?'row-control':'row',href,text:text(row).slice(0,700)};
    }

    const exact=[...document.querySelectorAll('a,button,[role="button"],[tabindex],td,div,span')].filter(visible).find(e=>{const d=norm(e);return d===digits||d===suffix||d.includes(digits)||d.includes(suffix);});
    if(exact){
      const container=exact.closest('tr,[role="row"],.mat-row,[class*="row"],[class*="result"],[class*="shipment"]');
      if(container){
        const controls=[...container.querySelectorAll('a[href],button,[role="button"],[tabindex]')].filter(visible);
        const preferred=controls.find(c=>/detail|track|shipment|open|view/i.test(text(c)))||controls[0];
        if(preferred){const href=preferred.href||preferred.getAttribute('href')||'';preferred.click();return{clicked:'nearest-control',href,text:text(container).slice(0,700)};}
      }
      const target=exact.closest('a,button,[role="button"],[tabindex]')||exact;
      const href=target.href||target.getAttribute?.('href')||'';target.click();return{clicked:'mawb-element',href,text:text(target).slice(0,500)};
    }
    return{clicked:'',href:'',text:''};
  },{digits,suffix}).catch(()=>({clicked:'',href:'',text:''}));

  if(result.clicked){await sleep(1500);await waitForShipmentOrTracking(page);}

  let shipmentId=shipmentIdFrom(page.url())||shipmentIdFrom(result.href);
  if(!shipmentId){
    shipmentId=await page.evaluate(()=>{
      const a=[...document.querySelectorAll('a[href*="shipments/list"]')][0];
      const href=a?.href||a?.getAttribute('href')||'';const m=href.match(/shipments\/list\/(\d{6,12})/i);return m?.[1]||'';
    }).catch(()=> '');
  }
  if(!shipmentId)shipmentId=shipmentIdFromNetwork(network,digits);

  return{...result,shipmentId,deepLink:false,url:page.url()};
}
async function trackingPanelText(page){
  return page.evaluate(()=>{
    const label=e=>String(e.innerText||e.textContent||'').replace(/\s+/g,' ').trim();
    const marker=[...document.querySelectorAll('[role="tab"],button,a,h1,h2,h3,h4,div,span')].find(e=>/^Tracking Details$/i.test(label(e)));
    if(!marker)return'';
    let el=marker.closest('section,article,.card,.panel,[class*="detail"],[class*="track"]')||marker.parentElement;
    let best='';
    for(let i=0;i<6&&el;i++,el=el.parentElement){const t=label(el);if(t.length>best.length&&t.length<18000)best=t;}
    return best;
  }).catch(()=> '');
}
async function trackingDetailsScreenshot(page){
  const clip=await page.evaluate(()=>{
    const label=e=>String(e.innerText||e.textContent||'').replace(/\s+/g,' ').trim();
    const marker=[...document.querySelectorAll('[role="tab"],button,a,h1,h2,h3,h4,div,span')].find(e=>/^Tracking Details$/i.test(label(e)));
    if(!marker)return null;
    let el=marker.closest('section,article,.card,.panel,[class*="detail"],[class*="track"]')||marker.parentElement;
    for(let i=0;i<6&&el;i++,el=el.parentElement){
      const r=el.getBoundingClientRect();
      if(r.width>520&&r.height>220&&r.height<1800){
        const x=Math.max(0,r.x-16),y=Math.max(0,r.y-16);
        return{x,y,width:Math.min(window.innerWidth-x,r.width+32),height:Math.min(window.innerHeight-y,r.height+32)};
      }
    }
    return null;
  }).catch(()=>null);
  if(clip?.width>100&&clip?.height>100)return page.screenshot({type:'png',encoding:'base64',clip}).catch(()=>null);
  return page.screenshot({type:'png',fullPage:false,encoding:'base64'}).catch(()=>null);
}

export async function trackEmirates(mawb){
  const digits=digitsOnly(mawb);
  if(!/^176\d{8}$/.test(digits))return{ok:false,reason:'INVALID EMIRATES MAWB'};
  let browser;
  try{
    browser=await launch();const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36');
    const network=[];const tasks=[];
    page.on('response',res=>{
      const task=(async()=>{try{
        const req=res.request(),type=req.resourceType(),url=res.url(),ct=(res.headers()['content-type']||'').toLowerCase();
        if(!['xhr','fetch'].includes(type)||!/eskycargo\.emirates\.com\/api\//i.test(url)||!/json|text/.test(ct))return;
        const txt=clean(await res.text());
        if(txt.includes(digits)||/shipment|tracking|airway|flight|arrival|pieces|weight/i.test(txt))network.push({url,status:res.status(),text:txt.slice(0,40000)});
      }catch{}})();tasks.push(task);
    });

    await page.goto(HOME,{waitUntil:'domcontentloaded',timeout:20000});await sleep(2500);await acceptCookies(page);await sleep(4500);
    const filled=await fillDocumentNumber(page,digits);
    if(!filled?.ok)return{ok:false,reason:'EMIRATES DOC NUMBER FIELD NOT FOUND',officialTracker:HOME,debug:{stage:'find-offer'}};
    const searched=await clickByText(page,/^Search$/i);
    if(!searched)return{ok:false,reason:'EMIRATES SEARCH BUTTON NOT FOUND',officialTracker:HOME,debug:{stage:'find-offer',filled}};
    await sleep(7000);await Promise.allSettled(tasks);

    const opened=await openShipmentResult(page,digits,network);
    let trackingDetails='';
    trackingDetails=await clickByText(page,/^Tracking Details$/i);
    if(trackingDetails)await sleep(3500);

    if(!trackingDetails&&opened.shipmentId){
      const deep=`${APP}#/shipments/list/${opened.shipmentId}?openedTab=tracking-details`;
      await page.goto(deep,{waitUntil:'domcontentloaded',timeout:20000});await sleep(4500);
      const visibleAfterDeep=await trackingPanelText(page);
      if(visibleAfterDeep)trackingDetails='deep-link-fallback';
    }

    const panelText=clean(await trackingPanelText(page));
    if(!trackingDetails&&!panelText)return{ok:false,reason:'EMIRATES TRACKING DETAILS TAB NOT FOUND',officialTracker:page.url(),debug:{stage:'open-shipment',filled,searched,opened,url:page.url(),networkUrls:network.slice(-20).map(x=>x.url)}};

    const screenshotBase64=await trackingDetailsScreenshot(page);
    if(!screenshotBase64)return{ok:false,reason:'EMIRATES TRACKING DETAILS SCREENSHOT FAILED',officialTracker:page.url(),debug:{stage:'screenshot',opened,trackingDetails,url:page.url()}};

    const ocrResult=await readTrackingScreenshot({mawb,screenshotBase64});
    if(!ocrResult?.ok)return{ok:false,reason:ocrResult?.reason||'EMIRATES TRACKING DETAILS OCR FAILED',officialTracker:page.url(),screenshotCaptured:true,debug:{stage:'ocr',opened,trackingDetails,url:page.url(),panelSample:panelText.slice(0,2500),ocr:ocrResult?.debug||null}};

    let shipment={mawb,carrierCode:'EK',airlineName:'Emirates SkyCargo',officialTracker:page.url(),source:'Emirates eSkyCargo Tracking Details screenshot OCR'};
    shipment=merge(shipment,ocrResult.shipment);
    shipment.officialTracker=page.url();
    shipment.source='Emirates eSkyCargo Tracking Details screenshot OCR';
    if(!useful(shipment))return{ok:false,reason:'EMIRATES OCR RETURNED NO TRACKER FIELDS',officialTracker:page.url(),screenshotCaptured:true,debug:{stage:'ocr-fields',opened,trackingDetails,ocr:ocrResult?.debug||null}};

    return{ok:true,shipment,screenshotCaptured:true,screenshotVerified:true,screenshotOcrUsed:true,debug:{stage:'done',url:page.url(),filled,searched,opened,trackingDetails,shipmentId:opened.shipmentId||'',ocrSample:ocrResult?.debug?.textSample||'',networkUrls:network.slice(-20).map(x=>x.url)}};
  }catch(e){return{ok:false,reason:e?.message||String(e),officialTracker:HOME,debug:{stage:'exception'}};}
  finally{try{if(browser)await browser.close()}catch{}}
}
