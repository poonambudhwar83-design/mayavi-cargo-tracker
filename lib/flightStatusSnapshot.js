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
  const l=escapeRx(label),o=escapeRx(origin),d=escapeRx(destination),f=escapeRx(flightNo);

  // Preferred: the dated flight card. It reads: date -> Arrived -> origin -> destination -> actual arrival time.
  const cardRx=new RegExp(`${l}[\\s\\S]{0,500}?\\bARRIVED\\b[\\s\\S]{0,900}?\\b${o}\\b[\\s\\S]{0,450}?\\b${d}\\b[\\s\\S]{0,140}?${TIME_RX}`,'i');
  const card=flat.match(cardRx);
  if(card){
    const arrivalTime=normalizeTime(card[1]);
    if(arrivalTime)return{status:'ARRIVED',arrivalDate:date,arrivalTime,arrivalIsActual:true,source:'Flight-status screenshot fallback',debugPattern:'DATED_ARRIVED_CARD'};
  }

  // History-table fallback. Pick the last time before the word Arrived in the target-date row.
  const rowRx=new RegExp(`${l}[\\s\\S]{0,900}?\\b${o}\\b[\\s\\S]{0,500}?\\b${d}\\b([\\s\\S]{0,500}?)\\bARRIVED\\b`,'i');
  const row=flat.match(rowRx);
  if(row){
    const times=[...row[0].matchAll(/\b(\d{1,2}:\d{2}(?:\s*[AP]M)?)\b/gi)].map(m=>normalizeTime(m[1])).filter(Boolean);
    if(times.length)return{status:'ARRIVED',arrivalDate:date,arrivalTime:times[times.length-1],arrivalIsActual:true,source:'Flight-status screenshot fallback',debugPattern:'HISTORY_ROW'};
  }

  // Last resort: inspect all snippets around the target date, but only trust an arrival time after the destination code.
  const upper=flat.toUpperCase(),target=label.toUpperCase(),starts=[];let p=upper.indexOf(target);
  while(p>=0){starts.push(p);p=upper.indexOf(target,p+target.length);if(starts.length>30)break;}
  const candidates=[];
  for(const i of starts){
    const c=flat.slice(Math.max(0,i-120),Math.min(flat.length,i+1500));
    if(!/\bARRIVED\b|HAS ARRIVED|LANDED/i.test(c))continue;
    if(!new RegExp(`\\b${o}\\b`,'i').test(c)||!new RegExp(`\\b${d}\\b`,'i').test(c))continue;
    const afterDest=(c.match(new RegExp(`\\b${d}\\b([\\s\\S]{0,180})`,'i'))||[])[1]||'';
    const tm=afterDest.match(new RegExp(TIME_RX,'i'));
    const arrivalTime=tm?normalizeTime(tm[1]):'';
    if(arrivalTime)candidates.push({arrivalTime,score:(new RegExp(`\\b${f}\\b`,'i').test(c)?3:0)+6});
  }
  if(candidates.length){candidates.sort((a,b)=>b.score-a.score);return{status:'ARRIVED',arrivalDate:date,arrivalTime:candidates[0].arrivalTime,arrivalIsActual:true,source:'Flight-status screenshot fallback',debugPattern:'TARGET_DATE_DESTINATION_SNIPPET'};}
  return null;
}

async function launch(){
  chromium.setGraphicsMode=false;
  return puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox'],defaultViewport:{width:1440,height:1200,deviceScaleFactor:1},executablePath:await chromium.executablePath(),headless:'shell'});
}

export async function trackFlightStatusSnapshot({flightNo='',origin='',destination='',date=''}){
  if(!flightNo||!origin||!destination||!date)return{ok:false,reason:'MISSING FLIGHT STATUS INPUT'};
  const url=`https://in.trip.com/flights/status-${String(flightNo).toLowerCase()}/`;
  let browser;
  try{
    browser=await launch();const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36');
    await page.goto(url,{waitUntil:'domcontentloaded',timeout:15000});
    await new Promise(r=>setTimeout(r,2500));
    const text=await page.evaluate(()=>document.body?.innerText||'').catch(()=> '');
    const parsed=parseTripText(text,{flightNo,origin,destination,date});
    const screenshotBase64=await page.screenshot({type:'jpeg',quality:58,fullPage:false,encoding:'base64'}).catch(()=>null);
    if(parsed)return{ok:true,...parsed,url,screenshotBase64,debug:{stage:'SUCCESS',targetDate:date,pattern:parsed.debugPattern||''}};
    return{ok:false,reason:'FLIGHT STATUS SCREENSHOT HAD NO VERIFIED TARGET-DATE ARRIVAL',url,screenshotBase64,debug:{stage:'NO_TARGET_DATE',pageText:text.slice(0,5000)}};
  }catch(e){return{ok:false,reason:`FLIGHT STATUS SCREENSHOT ERROR: ${e?.message||e}`,url,debug:{stage:'ERROR'}};}
  finally{try{if(browser)await browser.close()}catch{}}
}
