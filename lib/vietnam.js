import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { normalizeMawb } from './airlines.js';

const TRACK_URL='https://track.champ.aero/vn';
const MONTH={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
const pad=v=>String(v).padStart(2,'0');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clean=v=>String(v||'').replace(/\s+/g,' ').trim();

function parseDate(value=''){
  const s=String(value||'').trim().toUpperCase();
  let m=s.match(/\b(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})\b/);if(m)return`${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m=s.match(/\b(\d{1,2})[-\/.](\d{1,2})[-\/.](20\d{2})\b/);if(m)return`${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  m=s.match(/\b(\d{1,2})[\s\-]+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s\-,]+(20\d{2})\b/);if(m)return`${m[3]}-${MONTH[m[2]]}-${pad(m[1])}`;
  m=s.match(/\b(\d{1,2})-(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)-(\d{2})\b/);if(m)return`20${m[3]}-${MONTH[m[2]]}-${pad(m[1])}`;
  return'';
}
function parseFlightDate(value=''){
  const m=String(value||'').toUpperCase().match(/\b(\d{2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{2})\b/);
  return m?`20${m[3]}-${MONTH[m[2]]}-${m[1]}`:'';
}
function parseTime(value=''){
  const s=String(value||'').trim().toUpperCase();
  const twelve=[...s.matchAll(/\b(1[0-2]|0?\d):([0-5]\d)\s*(AM|PM)\b/g)];
  if(twelve.length){const m=twelve.at(-1);let h=Number(m[1]);if(m[3]==='PM'&&h<12)h+=12;if(m[3]==='AM'&&h===12)h=0;return`${pad(h)}:${m[2]}`;}
  const matches=[...s.matchAll(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g)];if(!matches.length)return'';const m=matches.at(-1);return`${pad(m[1])}:${m[2]}`;
}
function eventMs(e={}){const t=Date.parse(`${e.date||''}T${e.time||'00:00'}:00Z`);return Number.isFinite(t)?t:0;}
function routeFromText(text=''){
  const direct=String(text).match(/\b([A-Z]{3})\s*-\s*([A-Z]{3})\b/);
  if(direct)return{origin:direct[1],destination:direct[2]};
  const stations=[...String(text).matchAll(/\b([A-Z]{3})\s*-\s*[A-Za-z][A-Za-z .'-]+(?:\([A-Z]{2}\))?/g)].map(m=>m[1]).filter((v,i,a)=>a.indexOf(v)===i);
  return{origin:stations[0]||'',destination:stations[1]||''};
}
function parseEvents(text=''){
  const source=String(text||'').replace(/\r/g,'');
  const events=[];
  const labels='Booked|Booking On Hold|Received from shipper|Pre-manifested on flight|Manifested on flight|Departed|Flight departed|Arrived|Flight arrived|Received from flight|Consignee\\/?Agent notified of arrival|Delivered';
  const broad=new RegExp(`(${labels})\\s+(\\d{1,2}\\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[A-Za-z]*\\s+20\\d{2})\\s*-\\s*(\\d{1,2}:\\d{2})([\\s\\S]{0,220}?)(?=(?:${labels})\\s+\\d{1,2}\\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[A-Za-z]*\\s+20\\d{2}\\s*-|$)`,'gi');
  for(const m of source.matchAll(broad)){
    const tail=clean(m[4]);
    const qty=tail.match(/\b(\d{1,6})\s+pieces?\s+([\d,.]+)\s*Kg\b/i);
    const flight=tail.match(/\b(VN\s?\d{2,4})\s+(\d{2}[A-Z]{3}\d{2})\b/i);
    events.push({label:clean(m[1]),date:parseDate(m[2]),time:parseTime(m[3]),pieces:qty?qty[1]:'',weight:qty?qty[2].replace(/,/g,''):'',flightNo:flight?flight[1].replace(/\s+/g,'').toUpperCase():'',flightDate:flight?parseFlightDate(flight[2]):'',row:clean(`${m[1]} ${m[2]} - ${m[3]} ${tail}`)});
  }
  const lines=source.split(/\n+/).map(clean).filter(Boolean);
  for(let i=0;i<lines.length;i++){
    const label=lines[i].match(new RegExp(`^(${labels})$`,'i'))?.[1];if(!label)continue;
    const joined=clean(`${lines[i]} ${lines[i+1]||''} ${lines[i+2]||''}`);
    const dt=joined.match(/\b(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[A-Za-z]*\s+20\d{2})\s*-\s*(\d{1,2}:\d{2})\b/i);if(!dt)continue;
    const qty=joined.match(/\b(\d{1,6})\s+pieces?\s+([\d,.]+)\s*Kg\b/i);
    const flight=joined.match(/\b(VN\s?\d{2,4})\s+(\d{2}[A-Z]{3}\d{2})\b/i);
    const e={label:clean(label),date:parseDate(dt[1]),time:parseTime(dt[2]),pieces:qty?qty[1]:'',weight:qty?qty[2].replace(/,/g,''):'',flightNo:flight?flight[1].replace(/\s+/g,'').toUpperCase():'',flightDate:flight?parseFlightDate(flight[2]):'',row:joined};
    if(!events.some(x=>x.label.toLowerCase()===e.label.toLowerCase()&&x.date===e.date&&x.time===e.time&&x.flightNo===e.flightNo))events.push(e);
  }
  return events.sort((a,b)=>eventMs(a)-eventMs(b));
}
function statusFromLatest(label=''){
  if(/delivered/i.test(label))return'DELIVERED';
  if(/notified.*arrival|received from flight|flight arrived|^arrived$/i.test(label))return'ARRIVED';
  if(/depart/i.test(label))return'IN TRANSIT';
  if(/manifest/i.test(label))return'MANIFESTED';
  if(/received from shipper/i.test(label))return'RECEIVED';
  if(/booking on hold/i.test(label))return'BOOKING ON HOLD';
  if(/^booked$/i.test(label))return'BOOKED';
  return'TRACKING';
}
function buildShipment(text,mawb){
  const flat=clean(text),route=routeFromText(text),events=parseEvents(text),serial=mawb.slice(4);
  if(/AWB number\(s\).*not found|no record|not found/i.test(flat)&&!flat.includes(serial))return{notFound:true,events,route};
  const booked=events.filter(e=>/^Booked$/i.test(e.label));
  const latest=events.at(-1)||{};
  const latestQty=[...events].reverse().find(e=>e.pieces||e.weight)||{};
  const currentFlight=[...events].reverse().find(e=>/Manifested on flight/i.test(e.label)&&e.flightNo)||[...events].reverse().find(e=>/Pre-manifested on flight/i.test(e.label)&&e.flightNo)||[...events].reverse().find(e=>e.flightNo)||{};
  const actual=[...events].reverse().find(e=>/Consignee\/?Agent notified of arrival|Received from flight|Flight arrived|^Arrived$/i.test(e.label))||null;
  const departed=[...events].reverse().find(e=>/Flight departed|^Departed$/i.test(e.label))||null;
  const shipment={mawb,carrierCode:'VN',airlineName:'Vietnam Airlines Cargo',officialTracker:TRACK_URL,origin:route.origin,destination:route.destination,bags:latestQty.pieces||'',pieces:latestQty.pieces||'',weight:latestQty.weight||'',flightNo:currentFlight.flightNo||departed?.flightNo||'',flightDate:currentFlight.flightDate||departed?.flightDate||'',bookingDate:booked[0]?.date||'',departureDate:departed?.date||'',departureTime:departed?.time||'',departureFlightNo:departed?.flightNo||currentFlight.flightNo||'',departureOrigin:route.origin||'',departureDestination:route.destination||'',departureIsActual:Boolean(departed),departureTimeSource:departed?'Vietnam CHAMP final Departed event':'',arrivalDate:actual?.date||'',arrivalTime:actual?.time||'',arrivalIsActual:Boolean(actual),actualArrival:actual?.date?`${actual.date}T${actual.time||'00:00'}:00`:null,eta:null,status:statusFromLatest(latest.label),source:'Vietnam Airlines CHAMP official Track & Trace'};
  return{shipment,events,route,useful:Boolean(events.length||route.origin||route.destination)};
}
async function launch(){chromium.setGraphicsMode=false;return puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox'],defaultViewport:{width:1440,height:1100,deviceScaleFactor:1},executablePath:await chromium.executablePath(),headless:'shell'});}
async function setValue(handle,value){await handle.evaluate((el,v)=>{const d=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');d?.set?.call(el,'');el.dispatchEvent(new Event('input',{bubbles:true}));d?.set?.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));el.dispatchEvent(new Event('blur',{bubbles:true}));},value);}
async function submit(page,prefix,serial){
  const inputs=await page.$$('input'),visible=[];
  for(const h of inputs){const meta=await h.evaluate(e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return{visible:s.display!=='none'&&s.visibility!=='hidden'&&r.width>20&&r.height>10&&!e.disabled,type:(e.type||'text').toLowerCase(),max:Number(e.maxLength||0),desc:`${e.name||''} ${e.id||''} ${e.placeholder||''} ${e.getAttribute('aria-label')||''}`.toLowerCase()};}).catch(()=>null);if(meta?.visible&&!['hidden','checkbox','radio','submit','button'].includes(meta.type))visible.push({h,meta});}
  const p=visible.find(x=>x.meta.max===3||/prefix|airline/.test(x.meta.desc));
  const a=visible.find(x=>x!==p&&(x.meta.max===8||/awb|waybill|number/.test(x.meta.desc)));
  if(p&&a){await setValue(p.h,prefix);await setValue(a.h,serial);}else if(visible.length>=2){await setValue(visible[0].h,prefix);await setValue(visible[1].h,serial);}else if(visible.length===1){await setValue(visible[0].h,`${prefix}${serial}`);}else return null;
  const clicked=await page.evaluate(()=>{const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>20&&r.height>10&&!e.disabled};const els=[...document.querySelectorAll('button,input[type="submit"],input[type="button"],a,[role="button"]')].filter(visible);const b=els.find(e=>/^track$/i.test((e.innerText||e.value||e.getAttribute('aria-label')||'').trim()))||els.find(e=>/track|search/i.test((e.innerText||e.value||'').trim()));if(!b)return'';const t=(b.innerText||b.value||'').trim();b.click();return t;}).catch(()=> '');
  return{prefixInput:Boolean(p),awbInput:Boolean(a),inputCount:visible.length,clicked};
}
async function revealDetails(page){await page.evaluate(()=>{const els=[...document.querySelectorAll('summary,button,a,[role="button"],div,span')];const d=els.find(e=>/^details$/i.test((e.innerText||'').trim()));if(d)d.click();}).catch(()=>{});await page.evaluate(async()=>{for(let y=0;y<document.body.scrollHeight;y+=650){window.scrollTo(0,y);await new Promise(r=>setTimeout(r,70));}window.scrollTo(0,document.body.scrollHeight);}).catch(()=>{});}
async function flightStatsArrival({flightNo='',flightDate='',origin='',destination=''}){
  const m=String(flightNo||'').toUpperCase().match(/^VN(\d{2,4})$/),d=String(flightDate||'').match(/^(20\d{2})-(\d{2})-(\d{2})$/);if(!m||!d||!origin||!destination)return null;
  const url=`https://www.flightstats.com/v2/flight-tracker/VN/${Number(m[1])}?year=${d[1]}&month=${Number(d[2])}&date=${Number(d[3])}`;
  try{
    const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36','accept':'text/html,application/xhtml+xml','accept-language':'en-US,en;q=0.9'},cache:'no-store',redirect:'follow',signal:AbortSignal.timeout(12000)});if(!r.ok)return null;
    const html=await r.text(),plain=html.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/\s+/g,' ').trim();
    const block=(plain.match(/Flight Arrival Times[\s\S]{0,800}/i)||plain.match(/Arrival Times[\s\S]{0,800}/i)||[])[0]||'';if(!block||!plain.includes(origin)||!plain.includes(destination))return null;
    const arrivalDate=parseDate(block),actual=parseTime((block.match(/Actual[\s\S]{0,100}?((?:1[0-2]|0?\d):[0-5]\d\s*(?:AM|PM)|(?:[01]?\d|2[0-3]):[0-5]\d)/i)||[])[1]||''),estimated=parseTime((block.match(/Estimated[\s\S]{0,100}?((?:1[0-2]|0?\d):[0-5]\d\s*(?:AM|PM)|(?:[01]?\d|2[0-3]):[0-5]\d)/i)||[])[1]||''),scheduled=parseTime((block.match(/Scheduled[\s\S]{0,100}?((?:1[0-2]|0?\d):[0-5]\d\s*(?:AM|PM)|(?:[01]?\d|2[0-3]):[0-5]\d)/i)||[])[1]||'');
    const arrivalTime=actual||estimated||scheduled;if(!arrivalDate||!arrivalTime)return null;
    return{arrivalDate,arrivalTime,arrivalIsActual:Boolean(actual),eta:`${arrivalDate}T${arrivalTime}:00`,actualArrival:actual?`${arrivalDate}T${arrivalTime}:00`:null,source:actual?'FlightStats actual arrival':estimated?'FlightStats estimated arrival':'FlightStats scheduled arrival',url};
  }catch{return null;}
}
export async function trackVietnam(input){
  const mawb=normalizeMawb(input);if(!mawb||!mawb.startsWith('738-'))return{ok:false,reason:'INVALID VIETNAM AIRLINES MAWB',officialTracker:TRACK_URL};
  const prefix='738',serial=mawb.slice(4);let browser,lastDebug={};
  try{
    browser=await launch();const page=await browser.newPage();await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36');await page.setExtraHTTPHeaders({'Accept-Language':'en-US,en;q=0.9'});
    await page.goto(TRACK_URL,{waitUntil:'domcontentloaded',timeout:30000});await sleep(900);
    const submitted=await submit(page,prefix,serial);if(!submitted?.clicked)return{ok:false,reason:'VIETNAM CHAMP TRACK FORM COULD NOT BE SUBMITTED',officialTracker:TRACK_URL,debug:{stage:'FORM',submitted}};
    await Promise.race([page.waitForNetworkIdle({idleTime:700,timeout:10000}).catch(()=>{}),sleep(9000)]);await sleep(700);await revealDetails(page);await sleep(450);
    const text=await page.evaluate(()=>document.body?.innerText||''),built=buildShipment(text,mawb);lastDebug={stage:'CHAMP_RESULT',submitted,eventCount:built.events?.length||0,events:built.events?.slice(-12)||[],bodySample:text.slice(0,7000)};
    if(built.notFound)return{ok:false,reason:'VIETNAM CHAMP RETURNED NO SHIPMENT RECORD',officialTracker:TRACK_URL,debug:lastDebug};
    if(!built.useful)return{ok:false,reason:'VIETNAM CHAMP RESULT OPENED BUT NO VERIFIED FIELDS WERE READ',officialTracker:TRACK_URL,debug:lastDebug};
    let shipment=built.shipment,schedule=null;
    if(!shipment.arrivalDate&&shipment.flightNo&&shipment.flightDate&&shipment.origin&&shipment.destination){schedule=await flightStatsArrival({flightNo:shipment.flightNo,flightDate:shipment.flightDate,origin:shipment.origin,destination:shipment.destination});if(schedule){shipment={...shipment,arrivalDate:schedule.arrivalDate,arrivalTime:schedule.arrivalTime,arrivalIsActual:schedule.arrivalIsActual,eta:schedule.eta,actualArrival:schedule.actualArrival,arrivalTimeSource:schedule.source,source:`${shipment.source} + ${schedule.source}`};if(schedule.arrivalIsActual)shipment.status='ARRIVED';}}
    const screenshotBase64=await page.screenshot({type:'jpeg',quality:68,fullPage:false,encoding:'base64'}).catch(()=>null);
    return{ok:true,shipment,screenshotBase64,screenshotCaptured:Boolean(screenshotBase64),screenshotVerified:true,debug:{...lastDebug,schedule}};
  }catch(e){return{ok:false,reason:`VIETNAM CHAMP TRACKING ERROR: ${e?.message||e}`,officialTracker:TRACK_URL,debug:{...lastDebug,stage:'ERROR'}};}finally{try{if(browser)await browser.close()}catch{}}
}
