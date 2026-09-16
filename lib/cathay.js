import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { normalizeMawb } from './airlines.js';

const TERMINAL='https://www.cathaycargoterminal.com/en-us/Shipment-Tracking';
const CATHAY='https://www.cathaycargo.com/en-us/track-and-trace.html';
const FLIGHT_STATUS='https://api.cathaypacific.com/flightinformation/flight-status/olss-flight-status/v5.0/flightStatusByFlightNumber';
const AIRLINE={name:'Cathay Cargo',iata:'CX',url:CATHAY};
const MONTH={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',SEPT:'09',OCT:'10',NOV:'11',DEC:'12'};
const pad=v=>String(v).padStart(2,'0');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function parseCathayDate(value=''){
  const m=String(value||'').toUpperCase().match(/(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[A-Z]*\s+(20\d{2})(?:\s+(\d{1,2}):(\d{2}))?/);
  if(!m)return{date:'',time:''};
  return{date:`${m[3]}-${MONTH[m[2]]}-${pad(m[1])}`,time:m[4]?`${pad(m[4])}:${m[5]}`:''};
}
function parseShortCathayDate(value='',fallbackYear=''){
  const m=String(value||'').toUpperCase().match(/(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[A-Z]*(?:\s+(20\d{2}))?\s+(\d{1,2}):(\d{2})/);
  if(!m)return{date:'',time:''};
  const year=m[3]||fallbackYear||String(new Date().getUTCFullYear());
  return{date:`${year}-${MONTH[m[2]]}-${pad(m[1])}`,time:`${pad(m[4])}:${m[5]}`};
}
function splitApiDateTime(value=''){
  const m=String(value||'').match(/^(20\d{2})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})(?::\d{2})?/);
  return m?{date:`${m[1]}-${m[2]}-${m[3]}`,time:`${pad(m[4])}:${m[5]}`}:{date:'',time:''};
}
function stripHtml(html=''){
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi,' ')
    .replace(/<style[\s\S]*?<\/style>/gi,' ')
    .replace(/<br\s*\/?\s*>/gi,' ')
    .replace(/<[^>]+>/g,' ')
    .replace(/&nbsp;|&#160;/gi,' ')
    .replace(/&amp;/gi,'&')
    .replace(/\s+/g,' ')
    .trim();
}
function block(text,start,end){
  const s=text.search(start);if(s<0)return'';
  const tail=text.slice(s);const e=tail.search(end);return e>0?tail.slice(0,e):tail;
}
function parseFlightSegments(text=''){
  const out=[];
  const rx=/\b(CX\s*\d{1,4})\s+(\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[A-Z]*\s+20\d{2})\s+(\d{1,2}:\d{2})\s*\(STD\)\s*(\d{1,6})?\s*([\d,.]+)?/gi;
  const matches=[...text.matchAll(rx)];
  for(let i=0;i<matches.length;i++){
    const m=matches[i],from=m.index||0,to=i+1<matches.length?(matches[i+1].index||text.length):text.length,segment=text.slice(from,to);
    const atd=segment.match(/(\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[A-Z]*\s+20\d{2})\s+(\d{1,2}:\d{2})\s*\(ATD\)/i);
    const sched=parseCathayDate(`${m[2]} ${m[3]}`),actual=atd?parseCathayDate(`${atd[1]} ${atd[2]}`):{date:'',time:''};
    out.push({flightNo:m[1].replace(/\s+/g,'').toUpperCase(),date:sched.date,scheduledTime:sched.time,actualDepartureDate:actual.date,actualDepartureTime:actual.time,pieces:m[4]||'',weight:(m[5]||'').replace(/,/g,'')});
  }
  return out;
}
function parseRcfFlights(text=''){
  const out=[];
  const rcf=block(text,/Received from Flight/i,/Cargo Delivered|Last Update|$/i);
  for(const m of rcf.matchAll(/\b(CX\s*\d{1,4})\s+(\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[A-Z]*\s+20\d{2})\s+(\d{1,6})\s+([\d,.]+)/gi)){
    const d=parseCathayDate(m[2]);out.push({flightNo:m[1].replace(/\s+/g,'').toUpperCase(),date:d.date,scheduledTime:'',actualDepartureDate:'',actualDepartureTime:'',pieces:m[3]||'',weight:(m[4]||'').replace(/,/g,'')});
  }
  return out;
}
function parseTerminal(html='',mawb=''){
  const text=stripHtml(html),digits=mawb.replace(/\D/g,''),serial=digits.slice(3);
  if((!text.includes(digits)&&!text.includes(`160-${serial}`)&&!text.includes(serial))||/Reject Reason|is not found|no record/i.test(text))return null;
  const route=text.match(/\b(?:Export|Import)\s+([A-Z]{3})\s+([A-Z]{3})\b/i)||text.match(/AWB Type[\s\S]{0,140}?\b(?:Export|Import)\s+([A-Z]{3})\s+([A-Z]{3})\b/i)||text.match(/Origin\s+Destination[\s\S]{0,140}?\b([A-Z]{3})\s+([A-Z]{3})\b/i);
  const rcsBlock=block(text,/Received from Shipper/i,/Departure Flight|Received from Flight|Cargo Delivered|Last Update|$/i);
  const rcsRows=[...rcsBlock.matchAll(/(\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[A-Z]*\s+20\d{2}\s+\d{1,2}:\d{2})\s+(\d{1,6})\s+([\d,.]+)/gi)];
  const firstRcs=rcsRows[0],lastRcs=rcsRows.at(-1),booking=firstRcs?parseCathayDate(firstRcs[1]):{date:'',time:''};
  const depBlock=block(text,/Departure Flight/i,/Received from Flight|Cargo Delivered|Last Update|$/i);
  let flights=parseFlightSegments(depBlock);if(!flights.length)flights=parseRcfFlights(text);
  const selected=flights.at(-1)||null;
  const pieces=selected?.pieces||lastRcs?.[2]||'',weight=(selected?.weight||lastRcs?.[3]||'').replace(/,/g,'');
  return{
    text,shipment:{mawb,carrierCode:'CX',airlineName:'Cathay Cargo',origin:route?.[1]?.toUpperCase()||'',destination:route?.[2]?.toUpperCase()||'',bags:pieces,pieces,weight,bookingDate:booking.date,flightNo:selected?.flightNo||'',departureDate:selected?.actualDepartureDate||selected?.date||'',departureTime:selected?.actualDepartureTime||selected?.scheduledTime||'',arrivalDate:'',arrivalTime:'',arrivalIsActual:false,status:/Cargo Delivered/i.test(text)?'DELIVERED':selected?.actualDepartureTime?'IN TRANSIT':booking.date?'BOOKED':'TRACKING',officialTracker:CATHAY,source:'Cathay Cargo Terminal official tracking'},
    flights,delivered:/Cargo Delivered/i.test(text)
  };
}
async function fetchTerminal(mawb){
  const suffix=mawb.replace(/\D/g,'').slice(3),urls=[`${TERMINAL}/AWBPrefix/160/AWBSuffix/${suffix}`,`${TERMINAL}?AWBPrefix=160&AWBSuffix=${suffix}`];
  for(const url of urls){
    try{
      const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0','accept':'text/html,application/xhtml+xml'},redirect:'follow',cache:'no-store',signal:AbortSignal.timeout(12000)});
      if(!r.ok)continue;const parsed=parseTerminal(await r.text(),mawb);if(parsed)return{...parsed,url};
    }catch{}
  }
  return null;
}
async function fetchFlightStatus(flightNo,date){
  const number=String(flightNo||'').replace(/\D/g,'');if(!number||!date)return null;
  try{
    const r=await fetch(FLIGHT_STATUS,{method:'POST',headers:{
      'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36',
      'accept':'application/json, text/plain, */*','content-type':'application/json;charset=UTF-8',
      'origin':'https://www.cathaypacific.com','referer':'https://www.cathaypacific.com/'
    },body:JSON.stringify({travelDate:date,carrierCode:'CX',flightNumber:number,locale:'en_US',departureArrival:'D'}),cache:'no-store',signal:AbortSignal.timeout(12000)});
    if(!r.ok)return null;const data=await r.json().catch(()=>null);if(!data?.result?.length)return null;
    const flight=data.result.find(x=>String(x?.operatingFlight?.carrierCode||'').toUpperCase()==='CX'&&String(x?.operatingFlight?.flightNumber||'').replace(/^0+/,'')===number.replace(/^0+/,''))||data.result[0];
    const sectors=Array.isArray(flight?.sectors)?flight.sectors:[];return{data,flight,sectors};
  }catch{return null;}
}
function rankSector(sector,origin,destination){
  let score=0;if(origin&&sector?.origin===origin)score+=4;if(destination&&sector?.destination===destination)score+=8;if(sector?.arrivalActual)score+=6;else if(sector?.arrivalEstimated)score+=3;if(sector?.departActual)score+=2;return score;
}
async function enrichWithOfficialFlight(base,flights=[]){
  const candidates=[];
  for(const f of flights.slice(-4)){
    const status=await fetchFlightStatus(f.flightNo,f.date);if(!status)continue;
    for(const sector of status.sectors)candidates.push({f,sector,score:rankSector(sector,base.origin,base.destination)});
  }
  if(!candidates.length)return{shipment:base,flightStatus:null};
  candidates.sort((a,b)=>b.score-a.score);const chosen=candidates[0],s=chosen.sector;
  const actual=splitApiDateTime(s.arrivalActual),estimated=splitApiDateTime(s.arrivalEstimated),scheduled=splitApiDateTime(s.arrivalScheduled),arrival=actual.date?actual:estimated.date?estimated:scheduled;
  const depActual=splitApiDateTime(s.departActual),depEstimated=splitApiDateTime(s.departEstimated),depScheduled=splitApiDateTime(s.departScheduled),departure=depActual.date?depActual:depEstimated.date?depEstimated:depScheduled;
  const flightStatus=String(s.flightStatus||'').toUpperCase();
  let status=base.status;
  if(base.status!=='DELIVERED'){
    if(actual.date||/ARRIVED|LANDED/.test(flightStatus))status='ARRIVED';
    else if(depActual.date||/DEPART|AIRBORNE|IN.?FLIGHT/.test(flightStatus))status='IN TRANSIT';
    else if(/DELAY/.test(flightStatus))status='DELAYED';
    else if(/CANCEL/.test(flightStatus))status='CANCELLED';
  }
  return{shipment:{...base,origin:base.origin||s.origin||'',destination:base.destination||s.destination||'',flightNo:chosen.f.flightNo||base.flightNo,departureDate:departure.date||base.departureDate||'',departureTime:departure.time||base.departureTime||'',arrivalDate:arrival.date||base.arrivalDate||'',arrivalTime:arrival.time||base.arrivalTime||'',arrivalIsActual:Boolean(actual.date&&actual.time),status,source:'Cathay Cargo Terminal + Cathay Pacific official flight status',arrivalTimeSource:actual.date?'Cathay Pacific actual arrival':estimated.date?'Cathay Pacific estimated arrival':'Cathay Pacific scheduled arrival'},flightStatus:{flightNo:chosen.f.flightNo,travelDate:chosen.f.date,origin:s.origin||'',destination:s.destination||'',flightStatus:s.flightStatus||'',departActual:s.departActual||'',arrivalEstimated:s.arrivalEstimated||'',arrivalActual:s.arrivalActual||''}};
}

async function launchCathayBrowser(){
  chromium.setGraphicsMode=false;
  const executablePath=await chromium.executablePath();
  return puppeteer.launch({
    args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox','--disable-blink-features=AutomationControlled','--lang=en-US,en'],
    defaultViewport:{width:1440,height:1100,deviceScaleFactor:1},
    executablePath,
    headless:'shell'
  });
}
async function deepPageText(page){
  let out='';
  for(const frame of page.frames()){
    try{
      out+='\n'+await frame.evaluate(()=>{
        const parts=[document.body?.innerText||''];
        for(const el of document.querySelectorAll('*')){
          try{if(el.shadowRoot){const t=el.shadowRoot.innerText||el.shadowRoot.textContent||'';if(t)parts.push(t);}}catch{}
        }
        return parts.join('\n');
      });
    }catch{}
  }
  return out;
}
async function clickTextDeep(page,patternSource){
  return page.evaluate(patternSource=>{
    const rx=new RegExp(patternSource,'i');
    const visible=el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>10&&r.height>8&&!el.disabled;};
    const roots=[document];for(const el of document.querySelectorAll('*'))if(el.shadowRoot)roots.push(el.shadowRoot);
    for(const root of roots){
      const nodes=[...root.querySelectorAll('button,[role="button"],a,input[type="button"],input[type="submit"]')];
      const hit=nodes.find(el=>visible(el)&&rx.test((el.innerText||el.value||el.textContent||el.getAttribute('aria-label')||el.getAttribute('title')||'').trim()));
      if(hit){hit.click();return true;}
    }
    return false;
  },patternSource).catch(()=>false);
}
async function fillCathayField(page,kind,value){
  return page.evaluate(({kind,value})=>{
    const visible=el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>12&&r.height>8&&!el.disabled;};
    const roots=[document];for(const el of document.querySelectorAll('*'))if(el.shadowRoot)roots.push(el.shadowRoot);
    const all=[];for(const root of roots)all.push(...root.querySelectorAll('input,textarea,[contenteditable="true"],[role="textbox"]'));
    const candidates=all.filter(visible);
    const meta=el=>`${el.id||''} ${el.name||''} ${el.placeholder||''} ${el.getAttribute('aria-label')||''}`;
    let el=null;
    if(kind==='prefix')el=candidates.find(x=>/airline\s*code|carrier\s*code|awb\s*prefix|prefix/i.test(meta(x))||String(x.placeholder||'').trim()==='160');
    else el=candidates.find(x=>/air\s*waybill|airway\s*bill|airwaybill|\bawb\b|waybill/i.test(meta(x))&&!/airline\s*code|prefix/i.test(meta(x)))||candidates.find(x=>String(x.maxLength||'')==='8');
    if(!el)return{ok:false,found:candidates.map(x=>meta(x)).slice(0,12)};
    el.focus();
    const ce=el.getAttribute('contenteditable')==='true'||el.getAttribute('role')==='textbox';
    if(ce){el.textContent=String(value);el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:String(value)}));}
    else{
      const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
      const setter=Object.getOwnPropertyDescriptor(proto,'value')?.set;
      if(setter)setter.call(el,String(value));else el.value=String(value);
      el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:String(value)}));
    }
    el.dispatchEvent(new Event('change',{bubbles:true}));
    el.dispatchEvent(new Event('blur',{bubbles:true}));
    if(kind==='awb')for(const type of ['keydown','keypress','keyup'])el.dispatchEvent(new KeyboardEvent(type,{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true,cancelable:true}));
    return{ok:true,value:ce?el.textContent:el.value,meta:meta(el)};
  },{kind,value}).catch(()=>({ok:false}));
}
function parseBrowserTimeline(text='',mawb='',base={}){
  const flat=String(text||'').replace(/\s+/g,' ').trim();
  if(!/Current\s+status\s*:/i.test(flat)&&!/\b[A-Z]{3}\s+(?:Accepted|Departed|Arrived)\b/i.test(flat))return null;
  const milestones=[...flat.matchAll(/\b([A-Z]{3})\s+(Accepted|Departed|Arrived)\b/gi)].map(m=>({airport:m[1].toUpperCase(),event:m[2].toUpperCase()}));
  const origin=(milestones.find(x=>x.event==='DEPARTED')||milestones.find(x=>x.event==='ACCEPTED'))?.airport||'';
  const destination=[...milestones].reverse().find(x=>x.event==='ARRIVED')?.airport||'';
  const fallbackYear=String(base.departureDate||base.bookingDate||'').slice(0,4)||String(new Date().getUTCFullYear());
  const cardRx=/\b(CX\s*\d{2,4})\b[\s\S]{0,220}?(\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[A-Z]*(?:\s+20\d{2})?\s+\d{1,2}:\d{2})[\s\S]{0,180}?(\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[A-Z]*(?:\s+20\d{2})?\s+\d{1,2}:\d{2})/gi;
  const cards=[...flat.matchAll(cardRx)],card=cards.at(-1);
  const departure=card?parseShortCathayDate(card[2],fallbackYear):{date:'',time:''};
  const arrival=card?parseShortCathayDate(card[3],fallbackYear):{date:'',time:''};
  const summary=flat.match(/\b(\d{1,5})\s*pc\(s\)\s*[|｜]\s*([\d,.]+)\s*kg\b/i)||flat.match(/\b(\d{1,5})\s*(?:pcs?|pieces?)\b[\s\S]{0,35}?\b([\d,.]+)\s*kg\b/i);
  const pieces=summary?.[1]||'',weight=(summary?.[2]||'').replace(/,/g,'');
  const flightNo=(card?.[1]||flat.match(/\bCX\s*\d{2,4}\b/i)?.[0]||'').replace(/\s+/g,'').toUpperCase();
  const arrivedAtDestination=Boolean(destination&&milestones.some(x=>x.airport===destination&&x.event==='ARRIVED'));
  const delivered=/Current\s+status\s*:\s*Delivered/i.test(flat)||/\bDelivered\b[\s\S]{0,30}?\b(\d+)\s*\/\s*\1\b/i.test(flat);
  const status=delivered?'DELIVERED':arrivedAtDestination?'ARRIVED':milestones.some(x=>x.event==='DEPARTED')?'IN TRANSIT':milestones.some(x=>x.event==='ACCEPTED')?'BOOKED':'TRACKING';
  return{mawb,carrierCode:'CX',airlineName:'Cathay Cargo',origin,destination,bags:pieces,pieces,weight,flightNo,departureDate:departure.date,departureTime:departure.time,arrivalDate:arrival.date,arrivalTime:arrival.time,arrivalIsActual:Boolean(arrivedAtDestination&&arrival.date&&arrival.time),status,officialTracker:CATHAY,source:'Cathay Cargo official Track & Trace browser fallback',arrivalTimeSource:'Cathay flight card right-side arrival time'};
}
async function browserFallback(mawb,base={}){
  const serial=mawb.replace(/\D/g,'').slice(3);let browser;
  try{
    browser=await launchCathayBrowser();
    const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({'Accept-Language':'en-US,en;q=0.9'});
    await page.goto(CATHAY,{waitUntil:'domcontentloaded',timeout:25000});
    await sleep(1800);
    await clickTextDeep(page,'^(accept all|accept cookies|allow all|agree)$');
    await sleep(500);
    const prefixEntry=await fillCathayField(page,'prefix','160');
    await sleep(450);
    const awbEntry=await fillCathayField(page,'awb',serial);
    await sleep(600);
    const clicked=await clickTextDeep(page,'^track\\s*(now)?$');
    let text='';
    for(let i=0;i<45;i++){
      text=await deepPageText(page);
      if(/Current\s+status\s*:/i.test(text)&&(/\bCX\s*\d{2,4}\b/i.test(text)||text.replace(/\D/g,'').includes(serial)))break;
      await sleep(500);
    }
    await clickTextDeep(page,'^(show all details|show details|view details|expand)$');
    for(let i=0;i<10;i++){
      await page.evaluate(y=>window.scrollTo(0,y),i*500).catch(()=>{});
      await sleep(250);
    }
    text=await deepPageText(page);
    const shipment=parseBrowserTimeline(text,mawb,base);
    return shipment?{ok:true,shipment,debug:{prefixEntry,awbEntry,clicked,sample:text.slice(0,3000)}}:{ok:false,reason:'CATHAY BROWSER RESULT NOT PARSED',debug:{prefixEntry,awbEntry,clicked,sample:text.slice(0,3000)}};
  }catch(e){return{ok:false,reason:e?.message||String(e)};}
  finally{try{if(browser)await browser.close();}catch{}}
}
function needsBrowserFallback(s={}){
  return !s.origin||!s.destination||!s.flightNo||!s.arrivalDate||!s.arrivalTime||(!s.arrivalIsActual&&s.status!=='DELIVERED');
}
function mergeBrowserFallback(base={},live={}){
  const out={...base};
  if(!out.origin&&live.origin)out.origin=live.origin;
  if(!out.destination&&live.destination)out.destination=live.destination;
  if(!out.bags&&live.bags)out.bags=live.bags;
  if(!out.pieces&&live.pieces)out.pieces=live.pieces;
  if(!out.weight&&live.weight)out.weight=live.weight;
  if(live.flightNo)out.flightNo=live.flightNo;
  if(live.departureDate)out.departureDate=live.departureDate;
  if(live.departureTime)out.departureTime=live.departureTime;
  if(live.arrivalIsActual){
    if(live.arrivalDate)out.arrivalDate=live.arrivalDate;
    if(live.arrivalTime)out.arrivalTime=live.arrivalTime;
    out.arrivalIsActual=true;
    out.status=live.status||'ARRIVED';
    out.arrivalTimeSource=live.arrivalTimeSource;
  }else{
    if(!out.arrivalDate&&live.arrivalDate)out.arrivalDate=live.arrivalDate;
    if(!out.arrivalTime&&live.arrivalTime)out.arrivalTime=live.arrivalTime;
    if((!out.status||out.status==='TRACKING')&&live.status)out.status=live.status;
  }
  if(live.status==='DELIVERED')out.status='DELIVERED';
  out.source=live.arrivalIsActual?'Cathay Cargo official Track & Trace browser fallback + existing Cathay parser':out.source;
  return out;
}

