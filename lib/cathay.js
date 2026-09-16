import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { normalizeMawb } from './airlines.js';

const TERMINAL='https://www.cathaycargoterminal.com/en-us/Shipment-Tracking';
const CATHAY='https://www.cathaycargo.com/en-us/track-and-trace.html';
const AIRLINE={name:'Cathay Cargo',iata:'CX',url:CATHAY};
const MONTH={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
const pad=v=>String(v).padStart(2,'0');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function parseDayMonth(value='',fallbackYear=''){
  const s=String(value).toUpperCase();
  let m=s.match(/(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[A-Z]*(?:\s+(20\d{2}))?(?:\s+(\d{1,2}):(\d{2}))?/);
  if(!m)return{date:'',time:''};
  const mon=m[2]==='SEPT'?'SEP':m[2];
  const year=m[3]||fallbackYear||String(new Date().getUTCFullYear());
  return{date:`${year}-${MONTH[mon]}-${pad(m[1])}`,time:m[4]?`${pad(m[4])}:${m[5]}`:''};
}

function parseTimeline(text='',mawb=''){
  const flat=String(text).replace(/\s+/g,' ').trim();
  if(!/\bAccepted\b|\bDeparted\b|\bArrived\b|Current status/i.test(flat))return null;
  const accepted=[...flat.matchAll(/\b([A-Z]{3})\s+Accepted\b/gi)].map(m=>m[1].toUpperCase());
  const departed=[...flat.matchAll(/\b([A-Z]{3})\s+Departed\b/gi)].map(m=>m[1].toUpperCase());
  const arrived=[...flat.matchAll(/\b([A-Z]{3})\s+Arrived\b/gi)].map(m=>m[1].toUpperCase());
  const origin=departed[0]||accepted[0]||'';
  const destination=arrived.at(-1)||'';
  const year=(flat.match(/\b(20\d{2})\b/)||[])[1]||String(new Date().getUTCFullYear());
  const cards=[...flat.matchAll(/\b(CX\s*\d{2,4})\b[\s\S]{0,220}?(\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[A-Z]*)\s+(\d{1,2}:\d{2})[\s\S]{0,160}?(\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[A-Z]*)\s+(\d{1,2}:\d{2})/gi)];
  const card=cards.at(-1);
  const flightNo=(card?.[1]||flat.match(/\bCX\s*\d{2,4}\b/i)?.[0]||'').replace(/\s+/g,'').toUpperCase();
  const dep=card?parseDayMonth(`${card[2]} ${card[3]}`,year):{date:'',time:''};
  const arr=card?parseDayMonth(`${card[4]} ${card[5]}`,year):{date:'',time:''};
  const summary=flat.match(/\b(\d{1,5})\s*pc\(s\)\s*\|\s*([\d,.]+)\s*kg\b/i)||flat.match(/\b(\d{1,5})\s*(?:pcs?|pieces?)\b[\s\S]{0,30}?\b([\d,.]+)\s*kg\b/i);
  const pieces=summary?.[1]||'';
  const weight=(summary?.[2]||'').replace(/,/g,'');
  const allArrived=Boolean(destination&&new RegExp(`\\b${destination}\\s+Arrived\\b`,'i').test(flat));
  const delivered=/Current\s+status\s*:\s*Delivered/i.test(flat)||/\bDelivered\b[\s\S]{0,30}?\b([1-9]\d*)\s*\/\s*\1\b/i.test(flat);
  const status=delivered?'DELIVERED':allArrived||Boolean(arr.date&&arr.time)?'ARRIVED':departed.length?'IN TRANSIT':accepted.length?'BOOKED':'TRACKING';
  return{mawb,carrierCode:'CX',airlineName:'Cathay Cargo',origin,destination,bags:pieces,pieces,weight,flightNo,arrivalDate:arr.date,arrivalTime:arr.time,arrivalIsActual:Boolean(allArrived&&arr.date&&arr.time),status,officialTracker:CATHAY,source:'Cathay Cargo Track & Trace timeline',arrivalTimeSource:'Cathay flight card right-side arrival time',departureDate:dep.date,departureTime:dep.time};
}

function stripHtml(html=''){
  return String(html).replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/\s+/g,' ').trim();
}

function terminalParse(html='',mawb=''){
  const text=stripHtml(html),digits=mawb.replace(/\D/g,''),serial=digits.slice(3);
  if((!text.includes(digits)&&!text.includes(serial))||/Reject Reason|is not found|no record/i.test(text))return null;
  const route=text.match(/AWB Type\s+(?:Import|Export)\s+([A-Z]{3})\s+([A-Z]{3})/i)||text.match(/Origin\s+Destination\s+([A-Z]{3})\s+([A-Z]{3})/i)||text.match(/(?:Routing|Route)\s+([A-Z]{3})\s+(?:to|[-–>])?\s*([A-Z]{3})/i);
  const origin=route?.[1]||'';
  const destination=route?.[2]||'';
  const rcs=text.match(/Received from Shipper[\s\S]{0,1600}?(\d{1,2}\s+[A-Z]{3}\s+20\d{2}\s+\d{1,2}:\d{2})\s+(\d{1,6})\s+([\d,.]+)/i);
  const flight=(text.match(/\bCX\s*\d{2,4}\b/i)?.[0]||'').replace(/\s+/g,'').toUpperCase();
  const actual=[...text.matchAll(/(?:Actual Arrival|Arrived|ATA)[\s\S]{0,420}?(\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[A-Z]*\s+20\d{2}\s+\d{1,2}:\d{2})/gi)].map(m=>parseDayMonth(m[1])).filter(x=>x.date&&x.time).at(-1)||{date:'',time:''};
  const pieces=rcs?.[2]||'';
  const weight=(rcs?.[3]||'').replace(/,/g,'');
  const booking=rcs?parseDayMonth(rcs[1]):{date:'',time:''};
  return{mawb,carrierCode:'CX',airlineName:'Cathay Cargo',origin,destination,bags:pieces,pieces,weight,bookingDate:booking.date,flightNo:flight,arrivalDate:actual.date,arrivalTime:actual.time,arrivalIsActual:Boolean(actual.date&&actual.time),status:actual.date?'ARRIVED':flight?'IN TRANSIT':rcs?'BOOKED':'TRACKING',officialTracker:CATHAY,source:'Cathay Cargo Terminal fallback'};
}

async function get(url){
  try{const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0','accept':'text/html,application/xhtml+xml'},redirect:'follow',cache:'no-store',signal:AbortSignal.timeout(9000)});if(!r.ok)return null;return await r.text();}catch{return null;}
}

async function terminalFallback(mawb){
  const suffix=mawb.replace(/\D/g,'').slice(3);
  for(const url of [`${TERMINAL}/AWBPrefix/160/AWBSuffix/${suffix}`,`${TERMINAL}?AWBPrefix=160&AWBSuffix=${suffix}`]){
    const html=await get(url);if(!html)continue;const shipment=terminalParse(html,mawb);if(shipment)return{shipment,url};
  }
  return null;
}

async function launchBrowser(){
  chromium.setGraphicsMode=false;
  const executablePath=await chromium.executablePath();
  return puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox','--disable-blink-features=AutomationControlled','--lang=en-US,en'],defaultViewport:{width:1440,height:1100,deviceScaleFactor:1},executablePath,headless:'shell'});
}

async function clickOverlays(page){
  await page.evaluate(()=>{
    const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>10&&r.height>10;};
    const els=[...document.querySelectorAll('button,[role="button"],a')].filter(visible);
    const cookie=els.find(e=>/accept all|accept cookies|allow all|agree/i.test((e.innerText||e.getAttribute('aria-label')||'').trim()));if(cookie)cookie.click();
    const close=els.find(e=>/^(close|dismiss)$/i.test((e.innerText||e.getAttribute('aria-label')||e.getAttribute('title')||'').trim()));if(close)close.click();
  }).catch(()=>{});
}

async function findInputHandles(page){
  const handles=await page.$$('input,textarea,[contenteditable="true"],[role="textbox"]');
  const rows=[];
  for(const h of handles){
    const meta=await h.evaluate(e=>{
      const s=getComputedStyle(e),r=e.getBoundingClientRect();
      const labels=[...(e.labels||[])].map(x=>x.innerText||x.textContent||'').join(' ');
      const p=e.parentElement,pp=p?.parentElement;
      const nearby=`${p?.innerText||''} ${p?.previousElementSibling?.innerText||''} ${pp?.innerText||''}`;
      const contentEditable=e.getAttribute('contenteditable')==='true'||e.getAttribute('role')==='textbox';
      return{visible:s.display!=='none'&&s.visibility!=='hidden'&&r.width>30&&r.height>12&&!e.disabled,type:contentEditable?'contenteditable':(e.type||'text').toLowerCase(),desc:`${e.name||''} ${e.id||''} ${e.placeholder||''} ${e.getAttribute('aria-label')||''} ${e.getAttribute('title')||''} ${labels} ${nearby}`.replace(/\s+/g,' ').toLowerCase(),x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),value:String(('value' in e?e.value:e.textContent)||'')};
    }).catch(()=>null);
    if(meta?.visible&&!['hidden','checkbox','radio','submit','button'].includes(meta.type))rows.push({h,meta});
  }
  const scoreAir=x=>(/airline\s*code|carrier\s*code|awb\s*prefix|prefix/.test(x.meta.desc)?30:0)+(/airline|carrier/.test(x.meta.desc)?8:0)-(/search|email|chat|cookie/.test(x.meta.desc)?30:0);
  const scoreAwb=x=>(/air\s*waybill|airway\s*bill|airwaybill|\bawb\b|waybill/.test(x.meta.desc)?30:0)+(/shipment|tracking/.test(x.meta.desc)?5:0)+(/contenteditable/.test(x.meta.type)?4:0)-(/search|email|chat|cookie/.test(x.meta.desc)?30:0);
  const airline=[...rows].sort((a,b)=>scoreAir(b)-scoreAir(a))[0];
  const awb=[...rows].filter(x=>x!==airline).sort((a,b)=>scoreAwb(b)-scoreAwb(a))[0];
  return{airline:scoreAir(airline||{meta:{desc:''}})>0?airline?.h:null,awb:scoreAwb(awb||{meta:{desc:''}})>0?awb?.h:null,rows};
}

