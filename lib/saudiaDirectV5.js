import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { normalizeMawb } from './airlines.js';
import { readSaudiaScreenshot } from './saudiaScreenshotOcr.js';

const URL='https://china.saudiacargo.com/e-services/track-shipment';
const MONTHS={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
const pad=v=>String(v).padStart(2,'0');
const REPS=[
  [/货物追踪|追踪货物/g,'Track Shipment'],[/运单号|空运单号|航空运单号/g,'AWB'],[/目的地/g,'Destination'],
  [/始发地|起点|出发地/g,'Origin'],[/总件数|件数/g,'Total number of pieces'],[/总重量|毛重|重量/g,'Weight'],
  [/航段/g,'Segment'],[/航班/g,'Flight'],[/更多信息/g,'More information'],[/状态/g,'State'],[/日期/g,'Date'],[/时间/g,'Time'],[/当地时间/g,'local time'],
  [/实际到达|已到达|到达|抵达|到港/g,'Arrived'],[/已交付|交付完成|已送达/g,'Delivered'],[/出发|离港|起飞|已起飞/g,'Departed'],
  [/已接收托运人货物|从托运人处接收/g,'Received from Shipper'],[/预订|已预订/g,'Booked'],[/计划航班/g,'Planned For Flight'],[/已配载/g,'Manifested on Flight']
];
function english(v=''){let s=String(v||'');for(const [rx,r] of REPS)s=s.replace(rx,r);return s.replace(/\s+/g,' ').trim()}
function iso(d,m,y){const mm=MONTHS[String(m).slice(0,3).toUpperCase()];if(!mm)return'';const yy=String(y).length===2?`20${y}`:String(y);return`${yy}-${mm}-${pad(d)}`}
function firstDate(text=''){const s=String(text||'').toUpperCase();let m=s.match(/\b([0-3]?\d)\s*(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s*(\d{2,4})\b/);if(m)return iso(m[1],m[2],m[3]);m=s.match(/\b(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})\b/);return m?`${m[1]}-${pad(m[2])}-${pad(m[3])}`:''}
function summary(text=''){const s=english(text),i=s.search(/\bSegment(?:ation)?\s*1\b/i);return i>=0?s.slice(0,i):s.slice(0,3000)}
function segment1(text=''){const s=english(text),m=s.match(/\bSegment(?:ation)?\s*1\b/i);if(!m)return'';const start=m.index||0,rest=s.slice(start+m[0].length),j=rest.search(/\bSegment(?:ation)?\s*2\b/i);return s.slice(start,j>=0?start+m[0].length+j:Math.min(s.length,start+2200))}
function field(text,rx){return (String(text||'').match(rx)||[])[1]||''}
function pieces(text=''){return field(text,/(?:Total\s+number\s+of\s+pieces|No\.?\s*of\s*Pieces|Pieces?|Pcs?)\s*[:\-]?\s*(\d{1,6})/i)}
function weight(text=''){return field(text,/\bWeight\s*[:\-]?\s*([\d,.]+)\s*(?:KG|KGS|KILOGRAMS?)\b/i).replace(/,/g,'')}
function destination(text=''){return field(text,/\bDestination\s*[:\-]?\s*([A-Z]{3})\b/i)}
function origin(text=''){return field(text,/\bOrigin\s*[:\-]?\s*([A-Z]{3})\b/i)}
function flight(text=''){const f=field(text,/\bSV\s*[- ]?(\d{2,4})\b/i);return f?`SV${f}`:''}
function state(text=''){return field(text,/\bState\s*[:\-]?\s*(Booked|Delivered|Arrived|Delayed|Departed|In\s+Transit)\b/i).replace(/\s+/g,' ').toUpperCase()}
function events(text=''){const s=english(text).toUpperCase(),out=[];for(const m of s.matchAll(/\b([01]?\d|2[0-3])\s*[:.]\s*([0-5]\d)\s*[-–—]\s*([0-3]?\d)\s*(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s*(\d{2,4})/g))out.push({i:m.index||0,time:`${pad(m[1])}:${m[2]}`,date:iso(m[3],m[4],m[5])});out.sort((a,b)=>a.i-b.i);return out.map((x,i)=>({...x,text:s.slice(x.i,i+1<out.length?out[i+1].i:Math.min(s.length,x.i+900))}))}
function parse(text='',mawb=''){
  const full=english(text),sum=summary(full),seg=segment1(full),ev=events(full);const arrival=[...ev].reverse().find(e=>/ARRIVED|DELIVERED|\bDLV\b|\bRCF\b|LANDED|RECEIVED\s+FROM\s+FLIGHT/i.test(e.text));const p=pieces(sum)||pieces(full);
  const topDate=firstDate(field(sum,/\bDate\b\s*[:\-]?\s*([^|]{4,40})/i)||sum);
  return {mawb,carrierCode:'SV',airlineName:'Saudia Cargo',origin:origin(sum)||origin(full),destination:destination(sum)||destination(full),flightNo:flight(seg)||flight(full),pieces:p,bags:p,weight:weight(sum),bookingDate:firstDate(seg),arrivalDate:arrival?.date||topDate||'',arrivalTime:arrival?.time||'',arrivalIsActual:Boolean(arrival?.date&&arrival?.time),status:state(sum)||'TRACKING',officialTracker:URL,source:'Saudia automatic More Information screenshot'};
}
function merge(a={},b={}){const o={...a};for(const k of ['origin','destination','flightNo','pieces','bags','weight','bookingDate','arrivalDate','arrivalTime'])if(b?.[k])o[k]=b[k];if(b?.arrivalIsActual)o.arrivalIsActual=true;if(b?.status&&b.status!=='TRACKING')o.status=b.status;return o}
function useful(s={}){return Boolean(s.destination||s.flightNo||s.pieces||s.weight||s.bookingDate||s.arrivalDate||s.arrivalTime||(s.status&&s.status!=='TRACKING'))}

async function translate(page){
  const pairs=REPS.map(([rx,r])=>[rx.source,rx.flags,r]);
  await page.evaluate(p=>{const reps=p.map(([src,flags,r])=>[new RegExp(src,flags),r]);const apply=v=>{let s=String(v||'');for(const [rx,r] of reps)s=s.replace(rx,r);return s};const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let n;while((n=w.nextNode()))n.nodeValue=apply(n.nodeValue||'');for(const e of document.querySelectorAll('[placeholder],[aria-label],[title]'))for(const a of ['placeholder','aria-label','title']){const v=e.getAttribute(a);if(v)e.setAttribute(a,apply(v))}document.documentElement.lang='en'},pairs).catch(()=>{});
}
async function bodyText(page){return page.evaluate(()=>document.body?.innerText||'').catch(()=> '')}
async function markInput(page){return page.evaluate(()=>{const vis=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>20&&r.height>10&&!e.disabled};const inputs=[...document.querySelectorAll('input')].filter(vis).filter(e=>!['hidden','checkbox','radio','submit','button'].includes(String(e.type||'text').toLowerCase()));const a=inputs.find(e=>/awb|airway|shipment|065-000000/i.test(`${e.placeholder||''} ${e.name||''} ${e.id||''} ${e.getAttribute('aria-label')||''}`))||inputs[0];if(!a)return false;a.dataset.mayaviAwb='1';return true}).catch(()=>false)}
async function arrow(page){const ok=await page.evaluate(()=>{const a=document.querySelector('[data-mayavi-awb="1"]');if(!a)return false;const r=a.getBoundingClientRect(),cy=r.top+r.height/2,vis=e=>{const s=getComputedStyle(e),q=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&q.width>8&&q.height>8&&!e.disabled};const xs=[...document.querySelectorAll('button,[role="button"],a,input[type="submit"]')].filter(vis).map(x=>({x,q:x.getBoundingClientRect(),t:(x.innerText||x.value||x.getAttribute('aria-label')||x.title||'').trim()}));let p=xs.find(v=>/^(→|›|>|track|search|go)$/i.test(v.t)||/track\s*shipment/i.test(v.t));if(!p)p=xs.filter(v=>v.q.left>=r.right-40&&v.q.left<=r.right+240&&Math.abs(v.q.top+v.q.height/2-cy)<100)[0];if(!p)return false;p.x.dataset.mayaviArrow='1';return true}).catch(()=>false);if(!ok)return false;await page.click('[data-mayavi-arrow="1"]').catch(()=>page.evaluate(()=>document.querySelector('[data-mayavi-arrow="1"]')?.click()).catch(()=>{}));return true}
async function more(page){const ok=await page.evaluate(()=>{const vis=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>8&&r.height>8};const txt=e=>(e.innerText||e.textContent||e.getAttribute('aria-label')||e.title||'').replace(/\s+/g,' ').trim();let x=[...document.querySelectorAll('button,[role="button"],a,[tabindex],div,span')].filter(vis).find(e=>/more\s+information|更多信息/i.test(txt(e)));if(x)x=x.closest('button,[role="button"],a,[tabindex]')||x;if(!x)x=[...document.querySelectorAll('button,[role="button"],a,[tabindex]')].filter(vis).find(e=>/^\+$/.test(txt(e))||/plus|expand|details/i.test(`${txt(e)} ${e.getAttribute('aria-label')||''}`));if(!x)return false;x.dataset.mayaviMore='1';return true}).catch(()=>false);if(!ok)return false;await page.click('[data-mayavi-more="1"]').catch(()=>page.evaluate(()=>document.querySelector('[data-mayavi-more="1"]')?.click()).catch(()=>{}));return true}

