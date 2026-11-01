// Air India 098 only. Match the active AWB's Tracking View flight row;
// Activity View remains authoritative for cargo status and physical arrival.
import { localAirportTimeToIst } from './exportIst.js';

const months={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
const flight=s=>String(s||'').toUpperCase().replace(/[^A-Z0-9]/g,'').replace(/^(AI|IX)0+(\d)/,'$1$2');
const pad=s=>String(s||'').padStart(2,'0');
const ymd=(day,month,year)=>{const mm=months[String(month||'').slice(0,3).toUpperCase()];return mm?year+'-'+mm+'-'+pad(day):'';};
const goodDate=s=>/^20\d{2}-\d{2}-\d{2}$/.test(String(s||''));
const goodTime=s=>/^([01]\d|2[0-3]):[0-5]\d$/.test(String(s||''));
const time=s=>/^\d{1,2}:\d{2}$/.test(String(s||''))?pad(s):'';

// A valid flight row must contain its own flight, route, date, departure
// and arrival clock, status marker and piece count. The top "Departed" tile
// is not proof that the cargo actually departed.
const flightRow=/\b(AI|IX)\s*[- ]?\s*(\d{2,4})\s+Departure:\s*(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[A-Za-z]*\s+(20\d{2})\s+(\d{1,2}:\d{2}|--:--)\s*\(([SEA])\)\s+([A-Z]{3})\s*[–-]\s*([A-Z]{3})\s+Arrival:\s*(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[A-Za-z]*\s+(20\d{2})\s+(\d{1,2}:\d{2}|--:--)\s*\(([SEA])\)\s*(\d{1,6})\s+pcs\b/gi;

export function parseAirIndiaTrackingView(text='',current={}){
  const raw=String(text||'');
  const awb=String(current.mawb||'').replace(/\D/g,'');
  if(!/^098\d{8}$/.test(awb))return null;
  // Reject a portal page for a previous AWB.
  const shown=raw.match(/\b098[- ]?\d{8}\b/);
  if(!shown||shown[0].replace(/\D/g,'')!==awb)return null;
  const timelineIndex=raw.search(/AWB\s+Activity\s+Timeline/i);
  const summary=(timelineIndex>=0?raw.slice(0,timelineIndex):raw).replace(/\s+/g,' ');
  const targetOrigin=String(current.origin||'').toUpperCase();
  const targetDestination=String(current.destination||'').toUpperCase();
  if(!targetOrigin||targetDestination!=='DEL'||current.arrivalIsActual===true||
     String(current.status||'').toUpperCase()==='OFFLOADED')return null;
  const assignedFlight=flight(current.flightNo),assignedDate=String(current.flightDate||'');
  const rawPieces=String(current.masterPieces||current.pieces||current.bags||'');
  const pieces=Number(rawPieces.split('/').at(-1).replace(/\D/g,'')||0);
  const possible=[];
  for(const m of summary.matchAll(flightRow)){
    const f=flight(m[1]+m[2]);
    const depDate=ymd(m[3],m[4],m[5]),arrivalDate=ymd(m[10],m[11],m[12]);
    const depStation=String(m[8]).toUpperCase(),arrStation=String(m[9]).toUpperCase();
    const arrivalClock=time(m[13]);
    if(!goodDate(depDate)||!goodDate(arrivalDate)||!goodTime(arrivalClock)||
       depStation!==targetOrigin||arrStation!==targetDestination||
       (assignedFlight&&assignedFlight!==f)||
       (goodDate(assignedDate)&&assignedDate!==depDate)||
       (pieces>0&&Number(m[15])!==pieces))continue;
    const toIst=localAirportTimeToIst(arrivalDate,arrivalClock,arrStation);
    if(!toIst)continue;
    possible.push({
      flightNo:m[1].toUpperCase()+m[2],flightDate:depDate,
      departureTime:time(m[6]),departureTimeTag:m[7],
      arrivalDate:toIst.date,arrivalTime:toIst.time,arrivalTimeTag:m[14],
      origin:depStation,destination:arrStation,pieces:String(m[15]),
      flightRouteEvidence:m[0].replace(/\s+/g,' ').trim()
    });
  }
  // Reject ambiguous multi-flight cards instead of guessing an ETA.
  const unique=new Map(possible.map(x=>[x.flightNo+'|'+x.flightDate+'|'+x.arrivalDate+'|'+x.arrivalTime,x]));
  if(unique.size!==1)return null;
  const selected=[...unique.values()][0];
  return {
    arrivalDate:selected.arrivalDate,arrivalTime:selected.arrivalTime,
    scheduledArrivalDate:selected.arrivalDate,scheduledArrivalTime:selected.arrivalTime,
    arrivalIsActual:false,arrivalEstimate:true,arrivalVerifiedAbsent:false,
    arrivalTimeZone:'IST',scheduledArrivalTimeZone:'IST',
    arrivalTimeSource:'Air India AWB Tracking View '+(selected.arrivalTimeTag==='E'?'ESTIMATED':selected.arrivalTimeTag==='A'?'AIRCRAFT ACTUAL':'SCHEDULED')+' arrival (IST); cargo ARRIVAL pending Activity View confirmation',
    airIndiaEtaSource:'Air India Cargo AWB Tracking View',
    airIndiaTrackingViewEvidence:selected.flightRouteEvidence,
    airIndiaEtaFlightNo:selected.flightNo,airIndiaEtaFlightDate:selected.flightDate,
    airIndiaEtaAssignmentConfirmed:Boolean(assignedFlight&&goodDate(assignedDate)),
    trackingViewFlightNo:selected.flightNo,trackingViewFlightDate:selected.flightDate
  };
}
