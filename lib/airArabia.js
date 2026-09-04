import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const START='https://cargo.airarabia.com/cargo-tracking/';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
const digitsOnly=s=>String(s||'').replace(/\D/g,'');
const pad=v=>String(v).padStart(2,'0');
const MONTH={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};

function parseDate(s=''){
  const t=String(s).toUpperCase();
  let m=t.match(/(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})/);if(m)return`${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m=t.match(/(\d{1,2})[-\/.](\d{1,2})[-\/.](20\d{2})/);if(m)return`${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  m=t.match(/(\d{1,2})[\s\-]+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s\-,]+(20\d{2})/);if(m)return`${m[3]}-${MONTH[m[2]]}-${pad(m[1])}`;
  m=t.match(/(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s\-]+(\d{1,2})[\s\-,]+(20\d{2})/);if(m)return`${m[3]}-${MONTH[m[1]]}-${pad(m[2])}`;
  return'';
}
function parseTime(s=''){
  const m=String(s).match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);return m?`${pad(m[1])}:${m[2]}`:'';
}
function statusFromText(text=''){
  const s=String(text).toUpperCase();
  if(/\bDLV\b|DELIVERED/.test(s))return'DELIVERED';
  if(/\bRCF\b|RECEIVED FROM FLIGHT|\bARRIVED\b|\bLANDED\b|ACTUAL ARRIVAL/.test(s))return'ARRIVED';
  if(/DELAY|LATE|OFFLOAD|SHORT SHIP|EXCEPTION/.test(s))return'DELAYED';
  if(/\bDEP\b|DEPARTED|IN TRANSIT|AIRBORNE|IN FLIGHT/.test(s))return'IN TRANSIT';
  if(/\bRCS\b|BOOKED|ACCEPTED|RECEIVED FROM SHIPPER|MANIFESTED/.test(s))return'BOOKED';
  return'TRACKING';
}
function first(text,patterns){for(const rx of patterns){const m=String(text).match(rx);if(m?.[1])return m[1];}return'';}
function nearestArrival(text=''){
  const flat=clean(text);
  const actualRx=/(?:actual\s+arrival|arrived(?:\s+at)?|landed(?:\s+at)?|received\s+from\s+flight|\bRCF\b|\bATA\b)/ig;
  const etaRx=/(?:estimated\s+arrival|expected\s+arrival|scheduled\s+arrival|\bETA\b|arrival\s+date|arrival\s+time)/ig;
  const pick=(rx,actual)=>{
    const hits=[...flat.matchAll(rx)];
    for(let i=hits.length-1;i>=0;i--){
      const at=hits[i].index||0,window=flat.slice(Math.max(0,at-100),Math.min(flat.length,at+330));
      const date=parseDate(window),time=parseTime(window);if(date||time)return{date,time,actual,snippet:window};
    }
    return null;
  };
  return pick(actualRx,true)||pick(etaRx,false)||{date:'',time:'',actual:false,snippet:''};
}
function parseDetails(text='',mawb=''){
  const flat=clean(text),upper=flat.toUpperCase(),digits=digitsOnly(mawb),serial=digits.slice(3);
  const awbMatched=Boolean(serial&&(digitsOnly(flat).includes(digits)||digitsOnly(flat).includes(serial)));
  let route=upper.match(/\bORIGIN\b\s*[:\-]?\s*([A-Z]{3})\b[\s\S]{0,160}?\bDESTINATION\b\s*[:\-]?\s*([A-Z]{3})\b/)
    ||upper.match(/\bFROM\b\s*[:\-]?\s*([A-Z]{3})\b[\s\S]{0,160}?\bTO\b\s*[:\-]?\s*([A-Z]{3})\b/)
    ||upper.match(/\b([A-Z]{3})\s*(?:→|->|—|-)\s*([A-Z]{3})\b/);
  const origin=(route?.[1]||first(upper,[/(?:ORIGIN|FROM\s+STATION|DEPARTURE\s+STATION|POL)\s*[:\-]?\s*([A-Z]{3})\b/i])).toUpperCase();
  const destination=(route?.[2]||first(upper,[/(?:DESTINATION|TO\s+STATION|ARRIVAL\s+STATION|POD)\s*[:\-]?\s*([A-Z]{3})\b/i])).toUpperCase();
  const pieces=first(flat,[/(?:Pieces?|Pcs?|No\.?\s*of\s*Pieces|Piece\s*Count|Total\s*Pieces|Bags?)\s*[:\-]?\s*(\d{1,6})\b/i,/\b(\d{1,6})\s*(?:PCS|PIECES?|BAGS?)\b/i]);
  const weight=first(flat,[/(?:Gross\s*Weight|Chargeable\s*Weight|Total\s*Weight|Weight)\s*[:\-]?\s*([\d,.]+)\s*(?:KG|KGS|KILOGRAMS?)?/i,/\b([\d,.]+)\s*(?:KG|KGS|KILOGRAMS?)\b/i]).replace(/,/g,'');
  const flights=[...upper.matchAll(/\bG9\s*[- ]?(\d{2,4})\b/g)];
  const flightNo=flights.length?`G9${flights.at(-1)[1]}`:'';
  const arrival=nearestArrival(flat);
  const status=statusFromText(flat);
  return{mawb,carrierCode:'G9',airlineName:'Air Arabia Cargo',origin,destination,bags:pieces,pieces,weight,flightNo,arrivalDate:arrival.date,arrivalTime:arrival.time,arrivalIsActual:arrival.actual,status,awbMatched,arrivalEvidence:arrival.snippet};
}
function useful(s={}){return Boolean((s.origin&&s.destination)||s.pieces||s.weight||s.flightNo||s.arrivalDate||s.arrivalTime||(s.status&&s.status!=='TRACKING'));}
async function launch(){
  chromium.setGraphicsMode=false;
  return puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox'],defaultViewport:{width:1440,height:1100,deviceScaleFactor:1},executablePath:await chromium.executablePath(),headless:'shell'});
}
async function allText(page){
  const chunks=[];for(const frame of page.frames()){try{const t=await frame.evaluate(()=>document.body?.innerText||'');if(t)chunks.push(t);}catch{}}
  return clean(chunks.join('\n'));
}
async function acceptCookies(page){
  for(const frame of page.frames())try{await frame.evaluate(()=>{const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>4&&r.height>4&&s.display!=='none'&&s.visibility!=='hidden'};const b=[...document.querySelectorAll('button,[role="button"],a')].filter(visible).find(e=>/accept all|accept cookies|allow all|agree/i.test(String(e.innerText||e.textContent||e.getAttribute('aria-label')||'').trim()));b?.click();});}catch{}
}
async function chooseAwbType(frame){
  try{
    const chosen=await frame.evaluate(()=>{
      const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>4&&r.height>4&&s.display!=='none'&&s.visibility!=='hidden'&&!e.disabled};
      const selects=[...document.querySelectorAll('select')].filter(visible);
      for(const sel of selects){
        const options=[...sel.options];const opt=options.find(o=>/\b(?:awb|mawb|air\s*waybill)\b/i.test(`${o.textContent||''} ${o.value||''}`))||options.find(o=>/^\s*514\s*$/i.test(`${o.textContent||''} ${o.value||''}`))||options.find(o=>o.value&&!/^\s*(?:select|choose)/i.test(o.textContent||''));
        if(!opt)continue;sel.value=opt.value;sel.dispatchEvent(new Event('input',{bubbles:true}));sel.dispatchEvent(new Event('change',{bubbles:true}));return String(opt.textContent||opt.value||'').trim();
      }
      return'';
    });
    if(chosen)return chosen;
  }catch{}
  try{
    const opened=await frame.evaluate(()=>{
      const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>4&&r.height>4&&s.display!=='none'&&s.visibility!=='hidden'};
      const els=[...document.querySelectorAll('[role="combobox"],.select2-selection,.choices__inner,.nice-select,.select-selected')].filter(visible);
      const target=els.find(e=>/select|514|awb|air\s*waybill|tracking/i.test(String(e.innerText||e.textContent||e.getAttribute('aria-label')||'')))||els[0];
      if(!target)return false;target.click();return true;
    });
    if(opened){await sleep(250);const picked=await frame.evaluate(()=>{const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>4&&r.height>4&&s.display!=='none'&&s.visibility!=='hidden'};const options=[...document.querySelectorAll('[role="option"],li,.select2-results__option,.choices__item')].filter(visible);const e=options.find(x=>/\b(?:514|awb|mawb|air\s*waybill)\b/i.test(String(x.innerText||x.textContent||'')));if(!e)return'';const t=String(e.innerText||e.textContent||'').trim();e.click();return t;}).catch(()=>'');if(picked)return picked;}
  }catch{}
  return'';
}
async function fillAndSubmit(page,mawb,forceValue=''){
  const digits=digitsOnly(mawb),formatted=`514-${digits.slice(3)}`,serial=digits.slice(3);
  for(const frame of page.frames()){
    const selected=await chooseAwbType(frame);
    const input=await frame.evaluateHandle(()=>{
      const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>20&&r.height>10&&s.display!=='none'&&s.visibility!=='hidden'&&!e.disabled&&!e.readOnly};
      const inputs=[...document.querySelectorAll('input')].filter(visible).filter(e=>!['hidden','checkbox','radio','submit','button'].includes(String(e.type||'text').toLowerCase()));
      const desc=e=>`${e.placeholder||''} ${e.name||''} ${e.id||''} ${e.getAttribute('aria-label')||''} ${e.getAttribute('title')||''}`;
      return inputs.find(e=>/enter\s+the\s+tracking\s+id|tracking|awb|air\s*waybill|shipment/i.test(desc(e)))||inputs[0]||null;
    }).catch(()=>null);
    const el=input?.asElement?.();if(!el)continue;
    const max=await el.evaluate(e=>Number(e.maxLength||-1)).catch(()=>-1);
    const value=forceValue||(/^\s*514\s*$/.test(selected)?serial:(max===8?serial:(max===11?digits:formatted)));
    await el.click({clickCount:3});await page.keyboard.press('Backspace');await el.type(value,{delay:22});
    let clicked='';
    try{clicked=await frame.evaluate(()=>{const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>20&&r.height>10&&s.display!=='none'&&s.visibility!=='hidden'&&!e.disabled};const els=[...document.querySelectorAll('button,input[type="submit"],input[type="button"],[role="button"]')].filter(visible);const e=els.find(x=>/^\s*submit\s*$/i.test(String(x.innerText||x.value||x.getAttribute('aria-label')||'')))||els.find(x=>/^(?:track|search|submit)$/i.test(String(x.innerText||x.value||x.getAttribute('aria-label')||'').trim()));if(!e)return'';const t=String(e.innerText||e.value||e.getAttribute('aria-label')||'').trim();e.click();return t;});}catch{}
    if(!clicked){await page.keyboard.press('Enter');clicked='Enter';}
    return{filled:true,selected,value,clicked};
  }
  return{filled:false,selected:'',value:'',clicked:''};
}
async function waitResult(page){await Promise.race([page.waitForNetworkIdle({idleTime:900,timeout:9000}).catch(()=>{}),sleep(9000)]);await sleep(800);return allText(page);}
async function clickNext(page){
  for(const frame of page.frames()){
    try{
      const t=await frame.evaluate(()=>{
        const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>20&&r.height>10&&s.display!=='none'&&s.visibility!=='hidden'&&!e.disabled};
        const els=[...document.querySelectorAll('button,input[type="submit"],input[type="button"],[role="button"],a')].filter(visible);
        const candidates=els.map(e=>({e,t:String(e.innerText||e.value||e.getAttribute('aria-label')||e.getAttribute('title')||'').replace(/\s+/g,' ').trim()}));
        const x=candidates.find(o=>/^(?:next|continue|view details|shipment details|view shipment details|more details|tracking details)$/i.test(o.t));
        if(!x)return'';x.e.scrollIntoView({block:'center'});x.e.click();return x.t;
      });
      if(t)return t;
    }catch{}
  }
  return'';
}

