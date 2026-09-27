import { normalizeMawb } from './airlines.js';

const GUEST_API='https://tracking.one/api/guest/v1/shipments/air';
const OFFICIAL='https://www.turkishcargo.com/en/online-services/shipment-tracking';
const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
const pad=v=>String(v).padStart(2,'0');
const digits=v=>String(v??'').replace(/\D/g,'');

function dateISO(value=''){
  const s=clean(value).toUpperCase();
  let m=s.match(/\b(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})(?=\D|$)/);
  if(m)return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m=s.match(/\b(\d{1,2})[-\/.](\d{1,2})[-\/.](20\d{2})\b/);
  if(m)return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  return '';
}
function time24(value=''){
  const s=clean(value).toUpperCase();
  let m=s.match(/(?:^|[^0-9])(1[0-2]|0?\d):([0-5]\d)\s*(AM|PM)(?=\D|$)/);
  if(m){let h=Number(m[1]);if(m[3]==='PM'&&h<12)h+=12;if(m[3]==='AM'&&h===12)h=0;return `${pad(h)}:${m[2]}`;}
  m=s.match(/(?:^|[^0-9])([01]?\d|2[0-3]):([0-5]\d)(?=\D|$)/);
  return m?`${pad(m[1])}:${m[2]}`:'';
}
function airport(value=''){
  const m=clean(value).toUpperCase().match(/\b([A-Z]{3})\b/);
  return m?.[1]||'';
}
function numeric(value=''){
  return (clean(value).replace(/,/g,'').match(/\d+(?:\.\d+)?/)||[])[0]||'';
}
function tkFlight(value=''){
  const m=clean(value).toUpperCase().match(/\bTK\s*[- ]?0*(\d{1,4})\b/);
  return m?`TK${String(Number(m[1]))}`:'';
}
function statusFrom(value=''){
  const s=clean(value).toUpperCase().replace(/_/g,' ');
  if(/DELIVERED/.test(s))return'DELIVERED';
  if(/ARRIVED|LANDED|RECEIVED FROM FLIGHT|\bRCF\b/.test(s))return'ARRIVED';
  if(/DELAY|LATE|OFFLOAD|EXCEPTION/.test(s))return'DELAYED';
  if(/DEPARTED|AIRBORNE|IN TRANSIT|EN ROUTE|\bDEP\b/.test(s))return'IN TRANSIT';
  if(/BOOKED|ACCEPTED|MANIFESTED|\bRCS\b/.test(s))return'BOOKED';
  return'TRACKING';
}
function bookingDateFromHistory(shipment={}){
  const hits=[];
  const seen=new Set();
  const visit=(value,depth=0)=>{
    if(value===null||value===undefined||depth>8)return;
    if(Array.isArray(value)){for(const v of value)visit(v,depth+1);return;}
    if(typeof value!=='object'||seen.has(value))return;
    seen.add(value);
    const label=clean(value.status||value.event||value.eventType||value.type||value.code||value.description||value.name||value.milestone||value.action||'').toUpperCase().replace(/_/g,' ');
    if(/\bBKD\b|\bBOOK(?:ED|ING)\b|\bGOODS ACCEPTED\b|\bACCEPTED\b|\bRCS\b/.test(label)){
      const stamp=value.timestamp||value.eventTime||value.dateTime?.actual||value.dateTime?.estimated||value.dateTime?.scheduled||value.dateTime||value.datetime||value.occurredAt||value.createdAt||value.updatedAt||value.date||value.actual||value.estimated||value.scheduled||value.time||'';
      const d=dateISO(stamp);
      if(d)hits.push({date:d,rank:/\bBKD\b|\bBOOK(?:ED|ING)\b/.test(label)?0:1});
    }
    for(const v of Object.values(value))visit(v,depth+1);
  };
  visit(shipment);
  hits.sort((a,b)=>a.rank-b.rank||a.date.localeCompare(b.date));
  return hits[0]?.date||'';
}
function parseGuest(obj,mawb){
  const s=obj?.shipment;
  if(!s||typeof s!=='object')return null;
  const seg=Array.isArray(s.routeSegments)?[...s.routeSegments].sort((a,b)=>(+a.sequence||0)-(+b.sequence||0)):[];
  const first=seg[0]||{},last=seg[seg.length-1]||{};
  const origin=airport(s?.departure?.location||first?.departure?.location||'');
  const destination=airport(s?.arrival?.location||last?.arrival?.location||'');
  const finalSeg=[...seg].reverse().find(x=>airport(x?.arrival?.location||'')===destination)||last||first;
  const progressed=[...seg].reverse().find(x=>x?.departure?.actual||x?.arrival?.actual)||last||first;
  const via=seg.map(x=>airport(x?.arrival?.location||'')).find(x=>x&&x!==origin&&x!==destination)||'';
  const cargo=s?.cargo||finalSeg?.cargo||progressed?.cargo||first?.cargo||{};
  const pieces=numeric(cargo?.pieces);
  const weight=numeric(cargo?.weightKg??cargo?.weight);
  const finalTransport=finalSeg?.transport?.number||progressed?.transport?.number||first?.transport?.number||'';
  const flightNo=tkFlight(finalTransport);
  const arr=finalSeg?.arrival||s?.arrival||{};
  const dep=progressed?.departure||s?.departure||{};
  const ar=arr.actual||arr.estimated||arr.scheduled||'';
  const dr=dep.actual||dep.estimated||dep.scheduled||'';
  const bookingDate=dateISO(s.bookingDate||s.bookedAt||s.shipmentDate||s.createdAt||'')||bookingDateFromHistory(s);
  const status=statusFrom(s.status||'');
  const useful=Boolean((origin&&destination)||pieces||weight||flightNo||bookingDate||ar||status!=='TRACKING');
  if(!useful)return null;
  return {
    mawb,
    carrierCode:'TK',
    airlineName:'Turkish Cargo',
    officialTracker:OFFICIAL,
    origin,
    via:(via&&via!==origin&&via!==destination)?via:'',
    destination,
    pieces,
    bags:pieces,
    weight,
    flightNo,
    bookingDate,
    departureDate:dateISO(dr),
    departureTime:time24(dr),
    departureIsActual:Boolean(dep.actual),
    departureOrigin:airport(dep.location||progressed?.departure?.location||origin),
    departureDestination:airport(progressed?.arrival?.location||''),
    scheduledArrivalDate:dateISO(arr.scheduled||arr.estimated||''),
    scheduledArrivalTime:time24(arr.scheduled||arr.estimated||''),
    arrivalDate:dateISO(ar),
    arrivalTime:time24(ar),
    arrivalIsActual:Boolean(arr.actual),
    status,
    source:'Tracking One guest air-cargo tracking (Turkish fallback)'
  };
}

