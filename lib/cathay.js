import { normalizeMawb } from './airlines.js';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const BASE='https://www.cathaycargoterminal.com/en-us/Shipment-Tracking';
const CATHAY='https://www.cathaycargo.com/en-us/track-and-trace.html';
const AIRLINE={name:'Cathay Cargo',iata:'CX',url:CATHAY};
const months={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
const pad=v=>String(v).padStart(2,'0');
const clean=s=>String(s||'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/\\u002F/g,'/').replace(/\\u003A/g,':').replace(/\\u002D/g,'-').replace(/\s+/g,' ').trim();

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
  const y=String(year||new Date().getUTCFullYear());
  return{date:`${y}-${months[m[2]]}-${pad(m[1])}`,time:m[3]?`${pad(m[3])}:${m[4]}`:''};
}
function latestDateTime(text=''){
  const flat=clean(text),hits=[];
  const rx=/(\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s+20\d{2}(?:\s+\d{1,2}:\d{2})?|20\d{2}[-\/.]\d{1,2}[-\/.]\d{1,2}(?:[T\s][^0-9]*\d{1,2}:\d{2})?)/gi;
  for(const m of flat.matchAll(rx)){const x=dt(m[1]);if(x.date)hits.push(x);}
  if(!hits.length)return{date:'',time:''};
  const wt=hits.filter(x=>x.time);return(wt.length?wt:hits).at(-1);
}
function actualArrival(text=''){
  const flat=clean(text),rx=/(?:actual\s*arrival|actualArrival|arrived|arrivalActual|received\s*from\s*flight|\bRCF\b|landed|flightArrival)/ig;let best=null;
  for(const hit of flat.matchAll(rx)){
    const w=flat.slice(Math.max(0,(hit.index||0)-180),Math.min(flat.length,(hit.index||0)+900)),x=latestDateTime(w),tm=w.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
    if(!x.time&&tm)x.time=`${pad(tm[1])}:${tm[2]}`;
    if(x.date||x.time)best={...x,snippet:w};
  }
  return best;
}
function parseBookingEta(text='',referenceYear=''){
  const flat=clean(text),year=(String(referenceYear).match(/20\d{2}/)||[])[0]||String(new Date().getUTCFullYear());
  let date='',time='';
  let m=flat.match(/(?:estimated\s+arrival(?:\s+(?:date|time))?|estimated\s+time\s+of\s+arrival|\bETA\b)[\s:.-]{0,30}(\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*(?:\s+20\d{2})?(?:\s+\d{1,2}:\d{2})?)/i);
  if(m){const x=/20\d{2}/.test(m[1])?dt(m[1]):dm(m[1],year);date=x.date;time=x.time;}
  if(!date){
    m=flat.match(/estimated\s+arrival\s+date[\s:.-]{0,30}(\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*(?:\s+20\d{2})?)/i);
    if(m){const x=/20\d{2}/.test(m[1])?dt(m[1]):dm(m[1],year);date=x.date;}
  }
  if(!time){
    m=flat.match(/estimated\s+arrival\s+time[\s:.-]{0,30}([01]?\d|2[0-3]):([0-5]\d)/i);
    if(m)time=`${pad(m[1])}:${m[2]}`;
  }
  return{date,time};
}
function parseBookingStatus(text='',referenceYear=''){
  const flat=clean(text),eta=parseBookingEta(flat,referenceYear);
  const route=flat.match(/\b([A-Z]{3})\s+to\s+([A-Z]{3})\b/i);
  const flight=(flat.match(/\b(CX\s*\d{2,4})\b/i)||[])[1]||'';
  const pieces=(flat.match(/\b(\d{1,5})\s*pc(?:\(s\)|s)?\b/i)||[])[1]||'';
  const weight=((flat.match(/\b([\d,.]+)\s*kg\b/i)||[])[1]||'').replace(/,/g,'');
  let date=eta.date,time=eta.time;
  if(!date||!time){
    const m=flat.match(/estimated[\s\S]{0,120}?(\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*(?:\s+20\d{2})?)(?:[\s\S]{0,40}?([01]?\d|2[0-3]):([0-5]\d))?/i);
    if(m){const x=/20\d{2}/.test(m[1])?dt(m[1]):dm(m[1],referenceYear);if(!date)date=x.date;if(!time&&m[2])time=`${pad(m[2])}:${m[3]}`;}
  }
  return{origin:route?.[1]||'',destination:route?.[2]||'',flightNo:flight.replace(/\s+/g,'').toUpperCase(),pieces,bags:pieces,weight,arrivalDate:date,arrivalTime:time};
}
function parseTerminal(html,mawb){
  const text=clean(html),digits=mawb.replace(/\D/g,''),serial=digits.slice(3);
  if((!text.includes(digits)&&!text.includes(mawb)&&!text.includes(serial))||/Reject Reason|is not found/i.test(text))return null;
  const od=text.match(/AWB Type\s+(?:Import|Export)\s+([A-Z]{3})\s+([A-Z]{3})/i)||text.match(/Origin\s+Destination\s+([A-Z]{3})\s+([A-Z]{3})/i);
  const rcs=text.match(/Received from Shipper[\s\S]{0,500}?(\d{1,2}\s+[A-Z]{3}\s+20\d{2}\s+\d{1,2}:\d{2})\s+(\d{1,6})\s+([\d,.]+)/i);
  const depSection=(text.match(/Departure Flight[\s\S]{0,900}?(?=Received from Flight|Cargo Delivered|Last Update|$)/i)||[])[0]||'';
  const deps=[...depSection.matchAll(/\b(CX\d{2,4})\s+(\d{1,2}\s+[A-Z]{3}\s+20\d{2})\s+(\d{1,2}:\d{2})\s*\(STD\)\s+(\d{1,6})\s+([\d,.]+)/gi)],dep=deps.at(-1);
  const rcfSection=(text.match(/Received from Flight[\s\S]{0,1800}?(?=Cargo Delivered|Last Update|$)/i)||[])[0]||'';
  const rcfs=[...rcfSection.matchAll(/\b(CX\d{2,4})\s+(\d{1,2}\s+[A-Z]{3}\s+20\d{2})(?:\s+\d{1,2}:\d{2})?\s+(\d{1,6})\s+([\d,.]+)\s+(\d{1,2}\s+[A-Z]{3}\s+20\d{2}\s+\d{1,2}:\d{2})/gi)],rcf=rcfs.at(-1);
  const fallback=latestDateTime(rcfSection),strict=rcf?dt(rcf[5]):{date:'',time:''},arrival=strict.date?strict:fallback;
  const hasRcf=Boolean(rcf)||Boolean(rcfSection&&arrival.date&&/Received from Flight|\bRCF\b/i.test(rcfSection));
  const delivered=/Cargo Delivered\s*\(DLV\)|Cargo Delivered/i.test(text),booking=rcs?dt(rcs[1]).date:'';
  const pieces=rcf?.[3]||dep?.[4]||rcs?.[2]||'',weight=(rcf?.[4]||dep?.[5]||rcs?.[3]||'').replace(/,/g,''),flightNo=(rcf?.[1]||dep?.[1]||'').toUpperCase();
  const status=delivered?'DELIVERED':hasRcf?'ARRIVED':dep?'IN TRANSIT':rcs?'BOOKED':'TRACKING';
  return{mawb,carrierCode:'CX',airlineName:'Cathay Cargo',origin:od?.[1]||'',destination:od?.[2]||'',bags:pieces,pieces,weight,bookingDate:booking,flightNo,arrivalDate:arrival.date,arrivalTime:arrival.time,arrivalIsActual:Boolean(hasRcf&&arrival.date),status,officialTracker:CATHAY,source:'Cathay Cargo Terminal official tracking'};
}
function parseOfficial(text,mawb,referenceYear=''){
  const flat=clean(text),year=(String(referenceYear).match(/20\d{2}/)||[])[0]||String(new Date().getUTCFullYear());
  const route=flat.match(/\b([A-Z]{3})\s+to\s+([A-Z]{3})\s*\|\s*(\d+)\s*pc(?:\(s\)|s)?\s*\|\s*([\d,.]+)\s*kg/i);
  const origin=route?.[1]||'',destination=route?.[2]||'',pieces=route?.[3]||'',weight=(route?.[4]||'').replace(/,/g,'');
  let flightNo=(flat.match(/\b(CX\d{2,4})\b/i)||[])[1]||'';
  let arrival={date:'',time:''};
  if(flightNo){
    const esc=flightNo.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    let m=flat.match(new RegExp(`${esc}\\s+(\\d{1,2}\\s+[A-Z]{3}\\s+\\d{1,2}:\\d{2})[\\s\\S]{0,220}?(\\d{1,2}\\s+[A-Z]{3}\\s+\\d{1,2}:\\d{2})`,'i'));
    if(!m)m=flat.match(new RegExp(`(\\d{1,2}\\s+[A-Z]{3}\\s+\\d{1,2}:\\d{2})\\s+${esc}[\\s\\S]{0,220}?(\\d{1,2}\\s+[A-Z]{3}\\s+\\d{1,2}:\\d{2})`,'i'));
    if(m)arrival=dm(m[2],year);
  }
  if(destination){
    const destArr=new RegExp(`\\b${destination}\\s+Arrived\\b[\\s\\S]{0,240}?(\\d{1,2}\\s+[A-Z]{3}(?:\\s+20\\d{2})?\\s+\\d{1,2}:\\d{2})`,'i');
    const m=flat.match(destArr);if(m){const x=/20\d{2}/.test(m[1])?dt(m[1]):dm(m[1],year);if(x.date)arrival=x;}
  }
  const finalArrived=destination?new RegExp(`\\b${destination}\\s+Arrived\\b`,'i').test(flat):/\bArrived\b/i.test(flat);
  const delivered=destination?new RegExp(`\\b${destination}\\s+Delivered\\b(?!\s*0\s*\/)`,'i').test(flat):/\bDelivered\b(?!\s*0\s*\/)/i.test(flat);
  return{mawb,origin,destination,pieces,bags:pieces,weight,flightNo:flightNo.toUpperCase(),arrivalDate:arrival.date,arrivalTime:arrival.time,arrivalIsActual:Boolean(finalArrived&&arrival.date),status:delivered?'DELIVERED':finalArrived?'ARRIVED':'IN TRANSIT'};
}
async function clickText(page,rx,selectors='button,input[type="submit"],input[type="button"],a,[role="button"]'){
  const hs=await page.$$(selectors);
  for(const h of hs){
    const info=await h.evaluate(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return{visible:r.width>10&&r.height>8&&s.display!=='none'&&s.visibility!=='hidden'&&!e.disabled,text:(e.innerText||e.value||e.textContent||e.getAttribute('aria-label')||'').trim()};}).catch(()=>null);
    if(info?.visible&&rx.test(info.text)){await h.click().catch(()=>{});return info.text;}
  }
  return'';
}
async function cathayCargoPage(mawb,referenceYear=''){
  let browser;const digits=mawb.replace(/\D/g,''),serial=digits.slice(3),network=[],requests=[],responses=[],failed=[];
  try{
    chromium.setGraphicsMode=false;
    browser=await puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox','--disable-http2','--disable-quic'],defaultViewport:{width:1440,height:1100},executablePath:await chromium.executablePath(),headless:'shell'});
    const page=await browser.newPage();page.setDefaultTimeout(9000);
    const interesting=(u,type)=>type==='xhr'||type==='fetch'||/api\.cathaypacific\.com|\/api\/|cargo-shipments|track-and-trace/i.test(u);
    page.on('request',q=>{try{const u=q.url(),type=q.resourceType();if(!interesting(u,type))return;requests.push({type,method:q.method(),url:u,postData:String(q.postData()||'').slice(0,3000)});if(requests.length>30)requests.shift();}catch{}});
    page.on('requestfailed',q=>{try{const u=q.url(),type=q.resourceType();if(!interesting(u,type))return;failed.push({type,method:q.method(),url:u,error:q.failure()?.errorText||''});if(failed.length>20)failed.shift();}catch{}});
    page.on('response',async r=>{try{const req=r.request(),u=r.url(),type=req.resourceType(),ct=r.headers()['content-type']||'';if(!interesting(u,type))return;let t='';if(/json|text|javascript|xml/i.test(ct))t=await r.text().catch(()=>'');responses.push({type,status:r.status(),method:req.method(),url:u,postData:String(req.postData()||'').slice(0,3000),contentType:ct,sample:t.slice(0,5000)});if(responses.length>30)responses.shift();if(t&&(t.includes(digits)||t.includes(serial)||/CX\d{2,4}|RCF|arriv|HKG|DEL/i.test(t)))network.push({url:u,text:t.slice(0,50000)});}catch{}});
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36');
    await page.goto(CATHAY,{waitUntil:'domcontentloaded',timeout:15000});await new Promise(r=>setTimeout(r,1500));

    const cookieClicked=await clickText(page,/^(accept all|reject all)$/i);
    if(cookieClicked)await new Promise(r=>setTimeout(r,500));

    const focus=await page.evaluate(()=>{
      const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>10&&r.height>8&&s.display!=='none'&&s.visibility!=='hidden'&&!e.disabled;};
      const controls=[...document.querySelectorAll('input,textarea,[contenteditable="true"],[role="textbox"],[role="combobox"]')].filter(visible);
      const awb=controls.find(e=>/awb|air.?waybill|waybill|shipment|number|12345675/i.test(`${e.id||''} ${e.name||''} ${e.placeholder||''} ${e.getAttribute('aria-label')||''} ${e.getAttribute('role')||''}`));
      if(awb){const r=awb.getBoundingClientRect();return{mode:'control',x:r.left+r.width/2,y:r.top+r.height/2};}
      const labels=[...document.querySelectorAll('label,div,span,p')].filter(visible),label=labels.find(e=>/^Air Waybill number\(s\)$/i.test((e.innerText||e.textContent||'').trim()))||labels.find(e=>/Air Waybill number\(s\)/i.test((e.innerText||e.textContent||'').trim()));
      if(label){const r=label.getBoundingClientRect();return{mode:'label',x:r.left+r.width/2,y:r.top+r.height/2};}
      return{mode:'none'};
    });
    if(focus.mode==='none')return{ok:false,reason:'CATHAY AWB FIELD NOT FOUND',debug:{cookieClicked,focus,requests,responses,failed}};
    await page.mouse.click(focus.x,focus.y).catch(()=>{});
    await new Promise(r=>setTimeout(r,450));

    const editable=await page.evaluate((x,y)=>{
      const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>10&&r.height>8&&s.display!=='none'&&s.visibility!=='hidden'&&!e.disabled;};
      const isEdit=e=>e&&(e.tagName==='INPUT'||e.tagName==='TEXTAREA'||e.isContentEditable||e.getAttribute?.('role')==='textbox'||e.getAttribute?.('role')==='combobox');
      const a=document.activeElement;
      if(isEdit(a)&&visible(a)){const r=a.getBoundingClientRect();return{mode:'active',x:r.left+r.width/2,y:r.top+r.height/2,tag:a.tagName,role:a.getAttribute?.('role')||'',editable:Boolean(a.isContentEditable)};}
      const controls=[...document.querySelectorAll('input,textarea,[contenteditable="true"],[role="textbox"],[role="combobox"]')].filter(visible).filter(e=>!['submit','button','checkbox','radio','hidden'].includes((e.type||'').toLowerCase()));
      if(!controls.length)return{mode:'none'};
      const ranked=controls.map(e=>{const r=e.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2,desc=`${e.id||''} ${e.name||''} ${e.placeholder||''} ${e.getAttribute('aria-label')||''}`;return{e,r,d:Math.hypot(cx-x,cy-y),match:/awb|air.?waybill|waybill|shipment|number|12345675/i.test(desc)};}).sort((a,b)=>(b.match-a.match)||(a.d-b.d));
      const e=ranked[0].e,r=ranked[0].r;return{mode:'candidate',x:r.left+r.width/2,y:r.top+r.height/2,tag:e.tagName,role:e.getAttribute?.('role')||'',editable:Boolean(e.isContentEditable)};
    },focus.x,focus.y).catch(()=>({mode:'none'}));
    if(editable.mode!=='none'){await page.mouse.click(editable.x,editable.y).catch(()=>{});await new Promise(r=>setTimeout(r,150));}

    await page.keyboard.press('Control+A').catch(()=>{});
    await page.keyboard.press('Backspace').catch(()=>{});
    await page.keyboard.type(digits,{delay:45}).catch(()=>{});
    await page.keyboard.press('Tab').catch(()=>{});
    await new Promise(r=>setTimeout(r,650));

    const entered=await page.evaluate((digits,serial)=>{
      const norm=s=>String(s||'').replace(/\D/g,'');
      const nodes=[...document.querySelectorAll('input,textarea,[contenteditable="true"],[role="textbox"],[role="combobox"]')];
      const values=nodes.map(e=>String(('value'in e?e.value:'')||e.innerText||e.textContent||'')).filter(Boolean);
      const normalized=values.map(norm).filter(Boolean);
      const bodyDigits=norm(document.body?.innerText||'');
      const registered=bodyDigits.includes(digits)||normalized.some(v=>v.includes(digits))||(bodyDigits.includes(serial)&&bodyDigits.includes(digits.slice(0,3)));
      return{registered,values:values.slice(0,12),normalized:normalized.slice(0,12),bodyHasFull:bodyDigits.includes(digits)};
    },digits,serial);
    if(!entered.registered)return{ok:false,reason:'CATHAY FORM DID NOT ACCEPT FULL MAWB',debug:{cookieClicked,focus,editable,entered,digits,requests,responses,failed}};

    let clicked=await clickText(page,/^track\s*now$/i);
    if(!clicked)clicked=await clickText(page,/^track$/i);
    if(!clicked)return{ok:false,reason:'TRACK NOW BUTTON NOT FOUND',debug:{cookieClicked,focus,editable,entered,requests,responses,failed}};

    await page.waitForFunction(()=>{const t=document.body?.innerText||'';return /Current status:|Shipment In Progress|Show\s+(?:all\s+)?details|Booking Status|Accepted\s+\d+\/\d+|Departed\s+\d+\/\d+|Arrived\s+\d+\/\d+|Error code:\s*0000/i.test(t);},{timeout:10000}).catch(()=>{});
    await new Promise(r=>setTimeout(r,900));
    let showDetails=await clickText(page,/^show\s+(?:all\s+)?details$/i);
    if(!showDetails)showDetails=await clickText(page,/show\s+(?:all\s+)?details/i);
    if(showDetails)await new Promise(r=>setTimeout(r,700));

    const bookingScrolled=await page.evaluate(()=>{
      const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>10&&r.height>8&&s.display!=='none'&&s.visibility!=='hidden';};
      const els=[...document.querySelectorAll('h1,h2,h3,h4,h5,h6,div,span,p,button')].filter(visible);
      const node=els.find(e=>/^Booking Status$/i.test((e.innerText||e.textContent||'').trim()));
      if(node){node.scrollIntoView({block:'start'});window.scrollBy(0,-120);return true;}
      window.scrollBy(0,550);return false;
    }).catch(()=>false);
    await new Promise(r=>setTimeout(r,700));

    const snapshot=await page.evaluate(()=>{
      const text=document.body?.innerText||'';
      const i=text.search(/Booking Status/i);
      return{text,bookingText:i>=0?text.slice(i,i+5000):''};
    });
    const text=snapshot.text,bookingText=snapshot.bookingText,networkText=network.map(x=>x.text).join('\n'),combined=`${text}\n${networkText}`;
    const official=parseOfficial(combined,mawb,referenceYear),booking=parseBookingStatus(bookingText,referenceYear),a=actualArrival(combined);
    official.origin=booking.origin||official.origin;
    official.destination=booking.destination||official.destination;
    official.flightNo=booking.flightNo||official.flightNo;
    official.pieces=booking.pieces||official.pieces;official.bags=booking.bags||official.bags;
    official.weight=booking.weight||official.weight;
    if(!official.arrivalDate&&booking.arrivalDate){official.arrivalDate=booking.arrivalDate;official.arrivalTime=booking.arrivalTime;}
    else if(official.arrivalDate&&!official.arrivalTime&&booking.arrivalTime)official.arrivalTime=booking.arrivalTime;
    if(!official.arrivalDate&&a?.date){official.arrivalDate=a.date;official.arrivalTime=a.time;official.arrivalIsActual=/\bArrived\b/i.test(combined);if(official.arrivalIsActual)official.status='ARRIVED';}
    const debug={cookieClicked,focus,editable,entered,button:clicked,showDetails:Boolean(showDetails),bookingScrolled,booking,bookingText:bookingText.slice(0,3500),requests:requests.slice(-15),responses:responses.slice(-15),failed:failed.slice(-10),network:network.map(x=>({url:x.url,sample:x.text.slice(0,1800)})).slice(-8),text:text.slice(0,7000)};
    if(/captcha|verify you are human|access denied|security check/i.test(text))return{ok:false,reason:'CATHAY SECURITY CHECK',debug};
    if(!official.origin&&!official.destination&&!official.arrivalDate)return{ok:false,reason:'CATHAY RESULT DETAILS NOT VISIBLE',debug};
    return{ok:true,shipment:official,debug};
  }catch(e){return{ok:false,reason:e?.message||String(e),debug:{requests:requests.slice(-15),responses:responses.slice(-15),failed:failed.slice(-10)}};}finally{if(browser)await browser.close().catch(()=>{});}
}

