const ENDPOINT='https://api.trackingmore.com/v2/trackings/aircargo';

const clean=v=>String(v??'').trim();
const numberOnly=v=>{const m=clean(v).match(/[\d,.]+/);return m?m[0].replace(/,/g,''):''};

function dateTime(v=''){
  const s=clean(v); if(!s)return{date:'',time:''};
  let m=s.match(/(20\d{2})[-\/]([01]\d)[-\/]([0-3]\d)[ T](\d{1,2}):(\d{2})/);
  if(m)return{date:`${m[1]}-${m[2]}-${m[3]}`,time:`${String(m[4]).padStart(2,'0')}:${m[5]}`};
  m=s.match(/([0-3]?\d)[-\/]([01]?\d)[-\/](20\d{2})[ T](\d{1,2}):(\d{2})/);
  if(m)return{date:`${m[3]}-${String(m[2]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`,time:`${String(m[4]).padStart(2,'0')}:${m[5]}`};
  return{date:'',time:''};
}

function statusFrom(v=''){
  const s=clean(v).toUpperCase();
  if(/\bDLV\b|DELIVER/.test(s))return'DELIVERED';
  if(/\bNFD\b|NOTIFIED/.test(s))return'NOTIFIED CONSIGNEE';
  if(/\bRCF\b|RECEIVED AT DESTINATION/.test(s))return'RECEIVED AT DESTINATION';
  if(/\bARR\b|ARRIV|LANDED/.test(s))return'ARRIVED';
  if(/DELAY|LATE|EXCEPTION/.test(s))return'DELAYED';
  if(/\bDEP\b|DEPART|TRANSIT|AIRBORNE|IN FLIGHT/.test(s))return'IN TRANSIT';
  if(/\bRCS\b|ACCEPT|BOOK|MANIFEST|\bMAN\b/.test(s))return'BOOKED';
  return s||'TRACKING';
}

function chooseFlight(returnData={}){
  const flights=returnData.flight_info&&typeof returnData.flight_info==='object'?Object.entries(returnData.flight_info):[];
  if(!flights.length)return{flightNo:'',arrival:{date:'',time:''},actual:false};
  const scored=flights.map(([flightNo,f={}])=>{
    const actual=dateTime(f.arrival_time||f.actual_arrival_time||f.actualArrivalTime||'');
    const planned=dateTime(f.plan_arrival_time||f.estimated_arrival_time||f.scheduled_arrival_time||f.planArrivalTime||'');
    const raw=f.arrival_time||f.plan_arrival_time||f.depart_time||f.plan_depart_time||'';
    const ts=Date.parse(String(raw).replace(' ','T'))||0;
    return{flightNo,arrival:actual.date?actual:planned,actual:Boolean(actual.date),ts};
  }).sort((a,b)=>b.ts-a.ts);
  return flights.length?scored[0]:{flightNo:'',arrival:{date:'',time:''},actual:false};
}

function chooseEvent(returnData={}){
  const events=Array.isArray(returnData.track_info)?returnData.track_info:[];
  if(!events.length)return null;
  const sorted=[...events].sort((a,b)=>{
    const ta=Date.parse(String(a.actual_date||a.plan_date||'').replace(' ','T'))||0;
    const tb=Date.parse(String(b.actual_date||b.plan_date||'').replace(' ','T'))||0;
    return tb-ta;
  });
  return sorted[0]||null;
}

function parsePayload(json,mawb,airline){
  const data=json?.data||{};
  const node=data[mawb]||data[mawb.replace('-','')]||Object.values(data)[0];
  const rd=node?.return_data||node?.returnData||node?.data||null;
  if(!rd)return null;
  const event=chooseEvent(rd);
  const flight=chooseFlight(rd);
  let arrival=flight.arrival,arrivalIsActual=flight.actual;
  if(!arrival.date&&event){
    const actual=dateTime(event.actual_date||event.actualDate||'');
    const planned=dateTime(event.plan_date||event.planDate||'');
    arrival=actual.date?actual:planned;arrivalIsActual=Boolean(actual.date);
  }
  const rawStatus=event?.status||event?.event||rd.last_event||rd.status||'';
  const flightNo=clean(event?.flight_number||event?.flightNumber||flight.flightNo);
  return{
    mawb,
    carrierCode:airline?.iata||'',
    airlineName:node?.airline_info?.name?.trim()||airline?.name||'',
    origin:clean(rd.origin||rd.origin_code||rd.from),
    destination:clean(rd.destination||rd.destination_code||rd.to),
    bags:clean(rd.piece||rd.pieces||rd.total_piece||rd.totalPieces),
    pieces:clean(rd.piece||rd.pieces||rd.total_piece||rd.totalPieces),
    weight:numberOnly(rd.weight||rd.gross_weight||rd.grossWeight),
    flightNo,
    arrivalDate:arrival.date,
    arrivalTime:arrival.time,
    arrivalIsActual,
    status:statusFrom(rawStatus),
    officialTracker:node?.airline_info?.track_url||airline?.url||'',
    source:'TrackingMore Air Cargo API fallback'
  };
}

export async function trackWithTrackingMore(mawb,airline){
  const key=process.env.TRACKINGMORE_API_KEY;
  if(!key)return{ok:false,skipped:true,reason:'TRACKINGMORE API KEY NOT CONFIGURED'};
  try{
    const response=await fetch(ENDPOINT,{
      method:'POST',
      headers:{'content-type':'application/json','Trackingmore-Api-Key':key},
      body:JSON.stringify({track_number:mawb}),
      signal:AbortSignal.timeout(20000),
      cache:'no-store'
    });
    const text=await response.text();
    let json=null;try{json=JSON.parse(text)}catch{}
    if(!response.ok)return{ok:false,reason:`TRACKINGMORE HTTP ${response.status}`,debug:{status:response.status,preview:text.slice(0,300)}};
    if(json?.meta?.code&&Number(json.meta.code)!==200)return{ok:false,reason:json?.meta?.message||`TRACKINGMORE CODE ${json.meta.code}`,debug:{code:json.meta.code}};
    const shipment=parsePayload(json,mawb,airline);
    if(!shipment)return{ok:false,reason:'TRACKINGMORE RETURNED NO AIR CARGO DATA'};
    const useful=Boolean((shipment.origin&&shipment.destination)||shipment.pieces||shipment.weight||shipment.flightNo||shipment.arrivalDate||(shipment.status&&shipment.status!=='TRACKING'));
    if(!useful)return{ok:false,reason:'TRACKINGMORE RETURNED NO VERIFIED SHIPMENT FIELDS'};
    return{ok:true,shipment,debug:{provider:'trackingmore-aircargo'}};
  }catch(error){return{ok:false,reason:error?.message||'TRACKINGMORE REQUEST FAILED'};}
}
