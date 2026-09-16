import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const CATHAY='https://www.cathaycargo.com/en-us/track-and-trace.html';
const MONTH={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',SEPT:'09',OCT:'10',NOV:'11',DEC:'12'};
const pad=v=>String(v).padStart(2,'0');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function parseShortDate(value='',fallbackYear=''){
  const m=String(value||'').toUpperCase().match(/(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[A-Z]*(?:\s+(20\d{2}))?\s+(\d{1,2}):(\d{2})/);
  if(!m)return{date:'',time:''};
  const year=m[3]||fallbackYear||String(new Date().getUTCFullYear());
  return{date:`${year}-${MONTH[m[2]]}-${pad(m[1])}`,time:`${pad(m[4])}:${m[5]}`};
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
      const nodes=[...root.querySelectorAll('button,[role="button"],a,input[type="button"],input[type="submit"]')];
      const hit=nodes.find(el=>visible(el)&&rx.test((el.innerText||el.value||el.textContent||el.getAttribute('aria-label')||el.getAttribute('title')||'').trim()));
      if(hit){hit.click();return true;}
      for(const el of root.querySelectorAll('*')){try{if(el.shadowRoot&&!seen.has(el.shadowRoot)){seen.add(el.shadowRoot);roots.push(el.shadowRoot);}}catch{}}
    }
    return false;
  },source).catch(()=>false);
}
async function clickText(page,source){
  for(const frame of page.frames())if(await clickTextInFrame(frame,source))return true;
  return false;
}
async function fillFieldInFrame(frame,kind,value){
  return frame.evaluate(({kind,value})=>{
    const visible=el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>8&&r.height>8&&!el.disabled;};
    const roots=[document],seen=new Set(),all=[];
    for(let i=0;i<roots.length;i++){
      const root=roots[i];
      all.push(...root.querySelectorAll('input,textarea,[contenteditable="true"],[role="textbox"]'));
      for(const node of root.querySelectorAll('*')){try{if(node.shadowRoot&&!seen.has(node.shadowRoot)){seen.add(node.shadowRoot);roots.push(node.shadowRoot);}}catch{}}
    }
    const candidates=all.filter(visible),meta=el=>`${el.id||''} ${el.name||''} ${el.placeholder||''} ${el.getAttribute('aria-label')||''} ${el.getAttribute('data-testid')||''}`;
    const prefixEl=candidates.find(x=>/airline\s*code|carrier\s*code|awb\s*prefix|prefix/i.test(meta(x))||String(x.placeholder||'').trim()==='160')||null;
    let el=null;
    if(kind==='prefix')el=prefixEl;
    else{
      const textLike=x=>!['hidden','checkbox','radio','submit','button','reset','file'].includes(String(x.type||'text').toLowerCase());
      el=candidates.find(x=>x!==prefixEl&&/air\s*waybill|airway\s*bill|airwaybill|\bawb\b|waybill/i.test(meta(x))&&!/airline\s*code|prefix/i.test(meta(x)))||
        candidates.find(x=>x!==prefixEl&&String(x.maxLength||'')==='8')||
        candidates.find(x=>x!==prefixEl&&textLike(x));
    }
    if(!el)return{ok:false,found:candidates.map(x=>({meta:meta(x),type:x.type||'',maxLength:x.maxLength||0,tag:x.tagName})).slice(0,20)};
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
    if(kind==='awb')for(const type of ['keydown','keypress','keyup'])el.dispatchEvent(new KeyboardEvent(type,{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true,cancelable:true}));
    el.dispatchEvent(new Event('blur',{bubbles:true}));
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
function parseTimeline(text='',mawb='',base={}){
  const flat=String(text||'').replace(/\s+/g,' ').trim();
  if(!/Current\s+status\s*:/i.test(flat)&&!/\b[A-Z]{3}\s+(?:Accepted|Departed|Arrived)\b/i.test(flat))return null;
  const milestones=[...flat.matchAll(/\b([A-Z]{3})\s+(Accepted|Departed|Arrived)\b/gi)].map(m=>({airport:m[1].toUpperCase(),event:m[2].toUpperCase()}));
  const origin=(milestones.find(x=>x.event==='DEPARTED')||milestones.find(x=>x.event==='ACCEPTED'))?.airport||'';
  const destination=[...milestones].reverse().find(x=>x.event==='ARRIVED')?.airport||'';
  const fallbackYear=String(base.departureDate||base.bookingDate||'').slice(0,4)||String(new Date().getUTCFullYear());
  const cardRx=/\b(CX\s*\d{2,4})\b[\s\S]{0,260}?(\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[A-Z]*(?:\s+20\d{2})?\s+\d{1,2}:\d{2})[\s\S]{0,220}?(\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[A-Z]*(?:\s+20\d{2})?\s+\d{1,2}:\d{2})/gi;
  const cards=[...flat.matchAll(cardRx)],card=cards.at(-1);
  const departure=card?parseShortDate(card[2],fallbackYear):{date:'',time:''},arrival=card?parseShortDate(card[3],fallbackYear):{date:'',time:''};
  const summary=flat.match(/\b(\d{1,5})\s*pc\(s\)\s*[|｜]\s*([\d,.]+)\s*kg\b/i)||flat.match(/\b(\d{1,5})\s*(?:pcs?|pieces?)\b[\s\S]{0,35}?\b([\d,.]+)\s*kg\b/i);
  const pieces=summary?.[1]||'',weight=(summary?.[2]||'').replace(/,/g,''),flightNo=(card?.[1]||flat.match(/\bCX\s*\d{2,4}\b/i)?.[0]||'').replace(/\s+/g,'').toUpperCase();
  const arrived=Boolean(destination&&milestones.some(x=>x.airport===destination&&x.event==='ARRIVED'));
  const delivered=/Current\s+status\s*:\s*Delivered/i.test(flat)||/\bDelivered\b[\s\S]{0,30}?\b(\d+)\s*\/\s*\1\b/i.test(flat);
  const status=delivered?'DELIVERED':arrived?'ARRIVED':milestones.some(x=>x.event==='DEPARTED')?'IN TRANSIT':milestones.some(x=>x.event==='ACCEPTED')?'BOOKED':'TRACKING';
  return{mawb,carrierCode:'CX',airlineName:'Cathay Cargo',origin,destination,bags:pieces,pieces,weight,flightNo,departureDate:departure.date,departureTime:departure.time,arrivalDate:arrival.date,arrivalTime:arrival.time,arrivalIsActual:Boolean(arrived&&arrival.date&&arrival.time),status,officialTracker:CATHAY,source:'Cathay Cargo official Track & Trace browser fallback',arrivalTimeSource:'Cathay flight card right-side arrival time'};
}

export function needsCathayBrowserFallback(s={}){return !s.origin||!s.destination||!s.flightNo||!s.arrivalDate||!s.arrivalTime||(!s.arrivalIsActual&&s.status!=='DELIVERED');}
export function mergeCathayBrowserFallback(base={},live={}){
  const out={...base};
  if(!out.origin&&live.origin)out.origin=live.origin;if(!out.destination&&live.destination)out.destination=live.destination;
  if(!out.bags&&live.bags)out.bags=live.bags;if(!out.pieces&&live.pieces)out.pieces=live.pieces;if(!out.weight&&live.weight)out.weight=live.weight;
  if(live.flightNo)out.flightNo=live.flightNo;if(live.departureDate)out.departureDate=live.departureDate;if(live.departureTime)out.departureTime=live.departureTime;
  if(live.arrivalIsActual){if(live.arrivalDate)out.arrivalDate=live.arrivalDate;if(live.arrivalTime)out.arrivalTime=live.arrivalTime;out.arrivalIsActual=true;out.status=live.status||'ARRIVED';out.arrivalTimeSource=live.arrivalTimeSource;out.source='Cathay Cargo official Track & Trace browser fallback + existing Cathay parser';}
  else{if(!out.arrivalDate&&live.arrivalDate)out.arrivalDate=live.arrivalDate;if(!out.arrivalTime&&live.arrivalTime)out.arrivalTime=live.arrivalTime;if((!out.status||out.status==='TRACKING')&&live.status)out.status=live.status;}
  if(live.status==='DELIVERED')out.status='DELIVERED';
  return out;
}
export async function trackCathayBrowserFallback(mawb,base={}){
  const serial=String(mawb||'').replace(/\D/g,'').slice(3);let browser;
  try{
    browser=await launchBrowser();const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({'Accept-Language':'en-US,en;q=0.9'});await page.goto(CATHAY,{waitUntil:'domcontentloaded',timeout:25000});await sleep(1800);
    await clickText(page,'^(accept all|accept cookies|allow all|agree)$');await sleep(500);
    const prefixEntry=await fillField(page,'prefix','160');await sleep(650);
    const awbEntry=await fillField(page,'awb',serial);await sleep(800);
    const clicked=await clickText(page,'^track\\s*(now)?$');
    let text='';for(let i=0;i<50;i++){text=await deepText(page);if(/Current\s+status\s*:/i.test(text)&&(/\bCX\s*\d{2,4}\b/i.test(text)||text.replace(/\D/g,'').includes(serial)))break;await sleep(500);}
    await clickText(page,'^(show all details|show details|view details|expand)$');for(let i=0;i<12;i++){await page.evaluate(y=>window.scrollTo(0,y),i*500).catch(()=>{});await sleep(220);}text=await deepText(page);
    const shipment=parseTimeline(text,mawb,base);return shipment?{ok:true,shipment,debug:{prefixEntry,awbEntry,clicked,sample:text.slice(0,3500)}}:{ok:false,reason:'CATHAY BROWSER RESULT NOT PARSED',debug:{prefixEntry,awbEntry,clicked,sample:text.slice(0,3500)}};
  }catch(e){return{ok:false,reason:e?.message||String(e)};}finally{try{if(browser)await browser.close();}catch{}}
}
