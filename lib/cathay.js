import { neon } from '@neondatabase/serverless';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { normalizeMawb } from './airlines.js';
import { needsCathayBrowserFallback, mergeCathayBrowserFallback, trackCathayBrowserFallback } from './cathay-browser-fallback.js';
import { cathayApprovedApiConfigured, trackCathayApprovedBooking } from './cathayBookingApi.js';

const TERMINAL='https://www.cathaycargoterminal.com/en-us/Shipment-Tracking';
const CATHAY='https://www.cathaycargo.com/en-us/track-and-trace.html';
const FLIGHT_STATUS='https://api.cathaypacific.com/flightinformation/flight-status/olss-flight-status/v5.0/flightStatusByFlightNumber';
const AIRLINE={name:'Cathay Cargo',iata:'CX',url:CATHAY};
const MONTH={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',SEPT:'09',OCT:'10',NOV:'11',DEC:'12'};
const pad=v=>String(v).padStart(2,'0');
const RETAIN_KEYS=['origin','destination','flightNo','bags','pieces','weight','bookingDate','bookingTime','departureDate','departureTime','arrivalDate','arrivalTime','scheduledArrivalDate','scheduledArrivalTime','arrivalTimeSource','provider','source'];

function trackingDbUrl(){
  return process.env.DATABASE_URL||process.env.POSTGRES_URL||process.env.NEON_DATABASE_URL||process.env.DATABASE_URL_UNPOOLED||'';
}
function statusRank(value=''){
  const s=String(value||'').toUpperCase();
  if(s.includes('DELIVER'))return 6;
  if(s.includes('ARRIVED')||s.includes('RCF')||s.includes('LANDED'))return 5;
  if(s.includes('IN TRANSIT')||s.includes('DEPART')||s.includes('AIRBORNE')||s.includes('IN FLIGHT'))return 4;
  if(s.includes('DELAY'))return 3;
  if(s.includes('BOOK'))return 2;
  if(s.includes('TRACK'))return 1;
  return 0;
}
async function retainSavedCathayData(mawb,incoming={}){
  const url=trackingDbUrl();
  if(!url)return incoming;
  try{
    const awb=String(mawb||'').replace(/\D/g,'');
    const sql=neon(url);
    const rows=await sql`SELECT data FROM mayavi_shipments WHERE awb=${awb} LIMIT 1`;
    const saved=rows?.[0]?.data||{};
    if(!saved||typeof saved!=='object')return incoming;
    const out={...incoming};
    const newFlight=String(incoming?.flightNo||'').replace(/\s+/g,'').toUpperCase();
    const oldFlight=String(saved?.flightNo||'').replace(/\s+/g,'').toUpperCase();
    const reassigned=Boolean(newFlight&&oldFlight&&newFlight!==oldFlight);
    const staleFlightFields=new Set(['arrivalDate','arrivalTime','scheduledArrivalDate',
      'scheduledArrivalTime','arrivalTimeSource','departureDate','departureTime']);
    for(const key of RETAIN_KEYS){
      if(reassigned&&staleFlightFields.has(key))continue;
      const current=incoming?.[key];
      const old=saved?.[key];
      if((current===''||current===null||current===undefined)&&(old!==''&&old!==null&&old!==undefined))out[key]=old;
    }
    if(incoming?.arrivalIsActual!==true&&saved?.arrivalIsActual===true&&out.arrivalDate&&out.arrivalTime)out.arrivalIsActual=true;
    if(!reassigned&&statusRank(saved?.status)>statusRank(incoming?.status))out.status=saved.status;
    return out;
  }catch{
    return incoming;
  }
}

function parseCathayDate(value=''){
  const m=String(value||'').toUpperCase().match(/(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[A-Z]*\s+(20\d{2})(?:\s+(\d{1,2}):(\d{2}))?/);
  if(!m)return{date:'',time:''};
  return{date:`${m[3]}-${MONTH[m[2]]}-${pad(m[1])}`,time:m[4]?`${pad(m[4])}:${m[5]}`:''};
}
function splitApiDateTime(value=''){
  const m=String(value||'').match(/^(20\d{2})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})(?::\d{2})?/);
  return m?{date:`${m[1]}-${m[2]}-${m[3]}`,time:`${pad(m[4])}:${m[5]}`}:{date:'',time:''};
}
function stripHtml(html=''){
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi,' ')
    .replace(/<style[\s\S]*?<\/style>/gi,' ')
    .replace(/<br\s*\/?\s*>/gi,' ')
    .replace(/<[^>]+>/g,' ')
    .replace(/&nbsp;|&#160;/gi,' ')
    .replace(/&amp;/gi,'&')
    .replace(/\s+/g,' ')
    .trim();
}
function block(text,start,end){
  const s=text.search(start);if(s<0)return'';
  const tail=text.slice(s);const e=tail.search(end);return e>0?tail.slice(0,e):tail;
}
function parseFlightSegments(text=''){
  const out=[];
  const rx=/\b(CX\s*\d{1,4})\s+(\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[A-Z]*\s+20\d{2})\s+(\d{1,2}:\d{2})\s*\(STD\)\s*(\d{1,6})?\s*([\d,.]+)?/gi;
  const matches=[...text.matchAll(rx)];
  for(let i=0;i<matches.length;i++){
    const m=matches[i],from=m.index||0,to=i+1<matches.length?(matches[i+1].index||text.length):text.length,segment=text.slice(from,to);
    const atd=segment.match(/(\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[A-Z]*\s+20\d{2})\s+(\d{1,2}:\d{2})\s*\(ATD\)/i);
    const sched=parseCathayDate(`${m[2]} ${m[3]}`),actual=atd?parseCathayDate(`${atd[1]} ${atd[2]}`):{date:'',time:''};
    out.push({flightNo:m[1].replace(/\s+/g,'').toUpperCase(),date:sched.date,scheduledTime:sched.time,actualDepartureDate:actual.date,actualDepartureTime:actual.time,pieces:m[4]||'',weight:(m[5]||'').replace(/,/g,'')});
  }
  return out;
}
function parseRcfFlights(text=''){
  const out=[];
  const rcf=block(text,/Received from Flight/i,/Cargo Delivered|Last Update|$/i);
  for(const m of rcf.matchAll(/\b(CX\s*\d{1,4})\s+(\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[A-Z]*\s+20\d{2})\s+(\d{1,6})\s+([\d,.]+)/gi)){
    const d=parseCathayDate(m[2]);out.push({flightNo:m[1].replace(/\s+/g,'').toUpperCase(),date:d.date,scheduledTime:'',actualDepartureDate:'',actualDepartureTime:'',pieces:m[3]||'',weight:(m[4]||'').replace(/,/g,'')});
  }
  return out;
}
export function parseTerminal(html='',mawb=''){
  const text=stripHtml(html),digits=mawb.replace(/\D/g,''),serial=digits.slice(3);
  if((!text.includes(digits)&&!text.includes(`160-${serial}`)&&!text.includes(serial))||/Reject Reason|is not found|no record/i.test(text))return null;
  // Never mistake a populated search form or an empty carrier shell for a
  // verified tracking result. Cathay Terminal results have a Master AWB card.
  if(!/Master\s+AWB/i.test(text)||!/AWB\s+Type|Received\s+from\s+(?:Shipper|Flight)|Departure\s+Flight|Cargo\s+Delivered/i.test(text))return null;
  const route=text.match(/\b(?:Export|Import)\s+([A-Z]{3})\s+([A-Z]{3})\b/i)||text.match(/AWB Type[\s\S]{0,140}?\b(?:Export|Import)\s+([A-Z]{3})\s+([A-Z]{3})\b/i)||text.match(/Origin\s+Destination[\s\S]{0,140}?\b([A-Z]{3})\s+([A-Z]{3})\b/i);
  const rcsBlock=block(text,/Received from Shipper/i,/Departure Flight|Received from Flight|Cargo Delivered|Last Update|$/i);
  const rcsRows=[...rcsBlock.matchAll(/(\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[A-Z]*\s+20\d{2}\s+\d{1,2}:\d{2})\s+(\d{1,6})\s+([\d,.]+)/gi)];
  const firstRcs=rcsRows[0],lastRcs=rcsRows.at(-1),booking=firstRcs?parseCathayDate(firstRcs[1]):{date:'',time:''};
  const depBlock=block(text,/Departure Flight/i,/Received from Flight|Cargo Delivered|Last Update|$/i);
  let flights=parseFlightSegments(depBlock);if(!flights.length)flights=parseRcfFlights(text);
  const selected=flights.at(-1)||null;
  const pieces=selected?.pieces||lastRcs?.[2]||'',weight=(selected?.weight||lastRcs?.[3]||'').replace(/,/g,'');
  return{
    text,shipment:{mawb,carrierCode:'CX',airlineName:'Cathay Cargo',origin:route?.[1]?.toUpperCase()||'',destination:route?.[2]?.toUpperCase()||'',bags:pieces,pieces,weight,bookingDate:booking.date,flightNo:selected?.flightNo||'',departureDate:selected?.actualDepartureDate||selected?.date||'',departureTime:selected?.actualDepartureTime||selected?.scheduledTime||'',arrivalDate:'',arrivalTime:'',arrivalIsActual:false,status:/Cargo Delivered/i.test(text)?'DELIVERED':selected?.actualDepartureTime?'IN TRANSIT':booking.date?'BOOKED':'TRACKING',officialTracker:CATHAY,source:'Cathay Cargo Terminal official tracking'},
    flights,delivered:/Cargo Delivered/i.test(text)
  };
}
async function fetchTerminal(mawb,diagnostics=[]){
  const suffix=mawb.replace(/\D/g,'').slice(3),urls=[
    `${TERMINAL}?AWBPrefix=160&AWBSuffix=${suffix}`,
    `${TERMINAL}/AWBPrefix/160/AWBSuffix/${suffix}`,
    `https://www.cathaycargoterminal.com/Shipment-Tracking/AWBPrefix/160/AWBSuffix/${suffix}`
  ];
  for(const [variant,url] of urls.entries()){
    try{
      const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0','accept':'text/html,application/xhtml+xml'},redirect:'follow',cache:'no-store',signal:AbortSignal.timeout(10000)});
      if(!r.ok){diagnostics.push({variant,status:r.status});continue;}
      const html=await r.text(),parsed=parseTerminal(html,mawb);
      if(parsed)return{...parsed,url};
      const flat=stripHtml(html);
      diagnostics.push({variant,status:r.status,hasMasterAwb:/Master\s+AWB/i.test(flat),
        hasShipmentNumber:flat.includes(mawb)||flat.includes(mawb.replace(/\D/g,'')),
        challenge:/Access Denied|Forbidden|Bot Detection|Not Authorized/i.test(flat)});
    }catch(e){diagnostics.push({variant,error:String(e?.message||e).slice(0,80),
      errorCode:String(e?.cause?.code||e?.code||'').slice(0,60),
      cause:String(e?.cause?.message||'').slice(0,120)});}
  }
  return null;
}
// Public Terminal browser fallback for Node's incomplete TLS CA chain.
// This uses standard browser certificate validation; no ignoreHTTPSErrors,
// CAPTCHA bypass, or anonymous Cathay booking API calls.
async function fetchTerminalBrowser(mawb,diagnostics=[]){
  const suffix=mawb.replace(/\D/g,'').slice(3);
  const url=`${TERMINAL}?AWBPrefix=160&AWBSuffix=${suffix}`;
  let browser;
  try{
    chromium.setGraphicsMode=false;
    browser=await puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox'],
      executablePath:await chromium.executablePath(),headless:'shell',
      defaultViewport:{width:1280,height:900}});
    const page=await browser.newPage();
    const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:22000});
    let html=await page.content();
    let parsed=parseTerminal(html,mawb);
    if(!parsed&&response?.ok()){
      // On a newly booked master Cathay's result card can hydrate after
      // DOMContentLoaded. Wait briefly for the SAME AWB-specific card.
      await page.waitForFunction((full,serial)=>{
        const body=document.body?.innerText||'';
        return /Master\s+AWB/i.test(body)&&
          (body.includes(full)||body.includes(serial));
      },{timeout:3500,polling:300},mawb,suffix).catch(()=>{});
      html=await page.content();
      parsed=parseTerminal(html,mawb);
    }
    diagnostics.push({variant:'browser',status:response?.status()||0,
      hasVerifiedAwb:Boolean(parsed)});
    return parsed?{...parsed,url}:null;
  }catch(e){
    diagnostics.push({variant:'browser',error:String(e?.message||e).slice(0,120)});
    return null;
  }finally{if(browser)await browser.close().catch(()=>{});}
}