async function clearValue(page,handle){
  if(!handle)return;
  try{
    await handle.click({clickCount:3});await page.keyboard.down('Control');await page.keyboard.press('A');await page.keyboard.up('Control');await page.keyboard.press('Backspace');
    await handle.evaluate(e=>{const ce=e.getAttribute('contenteditable')==='true'||e.getAttribute('role')==='textbox';if(ce){e.textContent='';e.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'deleteContentBackward'}));return;}const proto=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;const d=Object.getOwnPropertyDescriptor(proto,'value');d?.set?.call(e,'');e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));});
  }catch{}
}

async function typeValue(page,handle,value){
  if(!handle)return false;
  const wanted=String(value);
  try{
    await clearValue(page,handle);await handle.click();await handle.type(wanted,{delay:55});
    let actual=await handle.evaluate(e=>String(('value' in e?e.value:e.textContent)||''));
    if(actual.replace(/[\s-]/g,'').includes(wanted.replace(/[\s-]/g,'')))return true;
    await handle.evaluate((e,v)=>{const ce=e.getAttribute('contenteditable')==='true'||e.getAttribute('role')==='textbox';if(ce){e.textContent=v;e.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:v}));e.dispatchEvent(new Event('change',{bubbles:true}));return;}const proto=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;const d=Object.getOwnPropertyDescriptor(proto,'value');d?.set?.call(e,v);e.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:v}));e.dispatchEvent(new Event('change',{bubbles:true}));},wanted);
    actual=await handle.evaluate(e=>String(('value' in e?e.value:e.textContent)||''));
    return actual.replace(/[\s-]/g,'').includes(wanted.replace(/[\s-]/g,''));
  }catch{return false;}
}

