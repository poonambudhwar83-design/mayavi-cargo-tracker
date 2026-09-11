import { normalizeMawb } from './airlines.js';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const TERMINAL='https://www.cathaycargoterminal.com/en-us/Shipment-Tracking';
const CATHAY='https://www.cathaycargo.com/en-us/track-and-trace.html';
const AIRLINE={name:'Cathay Cargo',iata:'CX',url:CATHAY};
const months={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
const pfMonths=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const indiaAirports=new Set(['DEL','BOM','BLR','MAA','HYD','CCU','COK']);
const zoneHours={UTC:0,GMT:0,HKT:8,SGT:8,JST:9,KST:9,IST:5.5,PKT:5,BST:1,CET:1,CEST:2,EET:2,EEST:3,EST:-5,EDT:-4,CST:-6,CDT:-5,MST:-7,MDT:-6,PST:-8,PDT:-7,AKST:-9,AKDT:-8,HST:-10,AEST:10,AEDT:11,ACST:9.5,ACDT:10.5,AWST:8,NZST:12,NZDT:13};
const pad=v=>String(v).padStart(2,'0');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clean=s=>String(s||'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&#39;|&apos;/gi,"'").replace(/\s+/g,' ').trim();

function dt(v=''){
  const s=String(v).toUpperCase();
  let m=s.match(/(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s,]+(20\d{2})(?:\s+(\d{1,2}):(\d{2}))?/);
  if(m)return{date:`${m[3]}-${months[m[2]]}-${pad(m[1])}`,time:m[4]?`${pad(m[4])}:${m[5]}`:''};
  m=s.match(/(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})(?:[T\s][^0-9]*(\d{1,2}):(\d{2}))?/);
  return m?{date:`${m[1]}-${pad(m[2])}-${pad(m[3])}`,time:m[4]?`${pad(m[4])}:${m[5]}`:''}:{date:'',time:''};
}
function dm(v='',year=''){
  const m=String(v).toUpperCase().match(/(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*(?:\s+(\d{1,2}):(\d{2}))?/);
  if(!m)return{date:'',time:''};
  return{date:`${year||new Date().getUTCFullYear()}-${months[m[2]]}-${pad(m[1])}`,time:m[3]?`${pad(m[3])}:${m[4]}`:''};
}

function parseTerminal(html,mawb){
  const text=clean(html),digits=mawb.replace(/\D/g,''),serial=digits.slice(3);
  if((!text.includes(digits)&&!text.includes(serial))||/Reject Reason|is not found/i.test(text))return null;
  const od=text.match(/AWB Type\s+(?:Import|Export)\s+([A-Z]{3})\s+([A-Z]{3})/i)||text.match(/Origin\s+Destination\s+([A-Z]{3})\s+([A-Z]{3})/i);
  const rcs=text.match(/Received from Shipper[\s\S]{0,900}?(\d{1,2}\s+[A-Z]{3}\s+20\d{2}\s+\d{1,2}:\d{2})\s+(\d{1,6})\s+([\d,.]+)/i);
  const depSection=(text.match(/Departure Flight[\s\S]{0,1800}?(?=Received from Flight|Cargo Delivered|Last Update|$)/i)||[])[0]||'';
  const deps=[...depSection.matchAll(/\b(CX\d{2,4})\s+(\d{1,2}\s+[A-Z]{3}\s+20\d{2})\s+(\d{1,2}:\d{2})\s*\(STD\)\s+(\d{1,6})\s+([\d,.]+)/gi)],dep=deps.at(-1);
  const atd=(depSection.match(/(?:\d{1,2}\s+[A-Z]{3}\s+20\d{2}\s+)?(\d{1,2}:\d{2})\s*\(ATD\)/i)||[]);
  const departure=dep?dt(`${dep[2]} ${atd[1]||dep[3]}`):{date:'',time:''};
  const rcfSection=(text.match(/Received from Flight[\s\S]{0,3000}?(?=Cargo Delivered|Last Update|$)/i)||[])[0]||'';
  const rcfs=[...rcfSection.matchAll(/\b(CX\d{2,4})\s+(\d{1,2}\s+[A-Z]{3}\s+20\d{2})(?:\s+\d{1,2}:\d{2})?\s+(\d{1,6})\s+([\d,.]+)\s+(\d{1,2}\s+[A-Z]{3}\s+20\d{2}\s+\d{1,2}:\d{2})/gi)],rcf=rcfs.at(-1);
  const arrival=rcf?dt(rcf[5]):{date:'',time:''};
  const delivered=/Cargo Delivered\s*\(DLV\)|Cargo Delivered/i.test(text);
  const pieces=rcf?.[3]||dep?.[4]||rcs?.[2]||'';
  const weight=(rcf?.[4]||dep?.[5]||rcs?.[3]||'').replace(/,/g,'');
  const flightNo=(rcf?.[1]||dep?.[1]||'').toUpperCase();
  const bookingDate=rcs?dt(rcs[1]).date:'';
  const status=delivered?'DELIVERED':rcf?'ARRIVED':dep?'IN TRANSIT':rcs?'BOOKED':'TRACKING';
  return{mawb,carrierCode:'CX',airlineName:'Cathay Cargo',origin:od?.[1]||'',destination:od?.[2]||'',bags:pieces,pieces,weight,bookingDate,flightNo,departureDate:departure.date,departureTime:departure.time,arrivalDate:arrival.date,arrivalTime:arrival.time,arrivalIsActual:Boolean(rcf&&arrival.date),status,officialTracker:CATHAY,source:'Cathay Cargo Terminal official tracking'};
}

async function getTerminal(mawb){
  const suffix=mawb.replace(/\D/g,'').slice(3);let last='';
  for(const url of [`${TERMINAL}/AWBPrefix/160/AWBSuffix/${suffix}`,`${TERMINAL}?AWBPrefix=160&AWBSuffix=${suffix}`]){
    try{const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0','accept-language':'en-US,en;q=0.9'},cache:'no-store',signal:AbortSignal.timeout(6500)});last=`HTTP ${r.status}`;if(!r.ok)continue;const shipment=parseTerminal(await r.text(),mawb);if(shipment)return{ok:true,shipment,last};}catch(e){last=e?.message||String(e);}
  }
  return{ok:false,last};
}

function parseOfficial(raw='',mawb='',referenceYear=''){
  const text=clean(raw),year=(String(referenceYear).match(/20\d{2}/)||[])[0]||String(new Date().getUTCFullYear());
  const route=text.match(/\b([A-Z]{3})\s+to\s+([A-Z]{3})\s*\|\s*(\d+)\s*pc(?:\(s\)|s)?\s*\|\s*([\d,.]+)\s*kg/i)||text.match(/\b([A-Z]{3})\s+to\s+([A-Z]{3})\b/i);
  const origin=route?.[1]||'',destination=route?.[2]||'';
  const pieces=route?.[3]||(text.match(/\b(\d{1,5})\s*pc(?:\(s\)|s)?\b/i)||[])[1]||'';
  const weight=(route?.[4]||(text.match(/\b([\d,.]+)\s*kg\b/i)||[])[1]||'').replace(/,/g,'');
  const flightNo=((text.match(/\b(CX\s*\d{2,4})\b/i)||[])[1]||'').replace(/\s+/g,'').toUpperCase();
  let arrivalDate='',arrivalTime='';
  const arrived=destination?new RegExp(`\\b${destination}\\s+Arrived\\b`,'i').test(text)||/\bArrived\s+\d+\/\d+\b/i.test(text):/\bArrived\b/i.test(text);
  const actualPatterns=[/(?:Arrived|Actual arrival|ATA)[\s\S]{0,180}?(\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*(?:\s+20\d{2})?\s+\d{1,2}:\d{2})/i,/(\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*(?:\s+20\d{2})?\s+\d{1,2}:\d{2})[\s\S]{0,100}?Arrived/i];
  if(arrived){for(const rx of actualPatterns){const m=text.match(rx);if(!m)continue;const x=/20\d{2}/.test(m[1])?dt(m[1]):dm(m[1],year);if(x.date){arrivalDate=x.date;arrivalTime=x.time;break;}}}
  if(!arrivalDate&&flightNo){const esc=flightNo.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');let m=text.match(new RegExp(`(\\d{1,2}\\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\\s+\\d{1,2}:\\d{2})[\\s\\S]{0,180}?${esc}[\\s\\S]{0,320}?(\\d{1,2}\\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\\s+\\d{1,2}:\\d{2})`,'i'));if(!m)m=text.match(new RegExp(`${esc}[\\s\\S]{0,320}?(\\d{1,2}\\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\\s+\\d{1,2}:\\d{2})[\\s\\S]{0,320}?(\\d{1,2}\\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\\s+\\d{1,2}:\\d{2})`,'i'));if(m){const x=dm(m[2],year);arrivalDate=x.date;arrivalTime=x.time;}}
  if(!arrivalDate){const m=text.match(/Estimated(?:\s+arrival)?[\s\S]{0,160}?(\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*(?:\s+20\d{2})?\s+\d{1,2}:\d{2})/i);if(m){const x=/20\d{2}/.test(m[1])?dt(m[1]):dm(m[1],year);arrivalDate=x.date;arrivalTime=x.time;}}
  return{mawb,carrierCode:'CX',airlineName:'Cathay Cargo',origin,destination,bags:pieces,pieces,weight,flightNo,arrivalDate,arrivalTime,arrivalIsActual:Boolean(arrived&&arrivalDate),status:arrived?'ARRIVED':'IN TRANSIT',officialTracker:CATHAY,source:'Cathay Cargo official Track & Trace'};
}

async function clickText(page,rx){for(const f of page.frames()){try{const hit=await f.evaluate(src=>{const re=new RegExp(src,'i'),els=[...document.querySelectorAll('button,input[type="submit"],input[type="button"],a,[role="button"]')],vis=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>8&&r.height>8&&s.display!=='none'&&s.visibility!=='hidden'&&!e.disabled;},e=els.find(x=>vis(x)&&re.test((x.innerText||x.value||x.textContent||x.getAttribute('aria-label')||'').trim()));if(!e)return'';const t=(e.innerText||e.value||e.textContent||'').trim();e.click();return t;},rx.source);if(hit)return hit;}catch{}}return'';}
async function frameText(page){const parts=[];for(const f of page.frames()){try{const t=await f.evaluate(()=>document.body?.innerText||'');if(t)parts.push(t);}catch{}}return parts.join('\n');}
async function registrationSnapshot(page,serial,digits){
  try{return await page.evaluate(({serial,digits})=>{const norm=v=>String(v||'').replace(/\D/g,'');const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>2&&r.height>2&&s.display!=='none'&&s.visibility!=='hidden';};const chipSelectors='[role="listitem"],[role="option"],[class*="chip" i],[class*="tag" i],[class*="token" i],[class*="pill" i]';const chip=[...document.querySelectorAll(chipSelectors)].find(e=>visible(e)&&[serial,digits].some(x=>norm(e.innerText||e.textContent||'').includes(x)));const values=[...document.querySelectorAll('input,textarea,[contenteditable="true"],[role="textbox"]')].map(e=>({value:String('value'in e?e.value:e.textContent||''),label:String(e.getAttribute('aria-label')||e.getAttribute('placeholder')||e.getAttribute('name')||e.id||'')}));const body=document.body?.innerText||'';return{ok:Boolean(chip)||norm(body).includes(digits)||norm(body).includes(serial),chip:chip?String(chip.innerText||chip.textContent||'').slice(0,180):'',values:values.slice(0,30),body:body.slice(0,4200)};},{serial,digits});}catch{return{ok:false,chip:'',values:[],body:''};}
}
async function findControls(page){
  return page.evaluate(()=>{const vis=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>15&&r.height>15&&s.display!=='none'&&s.visibility!=='hidden'&&!e.disabled;};const controls=[...document.querySelectorAll('input,textarea,[contenteditable="true"],[role="textbox"]')].filter(vis);const desc=e=>{const id=e.id||'',label=id?document.querySelector(`label[for="${CSS.escape(id)}"]`):null;return `${e.getAttribute('aria-label')||''} ${e.getAttribute('placeholder')||''} ${e.getAttribute('name')||''} ${id} ${label?.innerText||''} ${e.parentElement?.innerText||''}`.trim();};const code=controls.findIndex(e=>String('value'in e?e.value:e.textContent||'').replace(/\D/g,'')==='160'||/airline\s*code/i.test(desc(e)));let awb=controls.findIndex((e,i)=>i!==code&&/air\s*waybill|waybill|\bawb\b/i.test(desc(e))&&!/airline\s*code/i.test(desc(e)));if(awb<0)awb=controls.findIndex((e,i)=>i!==code&&!/search/i.test(desc(e)));return{code,awb,controls:controls.map((e,i)=>({i,tag:e.tagName,value:String('value'in e?e.value:e.textContent||''),desc:desc(e).slice(0,220),tabIndex:e.tabIndex}))};});
}
async function focusControl(page,index){return page.evaluate(i=>{const vis=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>15&&r.height>15&&s.display!=='none'&&s.visibility!=='hidden'&&!e.disabled;};const controls=[...document.querySelectorAll('input,textarea,[contenteditable="true"],[role="textbox"]')].filter(vis),e=controls[i];if(!e)return false;e.click();e.focus();return document.activeElement===e||e.contains(document.activeElement);},index).catch(()=>false);}
async function clickAwbWrapper(page){return page.evaluate(()=>{const vis=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>15&&r.height>15&&s.display!=='none'&&s.visibility!=='hidden';};const rx=/Air Waybill number\(s\)|Air Waybill number|AWB/i;const labels=[...document.querySelectorAll('label')].filter(x=>vis(x)&&rx.test(String(x.innerText||x.textContent||'')));for(const label of labels){const forId=label.getAttribute('for'),byFor=forId&&document.getElementById(forId);const root=label.closest('div,section,fieldset')||label.parentElement;const target=(byFor&&vis(byFor)?byFor:null)||root?.querySelector('input,textarea,[contenteditable="true"],[role="textbox"]');if(target&&vis(target)){target.click();target.focus?.();return true;}const sibling=label.nextElementSibling;if(sibling&&vis(sibling)){const nested=sibling.matches?.('input,textarea,[contenteditable="true"],[role="textbox"]')?sibling:sibling.querySelector?.('input,textarea,[contenteditable="true"],[role="textbox"]');if(nested&&vis(nested)){nested.click();nested.focus?.();return true;}sibling.click();sibling.focus?.();if(document.activeElement&&document.activeElement!==document.body)return true;}}
    const candidates=[...document.querySelectorAll('div,section,fieldset,[role="group"]')].filter(x=>vis(x)&&rx.test(String(x.innerText||x.textContent||'')));for(const e of candidates){const t=e.querySelector('input,textarea,[contenteditable="true"],[role="textbox"]');if(t&&vis(t)){t.click();t.focus?.();return true;}e.click();e.focus?.();if(document.activeElement&&document.activeElement!==document.body)return true;}return false;}).catch(()=>false);}
