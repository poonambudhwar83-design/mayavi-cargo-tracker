import fs from 'node:fs';
import { normalizeMawb } from '../airlines.js';

const URL = 'https://www.qrcargo.com/s/track-your-shipment';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clean = v => String(v || '').replace(/\s+/g, ' ').trim();
const airline = { name:'Qatar Airways Cargo', iata:'QR', url:URL };

async function browserConfig(){
  for(const executablePath of [process.env.CHROME_EXECUTABLE_PATH,'/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome','/usr/bin/google-chrome-stable'].filter(Boolean)){
    if(fs.existsSync(executablePath)) return { executablePath, args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote'] };
  }
  const mod=await import('@sparticuz/chromium'); const chromium=mod.default||mod;
  return { executablePath:await chromium.executablePath(), args:chromium.args };
}

function monthNum(x=''){return({jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'})[x.slice(0,3).toLowerCase()]||'';}
function dt(raw=''){
  const s=clean(raw); let m=s.match(/\b(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})/);
  if(m)return{date:`${m[1]}-${m[2]}-${m[3]}`,time:`${String(m[4]).padStart(2,'0')}:${m[5]}`};
  m=s.match(/\b(\d{1,2})[-\s/]([A-Za-z]{3,9})[-\s/,](\d{2,4})\s+(\d{1,2}):(\d{2})(?:\s*(AM|PM))?/i);
  if(!m)return{date:'',time:''}; let y=String(m[3]); if(y.length===2)y=`20${y}`; const mo=monthNum(m[2]); if(!mo)return{date:'',time:''};
  let h=Number(m[4]),ap=(m[6]||'').toUpperCase(); if(ap==='PM'&&h<12)h+=12; if(ap==='AM'&&h===12)h=0;
  return{date:`${y}-${mo}-${String(m[1]).padStart(2,'0')}`,time:`${String(h).padStart(2,'0')}:${m[5]}`};
}
function status(t=''){
  if(/notified consignee/i.test(t))return'NOTIFIED CONSIGNEE'; if(/received at destination|\bRCF\b/i.test(t))return'RECEIVED AT DESTINATION';
  if(/\bdelivered\b|\bDLV\b/i.test(t))return'DELIVERED'; if(/\barrived\b|\blanded\b|actual arrival|\bARR\b/i.test(t))return'ARRIVED';
  if(/\bdelayed\b|\blate\b|exception/i.test(t))return'DELAYED'; if(/\bdeparted\b|\bDEP\b|in[ -]?transit|airborne|in flight/i.test(t))return'IN TRANSIT';
  if(/\bbooked\b|\bRCS\b|manifested|received from shipper/i.test(t))return'BOOKED'; return'TRACKING';
}

function safeJson(raw=''){
  let text=String(raw||'').trim();
  text=text.replace(/^while\s*\(\s*1\s*\)\s*;?\s*/i,'').replace(/^for\s*\(\s*;;\s*\)\s*;?\s*/i,'');
  try{return JSON.parse(text)}catch{return null}
}
function flatten(value,path='$',out=[],depth=0){
  if(depth>14||value===undefined||value===null)return out;
  if(typeof value==='string'){
    out.push({path,value});
    const s=value.trim();
    if((s.startsWith('{')&&s.endsWith('}'))||(s.startsWith('[')&&s.endsWith(']'))){const nested=safeJson(s);if(nested)flatten(nested,`${path}.json`,out,depth+1)}
    return out;
  }
  if(typeof value==='number'||typeof value==='boolean'){out.push({path,value:String(value)});return out;}
  if(Array.isArray(value)){value.forEach((v,i)=>flatten(v,`${path}[${i}]`,out,depth+1));return out;}
  if(typeof value==='object'){Object.entries(value).forEach(([k,v])=>flatten(v,`${path}.${k}`,out,depth+1));}
  return out;
}
function entryValue(entries,pathRx,valueRx=null){
  for(const e of entries){if(pathRx.test(e.path)&&(!valueRx||valueRx.test(String(e.value))))return String(e.value)}
  return '';
}
function airportCode(v=''){const m=String(v).toUpperCase().match(/\b([A-Z]{3})\b/);return m?m[1]:'';}
function numeric(v=''){const m=String(v).match(/[\d,.]+/);return m?m[0].replace(/,/g,''):'';}
function flight(v=''){const s=clean(v).toUpperCase();const m=s.match(/\bQR[-\s]?(\d{2,4})\b/)||s.match(/\b(\d{2,4})\b/);return m?`QR${m[1]}`:'';}

function parseStructuredBody(raw,mawb){
  const json=safeJson(raw); if(!json)return null;
  const entries=flatten(json); if(!entries.length)return null;
  const joined=clean(entries.map(e=>`${e.path} ${e.value}`).join(' '));
  if(/no (?:shipment|record|result)|not found|invalid (?:awb|mawb|air waybill)|unable to find|no data/i.test(joined))return{notFound:true};

  const origin=airportCode(entryValue(entries,/(?:origin|fromStation|fromAirport|departure.*(?:station|airport|code))/i,/\b[A-Z]{3}\b/i));
  const destination=airportCode(entryValue(entries,/(?:destination|toStation|toAirport|arrival.*(?:station|airport|code))/i,/\b[A-Z]{3}\b/i));
  const pieces=numeric(entryValue(entries,/(?:piece|pieces|pieceCount|totalPieces|pcs|bag)/i,/\d/));
  const weight=numeric(entryValue(entries,/(?:grossWeight|chargeableWeight|weight)/i,/\d/));
  const flightNo=flight(entryValue(entries,/(?:flightNo|flightNumber|flight)/i,/\d/)) || flight(joined);

  let actualRaw=entryValue(entries,/(?:actual.*arriv|arriv.*actual|ata|actualArrivalDateTime)/i,/\d/);
  let estimatedRaw=entryValue(entries,/(?:estimated.*arriv|expected.*arriv|scheduled.*arriv|eta|estimatedArrivalDateTime)/i,/\d/);
  let arrival=dt(actualRaw); const actual=Boolean(arrival.date);
  if(!arrival.date)arrival=dt(estimatedRaw);

  const st=status(joined);
  const digits=mawb.replace(/\D/g,''),serial=digits.slice(3);
  const seen=joined.includes(mawb)||joined.includes(digits)||joined.includes(serial);
  const useful=Boolean(origin||destination||pieces||weight||flightNo||arrival.date||st!=='TRACKING');
  if(!useful)return null;

  return{useful:true,seen,shipment:{mawb,carrierCode:'QR',airlineName:airline.name,origin,destination,bags:pieces,pieces,weight,flightNo,arrivalDate:arrival.date,arrivalTime:arrival.time,arrivalIsActual:actual,status:st,officialTracker:URL,source:'Qatar Airways Cargo official network response'}};
}

function parseText(raw,mawb,trusted=false){
  const t=clean(raw),digits=mawb.replace(/\D/g,''),serial=digits.slice(3);
  if(/no (?:shipment|record|result)|not found|invalid (?:awb|mawb|air waybill)|unable to find|no data/i.test(t))return{notFound:true};
  const seen=t.includes(mawb)||t.includes(digits)||t.includes(serial); const route=t.match(/\b([A-Z]{3})\s*(?:-|–|—|→|>)\s*([A-Z]{3})\b/);
  const origin=((t.match(/(?:origin(?:Airport|Station|Code)?|from|departure(?: airport)?)['"\s:_-]{0,20}['"]?([A-Z]{3})\b/i)||[])[1]||route?.[1]||'').toUpperCase();
  const destination=((t.match(/(?:destination(?:Airport|Station|Code)?|to|arrival(?: airport| station)?)['"\s:_-]{0,20}['"]?([A-Z]{3})\b/i)||[])[1]||route?.[2]||'').toUpperCase();
  const pieces=(t.match(/(?:pieces?|pcs?|bags?|pieceCount|totalPieces)['"\s:#_-]{0,20}['"]?(\d{1,6})\b/i)||t.match(/\b(\d{1,6})\s*(?:pieces?|pcs?|bags?)\b/i)||[])[1]||'';
  const weight=((t.match(/(?:gross\s*weight|weight|grossWeight)['"\s:#_-]{0,20}['"]?([\d,.]+)\s*(?:kg|kgs|kilograms?)?/i)||t.match(/([\d,.]+)\s*(?:kg|kgs|kilograms?)\b/i)||[])[1]||'').replace(/,/g,'');
  const flights=[...t.matchAll(/\bQR[-\s]?(\d{2,4})\b/ig)]; const flightNo=flights.length?`QR${flights.at(-1)[1]}`:'';
  let a=dt((t.match(/(?:actualArrival|actual arrival|arrived(?: at)?|landed(?: at)?|\bARR\b)['"\s:_-]{0,30}[\s\S]{0,180}/i)||[])[0]||''); const actual=Boolean(a.date);
  if(!a.date)a=dt((t.match(/(?:estimatedArrival|expectedArrival|estimated arrival|expected arrival|\bETA\b|scheduled arrival)['"\s:_-]{0,30}[\s\S]{0,200}/i)||[])[0]||'');
  const st=status(t); const details=Boolean(origin||destination||pieces||weight||flightNo||a.date||st!=='TRACKING');
  const useful=Boolean(details&&(trusted||seen));
  return{useful,shipment:{mawb,carrierCode:'QR',airlineName:airline.name,origin,destination,bags:pieces,pieces,weight,flightNo,arrivalDate:a.date,arrivalTime:a.time,arrivalIsActual:actual,status:st,officialTracker:URL,source:'Qatar Airways Cargo official website'}};
}

function parseNetwork(network,mawb){
  for(let i=network.length-1;i>=0;i-=1){
    const item=network[i];
    const structured=parseStructuredBody(item.body,mawb);
    if(structured?.notFound)return structured;
    if(structured?.useful)return structured;
    const text=parseText(item.body,mawb,true);
    if(text.notFound)return text;
    if(text.useful)return text;
  }
  return null;
}

async function deepText(page){
  return page.evaluate(()=>{const p=[];const walk=r=>{if(!r?.querySelectorAll)return;if(r instanceof ShadowRoot&&r.textContent?.trim())p.push(r.textContent);for(const e of r.querySelectorAll('*'))if(e.shadowRoot)walk(e.shadowRoot)};if(document.body?.innerText)p.push(document.body.innerText);walk(document);return p.join('\n')});
}
async function deepEls(page,sel){
  const h=await page.evaluateHandle(s=>{const out=[],seen=new Set();const walk=r=>{if(!r?.querySelectorAll)return;for(const e of r.querySelectorAll(s))if(!seen.has(e)){seen.add(e);out.push(e)}for(const e of r.querySelectorAll('*'))if(e.shadowRoot)walk(e.shadowRoot)};walk(document);return out},sel);
  const props=await h.getProperties(),out=[]; for(const p of props.values()){const e=p.asElement();if(e)out.push(e)} await h.dispose(); return out;
}
async function typeValue(page,el,value){await el.click({clickCount:3});await page.keyboard.press('Backspace');await el.type(value,{delay:55});return el.evaluate(x=>String(x.value||''));}
async function submit(page,mawb){
  const digits=mawb.replace(/\D/g,''),prefix=digits.slice(0,3),serial=digits.slice(3); let inputs=await deepEls(page,'input[type="text"],input:not([type])');
  const visible=[]; for(const el of inputs){try{const m=await el.evaluate(x=>{const r=x.getBoundingClientRect();return{v:r.width>3&&r.height>3&&!x.disabled&&!x.readOnly,max:Number(x.maxLength||-1),val:String(x.value||''),ph:`${x.placeholder||''} ${x.name||''} ${x.id||''} ${x.getAttribute('aria-label')||''}`}});if(m.v)visible.push({el,m})}catch{}}
  let p=visible.find(x=>x.m.max===3||x.m.val==='157'||/prefix/i.test(x.m.ph));
  let n=visible.find(x=>x!==p&&(x.m.max===8||/awb|air waybill|shipment|number/i.test(x.m.ph))) || (p ? visible.find(x=>x!==p) : null);
  if(p&&p.m.val!==prefix){if(await typeValue(page,p.el,prefix)!==prefix)return{ok:false,reason:'QATAR_PREFIX_NOT_ACCEPTED'}}
  if(!n&&visible.length===1){p=visible[0];if(await typeValue(page,p.el,prefix)!==prefix)return{ok:false,reason:'QATAR_PREFIX_NOT_ACCEPTED'};await page.keyboard.press('Tab');await sleep(900);return submit(page,mawb)}
  if(!n)return{ok:false,reason:'QATAR_NUMBER_INPUT_NOT_FOUND',inputCount:visible.length};
  const serialValue=await typeValue(page,n.el,serial);
  let tokenized=false;
  if(serialValue!==serial){await sleep(250);const rendered=clean(await deepText(page));tokenized=rendered.includes(serial);if(!tokenized)return{ok:false,reason:'QATAR_NUMBER_NOT_ACCEPTED',enteredValue:serialValue};}
  const buttons=await deepEls(page,'button,input[type="submit"],[role="button"]');
  for(const b of buttons){try{const m=await b.evaluate(x=>{const r=x.getBoundingClientRect();return{v:r.width>3&&r.height>3&&!x.disabled,t:String(x.innerText||x.value||x.getAttribute('aria-label')||'').replace(/\s+/g,' ').trim()}});if(m.v&&/track shipment|track|search/i.test(m.t)){await b.click({delay:70});return{ok:true,button:m.t,tokenized}}}catch{}}
  await page.keyboard.press('Enter'); return{ok:true,button:'ENTER',tokenized};
}

export async function trackQatarLive(input){
  const mawb=normalizeMawb(input); if(!/^157-\d{8}$/.test(mawb))return{ok:false,technical:false,reason:'INVALID QATAR MAWB',airline,debug:{stage:'QATAR_INVALID_MAWB'}};
  let browser; const debug={stage:'QATAR_OPEN',officialUrl:URL};
  try{
    const mod=await import('puppeteer-core'),puppeteer=mod.default||mod,config=await browserConfig(); debug.browser=config.executablePath;
    browser=await puppeteer.launch({...config,headless:true,defaultViewport:{width:1440,height:1050}}); const page=await browser.newPage();
    const network=[]; let capture=false;
    page.on('response',async r=>{if(!capture)return;try{
      const u=r.url(),ct=String(r.headers()['content-type']||'');
      if(!/(qrcargo|aura|apex|track|shipment|cargo|croamis|api)/i.test(u)&&!/json/i.test(ct))return;
      const body=await r.text();
      if(body&&body.length<300000&&/(shipment|awb|origin|destination|arrival|pieces|weight|milestone|event|RCF|DLV|DEP|157)/i.test(body))network.push({url:u,body});
    }catch{}});
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36'); await page.setExtraHTTPHeaders({'Accept-Language':'en-US,en;q=0.9'});
    await page.goto(URL,{waitUntil:'domcontentloaded',timeout:30000}); await sleep(3200);
    debug.stage='QATAR_SUBMIT'; capture=true; const s=await submit(page,mawb); debug.submit=s; if(!s.ok)return{ok:false,technical:true,reason:s.reason,airline,debug:{...debug,stage:'QATAR_FORM_FAILED'}};
    debug.stage='QATAR_WAIT_RESULT';
    for(let i=0;i<18;i+=1){
      await sleep(i===0?1400:800);
      const n=parseNetwork(network,mawb);
      if(n?.notFound)return{ok:false,notFound:true,technical:false,reason:'Qatar Airways Cargo returned no shipment record.',airline,debug:{...debug,stage:'QATAR_NO_RECORD',networkResponses:network.length}};
      if(n?.useful)return{ok:true,airline,shipment:n.shipment,debug:{...debug,stage:'QATAR_SUCCESS_NETWORK',networkResponses:network.length}};
      const pageResult=parseText(await deepText(page),mawb,false);
      if(pageResult.notFound)return{ok:false,notFound:true,technical:false,reason:'Qatar Airways Cargo returned no shipment record.',airline,debug:{...debug,stage:'QATAR_NO_RECORD_PAGE',networkResponses:network.length}};
      if(pageResult.useful)return{ok:true,airline,shipment:pageResult.shipment,debug:{...debug,stage:'QATAR_SUCCESS_PAGE',networkResponses:network.length}};
    }
    const preview=clean(await deepText(page)).slice(0,700);
    return{ok:false,technical:true,reason:'Qatar accepted the MAWB but Mayavi could not parse the returned shipment data.',airline,debug:{...debug,stage:'QATAR_RESULT_UNREADABLE',networkResponses:network.length,networkUrls:[...new Set(network.map(x=>{try{return new URL(x.url).pathname}catch{return x.url}}))].slice(0,8),resultPreview:preview}};
  }catch(e){return{ok:false,technical:true,reason:e?.message||'Qatar official tracker failed.',airline,debug:{...debug,stage:'QATAR_BROWSER_ERROR'}}}finally{if(browser)try{await browser.close()}catch{}}
}
