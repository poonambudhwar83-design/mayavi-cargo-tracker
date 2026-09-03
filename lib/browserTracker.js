import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { airlineForMawb, normalizeMawb } from './airlines.js';

const MONTHS={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
const pad=v=>String(v).padStart(2,'0');
const first=(s,rx)=>(String(s).match(rx)||[])[1]||'';

function parseDate(segment=''){
  const s=String(segment).toUpperCase();let m=s.match(/(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})/);if(m)return`${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m=s.match(/(\d{1,2})[-\/.](\d{1,2})[-\/.](20\d{2})/);if(m)return`${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  m=s.match(/(\d{1,2})[\s\-]+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s\-,]+(20\d{2})/);if(m)return`${m[3]}-${MONTHS[m[2]]}-${pad(m[1])}`;
  m=s.match(/(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s\-]+(\d{1,2})[\s\-,]+(20\d{2})/);if(m)return`${m[3]}-${MONTHS[m[1]]}-${pad(m[2])}`;return'';
}
function parseTime(s=''){const m=String(s).match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);return m?`${pad(m[1])}:${m[2]}`:''}
function statusFromText(text=''){
  const s=String(text).toUpperCase();
  if(/\bDLV\b|DELIVERED/.test(s))return'DELIVERED';
  if(/\bRCF\b|RECEIVED FROM FLIGHT|\bARRIVED\b|\bLANDED\b|ACTUAL ARRIVAL/.test(s))return'ARRIVED';
  if(/DELAY|LATE|OFFLOAD|SHORT SHIP|EXCEPTION/.test(s))return'DELAYED';
  if(/\bDEP\b|DEPARTED|IN TRANSIT|AIRBORNE|IN FLIGHT/.test(s))return'IN TRANSIT';
  if(/\bRCS\b|BOOKED|ACCEPTED|RECEIVED FROM SHIPPER/.test(s))return'BOOKED';
  return'TRACKING';
}
function dateCandidates(segment=''){
  const s=String(segment),out=[];
  const add=(rx,build)=>{for(const m of s.matchAll(rx)){const date=build(m);if(date)out.push({date,index:m.index||0,raw:m[0]});}};
  add(/\b(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})\b/g,m=>`${m[1]}-${pad(m[2])}-${pad(m[3])}`);
  add(/\b(\d{1,2})[-\/.](\d{1,2})[-\/.](20\d{2})\b/g,m=>`${m[3]}-${pad(m[2])}-${pad(m[1])}`);
  add(/\b(\d{1,2})[\s\-]+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[A-Za-z]*[\s\-,]+(20\d{2})\b/gi,m=>`${m[3]}-${MONTHS[m[2].slice(0,3).toUpperCase()]}-${pad(m[1])}`);
  add(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[A-Za-z]*[\s\-]+(\d{1,2})[\s\-,]+(20\d{2})\b/gi,m=>`${m[3]}-${MONTHS[m[1].slice(0,3).toUpperCase()]}-${pad(m[2])}`);
  return out;
}
function timeCandidates(segment=''){
  const out=[];for(const m of String(segment).matchAll(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g))out.push({time:`${pad(m[1])}:${m[2]}`,index:m.index||0,raw:m[0]});return out;
}
function nearestCandidate(items=[],anchor=0,key='date'){
  if(!items.length)return'';return [...items].sort((a,b)=>Math.abs(a.index-anchor)-Math.abs(b.index-anchor))[0]?.[key]||'';
}
function qatarArrivalFromText(text='',flightNo=''){
  const raw=String(text||''),flat=raw.replace(/\s+/g,' ').trim();
  const exactPatterns=[/\bArrived\s*\(\s*[A-Z]{3}\s*\)/ig,/\bArrived\s+in\s+[A-Z]{3}\b/ig,/\bReceived\s+in\s+[A-Z]{3}\b/ig];
  for(const rx of exactPatterns){
    const m=rx.exec(flat);if(!m)continue;
    const start=m.index||0,window=flat.slice(start,Math.min(flat.length,start+260)),d=parseDate(window),t=parseTime(window);
    if(d||t)return{arrivalDate:d,arrivalTime:t,arrivalIsActual:true,status:'ARRIVED',score:30,snippet:window};
  }
  const keyword=/actual\s+arrival|estimated\s+arrival|scheduled\s+arrival|arrival\s+date|arrival\s+time|\barrived\b|\blanded\b|received\s+from\s+flight|\bRCF\b/ig;
  const hits=[...flat.matchAll(keyword)];
  let best=null;
  for(const hit of hits){
    const center=hit.index||0,start=Math.max(0,center-300),end=Math.min(flat.length,center+420),window=flat.slice(start,end),localAnchor=center-start;
    const d=nearestCandidate(dateCandidates(window),localAnchor,'date'),t=nearestCandidate(timeCandidates(window),localAnchor,'time');
    if(d||t){
      const actual=/actual|arrived|landed|received\s+from\s+flight|\bRCF\b/i.test(hit[0]);
      const score=(d?8:0)+(t?4:0)+(actual?5:0);
      if(!best||score>best.score)best={arrivalDate:d,arrivalTime:t,arrivalIsActual:actual,status:actual?'ARRIVED':'',score,snippet:window.slice(0,650)};
    }
  }
  if((!best?.arrivalDate||!best?.arrivalTime)&&flightNo){
    const esc=String(flightNo).replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),fm=new RegExp(`\\b${esc}\\b`,'i').exec(flat);
    if(fm){
      const center=fm.index||0,start=Math.max(0,center-360),end=Math.min(flat.length,center+560),window=flat.slice(start,end);
      const dates=dateCandidates(window),times=timeCandidates(window);
      const arrived=/\barrived\b|\blanded\b|actual\s+arrival|received\s+from\s+flight|\bRCF\b/i.test(window);
      const d=dates.length?dates[dates.length-1].date:'',t=times.length?times[times.length-1].time:'';
      if(d||t){const candidate={arrivalDate:d,arrivalTime:t,arrivalIsActual:arrived,status:arrived?'ARRIVED':'',score:(d?5:0)+(t?3:0)+(arrived?4:0),snippet:window.slice(0,650)};if(!best||candidate.score>best.score)best=candidate;}
    }
  }
  return best||{arrivalDate:'',arrivalTime:'',arrivalIsActual:false,status:'',snippet:''};
}
function parseVisibleText(text,mawb,airline){
  const raw=String(text||''),flat=raw.replace(/\s+/g,' ').trim(), upper=flat.toUpperCase(), iata=String(airline?.iata||'').toUpperCase();
  let route=upper.match(/\bORIGIN\b\s*[:\-]?\s*([A-Z]{3})\b[\s\S]{0,120}?\bDESTINATION\b\s*[:\-]?\s*([A-Z]{3})\b/)
    ||upper.match(/\bFROM\b\s*[:\-]?\s*([A-Z]{3})\b[\s\S]{0,120}?\bTO\b\s*[:\-]?\s*([A-Z]{3})\b/)
    ||upper.match(/\b([A-Z]{3})\s*(?:→|->|—|-)\s*([A-Z]{3})\b/);
  const origin=route?.[1]||'',destination=route?.[2]||'';
  const pieces=first(flat,/(?:Pieces?|Pcs?|No\.?\s*of\s*Pieces|Piece Count)\s*[:\-]?\s*(\d{1,6})/i)||first(flat,/\b(\d{1,6})\s*(?:PCS|PIECES?)\b/i);
  const weight=(first(flat,/(?:Gross\s*Weight|Chargeable\s*Weight|Weight)\s*[:\-]?\s*([\d,.]+)\s*(?:KG|KGS)?/i)||first(flat,/\b([\d,.]+)\s*(?:KG|KGS)\b/i)).replace(/,/g,'');
  let flightNo='';if(iata){const esc=iata.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');const m=upper.match(new RegExp(`\\b${esc}\\s*[- ]?(\\d{2,4})\\b`));if(m)flightNo=`${iata}${m[1]}`;}
  if(!flightNo)flightNo=first(upper,/\b([A-Z]{2}\d{2,4})\b/);
  const actual=(flat.match(/(?:ATA|Actual Arrival|Arrived|Received from Flight|RCF|Landed)[\s\S]{0,220}/i)||[])[0]||'';
  const estimated=(flat.match(/(?:ETA|Estimated Arrival|Expected Arrival|Scheduled Arrival|Arrival)[\s\S]{0,220}/i)||[])[0]||'';
  let arrivalDate=parseDate(actual),arrivalTime=parseTime(actual),arrivalIsActual=Boolean(arrivalDate||arrivalTime),arrivalSource='generic-arrival-block',arrivalSnippet='';
  if(!arrivalDate&&!arrivalTime){arrivalDate=parseDate(estimated);arrivalTime=parseTime(estimated);arrivalIsActual=false;arrivalSource='generic-estimated-block';}
  let status=statusFromText(flat);
  if(iata==='QR'){
    const qr=qatarArrivalFromText(raw,flightNo);
    if(qr.arrivalDate&&(qr.arrivalIsActual||!arrivalDate)){arrivalDate=qr.arrivalDate;arrivalSource='qatar-arrived-row';}
    if(qr.arrivalTime&&(qr.arrivalIsActual||!arrivalTime)){arrivalTime=qr.arrivalTime;arrivalSource='qatar-arrived-row';}
    if(qr.arrivalIsActual){arrivalIsActual=true;}
    if(qr.status==='ARRIVED')status='ARRIVED';
    arrivalSnippet=qr.snippet||'';
  }
  return {mawb,carrierCode:iata,airlineName:airline?.name||'',origin,destination,bags:pieces,pieces,weight,flightNo,arrivalDate,arrivalTime,arrivalIsActual,status,officialTracker:airline?.url||'',source:'Official airline browser capture',arrivalSource,arrivalSnippet};
}
function useful(s={}){return Boolean((s.origin&&s.destination)||s.pieces||s.weight||s.flightNo||s.arrivalDate||s.arrivalTime||(s.status&&s.status!=='TRACKING'));}
function officialUrl(mawb,airline){
  const prefix=mawb.slice(0,3),serial=mawb.slice(4);
  if(prefix==='160')return`https://www.cathaycargoterminal.com/en-us/Shipment-Tracking/AWBPrefix/160/AWBSuffix/${serial}`;
  if(prefix==='157')return`https://www.qrcargo.com/s/track-your-shipment?documentNumber=${serial}&documentPrefix=157&documentType=MAWB`;
  return airline?.url||'';
}
async function launchBrowser(){
  chromium.setGraphicsMode=false;
  return puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox'],defaultViewport:{width:1440,height:1100,deviceScaleFactor:1},executablePath:await chromium.executablePath(),headless:'shell'});
}
async function acceptCookies(page){
  await page.evaluate(()=>{
    const buttons=[...document.querySelectorAll('button,[role="button"]')];
    const b=buttons.find(x=>/accept all|accept cookies|allow all|agree/i.test((x.innerText||x.getAttribute('aria-label')||'').trim()));if(b)b.click();
  }).catch(()=>{});
}

export async function trackWithBrowser(input){
  const mawb=normalizeMawb(input),airline=airlineForMawb(mawb);if(!mawb||!airline)return{ok:false,reason:'INVALID OR UNMAPPED MAWB'};
  const url=officialUrl(mawb,airline);if(!url)return{ok:false,reason:'NO OFFICIAL TRACKER URL',officialTracker:null};
  const prefix=mawb.slice(0,3),serial=mawb.slice(4),digits=mawb.replace(/\D/g,'');
  let browser;
  try{
    browser=await launchBrowser();
    const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36');
    await page.goto(url,{waitUntil:'domcontentloaded',timeout:18000});
    await new Promise(r=>setTimeout(r,1800));
    await acceptCookies(page);await new Promise(r=>setTimeout(r,300));
    const bodyBefore=await page.evaluate(()=>document.body?.innerText||'').catch(()=> '');
    if(/captcha|verify you are human|security check|cloudflare|turnstile|access denied/i.test(bodyBefore)){
      const shot=await page.screenshot({type:'jpeg',quality:65,fullPage:false,encoding:'base64'}).catch(()=>null);
      return{ok:false,reason:'AIRLINE SECURITY/CAPTCHA REQUIRES MANUAL CHECK',officialTracker:url,screenshotBase64:shot,debug:{stage:'CAPTCHA'}};
    }
    let fill=await page.evaluate(({mawb,prefix,serial})=>{
      const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>20&&r.height>10&&!e.disabled};
      const inputs=[...document.querySelectorAll('input')].filter(visible).filter(e=>!['hidden','checkbox','radio','submit','button'].includes((e.type||'text').toLowerCase()));
      const desc=e=>`${e.name||''} ${e.id||''} ${e.placeholder||''} ${e.getAttribute('aria-label')||''} ${e.getAttribute('title')||''}`.toLowerCase();
      const set=(e,v)=>{const d=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');d?.set?.call(e,v);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));};
      const prefixInput=inputs.find(e=>/prefix/.test(desc(e))), numberInput=inputs.find(e=>/(awb|airway|document|tracking|shipment).*(number|no|serial)|documentnumber|awbnumber/.test(desc(e))&&!/prefix/.test(desc(e)));
      if(prefixInput&&numberInput){set(prefixInput,prefix);set(numberInput,serial);return{filled:true,mode:'split'};}
      const best=inputs.map(e=>({e,score:(/(awb|airway|tracking|shipment|document)/.test(desc(e))?5:0)+(/number|no|serial/.test(desc(e))?2:0)})).sort((a,b)=>b.score-a.score)[0];
      if(best?.e&&best.score>0){set(best.e,mawb);return{filled:true,mode:'single'};}return{filled:false};
    },{mawb,prefix,serial}).catch(()=>({filled:false}));
    const compactBefore=bodyBefore.replace(/\D/g,'');
    const prefilled=compactBefore.includes(digits)||compactBefore.includes(serial)||page.url().includes(`documentNumber=${encodeURIComponent(serial)}`);
    if(!fill.filled&&prefilled)fill={filled:true,mode:'prefilled'};
    let clicked='';
    if(fill.filled){
      await new Promise(r=>setTimeout(r,300));
      clicked=await page.evaluate(()=>{
        const els=[...document.querySelectorAll('button,input[type="submit"],a,[role="button"]')];
        const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>20&&r.height>10&&!e.disabled};
        const candidates=els.filter(visible).map(e=>({e,t:(e.innerText||e.value||e.getAttribute('aria-label')||e.getAttribute('title')||'').replace(/\s+/g,' ').trim()}));
        const target=candidates.find(x=>/^(track|search|submit|go)$/i.test(x.t)||/track\s+shipment(?:\(s\)|s)?|track\s+cargo|track\s+awb|search\s+shipment/i.test(x.t));
        if(target){target.e.click();return target.t;}return'';
      }).catch(()=> '');
      if(clicked){await Promise.race([page.waitForNetworkIdle({idleTime:900,timeout:8500}).catch(()=>{}),new Promise(r=>setTimeout(r,8500))]);await new Promise(r=>setTimeout(r,1200));}
      else await new Promise(r=>setTimeout(r,2200));
    }
    const text=await page.evaluate(()=>document.body?.innerText||'').catch(()=> '');
    if(/captcha|verify you are human|security check|cloudflare|turnstile|access denied/i.test(text)){
      const shot=await page.screenshot({type:'jpeg',quality:65,fullPage:false,encoding:'base64'}).catch(()=>null);
      return{ok:false,reason:'AIRLINE SECURITY/CAPTCHA REQUIRES MANUAL CHECK',officialTracker:url,screenshotBase64:shot,debug:{stage:'CAPTCHA_AFTER_SUBMIT',filled:fill.filled,mode:fill.mode||'',clicked}};
    }
    const screenshotBase64=await page.screenshot({type:'jpeg',quality:68,fullPage:false,encoding:'base64'}).catch(()=>null);
    const shipment=parseVisibleText(text,mawb,airline);
    const arrivalSnippet=shipment.arrivalSnippet||'',arrivalSource=shipment.arrivalSource||'';delete shipment.arrivalSnippet;
    if(useful(shipment))return{ok:true,shipment,screenshotBase64,debug:{stage:'SUCCESS',url,filled:fill.filled,mode:fill.mode||'',clicked,arrivalSource,arrivalSnippet}};
    return{ok:false,reason:'BROWSER OPENED AIRLINE PAGE BUT NO VERIFIED SHIPMENT FIELDS FOUND',officialTracker:url,screenshotBase64,pageText:text.slice(0,6000),debug:{stage:'NO_FIELDS',filled:fill.filled,mode:fill.mode||'',clicked,arrivalSource,arrivalSnippet}};
  }catch(e){return{ok:false,reason:`BROWSER TRACKING ERROR: ${e?.message||e}`,officialTracker:url,debug:{stage:'ERROR'}};}
  finally{try{if(browser)await browser.close()}catch{}}
}

