import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { normalizeMawb } from './airlines.js';

const SOURCES=[
  {name:'Track.Global',url:'https://track.global/en/courier/etihadcargo'},
  {name:'OrderTracker',url:'https://www.ordertracker.com/carriers/ethihad-cargo'},
  {name:'APEX Intelligence',url:'https://jar-vis.com/en/air'},
  {name:'CargoEnter',url:'https://cargoenter.com/tracking/etihad/'},
  {name:'TrackShipment',url:'https://trackshipment.net/'}
];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
const digits=s=>String(s||'').replace(/\D/g,'');
const pad=v=>String(v).padStart(2,'0');
function dt(text=''){
  const s=String(text);
  let m=s.match(/\b(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})[ T,]+(\d{1,2}):(\d{2})/);
  if(m)return{date:`${m[1]}-${pad(m[2])}-${pad(m[3])}`,time:`${pad(m[4])}:${m[5]}`};
  m=s.match(/\b(\d{1,2})[-\/.](\d{1,2})[-\/](20\d{2})[ T,]+(\d{1,2}):(\d{2})/);
  if(m)return{date:`${m[3]}-${pad(m[2])}-${pad(m[1])}`,time:`${pad(m[4])}:${m[5]}`};
  return{date:'',time:''};
}
function parse(text='',mawb='',source=''){
  const flat=clean(text),up=flat.toUpperCase(),serial=digits(mawb).slice(3);
  if(!flat||(!up.includes(serial)&&!up.includes(digits(mawb))))return null;
  const evidence=/\b(ARRIVED|DEPARTED|DELIVERED|IN TRANSIT|BOOKED|ACCEPTED|RCF|RCS|ETA|ETD|FLIGHT|ORIGIN|DESTINATION|WEIGHT|PIECES)\b/i.test(flat);
  if(!evidence)return null;
  let status='TRACKING';
  if(/\bDELIVERED\b/i.test(flat))status='DELIVERED';
  else if(/\bARRIVED\b|\bRCF\b|RECEIVED AT DESTINATION|LANDED/i.test(flat))status='ARRIVED';
  else if(/DELAY|EXCEPTION|OFFLOAD/i.test(flat))status='DELAYED';
  else if(/\bDEPARTED\b|IN TRANSIT|AIRBORNE|IN FLIGHT/i.test(flat))status='IN TRANSIT';
  else if(/\bBOOKED\b|\bRCS\b|ACCEPTED/i.test(flat))status='BOOKED';
  const route=flat.match(/\b([A-Z]{3})\s*(?:-|→|TO|>)\s*([A-Z]{3})\b/i);
  const flight=(flat.match(/\bEY\s*[- ]?(\d{2,4})\b/i)||[])[1]||'';
  const pieces=(flat.match(/(?:PIECES?|PCS|TOTAL PIECES)\s*[:#-]?\s*(\d{1,6})\b/i)||[])[1]||'';
  const weight=(flat.match(/(?:GROSS\s*WEIGHT|TOTAL\s*WEIGHT|\bWEIGHT\b)\s*[:#-]?\s*([\d,.]+)\s*(?:KG|KGS|KILOGRAM)/i)||[])[1]?.replace(/,/g,'')||'';
  const arrWin=(flat.match(/(?:ARRIVED|RCF|RECEIVED AT DESTINATION|ETA|ESTIMATED ARRIVAL)[\s\S]{0,220}/i)||[])[0]||'';
  const arrival=dt(arrWin);
  const useful=Boolean(route||flight||pieces||weight||arrival.date||status!=='TRACKING');
  if(!useful)return null;
  return {mawb,carrierCode:'EY',airlineName:'Etihad Cargo',origin:route?.[1]||'',destination:route?.[2]||'',pieces,bags:pieces,weight,flightNo:flight?`EY${flight}`:'',arrivalDate:arrival.date,arrivalTime:arrival.time,arrivalIsActual:/ARRIVED|RCF|RECEIVED AT DESTINATION/i.test(arrWin),status,officialTracker:'https://www.etihadcargo.com/en/e-services/shipment-tracking',source:`${source} public tracking fallback`};
}
async function probeApexApi(mawb){
  const variants=[mawb,digits(mawb)];
  for(const value of variants){
    const url=`https://jar-vis.com/v1/air/track/${encodeURIComponent(value)}`;
    try{
      const res=await fetch(url,{method:'GET',headers:{accept:'application/json,text/plain,*/*','user-agent':'Mozilla/5.0'},cache:'no-store',signal:AbortSignal.timeout(15000)});
      const text=await res.text();
      let json=null;try{json=JSON.parse(text);}catch{}
      if(res.ok){
        const candidate=parse(JSON.stringify(json||text),mawb,'APEX Intelligence API');
        if(candidate)return{ok:true,shipment:candidate,debug:{source:'APEX Intelligence API',url,status:res.status,preview:text.slice(0,1400)}};
      }
      if(res.status===401||res.status===403||res.status===402)return{ok:false,source:'APEX Intelligence API',reason:`APEX HTTP ${res.status}`,debug:{url,status:res.status,preview:text.slice(0,500)}};
    }catch(e){return{ok:false,source:'APEX Intelligence API',reason:e?.message||'APEX API PROBE FAILED'};}
  }
  return{ok:false,source:'APEX Intelligence API',reason:'NO VERIFIED SHIPMENT FIELDS'};
}
async function launch(){
  return puppeteer.launch({args:chromium.args,defaultViewport:{width:1440,height:1200},executablePath:await chromium.executablePath(),headless:chromium.headless});
}
async function probeSource(browser,source,mawb){
  const page=await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36');
  try{
    await page.goto(source.url,{waitUntil:'domcontentloaded',timeout:45000});
    await sleep(1500);
    const inputs=await page.$$('input');
    let input=null;
    for(const el of inputs){
      const meta=await el.evaluate(n=>({type:n.type,ph:n.placeholder||'',name:n.name||'',aria:n.getAttribute('aria-label')||''}));
      if(meta.type!=='hidden'&&/track|awb|waybill|number|shipment|parcel/i.test(`${meta.ph} ${meta.name} ${meta.aria}`)){input=el;break;}
    }
    if(!input)input=inputs.find(Boolean)||null;
    if(!input)return{ok:false,source:source.name,reason:'NO TRACKING INPUT'};
    await input.click({clickCount:3});
    await input.type(mawb,{delay:35});
    const buttons=await page.$$('button,input[type="submit"]');
    let clicked=false;
    for(const b of buttons){const label=clean(await b.evaluate(n=>n.innerText||n.value||n.getAttribute('aria-label')||''));if(/track|search|find/i.test(label)){await b.click();clicked=true;break;}}
    if(!clicked)await input.press('Enter');
    await sleep(5000);
    const body=clean(await page.evaluate(()=>document.body?.innerText||''));
    const current=page.url();
    const shipment=parse(body,mawb,source.name);
    if(shipment)return{ok:true,shipment,debug:{source:source.name,url:current,sample:body.slice(0,1800)}};
    return{ok:false,source:source.name,reason:'NO VERIFIED SHIPMENT FIELDS',debug:{url:current,sample:body.slice(0,1200)}};
  }catch(e){return{ok:false,source:source.name,reason:e?.message||'PROBE FAILED'};}finally{await page.close().catch(()=>{});}
}
export async function trackEtihadAlternate(input){
  const mawb=normalizeMawb(input);
  if(!mawb||!mawb.startsWith('607-'))return{ok:false,reason:'INVALID ETIHAD MAWB'};
  const attempts=[];
  const apex=await probeApexApi(mawb);attempts.push(apex);if(apex.ok)return{...apex,attempts};
  let browser;
  try{
    browser=await launch();
    for(const source of SOURCES){const r=await probeSource(browser,source,mawb);attempts.push(r);if(r.ok)return{...r,attempts};}
    return{ok:false,reason:'NO ALTERNATE PUBLIC SOURCE RETURNED VERIFIED ETIHAD DATA',attempts};
  }catch(e){return{ok:false,reason:e?.message||'ETIHAD ALTERNATE BROWSER FAILED',attempts};}finally{if(browser)await browser.close().catch(()=>{});}
}