async function clearFocused(page){await page.keyboard.press('Control+A').catch(()=>{});await page.keyboard.press('Backspace').catch(()=>{});}
async function commitFocused(page,commit){if(commit==='comma')await page.keyboard.type(',').catch(()=>{});else if(commit==='blur')await page.evaluate(()=>document.activeElement?.blur?.()).catch(()=>{});else await page.keyboard.press(commit).catch(()=>{});}

async function officialCathay(mawb,referenceYear=''){
  let browser,killTimer;const digits=mawb.replace(/\D/g,''),serial=digits.slice(3),hyphen=`${digits.slice(0,3)}-${serial}`,debug={registered:false,trackClicked:false,attempts:[]};
  try{
    chromium.setGraphicsMode=false;
    browser=await puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox','--disable-http2','--disable-quic'],defaultViewport:{width:1440,height:1100},executablePath:await chromium.executablePath(),headless:'shell'});
    const proc=browser.process?.();killTimer=setTimeout(()=>{try{proc?.kill('SIGKILL');}catch{}},52000);
    const page=await browser.newPage();page.setDefaultTimeout(7000);await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36');
    await page.goto(CATHAY,{waitUntil:'domcontentloaded',timeout:17000});await sleep(2600);await clickText(page,/^(Reject all|Accept all)$/i);await sleep(450);
    let controls=await findControls(page);debug.controls=controls.controls;
    const codeValue=controls.code>=0?String(controls.controls[controls.code]?.value||'').replace(/\D/g,''):'';debug.airlineCode=codeValue;debug.airlineCodeControlFound=controls.code>=0;if(codeValue&&codeValue!=='160')return{ok:false,reason:'CATHAY AIRLINE CODE CONTROL HAS UNEXPECTED VALUE',debug};
    const attempt=async(mode,value,commit,focusMode='direct')=>{
      controls=await findControls(page);let focused=false;
      if(focusMode==='wrapper')focused=await clickAwbWrapper(page);else if(focusMode==='tab'&&controls.code>=0){focused=await focusControl(page,controls.code);if(focused){await page.keyboard.press('Tab').catch(()=>{});await sleep(120);}}else focused=controls.awb>=0&&await focusControl(page,controls.awb);
      if(!focused){debug.attempts.push({mode,value,commit,focusMode,focused:false,ok:false});return{ok:false};}
      await clearFocused(page);await page.keyboard.type(value,{delay:45}).catch(()=>{});await commitFocused(page,commit);await sleep(650);const snap=await registrationSnapshot(page,serial,digits);debug.attempts.push({mode,value,commit,focusMode,focused:true,ok:snap.ok,chip:snap.chip});return snap;
    };
    const permutations=[
      ['suffix-enter',serial,'Enter','direct'],['suffix-tab',serial,'Tab','direct'],['suffix-comma',serial,'comma','direct'],['suffix-blur',serial,'blur','direct'],
      ['full-digits-enter',digits,'Enter','direct'],['full-hyphen-enter',hyphen,'Enter','direct'],
      ['wrapper-suffix-enter',serial,'Enter','wrapper'],['wrapper-full-enter',digits,'Enter','wrapper'],
      ['tab-from-160-suffix-enter',serial,'Enter','tab'],['tab-from-160-full-enter',digits,'Enter','tab']
    ];
    let reg={ok:false};for(const [mode,value,commit,focusMode] of permutations){reg=await attempt(mode,value,commit,focusMode);if(reg.ok)break;}
    if(!reg.ok)return{ok:false,reason:'CATHAY AWB DID NOT REGISTER AFTER SAFE INPUT PERMUTATIONS',debug};
    debug.registered=true;debug.registration={chip:reg.chip,values:reg.values,body:reg.body};
    const track=await clickText(page,/^Track\s*now$/i)||await clickText(page,/^Track$/i);debug.trackClicked=Boolean(track);if(!track)return{ok:false,reason:'CATHAY TRACK NOW NOT CLICKED',debug};
    let text='';for(let i=0;i<22;i++){await sleep(650);text=await frameText(page);if(/Booking Status|Current status:|Shipment In Progress|Accepted\s+\d+\/\d+|Departed\s+\d+\/\d+|Arrived\s+\d+\/\d+/i.test(text))break;}
    await page.evaluate(()=>{const els=[...document.querySelectorAll('*')],e=els.find(x=>/Booking Status/i.test(String(x.textContent||''))&&x.children.length<8);if(e)e.scrollIntoView({block:'center'});else window.scrollBy(0,420);}).catch(()=>{});await sleep(250);
    text=await frameText(page);const flat=clean(text),idx=flat.search(/Booking Status/i),booking=idx>=0?flat.slice(idx,idx+7000):flat;debug.bookingText=booking.slice(0,7000);
    const shipment=parseOfficial(booking,mawb,referenceYear);if(!shipment.origin||!shipment.destination||!shipment.flightNo)return{ok:false,reason:'CATHAY BOOKING STATUS DETAILS NOT VISIBLE',debug,shipment};
    return{ok:true,shipment,debug};
  }catch(e){return{ok:false,reason:e?.message||String(e),debug};}
  finally{if(killTimer)clearTimeout(killTimer);if(browser){try{await Promise.race([browser.close(),sleep(1200)]);}catch{}try{browser.process?.()?.kill('SIGKILL');}catch{}}}
}

