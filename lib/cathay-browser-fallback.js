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
function parseBookingStatus(text='',mawb='',base={}){
  const flat=String(text||'').replace(/\\u003c/gi,'<').replace(/\\n/g,' ').replace(/\s+/g,' ').trim();
  const marker=flat.search(/Booking\s+Status/i);if(marker<0)return null;
  const tail=flat.slice(marker),end=tail.search(/Shipment\s+History/i),block=end>0?tail.slice(0,end):tail.slice(0,4200);
  const route=block.match(/\b([A-Z]{3})\s+to\s+([A-Z]{3})\b/i)
    || block.match(/(?:Origin|From)\s*[:\-]?\s*([A-Z]{3})[\s\S]{0,140}?(?:Destination|To)\s*[:\-]?\s*([A-Z]{3})/i);
  const origin=(route?.[1]||base.origin||'').toUpperCase(),destination=(route?.[2]||base.destination||'').toUpperCase();
  const fallbackYear=String(base.departureDate||base.bookingDate||'').slice(0,4)||String(new Date().getUTCFullYear());
  const flightNo=(block.match(/\bCX\s*\d{2,4}\b/i)?.[0]||base.flightNo||'').replace(/\s+/g,'').toUpperCase();

  const actuals=[...block.matchAll(/\b([A-Z]{3})\b[\s\S]{0,110}?(\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[A-Z]*(?:\s+20\d{2})?\s+\d{1,2}:\d{2})\s+Actual\b/gi)]
    .map(m=>({airport:m[1].toUpperCase(),dt:parseShortDate(m[2],fallbackYear)}));
  const depActual=actuals.find(x=>x.airport===origin)?.dt||{date:'',time:''};
  const arrActual=actuals.find(x=>x.airport===destination)?.dt||{date:'',time:''};

  function stationTime(code=''){
    if(!code)return{date:'',time:'',label:''};
    const rx=new RegExp('\\b'+code+'\\b[\\s\\S]{0,180}?(\\d{1,2}\\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[A-Z]*(?:\\s+20\\d{2})?\\s+\\d{1,2}:\\d{2})(?:\\s+(Actual|Estimated|Scheduled))?','i');
    const m=block.match(rx);if(!m)return{date:'',time:'',label:''};
    return{...parseShortDate(m[1],fallbackYear),label:String(m[2]||'').toUpperCase()};
  }
  const depAny=stationTime(origin),arrAny=stationTime(destination);
  const departure=depActual.date?depActual:depAny;
  const arrival=arrActual.date?arrActual:arrAny;

  const summary=block.match(/\b(\d{1,5})\s*pc\(s\)\s*[|｜]\s*([\d,.]+)\s*kg\b/i)
    || block.match(/\b(\d{1,5})\s*(?:pcs?|pieces?)\b[\s\S]{0,50}?\b([\d,.]+)\s*kg\b/i);
  const pieces=summary?.[1]||base.pieces||base.bags||'',weight=(summary?.[2]||base.weight||'').replace(/,/g,'');
  const delivered=/Current\s+status\s*:\s*Delivered/i.test(block)||/\bDelivered\b/i.test(block);
  const arrived=Boolean(arrActual.date&&arrActual.time)||delivered;
  const departed=Boolean(depActual.date&&depActual.time);
  const status=delivered?'DELIVERED':arrived?'ARRIVED':departed?'IN TRANSIT':'BOOKED';

  const shipment={
    mawb,carrierCode:'CX',airlineName:'Cathay Cargo',origin,destination,
    bags:pieces,pieces,weight,flightNo,
    departureDate:departure.date||base.departureDate||'',
    departureTime:departure.time||base.departureTime||'',
    arrivalDate:arrival.date||base.arrivalDate||'',
    arrivalTime:arrival.time||base.arrivalTime||'',
    arrivalIsActual:arrived&&Boolean(arrActual.date&&arrActual.time),
    status,officialTracker:CATHAY,
    source:arrived?'Cathay Cargo Booking Status actual arrival':'Cathay Cargo Booking Status',
    arrivalTimeSource:arrived?'Cathay Booking Status destination Actual time':(arrival.date?'Cathay Booking Status scheduled/estimated arrival':'')
  };
  if(arrival.date&&!shipment.arrivalIsActual){
    shipment.scheduledArrivalDate=arrival.date;
    shipment.scheduledArrivalTime=arrival.time||'';
  }
  if(!origin&&!destination&&!flightNo&&!pieces&&!weight&&!departure.date&&!arrival.date)return null;
  return shipment;
}
function parseTimeline(text='',mawb='',base={}){
  const flat=String(text||'').replace(/\\u003c/gi,'<').replace(/\\n/g,' ').replace(/\s+/g,' ').trim();
  const booking=parseBookingStatus(flat,mawb,base);if(booking)return booking;
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
    awbEntry=await fillField(page,'awb',serial);if(awbEntry.ok)await page.keyboard.press('Enter').catch(()=>{});await sleep(900);
    clicked=await clickText(page,'^track\\s*(now)?$');await Promise.race([page.waitForNetworkIdle({idleTime:900,timeout:10000}).catch(()=>{}),sleep(10000)]);
    for(let i=0;i<20;i++){pageText=await deepText(page);if(/Current\s+status\s*:/i.test(pageText)||/Booking\s+Status/i.test(pageText)||/\b[A-Z]{3}\s+(?:Accepted|Departed|Arrived)\b/i.test(pageText))break;await sleep(350);}
    await clickText(page,'^(show all details|show details|view details|expand)$');
    for(let i=0;i<14;i++){await page.evaluate(y=>window.scrollTo(0,y),i*450).catch(()=>{});await sleep(220);}pageText=await deepText(page);
    let shipment=parseBookingStatus(pageText,mawb,base)||parseTimeline(pageText,mawb,base);
    if(!shipment?.arrivalIsActual){popupClicked=await clickViewFlight(page);if(popupClicked){await sleep(700);const popupText=await deepText(page);shipment=parseTimeline(`${pageText}\n${popupText}`,mawb,base)||shipment;pageText=`${pageText}\n${popupText}`;}}
    const usefulNetwork=network.filter(x=>!/static\/js|clientlibs|qualtrics|chatbot|akam/i.test(x.url));
    if(!shipment?.arrivalIsActual){const networkText=usefulNetwork.map(x=>x.body).join('\n');shipment=parseTimeline(`${pageText}\n${networkText}`,mawb,base)||shipment;}
    if(!shipment?.arrivalIsActual){const external=await fetchPlaneFinderActual(mawb,{...base,...shipment});if(external)shipment=external;}
    const networkDebug=usefulNetwork.slice(-12).map(x=>({url:x.url,status:x.status,sample:x.body.slice(0,1200)}));
    return shipment?{ok:true,shipment,debug:{prefixEntry,awbEntry,clicked,popupClicked,pageSample:pageText.slice(0,4500),network:networkDebug}}:{ok:false,reason:'CATHAY ARRIVAL NOT EXTRACTED',debug:{prefixEntry,awbEntry,clicked,popupClicked,pageSample:pageText.slice(0,4500),network:networkDebug}};
  }catch(e){
    const external=await fetchPlaneFinderActual(mawb,base);if(external)return{ok:true,shipment:external,debug:{fallbackAfterBrowserError:true,error:e?.message||String(e)}};
    return{ok:false,reason:e?.message||String(e),debug:{network:network.slice(-8).map(x=>({url:x.url,status:x.status,sample:x.body.slice(0,800)}))}};
  }finally{try{if(browser)await browser.close();}catch{}}
}
