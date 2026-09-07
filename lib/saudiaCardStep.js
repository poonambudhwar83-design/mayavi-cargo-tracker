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
  const s=clean(text), upper=s.toUpperCase();
  const pieces=first(s,/(?:Total\s+(?:number\s+of\s+)?pieces|Number\s+of\s+pieces|No\.?\s*(?:of)?\s*pieces|Pieces?|Pcs?)\s*[:#\-]?\s*(\d{1,6})\b/i)
    || first(s,/\b(\d{1,6})\s*(?:pieces?|pcs?)\b/i)
    || first(s,/"(?:totalPieces|totalNumberOfPieces|numberOfPieces|pieceCount|pieces)"\s*:\s*"?(\d{1,6})/i);
  const weight=(first(s,/(?:Gross\s+Weight|Total\s+Weight|Weight)\s*[:#\-]?\s*([\d,.]+)\s*(?:kg|kgs|kilograms?)?\b/i)
    || first(s,/\b([\d,.]+)\s*(?:kg|kgs|kilograms?)\b/i)
    || first(s,/"(?:grossWeight|totalWeight|weight)"\s*:\s*"?([\d,.]+)/i)).replace(/,/g,'');
  const flightDigits=first(s,/(?:Flight\s+(?:number|no\.?|#)?|Flight)\s*[:#\-]?\s*SV\s*[- ]?(\d{2,4})\b/i)
    || first(s,/\bSV\s*[- ]?(\d{2,4})\b/i)
    || first(s,/"(?:flightNo|flightNumber|flight)"\s*:\s*"?SV\s*[- ]?(\d{2,4})/i);
  const flightNo=flightDigits?`SV${flightDigits}`:'';
  return {
    mawb,
    carrierCode:'SV',
    airlineName:'Saudia Cargo',
    bags:pieces,
    pieces,
    weight,
    flightNo,
    status:'TRACKING',
    officialTracker:URL,
    source:'Saudia result — pieces, weight and flight only'
  };
}
function useful(s={}){return Boolean(s.pieces||s.weight||s.flightNo);}

async function translateEnglish(page){
  const pairs=REPS.map(([rx,r])=>[rx.source,rx.flags,r]);
  await page.evaluate(p=>{
    const reps=p.map(([src,flags,r])=>[new RegExp(src,flags),r]);
    const apply=v=>{let s=String(v||'');for(const [rx,r] of reps)s=s.replace(rx,r);return s};
    const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let n;
    while((n=w.nextNode()))n.nodeValue=apply(n.nodeValue||'');
    for(const e of document.querySelectorAll('[placeholder],[aria-label],[title]')){
      for(const a of ['placeholder','aria-label','title']){const v=e.getAttribute(a);if(v)e.setAttribute(a,apply(v));}
    }
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
  const ok=await page.evaluate(()=>{
    const a=document.querySelector('[data-mayavi-awb="1"]');if(!a)return false;
    const r=a.getBoundingClientRect(),cy=r.top+r.height/2;
    const vis=e=>{try{const s=getComputedStyle(e),q=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&q.width>8&&q.height>8&&!e.disabled}catch{return false}};
    const text=e=>(e.innerText||e.value||e.getAttribute?.('aria-label')||e.title||'').replace(/\s+/g,' ').trim();
    const els=[...document.querySelectorAll('button,[role="button"],a,input[type="submit"],svg')].filter(vis).map(e=>{const x=e.closest('button,[role="button"],a,input[type="submit"]')||e,q=x.getBoundingClientRect();return{x,q,t:text(x)}});
    let p=els.find(v=>/^(→|›|>|track|search|go)$/i.test(v.t)||/track\s*shipment/i.test(v.t));
    if(!p)p=els.filter(v=>v.q.left>=r.right-35&&v.q.left<=r.right+240&&Math.abs(v.q.top+v.q.height/2-cy)<100).sort((x,y)=>Math.abs(x.q.top+x.q.height/2-cy)-Math.abs(y.q.top+y.q.height/2-cy))[0];
    if(!p)return false;p.x.dataset.mayaviArrow='1';return true;
  }).catch(()=>false);
  if(!ok)return false;
  await page.click('[data-mayavi-arrow="1"]').catch(()=>page.evaluate(()=>document.querySelector('[data-mayavi-arrow="1"]')?.click()).catch(()=>{}));
  return true;
}

async function clickMore(page,mawb){
  const digits=String(mawb).replace(/\D/g,''),serial=digits.slice(3);
  const ok=await page.evaluate(({digits,serial})=>{
    const vis=e=>{try{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>8&&r.height>8}catch{return false}};
    const txt=e=>(e?.innerText||e?.textContent||e?.getAttribute?.('aria-label')||e?.title||'').replace(/\s+/g,' ').trim();
    const moreRx=/more\s+information|附加信息|更多信息/i;
    const awb=document.querySelector('[data-mayavi-awb="1"]');
    let scope=awb?.parentElement||document.body;
    for(let i=0;i<7&&scope?.parentElement;i++){
      const t=txt(scope);
      if(/track\s*shipment|货物追踪/i.test(t)&&/(total\s+number\s+of\s+pieces|件数)/i.test(t)&&t.length<7000)break;
      scope=scope.parentElement;
    }
    const all=[...scope.querySelectorAll('button,[role="button"],a,[tabindex],div,span')].filter(vis);
    let x=null;
    const row=[...scope.querySelectorAll('tr,[role="row"],li,.row,.card,div')].filter(vis).find(e=>{const t=txt(e).replace(/\D/g,'');return (t.includes(digits)||t.includes(serial))&&txt(e).length<2500;});
    if(row){
      x=[...row.querySelectorAll('button,[role="button"],a,[tabindex],span,div')].filter(vis).find(e=>moreRx.test(txt(e)))||null;
    }
    if(!x){
      const candidates=all.filter(e=>moreRx.test(txt(e))).map(e=>({e,r:e.getBoundingClientRect(),t:txt(e)}));
      const ar=awb?.getBoundingClientRect();
      candidates.sort((a,b)=>{
        const as=(ar&&a.r.top>=ar.top-40?0:10000)+Math.abs((a.r.top||0)-(ar?.top||0));
        const bs=(ar&&b.r.top>=ar.top-40?0:10000)+Math.abs((b.r.top||0)-(ar?.top||0));
        return as-bs;
      });
      x=candidates[0]?.e||null;
    }
    if(!x)return false;
    x=x.closest('button,[role="button"],a,[tabindex]')||x;
    x.dataset.mayaviMore='1';return true;
  },{digits,serial}).catch(()=>false);
  if(!ok)return false;
  await page.click('[data-mayavi-more="1"]').catch(()=>page.evaluate(()=>document.querySelector('[data-mayavi-more="1"]')?.click()).catch(()=>{}));
  return true;
}

async function infoText(page){
  return page.evaluate(()=>{
    const vis=e=>{try{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>1&&r.height>1}catch{return false}};
    const norm=v=>String(v||'').replace(/\s+/g,' ').trim();
    const out=[document.body?.innerText||''];
    const labels=/pieces?|pcs?|weight|flight|件数|重量|航班/i;
    for(const e of [...document.querySelectorAll('*')].filter(vis)){
      const t=norm(e.innerText||e.textContent||'');
      if(!t||t.length>160||!labels.test(t))continue;
      const parent=norm(e.parentElement?.innerText||'');
      const prev=norm(e.previousElementSibling?.innerText||e.previousElementSibling?.textContent||'');
      const next=norm(e.nextElementSibling?.innerText||e.nextElementSibling?.textContent||'');
      out.push(t,parent.slice(0,400),prev,next);
    }
    return out.filter(Boolean).join('\n');
  }).catch(()=> '');
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
    page.on('response',async r=>{
      try{
        const u=r.url(),ct=r.headers()['content-type']||'';
        if(network.length>=30||(!/track|shipment|awb|cargo/i.test(u)&&!/json/i.test(ct)))return;
        const t=await r.text();if(t&&t.length<180000)network.push({url:u,text:t});
      }catch{}
    });
    const digits=mawb.replace(/\D/g,'');
    await page.goto(`${URL}?awbNumber=${encodeURIComponent(digits)}`,{waitUntil:'domcontentloaded',timeout:28000});
    await sleep(1800);await translateEnglish(page);
    if(!await markAwb(page))return{ok:false,reason:'SAUDIA AWB INPUT NOT FOUND',officialTracker:URL};
    await page.click('[data-mayavi-awb="1"]',{clickCount:3}).catch(()=>{});
    await page.keyboard.press('Control+A').catch(()=>{});await page.keyboard.press('Backspace').catch(()=>{});
    await page.type('[data-mayavi-awb="1"]',mawb,{delay:18});
    if(!await clickArrow(page))return{ok:false,reason:'SAUDIA ARROW NOT FOUND',officialTracker:URL};
    await Promise.race([page.waitForNetworkIdle({idleTime:700,timeout:10000}).catch(()=>{}),sleep(10000)]);
    await sleep(900);await translateEnglish(page);

    let text=await infoText(page);
    let combined=`${text}\n${network.map(x=>x.text).join('\n')}`;
    let shipment=parseInfo(combined,mawb);
    if(!useful(shipment)){
      if(await clickMore(page,mawb)){
        await sleep(1200);await translateEnglish(page);
        text=await infoText(page);
        combined=`${text}\n${network.map(x=>x.text).join('\n')}`;
        shipment=parseInfo(combined,mawb);
      }
    }
    const screenshotBase64=await page.screenshot({type:'png',fullPage:false,encoding:'base64'}).catch(()=>null);
    if(!useful(shipment))return{ok:false,reason:'SAUDIA RESULT DID NOT SHOW PIECES / WEIGHT / FLIGHT',officialTracker:URL,screenshotBase64,debug:{stage:'NO_CORE_FIELDS',sample:clean(text).slice(0,2200),networkUrls:network.map(x=>x.url).slice(-12)}};
    return{ok:true,shipment,screenshotBase64,debug:{stage:'CORE_FIELDS_FOUND',sample:clean(text).slice(0,2200),networkUrls:network.map(x=>x.url).slice(-12)}};
  }catch(e){return{ok:false,reason:`SAUDIA CARD STEP ERROR: ${e?.message||e}`,officialTracker:URL};}
  finally{try{if(browser)await browser.close()}catch{}}
}