function pfDate(iso=''){const m=String(iso).match(/^(20\d{2})-(\d{2})-(\d{2})$/);return m?`${Number(m[3])} ${pfMonths[Number(m[2])-1]} ${m[1]}`:'';}
function addDays(iso,n){const m=String(iso).match(/^(20\d{2})-(\d{2})-(\d{2})$/);if(!m)return'';return new Date(Date.UTC(+m[1],+m[2]-1,+m[3]+n)).toISOString().slice(0,10);}
function zoneOffset(zone,airport=''){
  const z=String(zone||'').toUpperCase(),a=String(airport||'').toUpperCase();
  if(indiaAirports.has(a))return 5.5;if(['HKG','SIN'].includes(a))return 8;if(['NRT','HND','KIX','ICN'].includes(a))return 9;
  return Object.prototype.hasOwnProperty.call(zoneHours,z)?zoneHours[z]:null;
}
function inferArrivalDate(depDate,depTime,depZone,arrTime,arrZone,origin='',destination=''){
  const d=String(depDate).match(/^(20\d{2})-(\d{2})-(\d{2})$/),a=String(depTime).match(/^(\d{1,2}):(\d{2})$/),b=String(arrTime).match(/^(\d{1,2}):(\d{2})$/);if(!d||!a||!b)return'';
  const od=zoneOffset(depZone,origin),oa=zoneOffset(arrZone,destination);
  if(od!=null&&oa!=null){const depUtc=Date.UTC(+d[1],+d[2]-1,+d[3],+a[1],+a[2])-od*3600000;let best=null;for(let shift=-1;shift<=2;shift++){const arrUtc=Date.UTC(+d[1],+d[2]-1,+d[3]+shift,+b[1],+b[2])-oa*3600000,h=(arrUtc-depUtc)/3600000;if(h>=0.4&&h<=22&&(!best||h<best.h))best={shift,h};}if(best)return addDays(depDate,best.shift);}
  const depMin=+a[1]*60 + +a[2],arrMin=+b[1]*60 + +b[2];return addDays(depDate,arrMin+360<depMin?1:0);
}

