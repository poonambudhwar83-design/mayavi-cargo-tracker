import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { normalizeMawb } from './airlines.js';

const OFFICIAL='https://cargo.omanair.com/track-shipment';
const SMART='https://omanair.smartkargo.com/FrmAWBTracking.aspx';
const AIRLINE={name:'Oman Air Cargo',iata:'WY',url:OFFICIAL};
const MONTHS={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
const digits=s=>String(s||'').replace(/\D/g,'');
const pad=v=>String(v).padStart(2,'0');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function parseDate(s=''){
  const t=String(s).toUpperCase();
  let m=t.match(/\b(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})\b/);if(m)return`${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m=t.match(/\b(\d{1,2})[-\/.](\d{1,2})[-\/.](20\d{2})\b/);if(m)return`${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  m=t.match(/\b(\d{1,2})[\s\-]+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s\-,]+(20\d{2})\b/);if(m)return`${m[3]}-${MONTHS[m[2]]}-${pad(m[1])}`;
  return'';
}
function parseTime(s=''){
  let m=String(s).trim().toUpperCase().match(/\b(\d{1,2}):(\d{2})\s*([AP]M)\b/);
  if(m){let h=Number(m[1]);if(m[3]==='PM'&&h!==12)h+=12;if(m[3]==='AM'&&h===12)h=0;return`${pad(h)}:${m[2]}`;}
  m=String(s).match(/\b([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?\b/);return m?`${pad(m[1])}:${m[2]}`:'';
}
function lastWindow(text,rx,before=100,after=520){const all=[...String(text).matchAll(rx)];if(!all.length)return'';const m=all.at(-1),i=m.index||0;return String(text).slice(Math.max(0,i-before),Math.min(String(text).length,i+after));}
function bookingEventDate(text=''){
  const rows=[...String(text).matchAll(/\bBooked\b[\s\S]{0,260}?(\d{1,2}[\/-]\d{1,2}[\/-]20\d{2})\s+(\d{1,2}:\d{2})(?::\d{2})?/ig)];
  if(rows.length)return parseDate(rows.at(-1)[1]);
  return parseDate(lastWindow(text,/\bBOOKED\b/ig,80,360));
}
function finalBookedLeg(text=''){
  const rows=[...String(text).matchAll(/\bBooked\s*(?:\[[^\]]+\])?\s+([A-Z]{3})\s+([A-Z]{3})\s+(\d{1,6})\s+([\d,.]+)\s*Kgs?\s+(WY\s*[- ]?\d{2,4})\s+(\d{1,2}[\/-]\d{1,2}[\/-]20\d{2})\s+(\d{1,2}[\/-]\d{1,2}[\/-]20\d{2})\s+(\d{1,2}:\d{2})/ig)];
  if(!rows.length)return null;
  const r=rows.at(-1);
  return{origin:r[1].toUpperCase(),destination:r[2].toUpperCase(),pieces:r[3],weight:r[4].replace(/,/g,''),flightNo:r[5].replace(/\s|-/g,'').toUpperCase(),flightDate:parseDate(r[6]),eventDate:parseDate(r[7]),eventTime:parseTime(r[8])};
}
function statusFrom(text=''){
  const s=String(text).toUpperCase();const last=(s.match(/LAST ACTIVITY[\s\S]{0,220}/)||[])[0]||'';const x=last||s;
  if(/DELIVERED/.test(x))return'DELIVERED';
  if(/ARRIVED|RECEIVED FROM FLIGHT|\bRCF\b|LANDED/.test(x))return'ARRIVED';
  if(/DELAYED|OFFLOADED|EXCEPTION/.test(x))return'DELAYED';
  if(/DEPARTED|IN TRANSIT|AIRBORNE/.test(x))return'IN TRANSIT';
  if(/BOOKED|ACCEPTED|\bRCS\b/.test(x))return'BOOKED';
  return'TRACKING';
}
function parseShipment(text,mawb){
  const flat=clean(text),upper=flat.toUpperCase(),full=digits(mawb),serial=full.slice(3);
  const awbRx=new RegExp(`AWB\\s*:?\\s*910[-\\s]?${serial}\\s*\\(([A-Z]{3})\\s*[-–—>]\\s*([A-Z]{3})\\)`,'i');
  const route=flat.match(awbRx);const origin=route?.[1]?.toUpperCase()||'',destination=route?.[2]?.toUpperCase()||'';
  const awbAt=route?.index??flat.search(new RegExp(`910[-\\s]?${serial}`,'i'));const awbScope=awbAt>=0?flat.slice(Math.max(0,awbAt-120),awbAt+600):flat;
  let pieces='',weight='';const pw=awbScope.match(/\b(\d{1,6})\s*P(?:CS?)?\s*\/\s*([\d,.]+)\s*KGS?\b/i);if(pw){pieces=pw[1];weight=pw[2].replace(/,/g,'');}
  if(!pieces)pieces=(flat.match(/(?:Pieces?|Pcs?|Total Pieces)\s*[:#\-]?\s*(\d{1,6})\b/i)||[])[1]||'';
  if(!weight)weight=((flat.match(/(?:Gross\s*Weight|Total\s*Weight|\bWeight\b)\s*[:#\-]?\s*([\d,.]+)\s*KGS?/i)||[])[1]||'').replace(/,/g,'');
  const leg=finalBookedLeg(flat);const flights=[...upper.matchAll(/\bWY\s*[- ]?(\d{2,4})\b/g)];const flightNo=leg?.flightNo||(flights.length?`WY${flights.at(-1)[1]}`:'');
  const bookingDate=bookingEventDate(flat);
  const arrWin=lastWindow(flat,/\bARRIVED\b|RECEIVED\s+FROM\s+FLIGHT|\bRCF\b/ig,100,520);let arrivalDate=parseDate(arrWin),arrivalTime=parseTime(arrWin),arrivalIsActual=Boolean(arrivalDate||arrivalTime);
  if(!arrivalIsActual){const etaWin=lastWindow(flat,/\bETA\b|ESTIMATED\s+ARRIVAL/ig,100,420);arrivalDate=parseDate(etaWin);arrivalTime=parseTime(etaWin);}
  const status=statusFrom(flat);
  return{mawb,carrierCode:'WY',airlineName:AIRLINE.name,origin,destination,bags:pieces,pieces,weight,flightNo,bookingDate,arrivalDate,arrivalTime,arrivalIsActual,status,officialTracker:OFFICIAL,source:'Oman Air Cargo SmartKargo exact AWB result',finalLegOrigin:leg?.origin||'',finalLegDestination:leg?.destination||'',finalFlightDate:leg?.flightDate||''};
}
function cleanHtml(s=''){return String(s||'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/\s+/g,' ').trim();}
async function fetchFlightArrival({flightNo='',origin='',destination='',date=''}){
  const fm=String(flightNo).toUpperCase().match(/^WY0*(\d{2,4})$/),dm=String(date).match(/^(20\d{2})-(\d{2})-(\d{2})$/);if(!fm||!dm||!origin||!destination)return null;
  const url=`https://www.flightstats.com/v2/flight-tracker/WY/${Number(fm[1])}?year=${dm[1]}&month=${Number(dm[2])}&date=${Number(dm[3])}`;
  try{
    const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36','accept':'text/html,application/xhtml+xml','accept-language':'en-US,en;q=0.9'},cache:'no-store',redirect:'follow',signal:AbortSignal.timeout(12000)});if(!r.ok)return null;
    const plain=cleanHtml(await r.text());if(!plain.includes(origin)||!plain.includes(destination))return null;
    const i=plain.search(/Flight Arrival Times/i),block=i>=0?plain.slice(i,i+1600):plain;
    const actual=parseTime((block.match(/Actual\s+(\d{1,2}:\d{2}(?:\s*[AP]M)?)/i)||[])[1]||'');
    const estimated=parseTime((block.match(/Estimated\s+(\d{1,2}:\d{2}(?:\s*[AP]M)?)/i)||[])[1]||'');
    const scheduled=parseTime((block.match(/Scheduled\s+(\d{1,2}:\d{2}(?:\s*[AP]M)?)/i)||[])[1]||'');
    const arrivalTime=actual||estimated||scheduled;if(!arrivalTime)return null;
    return{arrivalDate:date,arrivalTime,arrivalIsActual:Boolean(actual),status:actual?'ARRIVED':'',source:actual?'Oman flight actual arrival':'Oman final-flight scheduled/estimated arrival',url};
  }catch{return null;}
}
function useful(s={}){return Boolean((s.origin&&s.destination)||s.pieces||s.weight||s.flightNo||s.bookingDate||s.arrivalDate||s.arrivalTime||(s.status&&s.status!=='TRACKING'));}
async function launch(){chromium.setGraphicsMode=false;return puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox'],defaultViewport:{width:1440,height:1200},executablePath:await chromium.executablePath(),headless:'shell'});}

export async function trackOman(input){
  const mawb=normalizeMawb(input);if(!mawb||!mawb.startsWith('910-'))return{ok:false,reason:'INVALID OMAN AIR CARGO MAWB',airline:AIRLINE,officialTracker:OFFICIAL};
  const full=digits(mawb),prefix=full.slice(0,3),serial=full.slice(3),url=`${SMART}?AWBNo=${encodeURIComponent(serial)}&AWBPrefix=${encodeURIComponent(prefix)}`;let browser;
  try{
    browser=await launch();const page=await browser.newPage();await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36');
    await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});await sleep(3500);try{await page.waitForNetworkIdle({idleTime:700,timeout:7000});}catch{}await sleep(700);
    const texts=[];for(const f of page.frames()){try{const t=await f.evaluate(()=>document.body?.innerText||'');if(t)texts.push(t);}catch{}}
    const text=texts.join('\n'),d=digits(text);if(!(d.includes(full)||d.includes(serial)))return{ok:false,reason:'OMAN AIR SMARTKARGO DID NOT RETURN THIS AWB',airline:AIRLINE,officialTracker:OFFICIAL,debug:{stage:'AWB_NOT_RETURNED',resultUrl:page.url(),textSample:clean(text).slice(0,2500)}};
    let shipment=parseShipment(text,mawb);
    if(!shipment.arrivalDate||!shipment.arrivalTime){const fa=await fetchFlightArrival({flightNo:shipment.flightNo,origin:shipment.finalLegOrigin,destination:shipment.finalLegDestination,date:shipment.finalFlightDate});if(fa){shipment={...shipment,arrivalDate:fa.arrivalDate,arrivalTime:fa.arrivalTime,arrivalIsActual:fa.arrivalIsActual,scheduledArrivalDate:fa.arrivalDate,scheduledArrivalTime:fa.arrivalTime,status:fa.status||shipment.status,source:`${shipment.source} + ${fa.source}`,arrivalSourceUrl:fa.url};}}
    delete shipment.finalLegOrigin;delete shipment.finalLegDestination;delete shipment.finalFlightDate;
    if(!useful(shipment))return{ok:false,reason:'OMAN AIR SMARTKARGO RESULT HAS NO SHIPMENT FIELDS',airline:AIRLINE,officialTracker:OFFICIAL,debug:{stage:'NO_FIELDS',resultUrl:page.url(),textSample:clean(text).slice(0,5000)}};
    return{ok:true,airline:AIRLINE,shipment,screenshotCaptured:false,screenshotVerified:false,screenshotOcrUsed:false,debug:{stage:'SMARTKARGO_QUERY_SUCCESS',resultUrl:page.url(),textSample:clean(text).slice(0,7000)}};
  }catch(e){return{ok:false,reason:`OMAN AIR TRACKING ERROR: ${e?.message||e}`,airline:AIRLINE,officialTracker:OFFICIAL,debug:{stage:'ERROR',message:e?.message||String(e)}};}
  finally{try{if(browser)await browser.close()}catch{}}
}