async function fetchFlightStatus(flightNo,date){
  const number=String(flightNo||'').replace(/\D/g,'');if(!number||!date)return null;
  try{
    const r=await fetch(FLIGHT_STATUS,{method:'POST',headers:{
      'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36',
      'accept':'application/json, text/plain, */*','content-type':'application/json;charset=UTF-8',
      'origin':'https://www.cathaypacific.com','referer':'https://www.cathaypacific.com/'
    },body:JSON.stringify({travelDate:date,carrierCode:'CX',flightNumber:number,locale:'en_US',departureArrival:'D'}),cache:'no-store',signal:AbortSignal.timeout(12000)});
    if(!r.ok)return null;const data=await r.json().catch(()=>null);if(!data?.result?.length)return null;
    const flight=data.result.find(x=>String(x?.operatingFlight?.carrierCode||'').toUpperCase()==='CX'&&String(x?.operatingFlight?.flightNumber||'').replace(/^0+/,'')===number.replace(/^0+/,''))||data.result[0];
    const sectors=Array.isArray(flight?.sectors)?flight.sectors:[];return{data,flight,sectors};
  }catch{return null;}
}
function rankSector(sector,origin,destination){
  let score=0;if(origin&&sector?.origin===origin)score+=4;if(destination&&sector?.destination===destination)score+=8;if(sector?.arrivalActual)score+=6;else if(sector?.arrivalEstimated)score+=3;if(sector?.departActual)score+=2;return score;
}
async function enrichWithOfficialFlight(base,flights=[]){
  const candidates=[];
  for(const f of flights.slice(-4)){
    const status=await fetchFlightStatus(f.flightNo,f.date);if(!status)continue;
    for(const sector of status.sectors)candidates.push({f,sector,score:rankSector(sector,base.origin,base.destination)});
  }
  if(!candidates.length)return{shipment:base,flightStatus:null};
  candidates.sort((a,b)=>b.score-a.score);const chosen=candidates[0],s=chosen.sector;
  const actual=splitApiDateTime(s.arrivalActual),estimated=splitApiDateTime(s.arrivalEstimated),scheduled=splitApiDateTime(s.arrivalScheduled),arrival=actual.date?actual:estimated.date?estimated:scheduled;
  const depActual=splitApiDateTime(s.departActual),depEstimated=splitApiDateTime(s.departEstimated),depScheduled=splitApiDateTime(s.departScheduled),departure=depActual.date?depActual:depEstimated.date?depEstimated:depScheduled;
  const flightStatus=String(s.flightStatus||'').toUpperCase();
  let status=base.status;
  if(base.status!=='DELIVERED'){
    if(actual.date||/ARRIVED|LANDED/.test(flightStatus))status='ARRIVED';
    else if(depActual.date||/DEPART|AIRBORNE|IN.?FLIGHT/.test(flightStatus))status='DEPARTED';
    else if(/DELAY/.test(flightStatus))status='DELAYED';
    else if(/CANCEL/.test(flightStatus))status='CANCELLED';
  }
  return{shipment:{...base,origin:base.origin||s.origin||'',destination:base.destination||s.destination||'',flightNo:chosen.f.flightNo||base.flightNo,departureDate:departure.date||base.departureDate||'',departureTime:departure.time||base.departureTime||'',arrivalDate:arrival.date||base.arrivalDate||'',arrivalTime:arrival.time||base.arrivalTime||'',arrivalIsActual:Boolean(actual.date&&actual.time),status,source:'Cathay Cargo Terminal + Cathay Pacific official flight status',arrivalTimeSource:actual.date?'Cathay Pacific actual arrival':estimated.date?'Cathay Pacific estimated arrival':'Cathay Pacific scheduled arrival'},flightStatus:{flightNo:chosen.f.flightNo,travelDate:chosen.f.date,origin:s.origin||'',destination:s.destination||'',flightStatus:s.flightStatus||'',departActual:s.departActual||'',arrivalEstimated:s.arrivalEstimated||'',arrivalActual:s.arrivalActual||''}};
}


