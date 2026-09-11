import { normalizeMawb } from './airlines.js';

const TERMINAL='https://www.cathaycargoterminal.com/en-us/Shipment-Tracking';
const CATHAY='https://www.cathaycargo.com/en-us/track-and-trace.html';
const AIRLINE={name:'Cathay Cargo',iata:'CX',url:CATHAY};
const months={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
const pfMonths=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const indiaAirports=new Set(['DEL','BOM','BLR','MAA','HYD','CCU','COK']);
const zoneHours={UTC:0,GMT:0,HKT:8,SGT:8,JST:9,KST:9,IST:5.5,PKT:5,BST:1,CET:1,CEST:2,EET:2,EEST:3,EST:-5,EDT:-4,CST:-6,CDT:-5,MST:-7,MDT:-6,PST:-8,PDT:-7,AKST:-9,AKDT:-8,HST:-10,AEST:10,AEDT:11,ACST:9.5,ACDT:10.5,AWST:8,NZST:12,NZDT:13};
const pad=v=>String(v).padStart(2,'0');
const clean=s=>String(s||'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&#39;|&apos;/gi,"'").replace(/\s+/g,' ').trim();

function dt(v=''){
  const s=String(v).toUpperCase();
  let m=s.match(/(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s,]+(20\d{2})(?:\s+(\d{1,2}):(\d{2}))?/);
  if(m)return{date:`${m[3]}-${months[m[2]]}-${pad(m[1])}`,time:m[4]?`${pad(m[4])}:${m[5]}`:''};
  m=s.match(/(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})(?:[T\s][^0-9]*(\d{1,2}):(\d{2}))?/);
  return m?{date:`${m[1]}-${pad(m[2])}-${pad(m[3])}`,time:m[4]?`${pad(m[4])}:${m[5]}`:''}:{date:'',time:''};
}

function parseTerminal(html,mawb){
  const text=clean(html),digits=mawb.replace(/\D/g,''),serial=digits.slice(3);
  if((!text.includes(digits)&&!text.includes(serial))||/Reject Reason|is not found/i.test(text))return null;
  const od=text.match(/AWB Type\s+(?:Import|Export)\s+([A-Z]{3})\s+([A-Z]{3})/i)||text.match(/Origin\s+Destination\s+([A-Z]{3})\s+([A-Z]{3})/i);
  const rcs=text.match(/Received from Shipper[\s\S]{0,900}?(\d{1,2}\s+[A-Z]{3}\s+20\d{2}\s+\d{1,2}:\d{2})\s+(\d{1,6})\s+([\d,.]+)/i);
  const depSection=(text.match(/Departure Flight[\s\S]{0,1800}?(?=Received from Flight|Cargo Delivered|Last Update|$)/i)||[])[0]||'';
  const deps=[...depSection.matchAll(/\b(CX\d{2,4})\s+(\d{1,2}\s+[A-Z]{3}\s+20\d{2})\s+(\d{1,2}:\d{2})\s*\(STD\)\s+(\d{1,6})\s+([\d,.]+)/gi)],dep=deps.at(-1);
  const atd=(depSection.match(/(?:\d{1,2}\s+[A-Z]{3}\s+20\d{2}\s+)?(\d{1,2}:\d{2})\s*\(ATD\)/i)||[]);
  const departure=dep?dt(`${dep[2]} ${atd[1]||dep[3]}`):{date:'',time:''};
  const rcfSection=(text.match(/Received from Flight[\s\S]{0,3000}?(?=Cargo Delivered|Last Update|$)/i)||[])[0]||'';
  const rcfs=[...rcfSection.matchAll(/\b(CX\d{2,4})\s+(\d{1,2}\s+[A-Z]{3}\s+20\d{2})(?:\s+\d{1,2}:\d{2})?\s+(\d{1,6})\s+([\d,.]+)\s+(\d{1,2}\s+[A-Z]{3}\s+20\d{2}\s+\d{1,2}:\d{2})/gi)],rcf=rcfs.at(-1);
  const arrival=rcf?dt(rcf[5]):{date:'',time:''};
  const delivered=/Cargo Delivered\s*\(DLV\)|Cargo Delivered/i.test(text);
  const pieces=rcf?.[3]||dep?.[4]||rcs?.[2]||'';
  const weight=(rcf?.[4]||dep?.[5]||rcs?.[3]||'').replace(/,/g,'');
  const flightNo=(rcf?.[1]||dep?.[1]||'').toUpperCase();
  const bookingDate=rcs?dt(rcs[1]).date:'';
  const status=delivered?'DELIVERED':rcf?'ARRIVED':dep?'IN TRANSIT':rcs?'BOOKED':'TRACKING';
  return{mawb,carrierCode:'CX',airlineName:'Cathay Cargo',origin:od?.[1]||'',destination:od?.[2]||'',bags:pieces,pieces,weight,bookingDate,flightNo,departureDate:departure.date,departureTime:departure.time,arrivalDate:arrival.date,arrivalTime:arrival.time,arrivalIsActual:Boolean(rcf&&arrival.date),status,officialTracker:CATHAY,source:'Cathay Cargo Terminal official tracking'};
}

async function getTerminal(mawb){
  const suffix=mawb.replace(/\D/g,'').slice(3);let last='';
  for(const url of [`${TERMINAL}/AWBPrefix/160/AWBSuffix/${suffix}`,`${TERMINAL}?AWBPrefix=160&AWBSuffix=${suffix}`]){
    try{const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0','accept-language':'en-US,en;q=0.9'},cache:'no-store',signal:AbortSignal.timeout(6500)});last=`HTTP ${r.status}`;if(!r.ok)continue;const shipment=parseTerminal(await r.text(),mawb);if(shipment)return{ok:true,shipment,last};}catch(e){last=e?.message||String(e);}
  }
  return{ok:false,last};
}

function pfDate(iso=''){const m=String(iso).match(/^(20\d{2})-(\d{2})-(\d{2})$/);return m?`${Number(m[3])} ${pfMonths[Number(m[2])-1]} ${m[1]}`:'';}
function addDays(iso,n){const m=String(iso).match(/^(20\d{2})-(\d{2})-(\d{2})$/);if(!m)return'';return new Date(Date.UTC(+m[1],+m[2]-1,+m[3]+n)).toISOString().slice(0,10);}
function zoneOffset(zone,airport=''){
  const z=String(zone||'').toUpperCase(),a=String(airport||'').toUpperCase();
  if(indiaAirports.has(a))return 5.5;if(['HKG','SIN'].includes(a))return 8;if(['NRT','HND','KIX','ICN'].includes(a))return 9;
  return Object.prototype.hasOwnProperty.call(zoneHours,z)?zoneHours[z]:null;
}
function inferArrivalDate(depDate,depTime,depZone,arrTime,arrZone,origin='',destination=''){
  const d=String(depDate).match(/^(20\d{2})-(\d{2})-(\d{2})$/),a=String(depTime).match(/^(\d{1,2}):(\d{2})$/),b=String(arrTime).match(/^(\d{1,2}):(\d{2})$/);if(!d||!a||!b)return'';
  const od=zoneOffset(depZone,origin),oa=zoneOffset(arrZone,destination);
  if(od!=null&&oa!=null){const depUtc=Date.UTC(+d[1],+d[2]-1,+d[3],+a[1],+a[2])-od*3600000;let best=null;for(let shift=-1;shift<=2;shift++){const arrUtc=Date.UTC(+d[1],+d[2]-1,+d[3]+shift,+b[1],+b[2])-oa*3600000,h=(arrUtc-depUtc)/3600000;if(h>=0.4&&h<=22&&(!best||h<best.h))best={shift,h};}if(best)return addDays(depDate,best.shift);}
  const depMin=+a[1]*60 + +a[2],arrMin=+b[1]*60 + +b[2];return addDays(depDate,arrMin+360<depMin?1:0);
}

async function getFlightHistory(flightNo,departureDate,origin='',destination=''){
  if(!flightNo||!departureDate)return null;
  try{
    const url=`https://planefinder.net/data/flight/${encodeURIComponent(flightNo)}`;
    const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36','accept-language':'en-US,en;q=0.9'},cache:'no-store',signal:AbortSignal.timeout(7000)});if(!r.ok)return{ok:false,reason:`HTTP ${r.status}`,url};
    const html=await r.text(),target=pfDate(departureDate);if(!target)return{ok:false,reason:'BAD DATE',url};
    const past=html.match(/Past(?:<[^>]+>|\s)*Flights/i),pastIndex=past?.index??-1;
    const rows=[...html.matchAll(/<tr\b[\s\S]*?<\/tr>/gi)],row=rows.find(x=>clean(x[0]).includes(target));
    if(!row)return{ok:false,reason:'DATE ROW NOT FOUND',url,htmlSnippet:clean(html).slice(0,800)};
    const rowText=clean(row[0]),times=[...rowText.matchAll(/\b(\d{1,2}:\d{2})\s+([A-Z]{2,5})\b/g)];if(times.length<2)return{ok:false,reason:'TIMES NOT FOUND',url,row:rowText.slice(0,700)};
    const depTime=times[0][1],depZone=times[0][2],arrTime=times[1][1],arrZone=times[1][2],actual=pastIndex>=0&&(row.index??0)>pastIndex;
    return{ok:true,actual,arrivalDate:inferArrivalDate(departureDate,depTime,depZone,arrTime,arrZone,origin,destination),arrivalTime:arrTime,departureActualTime:depTime,url,row:rowText.slice(0,700),depZone,arrZone};
  }catch(e){return{ok:false,reason:e?.message||String(e)};}
}

function localDepartureMs(date,time,airport=''){
  const d=String(date).match(/^(20\d{2})-(\d{2})-(\d{2})$/),t=String(time).match(/^(\d{1,2}):(\d{2})$/);if(!d||!t)return NaN;
  const off=zoneOffset('',airport);if(off==null)return NaN;
  return Date.UTC(+d[1],+d[2]-1,+d[3],+t[1],+t[2])-off*3600000;
}
function definitelyArrived(t){
  const dep=localDepartureMs(t.departureDate,t.departureTime,t.origin);return Number.isFinite(dep)&&Date.now()-dep>18*3600000;
}
function parseFlightStatsDate(v=''){
  const m=String(v).toUpperCase().match(/(\d{1,2})-(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)-(20\d{2})/);return m?`${m[3]}-${months[m[2]]}-${pad(m[1])}`:'';
}
async function getFlightStats(flightNo,departureDate){
  const fm=String(flightNo||'').toUpperCase().match(/^CX(\d{1,4})$/),dm=String(departureDate||'').match(/^(20\d{2})-(\d{2})-(\d{2})$/);if(!fm||!dm)return null;
  const url=`https://www.flightstats.com/v2/flight-tracker/CX/${fm[1]}?year=${dm[1]}&month=${dm[2]}&date=${dm[3]}`;
  try{
    const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36','accept-language':'en-US,en;q=0.9'},redirect:'follow',cache:'no-store',signal:AbortSignal.timeout(7000)});if(!r.ok)return{ok:false,reason:`HTTP ${r.status}`,url};
    const text=clean(await r.text()),sec=(text.match(/Flight Arrival Times([\s\S]{0,900})/i)||[])[1]||'';
    if(!sec)return{ok:false,reason:'ARRIVAL SECTION NOT FOUND',url,snippet:text.slice(0,900)};
    const date=parseFlightStatsDate(sec)||departureDate;
    const actual=sec.match(/Actual\s+(\d{1,2}:\d{2})\s+([A-Z]{2,5})/i);
    const estimated=sec.match(/Estimated\s+(\d{1,2}:\d{2})\s+([A-Z]{2,5})/i);
    const scheduled=sec.match(/Scheduled\s+(\d{1,2}:\d{2})\s+([A-Z]{2,5})/i);
    const pick=actual||estimated||scheduled;
    if(!pick)return{ok:false,reason:'ARRIVAL TIME NOT FOUND',url,section:sec.slice(0,700)};
    const landed=/\b(Landed|Arrived)\b/i.test(text)||Boolean(actual);
    return{ok:true,actual:landed&&Boolean(actual),landed,arrivalDate:date,arrivalTime:pick[1],arrivalZone:pick[2],timeType:actual?'actual':estimated?'estimated':'scheduled',url};
  }catch(e){return{ok:false,reason:e?.message||String(e),url};
  }
}

export async function trackCathay(input){
  const mawb=normalizeMawb(input);if(!mawb||!mawb.startsWith('160-'))return{ok:false,reason:'INVALID CATHAY MAWB',airline:AIRLINE};
  const terminal=await getTerminal(mawb);
  if(!terminal.ok)return{ok:false,reason:'CATHAY TERMINAL TRACKING FAILED',airline:AIRLINE,debug:{terminal}};
  const t=terminal.shipment;
  if(t.status==='ARRIVED'||t.status==='DELIVERED')return{ok:true,airline:AIRLINE,shipment:t,debug:{stage:'SUCCESS',source:'cathay-terminal-actual'}};
  const flight=await getFlightHistory(t.flightNo,t.departureDate,t.origin,t.destination);
  if(flight?.ok){
    const shipment={...t,arrivalDate:flight.arrivalDate||t.arrivalDate||'',arrivalTime:flight.arrivalTime||t.arrivalTime||'',arrivalIsActual:Boolean(flight.actual),status:flight.actual?'ARRIVED':t.status,source:flight.actual?'Cathay Cargo Terminal + Plane Finder flight history':'Cathay Cargo Terminal + Plane Finder schedule'};
    return{ok:true,airline:AIRLINE,shipment,debug:{stage:'SUCCESS',source:flight.actual?'cathay-terminal-plus-flight-history':'cathay-terminal-plus-flight-schedule',flightHistory:flight}};
  }
  const fs=await getFlightStats(t.flightNo,t.departureDate);
  if(fs?.ok){
    const arrived=Boolean(fs.landed||definitelyArrived(t));
    const shipment={...t,arrivalDate:fs.arrivalDate||t.arrivalDate||'',arrivalTime:fs.arrivalTime||t.arrivalTime||'',arrivalIsActual:Boolean(fs.actual),status:arrived?'ARRIVED':t.status,source:'Cathay Cargo Terminal + FlightStats'};
    return{ok:true,airline:AIRLINE,shipment,debug:{stage:'SUCCESS',source:'cathay-terminal-plus-flightstats',flightHistory:flight,flightStats:fs,statusInferred:arrived&&!fs.landed}};
  }
  if(definitelyArrived(t)){
    const shipment={...t,status:'ARRIVED',arrivalIsActual:false,source:'Cathay Cargo Terminal (arrival inferred from completed flight window)'};
    return{ok:true,airline:AIRLINE,shipment,debug:{stage:'SUCCESS',source:'cathay-terminal-completed-flight-window',flightHistory:flight,flightStats:fs,statusInferred:true}};
  }
  return{ok:true,airline:AIRLINE,shipment:t,debug:{stage:'SUCCESS',source:'cathay-terminal',flightHistory:flight,flightStats:fs}};
}
