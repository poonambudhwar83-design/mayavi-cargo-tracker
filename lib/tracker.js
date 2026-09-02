import fs from 'node:fs';
import { airlineForMawb, normalizeMawb } from './airlines.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const clean = s => String(s || '').replace(/\s+/g,' ').trim();

const CONFIG = {
  '065': { prefixLabel:/prefix|airline code/i, numberLabel:/awb|shipment|air waybill/i, button:/track|search/i },
  '176': { prefixLabel:/prefix|airline code/i, numberLabel:/document no|awb|shipment/i, button:/track|search|submit/i },
  '160': { prefixLabel:/airline code|prefix/i, numberLabel:/air waybill|awb/i, button:/track|search/i },
  '057': { prefixLabel:/prefix|airline code/i, numberLabel:/awb|shipment|air waybill/i, button:/track|search/i },
  '098': { prefixLabel:/prefix|airline code/i, numberLabel:/awb|shipment|air waybill/i, button:/track|search/i },
  '157': { prefixLabel:/prefix|airline code/i, numberLabel:/awb|shipment|air waybill/i, button:/track|search/i }
};

async function browserConfig(prefix=''){
  const extra = prefix==='160' ? ['--disable-http2','--disable-quic'] : [];
  for (const p of [process.env.CHROME_EXECUTABLE_PATH,'/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome','/usr/bin/google-chrome-stable'].filter(Boolean)) {
    if (fs.existsSync(p)) return { executablePath:p, args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote',...extra] };
  }
  const mod = await import('@sparticuz/chromium'); const chromium = mod.default || mod;
  return { executablePath:await chromium.executablePath(), args:[...chromium.args,...extra] };
}

function statusFrom(text=''){
  if (/\bDLV\b|delivered/i.test(text)) return 'DELIVERED';
  if (/\bRCF\b|received at destination/i.test(text)) return 'RECEIVED AT DESTINATION';
  if (/\bARR\b|actual arrival|arrived|landed/i.test(text)) return 'ARRIVED';
  if (/delay|late|exception/i.test(text)) return 'DELAYED';
  if (/\bDEP\b|departed|in transit|airborne|in flight/i.test(text)) return 'IN TRANSIT';
  if (/\bRCS\b|booked|manifested|accepted|airline received/i.test(text)) return 'BOOKED';
  return 'TRACKING';
}
function parseDateTime(text=''){
  const s=clean(text);
  let m=s.match(/\b(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})/);
  if(m)return{date:`${m[1]}-${m[2]}-${m[3]}`,time:`${String(m[4]).padStart(2,'0')}:${m[5]}`};
  m=s.match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})\s+(\d{1,2}):(\d{2})/);
  if(m)return{date:`${m[3]}-${String(m[2]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`,time:`${String(m[4]).padStart(2,'0')}:${m[5]}`};
  const months={jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'};
  m=s.match(/\b(\d{1,2})[\s-]([A-Za-z]{3,9})[\s,-]+(\d{2,4})\s+(\d{1,2}):(\d{2})/);
  if(m){let y=String(m[3]);if(y.length===2)y='20'+y;const mo=months[m[2].slice(0,3).toLowerCase()];if(mo)return{date:`${y}-${mo}-${String(m[1]).padStart(2,'0')}`,time:`${String(m[4]).padStart(2,'0')}:${m[5]}`};}
  return{date:'',time:''};
}
function parseText(text,mawb,airline){
  const s=clean(text), digits=mawb.replace(/\D/g,''), serial=digits.slice(3);
  if (/no (shipment|record|result)|not found|invalid (awb|air waybill)|no data/i.test(s)) return {notFound:true};
  const seen=s.includes(mawb)||s.includes(digits)||s.includes(serial);
  const route=s.match(/\b([A-Z]{3})\s*(?:-|–|—|→|>)\s*([A-Z]{3})\b/);
  const origin=((s.match(/(?:origin|from|departure(?: airport| station)?)\s*[:\-]?\s*([A-Z]{3})\b/i)||[])[1]||route?.[1]||'').toUpperCase();
  const destination=((s.match(/(?:destination|to|arrival(?: airport| station)?)\s*[:\-]?\s*([A-Z]{3})\b/i)||[])[1]||route?.[2]||'').toUpperCase();
  const pieces=(s.match(/(?:pieces?|pcs?|bags?)\s*[:#-]?\s*(\d{1,6})\b/i)||s.match(/\b(\d{1,6})\s*(?:pieces?|pcs?|bags?)\b/i)||[])[1]||'';
  const weight=((s.match(/(?:gross\s*weight|weight)\s*[:#-]?\s*([\d,.]+)\s*(?:kg|kgs)?/i)||s.match(/([\d,.]+)\s*(?:kg|kgs)\b/i)||[])[1]||'').replace(/,/g,'');
  const fm=[...s.matchAll(new RegExp(`\\b${airline.iata}[-\\s]?(\\d{2,4})\\b`,'ig'))];
  const flightNo=fm.length?`${airline.iata}${fm.at(-1)[1]}`:'';
  let arrival=parseDateTime((s.match(/(?:actual arrival|arrived|landed|\bARR\b)[\s\S]{0,200}/i)||[])[0]||'');
  const arrivalIsActual=Boolean(arrival.date);
  if(!arrival.date)arrival=parseDateTime((s.match(/(?:estimated arrival|expected arrival|scheduled arrival|\bETA\b)[\s\S]{0,240}/i)||[])[0]||'');
  const status=statusFrom(s);
  const useful=Boolean(seen&&(origin||destination||pieces||weight||flightNo||arrival.date||status!=='TRACKING'));
  return {useful,shipment:{mawb,carrierCode:airline.iata,airlineName:airline.name,origin,destination,bags:pieces,pieces,weight,flightNo,arrivalDate:arrival.date,arrivalTime:arrival.time,arrivalIsActual,status,officialTracker:airline.url,source:`${airline.name} official website`}};
}
async function pageText(page){const chunks=[];for(const frame of page.frames()){try{const t=await frame.evaluate(()=>document.body?.innerText||'');if(t)chunks.push(t)}catch{}}return chunks.join('\n');}
async function fillAndSubmit(page,mawb,cfg){
  const digits=mawb.replace(/\D/g,''),prefix=digits.slice(0,3),serial=digits.slice(3);
  for(const frame of page.frames()){
    const inputs=await frame.$$('input:not([type="hidden"]),textarea'); const fields=[];
    for(const input of inputs){try{const meta=await input.evaluate(el=>{const r=el.getBoundingClientRect();return{visible:r.width>4&&r.height>4&&!el.disabled&&!el.readOnly,max:Number(el.maxLength||-1),label:`${el.placeholder||''} ${el.name||''} ${el.id||''} ${el.getAttribute('aria-label')||''} ${el.labels?.[0]?.innerText||''}`}});if(meta.visible)fields.push({input,meta})}catch{}}
    if(!fields.length)continue;
    const prefixField=fields.find(x=>x.meta.max===3||cfg.prefixLabel.test(x.meta.label));
    let numberField=fields.find(x=>x!==prefixField&&(x.meta.max===8||cfg.numberLabel.test(x.meta.label)));
    if(!numberField)numberField=fields.find(x=>[11,12,14].includes(x.meta.max));
    if(!numberField)continue;
    if(prefixField){await prefixField.input.click({clickCount:3});await page.keyboard.press('Backspace');await prefixField.input.type(prefix,{delay:20});}
    const value=numberField.meta.max===8?serial:(prefixField?serial:digits);
    await numberField.input.click({clickCount:3});await page.keyboard.press('Backspace');await numberField.input.type(value,{delay:20});
    const buttons=await frame.$$('button,input[type="submit"],input[type="button"],[role="button"]');
    for(const b of buttons){try{const m=await b.evaluate(el=>{const r=el.getBoundingClientRect();return{visible:r.width>4&&r.height>4&&!el.disabled,text:String(el.innerText||el.value||el.getAttribute('aria-label')||'').trim()}});if(m.visible&&cfg.button.test(m.text)){await b.click({delay:40});return true}}catch{}}
    await page.keyboard.press('Enter'); return true;
  }
  return false;
}

export async function trackMawb(input){
  const mawb=normalizeMawb(input); if(!mawb)return{ok:false,reason:'INVALID MAWB'};
  const airline=airlineForMawb(mawb); if(!airline)return{ok:false,reason:'AIRLINE PREFIX NOT CONFIGURED'};
  const prefix=mawb.slice(0,3), cfg=CONFIG[prefix]||{prefixLabel:/prefix|airline code/i,numberLabel:/awb|shipment|air waybill/i,button:/track|search|submit/i};
  let browser; const debug={prefix,airline:airline.name,url:airline.url,stage:'OPEN'};
  try{
    const mod=await import('puppeteer-core'); const puppeteer=mod.default||mod; const launch=await browserConfig(prefix);
    browser=await puppeteer.launch({...launch,headless:true,defaultViewport:{width:1440,height:1000}});
    const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36');
    await page.setExtraHTTPHeaders({'Accept-Language':'en-US,en;q=0.9','Upgrade-Insecure-Requests':'1'});
    const urls=prefix==='160' ? ['https://www.cathaycargo.com/en-us/home.html','https://www.cathaycargo.com/en-us/track-and-trace.html'] : [airline.url];
    let opened=false,lastError='';
    for(const url of urls){try{await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});debug.openedUrl=url;opened=true;break}catch(e){lastError=e?.message||String(e);debug.openError=lastError}}
    if(!opened)return{ok:false,reason:lastError||'OFFICIAL SITE OPEN FAILED',airline,debug:{...debug,stage:'BROWSER_ERROR'}};
    await sleep(1800);
    const before=await pageText(page); if(/captcha|verify you are human|access denied|cloudflare|security check/i.test(before))return{ok:false,reason:'OFFICIAL SITE BLOCKED AUTOMATION',airline,debug:{...debug,stage:'BLOCKED'}};
    const submitted=await fillAndSubmit(page,mawb,cfg); debug.submitted=submitted; if(!submitted)return{ok:false,reason:'OFFICIAL TRACKING FORM NOT FOUND',airline,debug:{...debug,stage:'FORM_NOT_FOUND'}};
    for(let i=0;i<16;i++){await sleep(i?750:1300);const text=await pageText(page);const parsed=parseText(text,mawb,airline);if(parsed.notFound)return{ok:false,notFound:true,reason:'NO SHIPMENT RECORD',airline,debug:{...debug,stage:'NO_RECORD'}};if(parsed.useful)return{ok:true,airline,shipment:parsed.shipment,debug:{...debug,stage:'SUCCESS'}};}
    return{ok:false,reason:'RESULT NOT MACHINE READABLE',airline,debug:{...debug,stage:'UNREADABLE',preview:clean(await pageText(page)).slice(0,700)}};
  }catch(error){return{ok:false,reason:error?.message||'TRACKING FAILED',airline,debug:{...debug,stage:'BROWSER_ERROR'}}}
  finally{if(browser)try{await browser.close()}catch{}}
}
