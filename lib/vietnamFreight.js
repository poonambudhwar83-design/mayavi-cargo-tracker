const FREIGHT_PAGE='https://www.freight.aero/tracking.asp';
const FREIGHT_SERVICE='https://www.freight.aero/tracking_service.asp';
const OFFICIAL='https://cargo.vietnamairlines.com/vn/en/shipping-guide/track-your-cargo';
const MONTHS={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
const pad=v=>String(v).padStart(2,'0');
const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
const digits=v=>String(v??'').replace(/\D/g,'');

function normalize(value=''){
  const d=digits(value);
  return d.length===11?`${d.slice(0,3)}-${d.slice(3)}`:'';
}
function inputValue(html,name){
  const s=String(html||'');
  const a=s.match(new RegExp(`<input[^>]+(?:name|id)=["']${name}["'][^>]*value=["']([^"']*)["']`,'i'));
  if(a)return a[1];
  const b=s.match(new RegExp(`<input[^>]+value=["']([^"']*)["'][^>]+(?:name|id)=["']${name}["']`,'i'));
  return b?.[1]||'';
}
function parseDateTime(value=''){
  const s=clean(value).toUpperCase();
  let m=s.match(/(\d{1,2})-([A-Z]{3})-(20\d{2})\s+(\d{1,2}):(\d{2})/);
  if(m)return{date:`${m[3]}-${MONTHS[m[2]]||''}-${pad(m[1])}`,time:`${pad(m[4])}:${m[5]}`};
  m=s.match(/(\d{1,2})-([A-Z]{3})-(\d{2})\s+(\d{1,2}):(\d{2})/);
  if(m)return{date:`20${m[3]}-${MONTHS[m[2]]||''}-${pad(m[1])}`,time:`${pad(m[4])}:${m[5]}`};
  m=s.match(/(\d{1,2})-([A-Z]{3})-(20\d{2}|\d{2})/);
  if(m){const year=m[3].length===2?`20${m[3]}`:m[3];return{date:`${year}-${MONTHS[m[2]]||''}-${pad(m[1])}`,time:''};}
  return{date:'',time:''};
}
function addDay(date=''){
  if(!date)return'';
  const d=new Date(`${date}T12:00:00Z`); if(Number.isNaN(d.getTime()))return date;
  d.setUTCDate(d.getUTCDate()+1); return d.toISOString().slice(0,10);
}
function airportCode(value=''){
  const m=String(value||'').toUpperCase().match(/\(([A-Z]{3})\)\s*$/);
  return m?.[1]||'';
}
function numberOnly(value=''){
  const m=String(value||'').match(/[\d,.]+/);return m?m[0].replace(/,/g,''):'';
}
function seq(event){return Number(event?.eventSequenceNumber)||0}
function label(event){return clean(event?.status||'').toUpperCase()}
function statusFrom(item,events){
  const top=clean(item?.status||'').toUpperCase();
  const joined=[top,...events.map(label)].join(' | ');
  if(/\bDELIVERED\b|DELIVERY COMPLETED|\bDLV\b/.test(joined))return'DELIVERED';
  if(/RECEIVED FROM FLIGHT|PHYSICALLY RECEIVED|\bARRIVED\b|\bLANDED\b|NOTIFIED OF ARRIVAL|CONSIGNEE\/AGENT NOTIFIED OF ARRIVAL|\bRCF\b/.test(joined))return'ARRIVED';
  if(/DELAY|OFFLOAD|EXCEPTION|LATE/.test(top))return'DELAYED';
  if(/DEPARTED|IN TRANSIT|AIRBORNE|MANIFESTED|PRE-MANIFESTED/.test(joined))return'IN TRANSIT';
  if(/BOOKED|RECEIVED FROM SHIPPER|ACCEPTED/.test(joined))return'BOOKED';
  return'TRACKING';
}
function chooseFlight(events){
  const candidates=events.filter(e=>/^VN\d{2,4}$/i.test(clean(e?.flightNumber)));
  candidates.sort((a,b)=>seq(b)-seq(a));
  return clean(candidates[0]?.flightNumber).toUpperCase();
}
function chooseBookingDate(events){
  const booked=events.filter(e=>/\bBOOKED\b/.test(label(e))).map(e=>({...parseDateTime(e?.eventTime),sequence:seq(e)})).filter(x=>x.date);
  if(!booked.length)return'';
  booked.sort((a,b)=>`${a.date}T${a.time||'00:00'}`.localeCompare(`${b.date}T${b.time||'00:00'}`)||a.sequence-b.sequence);
  return booked[0].date;
}
function eventStation(event={}){
  for(const value of [event?.station,event?.location,event?.airport,event?.airportCode,event?.eventLocation,event?.locationCode]){
    const s=clean(value).toUpperCase();
    const m=s.match(/(?:^|\()([A-Z]{3})(?:\)|$)/)||s.match(/\b([A-Z]{3})\b/);
    if(m)return m[1];
  }
  const detail=clean(event?.detail).toUpperCase();
  const m=detail.match(/\b([A-Z]{3})\b/);
  return m?.[1]||'';
}
function chooseDeparture(events,flightNo,origin=''){
  const wantedFlight=clean(flightNo).toUpperCase();
  const wantedOrigin=clean(origin).toUpperCase();
  let candidates=events.filter(e=>/\bDEPARTED\b|FLIGHT DEPARTED|\bDEP\b/.test(`${label(e)} ${clean(e?.detail).toUpperCase()}`));
  if(wantedFlight){
    const sameFlight=candidates.filter(e=>clean(e?.flightNumber).toUpperCase()===wantedFlight);
    if(sameFlight.length)candidates=sameFlight;
  }
  if(wantedOrigin){
    const sameOrigin=candidates.filter(e=>eventStation(e)===wantedOrigin);
    if(sameOrigin.length)candidates=sameOrigin;
  }
  candidates.sort((a,b)=>seq(a)-seq(b));
  const event=candidates[0]||null;
  if(!event)return{date:'',time:'',actual:false,event:null,flightNo:wantedFlight,origin:wantedOrigin,destination:''};
  const dt=parseDateTime(event?.eventTime||event?.flightDate||'');
  const flight=clean(event?.flightNumber||wantedFlight).toUpperCase();
  const from=eventStation(event)||wantedOrigin;
  let to='';
  for(const value of [event?.destination,event?.to,event?.arrivalStation,event?.destinationCode]){
    const s=clean(value).toUpperCase();
    const m=s.match(/\b([A-Z]{3})\b/);
    if(m){to=m[1];break;}
  }
  return{date:dt.date,time:dt.time,actual:Boolean(dt.date||dt.time),event,flightNo:flight,origin:from,destination:to};
}
function chooseArrival(events,flightNo){
  const arrivals=events.filter(e=>/RECEIVED FROM FLIGHT|PHYSICALLY RECEIVED|\bARRIVED\b|\bLANDED\b|\bRCF\b|NOTIFIED OF ARRIVAL|CONSIGNEE\/AGENT NOTIFIED OF ARRIVAL/.test(`${label(e)} ${clean(e?.detail).toUpperCase()}`));
  arrivals.sort((a,b)=>seq(b)-seq(a));
  const event=arrivals[0];
  if(!event)return{date:'',time:'',actual:false,event:null};
  let dt=parseDateTime(event?.eventTime||event?.flightDate||'');
  const f=clean(event?.flightNumber||flightNo).toUpperCase();
  const departed=events.filter(e=>/DEPARTED/.test(label(e))&&(!f||clean(e?.flightNumber).toUpperCase()===f)&&seq(e)<seq(event)).sort((a,b)=>seq(b)-seq(a))[0];
  if(departed&&dt.date){
    const dep=parseDateTime(departed?.eventTime||departed?.flightDate||'');
    if(dep.date&&dt.date<=dep.date&&dt.time&&dep.time&&dt.time<dep.time)dt={...dt,date:addDay(dep.date)};
  }
  return{date:dt.date,time:dt.time,actual:Boolean(dt.date||dt.time),event};
}
function parseShipment(payload,mawb){
  const list=Array.isArray(payload)?payload:[];
  const item=list.find(x=>digits(x?.awbNumber)===digits(mawb))||list[0];
  if(!item||String(item?.responseCode||'').toUpperCase()==='ERROR')return null;
  const events=Array.isArray(item.events)?[...item.events]:[];
  events.sort((a,b)=>seq(a)-seq(b));
  const flightNo=chooseFlight(events);
  const origin=airportCode(item.origin);
  const destination=airportCode(item.destination);
  const departure=chooseDeparture(events,flightNo,origin);
  const arrival=chooseArrival(events,flightNo);
  const pieces=clean(item.totalPieces);
  return{
    mawb,
    carrierCode:'VN',
    airlineName:'Vietnam Airlines Cargo',
    origin,
    destination,
    bags:pieces,
    pieces,
    weight:numberOnly(item.weight),
    flightNo,
    flightDate:departure.date||'',
    bookingDate:chooseBookingDate(events),
    departureDate:departure.date,
    departureTime:departure.time,
    departureIsActual:departure.actual,
    departureFlightNo:departure.flightNo||flightNo,
    departureOrigin:departure.origin||origin,
    departureDestination:departure.destination||destination,
    departureTimeSource:departure.actual?'CHAMP Freight.aero final Departed event':'',
    arrivalDate:arrival.date,
    arrivalTime:arrival.time,
    arrivalIsActual:arrival.actual,
    status:statusFrom(item,events),
    officialTracker:OFFICIAL,
    source:'CHAMP Freight.aero Vietnam Airlines tracking',
    provider:'CHAMP Freight.aero'
  };
}

export async function trackVietnamFreight(input){
  const mawb=normalize(input);
  if(!mawb||!mawb.startsWith('738-'))return{ok:false,reason:'INVALID VIETNAM AIRLINES MAWB',officialTracker:OFFICIAL};
  const serial=mawb.slice(4),full=digits(mawb);
  const pageUrl=`${FREIGHT_PAGE}?Carrier=VN&Pfx=738&Portlet=yes&Shipment=${serial}&Site=CargoWeb`;
  try{
    const page=await fetch(pageUrl,{redirect:'follow',cache:'no-store',headers:{'user-agent':'Mozilla/5.0','accept-language':'en-US,en;q=0.9'},signal:AbortSignal.timeout(20000)});
    const html=await page.text();
    if(!page.ok)return{ok:false,reason:`FREIGHT.AERO PAGE HTTP ${page.status}`,officialTracker:OFFICIAL};
    const portalId=inputValue(html,'portal_id')||'CHA';
    const uuid=inputValue(html,'tracking_uuid')||'';
    const isPortlet=inputValue(html,'is_portlet_val')||inputValue(html,'is_portlet')||'1';
    const cookie=page.headers.get('set-cookie')||'';
    const body={portalId,awbInfo:[{awbNumber:full,carrierId:'VN',trackingAirline:''}],captchaResponse:'FREIGHT_LOGGED_CAPTCHA'};
    const response=await fetch(`${FREIGHT_SERVICE}?uuid=${encodeURIComponent(uuid)}&is_portlet=${encodeURIComponent(isPortlet)}`,{
      method:'POST',redirect:'follow',cache:'no-store',
      headers:{'content-type':'application/json; charset=utf-8','accept':'application/json, text/javascript, */*; q=0.01','x-requested-with':'XMLHttpRequest','referer':pageUrl,'origin':'https://www.freight.aero','user-agent':'Mozilla/5.0',...(cookie?{cookie}:{})},
      body:JSON.stringify(body),signal:AbortSignal.timeout(20000)
    });
    const text=await response.text();
    if(!response.ok)return{ok:false,reason:`FREIGHT.AERO TRACK HTTP ${response.status}`,officialTracker:OFFICIAL,debug:{preview:text.slice(0,500)}};
    let payload=null;try{payload=JSON.parse(text)}catch{}
    if(!payload)return{ok:false,reason:'FREIGHT.AERO RETURNED INVALID JSON',officialTracker:OFFICIAL,debug:{preview:text.slice(0,500)}};
    const shipment=parseShipment(payload,mawb);
    if(!shipment)return{ok:false,reason:'FREIGHT.AERO RETURNED NO VIETNAM SHIPMENT DATA',officialTracker:OFFICIAL,debug:{preview:text.slice(0,1000)}};
    const useful=Boolean((shipment.origin&&shipment.destination)||shipment.pieces||shipment.weight||shipment.flightNo||shipment.bookingDate||shipment.arrivalDate||(shipment.status&&shipment.status!=='TRACKING'));
    if(!useful)return{ok:false,reason:'FREIGHT.AERO RETURNED NO VERIFIED SHIPMENT FIELDS',officialTracker:OFFICIAL};
    return{ok:true,shipment,debug:{provider:'champ-freight-aero',eventCount:Array.isArray(payload?.[0]?.events)?payload[0].events.length:0}};
  }catch(error){return{ok:false,reason:error?.message||'FREIGHT.AERO VIETNAM TRACKING FAILED',officialTracker:OFFICIAL};}
}