export async function trackCathay(input){
  const mawb=normalizeMawb(input);if(!mawb||!mawb.startsWith('160-'))return{ok:false,reason:'INVALID CATHAY MAWB',airline:AIRLINE};
  const terminal=await fetchTerminal(mawb);
  if(!terminal){
    const browser=await browserFallback(mawb,{});
    if(browser.ok)return{ok:true,airline:AIRLINE,shipment:browser.shipment,debug:{source:'cathay-browser-only-fallback',browser:browser.debug}};
    return{ok:false,airline:AIRLINE,reason:'CATHAY TERMINAL DATA NOT EXTRACTED',debug:{browser:browser.debug||browser.reason}};
  }
  const enriched=await enrichWithOfficialFlight(terminal.shipment,terminal.flights);
  let shipment=enriched.shipment,browser=null;
  if(needsBrowserFallback(shipment)){
    browser=await browserFallback(mawb,shipment);
    if(browser.ok)shipment=mergeBrowserFallback(shipment,browser.shipment);
  }
  return{ok:true,airline:AIRLINE,shipment,debug:{source:browser?.ok?'cathay-existing-plus-browser-fallback':'cathay-terminal-plus-official-flight-status',terminalUrl:terminal.url,terminalFlights:terminal.flights,flightStatus:enriched.flightStatus,browser:browser?.debug||browser?.reason||null}};
}
