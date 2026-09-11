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
  const bookingDate=(text.match(/\b(\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s+20\d{2})\b/i)||[])[1];
  let arrivalDate='',arrivalTime='';
  if(flightNo){
    const esc=flightNo.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    let m=text.match(new RegExp(`(\\d{1,2}\\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\\s+\\d{1,2}:\\d{2})[\\s\\S]{0,120}?${esc}[\\s\\S]{0,220}?(\\d{1,2}\\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\\s+\\d{1,2}:\\d{2})`,'i'));
    if(!m)m=text.match(new RegExp(`${esc}[\\s\\S]{0,260}?(\\d{1,2}\\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\\s+\\d{1,2}:\\d{2})[\\s\\S]{0,260}?(\\d{1,2}\\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\\s+\\d{1,2}:\\d{2})`,'i'));
    if(m){const x=dm(m[2],year);arrivalDate=x.date;arrivalTime=x.time;}
  }
  if(destination){
    const esc=destination.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const m=text.match(new RegExp(`\\b${esc}\\b[\\s\\S]{0,180}?(\\d{1,2}\\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*(?:\\s+20\\d{2})?\\s+\\d{1,2}:\\d{2})[\\s\\S]{0,60}?\\bActual\\b`,'i'));
    if(m){const x=/20\d{2}/.test(m[1])?dt(m[1]):dm(m[1],year);arrivalDate=x.date;arrivalTime=x.time;}
  }
  const finalArrived=destination?new RegExp(`\\b${destination}\\s+Arrived\\b`,'i').test(text)||new RegExp(`\\b${destination}\\b[\\s\\S]{0,120}?\\bActual\\b`,'i').test(text):/\bArrived\b/i.test(text);
  const delivered=destination?new RegExp(`\\b${destination}\\s+Delivered\\b(?!\\s*0\\s*\\/)`,'i').test(text):false;
  return{mawb,carrierCode:'CX',airlineName:'Cathay Cargo',origin,destination,bags:pieces,pieces,weight,bookingDate:bookingDate?dt(bookingDate).date:'',flightNo,arrivalDate,arrivalTime,arrivalIsActual:Boolean(finalArrived&&arrivalDate),status:delivered?'DELIVERED':finalArrived?'ARRIVED':'IN TRANSIT',officialTracker:CATHAY,source:'Cathay Cargo official Track & Trace'};
}

async function getTerminal(mawb){
  const suffix=mawb.replace(/\D/g,'').slice(3);let last='';
  for(const url of [`${BASE}/AWBPrefix/160/AWBSuffix/${suffix}`,`${BASE}?AWBPrefix=160&AWBSuffix=${suffix}`]){
    try{
      const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0','accept-language':'en-US,en;q=0.9'},cache:'no-store',signal:AbortSignal.timeout(5000)});
      last=`HTTP ${r.status}`;if(!r.ok)continue;
      const parsed=parseTerminal(await r.text(),mawb);if(parsed)return{ok:true,shipment:parsed,last};
    }catch(e){last=e?.message||String(e);}
  }
  return{ok:false,last};
}

async function allFrameText(page){
  const parts=[];
  for(const f of page.frames()){
    try{
      const t=await f.evaluate(()=>{
        const out=[document.body?.innerText||''];
        const walk=root=>{for(const e of root.querySelectorAll('*')){if(e.shadowRoot){out.push(e.shadowRoot.textContent||'');walk(e.shadowRoot);}}};
        walk(document);return out.join('\n');
      });
      if(t)parts.push(t);
    }catch{}
  }
  return parts.join('\n');
}
async function clickExactInFrames(page,rx){
  for(const f of page.frames()){
    try{const hit=await f.evaluate(src=>{const re=new RegExp(src,'i'),els=[...document.querySelectorAll('button,input[type="submit"],input[type="button"],a,[role="button"]')],visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>8&&r.height>8&&s.display!=='none'&&s.visibility!=='hidden'&&!e.disabled;},e=els.find(x=>visible(x)&&re.test((x.innerText||x.value||x.textContent||x.getAttribute('aria-label')||'').trim()));if(!e)return'';const label=(e.innerText||e.value||e.textContent||e.getAttribute('aria-label')||'').trim();e.click();return label;},rx.source);if(hit)return hit;}catch{}
  }return'';
}

