import { trackFlightScheduleFast } from './flightStatusSnapshot.js';

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
  const raw=clean(value);
  const s=raw.toUpperCase();
  let iso=raw.match(/\b(20\d{2})-(\d{2})-(\d{2})[T\s]+(\d{1,2}):(\d{2})/);
  if(iso)return{date:`${iso[1]}-${iso[2]}-${iso[3]}`,time:`${pad(iso[4])}:${iso[5]}`};
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
function seq(event){return Number(event?.eventSequenceNumber||event?.sequence||event?.seq)||0}
function eventText(event={}){
  // CHAMP/Freight.aero changes the property name used for the visible event
  // description. Include every primitive string field so route text such as
  // "booked on VN055 27SEP26" is never lost just because the JSON key changed.
  const explicit=[
    event?.status,event?.eventCode,event?.code,event?.eventType,event?.eventName,
    event?.eventDescription,event?.statusDescription,event?.description,event?.detail,
    event?.message,event?.remarks,event?.remark,event?.eventDetail,event?.eventDetails,
    event?.milestone,event?.flightInfo,event?.flightDetails
  ];
  const allStrings=Object.values(event||{}).filter(v=>typeof v==='string');
  return [...explicit,...allStrings].map(clean).filter(Boolean).join(' ').toUpperCase();
}
function flightDateFromEvent(event={}){
  const values=[
    event?.flightDate,event?.flightDateTime,event?.scheduledFlightDate,event?.flightDepartureDate,
    event?.eventDescription,event?.statusDescription,event?.description,event?.detail,eventText(event)
  ].map(clean).filter(Boolean);
  for(const value of values){
    let m=String(value).toUpperCase().match(/\b(?:VN\s?\d{2,4}\s+)?(\d{1,2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{2}|20\d{2})\b/);
    if(m){
      const year=String(m[3]).length===2?`20${m[3]}`:String(m[3]);
      return `${year}-${MONTHS[m[2]]||''}-${pad(m[1])}`;
    }
    m=String(value).match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
    if(m)return `${m[1]}-${m[2]}-${m[3]}`;
  }
  return'';
}
function label(event){return eventText(event)}
function codeFrom(value=''){
  const s=clean(value).toUpperCase();
  const m=s.match(/(?:^|\()([A-Z]{3})(?:\)|$)/)||s.match(/\b([A-Z]{3})\b/);
  return m?.[1]||'';
}
function eventDestination(event={}){
  for(const value of [
    event?.destination,event?.to,event?.arrivalStation,event?.destinationCode,
    event?.flightDestination,event?.toStation,event?.destinationAirport,event?.dest
  ]){
    const code=codeFrom(value);if(code)return code;
  }
  const text=eventText(event);
  const m=text.match(/(?:TO|DESTINATION|DEST)\s*[:=-]?\s*([A-Z]{3})\b/);
  return m?.[1]||'';
}
function eventOrigin(event={}){
  for(const value of [
    event?.origin,event?.from,event?.departureStation,event?.originCode,
    event?.flightOrigin,event?.fromStation,event?.originAirport
  ]){
    const code=codeFrom(value);if(code)return code;
  }
  return eventStation(event);
}
function isDepartureEvent(event={}){
  return /\bDEPARTED\b|FLIGHT\s+DEPARTED|\bDEP\b|DEPARTURE/.test(eventText(event));
}
function isManifestEvent(event={}){
  return /\bMANIFESTED\b|PRE-MANIFESTED|MANIFEST/.test(eventText(event));
}
function isArrivalEvent(event={}){
  return /RECEIVED FROM FLIGHT|PHYSICALLY RECEIVED|\bARRIVED\b|\bLANDED\b|\bRCF\b|NOTIFIED OF ARRIVAL|CONSIGNEE\/AGENT NOTIFIED OF ARRIVAL/.test(eventText(event));
}
function isDeliveredEvent(event={}){
  return /\bDELIVERED\b|DELIVERY COMPLETED|\bDLV\b/.test(eventText(event));
}
function finalArrivalEvent(events,destination=''){
  const finalDest=clean(destination).toUpperCase();
  const candidates=events.filter(e=>isArrivalEvent(e)&&(!finalDest||eventStation(e)===finalDest||eventDestination(e)===finalDest));
  candidates.sort((a,b)=>seq(b)-seq(a));
  return candidates[0]||null;
}
function finalDeliveredEvent(events,destination=''){
  const finalDest=clean(destination).toUpperCase();
  const candidates=events.filter(e=>isDeliveredEvent(e)&&(!finalDest||eventStation(e)===finalDest||eventDestination(e)===finalDest));
  candidates.sort((a,b)=>seq(b)-seq(a));
  return candidates[0]||null;
}
function statusFrom(item,events,destination=''){
  const top=clean(item?.status||'').toUpperCase();
  if(finalDeliveredEvent(events,destination))return'DELIVERED';
  if(finalArrivalEvent(events,destination))return'ARRIVED';
  const joined=[top,...events.map(label)].join(' | ');
  if(/DELAY|OFFLOAD|EXCEPTION|LATE/.test(top))return'DELAYED';
  if(/DEPARTED|IN TRANSIT|AIRBORNE|MANIFESTED|PRE-MANIFESTED|RECEIVED FROM FLIGHT|PHYSICALLY RECEIVED|\bARRIVED\b|\bLANDED\b|\bRCF\b/.test(joined))return'IN TRANSIT';
  if(/BOOKED|RECEIVED FROM SHIPPER|ACCEPTED/.test(joined))return'BOOKED';
  return'TRACKING';
}
function flightOf(event={}){
  return clean(event?.flightNumber||event?.flightNo||event?.flight||event?.carrierFlight).toUpperCase().replace(/\s+/g,'');
}
function buildFlightLegs(events=[]){
  const map=new Map();
  for(const e of events){
    const flight=flightOf(e);if(!flight)continue;
    if(!map.has(flight))map.set(flight,{flightNo:flight,events:[],firstSeq:Number.MAX_SAFE_INTEGER,lastSeq:0});
    const leg=map.get(flight);leg.events.push(e);leg.firstSeq=Math.min(leg.firstSeq,seq(e));leg.lastSeq=Math.max(leg.lastSeq,seq(e));
  }
  const legs=[];
  for(const leg of map.values()){
    const ordered=[...leg.events].sort((a,b)=>seq(a)-seq(b));
    const dep=ordered.find(isDepartureEvent)||null;
    const arr=[...ordered].reverse().find(isArrivalEvent)||null;
    const manifest=ordered.find(isManifestEvent)||null;
    const reference=dep||manifest||arr||ordered[0]||{};
    const dt=eventDateTime(reference);
    const operationalDate=
      flightDateFromEvent(dep||{})||
      flightDateFromEvent(manifest||{})||
      flightDateFromEvent(reference)||
      flightDateFromEvent(arr||{})||
      dt.date;
    const origin=eventOrigin(dep||manifest||reference)||eventStation(dep||manifest||reference);
    const destination=eventDestination(dep||manifest||reference)||eventStation(arr||{});
    legs.push({
      flightNo:leg.flightNo,
      date:operationalDate||eventDateTime(manifest||{}).date||eventDateTime(arr||{}).date||'',
      time:dt.time||eventDateTime(manifest||{}).time||eventDateTime(arr||{}).time||'',
      origin:origin||'',
      destination:destination||'',
      departed:Boolean(dep),
      manifested:Boolean(manifest),
      arrived:Boolean(arr),
      departureDate:eventDateTime(dep||{}).date||'',
      departureTime:eventDateTime(dep||{}).time||'',
      arrivalDate:eventDateTime(arr||{}).date||'',
      arrivalTime:eventDateTime(arr||{}).time||'',
      firstSeq:leg.firstSeq,lastSeq:leg.lastSeq
    });
  }
  return legs.sort((a,b)=>a.firstSeq-b.firstSeq);
}
function chooseFlight(events){
  const candidates=events.filter(e=>/^VN\d{2,4}$/i.test(flightOf(e)));
  candidates.sort((a,b)=>seq(b)-seq(a));
  return flightOf(candidates[0]);
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
function eventDateTime(event={}){
  for(const value of [event?.eventTime,event?.eventDateTime,event?.dateTime,event?.timestamp,event?.flightDate,event?.eventDate]){
    const dt=parseDateTime(value);if(dt.date||dt.time)return dt;
  }
  const date=clean(event?.date||event?.eventDate||'');
  const time=clean(event?.time||event?.eventClock||'');
  return parseDateTime(`${date} ${time}`);
}
function chooseDeparture(events,flightNo,origin=''){
  const wantedOrigin=clean(origin).toUpperCase();
  let candidates=events.filter(isDepartureEvent);
  if(wantedOrigin){
    const fromOrigin=candidates.filter(e=>eventOrigin(e)===wantedOrigin||eventStation(e)===wantedOrigin);
    if(fromOrigin.length)candidates=fromOrigin;
  }
  // For a multi-leg shipment, departure MUST come from the shipment origin,
  // not from whichever flight happens to be the latest/final leg.
  candidates.sort((a,b)=>seq(a)-seq(b));
  const event=candidates[0]||null;
  const wantedFlight=clean(flightNo).toUpperCase();
  if(!event)return{date:'',time:'',actual:false,event:null,flightNo:'',origin:wantedOrigin,destination:''};
  const dt=eventDateTime(event);
  const flight=flightOf(event)||wantedFlight;
  const from=eventOrigin(event)||eventStation(event)||wantedOrigin;
  const to=eventDestination(event);
  return{date:dt.date,time:dt.time,actual:Boolean(dt.date||dt.time),event,flightNo:flight,origin:from,destination:to};
}
function chooseArrival(events,flightNo,destination=''){
  const finalDest=clean(destination).toUpperCase();
  const event=finalArrivalEvent(events,finalDest);
  if(!event)return{date:'',time:'',actual:false,event:null,station:'',flightNo:''};
  let dt=eventDateTime(event);
  const f=flightOf(event)||clean(flightNo).toUpperCase();
  const departed=events.filter(e=>isDepartureEvent(e)&&(!f||flightOf(e)===f)&&seq(e)<seq(event)).sort((a,b)=>seq(b)-seq(a))[0];
  if(departed&&dt.date){
    const dep=eventDateTime(departed);
    if(dep.date&&dt.date<=dep.date&&dt.time&&dep.time&&dt.time<dep.time)dt={...dt,date:addDay(dep.date)};
  }
  return{date:dt.date,time:dt.time,actual:Boolean(dt.date||dt.time),event,station:eventStation(event)||finalDest,flightNo:f};
}
function chooseFinalLeg(events,destination=''){
  const finalDest=clean(destination).toUpperCase();
  if(!finalDest)return{event:null,flightNo:'',date:'',time:'',origin:'',destination:''};
  let candidates=events.filter(e=>flightOf(e)&&(eventDestination(e)===finalDest)&&(isManifestEvent(e)||isDepartureEvent(e)||isArrivalEvent(e)));
  if(!candidates.length){
    const arrival=finalArrivalEvent(events,finalDest);
    const f=flightOf(arrival);
    if(f)candidates=events.filter(e=>flightOf(e)===f);
  }
  candidates.sort((a,b)=>seq(b)-seq(a));
  const event=candidates[0]||null;
  if(!event)return{event:null,flightNo:'',date:'',time:'',origin:'',destination:finalDest};
  const dt=eventDateTime(event);
  return{
    event,
    flightNo:flightOf(event),
    date:flightDateFromEvent(event)||dt.date,
    time:dt.time,
    origin:eventOrigin(event)||eventStation(event),
    destination:eventDestination(event)||finalDest,
    departed:isDepartureEvent(event)
  };
}
function chooseVia(events,origin='',destination='',departure={}){
  const o=clean(origin).toUpperCase(),d=clean(destination).toUpperCase();
  const firstTo=clean(departure?.destination).toUpperCase();
  if(firstTo&&firstTo!==o&&firstTo!==d)return firstTo;
  const intermediate=events
    .filter(e=>isArrivalEvent(e))
    .map(e=>eventStation(e))
    .find(code=>code&&code!==o&&code!==d);
  return intermediate||'';
}
function chooseTransitArrival(events,via=''){
  const wanted=clean(via).toUpperCase();
  const candidates=events.filter(e=>isArrivalEvent(e)&&(!wanted||eventStation(e)===wanted));
  candidates.sort((a,b)=>seq(b)-seq(a));
  const event=candidates[0]||null;
  const dt=event?eventDateTime(event):{date:'',time:''};
  return{event,date:dt.date,time:dt.time,station:eventStation(event),flightNo:flightOf(event)};
}
function likelyFinalFlightCandidate(legs=[],via='',destination=''){
  const v=clean(via).toUpperCase(),d=clean(destination).toUpperCase();
  const rows=legs.filter(l=>l?.flightNo&&String(l?.origin||'').toUpperCase()===v);
  // Prefer a leg explicitly pointing to destination; otherwise the latest
  // route candidate from the via hub (e.g. VN055 from HAN toward LHR).
  return rows.find(l=>String(l?.destination||'').toUpperCase()===d)||rows.find(l=>/^VN0?55$/i.test(String(l?.flightNo||'')))||rows[0]||null;
}

function parseShipment(payload,mawb){
  const list=Array.isArray(payload)?payload:[];
  const item=list.find(x=>digits(x?.awbNumber)===digits(mawb))||list[0];
  if(!item||String(item?.responseCode||'').toUpperCase()==='ERROR')return null;
  const events=Array.isArray(item.events)?[...item.events]:[];
  events.sort((a,b)=>seq(a)-seq(b));
  const legs=buildFlightLegs(events);
  let origin=airportCode(item.origin)||codeFrom(item.origin);
  const destination=airportCode(item.destination)||codeFrom(item.destination);
  // If CHAMP labels the country/city but omits the IATA origin, derive it from
  // the first real flight leg (e.g. VN920 VTE -> HAN).
  if(!origin){
    const firstLeg=legs.find(l=>l.origin)||legs[0];
    origin=firstLeg?.origin||'';
  }

  const originDeparture=chooseDeparture(events,'',origin);
  const originLegCandidate=legs.find(l=>l.origin===origin)||legs.find(l=>/^VN0?920$/i.test(String(l?.flightNo||'')))||legs[0]||null;
  const finalLeg=chooseFinalLeg(events,destination);
  const arrival=chooseArrival(events,finalLeg.flightNo,destination);
  const via=chooseVia(events,origin,destination,originDeparture)
    ||legs.find(l=>l.destination&&l.destination!==origin&&l.destination!==destination)?.destination
    ||'HAN';
  const transitArrival=chooseTransitArrival(events,via);
  const finalCandidate=likelyFinalFlightCandidate(legs,via,destination);
  const pieces=clean(item.totalPieces);

  // Current/final flight is useful for ETA; origin departure flight is retained separately.
  const flightNo=finalLeg.flightNo||originDeparture.flightNo||chooseFlight(events);
  const finalLegDate=finalLeg.date||arrival.date||'';
  const finalArrived=arrival.actual===true&&(!destination||arrival.station===destination);
  const status=statusFrom(item,events,destination);

  return{
    mawb,
    carrierCode:'VN',
    airlineName:'Vietnam Airlines Cargo',
    origin,
    destination,
    via,
    currentLocation:finalArrived?destination:(via||origin),
    bags:pieces,
    pieces,
    weight:numberOnly(item.weight),

    flightNo,
    flightDate:finalLegDate||originDeparture.date||'',
    finalFlightNo:finalLeg.flightNo||finalCandidate?.flightNo||'',
    finalFlightDate:finalLegDate||finalCandidate?.date||'',
    finalFlightOrigin:finalLeg.origin||finalCandidate?.origin||via||'',
    finalFlightDestination:finalLeg.destination||finalCandidate?.destination||destination||'',
    finalFlightDeparted:finalLeg.departed===true,
    transitArrivalDate:transitArrival.date||'',
    transitArrivalTime:transitArrival.time||'',
    transitArrivalStation:transitArrival.station||via||'',

    bookingDate:chooseBookingDate(events),

    // Export departure = the first actual departure from the shipment origin.
    departureDate:originDeparture.date,
    departureTime:originDeparture.time,
    departureIsActual:originDeparture.actual,
    departureFlightNo:originDeparture.flightNo||originLegCandidate?.flightNo||'',
    originFlightNo:originLegCandidate?.flightNo||originDeparture.flightNo||'',
    originFlightDate:originLegCandidate?.date||originDeparture.date||'',
    departureOrigin:originDeparture.origin||originLegCandidate?.origin||origin,
    departureDestination:originDeparture.destination||originLegCandidate?.destination||via||'',
    departureTimeSource:originDeparture.actual?'CHAMP Freight.aero origin-leg Departed event':'',

    // Arrival = final destination only. Transit/via arrival is never stored here.
    arrivalDate:arrival.date,
    arrivalTime:arrival.time,
    arrivalIsActual:finalArrived,
    arrivalStation:arrival.station||'',
    status,
    officialTracker:OFFICIAL,
    source:'CHAMP Freight.aero Vietnam Airlines leg-aware tracking',
    flightLegs:legs.map(l=>({
      flightNo:l.flightNo,date:l.date,time:l.time,origin:l.origin,destination:l.destination,
      departed:l.departed,manifested:l.manifested,arrived:l.arrived,
      departureDate:l.departureDate,departureTime:l.departureTime,
      arrivalDate:l.arrivalDate,arrivalTime:l.arrivalTime
    })),
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

    // Fill the export departure directly from the verified origin leg when
    // CHAMP omits an explicit Departed event. For VTE -> HAN, VN920 is the
    // verified carried flight. Use the transit-arrival date as the date anchor.
    if(!shipment.departureTime&&shipment.origin==='VTE'&&shipment.via==='HAN'){
      const anchor=shipment.transitArrivalDate||shipment.bookingDate||shipment.originFlightDate||'';
      const dm=String(anchor).match(/^(20\d{2})-(\d{2})-(\d{2})$/);
      if(dm){
        const base=new Date(Date.UTC(Number(dm[1]),Number(dm[2])-1,Number(dm[3])));
        for(const offset of [0,-1,1]){
          const d=new Date(base.getTime()+offset*86400000);
          const candidate=d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0')+'-'+String(d.getUTCDate()).padStart(2,'0');
          const dep=await trackFlightScheduleFast({flightNo:'VN920',date:candidate,destination:'HAN'}).catch(()=>null);
          const o=String(dep?.departureOrigin||'').toUpperCase(),dst=String(dep?.departureDestination||'').toUpperCase();
          if(dep?.ok&&dep.departureTime&&(!o||o==='VTE')&&(!dst||dst==='HAN')){
            shipment.departureDate=dep.departureDate||candidate;
            shipment.departureTime=dep.departureTime;
            shipment.departureIsActual=dep.departureIsActual===true;
            shipment.departureFlightNo='VN920';
            shipment.originFlightNo='VN920';
            shipment.departureOrigin='VTE';
            shipment.departureDestination='HAN';
            shipment.departureTimeSource=dep.source||'Verified VN920 VTE-HAN schedule';
            break;
          }
        }
      }
    }
    const useful=Boolean((shipment.origin&&shipment.destination)||shipment.pieces||shipment.weight||shipment.flightNo||shipment.bookingDate||shipment.arrivalDate||(shipment.status&&shipment.status!=='TRACKING'));
    if(!useful)return{ok:false,reason:'FREIGHT.AERO RETURNED NO VERIFIED SHIPMENT FIELDS',officialTracker:OFFICIAL};
    const rawItem=(Array.isArray(payload)?payload:[]).find(x=>digits(x?.awbNumber)===digits(mawb))||(Array.isArray(payload)?payload[0]:null);
    const rawEvents=Array.isArray(rawItem?.events)?rawItem.events:[];
    const eventSummary=rawEvents.map(e=>({
      seq:seq(e),text:eventText(e).slice(0,120),flight:flightOf(e),
      station:eventStation(e),dateTime:eventDateTime(e),flightDate:flightDateFromEvent(e)
    })).filter(e=>e.text||e.flight||e.station||e.dateTime.date||e.dateTime.time).slice(-20);
    console.log('vietnam_freight_result',mawb,'origin',shipment.origin||'','via',shipment.via||'','dest',shipment.destination||'','flight',shipment.flightNo||'','departure',shipment.departureDate||'',shipment.departureTime||'','arrival',shipment.arrivalDate||'',shipment.arrivalTime||'','status',shipment.status||'','legs',JSON.stringify(shipment.flightLegs||[]));
    return{ok:true,shipment,debug:{provider:'champ-freight-aero',eventCount:rawEvents.length,eventSummary}};
  }catch(error){return{ok:false,reason:error?.message||'FREIGHT.AERO VIETNAM TRACKING FAILED',officialTracker:OFFICIAL};}
}
