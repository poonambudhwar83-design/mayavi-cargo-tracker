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
function latestDateTime(text=''){
 const flat=String(text||'').replace(/\s+/g,' ').trim();
 const hits=[];
 const rx=/(\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s+20\d{2}(?:\s+\d{1,2}:\d{2})?|20\d{2}[-\/.]\d{1,2}[-\/.]\d{1,2}(?:[^0-9]+\d{1,2}:\d{2})?)/gi;
 for(const m of flat.matchAll(rx)){
  const x=dt(m[1]);
  if(x.date)hits.push({x,index:m.index||0});
 }
 if(!hits.length)return{date:'',time:''};
 const withTime=hits.filter(h=>h.x.time);
 return (withTime.length?withTime.at(-1):hits.at(-1)).x;
}
function parseTerminal(html,mawb){
 const text=clean(html),digits=mawb.replace(/\D/g,''),serial=digits.slice(3);
 if(!text.includes(digits)&&!text.includes(mawb)&&!text.includes(serial))return null;
 if(/Reject Reason|is not found/i.test(text))return null;
 const od=text.match(/AWB Type\s+(?:Import|Export)\s+([A-Z]{3})\s+([A-Z]{3})/i)||text.match(/Origin\s+Destination\s+([A-Z]{3})\s+([A-Z]{3})/i);
 const rcs=text.match(/Received from Shipper[\s\S]{0,500}?(\d{1,2}\s+[A-Z]{3}\s+20\d{2}\s+\d{1,2}:\d{2})\s+(\d{1,6})\s+([\d,.]+)/i);
 const depSection=(text.match(/Departure Flight[\s\S]{0,900}?(?=Received from Flight|Cargo Delivered|Last Update|$)/i)||[])[0]||'';
 const deps=[...depSection.matchAll(/\b(CX\d{2,4})\s+(\d{1,2}\s+[A-Z]{3}\s+20\d{2})\s+(\d{1,2}:\d{2})\s*\(STD\)\s+(\d{1,6})\s+([\d,.]+)/gi)],dep=deps.at(-1);
 const rcfSection=(text.match(/Received from Flight[\s\S]{0,1800}?(?=Cargo Delivered|Last Update|$)/i)||[])[0]||'';
 const rcfs=[...rcfSection.matchAll(/\b(CX\d{2,4})\s+(\d{1,2}\s+[A-Z]{3}\s+20\d{2})(?:\s+\d{1,2}:\d{2})?\s+(\d{1,6})\s+([\d,.]+)\s+(\d{1,2}\s+[A-Z]{3}\s+20\d{2}\s+\d{1,2}:\d{2})/gi)],rcf=rcfs.at(-1);
 const rcfFallbackArrival=latestDateTime(rcfSection);
 const rcfFallbackFlight=(rcfSection.match(/\b(CX\d{2,4})\b/gi)||[]).at(-1)||'';
 const rcfFallbackPieces=(rcfSection.match(/(?:Pieces?|PCS)\s*[:\-]?\s*(\d{1,6})/i)||[])[1]||'';
 const rcfFallbackWeight=(rcfSection.match(/(?:Weight|Gross\s+Weight)\s*[:\-]?\s*([\d,.]+)/i)||[])[1]||'';
 const delivered=/Cargo Delivered\s*\(DLV\)|Cargo Delivered/i.test(text);
 const strictArrival=rcf?dt(rcf[5]):{date:'',time:''};
 const arrival=strictArrival.date?strictArrival:rcfFallbackArrival;
 const hasRcf=Boolean(rcf)||Boolean(rcfSection&&arrival.date&&/Received from Flight|\bRCF\b/i.test(rcfSection));
 const booking=rcs?dt(rcs[1]).date:'';
 const pieces=rcf?.[3]||rcfFallbackPieces||dep?.[4]||rcs?.[2]||'';
 const weight=(rcf?.[4]||rcfFallbackWeight||dep?.[5]||rcs?.[3]||'').replace(/,/g,'');
 const flightNo=(rcf?.[1]||rcfFallbackFlight||dep?.[1]||'').toUpperCase();
 const status=delivered?'DELIVERED':hasRcf?'ARRIVED':dep?'IN TRANSIT':rcs?'BOOKED':'TRACKING';
 return{mawb,carrierCode:'CX',airlineName:'Cathay Cargo',origin:od?.[1]||'',destination:od?.[2]||'',bags:pieces,pieces,weight,bookingDate:booking,flightNo,arrivalDate:arrival.date,arrivalTime:arrival.time,arrivalIsActual:Boolean(hasRcf&&arrival.date),status,officialTracker:CATHAY,source:'Cathay Cargo Terminal official tracking'};
}
function actualArrival(text=''){
 const flat=String(text).replace(/\s+/g,' ').trim();
 const rx=/(?:actual\s+arrival|arrived|received\s+from\s+flight|\bRCF\b|landed)/ig;
 let best=null;
 for(const hit of flat.matchAll(rx)){
  const start=Math.max(0,(hit.index||0)-100),w=flat.slice(start,Math.min(flat.length,(hit.index||0)+500)),x=latestDateTime(w);
  const tm=w.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);if(!x.time&&tm)x.time=`${pad(tm[1])}:${tm[2]}`;
  if(x.date||x.time)best={...x,snippet:w};
 }
 return best;
}
async function cathayCargoPage(mawb){
 let browser;const serial=mawb.replace(/\D/g,'').slice(3),full=`160-${serial}`;
 try{
  chromium.setGraphicsMode=false;
  browser=await puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox'],defaultViewport:{width:1440,height:1100},executablePath:await chromium.executablePath(),headless:'shell'});
  const page=await browser.newPage();
  page.setDefaultTimeout(8000);
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36');
  await page.goto(CATHAY,{waitUntil:'domcontentloaded',timeout:14000});
  await new Promise(r=>setTimeout(r,1200));

  const focus=await page.evaluate(()=>{
   const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>10&&r.height>8&&s.display!=='none'&&s.visibility!=='hidden'&&!e.disabled;};
   const inputs=[...document.querySelectorAll('input')].filter(visible);
   const prefix=inputs.find(e=>String(e.value||'').trim()==='160'||/airline|prefix|code/i.test(`${e.id||''} ${e.name||''} ${e.placeholder||''}`));
   const awb=inputs.find(e=>e!==prefix&&!['submit','button','checkbox','radio','hidden'].includes((e.type||'text').toLowerCase())&&/awb|air.?waybill|waybill|shipment|number/i.test(`${e.id||''} ${e.name||''} ${e.placeholder||''} ${e.getAttribute('aria-label')||''}`));
   if(awb){awb.click();awb.focus();return{mode:'input',prefixValue:prefix?.value||''};}
   const labels=[...document.querySelectorAll('label,div,span,p')].filter(visible);
   const label=labels.find(e=>/^Air Waybill number\(s\)$/i.test((e.innerText||e.textContent||'').trim()))||labels.find(e=>/Air Waybill number\(s\)/i.test((e.innerText||e.textContent||'').trim()));
   if(label){
    label.click();
    let p=label;
    for(let i=0;i<4&&p;i++,p=p.parentElement){
     const r=p.getBoundingClientRect();
     if(r.width>180&&r.height>30&&r.height<160){
      const x=Math.min(r.right-30,Math.max(r.left+120,r.left+r.width*0.62));
      const y=r.top+r.height/2;
      const hit=document.elementFromPoint(x,y);
      if(hit){hit.click();if(hit.focus)hit.focus();return{mode:'label-box',x,y,tag:hit.tagName,prefixValue:prefix?.value||''};}
     }
    }
    return{mode:'label',prefixValue:prefix?.value||''};
   }
   if(prefix){
    const r=prefix.getBoundingClientRect();
    const x=Math.min(window.innerWidth-80,r.right+120),y=r.top+r.height/2;
    const hit=document.elementFromPoint(x,y);
    if(hit){hit.click();if(hit.focus)hit.focus();return{mode:'right-of-prefix',x,y,tag:hit.tagName,prefixValue:prefix.value||''};}
   }
   return{mode:'none',prefixValue:prefix?.value||''};
  });

  await new Promise(r=>setTimeout(r,250));
  await page.keyboard.type(serial,{delay:45}).catch(()=>{});
  await page.keyboard.press('Enter').catch(()=>{});
  await new Promise(r=>setTimeout(r,300));

  const entered=await page.evaluate((serial,full)=>{
   const body=(document.body?.innerText||'').replace(/\s+/g,' ');
   const values=[...document.querySelectorAll('input,textarea')].map(e=>e.value||'').filter(Boolean);
   const active=document.activeElement&&'value' in document.activeElement?String(document.activeElement.value||''):'';
   return{registered:body.includes(full)||body.includes(serial)||values.includes(serial)||active===serial,values:values.slice(0,12),active,bodyHasFull:body.includes(full),bodyHasSerial:body.includes(serial)};
  },serial,full);
  if(!entered.registered)return{ok:false,reason:'CATHAY FORM DID NOT ACCEPT AWB',debug:{focus,entered}};

  const buttons=await page.$$('button,input[type="submit"],input[type="button"],a');
  let button='';
  for(const h of buttons){
   const info=await h.evaluate(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return{visible:r.width>10&&r.height>8&&s.display!=='none'&&s.visibility!=='hidden'&&!e.disabled,text:(e.innerText||e.value||e.getAttribute('aria-label')||'').trim()};}).catch(()=>null);
   if(info?.visible&&/track\s*now|^track$/i.test(info.text)){await h.click().catch(()=>{});button=info.text||'Track now';break;}
  }
  if(!button)return{ok:false,reason:'TRACK NOW BUTTON NOT FOUND',debug:{focus,entered}};

  await page.waitForFunction((serial)=>{const t=document.body?.innerText||'';return t.includes(`160-${serial}`)||/Current status:|Shipment In Progress|Arrived|Departed/i.test(t);},{timeout:6500},serial).catch(()=>{});
  await new Promise(r=>setTimeout(r,500));

  let showDetails=false;
  for(const h of await page.$$('button,a,[role="button"]')){
   const t=String(await h.evaluate(e=>(e.innerText||e.textContent||e.getAttribute('aria-label')||'').trim()).catch(()=>''));
   if(/show\s+(?:all\s+)?details/i.test(t)){await h.click().catch(()=>{});showDetails=true;break;}
  }
  if(showDetails)await new Promise(r=>setTimeout(r,500));

  const text=await page.evaluate(()=>document.body?.innerText||'');
  const debug={focus,entered,button,showDetails};
  if(/captcha|verify you are human|access denied|security check/i.test(text))return{ok:false,reason:'CATHAY SECURITY CHECK',debug};
  const a=actualArrival(text);
  if(!a)return{ok:false,reason:'NO ACTUAL ARRIVAL MILESTONE',debug:{...debug,text:text.slice(0,5000)}};
  return{ok:true,arrivalDate:a.date,arrivalTime:a.time,snippet:a.snippet,debug};
 }catch(e){return{ok:false,reason:e?.message||String(e)};}finally{if(browser)await browser.close().catch(()=>{});}
}
export async function trackCathay(input){
 const mawb=normalizeMawb(input);if(!mawb||!mawb.startsWith('160-'))return{ok:false,reason:'INVALID CATHAY MAWB',airline:AIRLINE};
 const suffix=mawb.replace(/\D/g,'').slice(3);let terminal=null,last='';
 for(const url of [`${BASE}/AWBPrefix/160/AWBSuffix/${suffix}`,`${BASE}?AWBPrefix=160&AWBSuffix=${suffix}`]){try{const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0','accept-language':'en-US,en;q=0.9'},cache:'no-store',signal:AbortSignal.timeout(8000)});last=`HTTP ${r.status}`;if(!r.ok)continue;terminal=parseTerminal(await r.text(),mawb);if(terminal)break;}catch(e){last=e?.message||String(e);}}
 if(!terminal)return{ok:false,reason:'CATHAY TERMINAL RETURNED NO VERIFIED SHIPMENT DATA',airline:AIRLINE,debug:{stage:'NO_DATA',last}};
 if(terminal.status==='ARRIVED'||terminal.status==='DELIVERED')return{ok:true,airline:AIRLINE,shipment:terminal,debug:{stage:'SUCCESS',source:'cathay-terminal-actual'}};
 const live=await cathayCargoPage(mawb);
 if(live.ok){const shipment={...terminal,status:'ARRIVED',arrivalDate:live.arrivalDate||terminal.arrivalDate,arrivalTime:live.arrivalTime||terminal.arrivalTime,arrivalIsActual:true,source:'Cathay Cargo official Track & Trace'};return{ok:true,airline:AIRLINE,shipment,debug:{stage:'SUCCESS',source:'cathay-official-final-destination',live:live.debug}};}
 return{ok:true,airline:AIRLINE,shipment:terminal,debug:{stage:'SUCCESS',source:'cathay-terminal',browserFallback:live.reason,live:live.debug}};
}
