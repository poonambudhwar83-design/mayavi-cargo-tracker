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

function parseTripText(text,{flightNo,origin,destination,date}){
  const flat=String(text||'').replace(/\s+/g,' ').trim();
  const label=displayDate(date);if(!label)return null;
  const upper=flat.toUpperCase(), target=label.toUpperCase();
  const starts=[];let p=upper.indexOf(target);while(p>=0){starts.push(p);p=upper.indexOf(target,p+target.length);if(starts.length>20)break;}
  const chunks=starts.map(i=>flat.slice(Math.max(0,i-220),Math.min(flat.length,i+950)));
  const scored=chunks.map(c=>({c,score:(new RegExp(escapeRx(flightNo),'i').test(c)?3:0)+(new RegExp(`\\b${escapeRx(origin)}\\b`,'i').test(c)?2:0)+(new RegExp(`\\b${escapeRx(destination)}\\b`,'i').test(c)?3:0)+(/\bARRIVED\b|HAS ARRIVED|LANDED/i.test(c)?6:0)})).sort((a,b)=>b.score-a.score);
  const chunk=scored[0]?.c||'';if(!chunk)return null;
  const arrived=/\bARRIVED\b|HAS ARRIVED|LANDED/i.test(chunk);
  const destRx=new RegExp(`(?:\\b${escapeRx(destination)}\\b|\\(${escapeRx(destination)}\\))[\\s\\S]{0,170}?(\\d{1,2}:\\d{2}(?:\\s*[AP]M)?)`,'i');
  const dm=chunk.match(destRx);
  let arrivalTime=dm?normalizeTime(dm[1]):'';
  if(!arrivalTime&&arrived){
    const times=[...chunk.matchAll(/\b(\d{1,2}:\d{2}(?:\s*[AP]M)?)\b/gi)].map(m=>normalizeTime(m[1])).filter(Boolean);
    if(times.length)arrivalTime=times[times.length-1];
  }
  if(!arrived&&!arrivalTime)return null;
  return {status:arrived?'ARRIVED':'IN TRANSIT',arrivalDate:date,arrivalTime,arrivalIsActual:arrived&&Boolean(arrivalTime),source:'Flight-status screenshot fallback'};
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
    if(parsed)return{ok:true,...parsed,url,screenshotBase64,debug:{stage:'SUCCESS',targetDate:date}};
    return{ok:false,reason:'FLIGHT STATUS SCREENSHOT HAD NO VERIFIED TARGET-DATE ARRIVAL',url,screenshotBase64,debug:{stage:'NO_TARGET_DATE',pageText:text.slice(0,5000)}};
  }catch(e){return{ok:false,reason:`FLIGHT STATUS SCREENSHOT ERROR: ${e?.message||e}`,url,debug:{stage:'ERROR'}};}
  finally{try{if(browser)await browser.close()}catch{}}
}