async function resultVisible(page){
  const text=await page.evaluate(()=>document.body?.innerText||'').catch(()=> '');
  return /Shipment\s+In\s+Progress|Current\s+status|\b[A-Z]{3}\s+(?:Accepted|Departed|Arrived)\b|\bCX\s*\d{2,4}\b[\s\S]{0,500}\bArrived\b/i.test(text);
}

async function clickTrackNow(page){
  return page.evaluate(()=>{
    const visible=n=>{const s=getComputedStyle(n),r=n.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>16&&r.height>10&&!n.disabled;};
    const els=[...document.querySelectorAll('button,input[type="submit"],input[type="button"],[role="button"]')].filter(visible);
    const btn=els.find(n=>/^track\s*now$/i.test((n.innerText||n.value||n.textContent||n.getAttribute('aria-label')||'').trim()))||els.find(n=>n.matches('button[type="submit"],input[type="submit"]')&&/air\s*waybill|track/i.test(n.closest('form')?.innerText||n.parentElement?.parentElement?.innerText||''));
    if(!btn)return'';const t=(btn.innerText||btn.value||btn.textContent||btn.getAttribute('aria-label')||'').trim();btn.click();return t||'Track now';
  }).catch(()=> '');
}

async function keyboardAwbEntry(page,airline,serial){
  if(!airline)return{airlineOk:false,awbOk:false,active:''};
  const airlineOk=await typeValue(page,airline,'160');
  await airline.click().catch(()=>{});await page.keyboard.press('Tab');await sleep(250);
  await page.keyboard.down('Control').catch(()=>{});await page.keyboard.press('A').catch(()=>{});await page.keyboard.up('Control').catch(()=>{});await page.keyboard.press('Backspace').catch(()=>{});
  await page.keyboard.type(serial,{delay:65}).catch(()=>{});await sleep(350);
  const active=await page.evaluate(()=>{let a=document.activeElement;while(a?.shadowRoot?.activeElement)a=a.shadowRoot.activeElement;return `${a?.tagName||''}|${a?.getAttribute?.('role')||''}|${a?.getAttribute?.('aria-label')||''}|${a?.getAttribute?.('placeholder')||''}|${('value' in (a||{})?a.value:a?.textContent)||''}`.slice(0,300);}).catch(()=> '');
  const body=await page.evaluate(()=>document.body?.innerText||'').catch(()=> '');
  const compact=body.replace(/\s/g,'');
  return{airlineOk,awbOk:compact.includes(serial),active};
}

