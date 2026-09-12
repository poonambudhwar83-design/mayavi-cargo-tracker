import { normalizeMawb } from './airlines.js';

const URL='https://sal.sa/trackshipment';
const API='https://sal.sa/TrackShipment/TrackingApi';
const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
const num=v=>{const n=Number(String(v??'').replace(/,/g,''));return Number.isFinite(n)?n:0};
const pad=v=>String(v).padStart(2,'0');

function normalizeSvFlight(value=''){
  const raw=clean(value).toUpperCase().replace(/\s+/g,'');
  if(!raw)return'';
  const m=raw.match(/^(?:SV|SVA)?0*(\d{1,4}[A-Z]?)$/);
  if(m)return`SV${m[1]}`;
  return /^SV\d{1,4}[A-Z]?$/.test(raw)?raw:'';
}

function mapStatus(raw='',airport='',destination=''){
  const s=String(raw||'').toUpperCase();
  const dest=clean(destination).toUpperCase();
  const atDest=clean(airport).toUpperCase()===dest&&Boolean(dest);
  const arrivalLike=/\bDLV\b|DELIVER|\bARR\b|ARRIVED|RECEIVED FROM FLIGHT/.test(s);
  if(arrivalLike)return(atDest||!dest)?'ARRIVED':'IN TRANSIT';
  if(atDest&&/\bRCF\b|\bFIW\b/.test(s))return'ARRIVED';
  if(/DEPARTED|\bDEP\b|IN TRANSIT|MANIFEST|\bMAN\b|\bFOW\b|\bFIW\b|\bRCF\b|AIRBORNE/.test(s))return'IN TRANSIT';
  if(/DELAY|LATE|EXCEPTION|\bDIS\b/.test(s))return'DELAYED';
  if(/BOOKED|BKD|RCS|RECEIVED FROM SHIPPER|READY FOR CARRIAGE/.test(s))return'BOOKED';
  return'TRACKING';
}

