import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const CATHAY='https://www.cathaycargo.com/en-us/track-and-trace.html';
const PLANE_FINDER='https://planefinder.net/data/flight';
const MONTH={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',SEPT:'09',OCT:'10',NOV:'11',DEC:'12'};
const MONTH_NAME={'01':'Jan','02':'Feb','03':'Mar','04':'Apr','05':'May','06':'Jun','07':'Jul','08':'Aug','09':'Sep','10':'Oct','11':'Nov','12':'Dec'};
const pad=v=>String(v).padStart(2,'0');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function parseShortDate(value='',fallbackYear=''){
  const m=String(value||'').toUpperCase().match(/(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[A-Z]*(?:\s+(20\d{2}))?\s+(\d{1,2}):(\d{2})/);
  if(!m)return{date:'',time:''};
  const mon=m[2]==='SEPT'?'SEP':m[2],year=m[3]||fallbackYear||String(new Date().getUTCFullYear());
  return{date:`${year}-${MONTH[mon]}-${pad(m[1])}`,time:`${pad(m[4])}:${m[5]}`};
}
function htmlToText(html=''){
  return String(html||'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<br\s*\/?\s*>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&gt;/gi,'>').replace(/&lt;/gi,'<').replace(/\s+/g,' ').trim();
}
function targetDateLabel(date=''){
  const m=String(date).match(/^(20\d{2})-(\d{2})-(\d{2})$/);if(!m)return'';
  return`${Number(m[3])} ${MONTH_NAME[m[2]]||''} ${m[1]}`.trim();
}
async function launchBrowser(){
  chromium.setGraphicsMode=false;
  const executablePath=await chromium.executablePath();
  return puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox','--disable-blink-features=AutomationControlled','--lang=en-US,en'],defaultViewport:{width:1440,height:1100,deviceScaleFactor:1},executablePath,headless:'shell'});
}
async function deepText(page){
  let out='';
  for(const frame of page.frames()){
    try{
      out+='\n'+await frame.evaluate(()=>{
        const parts=[document.body?.innerText||''];
        const roots=[document],seen=new Set();
        for(let i=0;i<roots.length;i++){
          const root=roots[i];
          for(const el of root.querySelectorAll('*')){
            try{if(el.shadowRoot&&!seen.has(el.shadowRoot)){seen.add(el.shadowRoot);roots.push(el.shadowRoot);const t=el.shadowRoot.innerText||el.shadowRoot.textContent||'';if(t)parts.push(t);}}catch{}
          }
        }
        return parts.join('\n');
      });
    }catch{}
  }
  return out;
}
async function allCathayTabText(browser){
  const parts=[];
  for(const tab of await browser.pages().catch(()=>[])){
    if(tab.isClosed())continue;
    const text=await deepText(tab).catch(()=>'');
    if(text)parts.push(text);
  }
  return parts.join('\n');
}
async function scrollCathayTabs(browser,step){
  for(const tab of await browser.pages().catch(()=>[])){
    if(tab.isClosed())continue;
    for(const frame of tab.frames())await frame.evaluate(y=>window.scrollTo(0,y),step*420).catch(()=>{});
  }
}
async function clickCathayTabText(browser,source){
  for(const tab of await browser.pages().catch(()=>[])){
    if(!tab.isClosed()&&await clickText(tab,source))return true;
  }
  return false;
}
async function clickTextInFrame(frame,source){
  return frame.evaluate(source=>{
    const rx=new RegExp(source,'i');
    const visible=el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>8&&r.height>8&&!el.disabled;};
    const roots=[document],seen=new Set();
    for(let i=0;i<roots.length;i++){
      const root=roots[i];
      const nodes=[...root.querySelectorAll('button,[role="button"],a,input[type="button"],input[type="submit"],[tabindex]')];
      const hit=nodes.find(el=>visible(el)&&rx.test((el.innerText||el.value||el.textContent||el.getAttribute('aria-label')||el.getAttribute('title')||'').trim()));
      if(hit){hit.click();return true;}
      for(const el of root.querySelectorAll('*')){try{if(el.shadowRoot&&!seen.has(el.shadowRoot)){seen.add(el.shadowRoot);roots.push(el.shadowRoot);}}catch{}}
    }
    return false;
  },source).catch(()=>false);
}
async function clickText(page,source){for(const frame of page.frames())if(await clickTextInFrame(frame,source))return true;return false;}
async function clickViewFlight(page){
  if(await clickText(page,'^view\s+flight$'))return true;
  for(const frame of page.frames()){
    const ok=await frame.evaluate(()=>{
      const visible=el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>8&&r.height>8;};
      const nodes=[...document.querySelectorAll('*')].filter(visible);
      const label=nodes.find(el=>/^view\s+flight$/i.test((el.innerText||el.textContent||'').trim()));
      if(!label)return false;
      const clickable=label.closest('button,a,[role="button"],[tabindex]')||label.parentElement;
      if(clickable){clickable.click();return true;}return false;
    }).catch(()=>false);
    if(ok)return true;
  }
  return false;
}
async function fillFieldInFrame(frame,kind,value){
  return frame.evaluate(({kind,value})=>{
    const visible=el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>8&&r.height>8&&!el.disabled;};
    const roots=[document],seen=new Set(),all=[];
    for(let i=0;i<roots.length;i++){
      const root=roots[i];all.push(...root.querySelectorAll('input,textarea,[contenteditable="true"],[role="textbox"]'));
      for(const node of root.querySelectorAll('*')){try{if(node.shadowRoot&&!seen.has(node.shadowRoot)){seen.add(node.shadowRoot);roots.push(node.shadowRoot);}}catch{}}
    }
    const candidates=all.filter(visible),meta=el=>`${el.id||''} ${el.name||''} ${el.placeholder||''} ${el.getAttribute('aria-label')||''} ${el.getAttribute('data-testid')||''}`;
    const prefixEl=candidates.find(x=>/airline\s*code|carrier\s*code|awb\s*prefix|prefix/i.test(meta(x))||String(x.placeholder||'').trim()==='160')||null;
    let el=null;
    if(kind==='prefix')el=prefixEl;
    else{
      const textLike=x=>!['hidden','checkbox','radio','submit','button','reset','file'].includes(String(x.type||'text').toLowerCase());
      el=candidates.find(x=>x!==prefixEl&&/air\s*waybill|airway\s*bill|airwaybill|\bawb\b|waybill/i.test(meta(x))&&!/airline\s*code|prefix/i.test(meta(x)))||candidates.find(x=>x!==prefixEl&&String(x.maxLength||'')==='8')||candidates.find(x=>x!==prefixEl&&textLike(x));
    }
    if(!el)return{ok:false,found:candidates.map(x=>({meta:meta(x),type:x.type||'',maxLength:x.maxLength||0,tag:x.tagName})).slice(0,20)};
    el.focus();
    const ce=el.getAttribute('contenteditable')==='true'||el.getAttribute('role')==='textbox';
    if(ce){el.textContent=String(value);el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:String(value)}));}
    else{const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;const setter=Object.getOwnPropertyDescriptor(proto,'value')?.set;if(setter)setter.call(el,String(value));else el.value=String(value);el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:String(value)}));}
    el.dispatchEvent(new Event('change',{bubbles:true}));
    return{ok:true,value:ce?el.textContent:el.value,meta:meta(el),tag:el.tagName,type:el.type||''};
  },{kind,value}).catch(error=>({ok:false,error:error?.message||String(error)}));
}
async function fillField(page,kind,value){
  const attempts=[];
  for(const frame of page.frames()){
    const result=await fillFieldInFrame(frame,kind,value);
    if(result?.ok)return{...result,frameUrl:frame.url()};
    attempts.push({frameUrl:frame.url(),result});
  }
  return{ok:false,attempts:attempts.slice(0,8)};
}
function istFromHkgLocal(date='',time=''){
  const m=String(date).match(/^(20\d{2})-(\d{2})-(\d{2})$/);
  const t=String(time).match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if(!m||!t)return{date,time};
  // Cathay "Local": HKG is UTC+08:00, while all Mayavi times are IST (+05:30).
  const instant=Date.UTC(+m[1],+m[2]-1,+m[3],+t[1],+t[2])-150*60000;
  const z=new Date(instant);
  return{date:z.toISOString().slice(0,10),time:z.toISOString().slice(11,16)};
}
function cathayAwbInText(flat='',mawb=''){
  const digits=String(mawb||'').replace(/\D/g,'');
  if(!/^160\d{8}$/.test(digits))return false;
  // Only trust the page for this exact AWB; not the generic empty site shell.
  // Cathay may format the serial 18863806 as 1886 3806.
  const groupedSerial=digits.slice(3).split('').join('\\s*');
  return new RegExp('\\b160\\s*[-–]?\\s*'+groupedSerial+'\\b').test(flat);
}
export function parseCathayBookingOverview(text='',mawb=''){
  const flat=String(text||'').replace(/\s+/g,' ').trim();
  if(!cathayAwbInText(flat,mawb)||!/Current\s+status\s*:\s*Booking\s+Received/i.test(flat))return null;
  const header=flat.slice(Math.max(0,flat.search(/\bAWB\s+160/)),flat.search(/Current\s+status\s*:/i));
  const route=header.match(/\b([A-Z]{3})\s+to\s+([A-Z]{3})\b/i);
  const summary=header.match(/\b(\d{1,5})\s*pc\(s\)\s*(?:[|｜]\s*)?([\d,.]+)\s*kg\b/i);
  if(!route||!summary)return null;
  return {mawb,carrierCode:'CX',airlineName:'Cathay Cargo',
    origin:route[1].toUpperCase(),destination:route[2].toUpperCase(),
    bags:summary[1],pieces:summary[1],weight:summary[2].replace(/,/g,''),
    status:'BOOKED',arrivalIsActual:false,arrivalEstimate:false,
    officialTracker:CATHAY,source:'Cathay Cargo official Booking Received overview'};
}
export function parseCathayBookingStatus(text='',mawb='',base={}){
  const flat=String(text||'').replace(/\\u003c/gi,'<').replace(/\\n/g,' ').replace(/\s+/g,' ').trim();
  if(!cathayAwbInText(flat,mawb)&&!base?.awbVerifiedByOfficialPage)return null;
  const marker=flat.search(/Booking\s+Status/i);if(marker<0)return null;
  const tail=flat.slice(marker),end=tail.search(/Shipment\s+History/i),block=end>0?tail.slice(0,end):tail.slice(0,4000);
  const route=block.match(/\b([A-Z]{3})\s+to\s+([A-Z]{3})\b/i);
  const overview=parseCathayBookingOverview(flat,mawb);
  const origin=(route?.[1]||overview?.origin||base.origin||'').toUpperCase();
  const destination=(route?.[2]||overview?.destination||base.destination||'').toUpperCase();
  const card=block.match(/\b(?:Confirmed\s*\(allotment\)|Confirmed\s+allotment)[\s\S]{0,140}?\b(CX\s*\d{2,4})\s+(\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[A-Z]*\s+20\d{2})\b/i);
  const freshFlight=(card?.[1]||block.match(/\bCX\s*\d{2,4}\b/i)?.[0]||'').replace(/\s+/g,'').toUpperCase();
  const flightDate=card?parseShortDate(card[2]+' 00:00').date:'';
  const fallbackYear=flightDate.slice(0,4)||String(base.departureDate||base.bookingDate||'').slice(0,4)||String(new Date().getUTCFullYear());
  const events=[...block.matchAll(/\b([A-Z]{3})\b\s+(?:Departure\s+|Arrival\s+)?(\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[A-Z]*(?:\s+20\d{2})?\s+\d{1,2}:\d{2})\s+(Actual|Estimated|Scheduled)\b/gi)]
    .map(m=>({airport:m[1].toUpperCase(),dateTime:parseShortDate(m[2],fallbackYear),kind:m[3].toUpperCase()}));
  const pick=(airport,kind)=>events.find(x=>x.airport===airport&&x.kind===kind)?.dateTime||null;
  const localDep=pick(origin,'ACTUAL')||pick(origin,'ESTIMATED')||pick(origin,'SCHEDULED')||{date:'',time:''};
  const dep=origin==='HKG'?istFromHkgLocal(localDep.date,localDep.time):localDep;
  const actualArrival=pick(destination,'ACTUAL');
  const plannedArrival=pick(destination,'ESTIMATED')||pick(destination,'SCHEDULED');
  const arrival=actualArrival||plannedArrival||{date:'',time:''};
  const summary=block.match(/\b(\d{1,5})\s*pc\(s\)\s*[|｜]\s*([\d,.]+)\s*kg\b/i)||
    block.match(/\b(\d{1,5})\s*(?:pcs?|pieces?)\b[\s\S]{0,40}?\b([\d,.]+)\s*kg\b/i);
  const pieces=summary?.[1]||overview?.pieces||'',weight=(summary?.[2]||overview?.weight||'').replace(/,/g,'');
  // This heading is present even when no booking has loaded. Require dated
  // flight evidence from the official AWB-specific booking card.
  if(!freshFlight||!flightDate&&!events.length||!origin||!destination)return null;
  const actual=Boolean(actualArrival?.date&&actualArrival?.time);
  const departed=Boolean(pick(origin,'ACTUAL')?.date);
  const delivered=/Current\s+status\s*:\s*Delivered/i.test(flat);
  return{mawb,carrierCode:'CX',airlineName:'Cathay Cargo',origin,destination,
    bags:pieces,pieces,weight,flightNo:freshFlight,flightDate:flightDate||dep.date,
    departureDate:dep.date||base.departureDate||'',departureTime:dep.time||base.departureTime||'',
    departureTimeZone:'IST',departureLocalTime:localDep.time||'',
    arrivalDate:arrival.date,arrivalTime:arrival.time,arrivalTimeZone:'IST',
    scheduledArrivalDate:plannedArrival?.date||'',
    scheduledArrivalTime:plannedArrival?.time||'',
    scheduledArrivalTimeZone:'IST',
    arrivalIsActual:actual,arrivalEstimate:!actual&&Boolean(arrival.date&&arrival.time),
    status:delivered?'DELIVERED':actual?'ARRIVED':departed?'DEPARTED':'BOOKED',
    officialTracker:CATHAY,
    source:actual?'Cathay Cargo Booking Status actual arrival':
      'Cathay Cargo confirmed allotment; scheduled movements',
    arrivalTimeSource:actual?'Cathay Booking Status destination Actual time':
      arrival.date?'Cathay Booking Status destination Scheduled time (not actual)':''
  };
}
function parseTimeline(text='',mawb='',base={}){
  const flat=String(text||'').replace(/\\u003c/gi,'<').replace(/\\n/g,' ').replace(/\s+/g,' ').trim();
  if(!cathayAwbInText(flat,mawb))return null;
  const booking=parseCathayBookingStatus(flat,mawb,base);if(booking)return booking;
  if(!/Current\s+status\s*:/i.test(flat)&&!/\b[A-Z]{3}\s+(?:Accepted|Departed|Arrived)\b/i.test(flat))return null;
  const milestones=[...flat.matchAll(/\b([A-Z]{3})\s+(Accepted|Departed|Arrived)\b/gi)].map(m=>({airport:m[1].toUpperCase(),event:m[2].toUpperCase()}));
  const origin=(milestones.find(x=>x.event==='DEPARTED')||milestones.find(x=>x.event==='ACCEPTED'))?.airport||base.origin||'';
  const destination=[...milestones].reverse().find(x=>x.event==='ARRIVED')?.airport||base.destination||'';
  const fallbackYear=String(base.departureDate||base.bookingDate||'').slice(0,4)||String(new Date().getUTCFullYear());
  const cardRx=/\b(CX\s*\d{2,4})\b[\s\S]{0,420}?(\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[A-Z]*(?:\s+20\d{2})?\s+\d{1,2}:\d{2})[\s\S]{0,360}?(\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[A-Z]*(?:\s+20\d{2})?\s+\d{1,2}:\d{2})/gi;
  const cards=[...flat.matchAll(cardRx)],card=cards.at(-1);
  const departure=card?parseShortDate(card[2],fallbackYear):{date:'',time:''},arrival=card?parseShortDate(card[3],fallbackYear):{date:'',time:''};
  const summary=flat.match(/\b(\d{1,5})\s*pc\(s\)\s*[|｜]\s*([\d,.]+)\s*kg\b/i)||flat.match(/\b(\d{1,5})\s*(?:pcs?|pieces?)\b[\s\S]{0,45}?\b([\d,.]+)\s*kg\b/i);
  const pieces=summary?.[1]||'',weight=(summary?.[2]||'').replace(/,/g,''),flightNo=(card?.[1]||flat.match(/\bCX\s*\d{2,4}\b/i)?.[0]||base.flightNo||'').replace(/\s+/g,'').toUpperCase();
  const arrived=Boolean(destination&&milestones.some(x=>x.airport===destination&&x.event==='ARRIVED'));
  const delivered=/Current\s+status\s*:\s*Delivered/i.test(flat)||/\bDelivered\b[\s\S]{0,35}?\b(\d+)\s*\/\s*\1\b/i.test(flat);
  const status=delivered?'DELIVERED':arrived?'ARRIVED':milestones.some(x=>x.event==='DEPARTED')?'IN TRANSIT':milestones.some(x=>x.event==='ACCEPTED')?'BOOKED':'TRACKING';
  return{mawb,carrierCode:'CX',airlineName:'Cathay Cargo',origin,destination,bags:pieces,pieces,weight,flightNo,departureDate:departure.date,departureTime:departure.time,arrivalDate:arrival.date,arrivalTime:arrival.time,arrivalIsActual:Boolean(arrived&&arrival.date&&arrival.time),status,officialTracker:CATHAY,source:'Cathay Cargo official Track & Trace browser fallback',arrivalTimeSource:'Cathay flight card right-side arrival time'};
}
async function fetchPlaneFinderActual(mawb,base={}){
  const flightNo=String(base.flightNo||'').replace(/\s+/g,'').toUpperCase(),date=base.departureDate||base.arrivalDate||'';
  if(!/^CX\d{1,4}$/.test(flightNo)||!/^20\d{2}-\d{2}-\d{2}$/.test(date))return null;
  try{
    const r=await fetch(`${PLANE_FINDER}/${flightNo}`,{headers:{'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36','accept':'text/html,application/xhtml+xml','accept-language':'en-US,en;q=0.9'},redirect:'follow',cache:'no-store',signal:AbortSignal.timeout(10000)});
    if(!r.ok)return null;const html=await r.text(),pastIndex=html.search(/Past\s+Flights/i);if(pastIndex<0)return null;
    const past=html.slice(pastIndex),label=targetDateLabel(date);if(!label)return null;
    const rows=[...past.matchAll(/<tr\b[\s\S]*?<\/tr>/gi)].map(m=>htmlToText(m[0]));
    const row=rows.find(x=>new RegExp(`\\b${label.replace(/\s+/g,'\\s+')}\\b`,'i').test(x)&&(!base.origin||new RegExp(`\\b${base.origin}\\b`,'i').test(x))&&(!base.destination||new RegExp(`\\b${base.destination}\\b`,'i').test(x)));
    if(!row)return null;const times=[...row.matchAll(/\b(\d{1,2}:\d{2})\b/g)].map(m=>m[1]);if(times.length<2)return null;
    const arrivalTime=times[1],departureTime=times[0];
    let arrivalDate=date;if(Number(arrivalTime.slice(0,2))<6&&Number(departureTime.slice(0,2))>18){const d=new Date(`${date}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+1);arrivalDate=d.toISOString().slice(0,10);}
    return{mawb,carrierCode:'CX',airlineName:'Cathay Cargo',origin:base.origin||'',destination:base.destination||'',bags:base.bags||'',pieces:base.pieces||'',weight:base.weight||'',flightNo,departureDate:date,departureTime,arrivalDate,arrivalTime,arrivalIsActual:true,status:'ARRIVED',officialTracker:CATHAY,source:'Plane Finder actual flight-history fallback',arrivalTimeSource:'Plane Finder past-flight actual arrival'};
  }catch{return null;}
}

export function needsCathayBrowserFallback(s={}){return !s.origin||!s.destination||!s.flightNo||!s.arrivalDate||!s.arrivalTime||(!s.arrivalIsActual&&s.status!=='DELIVERED');}
export function mergeCathayBrowserFallback(base={},live={}){
  const out={...base};
  if(!out.origin&&live.origin)out.origin=live.origin;if(!out.destination&&live.destination)out.destination=live.destination;
  if(!out.bags&&live.bags)out.bags=live.bags;if(!out.pieces&&live.pieces)out.pieces=live.pieces;if(!out.weight&&live.weight)out.weight=live.weight;
  if(live.flightNo)out.flightNo=live.flightNo;if(live.departureDate)out.departureDate=live.departureDate;if(live.departureTime)out.departureTime=live.departureTime;
  if(live.arrivalIsActual){if(live.arrivalDate)out.arrivalDate=live.arrivalDate;if(live.arrivalTime)out.arrivalTime=live.arrivalTime;out.arrivalIsActual=true;out.status=live.status||'ARRIVED';out.arrivalTimeSource=live.arrivalTimeSource;out.source=live.source||'Cathay Cargo arrival fallback + existing Cathay parser';}
  else{if(!out.arrivalDate&&live.arrivalDate)out.arrivalDate=live.arrivalDate;if(!out.arrivalTime&&live.arrivalTime)out.arrivalTime=live.arrivalTime;if((!out.status||out.status==='TRACKING')&&live.status)out.status=live.status;}
  if(live.status==='DELIVERED')out.status='DELIVERED';
  return out;
}
export async function trackCathayBrowserFallback(mawb,base={}){
  const serial=String(mawb||'').replace(/\D/g,'').slice(3);let browser;const network=[];let prefixEntry=null,awbEntry=null,clicked=false,pageText='',popupClicked=false;
  try{
    browser=await launchBrowser();const page=await browser.newPage();
    page.on('response',async response=>{
      try{
        const url=response.url(),ct=(response.headers()['content-type']||'').toLowerCase();
        if(!/(json|text|javascript|xml)/.test(ct)&&!/track|trace|shipment|awb|cargo/i.test(url))return;
        const body=await response.text();if(!body||body.length>350000)return;
        if(body.includes(serial)||/CX\s*\d{2,4}|accepted|departed|arrived|shipment|awb|arrival|depart/i.test(body))network.push({url,status:response.status(),body:body.slice(0,220000)});
      }catch{}
    });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({'Accept-Language':'en-US,en;q=0.9'});await page.goto(CATHAY,{waitUntil:'domcontentloaded',timeout:25000});await sleep(1800);
    await clickText(page,'^(accept all|accept cookies|allow all|agree)$');await sleep(500);
    prefixEntry=await fillField(page,'prefix','160');
    if(prefixEntry.ok){await page.keyboard.press('ArrowDown').catch(()=>{});await page.keyboard.press('Enter').catch(()=>{});await sleep(250);await page.keyboard.press('Tab').catch(()=>{});}await sleep(900);
    awbEntry=await fillField(page,'awb',serial);await sleep(900);
    clicked=await clickText(page,'^track\\s*(now)?$');await Promise.race([page.waitForNetworkIdle({idleTime:900,timeout:10000}).catch(()=>{}),sleep(10000)]);
    for(let i=0;i<25;i++){
      pageText=await allCathayTabText(browser);
      if(/Current\s+status\s*:|Booking\s+Status|\b[A-Z]{3}\s+(?:Accepted|Departed|Arrived)\b/i.test(pageText))break;
      await sleep(350);
    }
    if(!/Current\s+status\s*:|Booking\s+Status|\b[A-Z]{3}\s+(?:Accepted|Departed|Arrived)\b/i.test(pageText)){
      // Incomplete search page: let the input finish hydrating, then retry once.
      await fillField(page,'awb',serial);
      clicked=await clickText(page,'^track\\s*(now)?
    // Cathay collapses Booking Status before warehouse acceptance.
    await clickCathayTabText(browser,'^Booking\\s+Status
    await clickCathayTabText(browser,'^(show all details|show details|view details|expand)
    await clickCathayTabText(browser,'^Local
    await sleep(450);
    for(let i=0;i<14;i++){await scrollCathayTabs(browser,i);await sleep(220);}pageText=await allCathayTabText(browser);
    let shipment=parseCathayBookingStatus(pageText,mawb,base)||
      parseTimeline(pageText,mawb,base)||parseCathayBookingOverview(pageText,mawb);
    if(!shipment?.flightNo&&/Booking\s+Status/i.test(pageText)){
      // If the first render showed only Booking Received, allow the
      // expanded allotment card to hydrate before declaring extraction failed.
      for(let i=0;i<10;i++){
        await sleep(500);
        const updatedText=await allCathayTabText(browser);
        const richer=parseCathayBookingStatus(updatedText,mawb,base);
        if(richer){shipment=richer;pageText=updatedText;break;}
      }
    }
    if(!shipment?.arrivalIsActual){popupClicked=await clickViewFlight(page);if(popupClicked){await sleep(700);const popupText=await allCathayTabText(browser);shipment=parseTimeline(`${pageText}\n${popupText}`,mawb,base)||shipment;pageText=`${pageText}\n${popupText}`;}}
    const usefulNetwork=network.filter(x=>!/static\/js|clientlibs|qualtrics|chatbot|akam/i.test(x.url));
    if(!shipment?.arrivalIsActual){
      const networkText=usefulNetwork.filter(x=>x.body.replace(/[^0-9]/g,'').includes(serial)||x.body.includes(serial)).map(x=>x.body).join('\n');
      const parsed=parseCathayBookingStatus(pageText+'\n'+networkText,mawb,base);
      shipment=parsed||parseTimeline(pageText+'\n'+networkText,mawb,base)||shipment;
    }
    if(!shipment?.arrivalIsActual){const external=await fetchPlaneFinderActual(mawb,{...base,...shipment});if(external)shipment=external;}
    if(!shipment?.flightNo){
      console.warn('cathay_booking_card_incomplete',mawb,
        JSON.stringify({clicked,prefixFilled:prefixEntry?.ok,awbFilled:awbEntry?.ok,
          hasAwb:cathayAwbInText(pageText,mawb),
          hasBookingStatus:/Booking\s+Status/i.test(pageText),
          hasAllotment:/Confirmed\s*\(allotment\)/i.test(pageText),
          networkResponses:usefulNetwork.length,
          pageSample:pageText.replace(/\s+/g,' ').slice(0,900)}));
    }
    const networkDebug=usefulNetwork.slice(-12).map(x=>({url:x.url,status:x.status,sample:x.body.slice(0,1200)}));
    return shipment?{ok:true,shipment,debug:{prefixEntry,awbEntry,clicked,popupClicked,pageSample:pageText.slice(0,4500),network:networkDebug}}:{ok:false,reason:'CATHAY ARRIVAL NOT EXTRACTED',debug:{prefixEntry,awbEntry,clicked,popupClicked,pageSample:pageText.slice(0,4500),network:networkDebug}};
  }catch(e){
    const external=await fetchPlaneFinderActual(mawb,base);if(external)return{ok:true,shipment:external,debug:{fallbackAfterBrowserError:true,error:e?.message||String(e)}};
    return{ok:false,reason:e?.message||String(e),debug:{network:network.slice(-8).map(x=>({url:x.url,status:x.status,sample:x.body.slice(0,800)}))}};
  }finally{try{if(browser)await browser.close();}catch{}}
}
)||clicked;
      await page.keyboard.press('Enter').catch(()=>{});
      for(let i=0;i<16;i++){
        await sleep(400);pageText=await allCathayTabText(browser);
        if(/Current\s+status\s*:|Booking\s+Status|\b[A-Z]{3}\s+(?:Accepted|Departed|Arrived)\b/i.test(pageText))break;
      }
    }
    // Cathay collapses Booking Status before warehouse acceptance.
    await clickText(page,'^Booking\\s+Status$');
    await clickText(page,'^(show all details|show details|view details|expand)$');
    await clickText(page,'^Local$');
    await sleep(450);
    for(let i=0;i<14;i++){await page.evaluate(y=>window.scrollTo(0,y),i*450).catch(()=>{});await sleep(220);}pageText=await deepText(page);
    let shipment=parseCathayBookingStatus(pageText,mawb,base)||
      parseTimeline(pageText,mawb,base)||parseCathayBookingOverview(pageText,mawb);
    if(!shipment?.flightNo&&/Booking\s+Status/i.test(pageText)){
      // If the first render showed only Booking Received, allow the
      // expanded allotment card to hydrate before declaring extraction failed.
      for(let i=0;i<10;i++){
        await sleep(500);
        const updatedText=await deepText(page);
        const richer=parseCathayBookingStatus(updatedText,mawb,base);
        if(richer){shipment=richer;pageText=updatedText;break;}
      }
    }
    if(!shipment?.arrivalIsActual){popupClicked=await clickViewFlight(page);if(popupClicked){await sleep(700);const popupText=await deepText(page);shipment=parseTimeline(`${pageText}\n${popupText}`,mawb,base)||shipment;pageText=`${pageText}\n${popupText}`;}}
    const usefulNetwork=network.filter(x=>!/static\/js|clientlibs|qualtrics|chatbot|akam/i.test(x.url));
    if(!shipment?.arrivalIsActual){
      const networkText=usefulNetwork.filter(x=>x.body.includes(serial)).map(x=>x.body).join('\n');
      const parsed=parseCathayBookingStatus(pageText+'\n'+networkText,mawb,base);
      shipment=parsed||parseTimeline(pageText+'\n'+networkText,mawb,base)||shipment;
    }
    if(!shipment?.arrivalIsActual){const external=await fetchPlaneFinderActual(mawb,{...base,...shipment});if(external)shipment=external;}
    if(!shipment?.flightNo){
      console.warn('cathay_booking_card_incomplete',mawb,
        JSON.stringify({clicked,prefixFilled:prefixEntry?.ok,awbFilled:awbEntry?.ok,
          hasAwb:cathayAwbInText(pageText,mawb),
          hasBookingStatus:/Booking\s+Status/i.test(pageText),
          hasAllotment:/Confirmed\s*\(allotment\)/i.test(pageText),
          networkResponses:usefulNetwork.length,
          pageSample:pageText.replace(/\s+/g,' ').slice(0,900)}));
    }
    const networkDebug=usefulNetwork.slice(-12).map(x=>({url:x.url,status:x.status,sample:x.body.slice(0,1200)}));
    return shipment?{ok:true,shipment,debug:{prefixEntry,awbEntry,clicked,popupClicked,pageSample:pageText.slice(0,4500),network:networkDebug}}:{ok:false,reason:'CATHAY ARRIVAL NOT EXTRACTED',debug:{prefixEntry,awbEntry,clicked,popupClicked,pageSample:pageText.slice(0,4500),network:networkDebug}};
  }catch(e){
    const external=await fetchPlaneFinderActual(mawb,base);if(external)return{ok:true,shipment:external,debug:{fallbackAfterBrowserError:true,error:e?.message||String(e)}};
    return{ok:false,reason:e?.message||String(e),debug:{network:network.slice(-8).map(x=>({url:x.url,status:x.status,sample:x.body.slice(0,800)}))}};
  }finally{try{if(browser)await browser.close();}catch{}}
}
);
    await clickText(page,'^(show all details|show details|view details|expand)$');
    await clickText(page,'^Local$');
    await sleep(450);
    for(let i=0;i<14;i++){await page.evaluate(y=>window.scrollTo(0,y),i*450).catch(()=>{});await sleep(220);}pageText=await deepText(page);
    let shipment=parseCathayBookingStatus(pageText,mawb,base)||
      parseTimeline(pageText,mawb,base)||parseCathayBookingOverview(pageText,mawb);
    if(!shipment?.flightNo&&/Booking\s+Status/i.test(pageText)){
      // If the first render showed only Booking Received, allow the
      // expanded allotment card to hydrate before declaring extraction failed.
      for(let i=0;i<10;i++){
        await sleep(500);
        const updatedText=await deepText(page);
        const richer=parseCathayBookingStatus(updatedText,mawb,base);
        if(richer){shipment=richer;pageText=updatedText;break;}
      }
    }
    if(!shipment?.arrivalIsActual){popupClicked=await clickViewFlight(page);if(popupClicked){await sleep(700);const popupText=await deepText(page);shipment=parseTimeline(`${pageText}\n${popupText}`,mawb,base)||shipment;pageText=`${pageText}\n${popupText}`;}}
    const usefulNetwork=network.filter(x=>!/static\/js|clientlibs|qualtrics|chatbot|akam/i.test(x.url));
    if(!shipment?.arrivalIsActual){
      const networkText=usefulNetwork.filter(x=>x.body.includes(serial)).map(x=>x.body).join('\n');
      const parsed=parseCathayBookingStatus(pageText+'\n'+networkText,mawb,base);
      shipment=parsed||parseTimeline(pageText+'\n'+networkText,mawb,base)||shipment;
    }
    if(!shipment?.arrivalIsActual){const external=await fetchPlaneFinderActual(mawb,{...base,...shipment});if(external)shipment=external;}
    if(!shipment?.flightNo){
      console.warn('cathay_booking_card_incomplete',mawb,
        JSON.stringify({clicked,prefixFilled:prefixEntry?.ok,awbFilled:awbEntry?.ok,
          hasAwb:cathayAwbInText(pageText,mawb),
          hasBookingStatus:/Booking\s+Status/i.test(pageText),
          hasAllotment:/Confirmed\s*\(allotment\)/i.test(pageText),
          networkResponses:usefulNetwork.length,
          pageSample:pageText.replace(/\s+/g,' ').slice(0,900)}));
    }
    const networkDebug=usefulNetwork.slice(-12).map(x=>({url:x.url,status:x.status,sample:x.body.slice(0,1200)}));
    return shipment?{ok:true,shipment,debug:{prefixEntry,awbEntry,clicked,popupClicked,pageSample:pageText.slice(0,4500),network:networkDebug}}:{ok:false,reason:'CATHAY ARRIVAL NOT EXTRACTED',debug:{prefixEntry,awbEntry,clicked,popupClicked,pageSample:pageText.slice(0,4500),network:networkDebug}};
  }catch(e){
    const external=await fetchPlaneFinderActual(mawb,base);if(external)return{ok:true,shipment:external,debug:{fallbackAfterBrowserError:true,error:e?.message||String(e)}};
    return{ok:false,reason:e?.message||String(e),debug:{network:network.slice(-8).map(x=>({url:x.url,status:x.status,sample:x.body.slice(0,800)}))}};
  }finally{try{if(browser)await browser.close();}catch{}}
}
)||clicked;
      await page.keyboard.press('Enter').catch(()=>{});
      for(let i=0;i<16;i++){
        await sleep(400);pageText=await allCathayTabText(browser);
        if(/Current\s+status\s*:|Booking\s+Status|\b[A-Z]{3}\s+(?:Accepted|Departed|Arrived)\b/i.test(pageText))break;
      }
    }
    // Cathay collapses Booking Status before warehouse acceptance.
    await clickText(page,'^Booking\\s+Status$');
    await clickText(page,'^(show all details|show details|view details|expand)$');
    await clickText(page,'^Local$');
    await sleep(450);
    for(let i=0;i<14;i++){await page.evaluate(y=>window.scrollTo(0,y),i*450).catch(()=>{});await sleep(220);}pageText=await deepText(page);
    let shipment=parseCathayBookingStatus(pageText,mawb,base)||
      parseTimeline(pageText,mawb,base)||parseCathayBookingOverview(pageText,mawb);
    if(!shipment?.flightNo&&/Booking\s+Status/i.test(pageText)){
      // If the first render showed only Booking Received, allow the
      // expanded allotment card to hydrate before declaring extraction failed.
      for(let i=0;i<10;i++){
        await sleep(500);
        const updatedText=await deepText(page);
        const richer=parseCathayBookingStatus(updatedText,mawb,base);
        if(richer){shipment=richer;pageText=updatedText;break;}
      }
    }
    if(!shipment?.arrivalIsActual){popupClicked=await clickViewFlight(page);if(popupClicked){await sleep(700);const popupText=await deepText(page);shipment=parseTimeline(`${pageText}\n${popupText}`,mawb,base)||shipment;pageText=`${pageText}\n${popupText}`;}}
    const usefulNetwork=network.filter(x=>!/static\/js|clientlibs|qualtrics|chatbot|akam/i.test(x.url));
    if(!shipment?.arrivalIsActual){
      const networkText=usefulNetwork.filter(x=>x.body.includes(serial)).map(x=>x.body).join('\n');
      const parsed=parseCathayBookingStatus(pageText+'\n'+networkText,mawb,base);
      shipment=parsed||parseTimeline(pageText+'\n'+networkText,mawb,base)||shipment;
    }
    if(!shipment?.arrivalIsActual){const external=await fetchPlaneFinderActual(mawb,{...base,...shipment});if(external)shipment=external;}
    if(!shipment?.flightNo){
      console.warn('cathay_booking_card_incomplete',mawb,
        JSON.stringify({clicked,prefixFilled:prefixEntry?.ok,awbFilled:awbEntry?.ok,
          hasAwb:cathayAwbInText(pageText,mawb),
          hasBookingStatus:/Booking\s+Status/i.test(pageText),
          hasAllotment:/Confirmed\s*\(allotment\)/i.test(pageText),
          networkResponses:usefulNetwork.length,
          pageSample:pageText.replace(/\s+/g,' ').slice(0,900)}));
    }
    const networkDebug=usefulNetwork.slice(-12).map(x=>({url:x.url,status:x.status,sample:x.body.slice(0,1200)}));
    return shipment?{ok:true,shipment,debug:{prefixEntry,awbEntry,clicked,popupClicked,pageSample:pageText.slice(0,4500),network:networkDebug}}:{ok:false,reason:'CATHAY ARRIVAL NOT EXTRACTED',debug:{prefixEntry,awbEntry,clicked,popupClicked,pageSample:pageText.slice(0,4500),network:networkDebug}};
  }catch(e){
    const external=await fetchPlaneFinderActual(mawb,base);if(external)return{ok:true,shipment:external,debug:{fallbackAfterBrowserError:true,error:e?.message||String(e)}};
    return{ok:false,reason:e?.message||String(e),debug:{network:network.slice(-8).map(x=>({url:x.url,status:x.status,sample:x.body.slice(0,800)}))}};
  }finally{try{if(browser)await browser.close();}catch{}}
}
);
    await clickText(page,'^Local$');
    await sleep(450);
    for(let i=0;i<14;i++){await page.evaluate(y=>window.scrollTo(0,y),i*450).catch(()=>{});await sleep(220);}pageText=await deepText(page);
    let shipment=parseCathayBookingStatus(pageText,mawb,base)||
      parseTimeline(pageText,mawb,base)||parseCathayBookingOverview(pageText,mawb);
    if(!shipment?.flightNo&&/Booking\s+Status/i.test(pageText)){
      // If the first render showed only Booking Received, allow the
      // expanded allotment card to hydrate before declaring extraction failed.
      for(let i=0;i<10;i++){
        await sleep(500);
        const updatedText=await deepText(page);
        const richer=parseCathayBookingStatus(updatedText,mawb,base);
        if(richer){shipment=richer;pageText=updatedText;break;}
      }
    }
    if(!shipment?.arrivalIsActual){popupClicked=await clickViewFlight(page);if(popupClicked){await sleep(700);const popupText=await deepText(page);shipment=parseTimeline(`${pageText}\n${popupText}`,mawb,base)||shipment;pageText=`${pageText}\n${popupText}`;}}
    const usefulNetwork=network.filter(x=>!/static\/js|clientlibs|qualtrics|chatbot|akam/i.test(x.url));
    if(!shipment?.arrivalIsActual){
      const networkText=usefulNetwork.filter(x=>x.body.includes(serial)).map(x=>x.body).join('\n');
      const parsed=parseCathayBookingStatus(pageText+'\n'+networkText,mawb,base);
      shipment=parsed||parseTimeline(pageText+'\n'+networkText,mawb,base)||shipment;
    }
    if(!shipment?.arrivalIsActual){const external=await fetchPlaneFinderActual(mawb,{...base,...shipment});if(external)shipment=external;}
    if(!shipment?.flightNo){
      console.warn('cathay_booking_card_incomplete',mawb,
        JSON.stringify({clicked,prefixFilled:prefixEntry?.ok,awbFilled:awbEntry?.ok,
          hasAwb:cathayAwbInText(pageText,mawb),
          hasBookingStatus:/Booking\s+Status/i.test(pageText),
          hasAllotment:/Confirmed\s*\(allotment\)/i.test(pageText),
          networkResponses:usefulNetwork.length,
          pageSample:pageText.replace(/\s+/g,' ').slice(0,900)}));
    }
    const networkDebug=usefulNetwork.slice(-12).map(x=>({url:x.url,status:x.status,sample:x.body.slice(0,1200)}));
    return shipment?{ok:true,shipment,debug:{prefixEntry,awbEntry,clicked,popupClicked,pageSample:pageText.slice(0,4500),network:networkDebug}}:{ok:false,reason:'CATHAY ARRIVAL NOT EXTRACTED',debug:{prefixEntry,awbEntry,clicked,popupClicked,pageSample:pageText.slice(0,4500),network:networkDebug}};
  }catch(e){
    const external=await fetchPlaneFinderActual(mawb,base);if(external)return{ok:true,shipment:external,debug:{fallbackAfterBrowserError:true,error:e?.message||String(e)}};
    return{ok:false,reason:e?.message||String(e),debug:{network:network.slice(-8).map(x=>({url:x.url,status:x.status,sample:x.body.slice(0,800)}))}};
  }finally{try{if(browser)await browser.close();}catch{}}
}
)||clicked;
      await page.keyboard.press('Enter').catch(()=>{});
      for(let i=0;i<16;i++){
        await sleep(400);pageText=await allCathayTabText(browser);
        if(/Current\s+status\s*:|Booking\s+Status|\b[A-Z]{3}\s+(?:Accepted|Departed|Arrived)\b/i.test(pageText))break;
      }
    }
    // Cathay collapses Booking Status before warehouse acceptance.
    await clickText(page,'^Booking\\s+Status$');
    await clickText(page,'^(show all details|show details|view details|expand)$');
    await clickText(page,'^Local$');
    await sleep(450);
    for(let i=0;i<14;i++){await page.evaluate(y=>window.scrollTo(0,y),i*450).catch(()=>{});await sleep(220);}pageText=await deepText(page);
    let shipment=parseCathayBookingStatus(pageText,mawb,base)||
      parseTimeline(pageText,mawb,base)||parseCathayBookingOverview(pageText,mawb);
    if(!shipment?.flightNo&&/Booking\s+Status/i.test(pageText)){
      // If the first render showed only Booking Received, allow the
      // expanded allotment card to hydrate before declaring extraction failed.
      for(let i=0;i<10;i++){
        await sleep(500);
        const updatedText=await deepText(page);
        const richer=parseCathayBookingStatus(updatedText,mawb,base);
        if(richer){shipment=richer;pageText=updatedText;break;}
      }
    }
    if(!shipment?.arrivalIsActual){popupClicked=await clickViewFlight(page);if(popupClicked){await sleep(700);const popupText=await deepText(page);shipment=parseTimeline(`${pageText}\n${popupText}`,mawb,base)||shipment;pageText=`${pageText}\n${popupText}`;}}
    const usefulNetwork=network.filter(x=>!/static\/js|clientlibs|qualtrics|chatbot|akam/i.test(x.url));
    if(!shipment?.arrivalIsActual){
      const networkText=usefulNetwork.filter(x=>x.body.includes(serial)).map(x=>x.body).join('\n');
      const parsed=parseCathayBookingStatus(pageText+'\n'+networkText,mawb,base);
      shipment=parsed||parseTimeline(pageText+'\n'+networkText,mawb,base)||shipment;
    }
    if(!shipment?.arrivalIsActual){const external=await fetchPlaneFinderActual(mawb,{...base,...shipment});if(external)shipment=external;}
    if(!shipment?.flightNo){
      console.warn('cathay_booking_card_incomplete',mawb,
        JSON.stringify({clicked,prefixFilled:prefixEntry?.ok,awbFilled:awbEntry?.ok,
          hasAwb:cathayAwbInText(pageText,mawb),
          hasBookingStatus:/Booking\s+Status/i.test(pageText),
          hasAllotment:/Confirmed\s*\(allotment\)/i.test(pageText),
          networkResponses:usefulNetwork.length,
          pageSample:pageText.replace(/\s+/g,' ').slice(0,900)}));
    }
    const networkDebug=usefulNetwork.slice(-12).map(x=>({url:x.url,status:x.status,sample:x.body.slice(0,1200)}));
    return shipment?{ok:true,shipment,debug:{prefixEntry,awbEntry,clicked,popupClicked,pageSample:pageText.slice(0,4500),network:networkDebug}}:{ok:false,reason:'CATHAY ARRIVAL NOT EXTRACTED',debug:{prefixEntry,awbEntry,clicked,popupClicked,pageSample:pageText.slice(0,4500),network:networkDebug}};
  }catch(e){
    const external=await fetchPlaneFinderActual(mawb,base);if(external)return{ok:true,shipment:external,debug:{fallbackAfterBrowserError:true,error:e?.message||String(e)}};
    return{ok:false,reason:e?.message||String(e),debug:{network:network.slice(-8).map(x=>({url:x.url,status:x.status,sample:x.body.slice(0,800)}))}};
  }finally{try{if(browser)await browser.close();}catch{}}
}
);
    await clickText(page,'^(show all details|show details|view details|expand)$');
    await clickText(page,'^Local$');
    await sleep(450);
    for(let i=0;i<14;i++){await page.evaluate(y=>window.scrollTo(0,y),i*450).catch(()=>{});await sleep(220);}pageText=await deepText(page);
    let shipment=parseCathayBookingStatus(pageText,mawb,base)||
      parseTimeline(pageText,mawb,base)||parseCathayBookingOverview(pageText,mawb);
    if(!shipment?.flightNo&&/Booking\s+Status/i.test(pageText)){
      // If the first render showed only Booking Received, allow the
      // expanded allotment card to hydrate before declaring extraction failed.
      for(let i=0;i<10;i++){
        await sleep(500);
        const updatedText=await deepText(page);
        const richer=parseCathayBookingStatus(updatedText,mawb,base);
        if(richer){shipment=richer;pageText=updatedText;break;}
      }
    }
    if(!shipment?.arrivalIsActual){popupClicked=await clickViewFlight(page);if(popupClicked){await sleep(700);const popupText=await deepText(page);shipment=parseTimeline(`${pageText}\n${popupText}`,mawb,base)||shipment;pageText=`${pageText}\n${popupText}`;}}
    const usefulNetwork=network.filter(x=>!/static\/js|clientlibs|qualtrics|chatbot|akam/i.test(x.url));
    if(!shipment?.arrivalIsActual){
      const networkText=usefulNetwork.filter(x=>x.body.includes(serial)).map(x=>x.body).join('\n');
      const parsed=parseCathayBookingStatus(pageText+'\n'+networkText,mawb,base);
      shipment=parsed||parseTimeline(pageText+'\n'+networkText,mawb,base)||shipment;
    }
    if(!shipment?.arrivalIsActual){const external=await fetchPlaneFinderActual(mawb,{...base,...shipment});if(external)shipment=external;}
    if(!shipment?.flightNo){
      console.warn('cathay_booking_card_incomplete',mawb,
        JSON.stringify({clicked,prefixFilled:prefixEntry?.ok,awbFilled:awbEntry?.ok,
          hasAwb:cathayAwbInText(pageText,mawb),
          hasBookingStatus:/Booking\s+Status/i.test(pageText),
          hasAllotment:/Confirmed\s*\(allotment\)/i.test(pageText),
          networkResponses:usefulNetwork.length,
          pageSample:pageText.replace(/\s+/g,' ').slice(0,900)}));
    }
    const networkDebug=usefulNetwork.slice(-12).map(x=>({url:x.url,status:x.status,sample:x.body.slice(0,1200)}));
    return shipment?{ok:true,shipment,debug:{prefixEntry,awbEntry,clicked,popupClicked,pageSample:pageText.slice(0,4500),network:networkDebug}}:{ok:false,reason:'CATHAY ARRIVAL NOT EXTRACTED',debug:{prefixEntry,awbEntry,clicked,popupClicked,pageSample:pageText.slice(0,4500),network:networkDebug}};
  }catch(e){
    const external=await fetchPlaneFinderActual(mawb,base);if(external)return{ok:true,shipment:external,debug:{fallbackAfterBrowserError:true,error:e?.message||String(e)}};
    return{ok:false,reason:e?.message||String(e),debug:{network:network.slice(-8).map(x=>({url:x.url,status:x.status,sample:x.body.slice(0,800)}))}};
  }finally{try{if(browser)await browser.close();}catch{}}
}
)||clicked;
      await page.keyboard.press('Enter').catch(()=>{});
      for(let i=0;i<16;i++){
        await sleep(400);pageText=await allCathayTabText(browser);
        if(/Current\s+status\s*:|Booking\s+Status|\b[A-Z]{3}\s+(?:Accepted|Departed|Arrived)\b/i.test(pageText))break;
      }
    }
    // Cathay collapses Booking Status before warehouse acceptance.
    await clickText(page,'^Booking\\s+Status$');
    await clickText(page,'^(show all details|show details|view details|expand)$');
    await clickText(page,'^Local$');
    await sleep(450);
    for(let i=0;i<14;i++){await page.evaluate(y=>window.scrollTo(0,y),i*450).catch(()=>{});await sleep(220);}pageText=await deepText(page);
    let shipment=parseCathayBookingStatus(pageText,mawb,base)||
      parseTimeline(pageText,mawb,base)||parseCathayBookingOverview(pageText,mawb);
    if(!shipment?.flightNo&&/Booking\s+Status/i.test(pageText)){
      // If the first render showed only Booking Received, allow the
      // expanded allotment card to hydrate before declaring extraction failed.
      for(let i=0;i<10;i++){
        await sleep(500);
        const updatedText=await deepText(page);
        const richer=parseCathayBookingStatus(updatedText,mawb,base);
        if(richer){shipment=richer;pageText=updatedText;break;}
      }
    }
    if(!shipment?.arrivalIsActual){popupClicked=await clickViewFlight(page);if(popupClicked){await sleep(700);const popupText=await deepText(page);shipment=parseTimeline(`${pageText}\n${popupText}`,mawb,base)||shipment;pageText=`${pageText}\n${popupText}`;}}
    const usefulNetwork=network.filter(x=>!/static\/js|clientlibs|qualtrics|chatbot|akam/i.test(x.url));
    if(!shipment?.arrivalIsActual){
      const networkText=usefulNetwork.filter(x=>x.body.includes(serial)).map(x=>x.body).join('\n');
      const parsed=parseCathayBookingStatus(pageText+'\n'+networkText,mawb,base);
      shipment=parsed||parseTimeline(pageText+'\n'+networkText,mawb,base)||shipment;
    }
    if(!shipment?.arrivalIsActual){const external=await fetchPlaneFinderActual(mawb,{...base,...shipment});if(external)shipment=external;}
    if(!shipment?.flightNo){
      console.warn('cathay_booking_card_incomplete',mawb,
        JSON.stringify({clicked,prefixFilled:prefixEntry?.ok,awbFilled:awbEntry?.ok,
          hasAwb:cathayAwbInText(pageText,mawb),
          hasBookingStatus:/Booking\s+Status/i.test(pageText),
          hasAllotment:/Confirmed\s*\(allotment\)/i.test(pageText),
          networkResponses:usefulNetwork.length,
          pageSample:pageText.replace(/\s+/g,' ').slice(0,900)}));
    }
    const networkDebug=usefulNetwork.slice(-12).map(x=>({url:x.url,status:x.status,sample:x.body.slice(0,1200)}));
    return shipment?{ok:true,shipment,debug:{prefixEntry,awbEntry,clicked,popupClicked,pageSample:pageText.slice(0,4500),network:networkDebug}}:{ok:false,reason:'CATHAY ARRIVAL NOT EXTRACTED',debug:{prefixEntry,awbEntry,clicked,popupClicked,pageSample:pageText.slice(0,4500),network:networkDebug}};
  }catch(e){
    const external=await fetchPlaneFinderActual(mawb,base);if(external)return{ok:true,shipment:external,debug:{fallbackAfterBrowserError:true,error:e?.message||String(e)}};
    return{ok:false,reason:e?.message||String(e),debug:{network:network.slice(-8).map(x=>({url:x.url,status:x.status,sample:x.body.slice(0,800)}))}};
  }finally{try{if(browser)await browser.close();}catch{}}
}
);
    await sleep(450);
    for(let i=0;i<14;i++){await page.evaluate(y=>window.scrollTo(0,y),i*450).catch(()=>{});await sleep(220);}pageText=await deepText(page);
    let shipment=parseCathayBookingStatus(pageText,mawb,base)||
      parseTimeline(pageText,mawb,base)||parseCathayBookingOverview(pageText,mawb);
    if(!shipment?.flightNo&&/Booking\s+Status/i.test(pageText)){
      // If the first render showed only Booking Received, allow the
      // expanded allotment card to hydrate before declaring extraction failed.
      for(let i=0;i<10;i++){
        await sleep(500);
        const updatedText=await deepText(page);
        const richer=parseCathayBookingStatus(updatedText,mawb,base);
        if(richer){shipment=richer;pageText=updatedText;break;}
      }
    }
    if(!shipment?.arrivalIsActual){popupClicked=await clickViewFlight(page);if(popupClicked){await sleep(700);const popupText=await deepText(page);shipment=parseTimeline(`${pageText}\n${popupText}`,mawb,base)||shipment;pageText=`${pageText}\n${popupText}`;}}
    const usefulNetwork=network.filter(x=>!/static\/js|clientlibs|qualtrics|chatbot|akam/i.test(x.url));
    if(!shipment?.arrivalIsActual){
      const networkText=usefulNetwork.filter(x=>x.body.includes(serial)).map(x=>x.body).join('\n');
      const parsed=parseCathayBookingStatus(pageText+'\n'+networkText,mawb,base);
      shipment=parsed||parseTimeline(pageText+'\n'+networkText,mawb,base)||shipment;
    }
    if(!shipment?.arrivalIsActual){const external=await fetchPlaneFinderActual(mawb,{...base,...shipment});if(external)shipment=external;}
    if(!shipment?.flightNo){
      console.warn('cathay_booking_card_incomplete',mawb,
        JSON.stringify({clicked,prefixFilled:prefixEntry?.ok,awbFilled:awbEntry?.ok,
          hasAwb:cathayAwbInText(pageText,mawb),
          hasBookingStatus:/Booking\s+Status/i.test(pageText),
          hasAllotment:/Confirmed\s*\(allotment\)/i.test(pageText),
          networkResponses:usefulNetwork.length,
          pageSample:pageText.replace(/\s+/g,' ').slice(0,900)}));
    }
    const networkDebug=usefulNetwork.slice(-12).map(x=>({url:x.url,status:x.status,sample:x.body.slice(0,1200)}));
    return shipment?{ok:true,shipment,debug:{prefixEntry,awbEntry,clicked,popupClicked,pageSample:pageText.slice(0,4500),network:networkDebug}}:{ok:false,reason:'CATHAY ARRIVAL NOT EXTRACTED',debug:{prefixEntry,awbEntry,clicked,popupClicked,pageSample:pageText.slice(0,4500),network:networkDebug}};
  }catch(e){
    const external=await fetchPlaneFinderActual(mawb,base);if(external)return{ok:true,shipment:external,debug:{fallbackAfterBrowserError:true,error:e?.message||String(e)}};
    return{ok:false,reason:e?.message||String(e),debug:{network:network.slice(-8).map(x=>({url:x.url,status:x.status,sample:x.body.slice(0,800)}))}};
  }finally{try{if(browser)await browser.close();}catch{}}
}
)||clicked;
      await page.keyboard.press('Enter').catch(()=>{});
      for(let i=0;i<16;i++){
        await sleep(400);pageText=await allCathayTabText(browser);
        if(/Current\s+status\s*:|Booking\s+Status|\b[A-Z]{3}\s+(?:Accepted|Departed|Arrived)\b/i.test(pageText))break;
      }
    }
    // Cathay collapses Booking Status before warehouse acceptance.
    await clickText(page,'^Booking\\s+Status$');
    await clickText(page,'^(show all details|show details|view details|expand)$');
    await clickText(page,'^Local$');
    await sleep(450);
    for(let i=0;i<14;i++){await page.evaluate(y=>window.scrollTo(0,y),i*450).catch(()=>{});await sleep(220);}pageText=await deepText(page);
    let shipment=parseCathayBookingStatus(pageText,mawb,base)||
      parseTimeline(pageText,mawb,base)||parseCathayBookingOverview(pageText,mawb);
    if(!shipment?.flightNo&&/Booking\s+Status/i.test(pageText)){
      // If the first render showed only Booking Received, allow the
      // expanded allotment card to hydrate before declaring extraction failed.
      for(let i=0;i<10;i++){
        await sleep(500);
        const updatedText=await deepText(page);
        const richer=parseCathayBookingStatus(updatedText,mawb,base);
        if(richer){shipment=richer;pageText=updatedText;break;}
      }
    }
    if(!shipment?.arrivalIsActual){popupClicked=await clickViewFlight(page);if(popupClicked){await sleep(700);const popupText=await deepText(page);shipment=parseTimeline(`${pageText}\n${popupText}`,mawb,base)||shipment;pageText=`${pageText}\n${popupText}`;}}
    const usefulNetwork=network.filter(x=>!/static\/js|clientlibs|qualtrics|chatbot|akam/i.test(x.url));
    if(!shipment?.arrivalIsActual){
      const networkText=usefulNetwork.filter(x=>x.body.includes(serial)).map(x=>x.body).join('\n');
      const parsed=parseCathayBookingStatus(pageText+'\n'+networkText,mawb,base);
      shipment=parsed||parseTimeline(pageText+'\n'+networkText,mawb,base)||shipment;
    }
    if(!shipment?.arrivalIsActual){const external=await fetchPlaneFinderActual(mawb,{...base,...shipment});if(external)shipment=external;}
    if(!shipment?.flightNo){
      console.warn('cathay_booking_card_incomplete',mawb,
        JSON.stringify({clicked,prefixFilled:prefixEntry?.ok,awbFilled:awbEntry?.ok,
          hasAwb:cathayAwbInText(pageText,mawb),
          hasBookingStatus:/Booking\s+Status/i.test(pageText),
          hasAllotment:/Confirmed\s*\(allotment\)/i.test(pageText),
          networkResponses:usefulNetwork.length,
          pageSample:pageText.replace(/\s+/g,' ').slice(0,900)}));
    }
    const networkDebug=usefulNetwork.slice(-12).map(x=>({url:x.url,status:x.status,sample:x.body.slice(0,1200)}));
    return shipment?{ok:true,shipment,debug:{prefixEntry,awbEntry,clicked,popupClicked,pageSample:pageText.slice(0,4500),network:networkDebug}}:{ok:false,reason:'CATHAY ARRIVAL NOT EXTRACTED',debug:{prefixEntry,awbEntry,clicked,popupClicked,pageSample:pageText.slice(0,4500),network:networkDebug}};
  }catch(e){
    const external=await fetchPlaneFinderActual(mawb,base);if(external)return{ok:true,shipment:external,debug:{fallbackAfterBrowserError:true,error:e?.message||String(e)}};
    return{ok:false,reason:e?.message||String(e),debug:{network:network.slice(-8).map(x=>({url:x.url,status:x.status,sample:x.body.slice(0,800)}))}};
  }finally{try{if(browser)await browser.close();}catch{}}
}
);
    await clickText(page,'^(show all details|show details|view details|expand)$');
    await clickText(page,'^Local$');
    await sleep(450);
    for(let i=0;i<14;i++){await page.evaluate(y=>window.scrollTo(0,y),i*450).catch(()=>{});await sleep(220);}pageText=await deepText(page);
    let shipment=parseCathayBookingStatus(pageText,mawb,base)||
      parseTimeline(pageText,mawb,base)||parseCathayBookingOverview(pageText,mawb);
    if(!shipment?.flightNo&&/Booking\s+Status/i.test(pageText)){
      // If the first render showed only Booking Received, allow the
      // expanded allotment card to hydrate before declaring extraction failed.
      for(let i=0;i<10;i++){
        await sleep(500);
        const updatedText=await deepText(page);
        const richer=parseCathayBookingStatus(updatedText,mawb,base);
        if(richer){shipment=richer;pageText=updatedText;break;}
      }
    }
    if(!shipment?.arrivalIsActual){popupClicked=await clickViewFlight(page);if(popupClicked){await sleep(700);const popupText=await deepText(page);shipment=parseTimeline(`${pageText}\n${popupText}`,mawb,base)||shipment;pageText=`${pageText}\n${popupText}`;}}
    const usefulNetwork=network.filter(x=>!/static\/js|clientlibs|qualtrics|chatbot|akam/i.test(x.url));
    if(!shipment?.arrivalIsActual){
      const networkText=usefulNetwork.filter(x=>x.body.includes(serial)).map(x=>x.body).join('\n');
      const parsed=parseCathayBookingStatus(pageText+'\n'+networkText,mawb,base);
      shipment=parsed||parseTimeline(pageText+'\n'+networkText,mawb,base)||shipment;
    }
    if(!shipment?.arrivalIsActual){const external=await fetchPlaneFinderActual(mawb,{...base,...shipment});if(external)shipment=external;}
    if(!shipment?.flightNo){
      console.warn('cathay_booking_card_incomplete',mawb,
        JSON.stringify({clicked,prefixFilled:prefixEntry?.ok,awbFilled:awbEntry?.ok,
          hasAwb:cathayAwbInText(pageText,mawb),
          hasBookingStatus:/Booking\s+Status/i.test(pageText),
          hasAllotment:/Confirmed\s*\(allotment\)/i.test(pageText),
          networkResponses:usefulNetwork.length,
          pageSample:pageText.replace(/\s+/g,' ').slice(0,900)}));
    }
    const networkDebug=usefulNetwork.slice(-12).map(x=>({url:x.url,status:x.status,sample:x.body.slice(0,1200)}));
    return shipment?{ok:true,shipment,debug:{prefixEntry,awbEntry,clicked,popupClicked,pageSample:pageText.slice(0,4500),network:networkDebug}}:{ok:false,reason:'CATHAY ARRIVAL NOT EXTRACTED',debug:{prefixEntry,awbEntry,clicked,popupClicked,pageSample:pageText.slice(0,4500),network:networkDebug}};
  }catch(e){
    const external=await fetchPlaneFinderActual(mawb,base);if(external)return{ok:true,shipment:external,debug:{fallbackAfterBrowserError:true,error:e?.message||String(e)}};
    return{ok:false,reason:e?.message||String(e),debug:{network:network.slice(-8).map(x=>({url:x.url,status:x.status,sample:x.body.slice(0,800)}))}};
  }finally{try{if(browser)await browser.close();}catch{}}
}
)||clicked;
      await page.keyboard.press('Enter').catch(()=>{});
      for(let i=0;i<16;i++){
        await sleep(400);pageText=await allCathayTabText(browser);
        if(/Current\s+status\s*:|Booking\s+Status|\b[A-Z]{3}\s+(?:Accepted|Departed|Arrived)\b/i.test(pageText))break;
      }
    }
    // Cathay collapses Booking Status before warehouse acceptance.
    await clickText(page,'^Booking\\s+Status$');
    await clickText(page,'^(show all details|show details|view details|expand)$');
    await clickText(page,'^Local$');
    await sleep(450);
    for(let i=0;i<14;i++){await page.evaluate(y=>window.scrollTo(0,y),i*450).catch(()=>{});await sleep(220);}pageText=await deepText(page);
    let shipment=parseCathayBookingStatus(pageText,mawb,base)||
      parseTimeline(pageText,mawb,base)||parseCathayBookingOverview(pageText,mawb);
    if(!shipment?.flightNo&&/Booking\s+Status/i.test(pageText)){
      // If the first render showed only Booking Received, allow the
      // expanded allotment card to hydrate before declaring extraction failed.
      for(let i=0;i<10;i++){
        await sleep(500);
        const updatedText=await deepText(page);
        const richer=parseCathayBookingStatus(updatedText,mawb,base);
        if(richer){shipment=richer;pageText=updatedText;break;}
      }
    }
    if(!shipment?.arrivalIsActual){popupClicked=await clickViewFlight(page);if(popupClicked){await sleep(700);const popupText=await deepText(page);shipment=parseTimeline(`${pageText}\n${popupText}`,mawb,base)||shipment;pageText=`${pageText}\n${popupText}`;}}
    const usefulNetwork=network.filter(x=>!/static\/js|clientlibs|qualtrics|chatbot|akam/i.test(x.url));
    if(!shipment?.arrivalIsActual){
      const networkText=usefulNetwork.filter(x=>x.body.includes(serial)).map(x=>x.body).join('\n');
      const parsed=parseCathayBookingStatus(pageText+'\n'+networkText,mawb,base);
      shipment=parsed||parseTimeline(pageText+'\n'+networkText,mawb,base)||shipment;
    }
    if(!shipment?.arrivalIsActual){const external=await fetchPlaneFinderActual(mawb,{...base,...shipment});if(external)shipment=external;}
    if(!shipment?.flightNo){
      console.warn('cathay_booking_card_incomplete',mawb,
        JSON.stringify({clicked,prefixFilled:prefixEntry?.ok,awbFilled:awbEntry?.ok,
          hasAwb:cathayAwbInText(pageText,mawb),
          hasBookingStatus:/Booking\s+Status/i.test(pageText),
          hasAllotment:/Confirmed\s*\(allotment\)/i.test(pageText),
          networkResponses:usefulNetwork.length,
          pageSample:pageText.replace(/\s+/g,' ').slice(0,900)}));
    }
    const networkDebug=usefulNetwork.slice(-12).map(x=>({url:x.url,status:x.status,sample:x.body.slice(0,1200)}));
    return shipment?{ok:true,shipment,debug:{prefixEntry,awbEntry,clicked,popupClicked,pageSample:pageText.slice(0,4500),network:networkDebug}}:{ok:false,reason:'CATHAY ARRIVAL NOT EXTRACTED',debug:{prefixEntry,awbEntry,clicked,popupClicked,pageSample:pageText.slice(0,4500),network:networkDebug}};
  }catch(e){
    const external=await fetchPlaneFinderActual(mawb,base);if(external)return{ok:true,shipment:external,debug:{fallbackAfterBrowserError:true,error:e?.message||String(e)}};
    return{ok:false,reason:e?.message||String(e),debug:{network:network.slice(-8).map(x=>({url:x.url,status:x.status,sample:x.body.slice(0,800)}))}};
  }finally{try{if(browser)await browser.close();}catch{}}
}
);
    await clickText(page,'^Local$');
    await sleep(450);
    for(let i=0;i<14;i++){await page.evaluate(y=>window.scrollTo(0,y),i*450).catch(()=>{});await sleep(220);}pageText=await deepText(page);
    let shipment=parseCathayBookingStatus(pageText,mawb,base)||
      parseTimeline(pageText,mawb,base)||parseCathayBookingOverview(pageText,mawb);
    if(!shipment?.flightNo&&/Booking\s+Status/i.test(pageText)){
      // If the first render showed only Booking Received, allow the
      // expanded allotment card to hydrate before declaring extraction failed.
      for(let i=0;i<10;i++){
        await sleep(500);
        const updatedText=await deepText(page);
        const richer=parseCathayBookingStatus(updatedText,mawb,base);
        if(richer){shipment=richer;pageText=updatedText;break;}
      }
    }
    if(!shipment?.arrivalIsActual){popupClicked=await clickViewFlight(page);if(popupClicked){await sleep(700);const popupText=await deepText(page);shipment=parseTimeline(`${pageText}\n${popupText}`,mawb,base)||shipment;pageText=`${pageText}\n${popupText}`;}}
    const usefulNetwork=network.filter(x=>!/static\/js|clientlibs|qualtrics|chatbot|akam/i.test(x.url));
    if(!shipment?.arrivalIsActual){
      const networkText=usefulNetwork.filter(x=>x.body.includes(serial)).map(x=>x.body).join('\n');
      const parsed=parseCathayBookingStatus(pageText+'\n'+networkText,mawb,base);
      shipment=parsed||parseTimeline(pageText+'\n'+networkText,mawb,base)||shipment;
    }
    if(!shipment?.arrivalIsActual){const external=await fetchPlaneFinderActual(mawb,{...base,...shipment});if(external)shipment=external;}
    if(!shipment?.flightNo){
      console.warn('cathay_booking_card_incomplete',mawb,
        JSON.stringify({clicked,prefixFilled:prefixEntry?.ok,awbFilled:awbEntry?.ok,
          hasAwb:cathayAwbInText(pageText,mawb),
          hasBookingStatus:/Booking\s+Status/i.test(pageText),
          hasAllotment:/Confirmed\s*\(allotment\)/i.test(pageText),
          networkResponses:usefulNetwork.length,
          pageSample:pageText.replace(/\s+/g,' ').slice(0,900)}));
    }
    const networkDebug=usefulNetwork.slice(-12).map(x=>({url:x.url,status:x.status,sample:x.body.slice(0,1200)}));
    return shipment?{ok:true,shipment,debug:{prefixEntry,awbEntry,clicked,popupClicked,pageSample:pageText.slice(0,4500),network:networkDebug}}:{ok:false,reason:'CATHAY ARRIVAL NOT EXTRACTED',debug:{prefixEntry,awbEntry,clicked,popupClicked,pageSample:pageText.slice(0,4500),network:networkDebug}};
  }catch(e){
    const external=await fetchPlaneFinderActual(mawb,base);if(external)return{ok:true,shipment:external,debug:{fallbackAfterBrowserError:true,error:e?.message||String(e)}};
    return{ok:false,reason:e?.message||String(e),debug:{network:network.slice(-8).map(x=>({url:x.url,status:x.status,sample:x.body.slice(0,800)}))}};
  }finally{try{if(browser)await browser.close();}catch{}}
}
)||clicked;
      await page.keyboard.press('Enter').catch(()=>{});
      for(let i=0;i<16;i++){
        await sleep(400);pageText=await allCathayTabText(browser);
        if(/Current\s+status\s*:|Booking\s+Status|\b[A-Z]{3}\s+(?:Accepted|Departed|Arrived)\b/i.test(pageText))break;
      }
    }
    // Cathay collapses Booking Status before warehouse acceptance.
    await clickText(page,'^Booking\\s+Status$');
    await clickText(page,'^(show all details|show details|view details|expand)$');
    await clickText(page,'^Local$');
    await sleep(450);
    for(let i=0;i<14;i++){await page.evaluate(y=>window.scrollTo(0,y),i*450).catch(()=>{});await sleep(220);}pageText=await deepText(page);
    let shipment=parseCathayBookingStatus(pageText,mawb,base)||
      parseTimeline(pageText,mawb,base)||parseCathayBookingOverview(pageText,mawb);
    if(!shipment?.flightNo&&/Booking\s+Status/i.test(pageText)){
      // If the first render showed only Booking Received, allow the
      // expanded allotment card to hydrate before declaring extraction failed.
      for(let i=0;i<10;i++){
        await sleep(500);
        const updatedText=await deepText(page);
        const richer=parseCathayBookingStatus(updatedText,mawb,base);
        if(richer){shipment=richer;pageText=updatedText;break;}
      }
    }
    if(!shipment?.arrivalIsActual){popupClicked=await clickViewFlight(page);if(popupClicked){await sleep(700);const popupText=await deepText(page);shipment=parseTimeline(`${pageText}\n${popupText}`,mawb,base)||shipment;pageText=`${pageText}\n${popupText}`;}}
    const usefulNetwork=network.filter(x=>!/static\/js|clientlibs|qualtrics|chatbot|akam/i.test(x.url));
    if(!shipment?.arrivalIsActual){
      const networkText=usefulNetwork.filter(x=>x.body.includes(serial)).map(x=>x.body).join('\n');
      const parsed=parseCathayBookingStatus(pageText+'\n'+networkText,mawb,base);
      shipment=parsed||parseTimeline(pageText+'\n'+networkText,mawb,base)||shipment;
    }
    if(!shipment?.arrivalIsActual){const external=await fetchPlaneFinderActual(mawb,{...base,...shipment});if(external)shipment=external;}
    if(!shipment?.flightNo){
      console.warn('cathay_booking_card_incomplete',mawb,
        JSON.stringify({clicked,prefixFilled:prefixEntry?.ok,awbFilled:awbEntry?.ok,
          hasAwb:cathayAwbInText(pageText,mawb),
          hasBookingStatus:/Booking\s+Status/i.test(pageText),
          hasAllotment:/Confirmed\s*\(allotment\)/i.test(pageText),
          networkResponses:usefulNetwork.length,
          pageSample:pageText.replace(/\s+/g,' ').slice(0,900)}));
    }
    const networkDebug=usefulNetwork.slice(-12).map(x=>({url:x.url,status:x.status,sample:x.body.slice(0,1200)}));
    return shipment?{ok:true,shipment,debug:{prefixEntry,awbEntry,clicked,popupClicked,pageSample:pageText.slice(0,4500),network:networkDebug}}:{ok:false,reason:'CATHAY ARRIVAL NOT EXTRACTED',debug:{prefixEntry,awbEntry,clicked,popupClicked,pageSample:pageText.slice(0,4500),network:networkDebug}};
  }catch(e){
    const external=await fetchPlaneFinderActual(mawb,base);if(external)return{ok:true,shipment:external,debug:{fallbackAfterBrowserError:true,error:e?.message||String(e)}};
    return{ok:false,reason:e?.message||String(e),debug:{network:network.slice(-8).map(x=>({url:x.url,status:x.status,sample:x.body.slice(0,800)}))}};
  }finally{try{if(browser)await browser.close();}catch{}}
}
);
    await clickText(page,'^(show all details|show details|view details|expand)$');
    await clickText(page,'^Local$');
    await sleep(450);
    for(let i=0;i<14;i++){await page.evaluate(y=>window.scrollTo(0,y),i*450).catch(()=>{});await sleep(220);}pageText=await deepText(page);
    let shipment=parseCathayBookingStatus(pageText,mawb,base)||
      parseTimeline(pageText,mawb,base)||parseCathayBookingOverview(pageText,mawb);
    if(!shipment?.flightNo&&/Booking\s+Status/i.test(pageText)){
      // If the first render showed only Booking Received, allow the
      // expanded allotment card to hydrate before declaring extraction failed.
      for(let i=0;i<10;i++){
        await sleep(500);
        const updatedText=await deepText(page);
        const richer=parseCathayBookingStatus(updatedText,mawb,base);
        if(richer){shipment=richer;pageText=updatedText;break;}
      }
    }
    if(!shipment?.arrivalIsActual){popupClicked=await clickViewFlight(page);if(popupClicked){await sleep(700);const popupText=await deepText(page);shipment=parseTimeline(`${pageText}\n${popupText}`,mawb,base)||shipment;pageText=`${pageText}\n${popupText}`;}}
    const usefulNetwork=network.filter(x=>!/static\/js|clientlibs|qualtrics|chatbot|akam/i.test(x.url));
    if(!shipment?.arrivalIsActual){
      const networkText=usefulNetwork.filter(x=>x.body.includes(serial)).map(x=>x.body).join('\n');
      const parsed=parseCathayBookingStatus(pageText+'\n'+networkText,mawb,base);
      shipment=parsed||parseTimeline(pageText+'\n'+networkText,mawb,base)||shipment;
    }
    if(!shipment?.arrivalIsActual){const external=await fetchPlaneFinderActual(mawb,{...base,...shipment});if(external)shipment=external;}
    if(!shipment?.flightNo){
      console.warn('cathay_booking_card_incomplete',mawb,
        JSON.stringify({clicked,prefixFilled:prefixEntry?.ok,awbFilled:awbEntry?.ok,
          hasAwb:cathayAwbInText(pageText,mawb),
          hasBookingStatus:/Booking\s+Status/i.test(pageText),
          hasAllotment:/Confirmed\s*\(allotment\)/i.test(pageText),
          networkResponses:usefulNetwork.length,
          pageSample:pageText.replace(/\s+/g,' ').slice(0,900)}));
    }
    const networkDebug=usefulNetwork.slice(-12).map(x=>({url:x.url,status:x.status,sample:x.body.slice(0,1200)}));
    return shipment?{ok:true,shipment,debug:{prefixEntry,awbEntry,clicked,popupClicked,pageSample:pageText.slice(0,4500),network:networkDebug}}:{ok:false,reason:'CATHAY ARRIVAL NOT EXTRACTED',debug:{prefixEntry,awbEntry,clicked,popupClicked,pageSample:pageText.slice(0,4500),network:networkDebug}};
  }catch(e){
    const external=await fetchPlaneFinderActual(mawb,base);if(external)return{ok:true,shipment:external,debug:{fallbackAfterBrowserError:true,error:e?.message||String(e)}};
    return{ok:false,reason:e?.message||String(e),debug:{network:network.slice(-8).map(x=>({url:x.url,status:x.status,sample:x.body.slice(0,800)}))}};
  }finally{try{if(browser)await browser.close();}catch{}}
}
)||clicked;
      await page.keyboard.press('Enter').catch(()=>{});
      for(let i=0;i<16;i++){
        await sleep(400);pageText=await allCathayTabText(browser);
        if(/Current\s+status\s*:|Booking\s+Status|\b[A-Z]{3}\s+(?:Accepted|Departed|Arrived)\b/i.test(pageText))break;
      }
    }
    // Cathay collapses Booking Status before warehouse acceptance.
    await clickText(page,'^Booking\\s+Status$');
    await clickText(page,'^(show all details|show details|view details|expand)$');
    await clickText(page,'^Local$');
    await sleep(450);
    for(let i=0;i<14;i++){await page.evaluate(y=>window.scrollTo(0,y),i*450).catch(()=>{});await sleep(220);}pageText=await deepText(page);
    let shipment=parseCathayBookingStatus(pageText,mawb,base)||
      parseTimeline(pageText,mawb,base)||parseCathayBookingOverview(pageText,mawb);
    if(!shipment?.flightNo&&/Booking\s+Status/i.test(pageText)){
      // If the first render showed only Booking Received, allow the
      // expanded allotment card to hydrate before declaring extraction failed.
      for(let i=0;i<10;i++){
        await sleep(500);
        const updatedText=await deepText(page);
        const richer=parseCathayBookingStatus(updatedText,mawb,base);
        if(richer){shipment=richer;pageText=updatedText;break;}
      }
    }
    if(!shipment?.arrivalIsActual){popupClicked=await clickViewFlight(page);if(popupClicked){await sleep(700);const popupText=await deepText(page);shipment=parseTimeline(`${pageText}\n${popupText}`,mawb,base)||shipment;pageText=`${pageText}\n${popupText}`;}}
    const usefulNetwork=network.filter(x=>!/static\/js|clientlibs|qualtrics|chatbot|akam/i.test(x.url));
    if(!shipment?.arrivalIsActual){
      const networkText=usefulNetwork.filter(x=>x.body.includes(serial)).map(x=>x.body).join('\n');
      const parsed=parseCathayBookingStatus(pageText+'\n'+networkText,mawb,base);
      shipment=parsed||parseTimeline(pageText+'\n'+networkText,mawb,base)||shipment;
    }
    if(!shipment?.arrivalIsActual){const external=await fetchPlaneFinderActual(mawb,{...base,...shipment});if(external)shipment=external;}
    if(!shipment?.flightNo){
      console.warn('cathay_booking_card_incomplete',mawb,
        JSON.stringify({clicked,prefixFilled:prefixEntry?.ok,awbFilled:awbEntry?.ok,
          hasAwb:cathayAwbInText(pageText,mawb),
          hasBookingStatus:/Booking\s+Status/i.test(pageText),
          hasAllotment:/Confirmed\s*\(allotment\)/i.test(pageText),
          networkResponses:usefulNetwork.length,
          pageSample:pageText.replace(/\s+/g,' ').slice(0,900)}));
    }
    const networkDebug=usefulNetwork.slice(-12).map(x=>({url:x.url,status:x.status,sample:x.body.slice(0,1200)}));
    return shipment?{ok:true,shipment,debug:{prefixEntry,awbEntry,clicked,popupClicked,pageSample:pageText.slice(0,4500),network:networkDebug}}:{ok:false,reason:'CATHAY ARRIVAL NOT EXTRACTED',debug:{prefixEntry,awbEntry,clicked,popupClicked,pageSample:pageText.slice(0,4500),network:networkDebug}};
  }catch(e){
    const external=await fetchPlaneFinderActual(mawb,base);if(external)return{ok:true,shipment:external,debug:{fallbackAfterBrowserError:true,error:e?.message||String(e)}};
    return{ok:false,reason:e?.message||String(e),debug:{network:network.slice(-8).map(x=>({url:x.url,status:x.status,sample:x.body.slice(0,800)}))}};
  }finally{try{if(browser)await browser.close();}catch{}}
}
