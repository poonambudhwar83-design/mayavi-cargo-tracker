import { normalizeMawb } from './airlines.js';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const BASE='https://www.cathaycargoterminal.com/en-us/Shipment-Tracking';
const CATHAY='https://www.cathaycargo.com/en-us/track-and-trace.html';
const AIRLINE={name:'Cathay Cargo',iata:'CX',url:CATHAY};
const months={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
const clean=s=>String(s||'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/\s+/g,' ').trim();
const pad=v=>String(v).padStart(2,'0');
function dt(v=''){
 const s=String(v).toUpperCase();
 let m=s.match(/(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s,]+(20\d{2})(?:\s+(\d{1,2}):(\d{2}))?/);
 if(m)return{date:`${m[3]}-${months[m[2]]}-${pad(m[1])}`,time:m[4]?`${pad(m[4])}:${m[5]}`:''};
 m=s.match(/(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})(?:[^0-9]+(\d{1,2}):(\d{2}))?/);
 return m?{date:`${m[1]}-${pad(m[2])}-${pad(m[3])}`,time:m[4]?`${pad(m[4])}:${m[5]}`:''}:{date:'',time:''};
}
function parseTerminal(html,mawb){
 const text=clean(html),digits=mawb.replace(/\D/g,''),serial=digits.slice(3);
 if(!text.includes(digits)&&!text.includes(mawb)&&!text.includes(serial))return null;
 if(/Reject Reason|is not found/i.test(text))return null;
 const od=text.match(/AWB Type\s+(?:Import|Export)\s+([A-Z]{3})\s+([A-Z]{3})/i)||text.match(/Origin\s+Destination\s+([A-Z]{3})\s+([A-Z]{3})/i);
 const rcs=text.match(/Received from Shipper[\s\S]{0,500}?(\d{1,2}\s+[A-Z]{3}\s+20\d{2}\s+\d{1,2}:\d{2})\s+(\d{1,6})\s+([\d,.]+)/i);
 const depSection=(text.match(/Departure Flight[\s\S]{0,900}?(?=Received from Flight|Cargo Delivered|Last Update|$)/i)||[])[0]||'';
 const deps=[...depSection.matchAll(/\b(CX\d{2,4})\s+(\d{1,2}\s+[A-Z]{3}\s+20\d{2})\s+(\d{1,2}:\d{2})\s*\(STD\)\s+(\d{1,6})\s+([\d,.]+)/gi)],dep=deps.at(-1);
 const rcfSection=(text.match(/Received from Flight[\s\S]{0,1200}?(?=Cargo Delivered|Last Update|$)/i)||[])[0]||'';
 const rcfs=[...rcfSection.matchAll(/\b(CX\d{2,4})\s+(\d{1,2}\s+[A-Z]{3}\s+20\d{2})(?:\s+\d{1,2}:\d{2})?\s+(\d{1,6})\s+([\d,.]+)\s+(\d{1,2}\s+[A-Z]{3}\s+20\d{2}\s+\d{1,2}:\d{2})/gi)],rcf=rcfs.at(-1);
 const delivered=/Cargo Delivered\s*\(DLV\)|Cargo Delivered/i.test(text),arrival=rcf?dt(rcf[5]):{date:'',time:''},booking=rcs?dt(rcs[1]).date:'';
 const pieces=rcf?.[3]||dep?.[4]||rcs?.[2]||'',weight=(rcf?.[4]||dep?.[5]||rcs?.[3]||'').replace(/,/g,''),flightNo=(rcf?.[1]||dep?.[1]||'').toUpperCase();
 const status=delivered?'DELIVERED':rcf?'ARRIVED':dep?'IN TRANSIT':rcs?'BOOKED':'TRACKING';
 return{mawb,carrierCode:'CX',airlineName:'Cathay Cargo',origin:od?.[1]||'',destination:od?.[2]||'',bags:pieces,pieces,weight,bookingDate:booking,flightNo,arrivalDate:arrival.date,arrivalTime:arrival.time,arrivalIsActual:Boolean(rcf&&arrival.date),status,officialTracker:CATHAY,source:'Cathay Cargo Terminal official tracking'};
}
function actualArrival(text=''){
 const flat=String(text).replace(/\s+/g,' ').trim();
 const rx=/(?:actual\s+arrival|arrived|received\s+from\s+flight|\bRCF\b|landed)/ig;
 let best=null;
 for(const hit of flat.matchAll(rx)){
  const start=Math.max(0,(hit.index||0)-100),w=flat.slice(start,Math.min(flat.length,(hit.index||0)+360)),x=dt(w);
  const tm=w.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);if(!x.time&&tm)x.time=`${pad(tm[1])}:${tm[2]}`;
  if(x.date||x.time)best={...x,snippet:w};
 }
 return best;
}
async function cathayCargoPage(mawb){
 let browser;const serial=mawb.replace(/\D/g,'').slice(3);
 try{
  chromium.setGraphicsMode=false;
  browser=await puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox'],defaultViewport:{width:1440,height:1100},executablePath:await chromium.executablePath(),headless:'shell'});
  const page=await browser.newPage();await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36');
  await page.goto(CATHAY,{waitUntil:'domcontentloaded',timeout:22000});await new Promise(r=>setTimeout(r,2500));
  const result=await page.evaluate(({serial})=>{
   const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>10&&r.height>8&&s.display!=='none'&&s.visibility!=='hidden'&&!e.disabled};
   const inputs=[...document.querySelectorAll('input')].filter(visible).filter(e=>!['hidden','checkbox','radio','submit','button'].includes((e.type||'text').toLowerCase()));
   const desc=e=>`${e.name||''} ${e.id||''} ${e.placeholder||''} ${e.getAttribute('aria-label')||''}`.toLowerCase();
   const set=(e,v)=>{const d=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');d?.set?.call(e,v);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));};
   const p=inputs.find(e=>/airline|prefix|code/.test(desc(e))),n=inputs.find(e=>/awb|air.?waybill|waybill|shipment|number/.test(desc(e))&&e!==p)||inputs.find(e=>e!==p);
   if(p)set(p,'160');if(n)set(n,serial);
   const buttons=[...document.querySelectorAll('button,input[type="submit"],a')].filter(visible);const b=buttons.find(e=>/track|search|submit/i.test((e.innerText||e.value||e.getAttribute('aria-label')||'').trim()));if(b)b.click();
   return{prefix:Boolean(p),number:Boolean(n),button:Boolean(b),inputs:inputs.map(desc).slice(0,12)};
  },{serial});
  await new Promise(r=>setTimeout(r,5000));const text=await page.evaluate(()=>document.body?.innerText||'');
  if(/captcha|verify you are human|access denied|security check/i.test(text))return{ok:false,reason:'CATHAY SECURITY CHECK',debug:result};
  const a=actualArrival(text);if(!a)return{ok:false,reason:'NO ACTUAL ARRIVAL MILESTONE',debug:{...result,text:text.slice(0,2500)}};
  return{ok:true,arrivalDate:a.date,arrivalTime:a.time,snippet:a.snippet,debug:result};
 }catch(e){return{ok:false,reason:e?.message||String(e)};}finally{if(browser)await browser.close().catch(()=>{});}
}
export async function trackCathay(input){
 const mawb=normalizeMawb(input);if(!mawb||!mawb.startsWith('160-'))return{ok:false,reason:'INVALID CATHAY MAWB',airline:AIRLINE};
 const suffix=mawb.replace(/\D/g,'').slice(3);let terminal=null,last='';
 for(const url of [`${BASE}/AWBPrefix/160/AWBSuffix/${suffix}`,`${BASE}?AWBPrefix=160&AWBSuffix=${suffix}`]){try{const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0','accept-language':'en-US,en;q=0.9'},cache:'no-store',signal:AbortSignal.timeout(12000)});last=`HTTP ${r.status}`;if(!r.ok)continue;terminal=parseTerminal(await r.text(),mawb);if(terminal)break;}catch(e){last=e?.message||String(e);}}
 if(!terminal)return{ok:false,reason:'CATHAY TERMINAL RETURNED NO VERIFIED SHIPMENT DATA',airline:AIRLINE,debug:{stage:'NO_DATA',last}};
 if(terminal.status==='ARRIVED'||terminal.status==='DELIVERED')return{ok:true,airline:AIRLINE,shipment:terminal,debug:{stage:'SUCCESS',source:'cathay-terminal-actual'}};
 const live=await cathayCargoPage(mawb);
 if(live.ok){const shipment={...terminal,status:'ARRIVED',arrivalDate:live.arrivalDate||terminal.arrivalDate,arrivalTime:live.arrivalTime||terminal.arrivalTime,arrivalIsActual:true,source:'Cathay Cargo official Track & Trace'};return{ok:true,airline:AIRLINE,shipment,debug:{stage:'SUCCESS',source:'cathay-official-final-destination',live:live.debug}};}
 return{ok:true,airline:AIRLINE,shipment:terminal,debug:{stage:'SUCCESS',source:'cathay-terminal',browserFallback:live.reason,live:live.debug}};
}