export async function inspectCathayFlightPage(flightNo='CX665',date='2026-09-01'){
  const url='https://www.cathaypacific.com/cx/en_IN/prepare-trip/flight-status.html';
  let browser;
  try{
    browser=await launchBrowser();
    const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36');
    await page.goto(url,{waitUntil:'domcontentloaded',timeout:20000});
    await new Promise(r=>setTimeout(r,5000));
    await acceptCookies(page);await new Promise(r=>setTimeout(r,1200));
    const frames=[];
    for(const frame of page.frames()){
      try{
        const info=await frame.evaluate(()=>{
          const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>4&&r.height>4};
          const labelFor=e=>{if(e.id){const l=document.querySelector(`label[for="${CSS.escape(e.id)}"]`);if(l)return(l.innerText||'').trim();}const p=e.closest('label');return(p?.innerText||'').trim();};
          const inputs=[...document.querySelectorAll('input,select')].filter(visible).slice(0,30).map(e=>({tag:e.tagName,type:e.type||'',name:e.name||'',id:e.id||'',placeholder:e.placeholder||'',aria:e.getAttribute('aria-label')||'',title:e.title||'',label:labelFor(e),value:e.value||''}));
          const buttons=[...document.querySelectorAll('button,[role="button"],input[type="submit"],a')].filter(visible).map(e=>(e.innerText||e.value||e.getAttribute('aria-label')||e.title||'').replace(/\s+/g,' ').trim()).filter(Boolean).slice(0,60);
          return{inputs,buttons,text:(document.body?.innerText||'').slice(0,5000)};
        });
        frames.push({url:frame.url(),...info});
      }catch{}
    }
    const screenshotBase64=await page.screenshot({type:'jpeg',quality:60,fullPage:false,encoding:'base64'}).catch(()=>null);
    return{ok:true,url,flightNo,date,frames,screenshotBase64};
  }catch(e){return{ok:false,reason:e?.message||String(e),url};}
  finally{try{if(browser)await browser.close()}catch{}}
}

