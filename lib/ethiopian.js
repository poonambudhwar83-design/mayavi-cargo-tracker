import { normalizeMawb } from './airlines.js';
import { normalizeShipmentTimesToIst } from './exportIst.js';

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
    const shipment=parseEthiopianOfficialHtml(html,mawb);
    if(!shipment)return{ok:false,
      reason:'Ethiopian Cargo returned no verified shipment matching this MAWB (the portal may show a sample shipment).',
      officialTracker:URL,debug:{stage:'ET_AWB_NOT_VERIFIED',http:response.status,
        header:(html.match(/AWB\s*No\s*:\s*([^<]+)/i)||[])[1]?.trim().slice(0,32)||''}};
    return{ok:true,shipment,officialTracker:URL,
      adapter:'Ethiopian Cargo official AWB-specific live HTML',debug:{stage:'ET_OFFICIAL_AWB_VERIFIED',
        http:response.status,events:shipment.historyEvents.length,legs:shipment.flightSchedule.length}};
  }catch(e){return{ok:false,reason:'ETHIOPIAN OFFICIAL CONNECTION: '+String(e?.message||e),
    officialTracker:URL,debug:{stage:'ET_OFFICIAL_REQUEST_FAILED'}}}
}
