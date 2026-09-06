import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { normalizeMawb } from './airlines.js';

const URL='https://china.saudiacargo.com/e-services/track-shipment';
const MONTHS={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
const pad=v=>String(v).padStart(2,'0');
const replacements=[
  [/货物追踪|追踪货物/g,'Track Shipment'],[/运单号|空运单号|航空运单号/g,'AWB'],[/目的地/g,'Destination'],
  [/始发地|起点|出发地/g,'Origin'],[/总件数|件数/g,'Total number of pieces'],[/航段/g,'Segment'],[/航班/g,'Flight'],
  [/实际到达|已到达|到达|抵达|到港/g,'Arrived'],[/已交付|交付完成|已送达/g,'Delivered'],[/出发|离港|起飞|已起飞/g,'Departed'],
  [/已接收托运人货物|从托运人处接收/g,'Received from Shipper'],[/预订|已预订/g,'Booked'],[/计划航班/g,'Planned For Flight'],
  [/已配载/g,'Manifested on Flight'],[/异常/g,'Discrepancy'],[/日期/g,'Date'],[/时间/g,'Time'],[/当地时间/g,'local time'],
  [/更多信息/g,'More information'],[/状态/g,'State']
];
function english(v=''){let s=String(v||'');for(const [rx,r] of replacements)s=s.replace(rx,r);return s.replace(/\s+/g,' ').trim()}
function iso(day,mon,year){const m=MONTHS[String(mon).slice(0,3).toUpperCase()];if(!m)return'';const y=String(year).length===2?`20${year}`:String(year);return`${y}-${m}-${pad(day)}`}
function parseCompactDate(s=''){const m=String(s).match(/\b([0-3]?\d)(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{2,4})\b/i);return m?iso(m[1],m[2],m[3]):''}

async function translatePage(page){
  for(const frame of page.frames())await frame.evaluate((pairs)=>{
    const reps=pairs.map(([src,flags,r])=>[new RegExp(src,flags),r]);
    const apply=v=>{let s=String(v||'');for(const [rx,r] of reps)s=s.replace(rx,r);return s};
    try{const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let n;while((n=w.nextNode()))n.nodeValue=apply(n.nodeValue||'');document.documentElement.lang='en'}catch{}
  },replacements.map(([rx,r])=>[rx.source,rx.flags,r])).catch(()=>{});
}
async function pageText(page){const out=[];for(const f of page.frames()){const t=await f.evaluate(()=>document.body?.innerText||'').catch(()=> '');if(t)out.push(t)}return out.join('\n')}

function events(raw=''){
  const text=english(raw),marks=[];
  for(const m of text.matchAll(/\b([01]?\d|2[0-3]):([0-5]\d)\s*[-–—]\s*([0-3]?\d)(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{2,4})\s+local\s+time\b/gi))marks.push({i:m.index||0,date:iso(m[3],m[4],m[5]),time:`${pad(m[1])}:${m[2]}`});
  marks.sort((a,b)=>a.i-b.i);const unique=[];for(const x of marks)if(!unique.some(y=>Math.abs(y.i-x.i)<8))unique.push(x);
  return unique.map((x,i)=>({date:x.date,time:x.time,text:text.slice(x.i,i+1<unique.length?unique[i+1].i:Math.min(text.length,x.i+900)).trim()}));
}
function segments(raw=''){const t=english(raw),hits=[...t.matchAll(/\bSegment(?:ation)?\s*(\d+)\b/gi)];return hits.map((m,i)=>({no:Number(m[1]),text:t.slice(m.index||0,i+1<hits.length?hits[i+1].index:t.length).trim()})).sort((a,b)=>a.no-b.no)}
const delivered=t=>/\bDELIVERED\b|\bDLV\b/i.test(english(t));
const arrived=t=>/\bARRIVED\b|\bRCF\b|RECEIVED\s+FROM\s+FLIGHT|LANDED/i.test(english(t));
function fields(s=''){const t=english(s),u=t.toUpperCase();return{
  destination:(u.match(/\bDESTINATION\s*[:\-]?\s*([A-Z]{3})\b/)||[])[1]||(u.match(/,\s*([A-Z]{3})\b/)||[])[1]||'',
  pieces:(t.match(/(?:Total\s+number\s+of\s+pieces|No\.?\s*of\s*Pieces|Pieces?)\s*[:\-]?\s*(\d{1,6})/i)||[])[1]||'',
  flightNo:((u.match(/\bSV[-\s]?(\d{2,4})\b/)||[])[1])?`SV${(u.match(/\bSV[-\s]?(\d{2,4})\b/)||[])[1]}`:''
}}
function parse(raw,mawb){
  const text=english(raw),segs=segments(raw),all=events(raw);
  const firstSeg=segs.find(x=>x.no===1)||segs[0]||null,lastSeg=segs.at(-1)||null;
  const firstEvents=firstSeg?events(firstSeg.text):[],lastEvents=lastSeg?events(lastSeg.text):[];
  const firstEvent=firstEvents[0]||all[0]||null,lastEvent=lastEvents.at(-1)||all.at(-1)||null;
  const h=fields(text),lf=fields(lastSeg?.text||''),ef=fields(lastEvent?.text||'');
  const headerDate=parseCompactDate((text.match(/\bDestination\b[\s\S]{0,180}?\bDate\b[\s\S]{0,40}/i)||[])[0]||'');

  // IMPORTANT: Saudia status comes ONLY from the top/right shipment summary "State" field.
  // Timeline/last segment must never override this status.
  const summaryState=(text.match(/\bState\s*[:\-]?\s*(Booked|Delivered|Arrived|Delayed|Departed|In Transit)\b/i)||[])[1]||'';
  const status=summaryState?summaryState.toUpperCase():'TRACKING';

  let arrivalDate=headerDate,arrivalTime='',actual=false;
  if(lastEvent&&(delivered(lastEvent.text)||arrived(lastEvent.text))){arrivalDate=lastEvent.date||arrivalDate;arrivalTime=lastEvent.time||'';actual=Boolean(arrivalDate&&arrivalTime)}
  const pieces=h.pieces||lf.pieces||ef.pieces||'';
  const shipment={mawb,carrierCode:'SV',airlineName:'Saudia Cargo',origin:'',destination:h.destination||lf.destination||ef.destination||'',bags:pieces,pieces,weight:'',flightNo:ef.flightNo||lf.flightNo||h.flightNo||'',bookingDate:firstEvent?.date||'',arrivalDate,arrivalTime,arrivalIsActual:actual,status,officialTracker:URL,source:'Saudia English More Information segments'};
  return (segs.length||pieces||shipment.destination||shipment.bookingDate||shipment.arrivalDate)?{shipment,segs,firstEvent,lastEvent,summaryState}:null;
}

async function findAwb(page){return page.evaluate(()=>{const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>20&&r.height>10&&!e.disabled};const inputs=[...document.querySelectorAll('input')].filter(visible).filter(e=>!['hidden','checkbox','radio','submit','button'].includes(String(e.type||'text').toLowerCase()));const a=inputs.find(e=>/awb|airway|shipment|065-000000/i.test(`${e.placeholder||''} ${e.name||''} ${e.id||''}`))||inputs[0];if(!a)return false;a.setAttribute('data-mayavi-awb','1');return true}).catch(()=>false)}
async function clickArrow(page){const ok=await page.evaluate(()=>{const a=document.querySelector('[data-mayavi-awb="1"]');if(!a)return false;const r=a.getBoundingClientRect(),cy=r.top+r.height/2,vis=e=>{const s=getComputedStyle(e),q=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&q.width>8&&q.height>8&&!e.disabled};const c=[...document.querySelectorAll('button,[role="button"],a,input[type="submit"],svg')].filter(vis).map(e=>{const x=e.closest('button,[role="button"],a,input[type="submit"]')||e,q=x.getBoundingClientRect(),t=(x.innerText||x.getAttribute('aria-label')||x.title||'').trim();return{x,q,t}});let p=c.find(v=>/^(→|›|>|track|search|go)$/i.test(v.t));if(!p)p=c.filter(v=>v.q.left>=r.right-25&&v.q.left<=r.right+220&&Math.abs(v.q.top+v.q.height/2-cy)<95)[0];if(!p)return false;p.x.setAttribute('data-mayavi-arrow','1');return true}).catch(()=>false);if(!ok)return false;await page.click('[data-mayavi-arrow="1"]').catch(()=>{});return true}
async function clickMore(page){const ok=await page.evaluate(()=>{const vis=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>8&&r.height>8};const txt=e=>(e.innerText||e.textContent||e.getAttribute?.('aria-label')||e.title||'').replace(/\s+/g,' ').trim();let x=[...document.querySelectorAll('button,[role="button"],a,[tabindex],div,span')].filter(vis).find(e=>/more\s+information|更多信息/i.test(txt(e)));if(x)x=x.closest('button,[role="button"],a,[tabindex]')||x;if(!x)x=[...document.querySelectorAll('button,[role="button"],a,[tabindex]')].filter(vis).find(e=>/^\+$/.test(txt(e))||/plus|expand/i.test(`${txt(e)} ${e.getAttribute('aria-label')||''}`));if(!x)return false;x.setAttribute('data-mayavi-more','1');return true}).catch(()=>false);if(!ok)return false;await page.click('[data-mayavi-more="1"]').catch(()=>page.evaluate(()=>document.querySelector('[data-mayavi-more="1"]')?.click()).catch(()=>{}));await new Promise(r=>setTimeout(r,850));return true}
async function scroll(page){for(let i=0;i<18;i++){await page.evaluate(()=>{window.scrollBy(0,Math.max(480,innerHeight*.75));for(const e of document.querySelectorAll('*'))if(e.scrollHeight>e.clientHeight+160)e.scrollTop=Math.min(e.scrollHeight,e.scrollTop+Math.max(380,e.clientHeight*.75))}).catch(()=>{});await new Promise(r=>setTimeout(r,180))}}