export async function trackCathayFlightStatus(flightNo='CX665',date='2026-09-01'){
  const url='https://www.cathaypacific.com/cx/en_IN/prepare-trip/flight-status.html';
  let browser;
  try{
    browser=await launchBrowser();
    const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36');
    await page.goto(url,{waitUntil:'domcontentloaded',timeout:20000});
    await new Promise(r=>setTimeout(r,4500));
    await acceptCookies(page);await new Promise(r=>setTimeout(r,700));
    const setup=await page.evaluate(({flightNo,date})=>{
      const setInput=(e,v)=>{const d=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');d?.set?.call(e,v);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));};
      const radio=document.querySelector('#byNumber');if(radio&&!radio.checked)radio.click();
      const input=document.querySelector('#txtFlightNum');if(!input)return{ok:false,reason:'flight input missing'};setInput(input,flightNo);
      const select=document.querySelector('#number-date-select');if(!select)return{ok:false,reason:'date select missing'};
      const targetDate=new Date(`${date}T12:00:00Z`);
      const score=o=>{const raw=`${o.value} ${o.textContent}`.toLowerCase();let s=0;if(raw.includes(date.toLowerCase()))s+=20;const y=String(targetDate.getUTCFullYear()),m=String(targetDate.getUTCMonth()+1).padStart(2,'0'),d=String(targetDate.getUTCDate()).padStart(2,'0');if(raw.includes(y))s+=4;if(raw.includes(d))s+=3;if(raw.includes(`${y}-${m}-${d}`))s+=20;const monthNames=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];if(raw.includes(monthNames[targetDate.getUTCMonth()]))s+=4;return s;};
      const opts=[...select.options].map(o=>({o,s:score(o),value:o.value,text:(o.textContent||'').trim()})).sort((a,b)=>b.s-a.s);
      const best=opts[0];if(!best||best.s<3)return{ok:false,reason:'date option not found',options:opts.slice(0,12).map(x=>({value:x.value,text:x.text,s:x.s}))};
      select.value=best.value;select.dispatchEvent(new Event('change',{bubbles:true}));
      return{ok:true,selected:{value:best.value,text:best.text,score:best.s},flightValue:input.value};
    },{flightNo,date});
    if(!setup.ok)return{ok:false,reason:setup.reason||'CATHAY FLIGHT FORM SETUP FAILED',debug:setup,officialTracker:url};
    const clicked=await page.evaluate(()=>{
      const els=[...document.querySelectorAll('button,[role="button"],input[type="submit"],a')];
      const b=els.find(e=>/^check status$/i.test((e.innerText||e.value||e.getAttribute('aria-label')||'').replace(/\s+/g,' ').trim()));
      if(b){b.click();return true;}return false;
    });
    if(!clicked)return{ok:false,reason:'CATHAY CHECK STATUS BUTTON NOT FOUND',debug:{setup},officialTracker:url};
    await Promise.race([page.waitForNetworkIdle({idleTime:900,timeout:9000}).catch(()=>{}),new Promise(r=>setTimeout(r,9000))]);
    await new Promise(r=>setTimeout(r,1800));
    const text=await page.evaluate(()=>document.body?.innerText||'').catch(()=> '');
    const flat=text.replace(/\s+/g,' ').trim();
    const status=/\barrived\b|\blanded\b/i.test(flat)?'ARRIVED':(/\bdeparted\b|\bin flight\b/i.test(flat)?'IN TRANSIT':(/cancelled|canceled/i.test(flat)?'CANCELLED':'TRACKING'));
    let arrivalTime='';
    const arrivalBlocks=[...(flat.matchAll(/(?:arrival|arrived|landed)[\s\S]{0,180}/gi))].map(m=>m[0]);
    for(const b of arrivalBlocks){const t=parseTime(b);if(t){arrivalTime=t;break;}}
    const destination=(flat.match(/\bDEL\b/i)?'DEL':'');
    const screenshotBase64=await page.screenshot({type:'jpeg',quality:65,fullPage:false,encoding:'base64'}).catch(()=>null);
    const usefulResult=status!=='TRACKING'||arrivalTime||destination;
    if(usefulResult)return{ok:true,flightNo,date,arrivalDate:date,arrivalTime,arrivalIsActual:status==='ARRIVED',status,destination,source:'Cathay Pacific official flight status',screenshotBase64,debug:{setup,clicked,pageText:flat.slice(0,7000)}};
    return{ok:false,reason:'CATHAY FLIGHT STATUS RETURNED NO VERIFIED RESULT',officialTracker:url,pageText:flat.slice(0,7000),screenshotBase64,debug:{setup,clicked}};
  }catch(e){return{ok:false,reason:`CATHAY FLIGHT STATUS ERROR: ${e?.message||e}`,officialTracker:url};}
  finally{try{if(browser)await browser.close()}catch{}}
}