async function officialCathay(mawb,referenceYear=''){
  let browser,killTimer;const serial=mawb.replace(/\D/g,'').slice(3);
  const debug={fillMode:'suffix-only-fixed-160',trackClicked:false,registered:false,bookingScrolled:false,focusAttempts:[]};
  try{
    chromium.setGraphicsMode=false;
    browser=await puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox','--disable-http2','--disable-quic'],defaultViewport:{width:1440,height:1100},executablePath:await chromium.executablePath(),headless:'shell'});
    const proc=browser.process?.();killTimer=setTimeout(()=>{try{proc?.kill('SIGKILL');}catch{}},35000);
    const page=await browser.newPage();page.setDefaultTimeout(6000);
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36');
    await page.goto(CATHAY,{waitUntil:'domcontentloaded',timeout:14000});await sleep(1700);
    await clickExactInFrames(page,/^(Reject all|Accept all)$/i);await sleep(300);

    const focusResult=await page.evaluate(()=>{
      const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>5&&r.height>5&&s.display!=='none'&&s.visibility!=='hidden'&&!e.disabled;};
      const desc=e=>`${e.id||''} ${e.name||''} ${e.placeholder||''} ${e.getAttribute?.('aria-label')||''} ${e.getAttribute?.('role')||''}`.toLowerCase();
      const controls=[];
      const walk=root=>{for(const e of root.querySelectorAll('*')){const tag=(e.tagName||'').toLowerCase(),role=(e.getAttribute?.('role')||'').toLowerCase();if(['input','textarea'].includes(tag)||e.isContentEditable||role==='textbox'||role==='combobox')controls.push(e);if(e.shadowRoot)walk(e.shadowRoot);}};
      walk(document);
      const code=controls.find(e=>visible(e)&&/airlinecodefield/.test(desc(e)))||controls.find(e=>visible(e)&&String(e.value||'').replace(/\D/g,'')==='160');
      const okay=e=>{const tag=(e.tagName||'').toLowerCase(),type=(e.type||'').toLowerCase(),d=desc(e),v=String('value'in e?e.value:'').replace(/\D/g,'');return visible(e)&&!['submit','button','checkbox','radio','hidden'].includes(type)&&!/airlinecodefield|search/.test(d)&&v!=='160'&&(tag==='input'||tag==='textarea'||e.isContentEditable||/textbox|combobox/.test(e.getAttribute?.('role')||''));};
      let awb=controls.find(e=>okay(e)&&/awb|air.?waybill|waybill|shipment|number/.test(desc(e)));
      if(!awb&&code){const c=code.getBoundingClientRect();awb=controls.filter(okay).map(e=>({e,r:e.getBoundingClientRect()})).filter(x=>Math.abs((x.r.top+x.r.height/2)-(c.top+c.height/2))<80&&x.r.left>c.left).sort((a,b)=>a.r.left-b.r.left)[0]?.e;}
      if(awb){try{awb.click();}catch{}try{awb.focus();}catch{}const r=awb.getBoundingClientRect();return{mode:'deep-control',tag:awb.tagName,role:awb.getAttribute?.('role')||'',desc:desc(awb),x:r.left+r.width/2,y:r.top+r.height/2};}
      if(code){try{code.focus();}catch{}const r=code.getBoundingClientRect();return{mode:'tab-from-code',tag:code.tagName,desc:desc(code),x:r.left+r.width/2,y:r.top+r.height/2};}
      return{mode:'none',count:controls.length};
    }).catch(()=>({mode:'none'}));
    debug.focusAttempts.push(focusResult);

    let typed=false;
    if(focusResult.mode==='deep-control'){
      await page.keyboard.press('Control+A').catch(()=>{});await page.keyboard.press('Backspace').catch(()=>{});await page.keyboard.type(serial,{delay:55}).catch(()=>{});typed=true;
    }else if(focusResult.mode==='tab-from-code'){
      for(let i=0;i<5;i++){
        await page.keyboard.press('Tab').catch(()=>{});await sleep(180);
        const a=await page.evaluate(()=>{
          let e=document.activeElement;while(e?.shadowRoot?.activeElement)e=e.shadowRoot.activeElement;
          const tag=(e?.tagName||'').toLowerCase(),type=(e?.type||'').toLowerCase(),role=(e?.getAttribute?.('role')||'').toLowerCase(),d=`${e?.id||''} ${e?.name||''} ${e?.placeholder||''} ${e?.getAttribute?.('aria-label')||''} ${role}`.toLowerCase();
          const safe=Boolean(e)&&!['submit','button','checkbox','radio','hidden'].includes(type)&&!/airlinecodefield|search/.test(d)&&(tag==='input'||tag==='textarea'||e?.isContentEditable||role==='textbox'||role==='combobox');
          return{tag,type,role,desc:d,safe,value:'value'in(e||{})?String(e.value||''):''};
        }).catch(()=>({safe:false}));
        debug.focusAttempts.push({mode:`tab-${i+1}`,...a});
        if(a.safe){await page.keyboard.press('Control+A').catch(()=>{});await page.keyboard.press('Backspace').catch(()=>{});await page.keyboard.type(serial,{delay:55}).catch(()=>{});typed=true;break;}
      }
    }

    if(!typed){
      const points=await page.evaluate(()=>{
        const vis=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>10&&r.height>8&&s.display!=='none'&&s.visibility!=='hidden';};
        const els=[...document.querySelectorAll('label,div,span,p')].filter(vis),label=els.find(e=>/^Air Waybill number\(s\)$/i.test((e.innerText||e.textContent||'').trim()))||els.find(e=>/Air Waybill number\(s\)/i.test((e.innerText||e.textContent||'').trim()));
        if(!label)return[];const r=label.getBoundingClientRect();let p=label.parentElement,box=r;for(let i=0;i<4&&p;i++,p=p.parentElement){const q=p.getBoundingClientRect();if(q.width>250&&q.height>35&&q.height<180){box=q;break;}}
        return[{x:r.left+r.width/2,y:r.top+r.height/2},{x:box.left+box.width*.35,y:box.top+box.height*.65},{x:box.left+box.width*.62,y:box.top+box.height*.65},{x:box.right-40,y:box.top+box.height*.65}];
      }).catch(()=>[]);
      for(const p of points){
        await page.mouse.click(p.x,p.y).catch(()=>{});await sleep(180);
        const a=await page.evaluate(()=>{let e=document.activeElement;while(e?.shadowRoot?.activeElement)e=e.shadowRoot.activeElement;const tag=(e?.tagName||'').toLowerCase(),type=(e?.type||'').toLowerCase(),role=(e?.getAttribute?.('role')||'').toLowerCase(),d=`${e?.id||''} ${e?.name||''} ${e?.placeholder||''} ${e?.getAttribute?.('aria-label')||''} ${role}`.toLowerCase();const safe=Boolean(e)&&!['submit','button','checkbox','radio','hidden'].includes(type)&&!/airlinecodefield|search/.test(d)&&(tag==='input'||tag==='textarea'||e?.isContentEditable||role==='textbox'||role==='combobox');return{tag,type,role,desc:d,safe};}).catch(()=>({safe:false}));
        debug.focusAttempts.push({mode:'mouse-fallback',point:p,...a});
        if(a.safe){await page.keyboard.press('Control+A').catch(()=>{});await page.keyboard.press('Backspace').catch(()=>{});await page.keyboard.type(serial,{delay:55}).catch(()=>{});typed=true;break;}
      }
    }
    if(!typed)return{ok:false,reason:'CATHAY AWB NUMBER CONTROL NOT FOCUSED',debug};

    await page.keyboard.press('Enter').catch(()=>{});await sleep(500);
    const reg=await page.evaluate(s=>{
      const norm=v=>String(v||'').replace(/\D/g,'');const vals=[];
      const walk=root=>{for(const e of root.querySelectorAll('*')){const tag=(e.tagName||'').toLowerCase(),role=(e.getAttribute?.('role')||'').toLowerCase();if(tag==='input'||tag==='textarea'||e.isContentEditable||role==='textbox'||role==='combobox')vals.push(String('value'in e?e.value:e.textContent||''));if(e.shadowRoot)walk(e.shadowRoot);}};walk(document);
      const body=norm(document.body?.innerText||'');return{serialInBody:body.includes(s),serialInValue:vals.map(norm).some(v=>v.includes(s)),values:vals.slice(0,20)};
    },serial).catch(()=>({serialInBody:false,serialInValue:false,values:[]}));
    debug.registration=reg;debug.registered=Boolean(reg.serialInBody||reg.serialInValue);
    if(!debug.registered)return{ok:false,reason:'CATHAY AWB SUFFIX DID NOT REGISTER',debug};

    const track=await clickExactInFrames(page,/^Track\s*now$/i)||await clickExactInFrames(page,/^Track$/i);debug.trackClicked=Boolean(track);if(!track)return{ok:false,reason:'CATHAY TRACK NOW NOT CLICKED',debug};
    for(let i=0;i<16;i++){await sleep(650);const t=await allFrameText(page);if(/Booking Status|Current status:|Shipment In Progress|Accepted\s+\d+\/\d+|Departed\s+\d+\/\d+|Arrived\s+\d+\/\d+/i.test(t))break;}

    debug.bookingScrolled=await page.evaluate(()=>{
      const vis=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>8&&r.height>8&&s.display!=='none'&&s.visibility!=='hidden';};
      const els=[...document.querySelectorAll('h1,h2,h3,h4,h5,h6,div,span,p')].filter(vis);
      const e=els.find(x=>/^Booking Status$/i.test((x.innerText||x.textContent||'').trim()));
      if(e){e.scrollIntoView({block:'start'});window.scrollBy(0,-100);return true;}
      window.scrollBy(0,500);return false;
    }).catch(()=>false);
    await sleep(800);

    const text=await allFrameText(page),flat=clean(text),idx=flat.search(/Booking Status/i),bookingText=idx>=0?flat.slice(idx,idx+4200):flat;
    debug.bookingText=bookingText.slice(0,4200);debug.text=flat.slice(0,8500);
    const shipment=parseOfficial(bookingText,mawb,referenceYear);
    if(!shipment.origin||!shipment.destination||!shipment.flightNo)return{ok:false,reason:'CATHAY BOOKING STATUS DETAILS NOT VISIBLE',debug,shipment};
    return{ok:true,shipment,debug};
  }catch(e){return{ok:false,reason:e?.message||String(e),debug};}
  finally{if(killTimer)clearTimeout(killTimer);if(browser){try{await Promise.race([browser.close(),sleep(1000)]);}catch{}try{browser.process?.()?.kill('SIGKILL');}catch{}}}
}

