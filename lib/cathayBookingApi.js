// Cathay Cargo approved Get Booking Details API (not the public website's
// anonymous/cross-origin tracking endpoint, which can reject hosted browsers).
// Cathay's documented GET route is:
// /companies/CX/v2/booking/status/{awb}/{iatacass}
// Only enable against a provider-approved production endpoint + credentials.
// Do not use the sample/test IATA CASS values for a real shipment.
const digits = value => String(value ?? '').replace(/\D/g, '');
const str = value => String(value ?? '').trim();
const dateOK = value => /^20\d{2}-\d{2}-\d{2}$/.test(str(value));
const timeOK = value => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(str(value));
const flightOK = value => /^CX\d{1,4}[A-Z]?$/i.test(str(value).replace(/\s+/g, ''));
const ZONES = { DEL: 'Asia/Kolkata', HKG: 'Asia/Hong_Kong', BOM: 'Asia/Kolkata', BLR: 'Asia/Kolkata' };

function scheduleClock(value, airport) {
  const s = str(value);
  if (!s) return {date:'', time:'', zone:''};
  // API may return explicit UTC timestamps. Format those in the destination
  // airport's local time, rather than treating UTC as local/IST.
  const explicitZone = /(?:Z|[+-]\d\d:?\d\d)$/i.test(s);
  const zone = ZONES[str(airport).toUpperCase()] || '';
  if (explicitZone && zone) {
    const ms = Date.parse(s);
    if (!Number.isFinite(ms)) return {date:'',time:'',zone:''};
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
      timeZone:zone, year:'numeric', month:'2-digit', day:'2-digit',
      hour:'2-digit', minute:'2-digit', hourCycle:'h23'
    }).formatToParts(new Date(ms)).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
    const date = [parts.year,parts.month,parts.day].join('-'),time = parts.hour+':'+parts.minute;
    return dateOK(date)&&timeOK(time)?{date,time,zone:airport==='DEL'?'IST':'LOCAL'}:{date:'',time:'',zone:''};
  }
  // Official example contains a local airport clock without a time-zone.
  // Preserve exactly that clock; never silently apply a second conversion.
  const m = s.match(/^(20\d{2}-\d{2}-\d{2})[T\s](\d\d:\d\d)/);
  return m&&dateOK(m[1])&&timeOK(m[2])?{
    date:m[1],time:m[2],zone:str(airport).toUpperCase()==='DEL'?'IST':'LOCAL'
  }:{date:'',time:'',zone:''};
}
export function parseCathayApprovedBooking(data,mawb) {
  const requested=digits(mawb),returned=digits(data?.awbNumber);
  if (!/^160\d{8}$/.test(requested)||returned!==requested)
    return {ok:false,reason:'CATHAY_BOOKING_AWB_MISMATCH'};
  const origin=str(data?.originAirport).toUpperCase();
  const destination=str(data?.destinationAirport).toUpperCase();
  const legs=Array.isArray(data?.routing)?data.routing.filter(r=>r&&typeof r==='object'):[];
  const dated=legs.filter(r=>flightOK(r.flightNo)&&
    Boolean(r.scheduledArrivalDateTime||r.scheduledDepartureDateTime));
  const final=dated.findLast(r=>str(r.destination).toUpperCase()===destination)||dated.at(-1);
  if(!final)return {ok:false,reason:'CATHAY_BOOKING_FLIGHT_UNPUBLISHED'};
  const flightNo=str(final.flightNo).toUpperCase().replace(/\s+/g,'');
  const departure=scheduleClock(final.scheduledDepartureDateTime,final.origin);
  const arrival=scheduleClock(final.scheduledArrivalDateTime,final.destination);
  if(!dateOK(departure.date)&&!dateOK(arrival.date))
    return {ok:false,reason:'CATHAY_BOOKING_DATED_FLIGHT_UNAVAILABLE'};
  const pieces=Number.isFinite(Number(data.pieces))&&Number(data.pieces)>0?String(data.pieces):'';
  const weight=Number.isFinite(Number(data.weight))&&Number(data.weight)>0?String(data.weight):'';
  const arrivalTimeSource='Cathay Cargo approved Get Booking Details API; scheduled (not actual) destination arrival';
  return {ok:true,shipment:{
    mawb:requested.slice(0,3)+'-'+requested.slice(3),
    carrierCode:'CX',airlineName:'Cathay Cargo',origin,destination,
    flightNo,flightDate:departure.date||'',
    departureDate:departure.date||'',departureTime:departure.time||'',
    departureTimeZone:departure.zone,
    arrivalDate:arrival.date||'',arrivalTime:arrival.time||'',
    arrivalTimeZone:arrival.zone,
    scheduledArrivalDate:arrival.date||'',scheduledArrivalTime:arrival.time||'',
    scheduledArrivalTimeZone:arrival.zone,
    arrivalIsActual:false,arrivalEstimate:Boolean(arrival.date&&arrival.time),
    status:'BOOKED',bags:pieces,pieces,weight,
    officialTracker:'https://www.cathaycargo.com/en-us/track-and-trace.html',
    source:'Cathay Cargo approved Get Booking Details API',
    arrivalTimeSource,
    cxBookingDetailsPending:!(arrival.date&&arrival.time),
    bookingApiStatus:str(data.status)||'',
    bookingApiAllocationCode:str(data.allocationCode)||''
  },debug:{routeCount:legs.length,flightNo,status:str(data.status)||'',awbMatch:true}};
}
export function cathayApprovedApiConfigured(env=process.env){
  return Boolean(str(env.CATHAY_CARGO_API_BASE_URL)&&str(env.CATHAY_CARGO_IATA_CASS)&&
    (str(env.CATHAY_CARGO_API_AUTH_HEADER)||str(env.CATHAY_CARGO_API_KEY)));
}
export async function trackCathayApprovedBooking(mawb,{
  env=process.env,request=fetch
}={}){
  const awb=digits(mawb);
  if(!/^160\d{8}$/.test(awb))return {ok:false,reason:'INVALID_CATHAY_AWB'};
  if(!cathayApprovedApiConfigured(env))
    return {ok:false,reason:'CATHAY_APPROVED_API_NOT_CONFIGURED'};
  const base=str(env.CATHAY_CARGO_API_BASE_URL).replace(/\/+$/,'');
  let target;
  try{
    const checked=new URL(base);
    if(checked.protocol!=='https:')return {ok:false,reason:'CATHAY_APPROVED_API_HTTPS_REQUIRED'};
    const cass=str(env.CATHAY_CARGO_IATA_CASS);
    if(!/^\d{8,15}$/.test(cass))return{ok:false,reason:'CATHAY_IATA_CASS_INVALID'};
    // Neither credentials nor arbitrary client-supplied endpoints are logged.
    target=checked.toString().replace(/\/+$/,'')+
      '/companies/CX/v2/booking/status/'+encodeURIComponent(awb.slice(0,3)+'-'+awb.slice(3))+'/'+encodeURIComponent(cass);
  }catch{return{ok:false,reason:'CATHAY_APPROVED_API_URL_INVALID'};}
  const headers={accept:'application/json'};
  const auth=str(env.CATHAY_CARGO_API_AUTH_HEADER);
  const key=str(env.CATHAY_CARGO_API_KEY);
  if(auth)headers.authorization=auth;
  if(key)headers['x-api-key']=key;
  try{
    const response=await request(target,{headers,cache:'no-store',signal:AbortSignal.timeout(10000)});
    if(!response.ok)return{ok:false,reason:response.status===401||response.status===403?
      'CATHAY_APPROVED_API_CREDENTIALS_REJECTED':'CATHAY_APPROVED_API_HTTP_'+response.status};
    const data=await response.json().catch(()=>null);
    if(!data||typeof data!=='object')return{ok:false,reason:'CATHAY_APPROVED_API_EMPTY_RESPONSE'};
    return parseCathayApprovedBooking(data,mawb);
  }catch(e){return{ok:false,reason:'CATHAY_APPROVED_API_REQUEST_FAILED'};}
}