export async function trackCathay(input){
  const mawb=normalizeMawb(input);if(!mawb||!mawb.startsWith('160-'))return{ok:false,reason:'INVALID CATHAY MAWB',airline:AIRLINE};
  const suffix=mawb.replace(/\D/g,'').slice(3);let terminal=null,last='';
  for(const url of [`${BASE}/AWBPrefix/160/AWBSuffix/${suffix}`,`${BASE}?AWBPrefix=160&AWBSuffix=${suffix}`]){
    try{const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0','accept-language':'en-US,en;q=0.9'},cache:'no-store',signal:AbortSignal.timeout(8000)});last=`HTTP ${r.status}`;if(!r.ok)continue;terminal=parseTerminal(await r.text(),mawb);if(terminal)break;}catch(e){last=e?.message||String(e);}
  }
  if(!terminal)return{ok:false,reason:'CATHAY TERMINAL RETURNED NO VERIFIED SHIPMENT DATA',airline:AIRLINE,debug:{stage:'NO_DATA',last}};
  if(terminal.status==='ARRIVED'||terminal.status==='DELIVERED')return{ok:true,airline:AIRLINE,shipment:terminal,debug:{stage:'SUCCESS',source:'cathay-terminal-actual'}};
  const live=await cathayCargoPage(mawb,terminal.bookingDate);
  if(live.ok){
    const s=live.shipment||{};
    const shipment={...terminal,origin:s.origin||terminal.origin,destination:s.destination||terminal.destination,bags:s.bags||terminal.bags,pieces:s.pieces||terminal.pieces,weight:s.weight||terminal.weight,flightNo:s.flightNo||terminal.flightNo,arrivalDate:s.arrivalDate||terminal.arrivalDate,arrivalTime:s.arrivalTime||terminal.arrivalTime,arrivalIsActual:Boolean(s.arrivalIsActual),status:s.status||terminal.status,source:'Cathay Cargo official Track & Trace'};
    return{ok:true,airline:AIRLINE,shipment,debug:{stage:'SUCCESS',source:'cathay-official-show-details',live:live.debug}};
  }
  return{ok:true,airline:AIRLINE,shipment:terminal,debug:{stage:'SUCCESS',source:'cathay-terminal',browserFallback:live.reason,live:live.debug}};
}