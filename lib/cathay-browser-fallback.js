import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import {parseCathaySeptemberBookingStatus,parseCathaySeptemberTimeline} from './cathay-september-browser-fallback.js';

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
function parseIsoLocal(value=''){
  const m=String(value||'').match(/^(20\d{2})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  return m?{date:`${m[1]}-${m[2]}-${m[3]}`,time:`${m[4]}:${m[5]}`}:{date:'',time:''};
}
function parseCathayApiDate(value=''){
  const s=String(value||'').toUpperCase().trim();
  if(s.length!==7)return'';
  const day=s.slice(0,2),monRaw=s.slice(2,5),yy=s.slice(5,7);
  const mon=monRaw==='SEPT'?'SEP':monRaw;
  if(!MONTH[mon]||!Number.isFinite(Number(day))||!Number.isFinite(Number(yy)))return'';
  const year=Number(yy)>=70?'19'+yy:'20'+yy;
  return year+'-'+MONTH[mon]+'-'+day;
}
export function parseCathayTrackingApi(body='',mawb='',base={}){
  let data=null;try{data=JSON.parse(body)}catch{return null}
  const onlyDigits=value=>String(value||'').split('').filter(ch=>ch>='0'&&ch<='9').join('');
  const full=onlyDigits(mawb),serial=full.slice(3);
  // Cathay may report either the 8-digit serial or complete 11-digit MAWB.
  // Only accept responses with an exact AWB match, never a generic web shell.
  const candidates=[data,data?.result,data?.data,data?.shipment]
    .flatMap(x=>Array.isArray(x)?x:[x]).filter(x=>x&&typeof x==='object');
  const matched=candidates.find(x=>{
    const number=onlyDigits(x.AWBNumber||x.awbNumber||x.airWaybillNumber||x.awbNo||x.awb);
    return number&&(number===serial||number===full);
  });
  if(!matched)return null;
  data=matched;
  const routing=Array.isArray(data.routing)?data.routing[0]||{}:{};
  const directBooking=Array.isArray(data.bookingStatus)?data.bookingStatus[0]||{}:{};
  const nestedBooking=Array.isArray(data.bookingInfo)?data.bookingInfo.flatMap(x=>Array.isArray(x?.bookingStatuses)?x.bookingStatuses:[])[0]||{}:{};
  const b=Object.keys(directBooking).length?directBooking:nestedBooking;
  const origin=String(routing.origin||data.bookingInfo?.[0]?.from||base.origin||'').toUpperCase();
  const destination=String(routing.destination||data.bookingInfo?.[0]?.to||base.destination||'').toUpperCase();
  const flightNo=String(b.flight||base.flightNo||'').split('/')[0].trim().toUpperCase();
  const depActual=parseIsoLocal(b.ATD),depEstimated=parseIsoLocal(b.ETD),depScheduled=parseIsoLocal(b.STD);
  const arrActual=parseIsoLocal(b.ATA),arrEstimated=parseIsoLocal(b.ETA),arrScheduled=parseIsoLocal(b.STA);
  const departure=depActual.date?depActual:depEstimated.date?depEstimated:depScheduled;
  const arrival=arrActual.date?arrActual:arrEstimated.date?arrEstimated:arrScheduled;
  const latest=String(data.latestStatus?.status||b.status||'').toUpperCase();
  const arrived=Boolean(arrActual.date&&arrActual.time)||latest.includes('ARRIVED')||latest.includes('RCF');
  const delivered=latest.includes('DELIVER');
  const departed=Boolean(depActual.date&&depActual.time)||latest.includes('DEPART');
  const status=delivered?'DELIVERED':arrived?'ARRIVED':departed?'IN TRANSIT':'BOOKED';
  const pieces=String(data.pieces||b.pieces||base.pieces||base.bags||'');
  const weight=String(data.weight?.value??b.weight??base.weight??'').replaceAll(',','');
  const shipment={
    mawb,carrierCode:'CX',airlineName:'Cathay Cargo',origin,destination,bags:pieces,pieces,weight,flightNo,
    bookingDate:parseCathayApiDate(data.date)||base.bookingDate||'',
    departureDate:departure.date||base.departureDate||'',
    departureTime:departure.time||base.departureTime||'',
    arrivalDate:arrival.date||base.arrivalDate||'',
    arrivalTime:arrival.time||base.arrivalTime||'',
    arrivalIsActual:Boolean(arrActual.date&&arrActual.time),
    status,officialTracker:CATHAY,source:'Cathay Cargo official tracking API',
    arrivalTimeSource:arrActual.date?'Cathay API actual arrival':arrEstimated.date?'Cathay API estimated arrival':'Cathay API scheduled arrival'
  };
  if(arrScheduled.date){shipment.scheduledArrivalDate=arrScheduled.date;shipment.scheduledArrivalTime=arrScheduled.time||'';}
  return shipment;
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
// September Booking Status sits below the shipment summary, sometimes inside
// an iframe, shadow root or its own scrollable card. Read the lower card itself,
// not just the first viewport. This never manufactures a flight or ETA.
async function readCathayBookingPanel(browser){
  const parts=[];
  for(const tab of await browser.pages().catch(()=>[])){
    if(tab.isClosed())continue;
    for(const frame of tab.frames()){
      const text=await frame.evaluate(()=>{
        const roots=[document],seen=new Set(),matches=[];
        for(let i=0;i<roots.length;i++){
          const root=roots[i];
          for(const el of root.querySelectorAll('*')){
            try{if(el.shadowRoot&&!seen.has(el.shadowRoot)){seen.add(el.shadowRoot);roots.push(el.shadowRoot);}}catch{}
            const label=(el.innerText||el.textContent||'').replace(/\s+/g,' ').trim();
            if(label.length>75||!/^(?:booking status|booking details|booking information)$/i.test(label))continue;
            matches.push(el);
          }
        }
        const found=[];
        for(const heading of matches.slice(0,8)){
          heading.scrollIntoView({block:'center',inline:'nearest'});
          const control=heading.closest('summary,button,[role="button"],[aria-expanded]');
          if(control?.getAttribute('aria-expanded')==='false')control.click();
          // Look into the heading's siblings and nearest section ancestors;
          // the Booking Status card may be outside document.body.innerText.
          let node=heading;
          for(let i=0;i<5&&node;i++,node=node.parentElement){
            const snippet=(node.innerText||node.textContent||'').trim();
            if(snippet.length>60&&snippet.length<15000&&
               /CX\s*\d{1,4}|Confirmed|Scheduled|Estimated|Actual|Allotment/i.test(snippet)){
              found.push(snippet);break;
            }
            if(node.nextElementSibling){
              const sibling=(node.nextElementSibling.innerText||
                node.nextElementSibling.textContent||'').trim();
              if(sibling.length>40&&sibling.length<12000)found.push(sibling);
            }
          }
        }
        return found.join('\n');
      }).catch(()=>'');
      if(text)parts.push(text);
    }
  }
  return [...new Set(parts)].join('\n');
}

async function scrollCathayTabs(browser,step){
  for(const tab of await browser.pages().catch(()=>[])){
    if(tab.isClosed())continue;
    for(const frame of tab.frames())await frame.evaluate(y=>{
      // The Booking Details area can live inside an internally scrollable panel.
      const all=[document.scrollingElement,document.documentElement,document.body,
        ...document.querySelectorAll('*')].filter(Boolean);
      const scrollable=[...new Set(all)].filter(el=>
        el.scrollHeight>el.clientHeight+80&&el.clientHeight>60);
      for(const el of scrollable.slice(0,15)){
        const target=Math.min(el.scrollHeight-el.clientHeight,y*440);
        if(el.scrollTop<target)el.scrollTop=target;
      }
      window.scrollTo(0,y*440);
    },step).catch(()=>{});
  }
}
async function revealCathayBookingDetails(browser){
  let found=false;
  for(const tab of await browser.pages().catch(()=>[])){
    if(tab.isClosed())continue;
    for(const frame of tab.frames()){
      const opened=await frame.evaluate(()=>{
        const roots=[document],nodes=[],seen=new Set();
        for(let i=0;i<roots.length;i++){
          const root=roots[i];
          for(const el of root.querySelectorAll('*')){
            if(el.shadowRoot&&!seen.has(el.shadowRoot)){seen.add(el.shadowRoot);roots.push(el.shadowRoot);}
            const label=(el.innerText||el.getAttribute('aria-label')||'').trim();
            if(label.length<90&&/^(BOOKING\s+(?:STATUS|DETAILS|INFORMATION)|VIEW\s+BOOKING\s+DETAILS)$/i.test(label))nodes.push(el);
          }
        }
        const target=nodes.sort((a,b)=>(a.innerText||'').length-(b.innerText||'').length)[0];
        if(!target)return false;
        target.scrollIntoView({block:'center',inline:'nearest'});
        const control=target.closest('summary,button,[role="button"],[aria-expanded]');
        if(control&&control.getAttribute('aria-expanded')==='false')control.click();
        else if(control&&control.tagName==='SUMMARY'&&!control.parentElement?.open)control.click();
        return true;
      }).catch(()=>false);
      if(opened)found=true;
    }
  }
  return found;
}
// Cathay's input is controlled by its frontend. A programmatic value can look
// filled while the booking lookup state stays empty. Use physical key events.
async function typeCathayAwbAsUser(page,serial){
  for(const frame of page.frames()){
    const focused=await frame.evaluate(()=>{
      const visible=el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();
        return s.display!=='none'&&s.visibility!=='hidden'&&r.width>8&&r.height>8&&!el.disabled;};
      const fields=[...document.querySelectorAll('input,textarea')].filter(el=>visible(el)&&!el.closest('header,nav,[role="search"]')&&String(el.type||'').toLowerCase()!=='search');
      const meta=el=>[el.name,el.id,el.placeholder,el.getAttribute('aria-label')].filter(Boolean).join(' ');
      const prefix=fields.find(el=>/airline\s*code|carrier\s*code|awb\s*prefix|prefix/i.test(meta(el)));
      const field=fields.find(el=>el!==prefix&&/air\s*waybill|airway\s*bill|airwaybill|\bawb\b|waybill/i.test(meta(el)))||
        fields.find(el=>el!==prefix&&el.maxLength===8&&!/search/i.test(meta(el)));
      if(!field)return false;
      field.scrollIntoView({block:'center'});field.focus();
      if(typeof field.select==='function')field.select();
      return true;
    }).catch(()=>false);
    if(!focused)continue;
    await page.keyboard.press('Control+A').catch(()=>{});
    await page.keyboard.type(serial,{delay:45}).catch(()=>{});
    await sleep(350);
    const value=await frame.evaluate(()=>String(document.activeElement?.value||'').replace(/\D/g,'')).catch(()=>'');
    if(value===serial)return true;
  }
  return false;
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
// Click the tracking form, not a similarly named navigation link.
async function clickCathayTrackingSubmit(page){
  for(const frame of page.frames()){
    const pressed=await frame.evaluate(()=>{
      const roots=[document],seen=new Set();
      const visible=el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();
        return s.display!=='none'&&s.visibility!=='hidden'&&r.width>8&&r.height>8&&!el.disabled;};
      const label=el=>(el.innerText||el.value||el.textContent||el.getAttribute('aria-label')||'').replace(/\s+/g,' ').trim();
      for(let i=0;i<roots.length;i++){
        const root=roots[i];
        const fields=[...root.querySelectorAll('input')];
        const awb=fields.find(el=>!el.closest('header,nav,[role="search"]')&&/waybill|\bawb\b/i.test([el.name,el.id,el.placeholder,el.getAttribute('aria-label')].join(' ')));
        // Never click the site's generic Search control when the AWB form is absent.
        const form=awb?.closest('form');
        const scope=form||awb?.closest('section,[class*="track"],[class*="shipment"]')||root;
        const candidates=[...scope.querySelectorAll('button,input[type="submit"],[role="button"]')];
        const match=awb&&candidates.find(el=>visible(el)&&!el.closest('header,nav,[role="search"]')&&/^(?:track(?: (?:now|cargo|shipment|your shipment))?|search shipment)$/i.test(label(el)));
        if(match){match.click();return true;}
        for(const el of root.querySelectorAll('*'))if(el.shadowRoot&&!seen.has(el.shadowRoot)){seen.add(el.shadowRoot);roots.push(el.shadowRoot);}
      }
      return false;
    }).catch(()=>false);
    if(pressed)return true;
  }
  return false; // Never fall back to Cathay's unrelated global Search navigation.
}
async function clickViewFlight(page){
  if(await clickText(page,'^view\\s+flight$'))return true;
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
      el=candidates.find(x=>x!==prefixEl&&!x.closest('header,nav,[role="search"]')&&/air\s*waybill|airway\s*bill|airwaybill|\bawb\b|waybill/i.test(meta(x))&&!/airline\s*code|prefix|search/i.test(meta(x)))||candidates.find(x=>x!==prefixEl&&!x.closest('header,nav,[role="search"]')&&String(x.maxLength||'')==='8'&&!/search/i.test(meta(x)));
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
  // Cathay may group the eight-digit serial (18863806 -> 1886 3806).
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
  // October parser recovery: the first "Booking Status" can be a menu or
  // empty overview. Prefer the lower AWB-specific confirmed allotment card.
  const markers=[...flat.matchAll(/Booking\s+(?:Status|Details|Information)/gi)];
  if(!markers.length)return null;
  const sections=markers.map(m=>{
    const tail=flat.slice(m.index),end=tail.search(/Shipment\s+History/i);
    return end>0?tail.slice(0,Math.min(end,6500)):tail.slice(0,6500);
  });
  const score=s=>(/Confirmed\s*(?:\(allotment\)|allotment)/i.test(s)?4:0)+
    (/\bCX\s*\d{2,4}\b/i.test(s)?3:0)+
    (/\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[A-Z]*(?:\s+20\d{2})?\s+\d{1,2}:\d{2}/i.test(s)?2:0);
  const block=sections.reduce((best,s)=>score(s)>=score(best)?s:best,'');
  const route=block.match(/\b([A-Z]{3})\s+to\s+([A-Z]{3})\b/i);
  const overview=parseCathayBookingOverview(flat,mawb);
  const origin=(route?.[1]||overview?.origin||base.origin||'').toUpperCase();
  const destination=(route?.[2]||overview?.destination||base.destination||'').toUpperCase();
  const card=block.match(/\b(?:Confirmed\s*\(allotment\)|Confirmed\s+allotment)[\s\S]{0,140}?\b(CX\s*\d{2,4})\s+(\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[A-Z]*\s+20\d{2})\b/i);
  const freshFlight=(card?.[1]||block.match(/\bCX\s*\d{2,4}\b/i)?.[0]||'').replace(/\s+/g,'').toUpperCase();
  const flightDate=card?parseShortDate(card[2]+' 00:00').date:'';
  const fallbackYear=flightDate.slice(0,4)||String(base.departureDate||base.bookingDate||'').slice(0,4)||String(new Date().getUTCFullYear());
  const events=[...block.matchAll(/\b([A-Z]{3})\b[\s|:–-]*(?:Departure\s+|Arrival\s+)?(\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[A-Z]*(?:\s+20\d{2})?\s+\d{1,2}:\d{2})\s+(Actual|Estimated|Scheduled)\b/gi)]
    .map(m=>({airport:m[1].toUpperCase(),dateTime:parseShortDate(m[2],fallbackYear),kind:m[3].toUpperCase()}));
  // October 20 ZIP recovery: some booking cards put the event label before
  // the clock, or separate the airport and time with small UI labels.
  // Only accept an exact AWB-matched page (checked above), and do not let
  // a neighbouring origin/destination station claim the other's time.
  const datePattern='(\\d{1,2}\\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[A-Z]*(?:\\s+20\\d{2})?\\s+\\d{1,2}:\\d{2})';
  for(const airport of [...new Set([origin,destination].filter(Boolean))]){
    const leading=new RegExp('\\b'+airport+'\\b\\s*(?:Departure|Arrival)?\\s*(Actual|Estimated|Scheduled)\\s+'+datePattern,'gi');
    const trailing=new RegExp('\\b'+airport+'\\b[\\s\\S]{0,110}?'+datePattern+'\\s+(Actual|Estimated|Scheduled)\\b','gi');
    const add=(kind,raw)=>{
      if(!events.some(e=>e.airport===airport&&e.kind===kind))
        events.push({airport,kind,dateTime:parseShortDate(raw,fallbackYear)});
    };
    for(const m of block.matchAll(leading))add(m[1].toUpperCase(),m[2]);
    for(const m of block.matchAll(trailing)){
      const gap=m[0].slice(airport.length,m[0].indexOf(m[1]));
      const otherStations=[origin,destination].filter(Boolean);
      if(new RegExp('\\b(?:'+otherStations.join('|')+')\\b','i').test(gap))continue;
      add(m[2].toUpperCase(),m[1]);
    }
  }
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

/**
 * Extract the confirmed CX flight number and final-destination arrival date
 * from Cathay's lower Booking Details/Status card, including date-only cards.
 * Require the EXACT AWB on the official rendered page; a generic page
 * heading, unrelated flight, or departure date must never become an ETA.
 */
export function parseCathayBookingDateOnly(text='',mawb='',base={}){
  const flat=String(text||'').replace(/\\u003c/gi,'<')
    .replace(/\\n/g,' ').replace(/\s+/g,' ').trim();
  if(!cathayAwbInText(flat,mawb))return null;
  const markers=[...flat.matchAll(/\bBooking\s+(?:Status|Details|Information)\b/gi)];
  if(!markers.length)return null;
  const dateToken='(20\\d{2}[-/.]\\d{1,2}[-/.]\\d{1,2}|\\d{1,2}\\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[A-Z]*(?:\\s+20\\d{2})?)';
  const year=String(base.flightDate||base.departureDate||base.bookingDate||'').slice(0,4)||
    String(new Date().getUTCFullYear());
  const dateOf=value=>{
    const iso=String(value||'').match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
    if(iso)return iso[1]+'-'+pad(iso[2])+'-'+pad(iso[3]);
    const d=String(value||'').toUpperCase().match(
      /\b(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[A-Z]*(?:\s+(20\d{2}))?\b/);
    return d&&MONTH[d[2]]?(d[3]||year)+'-'+MONTH[d[2]]+'-'+pad(d[1]):'';
  };
  const sections=markers.map(m=>{
    const remainder=flat.slice(m.index),end=remainder.search(/\bShipment\s+History\b/i);
    return end>0?remainder.slice(0,Math.min(end,6500)):remainder.slice(0,6500);
  });
  const score=v=>(/\bConfirmed\s*(?:\(allotment\)|allotment)/i.test(v)?5:0)+
    (/\bFlight\s*(?:No\.?|Number)?\s*[:\-]?\s*CX\s*\d{2,4}\b/i.test(v)?3:0)+
    (/\bArrival\s*Date|\bScheduled\s*Arrival|\bETA\b/i.test(v)?2:0);
  for(const block of sections.sort((a,b)=>score(b)-score(a))){
    // The booking card, not the global site search or navigation, must
    // show a confirmed allotment or an explicit Flight No field.
    if(!/Confirmed\s*(?:\(allotment\)|allotment)|\bFlight\s*(?:No\.?|Number)\s*[:\-]?\s*CX\s*\d{2,4}\b/i.test(block))continue;
    const route=block.match(/\b([A-Z]{3})\s+to\s+([A-Z]{3})\b/i);
    const origin=(route?.[1]||base.origin||'').toUpperCase(),
      destination=(route?.[2]||base.destination||'').toUpperCase();
    if(!/^[A-Z]{3}$/.test(origin)||!/^[A-Z]{3}$/.test(destination))continue;
    if(base.origin&&origin!==String(base.origin).toUpperCase())continue;
    if(base.destination&&destination!==String(base.destination).toUpperCase())continue;
    const match=block.match(/(?:\bFlight\s*(?:No\.?|Number)\s*[:\-]?\s*|\bConfirmed\s*(?:\(allotment\)|allotment)[\s\S]{0,160}?)\b(CX\s*\d{2,4})\b/i);
    if(!match)continue;
    const flightNo=match[1].replace(/\s+/g,'').toUpperCase();
    const flightInBlock=new RegExp('\\b'+flightNo.replace(/^CX/,'CX\\s*')+
      '\\b[\\s\\S]{0,75}?'+dateToken,'i');
    const flightDate=dateOf(block.match(flightInBlock)?.[1]);
    const labelAtDestination=new RegExp(
      '\\b(?:'+destination+'\\s+(?:Arrival(?:\\s+Date)?|ETA)|'+
      '(?:Arrival(?:\\s+Date)?|Scheduled\\s+Arrival|Estimated\\s+Arrival|ETA)\\s*(?:at|to|for)?\\s*'+destination+
      '|Arrival\\s+Date\\s*[:\\-]?)\\s*[:\\-]?\\s*'+dateToken,'i');
    const arrivalMatch=block.match(labelAtDestination);
    const arrivalDate=dateOf(arrivalMatch?.[1]);
    // A flight's date is its booked departure date, not destination arrival.
    // Only a destination-linked arrival label supplies an arrival date.
    if(!flightDate&&!arrivalDate&&!/Confirmed\s*(?:\(allotment\)|allotment)/i.test(block))continue;
    const out={mawb,carrierCode:'CX',airlineName:'Cathay Cargo',
      origin,destination,flightNo,flightDate,
      arrivalIsActual:false,status:'BOOKED',officialTracker:CATHAY,
      source:'Cathay Cargo verified lower Booking Details'};
    if(arrivalDate){
      out.arrivalDate=arrivalDate;
      out.arrivalTime='';
      out.arrivalEstimate=true;
      out.scheduledArrivalDate=arrivalDate;
      out.scheduledArrivalTime='';
      out.arrivalTimeSource='Cathay Booking Details scheduled arrival date (time pending)';
    }
    return out;
  }
  return null;
}

function parseCathayBookingCombined(text='',mawb='',base={}){
  const full=parseCathayBookingStatus(text,mawb,base);
  const dated=parseCathayBookingDateOnly(text,mawb,base);
  if(!dated)return full;
  if(!full)return dated;
  // The confirmed flight number must be the same before combining separate
  // clock and date-only cards. Never attach another flight's arrival.
  if(full.flightNo&&dated.flightNo&&full.flightNo!==dated.flightNo)return full;
  const out={...full};
  if(!out.flightNo)out.flightNo=dated.flightNo;
  if(!out.flightDate&&dated.flightDate)out.flightDate=dated.flightDate;
  if(!out.arrivalDate&&dated.arrivalDate){
    out.arrivalDate=dated.arrivalDate;
    out.arrivalEstimate=true;
    out.scheduledArrivalDate=dated.scheduledArrivalDate;
    out.arrivalTimeSource=dated.arrivalTimeSource;
  }
  return out;
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
  if(live.flightNo)out.flightNo=live.flightNo;
  if(live.flightDate)out.flightDate=live.flightDate;
  if(live.scheduledArrivalDate&&!out.scheduledArrivalDate)out.scheduledArrivalDate=live.scheduledArrivalDate;
  if(live.arrivalTimeSource&&!out.arrivalIsActual&&!out.arrivalTimeSource)out.arrivalTimeSource=live.arrivalTimeSource;
  if(live.departureDate)out.departureDate=live.departureDate;if(live.departureTime)out.departureTime=live.departureTime;
  if(live.arrivalIsActual){if(live.arrivalDate)out.arrivalDate=live.arrivalDate;if(live.arrivalTime)out.arrivalTime=live.arrivalTime;out.arrivalIsActual=true;out.status=live.status||'ARRIVED';out.arrivalTimeSource=live.arrivalTimeSource;out.source=live.source||'Cathay Cargo arrival fallback + existing Cathay parser';}
  else{if(!out.arrivalDate&&live.arrivalDate)out.arrivalDate=live.arrivalDate;if(!out.arrivalTime&&live.arrivalTime)out.arrivalTime=live.arrivalTime;if((!out.status||out.status==='TRACKING')&&live.status)out.status=live.status;}
  if(live.status==='DELIVERED')out.status='DELIVERED';
  return out;
}
export async function trackCathayBrowserFallback(mawb,base={}){
  const serial=String(mawb||'').replace(/\D/g,'').slice(3);let browser;const network=[];let prefixEntry=null,awbEntry=null,clicked=false,pageText='',popupClicked=false,official403=false;
  try{
    browser=await launchBrowser();const page=await browser.newPage();
    page.on('response',async response=>{
      try{
        const url=response.url(),ct=(response.headers()['content-type']||'').toLowerCase();
        if(/\/cargo-shipments\/v1\/tracking(?:[?#]|$)/i.test(url)&&response.status()===403)official403=true;
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
    awbEntry=await fillField(page,'awb',serial);
    const humanTyped=await typeCathayAwbAsUser(page,serial);
    await sleep(900);
    if(!awbEntry?.ok&&!humanTyped){
      return {ok:false,reason:'CATHAY_AWB_INPUT_NOT_FOUND',debug:{prefixEntry,awbEntry,humanTyped,clicked:false}};
    }
    clicked=await clickCathayTrackingSubmit(page);await Promise.race([page.waitForNetworkIdle({idleTime:900,timeout:10000}).catch(()=>{}),sleep(10000)]);
    for(let i=0;i<25;i++){
      pageText=await allCathayTabText(browser);
      if(official403&&!cathayAwbInText(pageText,mawb))break;
      if(cathayAwbInText(pageText,mawb)&&/Current\s+status\s*:|Booking\s+(?:Status|Details|Information)|\b[A-Z]{3}\s+(?:Accepted|Departed|Arrived)\b/i.test(pageText))break;
      await sleep(350);
    }
    if(official403&&!cathayAwbInText(pageText,mawb)){
      console.warn('cathay_public_tracking_access_denied',mawb,'HTTP 403');
      return{ok:false,reason:'CATHAY_PUBLIC_TRACKING_403',
        debug:{sourceStatus:'UPSTREAM_403',clicked,humanTyped,prefixFilled:prefixEntry?.ok,
          awbFilled:awbEntry?.ok,httpStatus:403,pageSample:pageText.slice(0,700),
          networkEndpoints:network.slice(-8).map(x=>({path:new URL(x.url).pathname,status:x.status}))}};
    }
    if(!cathayAwbInText(pageText,mawb)){
      // Retry one valid AWB search when the public page stays as an empty shell.
      await fillField(page,'awb',serial);
      await typeCathayAwbAsUser(page,serial);
      // Enter can submit Cathay's global site-search instead of shipment tracking.
      clicked=await clickCathayTrackingSubmit(page)||clicked;
      for(let i=0;i<16;i++){
        await sleep(400);pageText=await allCathayTabText(browser);
        if(cathayAwbInText(pageText,mawb)&&/Current\s+status\s*:|Booking\s+(?:Status|Details|Information)|\b[A-Z]{3}\s+(?:Accepted|Departed|Arrived)\b/i.test(pageText))break;
      }
    }
    // Cathay collapses Booking Status before warehouse acceptance.
    // Read the lower Booking Details card, not just the top AWB summary.
    await scrollCathayTabs(browser,1);
    await revealCathayBookingDetails(browser);
    await clickCathayTabText(browser,'^(show all details|show details|view details|expand)$');
    await clickCathayTabText(browser,'^Local$');
    await sleep(450);
    for(let i=0;i<14;i++){
      await scrollCathayTabs(browser,i);
      if(i===2||i===6||i===10)await revealCathayBookingDetails(browser);
      await sleep(220);
    }
    pageText=await allCathayTabText(browser);
    const lowerBookingPanel=await readCathayBookingPanel(browser);
    if(lowerBookingPanel)pageText+='\nBooking Status\n'+lowerBookingPanel;
    let shipment=parseCathayBookingCombined(pageText,mawb,base)||
      parseTimeline(pageText,mawb,base)||parseCathayBookingOverview(pageText,mawb);
    if((!shipment?.flightNo||!shipment?.arrivalDate||!shipment?.arrivalTime)&&/Booking\s+(?:Status|Details|Information)/i.test(pageText)){
      // If the first render showed only Booking Received, allow the
      // expanded allotment card to hydrate before declaring extraction failed.
      for(let i=0;i<10;i++){
        await sleep(500);
        await revealCathayBookingDetails(browser);
        const updatedText=(await allCathayTabText(browser))+'\n'+(await readCathayBookingPanel(browser));
        const richer=parseCathayBookingCombined(updatedText,mawb,base);
        if(richer){shipment=richer;pageText=updatedText;break;}
      }
    }
    if(!shipment?.arrivalIsActual){
      for(const tab of await browser.pages()){
        if(tab.isClosed())continue;
        popupClicked=await clickViewFlight(tab);
        if(popupClicked)break;
      }
      if(popupClicked){
        await sleep(700);
        const popupText=await allCathayTabText(browser);
        shipment=parseCathayBookingCombined(`${pageText}\n${popupText}`,mawb,base)||
          parseTimeline(`${pageText}\n${popupText}`,mawb,base)||shipment;
        pageText=`${pageText}\n${popupText}`;
      }
    }
    const usefulNetwork=network.filter(x=>!/static\/js|clientlibs|qualtrics|chatbot|akam/i.test(x.url));
    // October 2026 backup: parse only exact-AWB official tracking JSON.
    // The current Booking Status/flight-card parsers remain authoritative
    // when the carrier's JSON endpoint is blocked or supplies no record.
    const octoberApi=usefulNetwork.filter(x=>x.status===200)
      .map(x=>parseCathayTrackingApi(x.body,mawb,{...base,...shipment}))
      .find(Boolean)||null;
    if(octoberApi)shipment=shipment?
      mergeCathayBrowserFallback(shipment,octoberApi):octoberApi;
    if(!shipment?.arrivalIsActual){
      const networkText=usefulNetwork.filter(x=>x.body.replace(/[^0-9]/g,'').includes(serial)||x.body.includes(serial)).map(x=>x.body).join('\n');
      const parsed=parseCathayBookingCombined(pageText+'\n'+networkText,mawb,base);
      shipment=parsed||parseTimeline(pageText+'\n'+networkText,mawb,base)||shipment;
    }
    // September 19 ZIP's original lower Booking Status/flight-card extractor.
    // Run it only after the CURRENT public page visibly confirms this exact
    // master AWB. The September parser on its own has no AWB-boundary guard.
    if(cathayAwbInText(pageText,mawb)){
      const september=parseCathaySeptemberBookingStatus(pageText,mawb,base)||
        parseCathaySeptemberTimeline(pageText,mawb,base);
      const routeMatches=september&&september.origin&&september.destination&&
        (!base.origin||september.origin===base.origin)&&
        (!base.destination||september.destination===base.destination);
      if(routeMatches&&
        (!shipment||(!shipment.arrivalIsActual&&september.arrivalIsActual===true))){
        shipment=mergeCathayBrowserFallback(shipment||base,september);
        shipment.cxSeptemberZipFallbackUsed=true;
      }
    }
    if(!shipment?.arrivalIsActual){const external=await fetchPlaneFinderActual(mawb,{...base,...shipment});if(external)shipment=external;}
    if(!shipment?.flightNo){
      console.warn('cathay_booking_card_incomplete',mawb,
        JSON.stringify({clicked,humanTyped,prefixFilled:prefixEntry?.ok,awbFilled:awbEntry?.ok,
          hasAwb:cathayAwbInText(pageText,mawb),
          hasBookingStatus:/Booking\s+Status/i.test(pageText),
          hasAllotment:/Confirmed\s*\(allotment\)/i.test(pageText),
          networkResponses:usefulNetwork.length,
           networkEndpoints:usefulNetwork.slice(-8).map(x=>({path:new URL(x.url).pathname.slice(0,95),http:x.status,containsAwb:x.body.includes(serial)})),
          pageSample:pageText.replace(/\s+/g,' ').slice(0,900)}));
    }
    const networkDebug=usefulNetwork.slice(-12).map(x=>({url:x.url,status:x.status,sample:x.body.slice(0,1200)}));
    return shipment?{ok:true,shipment,debug:{prefixEntry,awbEntry,humanTyped,clicked,popupClicked,pageSample:pageText.slice(0,4500),network:networkDebug}}:{ok:false,reason:official403?'CATHAY_PUBLIC_TRACKING_403':'CATHAY ARRIVAL NOT EXTRACTED',debug:{prefixEntry,awbEntry,clicked,popupClicked,httpStatus:official403?403:undefined,pageSample:pageText.slice(0,4500),network:networkDebug}};
  }catch(e){
    const external=await fetchPlaneFinderActual(mawb,base);if(external)return{ok:true,shipment:external,debug:{fallbackAfterBrowserError:true,error:e?.message||String(e)}};
    return{ok:false,reason:e?.message||String(e),debug:{network:network.slice(-8).map(x=>({url:x.url,status:x.status,sample:x.body.slice(0,800)}))}};
  }finally{try{if(browser)await browser.close();}catch{}}
}
