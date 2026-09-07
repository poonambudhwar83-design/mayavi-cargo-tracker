import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { normalizeMawb } from './airlines.js';
import { readSaudiaScreenshot } from './saudiaScreenshotOcr.js';

const URL='https://china.saudiacargo.com/e-services/track-shipment';
const MONTHS={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
const pad=v=>String(v).padStart(2,'0');
const REPLACEMENTS=[
  [/货物追踪|追踪货物/g,'Track Shipment'],[/运单号|空运单号|航空运单号/g,'AWB'],[/目的地/g,'Destination'],
  [/始发地|起点|出发地/g,'Origin'],[/总件数|件数/g,'Total number of pieces'],[/总重量|毛重|重量/g,'Weight'],
  [/航段/g,'Segment'],[/航班/g,'Flight'],[/更多信息/g,'More information'],[/状态/g,'State'],
  [/实际到达|已到达|到达|抵达|到港/g,'Arrived'],[/已交付|交付完成|已送达/g,'Delivered'],
  [/出发|离港|起飞|已起飞/g,'Departed'],[/已接收托运人货物|从托运人处接收/g,'Received from Shipper'],
  [/预订|已预订/g,'Booked'],[/计划航班/g,'Planned For Flight'],[/已配载/g,'Manifested on Flight'],
  [/异常/g,'Discrepancy'],[/日期/g,'Date'],[/时间/g,'Time'],[/当地时间/g,'local time']
];

function english(v=''){let s=String(v||'');for(const [rx,r] of REPLACEMENTS)s=s.replace(rx,r);return s.replace(/\s+/g,' ').trim()}
function iso(day,mon,year){const m=MONTHS[String(mon).slice(0,3).toUpperCase()];if(!m)return'';const y=String(year).length===2?`20${year}`:String(year);return`${y}-${m}-${pad(day)}`}
function firstDate(text=''){
  const s=String(text||'').toUpperCase();
  let m=s.match(/\b([0-3]?\d)\s*(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s*(\d{2,4})\b/);if(m)return iso(m[1],m[2],m[3]);
  m=s.match(/\b([0-3]?\d)\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s+(20\d{2})\b/);if(m)return iso(m[1],m[2],m[3]);
  m=s.match(/\b(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})\b/);if(m)return`${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  return'';
}
function timedEvents(text=''){
  const s=english(text).toUpperCase(),out=[];
  for(const m of s.matchAll(/\b([01]?\d|2[0-3])\s*[:.]\s*([0-5]\d)\s*[-–—]\s*([0-3]?\d)\s*(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s*(\d{2,4})\s*(?:LOCAL\s*TIME)?/g))out.push({i:m.index||0,time:`${pad(m[1])}:${m[2]}`,date:iso(m[3],m[4],m[5])});
  out.sort((a,b)=>a.i-b.i);return out.map((e,i)=>({...e,text:s.slice(e.i,i+1<out.length?out[i+1].i:Math.min(s.length,e.i+850))}));
}
function summaryWindow(text=''){
  const s=english(text),m=s.match(/\bSegment(?:ation)?\s*1\b/i);return m?s.slice(0,m.index):s.slice(0,2600);
}
function segmentOne(text=''){
  const s=english(text),m=s.match(/\bSegment(?:ation)?\s*1\b/i);if(!m)return'';const start=m.index||0,rest=s.slice(start+m[0].length),n=rest.search(/\bSegment(?:ation)?\s*2\b/i);return s.slice(start,n>=0?start+m[0].length+n:Math.min(s.length,start+1900));
}
function explicitWeight(text=''){return ((String(text).match(/\bWeight\s*[:\-]?\s*([\d,.]+)\s*(?:KG|KGS|KILOGRAMS?)\b/i)||[])[1]||'').replace(/,/g,'')}
function pieces(text=''){return (String(text).match(/(?:Total\s+number\s+of\s+pieces|No\.?\s*of\s*Pieces|Pieces?|Pcs?)\s*[:\-]?\s*(\d{1,6})/i)||[])[1]||''}
function destination(text=''){return (String(text).match(/\bDestination\s*[:\-]?\s*([A-Z]{3})\b/i)||[])[1]||''}
function flight(text=''){const f=(String(text).match(/\bSV\s*[- ]?(\d{2,4})\b/i)||[])[1]||'';return f?`SV${f}`:''}
function origin(text=''){return (String(text).match(/\bOrigin\s*[:\-]?\s*([A-Z]{3})\b/i)||[])[1]||''}
function parseVisible(text='',mawb=''){
  const full=english(text),summary=summaryWindow(full),seg1=segmentOne(full),events=timedEvents(full);
  const state=(summary.match(/\bState\s*[:\-]?\s*(Booked|Delivered|Arrived|Delayed|Departed|In Transit)\b/i)||[])[1]||'';
  const arrival=[...events].reverse().find(e=>/\bARRIVED?\b|\bDELIVERED\b|\bDLV\b|\bRCF\b|RECEIVED\s+FROM\s+FLIGHT|LANDED/i.test(e.text))||null;
  const summaryDate=firstDate((summary.match(/\bDate\b[\s\S]{0,80}/i)||[])[0]||'');
  const p=pieces(summary)||pieces(full);
  return{
    mawb,carrierCode:'SV',airlineName:'Saudia Cargo',origin:origin(summary)||origin(full),destination:destination(summary)||destination(full),
    flightNo:flight(full),pieces:p,bags:p,weight:explicitWeight(summary),bookingDate:firstDate(seg1),
    arrivalDate:arrival?.date||summaryDate||'',arrivalTime:arrival?.time||'',arrivalIsActual:Boolean(arrival?.date&&arrival?.time),
    status:state?state.replace(/\s+/g,' ').toUpperCase():'TRACKING',officialTracker:URL,
    source:'Saudia automatic English More Information screenshot flow'
  };
}
function merge(base={},next={}){
  const out={...base};for(const k of ['origin','destination','flightNo','pieces','bags','weight','bookingDate','arrivalDate','arrivalTime'])if(next?.[k])out[k]=next[k];
  if(next?.arrivalIsActual)out.arrivalIsActual=true;
  if(next?.status&&next.status!=='TRACKING')out.status=next.status;
  return out;
}
function useful(s={}){return Boolean(s.destination||s.pieces||s.weight||s.bookingDate||s.arrivalDate||s.arrivalTime||(s.status&&s.status!=='TRACKING'))}

async function translatePage(page){
  const pairs=REPLACEMENTS.map(([rx,r])=>[rx.source,rx.flags,r]);
  for(const frame of page.frames())await frame.evaluate((p)=>{
    const reps=p.map(([src,flags,r])=>[new RegExp(src,flags),r]);const apply=v=>{let s=String(v||'');for(const [rx,r] of reps)s=s.replace(rx,r);return s};
    const walk=root=>{try{const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let n;while((n=w.nextNode()))n.nodeValue=apply(n.nodeValue||'');for(const e of root.querySelectorAll?.('[placeholder],[aria-label],[title]')||[])for(const a of ['placeholder','aria-label','title']){const v=e.getAttribute(a);if(v)e.setAttribute(a,apply(v))}for(const e of root.querySelectorAll?.('*')||[])if(e.shadowRoot)walk(e.shadowRoot)}catch{}};
    walk(document.body);document.documentElement.lang='en';
  },pairs).catch(()=>{});
}
async function pageText(page){const out=[];for(const f of page.frames()){const t=await f.evaluate(()=>document.body?.innerText||'').catch(()=> '');if(t)out.push(t)}return out.join('\n')}
async function findAwbInput(page){return page.evaluate(()=>{const vis=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>20&&r.height>10&&!e.disabled};const a=[...document.querySelectorAll('input')].filter(vis).filter(e=>!['hidden','checkbox','radio','submit','button'].includes(String(e.type||'text').toLowerCase())).find(e=>/awb|airway|shipment|065-000000/i.test(`${e.placeholder||''} ${e.name||''} ${e.id||''} ${e.getAttribute('aria-label')||''}`))||[...document.querySelectorAll('input')].filter(vis)[0];if(!a)return false;a.setAttribute('data-mayavi-awb','1');return true}).catch(()=>false)}
async function clickArrow(page){const ok=await page.evaluate(()=>{const a=document.querySelector('[data-mayavi-awb="1"]');if(!a)return false;const r=a.getBoundingClientRect(),cy=r.top+r.height/2,vis=e=>{try{const s=getComputedStyle(e),q=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&q.width>8&&q.height>8&&!e.disabled}catch{return false}};const c=[...document.querySelectorAll('button,[role="button"],a,input[type="submit"],svg')].filter(vis).map(e=>{const x=e.closest('button,[role="button"],a,input[type="submit"]')||e,q=x.getBoundingClientRect(),t=(x.innerText||x.value||x.getAttribute('aria-label')||x.title||'').replace(/\s+/g,' ').trim();return{x,q,t}});let p=c.find(v=>/^(→|›|>|track|search|go)$/i.test(v.t)||/track\s*shipment/i.test(v.t));if(!p)p=c.filter(v=>v.q.left>=r.right-35&&v.q.left<=r.right+240&&Math.abs(v.q.top+v.q.height/2-cy)<100).sort((x,y)=>Math.abs(x.q.top+x.q.height/2-cy)-Math.abs(y.q.top+y.q.height/2-cy))[0];if(!p)return false;p.x.setAttribute('data-mayavi-arrow','1');return true}).catch(()=>false);if(!ok)return false;await page.click('[data-mayavi-arrow="1"]').catch(()=>page.evaluate(()=>document.querySelector('[data-mayavi-arrow="1"]')?.click()).catch(()=>{}));return true}
async function clickMore(page){
  for(const frame of page.frames()){
    const ok=await frame.evaluate(()=>{const vis=e=>{try{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>8&&r.height>8}catch{return false}};const txt=e=>(e.innerText||e.textContent||e.getAttribute?.('aria-label')||e.title||'').replace(/\s+/g,' ').trim();let x=[...document.querySelectorAll('button,[role="button"],a,[tabindex],div,span')].filter(vis).find(e=>/more\s+information|更多信息/i.test(txt(e)));if(x)x=x.closest('button,[role="button"],a,[tabindex]')||x;if(!x)x=[...document.querySelectorAll('button,[role="button"],a,[tabindex]')].filter(vis).find(e=>/^\+$/.test(txt(e))||/plus|expand|details/i.test(`${txt(e)} ${e.getAttribute?.('aria-label')||''}`));if(!x)return false;x.setAttribute('data-mayavi-more','1');return true}).catch(()=>false);
    if(ok){await frame.click('[data-mayavi-more="1"]').catch(()=>frame.evaluate(()=>document.querySelector('[data-mayavi-more="1"]')?.click()).catch(()=>{}));return true}
  }
  return false;
}
async function scrollResult(page){for(let i=0;i<10;i++){await page.evaluate(()=>{window.scrollBy(0,Math.max(500,innerHeight*.7));for(const e of document.querySelectorAll('*'))if(e.scrollHeight>e.clientHeight+150)e.scrollTop=Math.min(e.scrollHeight,e.scrollTop+Math.max(350,e.clientHeight*.7))}).catch(()=>{});await new Promise(r=>setTimeout(r,160))}}

export async function trackSaudiaDirect(input){
  const mawb=normalizeMawb(input);if(!mawb||!mawb.startsWith('065-'))return{ok:false,reason:'INVALID SAUDIA MAWB',officialTracker:URL};
  let browser;const apiResponses=[];
  try{
    chromium.setGraphicsMode=false;
    browser=await puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox','--lang=en-US,en','--window-size=1440,1100'],defaultViewport:{width:1440,height:1100},executablePath:await chromium.executablePath(),headless:'shell'});
    const page=await browser.newPage();
    const version=await browser.version().catch(()=> 'HeadlessChrome/149.0.0.0');const chrome=(version.match(/(?:Chrome|Chromium)\/([\d.]+)/)||[])[1]||'149.0.0.0';
    await page.setUserAgent(`Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`);
    await page.setExtraHTTPHeaders({'Accept-Language':'en-US,en;q=0.9'});
    page.on('response',async r=>{try{if(/\/apis\/api\/eservices\/track-shipment/i.test(r.url()))apiResponses.push({status:r.status(),body:(await r.text().catch(()=>'' )).slice(0,3000)})}catch{}});

    // Exact required flow: link -> English -> AWB -> Arrow -> More Information -> screenshot -> Mayavi fields.
    await page.goto(URL,{waitUntil:'domcontentloaded',timeout:26000});await new Promise(r=>setTimeout(r,1800));
    await translatePage(page);
    if(!await findAwbInput(page))return{ok:false,reason:'SAUDIA AWB INPUT NOT FOUND',officialTracker:URL,debug:{stage:'input'}};

    const digits=mawb.replace(/\D/g,'');
    await page.click('[data-mayavi-awb="1"]',{clickCount:3}).catch(()=>{});await page.keyboard.press('Control+A').catch(()=>{});await page.keyboard.press('Backspace').catch(()=>{});await page.type('[data-mayavi-awb="1"]',digits,{delay:25});
    if(!await clickArrow(page))return{ok:false,reason:'SAUDIA ARROW NOT FOUND',officialTracker:URL,debug:{stage:'arrow'}};

    await Promise.race([page.waitForNetworkIdle({idleTime:700,timeout:10000}).catch(()=>{}),new Promise(r=>setTimeout(r,10000))]);await new Promise(r=>setTimeout(r,900));
    await translatePage(page);
    const beforeMore=await pageText(page);
    const moreClicked=await clickMore(page);
    if(moreClicked){await new Promise(r=>setTimeout(r,1100));await translatePage(page);await scrollResult(page);await translatePage(page)}

    const visible=await pageText(page);
    const screenshotBase64=await page.screenshot({type:'png',fullPage:true,encoding:'base64'}).catch(()=>null);
    let shipment=parseVisible(visible,mawb),ocr=null;
    if(screenshotBase64){ocr=await readSaudiaScreenshot({mawb,screenshotBase64,timeoutMs:30000});if(ocr?.ok)shipment=merge(shipment,ocr.shipment)}
    shipment.mawb=mawb;shipment.carrierCode='SV';shipment.airlineName='Saudia Cargo';shipment.officialTracker=URL;shipment.source='Saudia automatic English → AWB → Arrow → More Information → screenshot';

    if(useful(shipment))return{ok:true,shipment,screenshotBase64,debug:{stage:'SUCCESS',moreClicked,apiResponses:apiResponses.map(x=>({status:x.status,body:x.body.slice(0,220)})),beforeMore:english(beforeMore).slice(0,700),visibleSample:english(visible).slice(0,1200),ocr:ocr?.debug||null}};
    return{ok:false,reason:'SAUDIA OFFICIAL RESULT DID NOT LOAD OR COULD NOT BE READ AUTOMATICALLY',officialTracker:URL,screenshotBase64,debug:{stage:'NO_RESULT',moreClicked,apiResponses:apiResponses.map(x=>({status:x.status,body:x.body.slice(0,220)})),beforeMore:english(beforeMore).slice(0,700),visibleSample:english(visible).slice(0,1200),ocrReason:ocr?.reason||''}};
  }catch(e){return{ok:false,reason:`SAUDIA AUTOMATION ERROR: ${e?.message||e}`,officialTracker:URL,debug:{stage:'ERROR'}}}
  finally{try{if(browser)await browser.close()}catch{}}
}