export async function trackTurkishTrackingOne(input){
  const mawb=normalizeMawb(input);
  if(!mawb||!mawb.startsWith('235-'))return{ok:false,reason:'INVALID TURKISH MAWB',officialTracker:OFFICIAL};
  const url=`${GUEST_API}?number=${encodeURIComponent(mawb)}&routePath=true`;
  try{
    const res=await fetch(url,{
      method:'GET',
      headers:{accept:'application/json,text/plain,*/*','user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36'},
      cache:'no-store',
      signal:AbortSignal.timeout(15000)
    });
    const body=await res.text();
    if(!res.ok)return{ok:false,reason:`TRACKING ONE TURKISH HTTP ${res.status}`,officialTracker:OFFICIAL,debug:{stage:'HTTP',status:res.status}};
    let obj=null;try{obj=JSON.parse(body)}catch{}
    if(!obj)return{ok:false,reason:'TRACKING ONE TURKISH INVALID JSON',officialTracker:OFFICIAL,debug:{stage:'BAD_JSON',sample:clean(body).slice(0,2000)}};
    const shipment=parseGuest(obj,mawb);
    if(!shipment)return{ok:false,reason:'TRACKING ONE RETURNED NO TURKISH SHIPMENT DATA',officialTracker:OFFICIAL,debug:{stage:'UNMAPPED',sample:clean(body).slice(0,5000)}};
    return{ok:true,shipment,officialTracker:OFFICIAL,debug:{stage:'TRACKING_ONE_DIRECT_JSON',url,status:res.status}};
  }catch(error){
    return{ok:false,reason:`TRACKING ONE TURKISH ERROR: ${error?.message||error}`,officialTracker:OFFICIAL,debug:{stage:'ERROR'}};
  }
}
