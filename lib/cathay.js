import { normalizeMawb } from './airlines.js';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const BASE='https://www.cathaycargoterminal.com/en-us/Shipment-Tracking';
const CATHAY='https://www.cathaycargo.com/en-us/track-and-trace.html';
const AIRLINE={name:'Cathay Cargo',iata:'CX',url:CATHAY};
const months={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
const pad=v=>String(v).padStart(2,'0');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clean=s=>String(s||'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/\s+/g,' ').trim();

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
  const rcs=text.match(/Received from Shipper[\s\S]{0,500}?(\d{1,2}\s+[A-Z]{3}\s+20\d{2}\s+\d{1,2}:\d{2})\s+(\d{1,6})\s+([\d,.]+)/i);
  const depSection=(text.match(/Departure Flight[\s\S]{0,1000}?(?=Received from Flight|Cargo Delivered|Last Update|$)/i)||[])[0]||'';
  const deps=[...depSection.matchAll(/\b(CX\d{2,4})\s+(\d{1,2}\s+[A-Z]{3}\s+20\d{2})\s+(\d{1,2}:\d{2})\s*\(STD\)\s+(\d{1,6})\s+([\d,.]+)/gi)],dep=deps.at(-1);
  const rcfSection=(text.match(/Received from Flight[\s\S]{0,1900}?(?=Cargo Delivered|Last Update|$)/i)||[])[0]||'';
  const rcfs=[...rcfSection.matchAll(/\b(CX\d{2,4})\s+(\d{1,2}\s+[A-Z]{3}\s+20\d{2})(?:\s+\d{1,2}:\d{2})?\s+(\d{1,6})\s+([\d,.]+)\s+(\d{1,2}\s+[A-Z]{3}\s+20\d{2}\s+\d{1,2}:\d{2})/gi)],rcf=rcfs.at(-1);
  const arrival=rcf?dt(rcf[5]):{date:'',time:''};
  const delivered=/Cargo Delivered\s*\(DLV\)|Cargo Delivered/i.test(text);
  const pieces=rcf?.[3]||dep?.[4]||rcs?.[2]||'';
  const weight=(rcf?.[4]||dep?.[5]||rcs?.[3]||'').replace(/,/g,'');
  const flightNo=(rcf?.[1]||dep?.[1]||'').toUpperCase();
  const bookingDate=rcs?dt(rcs[1]).date:'';
  const status=delivered?'DELIVERED':rcf?'ARRIVED':dep?'IN TRANSIT':rcs?'BOOKED':'TRACKING';
  return{mawb,carrierCode:'CX',airlineName:'Cathay Cargo',origin:od?.[1]||'',destination:od?.[2]||'',bags:pieces,pieces,weight,bookingDate,flightNo,arrivalDate:arrival.date,arrivalTime:arrival.time,arrivalIsActual:Boolean(rcf&&arrival.date),status,officialTracker:CATHAY,source:'Cathay Cargo Terminal official tracking'};
}

function parseOfficial(raw='',mawb='',referenceYear=''){
  const text=clean(raw),year=(String(referenceYear).match(/20\d{2}/)||[])[0]||String(new Date().getUTCFullYear());
  const route=text.match(/\b([A-Z]{3})\s+to\s+([A-Z]{3})\s*\|\s*(\d+)\s*pc(?:\(s\)|s)?\s*\|\s*([\d,.]+)\s*kg/i)||text.match(/\b([A-Z]{3})\s+to\s+([A-Z]{3})\b/i);
  const origin=route?.[1]||'',destination=route?.[2]||'';
  const pieces=route?.[3]||(text.match(/\b(\d{1,5})\s*pc(?:\(s\)|s)?\b/i)||[])[1]||'';
  const weight=(route?.[4]||(text.match(/\b([\d,.]+)\s*kg\b/i)||[])[1]||'').replace(/,/g,'');
  const flightNo=((text.match(/\b(CX\s*\d{2,4})\b/i)||[])[1]||'').replace(/\s+/g,'').toUpperCase();
  let arrivalDate='',arrivalTime='';
  if(flightNo){
    const esc=flightNo.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    let m=text.match(new RegExp(`(\\d{1,2}\\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\\s+\\d{1,2}:\\d{2})[\\s\\S]{0,150}?${esc}[\\s\\S]{0,260}?(\\d{1,2}\\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\\s+\\d{1,2}:\\d{2})`,'i'));
    if(!m)m=text.match(new RegExp(`${esc}[\\s\\S]{0,260}?(\\d{1,2}\\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\\s+\\d{1,2}:\\d{2})[\\s\\S]{0,260}?(\\d{1,2}\\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\\s+\\d{1,2}:\\d{2})`,'i'));
    if(m){const x=dm(m[2],year);arrivalDate=x.date;arrivalTime=x.time;}
  }
  if(!arrivalDate){
    const m=text.match(/Estimated(?:\s+arrival)?[\s\S]{0,120}?(\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*(?:\s+20\d{2})?\s+\d{1,2}:\d{2})/i);
    if(m){const x=/20\d{2}/.test(m[1])?dt(m[1]):dm(m[1],year);arrivalDate=x.date;arrivalTime=x.time;}
  }
  const arrived=destination?new RegExp(`\\b${destination}\\s+Arrived\\b`,'i').test(text)||/\bArrived\s+\d+\/\d+\b/i.test(text):/\bArrived\b/i.test(text);
  return{mawb,carrierCode:'CX',airlineName:'Cathay Cargo',origin,destination,bags:pieces,pieces,weight,flightNo,arrivalDate,arrivalTime,arrivalIsActual:Boolean(arrived&&arrivalDate),status:arrived?'ARRIVED':'IN TRANSIT',officialTracker:CATHAY,source:'Cathay Cargo official Track & Trace'};
}

async function getTerminal(mawb){
  const suffix=mawb.replace(/\D/g,'').slice(3);let last='';
  for(const url of [`${BASE}/AWBPrefix/160/AWBSuffix/${suffix}`,`${BASE}?AWBPrefix=160&AWBSuffix=${suffix}`]){
    try{const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0','accept-language':'en-US,en;q=0.9'},cache:'no-store',signal:AbortSignal.timeout(5000)});last=`HTTP ${r.status}`;if(!r.ok)continue;const parsed=parseTerminal(await r.text(),mawb);if(parsed)return{ok:true,shipment:parsed,last};}catch(e){last=e?.message||String(e);}
  }
  return{ok:false,last};
}

async function pageText(page){const parts=[];for(const f of page.frames()){try{const t=await f.evaluate(()=>document.body?.innerText||'');if(t)parts.push(t);}catch{}}return parts.join('\n');}
async function clickText(page,rx){for(const f of page.frames()){try{const hit=await f.evaluate(src=>{const re=new RegExp(src,'i'),els=[...document.querySelectorAll('button,input[type="submit"],input[type="button"],a,[role="button"]')],vis=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>8&&r.height>8&&s.display!=='none'&&s.visibility!=='hidden'&&!e.disabled;},e=els.find(x=>vis(x)&&re.test((x.innerText||x.value||x.textContent||x.getAttribute('aria-label')||'').trim()));if(!e)return'';const t=(e.innerText||e.value||e.textContent||'').trim();e.click();return t;},rx.source);if(hit)return hit;}catch{}}return'';}
async function registered(page,serial){return page.evaluate(s=>{const norm=v=>String(v||'').replace(/\D/g,'');const t=document.body?.innerText||'',vals=[...document.querySelectorAll('input,textarea,[contenteditable="true"],[tabindex="0"]')].map(e=>String(('value'in e?e.value:'')||e.textContent||''));return{ok:norm(t).includes(s)||vals.map(norm).some(v=>v.includes(s)),body:t.slice(0,3200),values:vals.slice(0,22)};},serial).catch(()=>({ok:false,body:'',values:[]}));}

async function focusAwbByAX(page,serial,debug){
  try{
    const client=await page.createCDPSession();await client.send('Accessibility.enable');const tree=await client.send('Accessibility.getFullAXTree');
    const boxes=(tree.nodes||[]).filter(n=>!n.ignored&&String(n.role?.value||'').toLowerCase()==='textbox');
    debug.axTextboxes=boxes.slice(0,12).map((n,i)=>({i,name:n.name?.value||'',value:n.value?.value||'',backendDOMNodeId:n.backendDOMNodeId||0}));
    const awb=boxes.find(n=>/air\s*waybill|waybill|awb/i.test(String(n.name?.value||'')))||boxes.find((n,i)=>i>0&&!/search/i.test(String(n.name?.value||'')))||boxes[1];
    if(!awb?.backendDOMNodeId)return false;
    const resolved=await client.send('DOM.resolveNode',{backendNodeId:awb.backendDOMNodeId});const objectId=resolved?.object?.objectId;if(!objectId)return false;
    await client.send('Runtime.callFunctionOn',{objectId,functionDeclaration:'function(){try{this.click()}catch(e){};try{this.focus()}catch(e){};return {tag:this.tagName||"",value:this.value||"",name:this.getAttribute?.("aria-label")||this.name||""}}',returnByValue:true});
    await page.keyboard.press('Control+A').catch(()=>{});await page.keyboard.press('Backspace').catch(()=>{});await page.keyboard.type(serial,{delay:60}).catch(()=>{});await page.keyboard.press('Enter').catch(()=>{});await sleep(500);
    debug.axFocused=true;return true;
  }catch(e){debug.axError=e?.message||String(e);return false;}
}

async function officialCathay(mawb,referenceYear=''){
  let browser,killTimer;const serial=mawb.replace(/\D/g,'').slice(3),debug={fillMode:'fixed-160-suffix',trackClicked:false,registered:false,bookingScrolled:false};
  try{
    chromium.setGraphicsMode=false;
    browser=await puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox','--disable-http2','--disable-quic'],defaultViewport:{width:1440,height:1100},executablePath:await chromium.executablePath(),headless:'shell'});
    const proc=browser.process?.();killTimer=setTimeout(()=>{try{proc?.kill('SIGKILL');}catch{}},35000);
    const page=await browser.newPage();page.setDefaultTimeout(6000);await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36');
    await page.goto(CATHAY,{waitUntil:'domcontentloaded',timeout:14000});await sleep(2200);await clickText(page,/^(Reject all|Accept all)$/i);await sleep(400);

    await focusAwbByAX(page,serial,debug);let reg=await registered(page,serial);
    if(!reg.ok){
      const codeIndex=await page.evaluate(()=>{const all=[...document.querySelectorAll('input')],vis=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>20&&r.height>15&&s.display!=='none'&&s.visibility!=='hidden'&&!e.disabled;};let i=all.findIndex(e=>vis(e)&&/airlinecodefield/i.test(`${e.id||''} ${e.name||''}`));if(i<0)i=all.findIndex(e=>vis(e)&&(e.type||'text').toLowerCase()==='text'&&!/search/i.test(`${e.id||''} ${e.name||''} ${e.placeholder||''} ${e.getAttribute('aria-label')||''}`));return i;}).catch(()=>-1);
      debug.codeIndex=codeIndex;if(codeIndex<0)return{ok:false,reason:'CATHAY FIXED 160 FIELD NOT FOUND',debug};
      const inputs=await page.$$('input'),code=inputs[codeIndex];if(!code)return{ok:false,reason:'CATHAY FIXED 160 HANDLE NOT FOUND',debug};await code.focus();await page.keyboard.press('Tab');await sleep(250);
      const wrap=await page.evaluate(()=>{const e=document.activeElement,r=e?.getBoundingClientRect?.();return{tag:e?.tagName||'',className:String(e?.className||''),text:String(e?.innerText||e?.textContent||''),tabIndex:e?.tabIndex??-1,x:r?r.left+r.width/2:0,y:r?r.top+r.height/2:0,w:r?.width||0,h:r?.height||0};}).catch(()=>null);debug.awbWrapper=wrap;
      if(!wrap||wrap.tag!=='DIV'||wrap.tabIndex<0||!/Air Waybill number\(s\)|warpper/i.test(`${wrap.text} ${wrap.className}`))return{ok:false,reason:'CATHAY AWB WRAPPER NOT FOCUSED',debug};
      await page.mouse.click(wrap.x,wrap.y).catch(()=>{});await sleep(300);
      const inner=await page.evaluate(()=>{const wraps=[...document.querySelectorAll('div[tabindex="0"]')],w=wraps.find(e=>/Air Waybill number\(s\)/i.test(e.innerText||e.textContent||'')||/warpper/i.test(String(e.className||'')));if(!w)return{focused:false,children:[]};const els=[...w.querySelectorAll('input,textarea,[contenteditable="true"],[role="textbox"],[role="combobox"]')];const children=els.map((e,i)=>({i,tag:e.tagName,type:e.type||'',className:String(e.className||''),id:e.id||'',name:e.name||'',value:'value'in e?String(e.value||''):'',contenteditable:e.isContentEditable,role:e.getAttribute('role')||'',w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height}));const e=els.find(x=>!x.disabled&&!['submit','button','checkbox','radio'].includes((x.type||'').toLowerCase()));if(e){e.focus();e.click();}return{focused:Boolean(e),children};}).catch(()=>({focused:false,children:[]}));debug.innerEditor=inner;
      if(inner.focused){await page.keyboard.press('Control+A').catch(()=>{});await page.keyboard.press('Backspace').catch(()=>{});await page.keyboard.type(serial,{delay:60}).catch(()=>{});await page.keyboard.press('Enter').catch(()=>{});await sleep(500);reg=await registered(page,serial);}
      if(!reg.ok){await page.evaluate(s=>{const e=document.activeElement;try{const d=new DataTransfer();d.setData('text/plain',s);e?.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:d}));}catch{}},serial).catch(()=>{});await sleep(350);reg=await registered(page,serial);}
      if(!reg.ok){await page.mouse.click(wrap.x,wrap.y).catch(()=>{});await page.keyboard.type(serial,{delay:60}).catch(()=>{});await page.keyboard.press('Enter').catch(()=>{});await sleep(500);reg=await registered(page,serial);}
    }
    debug.registration=reg;debug.registered=reg.ok;if(!reg.ok)return{ok:false,reason:'CATHAY AWB SUFFIX DID NOT REGISTER',debug};

    const track=await clickText(page,/^Track\s*now$/i)||await clickText(page,/^Track$/i);debug.trackClicked=Boolean(track);if(!track)return{ok:false,reason:'CATHAY TRACK NOW NOT CLICKED',debug};
    for(let i=0;i<17;i++){await sleep(650);const t=await pageText(page);if(/Booking Status|Current status:|Shipment In Progress|Accepted\s+\d+\/\d+|Departed\s+\d+\/\d+|Arrived\s+\d+\/\d+/i.test(t))break;}
    debug.bookingScrolled=await page.evaluate(()=>{const els=[...document.querySelectorAll('h1,h2,h3,h4,h5,h6,div,span,p')],e=els.find(x=>/^Booking Status$/i.test((x.innerText||x.textContent||'').trim()));if(e){e.scrollIntoView({block:'start'});window.scrollBy(0,-100);return true;}window.scrollBy(0,500);return false;}).catch(()=>false);await sleep(700);
    const text=await pageText(page),flat=clean(text),i=flat.search(/Booking Status/i),booking=i>=0?flat.slice(i,i+4500):flat;debug.bookingText=booking.slice(0,4500);
    const shipment=parseOfficial(booking,mawb,referenceYear);if(!shipment.origin||!shipment.destination||!shipment.flightNo)return{ok:false,reason:'CATHAY BOOKING STATUS DETAILS NOT VISIBLE',debug,shipment};
    return{ok:true,shipment,debug};
  }catch(e){return{ok:false,reason:e?.message||String(e),debug};}
  finally{if(killTimer)clearTimeout(killTimer);if(browser){try{await Promise.race([browser.close(),sleep(1000)]);}catch{}try{browser.process?.()?.kill('SIGKILL');}catch{}}}
}

