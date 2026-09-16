import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { normalizeMawb } from './airlines.js';

const TERMINAL='https://www.cathaycargoterminal.com/en-us/Shipment-Tracking';
const CATHAY='https://www.cathaycargo.com/en-us/track-and-trace.html';
const AIRLINE={name:'Cathay Cargo',iata:'CX',url:CATHAY};
const MONTH={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
const pad=v=>String(v).padStart(2,'0');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clean=s=>String(s||'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/\s+/g,' ').trim();

function dt(v='',fallbackYear=''){
  const s=String(v).toUpperCase();
  let m=s.match(/(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s+(20\d{2})(?:\s+(\d{1,2}):(\d{2}))?/);
  if(m)return{date:`${m[3]}-${MONTH[m[2]]}-${pad(m[1])}`,time:m[4]?`${pad(m[4])}:${m[5]}`:''};
  m=s.match(/(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*(?:\s+(\d{1,2}):(\d{2}))?/);
  if(m){const year=/^20\d{2}$/.test(String(fallbackYear))?String(fallbackYear):String(new Date().getUTCFullYear());return{date:`${year}-${MONTH[m[2]]}-${pad(m[1])}`,time:m[3]?`${pad(m[3])}:${m[4]}`:''};}
  return{date:'',time:''};
}

function airport(text,labels=[]){
  for(const label of labels){const m=String(text).match(new RegExp(`${label}\\s*[:\\-]?\\s*([A-Z]{3})\\b`,'i'));if(m)return m[1].toUpperCase();}
  return'';
}

function terminalParse(html,mawb){
  const text=clean(html),digits=mawb.replace(/\D/g,''),serial=digits.slice(3);
  if(!text.includes(digits)&&!text.includes(serial))return null;
  if(/Reject Reason|is not found/i.test(text))return null;

  const od=text.match(/AWB Type\s+(?:Import|Export)\s+([A-Z]{3})\s+([A-Z]{3})/i)
    ||text.match(/Origin\s+Destination\s+([A-Z]{3})\s+([A-Z]{3})/i)
    ||text.match(/(?:Routing|Route)\s+([A-Z]{3})\s+(?:to|[-–>])?\s*([A-Z]{3})/i);
  const routePairs=[...text.matchAll(/\b([A-Z]{3})\s*(?:-|–|>|TO)\s*([A-Z]{3})\b/gi)]
    .filter(m=>!['AWB','STD','STA','ATA','ATD','UTC','HKG','PCS'].includes(m[1])&&!['AWB','STD','STA','ATA','ATD','UTC','PCS'].includes(m[2]));
  const origin=od?.[1]||airport(text,['Origin','Origin Airport','Departure Station','From'])||routePairs[0]?.[1]||'';
  const destination=od?.[2]||airport(text,['Destination','Destination Airport','Arrival Station','To'])||routePairs.at(-1)?.[2]||'';

  const rcs=text.match(/Received from Shipper[\s\S]{0,1600}?(\d{1,2}\s+[A-Z]{3}\s+20\d{2}\s+\d{1,2}:\d{2})\s+(\d{1,6})\s+([\d,.]+)/i);
  const depBlock=(text.match(/Departure Flight[\s\S]{0,4000}?(?=Received from Flight|Cargo Delivered|Last Update|$)/i)||[])[0]||'';
  const deps=[...depBlock.matchAll(/\b(CX\s*\d{2,4})\s+(\d{1,2}\s+[A-Z]{3}\s+20\d{2})(?:\s+(\d{1,2}:\d{2}))?(?:\s*\(STD\))?[\s\S]{0,120}?(\d{1,6})\s+([\d,.]+)/gi)],dep=deps.at(-1);
  const rcfBlock=(text.match(/Received from Flight[\s\S]{0,6000}?(?=Cargo Delivered|Last Update|$)/i)||[])[0]||'';
  const rcfs=[...rcfBlock.matchAll(/\b(CX\s*\d{2,4})[\s\S]{0,240}?(\d{1,2}\s+[A-Z]{3}\s+20\d{2})(?:\s+\d{1,2}:\d{2})?[\s\S]{0,180}?(\d{1,6})\s+([\d,.]+)[\s\S]{0,240}?(\d{1,2}\s+[A-Z]{3}\s+20\d{2}\s+\d{1,2}:\d{2})/gi)],rcf=rcfs.at(-1);
  const actualCandidates=[...text.matchAll(/(?:Actual Arrival|Arrived|ATA)[\s\S]{0,420}?(\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s+20\d{2}\s+\d{1,2}:\d{2})/gi)].map(m=>dt(m[1])).filter(x=>x.date&&x.time);
  const scheduledCandidates=[...text.matchAll(/(?:Arrival|STA|ETA|Expected Arrival|Scheduled Arrival)[\s\S]{0,260}?(\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s+20\d{2}\s+\d{1,2}:\d{2})/gi)].map(m=>dt(m[1])).filter(x=>x.date&&x.time);

  const arrival=actualCandidates.at(-1)||scheduledCandidates.at(-1)||{date:'',time:''};
  const arrivalIsActual=actualCandidates.length>0;
  const pieces=rcf?.[3]||dep?.[4]||rcs?.[2]||'';
  const weight=(rcf?.[4]||dep?.[5]||rcs?.[3]||'').replace(/,/g,'');
  const flight=(rcf?.[1]||dep?.[1]||text.match(/\bCX\s*\d{2,4}\b/i)?.[0]||'').replace(/\s/g,'').toUpperCase();

  return{mawb,carrierCode:'CX',airlineName:'Cathay Cargo',origin,destination,bags:pieces,pieces,weight,bookingDate:rcs?dt(rcs[1]).date:'',flightNo:flight,arrivalDate:arrival.date,arrivalTime:arrival.time,arrivalIsActual,status:/Cargo Delivered/i.test(text)?'DELIVERED':arrivalIsActual?'ARRIVED':dep?'IN TRANSIT':rcs?'BOOKED':'TRACKING',officialTracker:CATHAY,source:'Cathay Cargo Terminal official tracking'};
}

function parseMainTimeline(text,mawb){
  const flat=String(text||'').replace(/\s+/g,' ').trim();
  if(!flat||!/Shipment\s+In\s+Progress|\bAccepted\b|\bDeparted\b|\bArrived\b|\bCX\s*\d{2,4}\b/i.test(flat))return null;

  const year=(flat.match(/\b(20\d{2})\b/)||[])[1]||String(new Date().getUTCFullYear());
  const accepted=[...flat.matchAll(/\b([A-Z]{3})\s+Accepted\b/gi)].map(m=>m[1].toUpperCase());
  const departed=[...flat.matchAll(/\b([A-Z]{3})\s+Departed\b/gi)].map(m=>m[1].toUpperCase());
  const arrived=[...flat.matchAll(/\b([A-Z]{3})\s+Arrived\b/gi)].map(m=>m[1].toUpperCase());
  const origin=departed[0]||accepted[0]||'';
  const destination=arrived.at(-1)||'';

  const cards=[...flat.matchAll(/\b(CX\s*\d{2,4})\b[\s\S]{0,180}?(\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*)\s+(\d{1,2}:\d{2})[\s\S]{0,120}?(\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*)\s+(\d{1,2}:\d{2})/gi)];
  const card=cards.at(-1);
  const flightNo=(card?.[1]||flat.match(/\bCX\s*\d{2,4}\b/i)?.[0]||'').replace(/\s+/g,'').toUpperCase();
  const departure=card?dt(`${card[2]} ${card[3]}`,year):{date:'',time:''};
  const arrival=card?dt(`${card[4]} ${card[5]}`,year):{date:'',time:''};

  const summary=flat.match(/\b(\d{1,5})\s*pc\(s\)\s*\|\s*([\d,.]+)\s*kg\b/i)
    ||flat.match(/\b(\d{1,5})\s*(?:pcs?|pieces?)\b[\s\S]{0,30}?\b([\d,.]+)\s*kg\b/i);
  const pieces=summary?.[1]||'';
  const weight=(summary?.[2]||'').replace(/,/g,'');

  const arrivedAtDestination=Boolean(destination&&new RegExp(`\\b${destination}\\s+Arrived\\b`,'i').test(flat));
  const delivered=/Current\s+status\s*:\s*Delivered/i.test(flat);
  const status=delivered?'DELIVERED':arrivedAtDestination||Boolean(arrival.date&&arrival.time)?'ARRIVED':departed.length?'IN TRANSIT':accepted.length?'BOOKED':'TRACKING';

  return{mawb,carrierCode:'CX',airlineName:'Cathay Cargo',origin,destination,bags:pieces,pieces,weight,flightNo,arrivalDate:arrival.date,arrivalTime:arrival.time,arrivalIsActual:Boolean(arrivedAtDestination&&arrival.date&&arrival.time),status,officialTracker:CATHAY,source:'Cathay Cargo Track & Trace timeline',arrivalTimeSource:'Cathay flight card right-side arrival time',departureDate:departure.date,departureTime:departure.time};
}

function mergePrimary(primary={},fallback={}){
  const out={...fallback};
  for(const [k,v] of Object.entries(primary||{})){if(v!==''&&v!==null&&v!==undefined)out[k]=v;}
  if(primary?.origin)out.origin=primary.origin;
  if(primary?.destination)out.destination=primary.destination;
  if(primary?.arrivalDate)out.arrivalDate=primary.arrivalDate;
  if(primary?.arrivalTime)out.arrivalTime=primary.arrivalTime;
  if(primary?.flightNo)out.flightNo=primary.flightNo;
  if(primary?.status)out.status=primary.status;
  if(primary?.arrivalDate&&primary?.arrivalTime)out.arrivalIsActual=primary.arrivalIsActual===true;
  return out;
}

async function get(url){
  try{const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0','accept':'text/html,application/xhtml+xml'},redirect:'follow',cache:'no-store',signal:AbortSignal.timeout(9000)});if(!r.ok)return null;return await r.text();}catch{return null;}
}

async function terminalFallback(mawb){
  const suffix=mawb.replace(/\D/g,'').slice(3);
  const urls=[`${TERMINAL}/AWBPrefix/160/AWBSuffix/${suffix}`,`${TERMINAL}?AWBPrefix=160&AWBSuffix=${suffix}`];
  for(const url of urls){const html=await get(url);if(!html)continue;const shipment=terminalParse(html,mawb);if(shipment)return{shipment,url};}
  return null;
}

async function launchBrowser(){
  chromium.setGraphicsMode=false;
  const executablePath=await chromium.executablePath();
  return puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox','--disable-blink-features=AutomationControlled','--lang=en-US,en'],defaultViewport:{width:1440,height:1100,deviceScaleFactor:1},executablePath,headless:'shell'});
}

async function acceptCookies(page){
  await page.evaluate(()=>{const buttons=[...document.querySelectorAll('button,[role="button"]')];const b=buttons.find(x=>/accept all|accept cookies|allow all|agree/i.test((x.innerText||x.getAttribute('aria-label')||'').trim()));if(b)b.click();}).catch(()=>{});
}

async function trackMainPage(mawb){
  const digits=mawb.replace(/\D/g,''),prefix=digits.slice(0,3),serial=digits.slice(3);
  let browser;let watchdog;
  try{
    browser=await launchBrowser();
    watchdog=setTimeout(()=>{try{browser?.process()?.kill('SIGKILL');}catch{}},32000);
    const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({'Accept-Language':'en-US,en;q=0.9'});
    await page.goto(CATHAY,{waitUntil:'domcontentloaded',timeout:18000});
    await sleep(2200);await acceptCookies(page);await sleep(500);

    const fill=await page.evaluate(({prefix,serial,digits,mawb})=>{
      const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>20&&r.height>10&&!e.disabled;};
      const inputs=[...document.querySelectorAll('input')].filter(visible).filter(e=>!['hidden','checkbox','radio','submit','button'].includes((e.type||'text').toLowerCase()));
      const desc=e=>`${e.name||''} ${e.id||''} ${e.placeholder||''} ${e.getAttribute('aria-label')||''} ${e.getAttribute('title')||''}`.toLowerCase();
      const set=(e,v)=>{const d=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');d?.set?.call(e,v);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));};
      const prefixInput=inputs.find(e=>/airline\s*code|prefix/.test(desc(e)));
      const numberInput=inputs.find(e=>/(awb|airway|document|tracking|shipment).*(number|no|serial|suffix)|awbnumber|documentnumber|air\s*waybill/.test(desc(e))&&!/prefix|airline\s*code/.test(desc(e)));
      if(prefixInput&&numberInput){set(prefixInput,prefix);set(numberInput,serial);return{filled:true,mode:'split'};}
      if(numberInput){set(numberInput,digits);return{filled:true,mode:'digits'};}
      if(inputs.length>=2){set(inputs[0],prefix);set(inputs[1],serial);return{filled:true,mode:'position-split'};}
      const best=inputs.map(e=>({e,score:(/(awb|airway|tracking|shipment|document)/.test(desc(e))?6:0)+(/number|no|serial|suffix/.test(desc(e))?3:0)})).sort((a,b)=>b.score-a.score)[0];
      if(best?.e&&best.score>0){set(best.e,mawb);return{filled:true,mode:'single'};}
      return{filled:false,mode:''};
    },{prefix,serial,digits,mawb}).catch(()=>({filled:false,mode:''}));

    let clicked='';
    if(fill.filled){
      await sleep(400);
      clicked=await page.evaluate(()=>{
        const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>20&&r.height>10&&!e.disabled;};
        const els=[...document.querySelectorAll('button,input[type="submit"],a,[role="button"]')].filter(visible);
        const target=els.find(e=>/^(track|search|submit|go)$/i.test((e.innerText||e.value||e.getAttribute('aria-label')||'').trim())||/track\s*(and\s*trace|shipment|cargo|awb)/i.test((e.innerText||e.value||e.getAttribute('aria-label')||'').trim()));
        if(!target)return'';const t=(target.innerText||target.value||target.getAttribute('aria-label')||'').trim();target.click();return t;
      }).catch(()=> '');
      await Promise.race([page.waitForNetworkIdle({idleTime:800,timeout:6500}).catch(()=>{}),sleep(6500)]);
      await sleep(1200);
    }

    let text='';for(const frame of page.frames()){try{text+=`\n${await frame.evaluate(()=>document.body?.innerText||'')}`;}catch{}}
    const shipment=parseMainTimeline(text,mawb);
    const screenshotBase64=await page.screenshot({type:'jpeg',quality:62,fullPage:false,encoding:'base64'}).catch(()=>null);
    if(shipment)return{ok:true,shipment,screenshotBase64,debug:{stage:'SUCCESS',fillMode:fill.mode||'',clicked,pageText:text.slice(0,9000)}};
    return{ok:false,reason:'CATHAY MAIN TIMELINE NOT PARSED',screenshotBase64,debug:{stage:'NO_TIMELINE',fillMode:fill.mode||'',clicked,pageText:text.slice(0,9000)}};
  }catch(e){return{ok:false,reason:`CATHAY MAIN PAGE ERROR: ${e?.message||e}`,debug:{stage:'ERROR'}};}
  finally{
    if(watchdog)clearTimeout(watchdog);
    if(browser){
      try{await Promise.race([browser.close(),sleep(1200)]);}catch{}
      try{browser.process()?.kill('SIGKILL');}catch{}
    }
  }
}

export async function trackCathay(input){
  const mawb=normalizeMawb(input);
  if(!mawb||!mawb.startsWith('160-'))return{ok:false,reason:'INVALID CATHAY MAWB',airline:AIRLINE};

  const [main,terminal]=await Promise.all([trackMainPage(mawb),terminalFallback(mawb)]);
  if(main?.ok){
    const shipment=mergePrimary(main.shipment,terminal?.shipment||{});
    shipment.source='Cathay Cargo Track & Trace timeline';
    shipment.arrivalTimeSource='Cathay flight card right-side arrival time';
    return{ok:true,airline:AIRLINE,shipment,screenshotCaptured:Boolean(main.screenshotBase64),screenshotVerified:Boolean(main.screenshotBase64),debug:{source:'cathay-main-timeline',main:main.debug,terminalUrl:terminal?.url||''}};
  }
  if(terminal?.shipment)return{ok:true,airline:AIRLINE,shipment:terminal.shipment,screenshotCaptured:Boolean(main?.screenshotBase64),screenshotVerified:false,debug:{source:'cathay-terminal-fallback',mainError:main?.reason||'',main:main?.debug||null,terminalUrl:terminal.url}};
  return{ok:false,airline:AIRLINE,reason:main?.reason||'CATHAY DATA NOT EXTRACTED',debug:{main:main?.debug||null}};
}