export async function trackCathay(input){
  const mawb=normalizeMawb(input);if(!mawb||!mawb.startsWith('160-'))return{ok:false,reason:'INVALID CATHAY MAWB',airline:AIRLINE};
  const terminal=await getTerminal(mawb);
  if(terminal.ok&&(terminal.shipment.status==='ARRIVED'||terminal.shipment.status==='DELIVERED'))return{ok:true,airline:AIRLINE,shipment:terminal.shipment,debug:{stage:'SUCCESS',source:'cathay-terminal-actual'}};
  const live=await officialCathay(mawb,terminal.ok?terminal.shipment.bookingDate:'');
  if(live.ok){const t=terminal.ok?terminal.shipment:{},s=live.shipment||{};const shipment={...t,...s,origin:s.origin||t.origin||'',destination:s.destination||t.destination||'',bags:s.bags||t.bags||'',pieces:s.pieces||t.pieces||'',weight:s.weight||t.weight||'',bookingDate:s.bookingDate||t.bookingDate||'',flightNo:s.flightNo||t.flightNo||'',arrivalDate:s.arrivalDate||t.arrivalDate||'',arrivalTime:s.arrivalTime||t.arrivalTime||'',arrivalIsActual:Boolean(s.arrivalIsActual),status:s.status||t.status||'IN TRANSIT',source:'Cathay Cargo official Track & Trace'};if(shipment.arrivalIsActual)shipment.status='ARRIVED';return{ok:true,airline:AIRLINE,shipment,debug:{stage:'SUCCESS',source:'cathay-official-booking-status',live:live.debug,terminal:terminal.last}};}
  if(terminal.ok)return{ok:true,airline:AIRLINE,shipment:terminal.shipment,debug:{stage:'SUCCESS',source:'cathay-terminal',browserFallback:live.reason,live:live.debug}};
  return{ok:false,reason:'CATHAY TRACKING FAILED',airline:AIRLINE,debug:{live,terminal}};
}