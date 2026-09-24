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
async function flightStatsDepartureFallback({flightNo='',date='',destination='',allowBrowser=true}){
  const f=String(flightNo||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
  const fm=f.match(/^([A-Z]{2})(?:0*)(\\d{1,4})$/),dm=String(date||'').match(/^(20\\d{2})-(\\d{2})-(\\d{2})$/);
  if(!fm||!dm)return null;
  const airline=fm[1],number=Number(fm[2]),wantedDestination=String(destination||'').toUpperCase();
  const targetLabel=`${pad(dm[3])}-${MONTHS[Number(dm[2])-1]}-${dm[1]}`;
  const url=`https://www.flightstats.com/v2/flight-tracker/${airline}/${number}?year=${dm[1]}&month=${Number(dm[2])}&date=${Number(dm[3])}`;
  const parsePlain=(raw='')=>{
    const plain=String(raw||'').replace(/\\s+/g,' ').trim();if(!plain)return null;
    const arrivalInfo=(()=>{
      const idx=plain.search(/Flight Arrival Times/i);if(idx<0)return{};
      const block=plain.slice(idx,idx+1200);
      const dm=block.match(/\b(\d{1,2})-([A-Z][a-z]{2})-(20\d{2})\b/i);
      const monthName=dm?dm[2].slice(0,3).toLowerCase():'';
      const monthIndex=MONTHS.findIndex(m=>m.toLowerCase()===monthName);
      const arrivalDate=dm&&monthIndex>=0?`${dm[3]}-${pad(monthIndex+1)}-${pad(dm[1])}`:'';
      const actual=normalizeTime((block.match(/Actual\s+(\d{1,2}:\d{2}(?:\s*[AP]M)?)/i)||[])[1]||'');
      const estimated=normalizeTime((block.match(/Estimated\s+(\d{1,2}:\d{2}(?:\s*[AP]M)?)/i)||[])[1]||'');
      const scheduled=normalizeTime((block.match(/Scheduled\s+(\d{1,2}:\d{2}(?:\s*[AP]M)?)/i)||[])[1]||'');
      const arrivalTime=actual||estimated||scheduled;
      if(!arrivalTime)return{};
      return{
        arrivalDate,
        arrivalTime,
        arrivalIsActual:Boolean(actual),
        arrivalEstimate:!actual,
        arrivalTimeZone:/\bIST\b/i.test(block)?'IST':'',
        arrivalTimeSource:actual?'FlightStats actual arrival':estimated?'FlightStats estimated arrival':'FlightStats scheduled arrival'
      };
    })();
    const idx=plain.search(/Flight Departure Times/i);
    const statusIdx=plain.search(/Flight Status/i);
    let departureOrigin='',departureDestination='';
    if(statusIdx>=0&&idx>statusIdx){
      const header=plain.slice(statusIdx,idx);
      const codes=[...header.matchAll(/\\b([A-Z]{3})\\b/g)].map(m=>m[1]).filter(x=>!['THE','AND','FOR','AIR'].includes(x));
      departureOrigin=codes[0]||'';departureDestination=codes[1]||'';
    }
    if(idx>=0){
      const block=plain.slice(idx,idx+1050);
      const shown=(block.match(/\\b(\\d{2}-[A-Z][a-z]{2}-20\\d{2})\\b/)||[])[1]||'';
      if(!shown||shown.toLowerCase()===targetLabel.toLowerCase()){
        const actual=normalizeTime((block.match(/Actual\\s+(\\d{1,2}:\\d{2}(?:\\s*[AP]M)?)/i)||[])[1]||'');
        const estimated=normalizeTime((block.match(/Estimated\\s+(\\d{1,2}:\\d{2}(?:\\s*[AP]M)?)/i)||[])[1]||'');
        const scheduled=normalizeTime((block.match(/Scheduled\\s+(\\d{1,2}:\\d{2}(?:\\s*[AP]M)?)/i)||[])[1]||'');
        const departureTime=actual||estimated||scheduled;
        if(departureTime&&(!wantedDestination||!departureDestination||departureDestination===wantedDestination)){
          return{status:actual?'DEPARTED':'SCHEDULED',departureDate:date,departureTime,departureIsActual:Boolean(actual),departureOrigin,departureDestination:departureDestination||wantedDestination,...arrivalInfo,source:'FlightStats departure fallback',debugPattern:'FLIGHTSTATS_DEPARTURE',debugSnippet:block.slice(0,900)};
        }
      }
    }
    const sectionRx=new RegExp(`Flights for [A-Za-z]+,\\\\s*${escapeRx(targetLabel)}([\\\\s\\\\S]{0,1200}?)(?=Flights for [A-Za-z]+,|$)`,'i');
    const section=(plain.match(sectionRx)||[])[1]||'';
    if(section){
      let row=null;
      if(wantedDestination){
        const destRx=new RegExp(`(\\\\d{1,2}:\\\\d{2})\\\\s+(?:[+-]\\\\d{2}\\\\s+)?([A-Z]{3})\\\\s+[A-Za-zÀ-ÿ .'-]{1,55}?\\\\s+${escapeRx(wantedDestination)}\\\\s+[A-Za-zÀ-ÿ .'-]{1,55}?\\\\s+(\\\\d{1,2}:\\\\d{2})`,'i');
        const m=section.match(destRx);if(m)row={departureTime:normalizeTime(m[1]),departureOrigin:m[2],departureDestination:wantedDestination,scheduledArrivalTime:normalizeTime(m[3]),snippet:m[0]};
      }
      if(!row){
        const m=section.match(/(\\d{1,2}:\\d{2})\\s+(?:[+-]\\d{2}\\s+)?([A-Z]{3})\\s+[A-Za-zÀ-ÿ .'-]{1,55}?\\s+([A-Z]{3})\\s+[A-Za-zÀ-ÿ .'-]{1,55}?\\s+(\\d{1,2}:\\d{2})/i);
        if(m)row={departureTime:normalizeTime(m[1]),departureOrigin:m[2],departureDestination:m[3],scheduledArrivalTime:normalizeTime(m[4]),snippet:m[0]};
      }
      if(row?.departureTime)return{status:'SCHEDULED',departureDate:date,departureTime:row.departureTime,departureIsActual:false,departureOrigin:row.departureOrigin||'',departureDestination:row.departureDestination||wantedDestination,scheduledArrivalDate:row.scheduledArrivalTime?date:(arrivalInfo.arrivalDate||''),scheduledArrivalTime:row.scheduledArrivalTime||arrivalInfo.arrivalTime||'',...arrivalInfo,source:'FlightStats dated schedule fallback',debugPattern:'FLIGHTSTATS_DATED_SCHEDULE',debugSnippet:row.snippet||section.slice(0,900)};
    }
    return null;
  };
  try{
    const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36','accept':'text/html,application/xhtml+xml','accept-language':'en-US,en;q=0.9'},cache:'no-store',redirect:'follow',signal:AbortSignal.timeout(10000)});
    if(r.ok){const parsed=parsePlain(cleanHtml(await r.text()));if(parsed)return{...parsed,url};}
  }catch{}
  if(allowBrowser){
    let browser;
    try{
      browser=await launch();const page=await browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36');
      await page.goto(url,{waitUntil:'domcontentloaded',timeout:18000});
      await new Promise(r=>setTimeout(r,1800));
      const plain=await page.evaluate(()=>document.body?.innerText||'').catch(()=> '');
      const parsed=parsePlain(plain);if(parsed)return{...parsed,url,source:`${parsed.source} (browser)`};
    }catch{}finally{try{if(browser)await browser.close()}catch{}}
  }
  return null;
}

async function flightRadarScheduleFallback({flightNo='',date='',destination=''}){
  const f=String(flightNo||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
  const dm=String(date||'').match(/^(20\d{2})-(\d{2})-(\d{2})$/);
  if(!f||!dm)return null;
  const wantedDestination=String(destination||'').toUpperCase();
  const label=`${Number(dm[3])} ${MONTHS[Number(dm[2])-1]} ${dm[1]}`;
  const url=`https://www.flightradar24.com/data/flights/${f.toLowerCase()}`;
  try{
    const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36','accept':'text/html,application/xhtml+xml','accept-language':'en-US,en;q=0.9'},cache:'no-store',redirect:'follow',signal:AbortSignal.timeout(12000)});
    if(!r.ok)return null;
    const plain=cleanHtml(await r.text());
    const lower=plain.toLowerCase(),needle=label.toLowerCase(),positions=[];
    let at=lower.indexOf(needle);
    while(at>=0&&positions.length<20){positions.push(at);at=lower.indexOf(needle,at+needle.length);}
    if(!positions.length)return null;
    for(let i=0;i<positions.length;i++){
      const start=positions[i];
      const end=i+1<positions.length?positions[i+1]:Math.min(plain.length,start+900);
      const block=plain.slice(start,Math.min(end,start+900));
      const route=block.match(/FROM\s+[^()]{1,80}\(([A-Z]{3})\)\s+TO\s+[^()]{1,80}\(([A-Z]{3})\)/i);
      const depOrigin=route?.[1]?.toUpperCase()||'';
      const depDestination=route?.[2]?.toUpperCase()||'';
      if(wantedDestination&&depDestination&&depDestination!==wantedDestination)continue;
      const std=normalizeTime((block.match(/\bSTD\s+(\d{1,2}:\d{2})\b/i)||[])[1]||'');
      const atd=normalizeTime((block.match(/\bATD\s+(\d{1,2}:\d{2})\b/i)||[])[1]||'');
      const sta=normalizeTime((block.match(/\bSTA\s+(\d{1,2}:\d{2})\b/i)||[])[1]||'');
      if(!(std||atd||sta))continue;
      return{
        status:atd?'DEPARTED':'SCHEDULED',
        departureDate:date,
        departureTime:atd||std,
        departureIsActual:Boolean(atd),
        departureOrigin:depOrigin,
        departureDestination:depDestination||wantedDestination,
        departureTimeZone:'UTC',
        scheduledArrivalDate:date,
        scheduledArrivalTime:sta,
        scheduledArrivalTimeZone:'UTC',
        arrivalDate:date,
        arrivalTime:sta,
        arrivalIsActual:false,
        arrivalTimeZone:'UTC',
        arrivalTimeSource:'Flightradar24 published flight schedule (UTC)',
        source:'Flightradar24 published flight schedule (UTC)',
        debugPattern:'FLIGHTRADAR24_SCHEDULE_MATCHED_LEG',
        debugSnippet:block.slice(0,700),
        url
      };
    }
    return null;
  }catch{return null;}
}
async function flightInfoScheduleFallback({flightNo='',date='',destination=''}){
  const f=String(flightNo||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
  const dm=String(date||'').match(/^(20\\d{2})-(\\d{2})-(\\d{2})$/);if(!f||!dm)return null;
  const fm=f.match(/^([A-Z]{2})(?:0*)(\\d{1,4})$/);
  const flightInfoCode=fm?`${fm[1]}${Number(fm[2])}`:f;
  const wantedDestination=String(destination||'').toUpperCase();
  const month=MONTHS[Number(dm[2])-1],label=`${Number(dm[3])} ${month} ${dm[1]}`;
  const url=`https://www.flight.info/${flightInfoCode}`;
  const parsePlain=(raw='')=>{
    const plain=String(raw||'').replace(/\\s+/g,' ').trim();if(!plain)return null;
    const rx=new RegExp(`${escapeRx(label)}\\s+(\\d{1,2}:\\d{2})\\s+[^()]{0,90}\\(([A-Z]{3})\\)\\s+[^()]{0,90}\\(([A-Z]{3})\\)`,'ig');
    // The same flight number can operate multiple legs on one date.
    // Scan every dated row and select the row for the requested destination.
    for(const m of plain.matchAll(rx)){
      const departureTime=normalizeTime(m[1]);
      const departureOrigin=String(m[2]||'').toUpperCase();
      const departureDestination=String(m[3]||'').toUpperCase();
      if(!departureTime)continue;
      if(wantedDestination&&departureDestination!==wantedDestination)continue;

      // The dated "Upcoming scheduled flights" row exposes the correct
      // operating date + departure time, but not always the arrival time.
      // Match that departure time against the active route schedule above
      // (e.g. 10:50 Hanoi(HAN) 17:50 London(LHR)).
      let scheduledArrivalTime='';
      const pairRx=new RegExp(
        `${escapeRx(departureTime)}\\s+[^()]{0,120}\\(${escapeRx(departureOrigin)}\\)\\s+(\\d{1,2}:\\d{2})\\s+[^()]{0,120}\\(${escapeRx(departureDestination)}\\)`,
        'i'
      );
      const pair=plain.match(pairRx);
      if(pair)scheduledArrivalTime=normalizeTime(pair[1]);

      return{
        status:'SCHEDULED',
        departureDate:date,
        departureTime,
        departureIsActual:false,
        departureOrigin,
        departureDestination,
        scheduledArrivalDate:date,
        scheduledArrivalTime,
        scheduledArrivalTimeZone:'',
        arrivalDate:scheduledArrivalTime?date:'',
        arrivalTime:scheduledArrivalTime,
        arrivalIsActual:false,
        arrivalTimeZone:'',
        arrivalTimeSource:scheduledArrivalTime?'Flight.info active route schedule':'',
        source:'Flight.info dated schedule fallback',
        debugPattern:scheduledArrivalTime?'FLIGHTINFO_DATED_ROUTE_WITH_ARRIVAL':'FLIGHTINFO_DATED_SCHEDULE_MATCHED_LEG',
        debugSnippet:(scheduledArrivalTime?pair?.[0]:m[0])?.slice(0,500)||''
      };
    }
    if(f.startsWith('TK')){
      const currentRx=/(\\d{1,2}:\\d{2})\\s+([A-Za-zÀ-ÿ .'-]{2,55})\\s*\\(([A-Z]{3})\\)\\s+(\\d{1,2}:\\d{2})\\s+([A-Za-zÀ-ÿ .'-]{2,55})\\s*\\(([A-Z]{3})\\)/g;
      for(const row of plain.matchAll(currentRx)){
        if(wantedDestination&&row[6].toUpperCase()!==wantedDestination)continue;
        const departureTime=normalizeTime(row[1]);if(!departureTime)continue;
        return{status:'SCHEDULED',departureDate:date,departureTime,departureIsActual:false,departureOrigin:row[3].toUpperCase(),departureDestination:row[6].toUpperCase(),source:'Flight.info active Turkish schedule fallback',debugPattern:'FLIGHTINFO_ACTIVE_TURKISH_SCHEDULE',debugSnippet:row[0].slice(0,500)};
      }
    }
    return null;
  };
  try{
    const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36','accept':'text/html,application/xhtml+xml','accept-language':'en-US,en;q=0.9'},cache:'no-store',redirect:'follow',signal:AbortSignal.timeout(10000)});
    if(r.ok){const parsed=parsePlain(cleanHtml(await r.text()));if(parsed)return{...parsed,url};}
  }catch{}
  return null;
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

export async function trackFlightStatusSnapshot({flightNo='',origin='',destination='',date='',departureOnly=false}){
  if(!flightNo||!date||(!departureOnly&&!origin))return{ok:false,reason:'MISSING FLIGHT STATUS INPUT'};
  const url=`https://in.trip.com/flights/status-${String(flightNo).toLowerCase()}/`;
  let browser,screenshotBase64=null,tripText='';
  try{
    browser=await launch();const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36');
    await page.goto(url,{waitUntil:'domcontentloaded',timeout:15000});
    await new Promise(r=>setTimeout(r,2500));
    tripText=await page.evaluate(()=>document.body?.innerText||'').catch(()=> '');
    const parsed=origin?parseTripText(tripText,{flightNo,origin,destination,date}):null;
    screenshotBase64=await page.screenshot({type:'jpeg',quality:58,fullPage:false,encoding:'base64'}).catch(()=>null);
    if(parsed&&(!departureOnly||parsed.departureTime))return{ok:true,...parsed,url,screenshotBase64,debug:{stage:'SUCCESS',targetDate:date,pattern:parsed.debugPattern||'',snippet:parsed.debugSnippet||''}};
  }catch(e){tripText=`${tripText} ${e?.message||e}`;}
  finally{try{if(browser)await browser.close()}catch{}}
  const scheduleFallback=await flightInfoScheduleFallback({flightNo,date,destination});
  const departureFallback=await flightStatsDepartureFallback({flightNo,date,destination});
  if(departureFallback){
    const merged=scheduleFallback?{...departureFallback,departureOrigin:scheduleFallback.departureOrigin||departureFallback.departureOrigin||'',departureDestination:scheduleFallback.departureDestination||departureFallback.departureDestination||'',source:`${departureFallback.source} + ${scheduleFallback.source} route`}:departureFallback;
    return{ok:true,...merged,screenshotBase64,debug:{stage:'SUCCESS',targetDate:date,pattern:merged.debugPattern||departureFallback.debugPattern,snippet:merged.debugSnippet||departureFallback.debugSnippet||''}};
  }
  if(scheduleFallback)return{ok:true,...scheduleFallback,screenshotBase64,debug:{stage:'SUCCESS',targetDate:date,pattern:scheduleFallback.debugPattern,snippet:scheduleFallback.debugSnippet||''}};
  const cxFallback=await cxFlightStatsFallback({flightNo,origin,destination,date});
  if(cxFallback)return{ok:true,...cxFallback,screenshotBase64,debug:{stage:'SUCCESS',targetDate:date,pattern:cxFallback.debugPattern,snippet:cxFallback.debugSnippet||''}};
  return{ok:false,reason:'FLIGHT STATUS SOURCES HAD NO VERIFIED TARGET-DATE DATA',url,screenshotBase64,debug:{stage:'NO_TARGET_DATE',pageText:String(tripText).slice(0,5000)}};
}


export async function trackFlightArrivalEstimate({flightNo='',date='',destination=''}){
  if(!flightNo||!date)return{ok:false,reason:'MISSING FLIGHT ARRIVAL INPUT'};
  const result=await flightStatsDepartureFallback({flightNo,date,destination});
  if(result?.arrivalTime)return{ok:true,...result};
  const radar=await flightRadarScheduleFallback({flightNo,date,destination}).catch(()=>null);
  if(radar?.arrivalTime)return{ok:true,...radar};
  return{ok:false,reason:'NO VERIFIED FLIGHT ARRIVAL ETA'};
}


export async function trackFlightScheduleFast({flightNo='',date='',destination=''}){
  if(!flightNo||!date)return{ok:false,reason:'MISSING FAST FLIGHT INPUT'};
  const schedule=await flightInfoScheduleFallback({flightNo,date,destination}).catch(()=>null);
  const stats=await flightStatsDepartureFallback({flightNo,date,destination,allowBrowser:false}).catch(()=>null);
  let radar=null;
  const base={...schedule,...stats};
  if(!base.departureTime||!base.arrivalTime&&!base.scheduledArrivalTime){
    radar=await flightRadarScheduleFallback({flightNo,date,destination}).catch(()=>null);
  }
  const result=stats||schedule||radar;
  if(!result)return{ok:false,reason:'NO FAST FLIGHT SCHEDULE DATA'};
  return{ok:true,...radar,...schedule,...stats,source:[stats?.source,schedule?.source,radar?.source].filter(Boolean).join(' + ')||'Fast flight schedule'};
}