export async function trackSaudiaDirect(input){
  const mawb=normalizeMawb(input);if(!mawb||!mawb.startsWith('065-'))return{ok:false,reason:'INVALID SAUDIA MAWB',officialTracker:URL};let browser;const api=[];
  try{
    chromium.setGraphicsMode=false;browser=await puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox','--lang=en-US,en','--window-size=1440,1100'],defaultViewport:{width:1440,height:1100},executablePath:await chromium.executablePath(),headless:'shell'});const page=await browser.newPage();
    await page.setExtraHTTPHeaders({'Accept-Language':'en-US,en;q=0.9'});page.on('response',async r=>{try{if(/\/apis\/api\/eservices\/track-shipment/i.test(r.url()))api.push({status:r.status(),body:(await r.text().catch(()=>'' )).slice(0,700)})}catch{}});
    await page.goto(URL,{waitUntil:'domcontentloaded',timeout:28000});await new Promise(r=>setTimeout(r,1800));await translate(page);
    if(!await markInput(page))return{ok:false,reason:'SAUDIA AWB INPUT NOT FOUND',officialTracker:URL,debug:{stage:'input'}};
    const d=mawb.replace(/\D/g,'');await page.click('[data-mayavi-awb="1"]',{clickCount:3}).catch(()=>{});await page.keyboard.press('Control+A').catch(()=>{});await page.keyboard.press('Backspace').catch(()=>{});await page.type('[data-mayavi-awb="1"]',d,{delay:20});
    if(!await arrow(page))return{ok:false,reason:'SAUDIA ARROW NOT FOUND',officialTracker:URL,debug:{stage:'arrow'}};
    await Promise.race([page.waitForNetworkIdle({idleTime:700,timeout:10000}).catch(()=>{}),new Promise(r=>setTimeout(r,10000))]);await new Promise(r=>setTimeout(r,1000));await translate(page);
    const before=await bodyText(page),moreClicked=await more(page);if(moreClicked){await new Promise(r=>setTimeout(r,1200));await translate(page)}
    const visible=await bodyText(page);const shot=await page.screenshot({type:'png',fullPage:true,encoding:'base64'}).catch(()=>null);let shipment=parse(visible,mawb),ocr=null;if(shot){ocr=await readSaudiaScreenshot({mawb,screenshotBase64:shot,timeoutMs:30000});if(ocr?.ok)shipment=merge(shipment,ocr.shipment)}
    shipment.mawb=mawb;shipment.carrierCode='SV';shipment.airlineName='Saudia Cargo';shipment.officialTracker=URL;shipment.source='Saudia automatic English → AWB → Arrow → More Information → screenshot';
    if(useful(shipment))return{ok:true,shipment,screenshotBase64:shot,debug:{stage:'SUCCESS',moreClicked,apiResponses:api.map(x=>({status:x.status,body:x.body.slice(0,220)})),beforeMore:english(before).slice(0,700),visibleSample:english(visible).slice(0,1400),ocr:ocr?.debug||null}};
    return{ok:false,reason:'SAUDIA RESULT COULD NOT BE READ AUTOMATICALLY',officialTracker:URL,debug:{stage:'NO_RESULT',moreClicked,apiResponses:api,beforeMore:english(before).slice(0,700),visibleSample:english(visible).slice(0,1400),ocrReason:ocr?.reason||''}};
  }catch(e){return{ok:false,reason:`SAUDIA AUTOMATION ERROR: ${e?.message||e}`,officialTracker:URL,debug:{stage:'ERROR'}}}finally{try{if(browser)await browser.close()}catch{}}
}
