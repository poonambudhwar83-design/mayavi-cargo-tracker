import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const pad=v=>String(v).padStart(2,'0');

function displayDate(ymd=''){
  const m=String(ymd).match(/^(20\d{2})-(\d{2})-(\d{2})$/);if(!m)return'';
  return `${MONTHS[Number(m[2])-1]} ${Number(m[3])}`;
}
function normalizeTime(v=''){
  const s=String(v).trim().toUpperCase();
  let m=s.match(/\b(\d{1,2}):(\d{2})\s*([AP]M)\b/);
  if(m){let h=Number(m[1]);if(m[3]==='PM'&&h!==12)h+=12;if(m[3]==='AM'&&h===12)h=0;return `${pad(h)}:${m[2]}`;}
  m=s.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);return m?`${pad(m[1])}:${m[2]}`:'';
}
function escapeRx(s=''){return String(s).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}
const TIME_RX='(\\d{1,2}:\\d{2}(?:\\s*[AP]M)?)';

function parseTripText(text,{flightNo,origin,destination,date}){
  const flat=String(text||'').replace(/\s+/g,' ').trim();
  const label=displayDate(date);if(!label)return null;
  const depWindowRx=new RegExp(`${escapeRx(label)}[\\s\\S]{0,1100}?\\b${escapeRx(origin)}\\b[\\s\\S]{0,850}`,'i');
  let depWindow=(flat.match(depWindowRx)||[])[0]||'';
  if(depWindow&&destination){
    const withDestination=new RegExp(`\\b${escapeRx(destination)}\\b`,'i').test(depWindow);
    const withFlight=new RegExp(`\\b${escapeRx(flightNo)}\\b`,'i').test(depWindow);
    if(!withDestination&&!withFlight)depWindow='';
  }
  if(depWindow){
    const depMatch=depWindow.match(/(?:DEPARTED|DEPARTURE|ACTUAL DEPARTURE|SCHEDULED DEPARTURE)[\\s:–-]{0,30}(\\d{1,2}:\\d{2}(?:\\s*[AP]M)?)/i)
      ||depWindow.match(/(\\d{1,2}:\\d{2}(?:\\s*[AP]M)?)[\\s\\S]{0,45}?(?:DEPARTED|DEPARTURE)/i);
    const departureTime=normalizeTime(depMatch?.[1]||'');
    if(departureTime){
      const actuallyDeparted=/\\bDEPARTED\\b|ACTUAL DEPARTURE/i.test(depWindow);
      return{status:actuallyDeparted?'DEPARTED':'SCHEDULED',departureDate:date,departureTime,departureIsActual:actuallyDeparted,source:'Flight-status departure snapshot',debugPattern:'TARGET_DATE_DEPARTURE',debugSnippet:depWindow.slice(0,900)};
    }
  }
  const l=escapeRx(label),o=escapeRx(origin),d=escapeRx(destination),f=escapeRx(flightNo);
  const rowRx=new RegExp(`${l}[\\s\\S]{0,280}?\\b${o}\\b[\\s\\S]{0,220}?\\b${d}\\b([\\s\\S]{0,260}?)\\bARRIVED\\b`,'i');
  const row=flat.match(rowRx);
  if(row){
    const times=[...row[0].matchAll(/\b(\d{1,2}:\d{2}(?:\s*[AP]M)?)\b/gi)].map(m=>normalizeTime(m[1])).filter(Boolean);
    if(times.length>=2)return{status:'ARRIVED',arrivalDate:date,arrivalTime:times[times.length-1],arrivalIsActual:true,source:'Flight-status screenshot fallback',debugPattern:'HISTORY_ROW',debugSnippet:row[0].slice(0,900)};
  }
  const cardRx=new RegExp(`${l}[\\s\\S]{0,220}?\\bARRIVED\\b[\\s\\S]{0,520}?\\b${o}\\b[\\s\\S]{0,300}?\\b${d}\\b[\\s\\S]{0,120}?${TIME_RX}`,'i');
  const card=flat.match(cardRx);
  if(card){const arrivalTime=normalizeTime(card[1]);if(arrivalTime)return{status:'ARRIVED',arrivalDate:date,arrivalTime,arrivalIsActual:true,source:'Flight-status screenshot fallback',debugPattern:'DATED_ARRIVED_CARD',debugSnippet:card[0].slice(0,900)};}
  const upper=flat.toUpperCase(),target=label.toUpperCase(),starts=[];let p=upper.indexOf(target);
  while(p>=0){starts.push(p);p=upper.indexOf(target,p+target.length);if(starts.length>30)break;}
  const candidates=[];
  for(const i of starts){
    const c=flat.slice(Math.max(0,i-80),Math.min(flat.length,i+900));
    if(!/\bARRIVED\b|HAS ARRIVED|LANDED/i.test(c))continue;
    if(!new RegExp(`\\b${o}\\b`,'i').test(c)||!new RegExp(`\\b${d}\\b`,'i').test(c))continue;
    const beforeArrived=c.split(/\bARRIVED\b/i)[0]||'';
    const times=[...beforeArrived.matchAll(/\b(\d{1,2}:\d{2}(?:\s*[AP]M)?)\b/gi)].map(m=>normalizeTime(m[1])).filter(Boolean);
    if(times.length>=2)candidates.push({arrivalTime:times[times.length-1],score:(new RegExp(`\\b${f}\\b`,'i').test(c)?3:0)+6,snippet:c.slice(0,900)});
  }
  if(candidates.length){candidates.sort((a,b)=>b.score-a.score);return{status:'ARRIVED',arrivalDate:date,arrivalTime:candidates[0].arrivalTime,arrivalIsActual:true,source:'Flight-status screenshot fallback',debugPattern:'TARGET_DATE_HISTORY_SNIPPET',debugSnippet:candidates[0].snippet};}
  return null;
}