async function getFlightHistory(flightNo,departureDate,origin='',destination=''){
  if(!flightNo||!departureDate)return null;
  try{
    const url=`https://planefinder.net/data/flight/${encodeURIComponent(flightNo)}`;
    const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36','accept-language':'en-US,en;q=0.9'},cache:'no-store',signal:AbortSignal.timeout(7000)});if(!r.ok)return{ok:false,reason:`HTTP ${r.status}`,url};
    const html=await r.text(),target=pfDate(departureDate);if(!target)return{ok:false,reason:'BAD DATE',url};
    const past=html.match(/Past(?:<[^>]+>|\s)*Flights/i),pastIndex=past?.index??-1;
    const rows=[...html.matchAll(/<tr\b[\s\S]*?<\/tr>/gi)],row=rows.find(x=>clean(x[0]).includes(target));
    if(!row)return{ok:false,reason:'DATE ROW NOT FOUND',url,htmlSnippet:clean(html).slice(0,800)};
    const rowText=clean(row[0]),times=[...rowText.matchAll(/\b(\d{1,2}:\d{2})\s+([A-Z]{2,5})\b/g)];if(times.length<2)return{ok:false,reason:'TIMES NOT FOUND',url,row:rowText.slice(0,700)};
    const depTime=times[0][1],depZone=times[0][2],arrTime=times[1][1],arrZone=times[1][2],actual=pastIndex>=0&&(row.index??0)>pastIndex;
    return{ok:true,actual,arrivalDate:inferArrivalDate(departureDate,depTime,depZone,arrTime,arrZone,origin,destination),arrivalTime:arrTime,departureActualTime:depTime,url,row:rowText.slice(0,700),depZone,arrZone};
  }catch(e){return{ok:false,reason:e?.message||String(e)};}
}