/**
 * Merge an AWB-verified Cathay partner booking into a terminal movement.
 * A scheduled booking never overwrites an actual arrival or another flight.
 * Keep a whole date/time pair together rather than combining different sources.
 */
export function mergeApprovedCathayBooking(base={},approved={}) {
  if(approved?.ok!==true||!approved.shipment)return base;
  const booked=approved.shipment;
  const id=v=>String(v||'').replace(/\D/g,'');
  const flight=v=>String(v||'').toUpperCase().replace(/\s+/g,'');
  if(base.mawb&&id(base.mawb)!==id(booked.mawb))return base;
  if(base.destination&&booked.destination&&String(base.destination).toUpperCase()!==String(booked.destination).toUpperCase())return base;
  if(base.flightNo&&booked.flightNo&&flight(base.flightNo)!==flight(booked.flightNo))return base;
  const out={...base};
  for(const key of ['origin','destination','flightNo','flightDate','bags','pieces','weight']){
    if(!out[key]&&booked[key])out[key]=booked[key];
  }
  if(!out.departureDate&&!out.departureTime&&booked.departureDate&&booked.departureTime){
    out.departureDate=booked.departureDate;
    out.departureTime=booked.departureTime;
    out.departureTimeZone=booked.departureTimeZone||out.departureTimeZone||'';
  }
  const fromBooking=!out.arrivalIsActual&&booked.arrivalDate&&booked.arrivalTime&&(
    (!out.arrivalDate&&!out.arrivalTime)||
    (out.arrivalDate===booked.arrivalDate&&!out.arrivalTime)||
    (out.arrivalTime===booked.arrivalTime&&!out.arrivalDate));
  if(fromBooking){
    out.arrivalDate=booked.arrivalDate;
    out.arrivalTime=booked.arrivalTime;
    out.arrivalTimeZone=booked.arrivalTimeZone||out.arrivalTimeZone||'';
    out.arrivalTimeSource=booked.arrivalTimeSource;
    out.arrivalEstimate=true;
  }
  if(!out.scheduledArrivalDate&&!out.scheduledArrivalTime&&booked.scheduledArrivalDate&&booked.scheduledArrivalTime){
    out.scheduledArrivalDate=booked.scheduledArrivalDate;
    out.scheduledArrivalTime=booked.scheduledArrivalTime;
    out.scheduledArrivalTimeZone=booked.scheduledArrivalTimeZone||'';
  }
  return out;
}