function cleanHtml(s=''){
  return String(s||'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/\s+/g,' ').trim();
}
async function flightStatsDepartureFallback({flightNo='',date=''}){
  const f=String(flightNo||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
  const fm=f.match(/^([A-Z]{2})(?:0*)(\d{1,4})$/),dm=String(date||'').match(/^(20\d{2})-(\d{2})-(\d{2})$/);
  if(!fm||!dm)return null;
  const airline=fm[1],number=Number(fm[2]);
  const url=`https://www.flightstats.com/v2/flight-tracker/${airline}/${number}?year=${dm[1]}&month=${Number(dm[2])}&date=${Number(dm[3])}`;
  try{
    const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36','accept':'text/html,application/xhtml+xml','accept-language':'en-US,en;q=0.9'},cache:'no-store',redirect:'follow',signal:AbortSignal.timeout(10000)});
    if(!r.ok)return null;
    const plain=cleanHtml(await r.text());
    const idx=plain.search(/Flight Departure Times/i);if(idx<0)return null;
    const block=plain.slice(idx,idx+1000);
    const statusIdx=plain.search(/Flight Status/i);
    const routeBlock=statusIdx>=0?plain.slice(statusIdx,statusIdx+420):plain.slice(Math.max(0,idx-650),idx);
    const routeCodes=[...routeBlock.matchAll(/\b([A-Z]{3})\b/g)].map(m=>m[1]).filter(x=>!['THE','AND','FOR'].includes(x));
    const departureOrigin=routeCodes[0]||'';
    const departureDestination=routeCodes[1]||'';
    const actual=normalizeTime((block.match(/Actual\s+(\d{1,2}:\d{2}(?:\s*[AP]M)?)/i)||[])[1]||'');
    const estimated=normalizeTime((block.match(/Estimated\s+(\d{1,2}:\d{2}(?:\s*[AP]M)?)/i)||[])[1]||'');
    const scheduled=normalizeTime((block.match(/Scheduled\s+(\d{1,2}:\d{2}(?:\s*[AP]M)?)/i)||[])[1]||'');
    const departureTime=actual||estimated||scheduled;if(!departureTime)return null;
    return{status:actual?'DEPARTED':'SCHEDULED',departureDate:date,departureTime,departureIsActual:Boolean(actual),departureOrigin,departureDestination,source:'FlightStats departure fallback',debugPattern:'FLIGHTSTATS_DEPARTURE',debugSnippet:block.slice(0,900),url};
  }catch{return null;}
}

async function flightInfoScheduleFallback({flightNo='',date=''}){
  const f=String(flightNo||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
  const dm=String(date||'').match(/^(20\d{2})-(\d{2})-(\d{2})$/);if(!f||!dm)return null;
  const month=MONTHS[Number(dm[2])-1],label=`${Number(dm[3])} ${month} ${dm[1]}`;
  const url=`https://www.flight.info/${f}`;
  try{
    const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36','accept':'text/html,application/xhtml+xml','accept-language':'en-US,en;q=0.9'},cache:'no-store',redirect:'follow',signal:AbortSignal.timeout(10000)});
    if(!r.ok)return null;
    const plain=cleanHtml(await r.text());
    const rx=new RegExp(`${escapeRx(label)}\\s+(\\d{1,2}:\\d{2})\\s+[^()]{0,90}\\(([A-Z]{3})\\)\\s+[^()]{0,90}\\(([A-Z]{3})\\)`,'i');
    const m=plain.match(rx);if(!m)return null;
    const departureTime=normalizeTime(m[1]);if(!departureTime)return null;
    return{status:'SCHEDULED',departureDate:date,departureTime,departureIsActual:false,departureOrigin:m[2].toUpperCase(),departureDestination:m[3].toUpperCase(),source:'Flight.info scheduled departure fallback',debugPattern:'FLIGHTINFO_SCHEDULE',debugSnippet:m[0].slice(0,500),url};
  }catch{return null;}
}

async function cxFlightStatsFallback({flightNo='',origin='',destination='',date=''}){
  const f=String(flightNo||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
  const fm=f.match(/^CX0*(\d{2,4})$/),dm=String(date||'').match(/^(20\d{2})-(\d{2})-(\d{2})$/);
  if(!fm||!dm||!origin||!destination)return null;
  const url=`https://www.flightstats.com/v2/flight-tracker/CX/${Number(fm[1])}?year=${dm[1]}&month=${Number(dm[2])}&date=${Number(dm[3])}`;
  try{
    const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36','accept':'text/html,application/xhtml+xml','accept-language':'en-US,en;q=0.9'},cache:'no-store',redirect:'follow',signal:AbortSignal.timeout(10000)});
    if(!r.ok)return null;
    const plain=cleanHtml(await r.text());
    const idx=plain.search(/Flight Arrival Times/i),block=idx>=0?plain.slice(idx,idx+1800):plain;
    const scheduled=normalizeTime((block.match(/Scheduled\s+(\d{1,2}:\d{2}(?:\s*[AP]M)?)/i)||[])[1]||'');
    const estimated=normalizeTime((block.match(/Estimated\s+(\d{1,2}:\d{2}(?:\s*[AP]M)?)/i)||[])[1]||'');
    const actual=normalizeTime((block.match(/Actual\s+(\d{1,2}:\d{2}(?:\s*[AP]M)?)/i)||[])[1]||'');
    const arrivalTime=actual||estimated||scheduled;if(!arrivalTime)return null;
    const arrived=Boolean(actual)||/\bArrived\b|\bLanded\b|Actual Arrival/i.test(plain);
    return{status:arrived?'ARRIVED':'IN TRANSIT',arrivalDate:date,arrivalTime,arrivalIsActual:Boolean(actual),source:'Cathay FlightStats ETA/history fallback',debugPattern:'CX_FLIGHTSTATS',debugSnippet:block.slice(0,900),url};
  }catch{return null;}
}

async function launch(){chromium.setGraphicsMode=false;return puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox'],defaultViewport:{width:1440,height:1200,deviceScaleFactor:1},executablePath:await chromium.executablePath(),headless:'shell'});}

export async function trackFlightStatusSnapshot({flightNo='',origin='',destination='',date=''}){
  if(!flightNo||!origin||!date)return{ok:false,reason:'MISSING FLIGHT STATUS INPUT'};
  const url=`https://in.trip.com/flights/status-${String(flightNo).toLowerCase()}/`;
  let browser,screenshotBase64=null,tripText='';
  try{
    browser=await launch();const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36');
    await page.goto(url,{waitUntil:'domcontentloaded',timeout:15000});
    await new Promise(r=>setTimeout(r,2500));
    tripText=await page.evaluate(()=>document.body?.innerText||'').catch(()=> '');
    const parsed=parseTripText(tripText,{flightNo,origin,destination,date});
    screenshotBase64=await page.screenshot({type:'jpeg',quality:58,fullPage:false,encoding:'base64'}).catch(()=>null);
    if(parsed)return{ok:true,...parsed,url,screenshotBase64,debug:{stage:'SUCCESS',targetDate:date,pattern:parsed.debugPattern||'',snippet:parsed.debugSnippet||''}};
  }catch(e){tripText=`${tripText} ${e?.message||e}`;}
  finally{try{if(browser)await browser.close()}catch{}}
  const departureFallback=await flightStatsDepartureFallback({flightNo,date});
  if(departureFallback)return{ok:true,...departureFallback,screenshotBase64,debug:{stage:'SUCCESS',targetDate:date,pattern:departureFallback.debugPattern,snippet:departureFallback.debugSnippet||''}};
  const scheduleFallback=await flightInfoScheduleFallback({flightNo,date});
  if(scheduleFallback)return{ok:true,...scheduleFallback,screenshotBase64,debug:{stage:'SUCCESS',targetDate:date,pattern:scheduleFallback.debugPattern,snippet:scheduleFallback.debugSnippet||''}};
  const cxFallback=await cxFlightStatsFallback({flightNo,origin,destination,date});
  if(cxFallback)return{ok:true,...cxFallback,screenshotBase64,debug:{stage:'SUCCESS',targetDate:date,pattern:cxFallback.debugPattern,snippet:cxFallback.debugSnippet||''}};
  return{ok:false,reason:'FLIGHT STATUS SOURCES HAD NO VERIFIED TARGET-DATE DATA',url,screenshotBase64,debug:{stage:'NO_TARGET_DATE',pageText:String(tripText).slice(0,5000)}};
}