export async function trackCathay(input){
  const mawb=normalizeMawb(input);if(!mawb||!mawb.startsWith('160-'))return{ok:false,reason:'INVALID CATHAY MAWB',airline:AIRLINE};
  const terminal=await getTerminal(mawb);if(terminal.ok&&(terminal.shipment.status==='ARRIVED'||terminal.shipment.status==='DELIVERED'))return{ok:true,airline:AIRLINE,shipment:terminal.shipment,debug:{stage:'SUCCESS',source:'cathay-terminal-actual'}};
  const live=await officialCathay(mawb,terminal.ok?terminal.shipment.bookingDate:'');
  if(live.ok){const t=terminal.ok?terminal.shipment:{},s=live.shipment||{};const shipment={...t,...s,origin:s.origin||t.origin||'',destination:s.destination||t.destination||'',bags:s.bags||t.bags||'',pieces:s.pieces||t.pieces||'',weight:s.weight||t.weight||'',bookingDate:t.bookingDate||'',flightNo:s.flightNo||t.flightNo||'',arrivalDate:s.arrivalDate||t.arrivalDate||'',arrivalTime:s.arrivalTime||t.arrivalTime||'',arrivalIsActual:Boolean(s.arrivalIsActual),status:s.status||t.status||'IN TRANSIT',source:'Cathay Cargo official Track & Trace'};if(shipment.arrivalIsActual)shipment.status='ARRIVED';return{ok:true,airline:AIRLINE,shipment,debug:{stage:'SUCCESS',source:'cathay-official-booking-status',live:live.debug,terminal:terminal.last}};}
  if(terminal.ok)return{ok:true,airline:AIRLINE,shipment:terminal.shipment,debug:{stage:'SUCCESS',source:'cathay-terminal',browserFallback:live.reason,live:live.debug}};
  return{ok:false,reason:'CATHAY TRACKING FAILED',airline:AIRLINE,debug:{live,terminal}};
}