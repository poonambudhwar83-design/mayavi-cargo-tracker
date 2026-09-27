import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { normalizeMawb } from './airlines.js';

const PAGE='https://tracking.one/air/carriers/malaysia-airlines';
const GUEST_API='https://tracking.one/api/guest/v1/shipments/air';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
const digits=v=>String(v??'').replace(/\D/g,'');
const pad=v=>String(v).padStart(2,'0');
const MONTH={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};

function dateISO(value=''){
  const s=clean(value).toUpperCase();
  let m=s.match(/\b(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})\b/);
  if(m)return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m=s.match(/\b(\d{1,2})[-\/.](\d{1,2})[-\/.](20\d{2})\b/);
  if(m)return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  m=s.match(/\b(\d{1,2})[\s,-]+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s,-]+(20\d{2})\b/);
  if(m)return `${m[3]}-${MONTH[m[2]]}-${pad(m[1])}`;
  m=s.match(/\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s,-]+(\d{1,2})[\s,-]+(20\d{2})\b/);
  if(m)return `${m[3]}-${MONTH[m[1]]}-${pad(m[2])}`;
  return '';
}
function time24(value=''){
  const s=clean(value).toUpperCase();
  let m=s.match(/\b(1[0-2]|0?\d):([0-5]\d)\s*(AM|PM)\b/);
  if(m){let h=Number(m[1]);if(m[3]==='PM'&&h<12)h+=12;if(m[3]==='AM'&&h===12)h=0;return `${pad(h)}:${m[2]}`;}
  m=s.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);return m?`${pad(m[1])}:${m[2]}`:'';
}
const airport=v=>(clean(v).toUpperCase().match(/\b[A-Z]{3}\b/)||[])[0]||'';
const flightNo=v=>{const m=clean(v).toUpperCase().match(/\bMH\s*[- ]?(\d{1,4})\b/);return m?`MH${m[1]}`:''};
const numeric=v=>(clean(v).replace(/,/g,'').match(/\d+(?:\.\d+)?/)||[])[0]||'';
const kn=k=>String(k||'').toLowerCase().replace(/[^a-z0-9]/g,'');

