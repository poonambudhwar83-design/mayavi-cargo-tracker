import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const TRACK_URL='https://cargo.vietnamairlines.com/vn/en/shipping-guide/track-your-cargo';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const pad=v=>String(v).padStart(2,'0');
const MONTHS={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};

function normalize(value=''){
  const d=String(value).replace(/\D/g,'');
  return d.length===11?`${d.slice(0,3)}-${d.slice(3)}`:'';
}
function parseDate(segment=''){
  const s=String(segment||'').toUpperCase();
  let m=s.match(/(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})/);if(m)return`${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m=s.match(/(\d{1,2})[-\/.](\d{1,2})[-\/.](20\d{2})/);if(m)return`${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  m=s.match(/(\d{1,2})[\s\-]+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[A-Z]*[\s\-,]+(20\d{2})/);
  if(m){const mon=m[2]==='SEPT'?'SEP':m[2];return`${m[3]}-${MONTHS[mon]}-${pad(m[1])}`;}
  m=s.match(/(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[A-Z]*[\s\-]+(\d{1,2})[\s\-,]+(20\d{2})/);
  if(m){const mon=m[1]==='SEPT'?'SEP':m[1];return`${m[3]}-${MONTHS[mon]}-${pad(m[2])}`;}
  return'';
}
function parseTime(segment=''){
  const m=String(segment||'').match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  return m?`${pad(m[1])}:${m[2]}`:'';
}
function first(text,rx){return (String(text||'').match(rx)||[])[1]||'';}
function statusFrom(text=''){
  const s=String(text||'').toUpperCase();
  if(/\bDLV\b|DELIVERED|DELIVERY COMPLETED/.test(s))return'DELIVERED';
  if(/\bRCF\b|RECEIVED FROM FLIGHT|\bARR\b|ARRIVED|LANDED|ACTUAL ARRIVAL/.test(s))return'ARRIVED';
  if(/DELAY|OFFLOAD|EXCEPTION|LATE/.test(s))return'DELAYED';
  if(/\bDEP\b|DEPARTED|AIRBORNE|IN TRANSIT|IN FLIGHT/.test(s))return'IN TRANSIT';
  if(/\bRCS\b|BOOKED|ACCEPTED|RECEIVED FROM SHIPPER|MANIFEST/.test(s))return'BOOKED';
  return'TRACKING';
}
function extractNear(text='',labelsRx,span=360){
  const s=String(text||'');
  const m=labelsRx.exec(s);labelsRx.lastIndex=0;
  if(!m)return'';
  const at=m.index||0;
  return s.slice(Math.max(0,at-100),Math.min(s.length,at+span));
}
function parseShipment(text='',mawb=''){
  const flat=String(text||'').replace(/\s+/g,' ').trim();
  const upper=flat.toUpperCase();
  const digits=mawb.replace(/\D/g,'');
  const serial=digits.slice(3);
  const awbMatched=upper.includes(digits)||upper.includes(mawb.toUpperCase())||upper.includes(serial);
  if(!awbMatched)return{awbMatched:false};

  let origin=first(upper,/(?:ORIGIN|FROM|DEPARTURE(?: AIRPORT)?|FROM STATION)\s*[:\-]?\s*([A-Z]{3})\b/i).toUpperCase();
  let destination=first(upper,/(?:DESTINATION|TO|ARRIVAL(?: AIRPORT)?|TO STATION)\s*[:\-]?\s*([A-Z]{3})\b/i).toUpperCase();
  const route=upper.match(/\b([A-Z]{3})\s*(?:→|->|—|-)\s*([A-Z]{3})\b/);
  if(route){origin=origin||route[1];destination=destination||route[2];}

  const pieces=first(flat,/(?:Total\s*)?(?:Pieces?|Pcs?|No\.?\s*of\s*Pieces)\s*[:\-]?\s*(\d{1,6})/i)||first(flat,/\b(\d{1,6})\s*(?:PCS|PIECES?)\b/i);
  const weight=(first(flat,/(?:Gross\s*Weight|Weight)\s*[:\-]?\s*([\d,.]+)\s*(?:KG|KGS)\b/i)||first(flat,/\b([\d,.]+)\s*(?:KG|KGS)\b/i)).replace(/,/g,'');
  const flightMatch=upper.match(/\bVN\s*[- ]?(\d{2,4})\b/);
  const flightNo=flightMatch?`VN${flightMatch[1]}`:'';

  const bookingBlock=extractNear(flat,/\bBOOKED\b|BOOKING(?: DATE)?|\bRCS\b|RECEIVED FROM SHIPPER|\bACCEPTED\b/i,460);
  const bookingDate=parseDate(bookingBlock);
  const actualBlock=extractNear(flat,/ACTUAL ARRIVAL|RECEIVED FROM FLIGHT|\bRCF\b|\bARRIVED\b|\bARR\b|LANDED/i,520);
  const estimateBlock=extractNear(flat,/ESTIMATED ARRIVAL|EXPECTED ARRIVAL|SCHEDULED ARRIVAL|\bETA\b/i,520);
  let arrivalDate=parseDate(actualBlock),arrivalTime=parseTime(actualBlock),arrivalIsActual=Boolean(arrivalDate||arrivalTime);
  if(!arrivalDate&&!arrivalTime){arrivalDate=parseDate(estimateBlock);arrivalTime=parseTime(estimateBlock);arrivalIsActual=false;}

  return{awbMatched:true,origin,destination,pieces,bags:pieces,weight,flightNo,bookingDate,arrivalDate,arrivalTime,arrivalIsActual,status:statusFrom(flat)};
}

async function launchBrowser(){
  chromium.setGraphicsMode=false;
  const executablePath=await chromium.executablePath();
  return puppeteer.launch({
    args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox','--disable-blink-features=AutomationControlled','--lang=en-US,en'],
    defaultViewport:{width:1440,height:1100,deviceScaleFactor:1},
    executablePath,
    headless:'shell'
  });
}
async function clickTrackEntry(page){
  for(const frame of page.frames()){
    try{
      const clicked=await frame.evaluate(()=>{
        const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>20&&r.height>10&&!e.disabled};
        const els=[...document.querySelectorAll('button,a,[role="button"],input[type="button"],input[type="submit"]')].filter(visible);
        const target=els.find(e=>/^track$/i.test(String(e.innerText||e.value||e.getAttribute('aria-label')||'').trim()));
        if(!target)return'';
        const t=String(target.innerText||target.value||'TRACK').trim();target.click();return t;
      });
      if(clicked)return clicked;
    }catch{}
  }
  return'';
}
async function fillAndSubmit(page,mawb){
  const prefix=mawb.slice(0,3),serial=mawb.slice(4),digits=mawb.replace(/\D/g,'');
  const attempts=[];
  for(const frame of page.frames()){
    try{
      const probe=await frame.evaluate(()=>{
        const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>20&&r.height>10&&!e.disabled};
        return [...document.querySelectorAll('input')].filter(visible).filter(e=>!['hidden','checkbox','radio','submit','button'].includes((e.type||'text').toLowerCase())).map(e=>({name:e.name||'',id:e.id||'',placeholder:e.placeholder||'',aria:e.getAttribute('aria-label')||'',type:e.type||''}));
      });
      attempts.push({url:frame.url(),inputs:probe});
    }catch{}
  }

  for(const frame of page.frames()){
    try{
      const result=await frame.evaluate(({mawb,prefix,serial,digits})=>{
        const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>20&&r.height>10&&!e.disabled};
        const inputs=[...document.querySelectorAll('input')].filter(visible).filter(e=>!['hidden','checkbox','radio','submit','button'].includes((e.type||'text').toLowerCase()));
        const desc=e=>`${e.name||''} ${e.id||''} ${e.placeholder||''} ${e.getAttribute('aria-label')||''} ${e.getAttribute('title')||''}`.toLowerCase();
        const set=(e,v)=>{const d=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');d?.set?.call(e,v);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));};
        const prefixInput=inputs.find(e=>/prefix/.test(desc(e)));
        const serialInput=inputs.find(e=>/(serial|awb|airway|waybill|tracking|shipment).*(number|no)?/.test(desc(e))&&!/prefix/.test(desc(e)));
        let mode='';
        if(prefixInput&&serialInput&&prefixInput!==serialInput){set(prefixInput,prefix);set(serialInput,serial);mode='split';}
        else{
          const candidates=inputs.filter(e=>!/site search|search keyword|search website/.test(desc(e)));
          const best=candidates.map(e=>({e,score:(/(awb|airway|waybill|tracking|shipment)/.test(desc(e))?8:0)+(/number|no|serial/.test(desc(e))?3:0)})).sort((a,b)=>b.score-a.score)[0];
          const target=best?.score>0?best.e:(candidates.length===1?candidates[0]:null);
          if(!target)return{filled:false,mode:'none'};
          set(target,mawb);mode='single';
        }
        const buttons=[...document.querySelectorAll('button,input[type="submit"],input[type="button"],a,[role="button"]')].filter(visible);
        const targetButton=buttons.find(e=>/^(track|search|submit|go)$/i.test(String(e.innerText||e.value||e.getAttribute('aria-label')||'').trim())||/track\s*(awb|cargo|shipment)|search\s*(awb|shipment)/i.test(String(e.innerText||e.value||'').trim()));
        if(targetButton){targetButton.click();return{filled:true,mode,clicked:String(targetButton.innerText||targetButton.value||'').trim()};}
        return{filled:true,mode,clicked:''};
      },{mawb,prefix,serial,digits});
      if(result?.filled)return{...result,frameUrl:frame.url(),attempts};
    }catch{}
  }
  return{filled:false,mode:'none',clicked:'',frameUrl:'',attempts};
}
async function allText(page){
  const chunks=[];
  for(const frame of page.frames()){
    try{chunks.push(`[FRAME ${frame.url()}]\n${await frame.evaluate(()=>document.body?.innerText||'')}`);}catch{}
  }
  return chunks.join('\n');
}