function localDepartureMs(date,time,airport=''){
  const d=String(date).match(/^(20\d{2})-(\d{2})-(\d{2})$/),t=String(time).match(/^(\d{1,2}):(\d{2})$/);if(!d||!t)return NaN;
  const off=zoneOffset('',airport||'HKG');if(off==null)return NaN;
  return Date.UTC(+d[1],+d[2]-1,+d[3],+t[1],+t[2])-off*3600000;
}
function definitelyArrived(t){
  const dep=localDepartureMs(t.departureDate,t.departureTime,t.origin);return Number.isFinite(dep)&&Date.now()-dep>18*3600000;
}
function parseFlightStatsDate(v=''){
  const m=String(v).toUpperCase().match(/(\d{1,2})-(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)-(20\d{2})/);return m?`${m[3]}-${months[m[2]]}-${pad(m[1])}`:'';
}
async function getFlightStats(flightNo,departureDate,origin='',destination=''){
  const fm=String(flightNo||'').toUpperCase().match(/^CX(\d{1,4})$/),dm=String(departureDate||'').match(/^(20\d{2})-(\d{2})-(\d{2})$/);if(!fm||!dm)return null;
  const url=`https://www.flightstats.com/v2/flight-tracker/CX/${fm[1]}?year=${dm[1]}&month=${dm[2]}&date=${dm[3]}`;
  try{
    const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36','accept-language':'en-US,en;q=0.9'},redirect:'follow',cache:'no-store',signal:AbortSignal.timeout(7000)});if(!r.ok)return{ok:false,reason:`HTTP ${r.status}`,url};
    const text=clean(await r.text()),sec=(text.match(/Flight Arrival Times([\s\S]{0,900})/i)||[])[1]||'';
    if(!sec){
      const row=text.match(/Departure Time Origin Destination Arrival Time\s+(\d{1,2}:\d{2})\s+([A-Z]{2,5})\s+([A-Z]{3})\s+[A-Za-z .'-]{1,45}?\s+([A-Z]{3})\s+[A-Za-z .'-]{1,45}?\s+(\d{1,2}:\d{2})\s+([A-Z]{2,5})/i);
      if(row){
        const depTime=row[1],depZone=row[2].toUpperCase(),from=row[3].toUpperCase(),to=row[4].toUpperCase(),arrivalTime=row[5],arrivalZone=row[6].toUpperCase();
        const arrivalDate=inferArrivalDate(departureDate,depTime,depZone,arrivalTime,arrivalZone,origin||from,destination||to)||departureDate;
        return{ok:true,actual:false,landed:false,arrivalDate,arrivalTime,arrivalZone,timeType:'scheduled-other-day',origin:origin||from,destination:destination||to,url};
      }
      return{ok:false,reason:'ARRIVAL SECTION NOT FOUND',url,snippet:text.slice(0,1200)};
    }
    const date=parseFlightStatsDate(sec)||departureDate;
    const actual=sec.match(/Actual\s+(\d{1,2}:\d{2})\s+([A-Z]{2,5})/i);
    const estimated=sec.match(/Estimated\s+(\d{1,2}:\d{2})\s+([A-Z]{2,5})/i);
    const scheduled=sec.match(/Scheduled\s+(\d{1,2}:\d{2})\s+([A-Z]{2,5})/i);
    const pick=actual||estimated||scheduled;
    if(!pick)return{ok:false,reason:'ARRIVAL TIME NOT FOUND',url,section:sec.slice(0,700)};
    const landed=/\b(Landed|Arrived)\b/i.test(text)||Boolean(actual);
    return{ok:true,actual:landed&&Boolean(actual),landed,arrivalDate:date,arrivalTime:pick[1],arrivalZone:pick[2],timeType:actual?'actual':estimated?'estimated':'scheduled',url};
  }catch(e){return{ok:false,reason:e?.message||String(e),url};
  }
}