export async function trackAirArabia(mawb){
  const digits=digitsOnly(mawb);if(!/^514\d{8}$/.test(digits))return{ok:false,reason:'INVALID AIR ARABIA MAWB',officialTracker:START};
  let browser;
  try{
    browser=await launch();const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36');
    await page.goto(START,{waitUntil:'domcontentloaded',timeout:30000});await sleep(1800);await acceptCookies(page);await sleep(300);
    const before=await allText(page);
    if(/captcha|verify you are human|security check|cloudflare|turnstile|access denied/i.test(before))return{ok:false,reason:'AIR ARABIA SECURITY/CAPTCHA REQUIRES MANUAL CHECK',officialTracker:START,debug:{stage:'captcha'}};

    // Exact required flow: Air Arabia link -> select 514/AWB -> enter tracking ID -> Submit -> Next/details -> screenshot -> extract fields.
    let form=await fillAndSubmit(page,mawb);
    if(!form.filled)return{ok:false,reason:'AIR ARABIA TRACKING INPUT NOT FOUND',officialTracker:START,debug:{stage:'input'}};
    let resultText=await waitResult(page);const attempts=[form];
    if(/captcha|verify you are human|security check|cloudflare|turnstile|access denied/i.test(resultText))return{ok:false,reason:'AIR ARABIA SECURITY/CAPTCHA AFTER SUBMIT',officialTracker:START,debug:{stage:'captcha_after_submit',form}};

    const noMatch=()=>/no\s+matching\s+result|no\s+result|not\s+found|invalid\s+tracking/i.test(resultText);
    const serial=digits.slice(3),alternates=[digits,`514-${serial}`];
    if(noMatch()){
      for(const value of alternates){
        if(value===form.value)continue;
        form=await fillAndSubmit(page,mawb,value);attempts.push(form);if(!form.filled)continue;
        resultText=await waitResult(page);if(!noMatch())break;
      }
    }
    const preNextSample=resultText.slice(0,4500);
    if(noMatch())return{ok:false,notFound:true,reason:'AIR ARABIA RETURNED NO MATCHING RESULT FOR THIS AWB',officialTracker:START,debug:{stage:'no_match',attempts,preNextSample,resultUrl:page.url()}};

    let nextClicked='';
    const bodyHasAwb=digitsOnly(resultText).includes(digits)||digitsOnly(resultText).includes(serial);
    if(bodyHasAwb||/shipment|tracking|awb|waybill/i.test(resultText)){
      nextClicked=await clickNext(page);
      if(nextClicked){await Promise.race([page.waitForNetworkIdle({idleTime:700,timeout:6500}).catch(()=>{}),sleep(6500)]);await sleep(800);resultText=await allText(page);}
    }

    const details=parseDetails(resultText,mawb);
    if(!details.awbMatched){
      return{ok:false,reason:'AIR ARABIA RESULT DID NOT MATCH MAWB',officialTracker:START,debug:{stage:'details',attempts,nextClicked,preNextSample,resultUrl:page.url(),bodySample:resultText.slice(0,4500)}};
    }
    const screenshot=await page.screenshot({type:'jpeg',quality:82,fullPage:false,encoding:'base64'}).catch(()=>null);
    if(!screenshot)return{ok:false,reason:'AIR ARABIA DETAILS SCREENSHOT FAILED',officialTracker:START,debug:{stage:'screenshot',attempts,nextClicked}};
    details.officialTracker=START;
    details.source='Air Arabia Cargo details-screen screenshot + same-screen extraction';
    delete details.awbMatched;
    if(!useful(details))return{ok:false,reason:'AIR ARABIA DETAILS FOUND NO VERIFIED SHIPMENT FIELDS',officialTracker:START,screenshotCaptured:true,screenshotVerified:true,debug:{stage:'parse',attempts,nextClicked,preNextSample,resultUrl:page.url(),bodySample:resultText.slice(0,5000)}};
    return{ok:true,shipment:details,screenshotCaptured:true,screenshotVerified:true,screenshotOcrUsed:false,debug:{stage:'done',startUrl:START,resultUrl:page.url(),attempts,nextClicked:nextClicked||'',awbMatched:true,screenshot:true,arrivalEvidence:details.arrivalEvidence||'',bodySample:resultText.slice(0,4500)}};
  }catch(e){return{ok:false,reason:e?.message||String(e),officialTracker:START,debug:{stage:'exception'}};}
  finally{try{if(browser)await browser.close()}catch{}}
}
