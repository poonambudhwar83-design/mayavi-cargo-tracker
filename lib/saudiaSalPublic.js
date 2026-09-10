import { normalizeMawb } from './airlines.js';

const URL='https://sal.sa/trackshipment';
const API='https://sal.sa/TrackShipment/TrackingApi';
const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
const num=v=>{const n=Number(String(v??'').replace(/,/g,''));return Number.isFinite(n)?n:0};

function mapStatus(raw=''){
  const s=String(raw||'').toUpperCase();
  if(/DLV|DELIVER|ARRIVED|RECEIVED FROM FLIGHT/.test(s))return'ARRIVED';
  if(/DEPARTED|\bDEP\b|IN TRANSIT|MANIFEST|AIRBORNE/.test(s))return'IN TRANSIT';
  if(/DELAY|LATE|EXCEPTION/.test(s))return'DELAYED';
  if(/BOOKED|BKD|RCS|RECEIVED FROM SHIPPER/.test(s))return'BOOKED';
  return'TRACKING';
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
  if(typeof data==='string'){
    try{data=JSON.parse(data)}catch{return null;}
  }
  if(!data||typeof data!=='object')return null;
  const awb=clean(data.Awb||data.AWB||data.awb||'');
  if(awb&&awb.replace(/\D/g,'')!==mawb.replace(/\D/g,''))return null;

  const parts=Array.isArray(data.Parts)?data.Parts:[];
  const flat=walk(data);
  const origin=clean(data.Origin||pick(flat,['Origin','OriginCode','From'])).toUpperCase();
  const destination=clean(data.Destination||pick(flat,['Destination','DestinationCode','To'])).toUpperCase();
  const piecesRaw=data.TotalPieces??pick(flat,['TotalPieces','Pieces','NoOfPieces','PieceCount']);
  const weightRaw=data.TotalWeight??pick(flat,['TotalWeight','Weight','GrossWeight']);
  const volumeRaw=data.TotalVolume??pick(flat,['TotalVolume','Volume']);
  const pieces=num(piecesRaw);
  const weight=num(weightRaw);
  const volume=num(volumeRaw);
  const flightNo=clean(pick(flat,['FlightNumber','FlightNo','Flight'])).replace(/\s+/g,'').toUpperCase();
  const flightDate=clean(pick(flat,['FlightDate','DepartureDate']));
  const arrivalDate=clean(pick(flat,['ArrivalDate','ActualArrivalDate']));
  const arrivalTime=clean(pick(flat,['ArrivalTime','ActualArrivalTime']));
  const segmentNo=clean(pick(flat,['SegmentNumber','SegmentNo']));
  const airport=clean(pick(flat,['Airport','Station'])).toUpperCase();
  const sourceStatus=clean(pick(flat,['Status','StatusDescription','Event','EventDescription','MovementStatus']));

  const meaningful=Boolean(origin||destination||pieces>0||weight>0||volume>0||parts.length||flightNo||flightDate||arrivalDate||arrivalTime||sourceStatus);
  if(!meaningful)return null;

  return {
    mawb,
    carrierCode:'SV',
    airlineName:'Saudia Cargo',
    officialTracker:URL,
    origin,
    destination,
    pieces:pieces||'',
    bags:pieces||'',
    weight:weight||'',
    volume:volume||'',
    flightNo,
    flightDate,
    arrivalDate,
    arrivalTime,
    arrivalIsActual:Boolean(arrivalDate&&arrivalTime&&/ARRIVED|DELIVERED|RECEIVED FROM FLIGHT/i.test(sourceStatus)),
    segmentNo,
    airport,
    sourceStatus,
    status:mapStatus(sourceStatus),
    source:'SAL public shipment tracking'
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
    return{ok:true,shipment,officialTracker:URL,debug:{stage:'SAL_PUBLIC_SUCCESS'}};
  }catch(e){return{ok:false,reason:`SAL PUBLIC TRACKER ERROR: ${e?.message||e}`,officialTracker:URL,debug:{stage:'SAL_ERROR'}};}
}