function normalizeDateOnly(value=''){
  const s=clean(value); if(!s)return'';
  let m=s.match(/\b(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})\b/);
  if(m)return`${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m=s.match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](20\d{2})\b/);
  if(m)return`${m[3]}-${pad(m[1])}-${pad(m[2])}`;
  return'';
}

function normalizeTimeOnly(value=''){
  const s=clean(value); if(!s)return'';
  const m=s.match(/\b(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?\b/i);
  if(!m)return'';
  let h=Number(m[1]); const ap=String(m[3]||'').toUpperCase();
  if(ap==='PM'&&h<12)h+=12; if(ap==='AM'&&h===12)h=0;
  return`${pad(h)}:${m[2]}`;
}

function eventEpoch(value=''){
  const s=clean(value); if(!s)return 0;
  const m=s.match(/^(\d{1,2})\/(\d{1,2})\/(20\d{2})\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i);
  if(m){
    let h=Number(m[4]); const ap=String(m[6]||'').toUpperCase();
    if(ap==='PM'&&h<12)h+=12; if(ap==='AM'&&h===12)h=0;
    return Date.UTC(Number(m[3]),Number(m[1])-1,Number(m[2]),h,Number(m[5]));
  }
  const t=Date.parse(s); return Number.isFinite(t)?t:0;
}

function walk(value,path='',out=[]){
  if(Array.isArray(value)){value.forEach((v,i)=>walk(v,`${path}[${i}]`,out));return out;}
  if(value&&typeof value==='object'){for(const [k,v] of Object.entries(value))walk(v,path?`${path}.${k}`:k,out);return out;}
  out.push({path,key:path.split('.').pop()?.replace(/\[\d+\]$/,'')||'',value});return out;
}

function pick(flat,keys){
  const wanted=keys.map(k=>k.toLowerCase().replace(/[^a-z0-9]/g,''));
  for(const item of flat){const key=String(item.key||'').toLowerCase().replace(/[^a-z0-9]/g,'');if(wanted.includes(key)&&clean(item.value)!=='')return clean(item.value);}
  return'';
}

function parseMessage(outer,mawb){
  let data=outer?.message;
  if(typeof data==='string'){try{data=JSON.parse(data)}catch{return null;}}
  if(!data||typeof data!=='object')return null;
  const awb=clean(data.Awb||data.AWB||data.awb||'');
  if(awb&&awb.replace(/\D/g,'')!==mawb.replace(/\D/g,''))return null;

  const parts=Array.isArray(data.Parts)?data.Parts:[];
  const events=parts.flatMap(p=>Array.isArray(p?.Events)?p.Events:[]).filter(Boolean);
  const ordered=[...events].sort((a,b)=>eventEpoch(a?.DateTime_LT)-eventEpoch(b?.DateTime_LT));
  const latestEvent=ordered.at(-1)||null;
  const flat=walk(data);
  const origin=clean(data.Origin||pick(flat,['Origin','OriginCode','From'])).toUpperCase();
  const destination=clean(data.Destination||pick(flat,['Destination','DestinationCode','To'])).toUpperCase();
  const totalPieces=num(data.TotalPieces??pick(flat,['TotalPieces','Pieces','NoOfPieces','PieceCount']));
  const totalWeight=num(data.TotalWeight??pick(flat,['TotalWeight','Weight','GrossWeight']));
  const volume=num(data.TotalVolume??pick(flat,['TotalVolume','Volume']));

  const finalLegEvents=ordered.filter(e=>clean(e?.Flight_Dest).toUpperCase()===destination);
  const destinationArrivals=ordered.filter(e=>/^(ARR|DLV)$/i.test(clean(e?.Status))&&clean(e?.Airport).toUpperCase()===destination);
  const uniqueArrivals=[]; const seenArrivals=new Set();
  for(const e of destinationArrivals){
    const key=[clean(e?.DateTime_LT),clean(e?.Flight_Number),clean(e?.Pieces),clean(e?.Weight),clean(e?.Airport)].join('|');
    if(seenArrivals.has(key))continue; seenArrivals.add(key); uniqueArrivals.push(e);
  }
  const arrivedPieces=Math.min(totalPieces||Infinity,uniqueArrivals.reduce((sum,e)=>sum+num(e?.Pieces),0));
  const arrivedWeight=Math.min(totalWeight||Infinity,uniqueArrivals.reduce((sum,e)=>sum+num(e?.Weight),0));
  const pendingPieces=totalPieces?Math.max(totalPieces-arrivedPieces,0):0;
  const pendingWeight=totalWeight?Math.max(totalWeight-arrivedWeight,0):0;
  const finalArrival=uniqueArrivals.at(-1)||null;
  const finalFlightEvents=finalLegEvents.filter(e=>normalizeSvFlight(e?.Flight_Number));
  const latestFinalFlight=finalFlightEvents.at(-1)||null;
  const latestFinalStatus=clean(latestFinalFlight?.Status).toUpperCase();
  const latestFinalIsActive=/^(MAN|FOW|DEP)$/.test(latestFinalStatus)&&eventEpoch(latestFinalFlight?.DateTime_LT)>eventEpoch(finalArrival?.DateTime_LT);
  const finalFlightEvent=[...finalFlightEvents].reverse().find(e=>/^(ARR|DLV|DEP|RCF|FIW|FOW|MAN)$/i.test(clean(e?.Status)))||latestFinalFlight;
  const latestKnownFlight=[...ordered].reverse().find(e=>normalizeSvFlight(e?.Flight_Number))||null;
  const selectedFlight=latestFinalIsActive?latestFinalFlight:((finalArrival&&normalizeSvFlight(finalArrival?.Flight_Number)?finalArrival:null)||finalFlightEvent||latestKnownFlight);

  const acceptance=ordered.find(e=>/^(RCS|BKD)$/i.test(clean(e?.Status))||/accepted|ready for carriage|received from shipper/i.test(`${clean(e?.Message)} ${clean(e?.Remarks)}`))||null;
  const bookingDate=normalizeDateOnly(acceptance?.DateTime_LT||'');
  const bookingTime=normalizeTimeOnly(acceptance?.DateTime_LT||'');
  const eventFlight=normalizeSvFlight(selectedFlight?.Flight_Number||'');
  const fallbackFlight=events.length?'':normalizeSvFlight(pick(flat,['FlightNumber','FlightNo','Flight']));
  const flightNo=eventFlight||fallbackFlight;
  const flightDate=clean(selectedFlight?.Flight_Date||(!events.length?pick(flat,['FlightDate','DepartureDate']):''));

  let arrivalDate='';
  let arrivalTime='';
  let arrivalIsActual=false;
  let arrivalTimeSource='';
  if(latestFinalIsActive){
    arrivalDate=normalizeDateOnly(selectedFlight?.Flight_Date||selectedFlight?.DateTime_LT||'');
    const historicalSameFlight=[...destinationArrivals].reverse().find(e=>normalizeSvFlight(e?.Flight_Number)===flightNo&&eventEpoch(e?.DateTime_LT)<eventEpoch(selectedFlight?.DateTime_LT));
    arrivalTime=normalizeTimeOnly(historicalSameFlight?.DateTime_LT||'');
    if(arrivalTime)arrivalTimeSource='destination ARR/DLV event';
  }else if(finalArrival){
    arrivalDate=normalizeDateOnly(finalArrival.DateTime_LT);
    arrivalTime=normalizeTimeOnly(finalArrival.DateTime_LT);
    if(arrivalTime)arrivalTimeSource='destination ARR/DLV event';
    arrivalIsActual=true;
  }

  const sourceStatus=clean((latestFinalIsActive?latestFinalFlight:latestEvent)?.Status||pick(flat,['Status','StatusDescription','Event','EventDescription','MovementStatus']));
  const airport=clean((latestFinalIsActive?latestFinalFlight:latestEvent)?.Airport||pick(flat,['Airport','Station'])).toUpperCase();
  const isPartArrived=Boolean(totalPieces>0&&arrivedPieces>0&&arrivedPieces<totalPieces);
  const isFullyArrived=Boolean(totalPieces>0&&arrivedPieces>=totalPieces);
  const pieces=latestFinalIsActive&&isPartArrived?`${arrivedPieces}+${pendingPieces}`:isPartArrived?`${arrivedPieces}/${totalPieces}`:(totalPieces||'');
  const weight=latestFinalIsActive&&isPartArrived&&totalWeight?`${arrivedWeight}+${pendingWeight}`:isPartArrived&&totalWeight?`${arrivedWeight}/${totalWeight}`:(totalWeight||'');
  const status=latestFinalIsActive?'IN TRANSIT':isPartArrived?'PART ARRIVED':isFullyArrived?'ARRIVED':mapStatus(sourceStatus,airport,destination);

  const meaningful=Boolean(origin||destination||totalPieces||totalWeight||volume||events.length||flightNo||flightDate||arrivalDate||arrivalTime||sourceStatus||bookingDate);
  if(!meaningful)return null;

  return {
    mawb,carrierCode:'SV',airlineName:'Saudia Cargo',officialTracker:URL,
    origin,destination,pieces,bags:pieces,weight,volume:volume||'',
    totalPieces:totalPieces||'',arrivedPieces:arrivedPieces||'',pendingPieces,
    totalWeight:totalWeight||'',arrivedWeight:arrivedWeight||'',pendingWeight,
    isPartLoad:isPartArrived,
    flightNo,flightDate,bookingDate,bookingTime,
    bookingDateSource:bookingDate?'SAL RCS/acceptance event':'',
    arrivalDate,arrivalTime,arrivalTimeSource,arrivalIsActual,
    latestEventDateTime:clean((latestFinalIsActive?latestFinalFlight:finalArrival||latestEvent)?.DateTime_LT||''),
    airport,sourceStatus,status,source:'SAL public shipment tracking'
  };
}

export async function trackSaudiaViaSal(input){
  const mawb=normalizeMawb(input);
  if(!mawb||!mawb.startsWith('065-'))return{ok:false,reason:'INVALID SAUDIA MAWB',officialTracker:URL};
  try{
    const endpoint=`${API}?trackId=${encodeURIComponent(mawb)}&CurrentCulture=en-us`;
    const res=await fetch(endpoint,{headers:{Accept:'application/json','Accept-Language':'en-US,en;q=0.9',Referer:URL},cache:'no-store'});
    const text=await res.text();
    let outer;try{outer=JSON.parse(text)}catch{return{ok:false,reason:`SAL PUBLIC TRACKER RETURNED HTTP ${res.status} NON-JSON`,officialTracker:URL,debug:{stage:'SAL_NON_JSON',sample:text.slice(0,1200)}};}
    if(!res.ok||outer?.success===false)return{ok:false,reason:'SAL PUBLIC TRACKER DID NOT RETURN SHIPMENT DATA',officialTracker:URL,debug:{stage:'SAL_HTTP_NO_DATA',status:res.status,sample:text.slice(0,1200)}};
    const shipment=parseMessage(outer,mawb);
    if(!shipment)return{ok:false,reason:'SAL HAS NO OPERATIONAL DATA FOR THIS AWB',officialTracker:URL,debug:{stage:'SAL_EMPTY_AWB',status:res.status,sample:text.slice(0,1600)}};
    return{ok:true,shipment,officialTracker:URL,debug:{stage:'SAL_PUBLIC_SUCCESS',sample:text.slice(0,5000)}};
  }catch(e){return{ok:false,reason:`SAL PUBLIC TRACKER ERROR: ${e?.message||e}`,officialTracker:URL,debug:{stage:'SAL_ERROR'}};}
}