export async function trackSaudiaDirect(input){
  const mawb=normalizeMawb(input);if(!mawb||!mawb.startsWith('065-'))return{ok:false,reason:'INVALID SAUDIA MAWB',officialTracker:URL};
  let browser;const responses=[];
  try{
    chromium.setGraphicsMode=false;browser=await puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox','--lang=en-US,en'],defaultViewport:{width:1365,height:900},executablePath:await chromium.executablePath(),headless:'shell'});
    const page=await browser.newPage();await page.setExtraHTTPHeaders({'Accept-Language':'en-US,en;q=0.9'});
    page.on('response',async r=>{try{if(/\/apis\/api\/eservices\/track-shipment/i.test(r.url()))responses.push({status:r.status(),body:(await r.text().catch(()=>'' )).slice(0,6000)})}catch{}});
    await page.goto(URL,{waitUntil:'domcontentloaded',timeout:24000});await new Promise(r=>setTimeout(r,1800));
    // 1. English first.
    await translatePage(page);
    if(!await findAwb(page))return{ok:false,reason:'SAUDIA AWB INPUT NOT FOUND',officialTracker:URL};
    // 2. Fill AWB.
    const digits=mawb.replace(/\D/g,'');await page.click('[data-mayavi-awb="1"]',{clickCount:3}).catch(()=>{});await page.keyboard.press('Control+A').catch(()=>{});await page.keyboard.press('Backspace').catch(()=>{});await page.type('[data-mayavi-awb="1"]',digits,{delay:30});
    // 3. Arrow.
    if(!await clickArrow(page))return{ok:false,reason:'SAUDIA ARROW NOT FOUND',officialTracker:URL};
    await Promise.race([page.waitForNetworkIdle({idleTime:700,timeout:8500}).catch(()=>{}),new Promise(r=>setTimeout(r,8500))]);await new Promise(r=>setTimeout(r,700));
    if(responses.some(x=>x.status===400&&/invalidCaptcha|captcha/i.test(x.body)))return{ok:false,reason:'SAUDIA CAPTCHA VALIDATION REQUIRED — USER-SIDE VALIDATION NEEDED',officialTracker:URL};
    await translatePage(page);
    // 4. More information.
    const moreClicked=await clickMore(page);await translatePage(page);
    // 5. Read all segments for booking/arrival details, but NOT for status.
    await scroll(page);await translatePage(page);const text=await pageText(page),parsed=parse(text,mawb);
    if(!parsed)return{ok:false,reason:'SAUDIA MORE-INFORMATION DETAILS COULD NOT BE VERIFIED',officialTracker:URL,debug:{moreClicked}};
    return{ok:true,shipment:parsed.shipment,debug:{stage:'SUCCESS',moreClicked,summaryState:parsed.summaryState||'',segments:parsed.segs.length,segment1:parsed.segs[0]?.text?.slice(0,500)||'',lastSegment:parsed.segs.at(-1)?.text?.slice(0,650)||''}};
  }catch(e){return{ok:false,reason:`SAUDIA V3 ERROR: ${e?.message||e}`,officialTracker:URL};}
  finally{try{if(browser)await browser.close()}catch{}}
}