export async function trackCathay(input){
  const mawb=normalizeMawb(input);if(!mawb||!mawb.startsWith('160-'))return{ok:false,reason:'INVALID CATHAY MAWB',airline:AIRLINE};
  const terminal=await getTerminal(mawb);
  if(terminal.ok&&(terminal.shipment.status==='ARRIVED'||terminal.shipment.status==='DELIVERED'))return{ok:true,airline:AIRLINE,shipment:terminal.shipment,debug:{stage:'SUCCESS',source:'cathay-terminal-actual'}};
  const live=await officialCathay(mawb,terminal.ok?(terminal.shipment.departureDate||terminal.shipment.bookingDate):'');
  if(live.ok){
    const t=terminal.ok?terminal.shipment:{},s=live.shipment||{};const shipment={...t,...s,origin:s.origin||t.origin||'',destination:s.destination||t.destination||'',bags:s.bags||t.bags||'',pieces:s.pieces||t.pieces||'',weight:s.weight||t.weight||'',bookingDate:t.bookingDate||'',departureDate:t.departureDate||'',departureTime:t.departureTime||'',flightNo:s.flightNo||t.flightNo||'',arrivalDate:s.arrivalDate||t.arrivalDate||'',arrivalTime:s.arrivalTime||t.arrivalTime||'',arrivalIsActual:Boolean(s.arrivalIsActual||t.arrivalIsActual),status:s.status||t.status||'IN TRANSIT',source:'Cathay Cargo official Track & Trace'};if(shipment.arrivalIsActual)shipment.status='ARRIVED';return{ok:true,airline:AIRLINE,shipment,debug:{stage:'SUCCESS',source:'cathay-official-booking-status',live:live.debug,terminal:terminal.last}};
  }
  if(!terminal.ok)return{ok:false,reason:'CATHAY TRACKING FAILED',airline:AIRLINE,debug:{terminal,live}};
  const t=terminal.shipment;
  const flight=await getFlightHistory(t.flightNo,t.departureDate,t.origin,t.destination);
  if(flight?.ok){
    const shipment={...t,arrivalDate:flight.arrivalDate||t.arrivalDate||'',arrivalTime:flight.arrivalTime||t.arrivalTime||'',arrivalIsActual:Boolean(flight.actual),status:flight.actual?'ARRIVED':t.status,source:flight.actual?'Cathay Cargo Terminal + Plane Finder flight history':'Cathay Cargo Terminal + Plane Finder schedule'};
    return{ok:true,airline:AIRLINE,shipment,debug:{stage:'SUCCESS',source:flight.actual?'cathay-terminal-plus-flight-history':'cathay-terminal-plus-flight-schedule',flightHistory:flight,browserFallback:live.reason,live:live.debug}};
  }
  const fs=await getFlightStats(t.flightNo,t.departureDate,t.origin||'HKG',t.destination);
  if(fs?.ok){
    const arrived=Boolean(fs.landed||definitelyArrived(t));
    const shipment={...t,origin:t.origin||fs.origin||'HKG',destination:t.destination||fs.destination||'',arrivalDate:fs.arrivalDate||t.arrivalDate||'',arrivalTime:fs.arrivalTime||t.arrivalTime||'',arrivalIsActual:Boolean(fs.actual),status:arrived?'ARRIVED':t.status,source:'Cathay Cargo Terminal + FlightStats'};
    return{ok:true,airline:AIRLINE,shipment,debug:{stage:'SUCCESS',source:'cathay-terminal-plus-flightstats',flightHistory:flight,flightStats:fs,statusInferred:arrived&&!fs.landed,browserFallback:live.reason,live:live.debug}};
  }
  if(definitelyArrived(t)){
    const shipment={...t,origin:t.origin||'HKG',status:'ARRIVED',arrivalIsActual:false,source:'Cathay Cargo Terminal (arrival inferred from completed flight window)'};
    return{ok:true,airline:AIRLINE,shipment,debug:{stage:'SUCCESS',source:'cathay-terminal-completed-flight-window',flightHistory:flight,flightStats:fs,statusInferred:true,browserFallback:live.reason,live:live.debug}};
  }
  return{ok:true,airline:AIRLINE,shipment:t,debug:{stage:'SUCCESS',source:'cathay-terminal',flightHistory:flight,flightStats:fs,browserFallback:live.reason,live:live.debug}};
}