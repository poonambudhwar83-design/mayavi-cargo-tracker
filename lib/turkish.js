import fs from 'node:fs';
import { normalizeMawb } from './airlines.js';

const URL='https://turkishcargo.com/en/cargo-tracking';
const AIRLINE={name:'Turkish Cargo',iata:'TK',url:URL};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clean=v=>String(v||'').replace(/\s+/g,' ').trim();

async function browserConfig(){
  for(const p of [process.env.CHROME_EXECUTABLE_PATH,'/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome','/usr/bin/google-chrome-stable'].filter(Boolean)){
    if(fs.existsSync(p)) return {executablePath:p,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote']};
  }
  const mod=await import('@sparticuz/chromium'); const chromium=mod.default||mod;
  return {executablePath:await chromium.executablePath(),args:chromium.args};
}

function safeJson(raw=''){try{return JSON.parse(String(raw).trim())}catch{return null}}
function flatten(v,path='$',out=[],depth=0){
  if(depth>14||v===null||v===undefined)return out;
  if(typeof v==='object'){if(Array.isArray(v))v.forEach((x,i)=>flatten(x,`${path}[${i}]`,out,depth+1));else Object.entries(v).forEach(([k,x])=>flatten(x,`${path}.${k}`,out,depth+1));return out;}
  out.push({path,value:String(v)});return out;
}
function value(entries,rx,valueRx=null){for(const e of entries)if(rx.test(e.path)&&(!valueRx||valueRx.test(e.value)))return e.value;return''}
function airport(v=''){const m=String(v).toUpperCase().match(/\b([A-Z]{3})\b/);return m?m[1]:''}
function num(v=''){const m=String(v).match(/[\d,.]+/);return m?m[0].replace(/,/g,''):''}
function status(text=''){
  if(/\bDLV\b|delivered/i.test(text))return'DELIVERED';
  if(/\bRCF\b|received at destination/i.test(text))return'RECEIVED AT DESTINATION';
  if(/\bARR\b|arrived|actual arrival|landed/i.test(text))return'ARRIVED';
  if(/\bDEP\b|departed|in transit|airborne|in flight/i.test(text))return'IN TRANSIT';
  if(/\bRCS\b|booked|accepted|manifested/i.test(text))return'BOOKED';
  if(/delay|late|exception/i.test(text))return'DELAYED';
  return'TRACKING';
}
function dt(v=''){
  const s=clean(v); let m=s.match(/(20\d{2})[-\/]([01]\d)[-\/]([0-3]\d)[T\s](\d{1,2}):(\d{2})/);
  if(m)return{date:`${m[1]}-${m[2]}-${m[3]}`,time:`${String(m[4]).padStart(2,'0')}:${m[5]}`};
  m=s.match(/([0-3]?\d)[-\/.]([01]?\d)[-\/.](20\d{2})[T\s](\d{1,2}):(\d{2})/);
  if(m)return{date:`${m[3]}-${String(m[2]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`,time:`${String(m[4]).padStart(2,'0')}:${m[5]}`};
  return{date:'',time:''};
}
function flight(v=''){const m=clean(v).toUpperCase().match(/\bTK[-\s]?(\d{2,4})\b/);return m?`TK${m[1]}`:''}
function shipment(mawb,{origin='',destination='',pieces='',weight='',flightNo='',arrival={date:'',time:''},actual=false,st='TRACKING',source='official network response'}={}){
  return{mawb,carrierCode:'TK',airlineName:'Turkish Cargo',origin,destination,bags:pieces,pieces,weight,flightNo,arrivalDate:arrival.date,arrivalTime:arrival.time,arrivalIsActual:actual,status:st,officialTracker:URL,source:`Turkish Cargo ${source}`};
}
function parseStructured(raw,mawb){
  const json=safeJson(raw); if(!json)return null;
  const entries=flatten(json); if(!entries.length)return null;
  const joined=clean(entries.map(e=>`${e.path} ${e.value}`).join(' '));
  const digits=mawb.replace(/\D/g,''),serial=digits.slice(3);
  if(/no (?:shipment|record|result)|not found|invalid (?:awb|air waybill)|no data|bulunamad/i.test(joined))return{notFound:true};
  const origin=airport(value(entries,/(?:origin|fromStation|fromAirport|departureStation|departureAirport|flightOrigin|fromPort)/i,/\b[A-Z]{3}\b/i));
  const destination=airport(value(entries,/(?:destination|toStation|toAirport|arrivalStation|arrivalAirport|flightDestination|toPort)/i,/\b[A-Z]{3}\b/i));
  const pieces=num(value(entries,/(?:pieceCount|pieces|totalPieces|totalPiece|pcs|bag)/i,/\d/));
  const weight=num(value(entries,/(?:grossWeight|chargeableWeight|totalWeight|weight)/i,/\d/));
  const flightNo=flight(value(entries,/(?:flightNo|flightNumber|flight)/i,/\d/))||flight(joined);
  const actualRaw=value(entries,/(?:actual.*arriv|arriv.*actual|actualArrival|\bata\b)/i,/\d/);
  const etaRaw=value(entries,/(?:estimated.*arriv|expected.*arriv|scheduled.*arriv|estimatedArrival|\beta\b)/i,/\d/);
  let arrival=dt(actualRaw),actual=Boolean(arrival.date); if(!arrival.date)arrival=dt(etaRaw);
  const st=status(joined);
  const mentions=joined.includes(mawb)||joined.includes(digits)||joined.includes(serial);
  const strong=Boolean((origin&&destination)||pieces||weight||flightNo||arrival.date||st!=='TRACKING');
  if(!strong||(!mentions&&!((origin&&destination)||(flightNo&&arrival.date))))return null;
  return{useful:true,shipment:shipment(mawb,{origin,destination,pieces,weight,flightNo,arrival,actual,st})};
}
function parsePage(text,mawb){
  const s=clean(text),digits=mawb.replace(/\D/g,''),serial=digits.slice(3);
  if(/no (?:shipment|record|result)|not found|invalid (?:awb|air waybill)|no data/i.test(s))return{notFound:true};
  if(!(s.includes(mawb)||s.includes(digits)||s.includes(serial)))return null;
  const route=s.match(/\b([A-Z]{3})\s*(?:-|–|—|→|>)\s*([A-Z]{3})\b/);
  const origin=((s.match(/(?:origin|from|departure(?: airport| station)?)\s*[:\-]?\s*([A-Z]{3})\b/i)||[])[1]||route?.[1]||'').toUpperCase();
  const destination=((s.match(/(?:destination|to|arrival(?: airport| station)?)\s*[:\-]?\s*([A-Z]{3})\b/i)||[])[1]||route?.[2]||'').toUpperCase();
  const pieces=(s.match(/(?:pieces?|pcs?|bags?)\s*[:#-]?\s*(\d{1,6})\b/i)||[])[1]||'';
  const weight=((s.match(/(?:gross\s*weight|weight)\s*[:#-]?\s*([\d,.]+)\s*(?:kg|kgs)?/i)||[])[1]||'').replace(/,/g,'');
  const flightNo=flight(s); let arrival=dt((s.match(/(?:actual arrival|arrived|landed|\bARR\b)[\s\S]{0,220}/i)||[])[0]||''),actual=Boolean(arrival.date); if(!arrival.date)arrival=dt((s.match(/(?:estimated arrival|expected arrival|scheduled arrival|\bETA\b)[\s\S]{0,240}/i)||[])[0]||'');
  const st=status(s),strong=Boolean((origin&&destination)||pieces||weight||flightNo||arrival.date||st!=='TRACKING');
  return strong?{useful:true,shipment:shipment(mawb,{origin,destination,pieces,weight,flightNo,arrival,actual,st,source:'official page'})}:null;
}
async function pageText(page){const out=[];for(const f of page.frames())try{const t=await f.evaluate(()=>document.body?.innerText||'');if(t)out.push(t)}catch{}return out.join('\n')}
async function fill(page,mawb){
  const digits=mawb.replace(/\D/g,''),prefix=digits.slice(0,3),serial=digits.slice(3);
  for(const frame of page.frames()){
    const inputs=await frame.$$('input:not([type="hidden"]),textarea'),fields=[];
    for(const input of inputs)try{const meta=await input.evaluate(el=>{const r=el.getBoundingClientRect();return{visible:r.width>3&&r.height>3&&!el.disabled&&!el.readOnly,max:Number(el.maxLength||-1),label:`${el.placeholder||''} ${el.name||''} ${el.id||''} ${el.getAttribute('aria-label')||''} ${el.labels?.[0]?.innerText||''}`}});if(meta.visible)fields.push({input,meta})}catch{}
    const pf=fields.find(x=>x.meta.max===3||/prefix|awb code|airline code/i.test(x.meta.label));
    let nf=fields.find(x=>x!==pf&&(x.meta.max===8||/awb|air waybill/i.test(x.meta.label))); if(!nf)nf=fields.find(x=>[11,12,14].includes(x.meta.max)); if(!nf)continue;
    if(pf){await pf.input.click({clickCount:3});await page.keyboard.press('Backspace');await pf.input.type(prefix,{delay:30});}
    await nf.input.click({clickCount:3});await page.keyboard.press('Backspace');await nf.input.type(nf.meta.max===8?serial:(pf?serial:digits),{delay:30});
    for(const b of await frame.$$('button,input[type="submit"],input[type="button"],[role="button"]'))try{const m=await b.evaluate(el=>({text:String(el.innerText||el.value||el.getAttribute('aria-label')||'').trim(),disabled:el.disabled}));if(!m.disabled&&/search|track|sorgula/i.test(m.text)){await b.click({delay:50});return true}}catch{}
    await page.keyboard.press('Enter');return true;
  }
  return false;
}

export async function trackTurkish(input){
  const mawb=normalizeMawb(input); if(!mawb||!mawb.startsWith('235-'))return{ok:false,reason:'INVALID TURKISH MAWB',airline:AIRLINE};
  let browser; const network=[]; const debug={prefix:'235',airline:'Turkish Cargo',url:URL,stage:'OPEN'};
  try{
    const mod=await import('puppeteer-core');const puppeteer=mod.default||mod;const launch=await browserConfig();
    browser=await puppeteer.launch({...launch,headless:true,defaultViewport:{width:1440,height:1000}});const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36');await page.setExtraHTTPHeaders({'Accept-Language':'en-US,en;q=0.9'});
    page.on('response',async res=>{try{const u=res.url(),ct=res.headers()['content-type']||'';if(!/cargo|track|awb|shipment|api|search/i.test(u)&&!/json|text/i.test(ct))return;const body=await res.text();if(body&&body.length<1500000){network.push({url:u,status:res.status(),body});if(network.length>40)network.shift();}}catch{}});
    await page.goto(URL,{waitUntil:'domcontentloaded',timeout:30000});await sleep(1700);
    const before=await pageText(page);if(/captcha|verify you are human|access denied|cloudflare|security check/i.test(before))return{ok:false,reason:'OFFICIAL SITE BLOCKED AUTOMATION',airline:AIRLINE,debug:{...debug,stage:'BLOCKED'}};
    if(!await fill(page,mawb))return{ok:false,reason:'TURKISH TRACKING FORM NOT FOUND',airline:AIRLINE,debug:{...debug,stage:'FORM_NOT_FOUND'}};
    for(let i=0;i<16;i++){
      await sleep(i?700:1000);
      for(let n=network.length-1;n>=0;n--){const p=parseStructured(network[n].body,mawb);if(p?.notFound)return{ok:false,notFound:true,reason:'NO SHIPMENT RECORD',airline:AIRLINE,debug:{...debug,stage:'NO_RECORD',source:'network'}};if(p?.useful)return{ok:true,airline:AIRLINE,shipment:p.shipment,debug:{...debug,stage:'SUCCESS',source:'network',networkUrl:network[n].url}};}
      const p=parsePage(await pageText(page),mawb);if(p?.notFound)return{ok:false,notFound:true,reason:'NO SHIPMENT RECORD',airline:AIRLINE,debug:{...debug,stage:'NO_RECORD',source:'page'}};if(p?.useful)return{ok:true,airline:AIRLINE,shipment:p.shipment,debug:{...debug,stage:'SUCCESS',source:'page'}};
    }
    return{ok:false,reason:'TURKISH RESULT NOT MACHINE READABLE',airline:AIRLINE,debug:{...debug,stage:'UNREADABLE',networkUrls:network.slice(-8).map(x=>x.url),preview:clean(await pageText(page)).slice(0,500)}};
  }catch(e){return{ok:false,reason:e?.message||'TURKISH TRACKING FAILED',airline:AIRLINE,debug:{...debug,stage:'BROWSER_ERROR'}}}
  finally{if(browser)try{await browser.close()}catch{}}
}
