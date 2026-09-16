import { normalizeMawb } from './airlines.js';

const TERMINAL='https://www.cathaycargoterminal.com/en-us/Shipment-Tracking';
const CATHAY='https://www.cathaycargo.com/en-us/track-and-trace.html';
const FLIGHT_STATUS='https://api.cathaypacific.com/flightinformation/flight-status/olss-flight-status/v5.0/flightStatusByFlightNumber';
const AIRLINE={name:'Cathay Cargo',iata:'CX',url:CATHAY};
const MONTH={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',SEPT:'09',OCT:'10',NOV:'11',DEC:'12'};
const pad=v=>String(v).padStart(2,'0');

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
function parseTerminal(html='',mawb=''){
  const text=stripHtml(html),digits=mawb.replace(/\D/g,''),serial=digits.slice(3);
  if((!text.includes(digits)&&!text.includes(`160-${serial}`)&&!text.includes(serial))||/Reject Reason|is not found|no record/i.test(text))return null;
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
async function fetchTerminal(mawb){
  const suffix=mawb.replace(/\D/g,'').slice(3),urls=[`${TERMINAL}/AWBPrefix/160/AWBSuffix/${suffix}`,`${TERMINAL}?AWBPrefix=160&AWBSuffix=${suffix}`];
  for(const url of urls){
    try{
      const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0','accept':'text/html,application/xhtml+xml'},redirect:'follow',cache:'no-store',signal:AbortSignal.timeout(12000)});
      if(!r.ok)continue;const parsed=parseTerminal(await r.text(),mawb);if(parsed)return{...parsed,url};
    }catch{}
  }
  return null;
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
    else if(depActual.date||/DEPART|AIRBORNE|IN.?FLIGHT/.test(flightStatus))status='IN TRANSIT';
    else if(/DELAY/.test(flightStatus))status='DELAYED';
    else if(/CANCEL/.test(flightStatus))status='CANCELLED';
  }
  return{shipment:{...base,origin:base.origin||s.origin||'',destination:base.destination||s.destination||'',flightNo:chosen.f.flightNo||base.flightNo,departureDate:departure.date||base.departureDate||'',departureTime:departure.time||base.departureTime||'',arrivalDate:arrival.date||base.arrivalDate||'',arrivalTime:arrival.time||base.arrivalTime||'',arrivalIsActual:Boolean(actual.date&&actual.time),status,source:'Cathay Cargo Terminal + Cathay Pacific official flight status',arrivalTimeSource:actual.date?'Cathay Pacific actual arrival':estimated.date?'Cathay Pacific estimated arrival':'Cathay Pacific scheduled arrival'},flightStatus:{flightNo:chosen.f.flightNo,travelDate:chosen.f.date,origin:s.origin||'',destination:s.destination||'',flightStatus:s.flightStatus||'',departActual:s.departActual||'',arrivalEstimated:s.arrivalEstimated||'',arrivalActual:s.arrivalActual||''}};
}

export async function trackCathay(input){
  const mawb=normalizeMawb(input);if(!mawb||!mawb.startsWith('160-'))return{ok:false,reason:'INVALID CATHAY MAWB',airline:AIRLINE};
  const terminal=await fetchTerminal(mawb);if(!terminal)return{ok:false,airline:AIRLINE,reason:'CATHAY TERMINAL DATA NOT EXTRACTED'};
  const enriched=await enrichWithOfficialFlight(terminal.shipment,terminal.flights);
  return{ok:true,airline:AIRLINE,shipment:enriched.shipment,debug:{source:'cathay-terminal-plus-official-flight-status',terminalUrl:terminal.url,terminalFlights:terminal.flights,flightStatus:enriched.flightStatus}};
}
