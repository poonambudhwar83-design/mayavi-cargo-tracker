import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { normalizeMawb } from './airlines.js';

const URL='https://china.saudiacargo.com/e-services/track-shipment';
const MONTHS={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
const pad=v=>String(v).padStart(2,'0');

const REPS=[
  [/货物追踪|追踪货物/g,'Track Shipment'],[/运单号|空运单号|航空运单号/g,'AWB'],[/目的地/g,'Destination'],
  [/始发地|起点|出发地/g,'Origin'],[/总件数|件数/g,'Total number of pieces'],[/总重量|毛重|重量/g,'Weight'],
  [/航段/g,'Segment'],[/航班/g,'Flight'],[/更多信息/g,'More information'],[/状态/g,'State'],[/日期/g,'Date'],[/时间/g,'Time'],[/当地时间/g,'local time'],
  [/已交付|交付完成|已送达/g,'Delivered'],[/实际到达|已到达|到达|抵达|到港/g,'Arrived'],[/预订|已预订/g,'Booked']
];

function iso(d,m,y){const mm=MONTHS[String(m).slice(0,3).toUpperCase()];if(!mm)return'';const yy=String(y).length===2?`20${y}`:String(y);return `${yy}-${mm}-${pad(d)}`;}
function dateFrom(v=''){
  const s=String(v||'').toUpperCase();
  let m=s.match(/\b([0-3]?\d)\s*(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s*(\d{2,4})\b/);
  if(m)return iso(m[1],m[2],m[3]);
  m=s.match(/\b(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})\b/);
  return m?`${m[1]}-${pad(m[2])}-${pad(m[3])}`:'';
}
function clean(v=''){return String(v||'').replace(/\s+/g,' ').trim();}
function value(text,rx){return (String(text||'').match(rx)||[])[1]||'';}
function parseCard(text='',mawb=''){
  const s=clean(text);
  const pieces=value(s,/(?:Total\s+number\s+of\s+pieces|No\.?\s*of\s*pieces)\s*[:\-]?\s*(\d{1,6})/i);
  const weight=value(s,/\bWeight\s*[:\-]?\s*([\d,.]+)\s*(?:kg|kgs|kilograms?)\b/i).replace(/,/g,'');
  const flightDigits=value(s,/\bFlight\s+number\s*[:\-]?\s*SV\s*[- ]?(\d{2,4})\b/i)||value(s,/\bSV\s*[- ]?(\d{2,4})\b/i);
  const flightNo=flightDigits?`SV${flightDigits}`:'';
  const flightDateRaw=value(s,/\bFlight\s+Date\s*[:\-]?\s*([0-9A-Z\s\-\/.]{5,20})/i);
  const arrivalDateRaw=value(s,/\bArrival\s+date\s*[:\-]?\s*([0-9A-Z\s\-\/.]{5,20})/i);
  const topDateRaw=value(s,/(?:^|\s)date\s*[:\-]?\s*([0-9A-Z\s\-\/.]{5,20})/i);
  const state=clean(value(s,/\bState\s*[:\-]?\s*(Delivered|Arrived|Booked|Delayed|Departed|In\s+Transit)\b/i)).toUpperCase();
  const origin=value(s,/\bOrigin\s*[:\-]?\s*([A-Z]{3})\b/i).toUpperCase();
  const destination=value(s,/\bDestination\s*[:\-]?\s*([A-Z]{3})\b/i).toUpperCase();
  const flightDate=dateFrom(flightDateRaw);
  const arrivalDate=dateFrom(arrivalDateRaw)||dateFrom(topDateRaw);
  return {
    mawb,
    carrierCode:'SV',
    airlineName:'Saudia Cargo',
    origin,
    destination,
    bags:pieces,
    pieces,
    weight,
    flightNo,
    flightDate,
    arrivalDate,
    arrivalTime:'',
    arrivalIsActual:false,
    status:state||'TRACKING',
    officialTracker:URL,
    source:'Saudia More Information card screenshot step'
  };
}
function useful(s={}){return Boolean(s.origin||s.destination||s.bags||s.weight||s.flightNo||s.flightDate||s.arrivalDate||(s.status&&s.status!=='TRACKING'));}

async function translateEnglish(page){
  const clicked=await page.evaluate(()=>{
    const vis=e=>{try{const cs=getComputedStyle(e),r=e.getBoundingClientRect();return cs.display!=='none'&&cs.visibility!=='hidden'&&r.width>6&&r.height>6}catch{return false}};
    const els=[...document.querySelectorAll('button,a,[role="button"],li,span,div')].filter(vis);
    const el=els.find(e=>/^english(?:\s*\(.*\))?$/i.test(cleanText(e.innerText||e.textContent||'')));
    function cleanText(v){return String(v||'').replace(/\s+/g,' ').trim();}
    if(!el)return false;
    const target=el.closest('button,a,[role="button"]')||el;
    target.setAttribute('data-mayavi-english','1');return true;
  }).catch(()=>false);
  if(clicked){
    await page.click('[data-mayavi-english="1"]').catch(()=>page.evaluate(()=>document.querySelector('[data-mayavi-english="1"]')?.click()).catch(()=>{}));
    await new Promise(r=>setTimeout(r,700));
  }
  const pairs=REPS.map(([rx,r])=>[rx.source,rx.flags,r]);
  await page.evaluate(p=>{
    const reps=p.map(([src,flags,r])=>[new RegExp(src,flags),r]);
    const apply=v=>{let s=String(v||'');for(const [rx,r] of reps)s=s.replace(rx,r);return s};
    const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let n;while((n=w.nextNode()))n.nodeValue=apply(n.nodeValue||'');
    for(const e of document.querySelectorAll('[placeholder],[aria-label],[title]'))for(const a of ['placeholder','aria-label','title']){const v=e.getAttribute(a);if(v)e.setAttribute(a,apply(v));}
    document.documentElement.lang='en';
  },pairs).catch(()=>{});
}
async function markAwb(page){return page.evaluate(()=>{
  const vis=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>20&&r.height>10&&!e.disabled};
  const inputs=[...document.querySelectorAll('input')].filter(vis).filter(e=>!['hidden','checkbox','radio','submit','button'].includes(String(e.type||'text').toLowerCase()));
  const a=inputs.find(e=>/awb|airway|shipment|065-000000/i.test(`${e.placeholder||''} ${e.name||''} ${e.id||''} ${e.getAttribute('aria-label')||''}`))||inputs[0];
  if(!a)return false;a.dataset.mayaviAwb='1';return true;
}).catch(()=>false);}
async function clickArrow(page){
  const ok=await page.evaluate(()=>{
    const a=document.querySelector('[data-mayavi-awb="1"]');if(!a)return false;
    const r=a.getBoundingClientRect(),cy=r.top+r.height/2;
    const vis=e=>{try{const s=getComputedStyle(e),q=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&q.width>8&&q.height>8&&!e.disabled}catch{return false}};
    const els=[...document.querySelectorAll('button,[role="button"],a,input[type="submit"],svg')].filter(vis).map(e=>{const x=e.closest('button,[role="button"],a,input[type="submit"]')||e,q=x.getBoundingClientRect(),t=(x.innerText||x.value||x.getAttribute('aria-label')||x.title||'').replace(/\s+/g,' ').trim();return{x,q,t}});
    let p=els.find(v=>/^(→|›|>|track|search|go)$/i.test(v.t)||/track\s*shipment/i.test(v.t));
    if(!p)p=els.filter(v=>v.q.left>=r.right-35&&v.q.left<=r.right+240&&Math.abs(v.q.top+v.q.height/2-cy)<100).sort((x,y)=>Math.abs(x.q.top+x.q.height/2-cy)-Math.abs(y.q.top+y.q.height/2-cy))[0];
    if(!p)return false;p.x.dataset.mayaviArrow='1';return true;
  }).catch(()=>false);
  if(!ok)return false;
  await page.click('[data-mayavi-arrow="1"]').catch(()=>page.evaluate(()=>document.querySelector('[data-mayavi-arrow="1"]')?.click()).catch(()=>{}));return true;
}
async function clickMore(page){
  const ok=await page.evaluate(()=>{
    const vis=e=>{try{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>8&&r.height>8}catch{return false}};
    const txt=e=>(e.innerText||e.textContent||e.getAttribute?.('aria-label')||e.title||'').replace(/\s+/g,' ').trim();
    let x=[...document.querySelectorAll('button,[role="button"],a,[tabindex],div,span')].filter(vis).find(e=>/more\s+information|更多信息/i.test(txt(e)));
    if(x)x=x.closest('button,[role="button"],a,[tabindex]')||x;
    if(!x)return false;x.dataset.mayaviMore='1';return true;
  }).catch(()=>false);
  if(!ok)return false;
  await page.click('[data-mayavi-more="1"]').catch(()=>page.evaluate(()=>document.querySelector('[data-mayavi-more="1"]')?.click()).catch(()=>{}));return true;
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
    await page.goto(URL,{waitUntil:'domcontentloaded',timeout:28000});
    await new Promise(r=>setTimeout(r,1700));
    await translateEnglish(page);
    if(!await markAwb(page))return{ok:false,reason:'SAUDIA AWB INPUT NOT FOUND',officialTracker:URL};
    const digits=mawb.replace(/\D/g,'');
    await page.click('[data-mayavi-awb="1"]',{clickCount:3}).catch(()=>{});
    await page.keyboard.press('Control+A').catch(()=>{});await page.keyboard.press('Backspace').catch(()=>{});
    await page.type('[data-mayavi-awb="1"]',digits,{delay:25});
    if(!await clickArrow(page))return{ok:false,reason:'SAUDIA ARROW NOT FOUND',officialTracker:URL};
    await Promise.race([page.waitForNetworkIdle({idleTime:700,timeout:10000}).catch(()=>{}),new Promise(r=>setTimeout(r,10000))]);
    await new Promise(r=>setTimeout(r,900));
    await translateEnglish(page);
    if(!await clickMore(page))return{ok:false,reason:'SAUDIA MORE INFORMATION NOT FOUND',officialTracker:URL};
    await new Promise(r=>setTimeout(r,1000));
    await translateEnglish(page);
    const text=await page.evaluate(()=>document.body?.innerText||'').catch(()=> '');
    const screenshotBase64=await page.screenshot({type:'png',fullPage:false,encoding:'base64'}).catch(()=>null);
    const shipment=parseCard(text,mawb);
    if(!useful(shipment))return{ok:false,reason:'SAUDIA MORE INFORMATION CARD HAD NO VERIFIED FIELDS',officialTracker:URL,screenshotBase64};
    return{ok:true,shipment,screenshotBase64,debug:{stage:'MORE_INFORMATION_SCREENSHOT',sample:clean(text).slice(0,1800)}};
  }catch(e){return{ok:false,reason:`SAUDIA CARD STEP ERROR: ${e?.message||e}`,officialTracker:URL};}
  finally{try{if(browser)await browser.close()}catch{}}
}
