import fs from 'node:fs';
import { normalizeMawb } from './airlines.js';

const URL='https://turkishcargo.com/en/cargo-tracking';
const AIRLINE={name:'Turkish Cargo',iata:'TK',url:URL};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clean=v=>String(v||'').replace(/\s+/g,' ').trim();
const MONTH={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};

async function browserConfig(){
  for(const p of [process.env.CHROME_EXECUTABLE_PATH,'/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome','/usr/bin/google-chrome-stable'].filter(Boolean)){
    if(fs.existsSync(p))return{executablePath:p,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote']};
  }
  const mod=await import('@sparticuz/chromium');const chromium=mod.default||mod;
  return{executablePath:await chromium.executablePath(),args:chromium.args};
}

function safeJson(raw=''){try{return JSON.parse(String(raw).trim())}catch{return null}}
function flatten(v,path='$',out=[],depth=0){
  if(depth>14||v===null||v===undefined)return out;
  if(typeof v==='object'){
    if(Array.isArray(v))v.forEach((x,i)=>flatten(x,`${path}[${i}]`,out,depth+1));
    else Object.entries(v).forEach(([k,x])=>flatten(x,`${path}.${k}`,out,depth+1));
    return out;
  }
  out.push({path,value:String(v)});return out;
}
function value(entries,rx,valueRx=null){for(const e of entries)if(rx.test(e.path)&&(!valueRx||valueRx.test(e.value)))return e.value;return''}
function airport(v=''){const m=String(v).toUpperCase().match(/\b([A-Z]{3})\b/);return m?m[1]:''}
function num(v=''){const m=String(v).match(/[\d,.]+/);return m?m[0].replace(/,/g,''):''}
function flight(v=''){const m=clean(v).toUpperCase().match(/\bTK[-\s]?(\d{2,4})\b/);return m?`TK${m[1]}`:''}

function status(text='',destination=''){
  const s=clean(text).toUpperCase(),dest=String(destination||'').toUpperCase();
  if(/\bDLV\b|DELIVERED|SHIPMENT DELIVERED/.test(s))return'ARRIVED';
  if(dest&&new RegExp(`\\bRCF\\s+${dest}\\b|${dest}[^.]{0,90}RECEIVED FROM FLIGHT`,'i').test(s))return'ARRIVED';
  if(/\bDEP\b|DEPARTED|IN TRANSIT|AIRBORNE|IN FLIGHT/.test(s))return'IN TRANSIT';
  if(/DELAY|LATE|EXCEPTION/.test(s))return'DELAYED';
  if(/\bRCS\b|BOOKED|ACCEPTED|MANIFESTED/.test(s))return'BOOKED';
  return'BOOKED';
}

function dt(v=''){
  const s=clean(v);let m;
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

function shipment(mawb,{origin='',destination='',pieces='',weight='',volume='',flightNo='',arrival={date:'',time:''},actual=false,st='BOOKED',source='official page'}={}){
  return{mawb,carrierCode:'TK',airlineName:'Turkish Cargo',origin,destination,bags:pieces,pieces,weight,volume,flightNo,arrivalDate:arrival.date,arrivalTime:arrival.time,arrivalIsActual:actual,status:st,officialTracker:URL,source:`Turkish Cargo ${source}`};
}

function parseStructured(raw,mawb){
  const json=safeJson(raw);if(!json)return null;
  const entries=flatten(json);if(!entries.length)return null;
  const joined=clean(entries.map(e=>`${e.path} ${e.value}`).join(' '));
  const digits=mawb.replace(/\D/g,''),serial=digits.slice(3);
  if(/no (?:shipment|record|result)|not found|invalid (?:awb|air waybill)|no data|bulunamad/i.test(joined))return{notFound:true};
  const origin=airport(value(entries,/(?:origin|fromStation|fromAirport|departureStation|departureAirport|flightOrigin|fromPort)/i,/\b[A-Z]{3}\b/i));
  const destination=airport(value(entries,/(?:destination|toStation|toAirport|arrivalStation|arrivalAirport|flightDestination|toPort)/i,/\b[A-Z]{3}\b/i));
  const pieces=num(value(entries,/(?:pieceCount|pieces|totalPieces|totalPiece|pcs|bag)/i,/\d/));
  const weight=num(value(entries,/(?:grossWeight|chargeableWeight|totalWeight|weight)/i,/\d/));
  const volume=num(value(entries,/(?:volume|cubic|m3)/i,/\d/));
  const flightNo=flight(value(entries,/(?:flightNo|flightNumber|flight)/i,/\d/))||flight(joined);
  const actualRaw=value(entries,/(?:actual.*arriv|arriv.*actual|actualArrival|delivered|\bdlv\b|\bata\b)/i,/\d/);
  const etaRaw=value(entries,/(?:estimated.*arriv|expected.*arriv|scheduled.*arriv|estimatedArrival|\beta\b)/i,/\d/);
  let arrival=dt(actualRaw),actual=Boolean(arrival.date);if(!arrival.date)arrival=dt(etaRaw);
  const st=status(joined,destination);
  if(st==='ARRIVED'&&arrival.date)actual=true;
  const mentions=joined.includes(mawb)||joined.includes(digits)||joined.includes(serial);
  const strong=Boolean((origin&&destination)||pieces||weight||flightNo||arrival.date||st!=='BOOKED');
  if(!strong||(!mentions&&!((origin&&destination)||(flightNo&&arrival.date))))return null;
  return{useful:true,shipment:shipment(mawb,{origin,destination,pieces,weight,volume,flightNo,arrival,actual,st,source:'official network response'})};
}

function parsePage(text,mawb){
  const s=clean(text),digits=mawb.replace(/\D/g,''),serial=digits.slice(3);
  if(/no (?:shipment|record|result)|not found|invalid (?:awb|air waybill)|no data/i.test(s))return{notFound:true};
  if(!(s.includes(mawb)||s.includes(digits)||s.includes(serial)))return null;

  const route=s.match(/\b([A-Z]{3})\s*(?:-|–|—|→|>)\s*([A-Z]{3})\b/);
  const origin=((s.match(/\bFROM\s+([A-Z]{3})\s*-/i)||[])[1]||(s.match(/(?:origin|departure(?: airport| station)?)\s*[:\-]?\s*([A-Z]{3})\b/i)||[])[1]||route?.[1]||'').toUpperCase();
  const destination=((s.match(/\bTO\s+([A-Z]{3})\s*-/i)||[])[1]||(s.match(/(?:destination|arrival(?: airport| station)?)\s*[:\-]?\s*([A-Z]{3})\b/i)||[])[1]||route?.[2]||'').toUpperCase();
  const pieces=(s.match(/\b(\d{1,6})\s*PIECE\(S\)/i)||s.match(/\b(\d{1,6})\s*(?:PIECES?|PCS?|BAGS?)\b/i)||s.match(/(?:pieces?|pcs?|bags?)\s*[:#-]?\s*(\d{1,6})\b/i)||[])[1]||'';
  const weight=((s.match(/\b([\d,.]+)\s*KG\b/i)||s.match(/(?:gross\s*weight|weight)\s*[:#-]?\s*([\d,.]+)/i)||[])[1]||'').replace(/,/g,'');
  const volume=((s.match(/\b([\d,.]+)\s*M3\b/i)||[])[1]||'').replace(/,/g,'');
  const flightNo=flight(s);
  const st=status(s,destination);

  let arrival={date:'',time:''},actual=false;
  if(st==='ARRIVED'){
    const deliveredBlock=(s.match(/(?:DELIVERED\s*-?\s*[A-Z]{3}|SHIPMENT DELIVERED|\bDLV\b)[\s\S]{0,320}/i)||[])[0]||s;
    arrival=dt(deliveredBlock);actual=Boolean(arrival.date);
  }
  if(!arrival.date){
    const etaBlock=(s.match(/(?:ETA|ESTIMATED ARRIVAL|EXPECTED ARRIVAL|SCHEDULED ARRIVAL)[\s\S]{0,260}/i)||[])[0]||'';
    arrival=dt(etaBlock);
  }
  if(!arrival.date&&st==='ARRIVED'){
    const topCard=(s.match(/DELIVERED\s*-?\s*[A-Z]{3}[\s\S]{0,180}/i)||[])[0]||'';
    arrival=dt(topCard);actual=Boolean(arrival.date);
  }

  const strong=Boolean((origin&&destination)||pieces||weight||flightNo||arrival.date||/TK SMART|\bDLV\b|DELIVERED/i.test(s));
  return strong?{useful:true,shipment:shipment(mawb,{origin,destination,pieces,weight,volume,flightNo,arrival,actual,st,source:'official result card'})}:null;
}

async function pageText(page){
  const out=[];
  for(const f of page.frames())try{const t=await f.evaluate(()=>document.body?.innerText||'');if(t)out.push(t)}catch{}
  return out.join('\n');
}

async function clickExact(frame,label){
  try{
    return await frame.evaluate((wanted)=>{
      const norm=s=>String(s||'').replace(/\s+/g,' ').trim().toLowerCase();
      const items=[...document.querySelectorAll('button,input[type="submit"],input[type="button"],[role="button"]')];
      const el=items.find(e=>{
        const r=e.getBoundingClientRect();
        const text=norm(e.innerText||e.value||e.getAttribute('aria-label')||'');
        return r.width>3&&r.height>3&&!e.disabled&&text===norm(wanted);
      });
      if(!el)return'';el.click();return String(el.innerText||el.value||wanted).trim();
    },label);
  }catch{return''}
}

async function clickAddSuggestion(frame,serial){
  try{
    return await frame.evaluate((awb)=>{
      const norm=s=>String(s||'').replace(/\s+/g,' ').trim().toLowerCase();
      const target=norm(`Add: ${awb}`);
      const items=[...document.querySelectorAll('[role="option"],[role="menuitem"],li,button,div,span')];
      const el=items.find(e=>{
        const r=e.getBoundingClientRect();
        return r.width>3&&r.height>3&&norm(e.innerText||e.textContent)===target;
      });
      if(!el)return false;el.click();return true;
    },serial);
  }catch{return false}
}

async function scrollLittle(page){
  for(const frame of page.frames())try{await frame.evaluate(()=>window.scrollBy({top:520,left:0,behavior:'auto'}))}catch{}
  await sleep(500);
}

async function fillAddSearch(page,mawb){
  const digits=mawb.replace(/\D/g,''),prefix=digits.slice(0,3),serial=digits.slice(3);
  for(const frame of page.frames()){
    const inputs=await frame.$$('input:not([type="hidden"]),textarea'),fields=[];
    for(const input of inputs)try{
      const meta=await input.evaluate(el=>{const r=el.getBoundingClientRect();return{visible:r.width>3&&r.height>3&&!el.disabled&&!el.readOnly,max:Number(el.maxLength||-1),label:`${el.placeholder||''} ${el.name||''} ${el.id||''} ${el.getAttribute('aria-label')||''} ${el.labels?.[0]?.innerText||''}`}});
      if(meta.visible)fields.push({input,meta});
    }catch{}
    const pf=fields.find(x=>x.meta.max===3||/prefix|awb code|airline code/i.test(x.meta.label));
    let nf=fields.find(x=>x!==pf&&(x.meta.max===8||/awb|air waybill/i.test(x.meta.label));
    if(!nf)nf=fields.find(x=>[11,12,14].includes(x.meta.max));
    if(!nf)continue;

    if(pf){await pf.input.click({clickCount:3});await page.keyboard.press('Backspace');await pf.input.type(prefix,{delay:35});}
    await nf.input.click({clickCount:3});await page.keyboard.press('Backspace');await nf.input.type(nf.meta.max===8?serial:(pf?serial:digits),{delay:35});
    await sleep(450);

    let addMode='CLICK_ADD';
    let added=await clickAddSuggestion(frame,serial);
    if(!added){await nf.input.press('Enter');addMode='ENTER_ADD';}
    await sleep(700);

    const searchText=await clickExact(frame,'Search');
    if(!searchText)return{ok:false,stage:'CARGO_SEARCH_NOT_FOUND',addMode};
    return{ok:true,stage:'ADD_THEN_CARGO_SEARCH',addMode,searchText};
  }
  return{ok:false,stage:'FORM_NOT_FOUND'};
}

export async function trackTurkish(input){
  const mawb=normalizeMawb(input);
  if(!mawb||!mawb.startsWith('235-'))return{ok:false,reason:'INVALID TURKISH MAWB',airline:AIRLINE};

  let browser;const network=[];const debug={prefix:'235',airline:'Turkish Cargo',url:URL,stage:'OPEN'};
  try{
    const mod=await import('puppeteer-core');const puppeteer=mod.default||mod;const launch=await browserConfig();
    browser=await puppeteer.launch({...launch,headless:true,defaultViewport:{width:1440,height:1000}});
    const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36');
    await page.setExtraHTTPHeaders({'Accept-Language':'en-US,en;q=0.9'});
    page.on('response',async res=>{try{
      const u=res.url(),ct=res.headers()['content-type']||'';
      if(!/cargo|track|awb|shipment|api|search/i.test(u)&&!/json|text/i.test(ct))return;
      const body=await res.text();
      if(body&&body.length<1500000){network.push({url:u,status:res.status(),body});if(network.length>60)network.shift();}
    }catch{}});

    await page.goto(URL,{waitUntil:'domcontentloaded',timeout:30000});await sleep(1800);
    for(const frame of page.frames())try{await clickExact(frame,'Accept all')}catch{}
    const before=await pageText(page);
    if(/captcha|verify you are human|access denied|cloudflare|security check/i.test(before))return{ok:false,reason:'OFFICIAL SITE BLOCKED AUTOMATION',airline:AIRLINE,debug:{...debug,stage:'BLOCKED'}};

    const flow=await fillAddSearch(page,mawb);
    if(!flow.ok)return{ok:false,reason:'TURKISH ADD/SEARCH FLOW NOT FOUND',airline:AIRLINE,debug:{...debug,...flow}};

    for(let i=0;i<20;i++){
      await sleep(i?650:1200);
      if(i===2||i===6||i===12)await scrollLittle(page);

      for(let n=network.length-1;n>=0;n--){
        const p=parseStructured(network[n].body,mawb);
        if(p?.notFound)return{ok:false,notFound:true,reason:'NO SHIPMENT RECORD',airline:AIRLINE,debug:{...debug,...flow,stage:'NO_RECORD',source:'network'}};
        if(p?.useful)return{ok:true,airline:AIRLINE,shipment:p.shipment,debug:{...debug,...flow,stage:'SUCCESS',source:'network',networkUrl:network[n].url}};
      }

      const pageNow=await pageText(page);
      const p=parsePage(pageNow,mawb);
      if(p?.notFound)return{ok:false,notFound:true,reason:'NO SHIPMENT RECORD',airline:AIRLINE,debug:{...debug,...flow,stage:'NO_RECORD',source:'page'}};
      if(p?.useful&&(/TK SMART|\bDLV\b|DELIVERED|\bFROM\s+[A-Z]{3}\s*-/i.test(pageNow)))return{ok:true,airline:AIRLINE,shipment:p.shipment,debug:{...debug,...flow,stage:'SUCCESS_AFTER_SCROLL',source:'page',pageSample:clean(pageNow).slice(0,8000)}};
    }

    const finalText=await pageText(page);
    return{ok:false,reason:'TURKISH RESULT NOT MACHINE READABLE',airline:AIRLINE,debug:{...debug,...flow,stage:'UNREADABLE_AFTER_SCROLL',networkUrls:network.slice(-12).map(x=>x.url),preview:clean(finalText).slice(0,8000)}};
  }catch(e){
    return{ok:false,reason:e?.message||'TURKISH TRACKING FAILED',airline:AIRLINE,debug:{...debug,stage:'BROWSER_ERROR'}};
  }finally{if(browser)try{await browser.close()}catch{}}
}