// Restored September 2026 Cathay flow. The verified Terminal is authoritative
// for accepted pieces, weight and flight movements. The lower Booking Status
// section supplies the scheduled flight/arrival only when verified for this AWB.
export async function trackCathay(input,options={}){
  const mawb=normalizeMawb(input);
  if(!mawb||!mawb.startsWith('160-'))
    return{ok:false,reason:'INVALID CATHAY MAWB',airline:AIRLINE};
  const fastTerminal=options?.fastTerminal===true;
  const terminalProbes=[];
  let terminal=await fetchTerminal(mawb,terminalProbes);
  // September ZIP terminal-first strategy: when Node's TLS verifier lacks
  // Cathay's intermediary certificate, retry the SAME official URL in a
  // normal certificate-verifying Chromium session. This restores real RCS
  // pieces/weight without accepting unsigned or fabricated API responses.
  // A new master may not have a populated card in the initial HTTP HTML,
  // even if TLS is fine. Try its exact Cathay AWB in verified Chromium
  // whenever the direct response is incomplete; never substitute old data
  // or mark unverified empty pages as a successful live shipment.
  if(!terminal)terminal=await fetchTerminalBrowser(mawb,terminalProbes);
  // The anonymous public endpoint may return 403. Use only a provider-approved
  // API with production credentials; never use a test API or a guessed ETA.
  const approved=cathayApprovedApiConfigured()
    ?await trackCathayApprovedBooking(mawb)
    :{ok:false,reason:'CATHAY_APPROVED_API_NOT_CONFIGURED'};
  if(!terminal){
    if(approved.ok){
      const shipment=await retainSavedCathayData(mawb,approved.shipment);
      shipment.cxBookingDetailsPending=!(shipment.flightNo&&shipment.arrivalDate&&shipment.arrivalTime);
      return{ok:true,airline:AIRLINE,shipment,debug:{source:'approved-cathay-booking-api',approved:approved.debug}};
    }
    if(fastTerminal)return{ok:false,airline:AIRLINE,
      reason:'CATHAY TERMINAL DATA NOT AVAILABLE',
      debug:{source:'september-terminal-fast',approvedStatus:approved.reason,terminalProbes}};
    const browser=await trackCathayBrowserFallback(mawb,{});
    if(browser.ok){
      const shipment=await retainSavedCathayData(mawb,browser.shipment);
      shipment.cxBookingDetailsPending=!(shipment.flightNo&&shipment.arrivalDate&&shipment.arrivalTime);
      return{ok:true,airline:AIRLINE,shipment,
        debug:{source:'september-browser-only',browser:browser.debug}};
    }
    const blocked=browser.reason==='CATHAY_PUBLIC_TRACKING_403';
    return{ok:false,airline:AIRLINE,
      reason:blocked?'CATHAY OFFICIAL TRACKING BLOCKED (HTTP 403)':'CATHAY OFFICIAL DATA UNAVAILABLE',
      debug:{source:'september-terminal-and-booking',
        sourceStatus:blocked?'UPSTREAM_403':'UNAVAILABLE',approvedStatus:approved.reason,terminalProbes,
        browser:browser.debug||browser.reason}};
  }
  const enriched=await enrichWithOfficialFlight(terminal.shipment,terminal.flights);
  let shipment=mergeApprovedCathayBooking(enriched.shipment,approved),browser=null;
  const approvedComplete=Boolean(approved.ok&&shipment.flightNo&&shipment.arrivalDate&&shipment.arrivalTime);
  if(!fastTerminal&&!approvedComplete&&needsCathayBrowserFallback(shipment)){
    browser=await trackCathayBrowserFallback(mawb,shipment);
    if(browser.ok)shipment=mergeCathayBrowserFallback(shipment,browser.shipment);
  }
  // A blank/403 Booking Status response must never erase previously saved data.
  shipment=await retainSavedCathayData(mawb,shipment);
  shipment.cxBookingDetailsPending=!Boolean(shipment.flightNo&&shipment.arrivalDate&&shipment.arrivalTime);
  return{ok:true,airline:AIRLINE,shipment,debug:{
    source:browser?.ok?'september-terminal-plus-booking-status':
      'september-cargo-terminal',
    terminalUrl:terminal.url,terminalFlights:terminal.flights,
    flightStatus:enriched.flightStatus,
    bookingDetails:browser?.debug||browser?.reason||null,
    approvedStatus:approved.ok?'VERIFIED':approved.reason,
    sourceStatus:browser?.reason==='CATHAY_PUBLIC_TRACKING_403'?'UPSTREAM_403':'AVAILABLE'
  }};
}
