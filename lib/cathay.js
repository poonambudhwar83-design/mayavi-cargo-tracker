import { normalizeMawb } from './airlines.js';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const TERMINAL='https://www.cathaycargoterminal.com/en-us/Shipment-Tracking';
const CATHAY='https://www.cathaycargo.com/en-us/track-and-trace.html';
const AIRLINE={name:'Cathay Cargo',iata:'CX',url:CATHAY};
const MONTH={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
const pad=v=>String(v).padStart(2,'0');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clean=s=>String(s||'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/\s+/g,' ').trim();

function dateTime(v=''){
  const m=String(v).toUpperCase().match(/(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s+(20\d{2})(?:\s+(\d{1,2}):(\d{2}))?/);
  return m?{date:`${m[3]}-${MONTH[m[2]]}-${pad(m[1])}`,time:m[4]?`${pad(m[4])}:${m[5]}`:''}:{date:'',time:''};
}

function parseTerminal(html,mawb){
  const text=clean(html),digits=mawb.replace(/\D/g,''),serial=digits.slice(3);
  if(!text.includes(digits)&&!text.includes(serial))return null;
  if(/Reject Reason|is not found/i.test(text))return null;
  const od=text.match(/AWB Type\s+(?:Import|Export)\s+([A-Z]{3})\s+([A-Z]{3})/i)||text.match(/Origin\s+Destination\s+([A-Z]{3})\s+([A-Z]{3})/i);
  const rcs=text.match(/Received from Shipper[\s\S]{0,1200}?(\d{1,2}\s+[A-Z]{3}\s+20\d{2}\s+\d{1,2}:\d{2})\s+(\d{1,6})\s+([\d,.]+)/i);
  const depBlock=(text.match(/Departure Flight[\s\S]{0,2600}?(?=Received from Flight|Cargo Delivered|Last Update|$)/i)||[])[0]||'';
  const depRows=[...depBlock.matchAll(/\b(CX\d{2,4})\s+(\d{1,2}\s+[A-Z]{3}\s+20\d{2})\s+(\d{1,2}:\d{2})\s*\(STD\)\s+(\d{1,6})\s+([\d,.]+)/gi)];
  const dep=depRows.at(-1); const atd=depBlock.match(/(?:\d{1,2}\s+[A-Z]{3}\s+20\d{2}\s+)?(\d{1,2}:\d{2})\s*\(ATD\)/i);
  const departure=dep?dateTime(`${dep[2]} ${atd?.[1]||dep[3]}`):{date:'',time:''};
  const rcfBlock=(text.match(/Received from Flight[\s\S]{0,4000}?(?=Cargo Delivered|Last Update|$)/i)||[])[0]||'';
  const rcfRows=[...rcfBlock.matchAll(/\b(CX\d{2,4})\s+(\d{1,2}\s+[A-Z]{3}\s+20\d{2})(?:\s+\d{1,2}:\d{2})?\s+(\d{1,6})\s+([\d,.]+)\s+(\d{1,2}\s+[A-Z]{3}\s+20\d{2}\s+\d{1,2}:\d{2})/gi)];
  const rcf=rcfRows.at(-1),arrival=rcf?dateTime(rcf[5]):{date:'',time:''};
  const delivered=/Cargo Delivered/i.test(text);
  const pieces=rcf?.[3]||dep?.[4]||rcs?.[2]||'';
  const weight=(rcf?.[4]||dep?.[5]||rcs?.[3]||'').replace(/,/g,'');
  return {mawb,carrierCode:'CX',airlineName:'Cathay Cargo',origin:od?.[1]||'',destination:od?.[2]||'',bags:pieces,pieces,weight,bookingDate:rcs?dateTime(rcs[1]).date:'',flightNo:(rcf?.[1]||dep?.[1]||'').toUpperCase(),departureDate:departure.date,departureTime:departure.time,arrivalDate:arrival.date,arrivalTime:arrival.time,arrivalIsActual:Boolean(rcf&&arrival.date),status:delivered?'DELIVERED':rcf?'ARRIVED':dep?'IN TRANSIT':rcs?'BOOKED':'TRACKING',officialTracker:CATHAY,source:'Cathay Cargo Terminal official tracking'};
}

async function terminalTrack(mawb){
  const suffix=mawb.replace(/\D/g,'').slice(3); let last='';
  const urls=[`${TERMINAL}/AWBPrefix/160/AWBSuffix/${suffix}`,`${TERMINAL}?AWBPrefix=160&AWBSuffix=${suffix}`];
  for(const url of urls){
    for(let attempt=0;attempt<2;attempt++){
      try{
        const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36','accept':'text/html,application/xhtml+xml','accept-language':'en-US,en;q=0.9'},redirect:'follow',cache:'no-store',signal:AbortSignal.timeout(12000)});
        last=`HTTP ${r.status}`; if(!r.ok){await sleep(300);continue;}
        const shipment=parseTerminal(await r.text(),mawb); if(shipment)return{ok:true,shipment};
      }catch(e){last=e?.message||String(e);}
    }
  }
  return{ok:false,reason:last||'TERMINAL NO DATA'};
}

function parseCathayText(text,mawb){
  const flat=clean(text),digits=mawb.replace(/\D/g,''),serial=digits.slice(3);
  if(!flat.includes(serial)&&!flat.includes(digits))return null;
  const route=flat.match(/\b([A-Z]{3})\s+to\s+([A-Z]{3})\s*\|\s*(\d+)\s*pc(?:\(s\)|s)?\s*\|\s*([\d,.]+)\s*kg/i)||flat.match(/\b([A-Z]{3})\s+to\s+([A-Z]{3})\b/i);
  const pieces=route?.[3]||(flat.match(/\b(\d{1,5})\s*pc(?:\(s\)|s)?\b/i)||[])[1]||'';
  const weight=(route?.[4]||(flat.match(/\b([\d,.]+)\s*kg\b/i)||[])[1]||'').replace(/,/g,'');
  const flightNo=((flat.match(/\b(CX\s*\d{2,4})\b/i)||[])[1]||'').replace(/\s+/g,'').toUpperCase();
  const dates=[...flat.matchAll(/(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*(?:\s+(20\d{2}))?\s+(\d{1,2}):(\d{2})/gi)];
  const year=String(new Date().getUTCFullYear());
  const toDT=m=>({date:`${m[3]||year}-${MONTH[m[2].toUpperCase()]}-${pad(m[1])}`,time:`${pad(m[4])}:${m[5]}`});
  let arrival={date:'',time:''};
  const ai=flat.search(/\b(Arrived|Actual arrival|ATA)\b/i); if(ai>=0){const m=dates.find(x=>(x.index||0)>=ai-120&&(x.index||0)<=ai+350);if(m)arrival=toDT(m);}
  const arrived=/\bArrived\b|Actual arrival|\bATA\b/i.test(flat);
  return{mawb,carrierCode:'CX',airlineName:'Cathay Cargo',origin:route?.[1]||'',destination:route?.[2]||'',bags:pieces,pieces,weight,flightNo,arrivalDate:arrival.date,arrivalTime:arrival.time,arrivalIsActual:Boolean(arrived&&arrival.date),status:arrived?'ARRIVED':/Departed|In progress|Accepted/i.test(flat)?'IN TRANSIT':'TRACKING',officialTracker:CATHAY,source:'Cathay Cargo official Track & Trace'};
}

async function officialTrack(mawb){
  let browser; const digits=mawb.replace(/\D/g,''),serial=digits.slice(3); const debug={};
  try{
    chromium.setGraphicsMode=false;
    browser=await puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox','--disable-http2','--disable-quic'],defaultViewport:{width:1440,height:1200},executablePath:await chromium.executablePath(),headless:'shell'});
    const page=await browser.newPage(); page.setDefaultTimeout(9000);
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36');
    await page.goto(CATHAY,{waitUntil:'domcontentloaded',timeout:22000}); await sleep(2500);
    for(const f of page.frames()){
      try{await f.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(x=>/accept all|reject all/i.test(x.innerText||''));b?.click();});}catch{}
    }
    let entered=false;
    for(const f of page.frames()){
      try{
        entered=await f.evaluate(({serial,digits})=>{
          const vis=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>4&&r.height>4&&s.visibility!=='hidden'&&s.display!=='none';};
          const inputs=[...document.querySelectorAll('input,textarea,[contenteditable=true]')].filter(vis);
          const code=inputs.find(e=>/airline|prefix|code/i.test(`${e.name} ${e.id} ${e.placeholder} ${e.getAttribute('aria-label')||''}`));
          if(code){code.focus();code.value='160';code.dispatchEvent(new Event('input',{bubbles:true}));code.dispatchEvent(new Event('change',{bubbles:true}));}
          const awb=inputs.find(e=>/awb|waybill|air waybill/i.test(`${e.name} ${e.id} ${e.placeholder} ${e.getAttribute('aria-label')||''}`)&&e!==code)||inputs.find(e=>e!==code&&/text|search|tel|number/.test(e.type||'text'));
          if(!awb)return false;awb.focus();awb.value=serial;awb.dispatchEvent(new Event('input',{bubbles:true}));awb.dispatchEvent(new Event('change',{bubbles:true}));
          return true;
        },{serial,digits}); if(entered)break;
      }catch{}
    }
    if(!entered)return{ok:false,reason:'CATHAY AWB INPUT NOT FOUND'};
    await page.keyboard.press('Enter').catch(()=>{});await sleep(500);
    for(const f of page.frames()){
      try{const clicked=await f.evaluate(()=>{const e=[...document.querySelectorAll('button,a,[role=button],input[type=submit]')].find(x=>/^\s*track(?:\s+now)?\s*$/i.test(x.innerText||x.value||x.textContent||''));if(e){e.click();return true;}return false;});if(clicked)break;}catch{}
    }
    let text='';for(let i=0;i<24;i++){await sleep(650);text=(await Promise.all(page.frames().map(async f=>{try{return await f.evaluate(()=>document.body?.innerText||'');}catch{return'';}}))).join('\n');if(text.includes(serial)&&/Arrived|Departed|Accepted|Booking Status|Shipment/i.test(text))break;}
    debug.sample=clean(text).slice(0,3000);const shipment=parseCathayText(text,mawb);return shipment?{ok:true,shipment,debug}:{ok:false,reason:'CATHAY RESULT NOT VISIBLE',debug};
  }catch(e){return{ok:false,reason:e?.message||String(e),debug};}
  finally{if(browser){try{await browser.close();}catch{}}}
}

export async function trackCathay(input){
  const mawb=normalizeMawb(input);
  if(!mawb||!mawb.startsWith('160-'))return{ok:false,reason:'INVALID CATHAY MAWB',airline:AIRLINE};
  const terminal=await terminalTrack(mawb);
  if(terminal.ok&&(terminal.shipment.status==='ARRIVED'||terminal.shipment.status==='DELIVERED'))return{ok:true,airline:AIRLINE,shipment:terminal.shipment,debug:{source:'cathay-terminal'}};
  const official=await officialTrack(mawb);
  if(official.ok){
    const t=terminal.ok?terminal.shipment:{},s=official.shipment||{};
    const shipment={...t,...s,mawb,origin:s.origin||t.origin||'',destination:s.destination||t.destination||'',bags:s.bags||t.bags||'',pieces:s.pieces||t.pieces||'',weight:s.weight||t.weight||'',bookingDate:t.bookingDate||'',flightNo:s.flightNo||t.flightNo||'',departureDate:t.departureDate||'',departureTime:t.departureTime||'',arrivalDate:s.arrivalDate||t.arrivalDate||'',arrivalTime:s.arrivalTime||t.arrivalTime||'',arrivalIsActual:Boolean(s.arrivalIsActual||t.arrivalIsActual),status:s.status==='TRACKING'?(t.status||'TRACKING'):s.status,officialTracker:CATHAY};
    return{ok:true,airline:AIRLINE,shipment,debug:{source:'cathay-official',terminal:terminal.reason,official:official.debug}};
  }
  if(terminal.ok)return{ok:true,airline:AIRLINE,shipment:{...terminal.shipment,mawb},debug:{source:'cathay-terminal-fallback',official:official.reason}};
  // Never erase the AWB from Mayavi merely because Cathay's website is temporarily unavailable.
  return{ok:true,airline:AIRLINE,shipment:{mawb,carrierCode:'CX',airlineName:'Cathay Cargo',origin:'',destination:'',bags:'',pieces:'',weight:'',bookingDate:'',flightNo:'',arrivalDate:'',arrivalTime:'',arrivalIsActual:false,status:'TRACKING',officialTracker:CATHAY,source:'Cathay tracker temporarily unavailable'},debug:{source:'cathay-resilient-fallback',terminal:terminal.reason,official:official.reason}};
}
