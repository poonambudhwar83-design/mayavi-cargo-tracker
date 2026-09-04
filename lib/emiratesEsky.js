import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const HOME='https://eskycargo.emirates.com/app/offerandorder/#/home/find-offer';
const APP='https://eskycargo.emirates.com/app/offerandorder/';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
const digitsOnly=s=>String(s||'').replace(/\D/g,'');
const pad=v=>String(v).padStart(2,'0');
const MONTH={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};

function parseDate(s=''){
  const t=String(s).toUpperCase();
  let m=t.match(/(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})/);if(m)return`${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m=t.match(/(\d{1,2})[-\/.](\d{1,2})[-\/.](20\d{2})/);if(m)return`${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  m=t.match(/(\d{1,2})[\s\-]+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s\-,]+(20\d{2})/);if(m)return`${m[3]}-${MONTH[m[2]]}-${pad(m[1])}`;
  m=t.match(/(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s\-]+(\d{1,2})[\s\-,]+(20\d{2})/);if(m)return`${m[3]}-${MONTH[m[1]]}-${pad(m[2])}`;
  return'';
}
function parseTime(s=''){const m=String(s).match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);return m?`${pad(m[1])}:${m[2]}`:'';}
function around(text,rx,before=160,after=420){const m=rx.exec(text);if(!m)return'';return text.slice(Math.max(0,m.index-before),Math.min(text.length,m.index+after));}
function parseVisibleText(text='',mawb=''){
  const flat=clean(text),upper=flat.toUpperCase();
  const route=upper.match(/\bORIGIN\b\s*[:\-]?\s*([A-Z]{3})\b[\s\S]{0,160}?\bDESTINATION\b\s*[:\-]?\s*([A-Z]{3})\b/)||upper.match(/\b([A-Z]{3})\s*(?:→|->|—|-)\s*([A-Z]{3})\b/);
  const pieces=(flat.match(/(?:Pieces?|Pcs?|No\.?\s*of\s*Pieces)\s*[:\-]?\s*(\d{1,6})/i)||[])[1]||'';
  const weight=((flat.match(/(?:Gross\s*Weight|Weight)\s*[:\-]?\s*([\d,.]+)\s*(?:KG|KGS)?/i)||[])[1]||'').replace(/,/g,'');
  const fm=upper.match(/\bEK\s*[- ]?(\d{2,4})\b/);const flightNo=fm?`EK${fm[1]}`:'';
  const actual=around(flat,/ACTUAL\s+ARRIVAL|ARRIVED|LANDED|RECEIVED\s+FROM\s+FLIGHT|\bRCF\b/i);
  const eta=around(flat,/ETA|ESTIMATED\s+ARRIVAL|SCHEDULED\s+ARRIVAL|EXPECTED\s+ARRIVAL/i);
  let arrivalDate=parseDate(actual),arrivalTime=parseTime(actual),arrivalIsActual=Boolean(arrivalDate||arrivalTime);
  if(!arrivalDate&&!arrivalTime){arrivalDate=parseDate(eta);arrivalTime=parseTime(eta);arrivalIsActual=false;}
  let status='';
  if(/\bDELIVERED\b|\bDLV\b/i.test(actual||flat))status='DELIVERED';
  else if(/ACTUAL\s+ARRIVAL|\bARRIVED\b|\bLANDED\b|RECEIVED\s+FROM\s+FLIGHT|\bRCF\b/i.test(actual||flat))status='ARRIVED';
  else if(/\bDEPARTED\b|\bDEP\b|IN\s+TRANSIT/i.test(flat))status='IN TRANSIT';
  else if(/\bBOOKED\b|\bRCS\b|ACCEPTED/i.test(flat))status='BOOKED';
  const serial=digitsOnly(mawb).slice(3);const awbMatched=Boolean(serial&&digitsOnly(flat).includes(serial));
  return{mawb,carrierCode:'EK',airlineName:'Emirates SkyCargo',origin:route?.[1]||'',destination:route?.[2]||'',bags:pieces,pieces,weight,flightNo,arrivalDate,arrivalTime,arrivalIsActual,status,officialTracker:HOME,source:'Emirates eSkyCargo live page',awbMatched};
}
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
  const inputs=await page.$$('input');
  for(const input of inputs){
    const info=await input.evaluate(e=>{
      const r=e.getBoundingClientRect(),s=getComputedStyle(e);
      return{
        visible:r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none',
        label:`${e.placeholder||''} ${e.name||''} ${e.id||''} ${e.getAttribute('aria-label')||''}`,
        value:e.value||'',placeholder:e.placeholder||'',name:e.name||'',id:e.id||''
      };
    }).catch(()=>null);
    if(!info?.visible||!/doc|awb|air.?way/i.test(info.label))continue;
    await input.click({clickCount:3}).catch(()=>{});
    await page.keyboard.press('Backspace').catch(()=>{});
    await input.type(digits,{delay:30}).catch(()=>{});
    await page.keyboard.press('Tab').catch(()=>{});
    const value=await input.evaluate(e=>e.value||'').catch(()=> '');
    if(value)return{ok:true,selector:'visible-document-input',value,placeholder:info.placeholder,name:info.name,id:info.id};
  }
  return{ok:false};
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
    if(!filled?.ok)return{ok:false,reason:'EMIRATES DOC NUMBER FIELD NOT FOUND',officialTracker:HOME,debug:{stage:'find-offer',filled}};
    await sleep(700);
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
    const body=clean(await page.evaluate(()=>document.body?.innerText||'').catch(()=>''));
    if(!trackingDetails&&!panelText)return{ok:false,reason:'EMIRATES TRACKING DETAILS TAB NOT FOUND',officialTracker:page.url(),debug:{stage:'open-shipment',filled,searched,opened,url:page.url(),bodySample:body.slice(0,2200),networkUrls:network.slice(-20).map(x=>x.url)}};

    const screenshotBase64=await trackingDetailsScreenshot(page);
    const networkText=network.map(x=>x.text).join(' ');
    const networkShipment=parseVisibleText(networkText,mawb);
    const visibleShipment=parseVisibleText(panelText||body,mawb);
    let shipment={mawb,carrierCode:'EK',airlineName:'Emirates SkyCargo',officialTracker:page.url(),source:'Emirates eSkyCargo live page'};
    shipment=merge(shipment,networkShipment);
    shipment=merge(shipment,visibleShipment);
    shipment.officialTracker=page.url();
    shipment.source='Emirates eSkyCargo live page';
    if(/ACTUAL\s+ARRIVAL|\bARRIVED\b|\bLANDED\b|RECEIVED\s+FROM\s+FLIGHT|\bRCF\b/i.test(panelText||body))shipment.status='ARRIVED';
    if(!useful(shipment))return{ok:false,reason:'EMIRATES TRACKING DETAILS FOUND NO SHIPMENT FIELDS',officialTracker:page.url(),screenshotCaptured:Boolean(screenshotBase64),debug:{stage:'parse-fields',opened,trackingDetails,url:page.url(),panelSample:panelText.slice(0,2500),bodySample:body.slice(0,2500),networkUrls:network.slice(-20).map(x=>x.url)}};

    return{ok:true,shipment,screenshotCaptured:Boolean(screenshotBase64),screenshotVerified:Boolean(screenshotBase64),screenshotOcrUsed:false,debug:{stage:'done',url:page.url(),filled,searched,opened,trackingDetails,shipmentId:opened.shipmentId||'',panelSample:panelText.slice(0,2500),networkUrls:network.slice(-20).map(x=>x.url)}};
  }catch(e){return{ok:false,reason:e?.message||String(e),officialTracker:HOME,debug:{stage:'exception'}};}
  finally{try{if(browser)await browser.close()}catch{}}
}
