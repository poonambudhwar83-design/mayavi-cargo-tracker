import fs from 'node:fs';
import { normalizeMawb } from './airlines.js';

const URL='https://turkishcargo.com/en/cargo-tracking';
const AIRLINE={name:'Turkish Cargo',iata:'TK',url:URL};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clean=v=>String(v||'').replace(/\s+/g,' ').trim();
const MONTH={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};

async function browserConfig(){
  for(const p of [process.env.CHROME_EXECUTABLE_PATH,'/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome','/usr/bin/google-chrome-stable'].filter(Boolean)){
    if(fs.existsSync(p)) return {executablePath:p,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote']};
  }
  const mod=await import('@sparticuz/chromium');
  const chromium=mod.default||mod;
  return {executablePath:await chromium.executablePath(),args:chromium.args};
}

function parseDateTime(v=''){
  const s=clean(v); let m;
  m=s.match(/(20\d{2})[-\/]([01]\d)[-\/]([0-3]\d)[T\s](\d{1,2}):(\d{2})/);
  if(m)return{date:`${m[1]}-${m[2]}-${m[3]}`,time:`${String(m[4]).padStart(2,'0')}:${m[5]}`};
  m=s.match(/([0-3]?\d)[-\/.]([01]?\d)[-\/.](20\d{2})[T\s](\d{1,2}):(\d{2})/);
  if(m)return{date:`${m[3]}-${String(m[2]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`,time:`${String(m[4]).padStart(2,'0')}:${m[5]}`};
  m=s.match(/\b([0-3]?\d)\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s+(20\d{2})\s+(\d{1,2}):(\d{2})\b/i);
  if(m)return{date:`${m[3]}-${MONTH[m[2].slice(0,3).toUpperCase()]}-${String(m[1]).padStart(2,'0')}`,time:`${String(m[4]).padStart(2,'0')}:${m[5]}`};
  m=s.match(/\b(JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER)\s+([0-3]?\d)(?:ST|ND|RD|TH)?,?\s+(20\d{2})\s+(\d{1,2}):(\d{2})\b/i);
  if(m)return{date:`${m[3]}-${MONTH[m[1].slice(0,3).toUpperCase()]}-${String(m[2]).padStart(2,'0')}`,time:`${String(m[4]).padStart(2,'0')}:${m[5]}`};
  return{date:'',time:''};
}

function lastFlight(text=''){
  const all=[...clean(text).toUpperCase().matchAll(/\bTK[-\s]?(\d{2,4})\b/g)];
  return all.length?`TK${all.at(-1)[1]}`:'';
}

function shipmentStatus(text='',destination=''){
  const s=clean(text).toUpperCase();
  const dest=String(destination||'').toUpperCase();
  if(/\bDLV\b|SHIPMENT DELIVERED|DELIVERED\s*-?\s*[A-Z]{3}/.test(s))return'ARRIVED';
  if(dest&&new RegExp(`\\bRCF\\s+${dest}\\b|${dest}[^.]{0,120}RECEIVED FROM FLIGHT`,'i').test(s))return'ARRIVED';
  if(/\bDEP\b|DEPARTED|IN TRANSIT|AIRBORNE|IN FLIGHT/.test(s))return'IN TRANSIT';
  if(/DELAY|LATE|EXCEPTION/.test(s))return'DELAYED';
  return'BOOKED';
}

function parseTkSmart(text,mawb){
  const s=clean(text);
  const digits=mawb.replace(/\D/g,'');
  const serial=digits.slice(3);
  if(/no (?:shipment|record|result)|not found|invalid (?:awb|air waybill)|no data/i.test(s))return{notFound:true};
  if(!(s.includes(mawb)||s.includes(digits)||s.includes(serial)))return null;

  const origin=((s.match(/\bFROM\s+([A-Z]{3})\s*-/i)||[])[1]||'').toUpperCase();
  const destination=((s.match(/\bTO\s+([A-Z]{3})\s*-/i)||[])[1]||'').toUpperCase();
  const pieces=(s.match(/\b(\d{1,6})\s*PIECE\(S\)/i)||s.match(/\b(\d{1,6})\s*(?:PIECES?|PCS?|BAGS?)\b/i)||[])[1]||'';
  const weight=((s.match(/\b([\d,.]+)\s*KG\b/i)||[])[1]||'').replace(/,/g,'');
  const volume=((s.match(/\b([\d,.]+)\s*M3\b/i)||[])[1]||'').replace(/,/g,'');
  const flightNo=lastFlight(s);
  const status=shipmentStatus(s,destination);

  let arrival={date:'',time:''};
  let arrivalIsActual=false;
  if(status==='ARRIVED'){
    const finalRx=destination?new RegExp(`(?:DELIVERED\\s*-?\\s*${destination}|\\bDLV\\b[^.]{0,80}${destination}|SHIPMENT DELIVERED)[\\s\\S]{0,360}`,'i'):/(?:DELIVERED\s*-?\s*[A-Z]{3}|\bDLV\b|SHIPMENT DELIVERED)[\s\S]{0,360}/i;
    const block=(s.match(finalRx)||[])[0]||s;
    arrival=parseDateTime(block);
    if(!arrival.date)arrival=parseDateTime(s);
    arrivalIsActual=Boolean(arrival.date);
  }else{
    const eta=(s.match(/(?:ETA|ESTIMATED ARRIVAL|EXPECTED ARRIVAL|SCHEDULED ARRIVAL)[\s\S]{0,300}/i)||[])[0]||'';
    arrival=parseDateTime(eta);
  }

  const bookingBlock=(s.match(/(?:BOOKED|BOOKING|ACCEPTED)[\s\S]{0,260}/i)||[])[0]||'';
  const bookingDate=parseDateTime(bookingBlock).date;
  const useful=Boolean((origin&&destination)||pieces||weight||volume||flightNo||arrival.date||/TK SMART|\bDLV\b|DELIVERED/i.test(s));
  if(!useful)return null;

  return{useful:true,shipment:{
    mawb,
    carrierCode:'TK',
    airlineName:'Turkish Cargo',
    origin,
    destination,
    bags:pieces,
    pieces,
    weight,
    volume,
    flightNo,
    bookingDate,
    arrivalDate:arrival.date,
    arrivalTime:arrival.time,
    arrivalIsActual,
    status,
    officialTracker:URL,
    source:'Turkish Cargo TK SMART / Cargo Tracking Information'
  }};
}

async function pageText(page){
  const out=[];
  for(const f of page.frames())try{const t=await f.evaluate(()=>document.body?.innerText||'');if(t)out.push(t)}catch{}
  return out.join('\n');
}

async function clickAcceptAll(frame){
  try{return await frame.evaluate(()=>{
    const norm=s=>String(s||'').replace(/\s+/g,' ').trim().toLowerCase();
    for(const el of document.querySelectorAll('button,[role="button"],a,[onclick],div,span')){
      const r=el.getBoundingClientRect();
      if(r.width>3&&r.height>3&&norm(el.innerText||el.textContent)==='accept all'){el.click();return true;}
    }
    return false;
  })}catch{return false}
}

async function clickAddSuggestion(frame,serial){
  try{return await frame.evaluate((awb)=>{
    const norm=s=>String(s||'').replace(/\s+/g,' ').trim().toLowerCase();
    const target=norm(`Add: ${awb}`);
    const found=[];
    for(const el of document.querySelectorAll('[role="option"],[role="menuitem"],li,button,[role="button"],a,[onclick],div,span')){
      const r=el.getBoundingClientRect();
      if(r.width>3&&r.height>3&&norm(el.innerText||el.textContent)===target)found.push({el,area:r.width*r.height});
    }
    found.sort((a,b)=>a.area-b.area);
    if(!found.length)return false;
    found[0].el.click();
    return true;
  },serial)}catch{return false}
}

async function clickCargoSearch(frame){
  try{return await frame.evaluate(()=>{
    const norm=s=>String(s||'').replace(/\s+/g,' ').trim().toLowerCase();
    const visible=el=>{const r=el.getBoundingClientRect();return r.width>3&&r.height>3&&!el.disabled};
    const exact=root=>[...root.querySelectorAll('button,input[type="submit"],input[type="button"],[role="button"],a,[onclick],div,span')]
      .filter(el=>visible(el)&&norm(el.innerText||el.value||el.textContent)==='search')
      .sort((a,b)=>{const ra=a.getBoundingClientRect(),rb=b.getBoundingClientRect();return ra.width*ra.height-rb.width*rb.height;});
    const roots=[...document.querySelectorAll('form,section,article,div')]
      .filter(el=>{const t=norm(el.innerText||el.textContent);return t.includes('cargo tracking information')&&t.includes('awb');})
      .sort((a,b)=>String(a.innerText||'').length-String(b.innerText||'').length);
    for(const root of roots){const hit=exact(root)[0];if(hit){hit.click();return'Search';}}
    const fallback=exact(document)[0];
    if(fallback){fallback.click();return'Search';}
    return'';
  })}catch{return''}
}

async function tkSmartText(page,serial){
  for(const frame of page.frames()){
    try{
      const result=await frame.evaluate((awb)=>{
        const norm=s=>String(s||'').replace(/\s+/g,' ').trim();
        const candidates=[];
        const scan=root=>{
          for(const el of root.querySelectorAll('section,article,div')){
            const t=norm(el.innerText||el.textContent);
            if(t.length<40||t.length>15000)continue;
            if(/TK SMART/i.test(t)&&t.includes(awb)&&(/PIECE\(S\)|PIECES?|\bFROM\b|\bTO\b/i.test(t))){
              candidates.push({el,text:t,len:t.length});
            }
            if(el.shadowRoot)scan(el.shadowRoot);
          }
        };
        scan(document);
        candidates.sort((a,b)=>a.len-b.len);
        const hit=candidates[0];
        if(!hit)return'';
        hit.el.scrollIntoView({block:'center',behavior:'auto'});
        return hit.text;
      },serial);
      if(result)return result;
    }catch{}
  }
  return'';
}

async function fillAddSearch(page,mawb){
  const digits=mawb.replace(/\D/g,'');
  const prefix=digits.slice(0,3);
  const serial=digits.slice(3);

  for(const frame of page.frames()){
    const inputs=await frame.$$('input:not([type="hidden"]),textarea');
    const fields=[];
    for(const input of inputs){
      try{
        const meta=await input.evaluate(el=>{const r=el.getBoundingClientRect();return{visible:r.width>3&&r.height>3&&!el.disabled&&!el.readOnly,max:Number(el.maxLength||-1),label:`${el.placeholder||''} ${el.name||''} ${el.id||''} ${el.getAttribute('aria-label')||''} ${el.labels?.[0]?.innerText||''}`}});
        if(meta.visible)fields.push({input,meta});
      }catch{}
    }
    const pf=fields.find(x=>x.meta.max===3||/prefix|awb code|airline code/i.test(x.meta.label));
    let nf=fields.find(x=>x!==pf&&(x.meta.max===8||/awb|air waybill/i.test(x.meta.label)));
    if(!nf)nf=fields.find(x=>[11,12,14].includes(x.meta.max));
    if(!nf)continue;

    if(pf){await pf.input.click({clickCount:3});await page.keyboard.press('Backspace');await pf.input.type(prefix,{delay:35});}
    await nf.input.click({clickCount:3});
    await page.keyboard.press('Backspace');
    await nf.input.type(nf.meta.max===8?serial:(pf?serial:digits),{delay:35});
    await sleep(450);

    let addMode='CLICK_ADD';
    if(!await clickAddSuggestion(frame,serial)){
      await nf.input.press('Enter');
      addMode='ENTER_ADD';
    }
    await sleep(800);

    const searchText=await clickCargoSearch(frame);
    if(!searchText)return{ok:false,stage:'CARGO_SEARCH_NOT_FOUND',addMode};
    return{ok:true,stage:'ADD_THEN_CARGO_SEARCH',addMode,searchText};
  }
  return{ok:false,stage:'FORM_NOT_FOUND'};
}

export async function trackTurkish(input){
  const mawb=normalizeMawb(input);
  if(!mawb||!mawb.startsWith('235-'))return{ok:false,reason:'INVALID TURKISH MAWB',airline:AIRLINE};

  let browser;
  const serial=mawb.replace(/\D/g,'').slice(3);
  const debug={prefix:'235',airline:'Turkish Cargo',url:URL,stage:'OPEN'};
  try{
    const mod=await import('puppeteer-core');
    const puppeteer=mod.default||mod;
    const launch=await browserConfig();
    browser=await puppeteer.launch({...launch,headless:true,defaultViewport:{width:1440,height:1000}});
    const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36');
    await page.setExtraHTTPHeaders({'Accept-Language':'en-US,en;q=0.9'});
    await page.goto(URL,{waitUntil:'domcontentloaded',timeout:30000});
    await sleep(1800);
    for(const frame of page.frames())await clickAcceptAll(frame);

    const before=await pageText(page);
    if(/captcha|verify you are human|access denied|cloudflare|security check/i.test(before))return{ok:false,reason:'OFFICIAL SITE BLOCKED AUTOMATION',airline:AIRLINE,debug:{...debug,stage:'BLOCKED'}};

    const flow=await fillAddSearch(page,mawb);
    if(!flow.ok)return{ok:false,reason:'TURKISH ADD/SEARCH FLOW NOT FOUND',airline:AIRLINE,debug:{...debug,...flow}};

    for(let i=0;i<24;i++){
      await sleep(i?650:1200);
      const card=await tkSmartText(page,serial);
      if(card){
        const parsed=parseTkSmart(card,mawb);
        if(parsed?.notFound)return{ok:false,notFound:true,reason:'NO SHIPMENT RECORD',airline:AIRLINE,debug:{...debug,...flow,stage:'NO_RECORD'}};
        if(parsed?.useful)return{ok:true,airline:AIRLINE,shipment:parsed.shipment,debug:{...debug,...flow,stage:'TK_SMART_SUCCESS',tkSmartSample:clean(card).slice(0,8000)}};
      }
      if(i===5||i===12){
        for(const frame of page.frames())try{await frame.evaluate(()=>window.scrollBy({top:520,left:0,behavior:'auto'}))}catch{}
      }
    }

    const finalText=await pageText(page);
    const parsed=parseTkSmart(finalText,mawb);
    if(parsed?.useful)return{ok:true,airline:AIRLINE,shipment:parsed.shipment,debug:{...debug,...flow,stage:'FULL_PAGE_FALLBACK_SUCCESS'}};
    return{ok:false,reason:'TURKISH TK SMART RESULT NOT MACHINE READABLE',airline:AIRLINE,debug:{...debug,...flow,stage:'TK_SMART_UNREADABLE',preview:clean(finalText).slice(0,8000)}};
  }catch(e){
    return{ok:false,reason:e?.message||'TURKISH TRACKING FAILED',airline:AIRLINE,debug:{...debug,stage:'BROWSER_ERROR'}};
  }finally{
    if(browser)try{await browser.close()}catch{}
  }
}
