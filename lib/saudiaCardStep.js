import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { normalizeMawb } from './airlines.js';

const URL='https://china.saudiacargo.com/e-services/track-shipment';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clean=v=>String(v||'').replace(/\s+/g,' ').trim();
const first=(s,rx)=>(String(s||'').match(rx)||[])[1]||'';

const REPS=[
  [/货物追踪|追踪货物/g,'Track Shipment'],
  [/运单号|空运单号|航空运单号/g,'AWB'],
  [/总件数|件数/g,'Total number of pieces'],
  [/总重量|毛重|重量/g,'Weight'],
  [/航班号|航班/g,'Flight number'],
  [/更多信息|附加信息/g,'More information']
];

function parseInfo(text='',mawb=''){
  const s=clean(text);
  const pieces=first(s,/(?:Total\s+(?:number\s+of\s+)?pieces|Number\s+of\s+pieces|No\.?\s*(?:of)?\s*pieces|Pieces?|Pcs?)\s*[:#\-]?\s*(\d{1,6})\b/i)
    || first(s,/"(?:totalPieces|totalNumberOfPieces|numberOfPieces|pieceCount|pieces)"\s*:\s*"?(\d{1,6})/i);
  const weight=(first(s,/(?:Gross\s+Weight|Total\s+Weight|Weight)\s*[:#\-]?\s*([\d,.]+)\s*(?:kg|kgs|kilograms?)?\b/i)
    || first(s,/"(?:grossWeight|totalWeight|weight)"\s*:\s*"?([\d,.]+)/i)).replace(/,/g,'');
  const flightDigits=first(s,/(?:Flight\s+(?:number|no\.?|#)?|Flight)\s*[:#\-]?\s*SV\s*[- ]?(\d{2,4})\b/i)
    || first(s,/"(?:flightNo|flightNumber|flight)"\s*:\s*"?SV\s*[- ]?(\d{2,4})/i)
    || first(s,/\bSV\s*[- ]?(\d{2,4})\b/i);
  const flightNo=flightDigits?`SV${flightDigits}`:'';
  return {mawb,carrierCode:'SV',airlineName:'Saudia Cargo',bags:pieces,pieces,weight,flightNo,status:'TRACKING',officialTracker:URL,source:'Saudia verified AWB result — pieces, weight and flight only'};
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

async function translateEnglish(page){
  const pairs=REPS.map(([rx,r])=>[rx.source,rx.flags,r]);
  await page.evaluate(p=>{
    const reps=p.map(([src,flags,r])=>[new RegExp(src,flags),r]);
    const apply=v=>{let s=String(v||'');for(const [rx,r] of reps)s=s.replace(rx,r);return s};
    const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let n;
    while((n=w.nextNode()))n.nodeValue=apply(n.nodeValue||'');
    for(const e of document.querySelectorAll('[placeholder],[aria-label],[title]'))for(const a of ['placeholder','aria-label','title']){const v=e.getAttribute(a);if(v)e.setAttribute(a,apply(v));}
    document.documentElement.lang='en';
  },pairs).catch(()=>{});
}

async function markAwb(page){
  return page.evaluate(()=>{
    const vis=e=>{try{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>20&&r.height>10&&!e.disabled}catch{return false}};
    const inputs=[...document.querySelectorAll('input')].filter(vis).filter(e=>!['hidden','checkbox','radio','submit','button'].includes(String(e.type||'text').toLowerCase()));
    const input=inputs.find(e=>/awb|airway|shipment|065-000000/i.test(`${e.placeholder||''} ${e.name||''} ${e.id||''} ${e.getAttribute('aria-label')||''}`))||inputs[0];
    if(!input)return false;input.dataset.mayaviAwb='1';return true;
  }).catch(()=>false);
}

async function clickArrow(page){
  const found=await page.evaluate(()=>{
    const a=document.querySelector('[data-mayavi-awb="1"]');if(!a)return false;
    const vis=e=>{try{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>8&&r.height>8&&!e.disabled}catch{return false}};
    const ar=a.getBoundingClientRect(),acy=ar.top+ar.height/2;
    const form=a.closest('form');
    let x=form?.querySelector('button[type="submit"],input[type="submit"]')||null;
    if(!x){
      let scope=a.parentElement;
      for(let i=0;i<4&&scope;i++,scope=scope.parentElement){
        const c=[...scope.querySelectorAll('button,[role="button"],a,input[type="submit"]')].filter(vis).map(e=>({e,r:e.getBoundingClientRect()})).filter(v=>v.r.left>=ar.right-40&&v.r.left<=ar.right+220&&Math.abs(v.r.top+v.r.height/2-acy)<90).sort((m,n)=>Math.abs(m.r.left-ar.right)-Math.abs(n.r.left-ar.right));
        if(c.length){x=c[0].e;break;}
      }
    }
    if(!x)return false;x.dataset.mayaviArrow='1';return true;
  }).catch(()=>false);
  if(found){await page.click('[data-mayavi-arrow="1"]').catch(()=>page.evaluate(()=>document.querySelector('[data-mayavi-arrow="1"]')?.click()).catch(()=>{}));return true;}
  await page.focus('[data-mayavi-awb="1"]').catch(()=>{});await page.keyboard.press('Enter').catch(()=>{});return true;
}

async function resultRowText(page,mawb,mark=false){
  const digits=String(mawb).replace(/\D/g,''),serial=digits.slice(3);
  return page.evaluate(({digits,serial,mark})=>{
    const vis=e=>{try{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>20&&r.height>10}catch{return false}};
    const txt=e=>String(e?.innerText||e?.textContent||'').replace(/\s+/g,' ').trim();
    const all=[...document.querySelectorAll('tr,[role="row"],li,[class*="row"],[class*="card"],section,article,div')].filter(vis).map(e=>({e,t:txt(e)}));
    const rows=all.filter(v=>v.t.length>=10&&v.t.length<=3000).filter(v=>{const nd=v.t.replace(/\D/g,'');const hasAwb=nd.includes(digits)||nd.includes(serial);const hasPieces=/(?:Total\s+(?:number\s+of\s+)?pieces|Number\s+of\s+pieces|Pieces?|Pcs?|件数)\s*[:#\-]?\s*\d{1,6}\b/i.test(v.t);return hasAwb&&hasPieces;}).sort((a,b)=>a.t.length-b.t.length);
    const row=rows[0];if(!row)return'';if(mark)row.e.dataset.mayaviResultRow='1';return row.t;
  },{digits,serial,mark}).catch(()=> '');
}

async function waitForResultRow(page,mawb){
  for(let i=0;i<18;i++){const t=await resultRowText(page,mawb,true);if(t)return t;await sleep(500);}return'';
}

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
    const good=all.filter(v=>v.t.length>=15&&v.t.length<=5000).filter(v=>/(weight|重量)/i.test(v.t)||/(flight|航班)/i.test(v.t)).filter(v=>/(?:weight|重量)\s*[:#\-]?\s*[\d,.]+/i.test(v.t)||/(?:flight|航班)[^A-Z0-9]{0,20}SV\s*[- ]?\d{2,4}/i.test(v.t)||/\bSV\s*[- ]?\d{2,4}\b/i.test(v.t)).sort((a,b)=>a.t.length-b.t.length);
    return good[0]?.t||'';
  }).catch(()=> '');
}

function relevantNetwork(network=[],mawb=''){
  const digits=String(mawb).replace(/\D/g,''),serial=digits.slice(3);
  return network.filter(x=>{const hay=`${x.url||''} ${x.text||''}`.replace(/\D/g,'');return hay.includes(digits)||hay.includes(serial);}).map(x=>x.text||'').join('\n');
}

export async function trackSaudiaCardStep(input){
  const mawb=normalizeMawb(input);
  if(!mawb||!mawb.startsWith('065-'))return{ok:false,reason:'INVALID SAUDIA MAWB',officialTracker:URL};
  let browser;
  try{
    chromium.setGraphicsMode=false;
    browser=await puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox','--lang=en-US,en','--window-size=1440,1100'],defaultViewport:{width:1440,height:1100},executablePath:await chromium.executablePath(),headless:'shell'});
    const page=await browser.newPage(),network=[];
    await page.setExtraHTTPHeaders({'Accept-Language':'en-US,en;q=0.9'});
    page.on('response',async r=>{try{const u=r.url(),ct=r.headers()['content-type']||'';if(network.length>=60||(!/track|shipment|awb|cargo|flight/i.test(u)&&!/json/i.test(ct)))return;const t=await r.text();if(t&&t.length<220000)network.push({url:u,text:t});}catch{}});
    const digits=mawb.replace(/\D/g,'');
    await page.goto(`${URL}?awbNumber=${encodeURIComponent(digits)}`,{waitUntil:'domcontentloaded',timeout:28000});
    await sleep(1500);await translateEnglish(page);
    if(!await markAwb(page))return{ok:false,reason:'SAUDIA AWB INPUT NOT FOUND',officialTracker:URL};
    await page.click('[data-mayavi-awb="1"]',{clickCount:3}).catch(()=>{});await page.keyboard.press('Control+A').catch(()=>{});await page.keyboard.press('Backspace').catch(()=>{});await page.type('[data-mayavi-awb="1"]',mawb,{delay:12});
    await clickArrow(page);await sleep(700);await translateEnglish(page);

    const rowText=await waitForResultRow(page,mawb);
    const net1=relevantNetwork(network,mawb);
    if(!rowText&&!net1){
      const screenshotBase64=await page.screenshot({type:'png',fullPage:false,encoding:'base64'}).catch(()=>null);
      return{ok:false,reason:'SAUDIA VERIFIED AWB RESULT CARD NOT FOUND',officialTracker:URL,screenshotBase64,debug:{stage:'NO_VERIFIED_AWB_RESULT',sample:clean(await page.evaluate(()=>document.body?.innerText||'').catch(()=>'' )).slice(0,1400),networkUrls:network.map(x=>x.url).slice(-15)}};
    }

    let shipment=parseInfo(`${rowText}\n${net1}`,mawb);
    let moreClicked=false,detail='';
    if(!complete(shipment)&&rowText){
      moreClicked=await clickMore(page);
      if(moreClicked){await sleep(1300);await translateEnglish(page);detail=await detailsText(page);shipment=mergeCore(shipment,parseInfo(`${detail}\n${relevantNetwork(network,mawb)}`,mawb));}
    }
    const screenshotBase64=await page.screenshot({type:'png',fullPage:false,encoding:'base64'}).catch(()=>null);
    if(!useful(shipment))return{ok:false,reason:'SAUDIA VERIFIED RESULT DID NOT SHOW PIECES / WEIGHT / FLIGHT',officialTracker:URL,screenshotBase64,debug:{stage:'VERIFIED_RESULT_NO_CORE_FIELDS',moreClicked,row:clean(rowText).slice(0,1000),detail:clean(detail).slice(0,1000),networkUrls:network.map(x=>x.url).slice(-15)}};
    return{ok:true,shipment,screenshotBase64,debug:{stage:complete(shipment)?'ALL_3_VERIFIED_CORE_FIELDS_FOUND':'PARTIAL_VERIFIED_CORE_FIELDS_FOUND',moreClicked,row:clean(rowText).slice(0,1000),detail:clean(detail).slice(0,1000),networkUrls:network.map(x=>x.url).slice(-15)}};
  }catch(e){return{ok:false,reason:`SAUDIA CARD STEP ERROR: ${e?.message||e}`,officialTracker:URL};}
  finally{try{if(browser)await browser.close()}catch{}}
}