export async function trackVietnam(input){
  const mawb=normalize(input);
  if(!mawb||!mawb.startsWith('738-'))return{ok:false,reason:'INVALID VIETNAM AIRLINES MAWB',officialTracker:TRACK_URL};
  let browser;
  try{
    browser=await launchBrowser();
    let page=await browser.newPage();
    await page.setExtraHTTPHeaders({'accept-language':'en-US,en;q=0.9'});
    await page.goto(TRACK_URL,{waitUntil:'domcontentloaded',timeout:45000});
    await sleep(1800);
    const entryClicked=await clickTrackEntry(page);
    if(entryClicked){await sleep(1800);const pages=await browser.pages();page=pages[pages.length-1]||page;}
    const fill=await fillAndSubmit(page,mawb);
    if(fill.filled){await Promise.race([page.waitForNetworkIdle({idleTime:1000,timeout:12000}).catch(()=>{}),sleep(12000)]);await sleep(1800);}
    const text=await allText(page);
    const parsed=parseShipment(text,mawb);
    if(!parsed.awbMatched){
      return{ok:false,reason:fill.filled?'VIETNAM OFFICIAL RESULT DID NOT MATCH AWB':'VIETNAM TRACK INPUT NOT FOUND',officialTracker:TRACK_URL,debug:{entryClicked,fill,pageUrl:page.url(),pageText:text.slice(0,12000)}};
    }
    const useful=Boolean((parsed.origin&&parsed.destination)||parsed.pieces||parsed.weight||parsed.flightNo||parsed.bookingDate||parsed.arrivalDate||parsed.arrivalTime||(parsed.status&&parsed.status!=='TRACKING'));
    if(!useful)return{ok:false,reason:'VIETNAM OFFICIAL RESULT HAD NO VERIFIED SHIPMENT FIELDS',officialTracker:TRACK_URL,debug:{entryClicked,fill,pageUrl:page.url(),pageText:text.slice(0,12000)}};
    return{ok:true,shipment:{mawb,carrierCode:'VN',airlineName:'Vietnam Airlines Cargo',officialTracker:TRACK_URL,origin:parsed.origin,destination:parsed.destination,bags:parsed.bags,pieces:parsed.pieces,weight:parsed.weight,flightNo:parsed.flightNo,bookingDate:parsed.bookingDate,arrivalDate:parsed.arrivalDate,arrivalTime:parsed.arrivalTime,arrivalIsActual:parsed.arrivalIsActual,status:parsed.status,source:'Vietnam Airlines official cargo tracker'},debug:{entryClicked,fill,pageUrl:page.url(),awbMatched:true,pageText:text.slice(0,9000)}};
  }catch(error){return{ok:false,reason:error?.message||'VIETNAM OFFICIAL TRACKING FAILED',officialTracker:TRACK_URL};}
  finally{try{await browser?.close();}catch{}}
}
