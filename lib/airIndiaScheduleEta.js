// Air India 098 only: a matching, dated passenger-flight schedule is an ETA,
// never proof that the air waybill departed or physically arrived.
import { localAirportTimeToIst } from './exportIst.js';

const goodDate=s=>/^20\d{2}-\d{2}-\d{2}$/.test(String(s||''));
const goodTime=s=>/^([01]\d|2[0-3]):[0-5]\d$/.test(String(s||''));
const plusDay=s=>new Date(Date.parse(s+'T00:00:00Z')+86400000).toISOString().slice(0,10);
const flight=s=>String(s||'').toUpperCase().replace(/[^A-Z0-9]/g,'').replace(/^([A-Z]{2})0+(\d)/,'$1$2');

export function acceptAirIndiaDatedEta(cargo={},schedule={}){
  const origin=String(cargo.origin||'').toUpperCase();
  const destination=String(cargo.destination||'').toUpperCase();
  const date=String(cargo.flightDate||'');
  const flightNo=flight(cargo.flightNo);
  if(!/^098[-]?\d{8}$/.test(String(cargo.mawb||'').replace(/[^0-9-]/g,''))||
      !/^(AI|IX)\d{1,4}$/.test(flightNo)||!goodDate(date)||
      !/^[A-Z]{3}$/.test(origin)||destination!=='DEL'||
      cargo.arrivalIsActual===true||cargo.status==='OFFLOADED'||!schedule)return null;
  if(schedule.ok===false||schedule.departureDate&&schedule.departureDate!==date)return null;
  if(schedule.flightNo&&flight(schedule.flightNo)!==flightNo)return null;
  if(schedule.departureOrigin&&String(schedule.departureOrigin).toUpperCase()!==origin)return null;
  if(schedule.departureDestination&&String(schedule.departureDestination).toUpperCase()!==destination)return null;
  const scheduledTime=String(schedule.arrivalTime||schedule.scheduledArrivalTime||'');
  let arrivalDate=String(schedule.arrivalDate||schedule.scheduledArrivalDate||'');
  if(!goodTime(scheduledTime)||!goodDate(arrivalDate))return null;
  // Destination DEL time is IST. Reject unspecified/foreign-zone times rather
  // than assume a time from a different airport. Convert when marked LOCAL.
  const zone=String(schedule.arrivalTimeZone||schedule.scheduledArrivalTimeZone||'').toUpperCase();
  const source=String(schedule.arrivalTimeSource||schedule.source||'');
  let arrivalTime=scheduledTime;
  if(zone==='UTC'||zone==='GMT'){
    const utc=new Date(arrivalDate+'T'+arrivalTime+':00Z');
    if(!Number.isFinite(utc.getTime()))return null;
    const ist=new Date(utc.getTime()+330*60000);
    arrivalDate=ist.toISOString().slice(0,10);
    arrivalTime=ist.toISOString().slice(11,16);
  }else if(zone==='LOCAL'||zone===''||zone==='IST'||zone==='ASIA/KOLKATA'){
    // Destination local = IST, even when source calls it "LOCAL".
    // A flight departing at 20:40 DXB and arriving 01:50 DEL must be
    // scheduled for the following calendar day, not the departure date.
    if(arrivalDate===date&&goodTime(schedule.departureTime)){
      const depIst=localAirportTimeToIst(date,String(schedule.departureTime),origin);
      if(depIst){
        const depTime=Date.parse(depIst.date+'T'+depIst.time+':00Z');
        const arrTime=Date.parse(arrivalDate+'T'+arrivalTime+':00Z');
        if(arrTime<depTime)arrivalDate=plusDay(arrivalDate);
      }
    }
  }else return null;
  // A dated matching-flight ETA can be published even before cargo departure;
  // it is NOT the event-based cargo arrival and must retain carrier status.
  return{
    arrivalDate,arrivalTime,scheduledArrivalDate:arrivalDate,
    scheduledArrivalTime:arrivalTime,
    arrivalTimeZone:'IST',scheduledArrivalTimeZone:'IST',
    arrivalEstimate:true,arrivalIsActual:false,arrivalVerifiedAbsent:false,
    arrivalTimeSource:'SCHEDULED FLIGHT ETA (IST) — cargo arrival not confirmed; '+source,
    airIndiaEtaFlightNo:cargo.flightNo,airIndiaEtaFlightDate:date,
    airIndiaEtaSource:schedule.url||schedule.flightStatusUrl||source
  };
}

// Verified dated arrival fallback from the published flight.info route page.
// A date-specific departure row must match exact flight, station and date,
// then its departure time must match the corresponding route schedule.
export async function flightInfoAirIndiaEta(cargo={},fetcher=fetch){
  const f=flight(cargo.flightNo),date=String(cargo.flightDate||'');
  const origin=String(cargo.origin||'').toUpperCase(),dest=String(cargo.destination||'').toUpperCase();
  if(!/^(AI|IX)\d{1,4}$/.test(f)||!goodDate(date)||!origin||dest!=='DEL')return null;
  try{
    const response=await fetcher('https://www.flight.info/'+f,{headers:{'user-agent':'Mozilla/5.0','accept':'text/html'},signal:AbortSignal.timeout(8000),cache:'no-store'});
    if(!response?.ok)return null;
    const raw=await response.text();
    const plain=raw.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/\s+/g,' ').trim();
    const [y,m,d]=date.split('-').map(Number);
    const mon=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m-1];
    const dateLabel='0?'+d+'\\s+'+mon+'\\s+'+y;
    const rows=new RegExp(dateLabel+'\\s+(\\d{1,2}:\\d{2})\\s+[^()]{0,110}\\('+origin+'\\)\\s+[^()]{0,110}\\('+dest+'\\)\\s+[^\\d]{0,130}'+f+'\\b','i');
    const target=plain.match(rows);
    if(!target)return null;
    const depTime=target[1].padStart(5,'0');
    // Match a distinct active route schedule with this exact departure clock.
    const schedules=plain.split(/Upcoming scheduled flights/i)[0]||plain;
    const depRx=new RegExp('\\b'+depTime+'\\s+[^()]{0,110}\\('+origin+'\\)\\s+(\\d{1,2}:\\d{2})\\s+[^()]{0,110}\\('+dest+'\\)','ig');
    const matches=[...schedules.matchAll(depRx)];
    if(matches.length!==1)return null;
    const arrivalTime=matches[0][1].padStart(5,'0');
    const candidate={ok:true,departureDate:date,departureTime:depTime,departureOrigin:origin,departureDestination:dest,arrivalDate:date,arrivalTime,arrivalTimeZone:'IST',source:'Flight.info dated route timetable',url:'https://www.flight.info/'+f};
    return acceptAirIndiaDatedEta(cargo,candidate);
  }catch{return null;}
}

const months={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
// The date of the latest recorded cargo event is a provisional schedule
// reference, never the carrier's actual booked/manifested flight date.
export function latestAirIndiaEventDate(sample=''){
  const timeline=String(sample||'').split(/AWB Activity Timeline/i)[1]||'';
  const stamp=timeline.match(/\b[A-Z]{3}\s*[•·]\s*(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[A-Za-z]*\s+(20\d{2}),\s*\d{1,2}:\d{2}/i);
  if(!stamp)return'';
  const day=String(stamp[1]).padStart(2,'0'),month=months[stamp[2].slice(0,3).toUpperCase()];
  return month?stamp[3]+'-'+month+'-'+day:'';
}
