import { normalizeMawb } from './airlines.js';
import { normalizeShipmentTimesToIst, localAirportTimeToIst } from './exportIst.js';

// Ethiopian Cargo's public AWB search is a regular first-party HTML POST,
// not a JS API, login, captcha or a generic homepage result.
const URL='https://cargo.ethiopianairlines.com/my-cargo/track-your-shipment';
const ACTION=URL+'/Index/';
const clean=s=>String(s??'').replace(/\s+/g,' ').trim();
const strip=s=>clean(String(s||'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ')
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ')
  .replace(/<[^>]*>/g,' ')
  .replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&'));
const pad=n=>String(n).padStart(2,'0');
const MONTH={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',
  JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
const dateOf=s=>{
  let m=String(s||'').match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/);
  if(m)return m[1]+'-'+pad(m[2])+'-'+pad(m[3]);
  m=String(s||'').match(/\b(\d{1,2})[- ]([A-Z]{3})[A-Z]*[- ,]+(\d{2,4})\b/i);
  if(m&&MONTH[m[2].toUpperCase()]){
    let y=m[3];if(y.length===2)y='20'+y;
    return y+'-'+MONTH[m[2].toUpperCase()]+'-'+pad(m[1]);
  }
  return'';
};
const timeOf=s=>{const m=String(s||'').match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);return m?pad(m[1])+':'+m[2]:''};
function field(html,label){
  const rx=new RegExp('<p\\b[^>]*>\\s*'+label+'\\s*<\\/p>\\s*<p\\b[^>]*>([\\s\\S]{0,140}?)<\\/p>','i');
  return strip(html.match(rx)?.[1]||'');
}
function schedule(html){
  const start=html.search(/<h2[^>]*>\s*Flight Schedule\s*<\/h2>/i);
  if(start<0)return[];
  const end=html.slice(start).search(/<h2[^>]*>\s*Shipment History\s*<\/h2>/i);
  const chunk=html.slice(start,end>=0?start+end:start+19000);
  const cards=chunk.split(/<div[^>]*class="[^"]*\bflight-card\b[^"]*"[^>]*>/i).slice(1);
  return cards.slice(0,16).map(card=>{
    const row=strip(card.slice(0,1600)),flight=(row.match(/\bET\s*\d{2,4}\b/i)||[])[0]||'';
    const route=(row.match(/\b([A-Z]{3})\s*(?:→|->|-)\s*([A-Z]{3})\b/)||[]);
    const dt=dateOf(row);
    const status=(row.match(/\b(Scheduled|Confirmed|Departed|Arrived|Delayed|Cancelled)\b/i)||[])[1]||'';
    return{origin:route[1]||'',destination:route[2]||'',flightNo:flight.replace(/\s+/g,'').toUpperCase(),
      date:dt,time:timeOf(row),flightStatus:status.toUpperCase()};
  }).filter(x=>x.flightNo&&(x.origin||x.destination||x.date));
}
function history(html){
  const start=html.search(/<h2[^>]*>\s*Shipment History\s*<\/h2>/i);
  if(start<0)return[];
  const chunk=html.slice(start,start+30000);
  const blocks=chunk.split(/<div[^>]*class="[^"]*\bstatus-container\b[^"]*"[^>]*>/i).slice(1);
  return blocks.slice(0,60).map(section=>{
    const label=strip(section.match(/<strong[^>]*class="[^"]*\bstatus-font\b[^"]*"[^>]*>([\s\S]*?)<\/strong>/i)?.[1]||'');
    if(!label)return null;
    const ts=(section.match(/<strong[^>]*>(\d{1,2}[- ](?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[A-Za-z]*[- ]\d{2,4}\s+\d\d:\d\d(?::\d\d)?)<\/strong>/i)||[])[1]||'';
    const text=strip(section.slice(0,1800));
    return{label,date:dateOf(ts),time:timeOf(ts),description:text.slice(0,360)};
  }).filter(Boolean);
}
export function parseEthiopianOfficialHtml(html='',mawb=''){
  const full=normalizeMawb(mawb);
  if(!full||!/^071-\d{8}$/.test(full))return null;
  const serial=full.slice(4);
  // Ethiopian's public form responds to a fabricated 071-00000000 with its
  // built-in demonstration shipment (old JFK/BEY/JIB legs, ADD-DXB).
  // This is not a live airline master: reject it even when the header echoes
  // the submitted eight zeroes. Never write demonstration cargo into Mayavi.
  if(serial==='00000000')return null;
  // Some responses return a *placeholder/sample shipment* for nonexistent
  // AWBs. Verify the result header, never an input field or URL echo.
  const header=(String(html).match(/<h2\b[^>]*class="[^"]*\bawb-no\b[^"]*"[^>]*>\s*AWB\s*No\s*:\s*([^<]+)<\/h2>/i)||[])[1]||'';
  const returned=String(header).replace(/\D/g,'');
  if(returned!==serial&&returned!==full.replace(/\D/g,''))return null;
  const origin=field(html,'Origin').match(/\b[A-Z]{3}\b/i)?.[0]?.toUpperCase()||'';
  const destination=field(html,'Destination').match(/\b[A-Z]{3}\b/i)?.[0]?.toUpperCase()||'';
  const pieces=(field(html,'Pieces').match(/\b\d{1,6}\b/)||[])[0]||'';
  const weight=(field(html,'Weight').match(/\b\d[\d,.]*\b/)||[])[0]?.replace(/,/g,'')||'';
  const legs=schedule(html),events=history(html);
  if(!origin&&!destination&&!pieces&&!weight&&!legs.length&&!events.length)return null;
  const finalLeg=legs.filter(x=>x.destination===destination&&x.flightNo).at(-1)||
    legs.filter(x=>x.flightNo).at(-1)||null;
  const chron=(a,b)=>(a.date+' '+a.time).localeCompare(b.date+' '+b.time);
  const booked=events.filter(x=>/\b(booked|booking|accepted|received from shipper)\b/i.test(x.label)&&x.date).sort(chron)[0];
  const left=events.filter(x=>/\b(departed|loaded|departure)\b/i.test(x.label)&&x.date&&x.time).sort(chron).at(-1);
  const arrived=events.filter(x=>/\b(arrived|received from flight|delivered)\b/i.test(x.label)&&x.date&&x.time&&
    destination&&new RegExp('\\b'+destination+'\\b').test(x.description)).sort(chron).at(-1);
  const last=events.filter(x=>x.date).sort(chron).at(-1);
  const status=arrived?/\bdelivered\b/i.test(arrived.label)?'DELIVERED':'ARRIVED':
    left?'IN TRANSIT':last?'BOOKED':'TRACKING';
  const result={mawb:full,carrierCode:'ET',airlineName:'Ethiopian Cargo',
    origin,destination,pieces,bags:pieces,weight,masterWeight:weight,
    flightNo:finalLeg?.flightNo||'',flightDate:finalLeg?.date||'',
    finalFlightNo:finalLeg?.flightNo||'',finalFlightDate:finalLeg?.date||'',
    via:legs.filter(x=>x.destination&&x.destination!==destination).map(x=>x.destination).join(' / '),
    flightSchedule:legs,bookingDate:booked?.date||'',bookingTime:booked?.time||'',
    departureDate:left?.date||'',departureTime:left?.time||'',
    departureIsActual:Boolean(left),departureTimeSource:left?'ET official cargo history':'',
    arrivalDate:arrived?.date||'',arrivalTime:arrived?.time||'',
    arrivalIsActual:Boolean(arrived),arrivalEstimate:false,arrivalTimeSource:arrived?'ET destination cargo milestone':'',
    status,sourceStatus:last?.label||'',historyEvents:events.slice(0,25),
    officialTracker:URL,source:'Ethiopian Cargo official AWB-specific POST response',
    ethiopianLiveVerifiedAt:new Date().toISOString()};
  return normalizeShipmentTimesToIst(result);
}
// Match the official shipment's FINAL ET flight and arrival date against a
// public dated flight schedule. Cargo departure/arrival milestones always
// remain authoritative; a flight ETA is never a cargo ARR or delivery event.
export async function ethiopianFinalFlightEta(shipment={}) {
  const flight=String(shipment.finalFlightNo||shipment.flightNo||'').replace(/\s+/g,'').toUpperCase();
  const match=flight.match(/^ET0*(\d{2,4})$/);
  const cardDate=String(shipment.finalFlightDate||shipment.flightDate||'');
  const leg=(shipment.flightSchedule||[]).filter(x=>x.flightNo===flight).at(-1)||{};
  const origin=String(leg.origin||'').toUpperCase();
  const destination=String(shipment.destination||'').toUpperCase();
  if(!match||!/^20\d{2}-\d{2}-\d{2}$/.test(cardDate)||!/^[A-Z]{3}$/.test(origin)||
     !/^[A-Z]{3}$/.test(destination))return shipment;

  // A cargo flight card can show the arrival DATE; the actual final-leg
  // departure event is stronger proof of which operating day's flight to use.
  // ET686 on 11 Oct departed ADD for DEL on 11 Oct and arrives 12 Oct.
  // Searching 10 Oct first erroneously picked the previous day's ET686.
  const finalRoute=new RegExp('\\bfrom\\s+'+origin+'\\s+to\\s+'+destination+'\\b','i');
  const departureEvents=(shipment.historyEvents||[]).filter(e=>
    /DEPARTED ON FLIGHT|DEPARTURE|LOADED ON FLIGHT/i.test(String(e.label||''))&&
    finalRoute.test(String(e.description||''))&&/^20\d{2}-\d{2}-\d{2}$/.test(String(e.date||'')))
    .sort((a,b)=>(a.date+' '+(a.time||'')).localeCompare(b.date+' '+(b.time||'')));
  const confirmedDeparture=departureEvents.at(-1);
  const previous=new Date(cardDate+'T00:00:00Z');
  previous.setUTCDate(previous.getUTCDate()-1);
  // Without a cargo DEP event, try the card date first; the preceding day is
  // a fallback only for cards indexed by destination arrival rather than DEP.
  const operatingDates=confirmedDeparture?[confirmedDeparture.date]:
    [cardDate,previous.toISOString().slice(0,10)];
  for(const departDate of [...new Set(operatingDates)]){
    const [yy,mm,dd]=departDate.split('-');
    const url='https://www.flightstats.com/v2/flight-tracker/ET/'+Number(match[1])+
      '?year='+yy+'&month='+Number(mm)+'&date='+Number(dd);
    try{
      const res=await fetch(url,{headers:{accept:'text/html,application/xhtml+xml',
        'user-agent':'Mozilla/5.0 (compatible; Mayavi Cargo Flight Schedule/1.0)'},
        cache:'no-store',signal:AbortSignal.timeout(9000)});
      if(!res.ok)continue;
      const plain=strip((await res.text()).slice(0,280000));
      const head=(plain.match(/Flight Status\s+ET\s+\d+[\s\S]{0,500}?(?=Flight Departure Times)/i)||[])[0]||'';
      if(!head||!new RegExp('\\bET\\s*0*'+Number(match[1])+'\\b','i').test(head)||
         !new RegExp('\\b'+origin+'\\b').test(head)||
         !new RegExp('\\b'+destination+'\\b').test(head))continue;
      // Reject a response for an adjacent operating day, even if the flight
      // number and route are the same and the HTTP request returned 200.
      const depHeading=(plain.match(/Flight Departure Times\s+(\d{1,2}-[A-Za-z]{3}-20\d{2})/i)||[])[1]||'';
      if(depHeading&&dateOf(depHeading)!==departDate)continue;
      const arr=plain.match(/Flight Arrival Times\s+(\d{1,2}-[A-Za-z]{3}-20\d{2})([\s\S]{0,700})/i);
      if(!arr)continue;
      const arrivalDate=dateOf(arr[1]);
      // Overnight international flights often land NEXT day. Compare against
      // the operating/departure date, not the flight card date for equality.
      if(!arrivalDate||arrivalDate<departDate)continue;
      const block=arr[2]||'';
      const readLabel=name=>{
        const m=block.match(new RegExp('\\b'+name+'\\s+(\\d{1,2}:\\d{2})\\s+([A-Z]{2,6})','i'));
        return m?{time:timeOf(m[1]),zone:m[2].toUpperCase()}:null;
      };
      const scheduled=readLabel('Scheduled');
      const estimated=readLabel('Estimated');
      const actual=readLabel('Actual');
      const selected=actual||estimated||scheduled;
      if(!selected||!['IST','EAT','UTC','GMT'].includes(selected.zone))continue;
      const updated={...shipment,
        scheduledArrivalDate:arrivalDate,
        scheduledArrivalTime:scheduled?.time||selected.time,
        scheduledArrivalTimeZone:scheduled?.zone||selected.zone,
        scheduledArrivalTimeSource:'FlightStats '+flight+' '+departDate+' scheduled arrival',
        flightTrackingSource:'FlightStats: '+flight+' '+departDate+' '+origin+'-'+destination,
        flightTrackingCheckedAt:new Date().toISOString(),arrivalVerifiedAbsent:false};
      // Aircraft landing is NOT an airline cargo ARR event: retain IN TRANSIT
      // until Ethiopian's AWB-specific history confirms the cargo arrival.
      if(shipment.arrivalIsActual!==true){
        updated.arrivalDate=arrivalDate;
        updated.arrivalTime=selected.time;
        updated.arrivalTimeZone=selected.zone;
        updated.arrivalIsActual=false;
        updated.arrivalEstimate=true;
        updated.arrivalTimeSource='FlightStats '+(actual?'actual flight landing':estimated?'estimated flight arrival':'scheduled flight arrival')+
          ' for '+departDate+' (cargo arrival NOT confirmed)';
      }
      const normalized=normalizeShipmentTimesToIst(updated);
      // Cross-check dated ETA against Ethiopian's AWB-verified final-leg DEP.
      // A stale morning landing on 11 Oct cannot follow an ADD departure
      // late on 11 Oct, even when a flight-status page returns HTTP 200.
      if(confirmedDeparture&&confirmedDeparture.time){
        const depIst=localAirportTimeToIst(confirmedDeparture.date,confirmedDeparture.time,origin);
        const landingIso=String(normalized.arrivalDate||'')+'T'+String(normalized.arrivalTime||'')+':00+05:30';
        const departureIso=depIst?.date&&depIst?.time?depIst.date+'T'+depIst.time+':00+05:30':'';
        if(departureIso&&Date.parse(landingIso)<=Date.parse(departureIso))continue;
      }
      return normalized;
    }catch{}
  }
  // A successful official cargo refresh must not silently retain a previous
  // day's estimated arrival when no correct-day flight ETA can be verified.
  if(confirmedDeparture&&shipment.arrivalIsActual!==true){
    return {...shipment,arrivalDate:'',arrivalTime:'',arrivalIsActual:false,
      arrivalEstimate:false,arrivalVerifiedAbsent:true,
      arrivalTimeSource:'Final-leg departure confirmed; valid dated ETA temporarily unavailable'};
  }
  return shipment;
}
export async function trackEthiopian(input){
  const mawb=normalizeMawb(input);
  if(!mawb||!/^071-\d{8}$/.test(mawb))return{ok:false,reason:'INVALID ETHIOPIAN MAWB',officialTracker:URL};
  try{
    const body=new URLSearchParams({AirwayBilNum:mawb,CheckIn:'',CheckOut:''});
    const response=await fetch(ACTION,{method:'POST',body,
      headers:{accept:'text/html,application/xhtml+xml',
        'content-type':'application/x-www-form-urlencoded',
        origin:'https://cargo.ethiopianairlines.com',referer:URL},
      cache:'no-store',signal:AbortSignal.timeout(13500)});
    if(!response.ok)return{ok:false,reason:'ETHIOPIAN OFFICIAL HTTP '+response.status,
      officialTracker:URL,debug:{stage:'ET_FORM_HTTP_ERROR',http:response.status}};
    const html=(await response.text()).slice(0,850000);
    let shipment=parseEthiopianOfficialHtml(html,mawb);
    if(!shipment)return{ok:false,
      reason:'Ethiopian Cargo returned no verified shipment matching this MAWB (the portal may show a sample shipment).',
      officialTracker:URL,debug:{stage:'ET_AWB_NOT_VERIFIED',http:response.status,
        header:(html.match(/AWB\s*No\s*:\s*([^<]+)/i)||[])[1]?.trim().slice(0,32)||''}};
    shipment=await ethiopianFinalFlightEta(shipment);
    return{ok:true,shipment,officialTracker:URL,
      adapter:'Ethiopian Cargo official AWB-specific live HTML',debug:{stage:'ET_OFFICIAL_AWB_VERIFIED',
        http:response.status,events:shipment.historyEvents.length,legs:shipment.flightSchedule.length}};
  }catch(e){return{ok:false,reason:'ETHIOPIAN OFFICIAL CONNECTION: '+String(e?.message||e),
    officialTracker:URL,debug:{stage:'ET_OFFICIAL_REQUEST_FAILED'}}}
}