function nodes(value,path='',out=[]){
  if(value===null||value===undefined)return out;
  if(Array.isArray(value)){value.forEach((v,i)=>nodes(v,`${path}[${i}]`,out));return out}
  if(typeof value==='object'){
    for(const [k,v] of Object.entries(value)){
      out.push({key:k,norm:kn(k),value:v,path:path?`${path}.${k}`:k});
      nodes(v,path?`${path}.${k}`:k,out);
    }
  }
  return out;
}
function scalar(ns,names=[]){
  const wanted=new Set(names.map(kn));
  for(const n of ns){
    if(!wanted.has(n.norm))continue;
    if(['string','number'].includes(typeof n.value)&&clean(n.value)!=='')return clean(n.value);
  }
  return '';
}
function statusFrom(v=''){
  const s=clean(v).toUpperCase();
  if(/DELIVERED|ARRIVED|LANDED|RECEIVED FROM FLIGHT|\bRCF\b/.test(s))return'ARRIVED';
  if(/DELAY|LATE|OFFLOAD|EXCEPTION/.test(s))return'DELAYED';
  if(/DEPARTED|AIRBORNE|IN TRANSIT|EN ROUTE|\bDEP\b/.test(s))return'IN TRANSIT';
  if(/BOOKED|ACCEPTED|MANIFESTED|\bRCS\b/.test(s))return'BOOKED';
  return'TRACKING';
}
function parseObject(obj,mawb){
  if(!obj||typeof obj!=='object')return null;
  const raw=JSON.stringify(obj),full=digits(mawb),serial=full.slice(3);
  const flat=digits(raw);
  if(!flat.includes(full)&&!flat.includes(serial))return null;
  const ns=nodes(obj);
  let origin=airport(scalar(ns,['origin','originAirport','originCode','departureAirport','from','fromAirport']));
  let destination=airport(scalar(ns,['destination','destinationAirport','destinationCode','arrivalAirport','to','toAirport']));
  const pieces=numeric(scalar(ns,['pieces','pcs','pieceCount','piecesCount','totalPieces','numberOfPieces','packageCount','packages']));
  const weight=numeric(scalar(ns,['weight','grossWeight','totalWeight','shipmentWeight']));
  let flight=flightNo(scalar(ns,['flightNo','flightNumber','flight']));
  let flightDate=dateISO(scalar(ns,['flightDate','departureDate','scheduledDepartureDate']));
  let departureDate=dateISO(scalar(ns,['departureDate','scheduledDepartureDate','actualDepartureDate']));
  let departureTime=time24(scalar(ns,['departureTime','scheduledDepartureTime','actualDepartureTime']));
  let arrivalDate=dateISO(scalar(ns,['arrivalDate','scheduledArrivalDate','estimatedArrivalDate','actualArrivalDate','eta']));
  let arrivalTime=time24(scalar(ns,['arrivalTime','scheduledArrivalTime','estimatedArrivalTime','actualArrivalTime','eta']));
  let bookingDate=dateISO(scalar(ns,['bookingDate','bookedDate','shipmentDate','awbDate']));
  let statusText=scalar(ns,['status','currentStatus','shipmentStatus','latestStatus','state']);
  let actualArrival=Boolean(scalar(ns,['actualArrivalDate','actualArrivalTime','ata']));

  const stringValues=ns.filter(n=>typeof n.value==='string').map(n=>clean(n.value));
  const combined=stringValues.join(' | ');
  if(!flight)flight=flightNo(combined);
  if(!origin||!destination){
    const route=combined.match(/\b([A-Z]{3})\s*(?:-|→|>|TO)\s*([A-Z]{3})\b/i);
    if(route){origin=origin||route[1].toUpperCase();destination=destination||route[2].toUpperCase();}
  }
  if(!bookingDate){
    const b=(combined.match(/.{0,100}(?:BOOKED|Booking).{0,140}/i)||[])[0]||'';bookingDate=dateISO(b);
  }
  if(!arrivalDate){
    const a=(combined.match(/.{0,100}(?:ARRIVED|LANDED|DELIVERED|ATA|RCF).{0,180}/i)||[])[0]||'';
    arrivalDate=dateISO(a);arrivalTime=arrivalTime||time24(a);if(arrivalDate||arrivalTime)actualArrival=true;
  }
  if(!departureDate){
    const d=(combined.match(/.{0,100}(?:DEPARTED|ATD|DEP).{0,180}/i)||[])[0]||'';
    departureDate=dateISO(d);departureTime=departureTime||time24(d);
  }
  if(!statusText)statusText=combined;
  const status=statusFrom(statusText);
  const useful=Boolean((origin&&destination)||pieces||weight||flight||arrivalDate||bookingDate||status!=='TRACKING');
  if(!useful)return null;
  return{
    mawb,carrierCode:'MH',airlineName:'Malaysia Airlines Cargo / MASkargo',
    origin,destination,pieces,bags:pieces,weight,flightNo:flight,flightDate,bookingDate,
    departureDate,departureTime,departureIsActual:/ACTUAL|ATD|DEPARTED/i.test(combined),
    arrivalDate,arrivalTime,arrivalIsActual:actualArrival,
    status,
    officialTracker:'https://www.maskargo.com/en/shipment-tracking.html',
    source:'Tracking One guest air-cargo tracking (MASkargo fallback)'
  };
}
function parseText(text,mawb){
  const t=clean(text),full=digits(mawb),serial=full.slice(3);
  if(!t||(!digits(t).includes(full)&&!digits(t).includes(serial)))return null;
  const pick=rx=>clean((t.match(rx)||[])[1]||'');
  let origin=airport(pick(/\bOrigin\b\s*[:\-]?\s*([A-Z]{3})\b/i));
  let destination=airport(pick(/\bDestination\b\s*[:\-]?\s*([A-Z]{3})\b/i));
  const route=t.match(/\b([A-Z]{3})\s*(?:-|→|>|TO)\s*([A-Z]{3})\b/i);
  if(route){origin=origin||route[1].toUpperCase();destination=destination||route[2].toUpperCase();}
  const pieces=numeric(pick(/\b(?:Pieces?|PCS|Packages?)\b\s*[:\-]?\s*(\d{1,6})/i));
  const weight=numeric(pick(/\b(?:Gross\s*)?Weight\b\s*[:\-]?\s*([\d,.]+)/i));
  const flight=flightNo(t);
  const bookingDate=dateISO((t.match(/.{0,100}\bBooked\b.{0,140}/i)||[])[0]||'');
  const dep=(t.match(/.{0,120}(?:Departed|Departure|ATD).{0,180}/i)||[])[0]||'';
  const arr=(t.match(/.{0,120}(?:Arrived|Arrival|Landed|ATA).{0,180}/i)||[])[0]||'';
  const departureDate=dateISO(dep),departureTime=time24(dep),arrivalDate=dateISO(arr),arrivalTime=time24(arr);
  const status=statusFrom(t);
  const useful=Boolean((origin&&destination)||pieces||weight||flight||arrivalDate||bookingDate||status!=='TRACKING');
  if(!useful)return null;
  return{mawb,carrierCode:'MH',airlineName:'Malaysia Airlines Cargo / MASkargo',origin,destination,pieces,bags:pieces,weight,flightNo:flight,bookingDate,departureDate,departureTime,departureIsActual:/ATD|DEPARTED/i.test(dep),arrivalDate,arrivalTime,arrivalIsActual:/ATA|ARRIVED|LANDED/i.test(arr),status,officialTracker:'https://www.maskargo.com/en/shipment-tracking.html',source:'Tracking One guest air-cargo tracking (MASkargo fallback)'};
}
async function directGuest(mawb){
  const url=`${GUEST_API}?number=${encodeURIComponent(mawb)}&routePath=true`;
  let last={ok:false,reason:'TRACKING ONE DIRECT REQUEST FAILED',officialTracker:PAGE};
  for(let attempt=1;attempt<=3;attempt++){
    try{
      const res=await fetch(url,{
        method:'GET',
        headers:{accept:'application/json,text/plain,*/*','user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36'},
        cache:'no-store',
        signal:AbortSignal.timeout(15000)
      });
      const body=await res.text();
      console.log('tracking_one_direct_json',mawb,res.status,clean(body).slice(0,28000));
      if(res.ok&&body){
        try{
          const obj=JSON.parse(body);
          const shipment=parseObject(obj,mawb);
          if(shipment)return{ok:true,shipment,officialTracker:PAGE,debug:{stage:'TRACKING_ONE_DIRECT_JSON',url,status:res.status}};
          last={ok:false,reason:'TRACKING ONE DIRECT JSON WAS NOT PARSEABLE',officialTracker:PAGE,debug:{stage:'TRACKING_ONE_DIRECT_UNMAPPED',url,status:res.status,bodySample:clean(body).slice(0,12000)}};
        }catch(e){
          last={ok:false,reason:`TRACKING ONE DIRECT JSON PARSE ERROR: ${e?.message||e}`,officialTracker:PAGE,debug:{stage:'TRACKING_ONE_DIRECT_BAD_JSON',url,status:res.status,bodySample:clean(body).slice(0,4000)}};
        }
      }else{
        last={ok:false,reason:`TRACKING ONE DIRECT HTTP ${res.status}`,officialTracker:PAGE,debug:{stage:'TRACKING_ONE_DIRECT_HTTP',url,status:res.status,bodySample:clean(body).slice(0,4000)}};
      }
    }catch(e){
      last={ok:false,reason:`TRACKING ONE DIRECT ERROR: ${e?.message||e}`,officialTracker:PAGE,debug:{stage:'TRACKING_ONE_DIRECT_ERROR',url,attempt}};
    }
    if(attempt<3)await sleep(300*attempt);
  }
  return last;
}
async function launch(){
  chromium.setGraphicsMode=false;
  return puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox','--disable-blink-features=AutomationControlled'],defaultViewport:{width:1440,height:1100},executablePath:await chromium.executablePath(),headless:'shell'});
}
export async function trackMalaysiaTrackingOne(input){
  const mawb=normalizeMawb(input);
  if(!mawb||!mawb.startsWith('232-'))return{ok:false,reason:'INVALID MALAYSIA MAWB',officialTracker:PAGE};
  const direct=await directGuest(mawb);
  if(direct?.ok)return direct;
  let browser;const captures=[];
  try{
    browser=await launch();const page=await browser.newPage();
    const requestTrace=[];
    page.on('request',request=>{try{const u=request.url();if(/api|track|shipment|airway|awb|cargo/i.test(u)){requestTrace.push({url:u,method:request.method(),postData:request.postData()||''});if(requestTrace.length>80)requestTrace.shift();}}catch{}});
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36');
    page.on('response',async response=>{try{
      const ct=(response.headers()['content-type']||'').toLowerCase(),u=response.url();
      if(!/json/.test(ct)&&!/track|air|shipment|awb/i.test(u))return;
      const body=await response.text();if(!body)return;
      if(body.includes(digits(mawb))||body.includes(digits(mawb).slice(3))||/(origin|destination|status|milestone|flight|awb)/i.test(body)){
        captures.push({url:u,status:response.status(),body:body.slice(0,200000)});
        if(captures.length>30)captures.shift();
      }
    }catch{}});
    await page.goto(PAGE,{waitUntil:'domcontentloaded',timeout:30000});
    await sleep(1800);
    const fill=await page.evaluate(({awb})=>{
      const visible=e=>{try{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>20&&r.height>12&&!e.disabled}catch{return false}};
      const inputs=[...document.querySelectorAll('input')].filter(visible);
      const input=inputs.find(e=>/awb|air waybill/i.test(`${e.placeholder||''} ${e.name||''} ${e.id||''} ${e.getAttribute('aria-label')||''}`))||inputs[0];
      if(!input)return{ok:false,stage:'INPUT_NOT_FOUND',inputs:inputs.map(e=>({placeholder:e.placeholder||'',name:e.name||'',id:e.id||''})).slice(0,20)};
      const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
      setter?.call(input,awb);if(!setter)input.value=awb;
      input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
      const els=[...document.querySelectorAll('button,[role="button"],input[type="submit"],a')].filter(visible);
      const txt=e=>String(e.innerText||e.textContent||e.value||'').replace(/\s+/g,' ').trim();
      const btn=els.find(e=>/track shipment|track cargo|^track$/i.test(txt(e)))||els.find(e=>/track/i.test(txt(e)));
      if(!btn)return{ok:false,stage:'BUTTON_NOT_FOUND',buttons:els.map(txt).filter(Boolean).slice(0,30)};
      btn.click();return{ok:true,button:txt(btn),value:input.value||''};
    },{awb:mawb});
    console.log('tracking_one_malaysia_fill',mawb,JSON.stringify(fill));
    if(!fill?.ok)return{ok:false,reason:'TRACKING ONE FORM NOT READY',officialTracker:PAGE,debug:{fill,requestTrace}};
    await Promise.race([page.waitForNetworkIdle({idleTime:900,timeout:15000}).catch(()=>{}),sleep(10000)]);
    await sleep(1200);
    for(const c of [...captures].reverse()){
      try{const obj=JSON.parse(c.body);const shipment=parseObject(obj,mawb);if(shipment){console.log('tracking_one_malaysia_json',mawb,c.url,clean(c.body).slice(0,24000));return{ok:true,shipment,officialTracker:PAGE,debug:{stage:'TRACKING_ONE_JSON',url:c.url,status:c.status}}}}catch{}
    }
    const text=await page.evaluate(()=>document.body?.innerText||'');
    const shipment=parseText(text,mawb);
    if(shipment)return{ok:true,shipment,officialTracker:PAGE,debug:{stage:'TRACKING_ONE_DOM',url:page.url()}};
    console.log('tracking_one_malaysia_trace',mawb,JSON.stringify({resultUrl:page.url(),requestTrace,captures:captures.map(c=>({url:c.url,status:c.status,sample:clean(c.body).slice(0,1800)})).slice(-12),textSample:clean(text).slice(0,2200)}).slice(0,16000));
    return{ok:false,reason:'TRACKING ONE RETURNED NO PARSEABLE MALAYSIA DATA',officialTracker:PAGE,debug:{fill,resultUrl:page.url(),requestTrace,captures:captures.map(c=>({url:c.url,status:c.status,sample:clean(c.body).slice(0,2500)})).slice(-12),textSample:clean(text).slice(0,8000)}};
  }catch(e){return{ok:false,reason:`TRACKING ONE MALAYSIA ERROR: ${e?.message||e}`,officialTracker:PAGE,debug:{direct:direct?.debug||null,directReason:direct?.reason||'',captures:captures.map(c=>({url:c.url,status:c.status,sample:clean(c.body).slice(0,1200)})).slice(-8)}}}
  finally{try{if(browser)await browser.close()}catch{}}
}