async function mainTimeline(mawb){
  const digits=mawb.replace(/\D/g,''),serial=digits.slice(3);let browser;
  try{
    browser=await launchBrowser();const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({'Accept-Language':'en-US,en;q=0.9'});
    await page.goto(CATHAY,{waitUntil:'domcontentloaded',timeout:22000});await sleep(2200);await clickOverlays(page);await sleep(900);
    const {airline,awb,rows}=await findInputHandles(page);
    let awbOk=false,airlineOk=false,mode='',active='';
    if(awb){airlineOk=airline?await typeValue(page,airline,'160'):true;awbOk=await typeValue(page,awb,serial);mode='direct-awb-handle';}
    else{const k=await keyboardAwbEntry(page,airline,serial);airlineOk=k.airlineOk;awbOk=k.awbOk;active=k.active;mode='keyboard-tab-awb';}
    const clicked=await clickTrackNow(page);
    await Promise.race([page.waitForNetworkIdle({idleTime:800,timeout:9000}).catch(()=>{}),sleep(9000)]);await sleep(1300);
    const text=await page.evaluate(()=>document.body?.innerText||'').catch(()=> '');
    const shipment=parseTimeline(text,mawb);
    const inputDebug=rows.map(x=>({type:x.meta.type,desc:x.meta.desc.slice(0,200),x:x.meta.x,y:x.meta.y,w:x.meta.w,value:x.meta.value})).slice(0,16);
    return shipment?{ok:true,shipment,debug:{stage:'TIMELINE',mode,airlineOk,awbOk,active,clicked,inputs:inputDebug,pageText:text.slice(0,7000)}}:{ok:false,reason:'CATHAY MAIN TIMELINE NOT PARSED',debug:{stage:'NO_TIMELINE',mode,airlineOk,awbOk,active,clicked,inputs:inputDebug,pageText:text.slice(0,7000)}};
  }catch(e){return{ok:false,reason:e?.message||'Cathay main page failed',debug:{stage:'ERROR',message:e?.message||''}};}finally{try{if(browser)await browser.close();}catch{}}
}

function merge(main={},fallback={}){
  const out={...fallback};
  for(const [k,v] of Object.entries(main||{})){if(v!==''&&v!==null&&v!==undefined)out[k]=v;}
  if(main?.origin)out.origin=main.origin;
  if(main?.destination)out.destination=main.destination;
  if(main?.arrivalDate)out.arrivalDate=main.arrivalDate;
  if(main?.arrivalTime)out.arrivalTime=main.arrivalTime;
  if(main?.flightNo)out.flightNo=main.flightNo;
  if(main?.status)out.status=main.status;
  return out;
}

export async function trackCathay(input){
  const mawb=normalizeMawb(input);if(!mawb||!mawb.startsWith('160-'))return{ok:false,reason:'INVALID CATHAY MAWB',airline:AIRLINE};
  const [mainResult,terminalResult]=await Promise.all([Promise.race([mainTimeline(mawb),new Promise(r=>setTimeout(()=>r({ok:false,reason:'CATHAY MAIN PAGE TIMEOUT',debug:{stage:'TIMEOUT'}}),38000))]),terminalFallback(mawb)]);
  const fallback=terminalResult?.shipment||{};
  if(mainResult?.ok){const shipment=merge(mainResult.shipment,fallback);shipment.source='Cathay Cargo Track & Trace timeline';return{ok:true,airline:AIRLINE,shipment,debug:{source:'cathay-main-timeline',main:mainResult.debug,terminalUrl:terminalResult?.url||''}};}
  if(terminalResult?.shipment)return{ok:true,airline:AIRLINE,shipment:terminalResult.shipment,debug:{source:'cathay-terminal-fallback',mainError:mainResult?.reason||'',main:mainResult?.debug||null,terminalUrl:terminalResult.url}};
  return{ok:false,airline:AIRLINE,reason:mainResult?.reason||'CATHAY DATA NOT EXTRACTED',debug:{main:mainResult?.debug||null}};
}