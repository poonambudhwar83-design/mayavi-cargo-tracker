// Saudia-only connection safeguard. Do not change the locked SAL chronology parsers.
// Cargo ARR at JED/RUH/DMM is not a confirmed ARR at the AWB's final destination.
const SAL_API='https://sal.sa/TrackShipment/TrackingApi';
const SAL_PAGE='https://sal.sa/trackshipment';
const code=v=>String(v??'').trim().toUpperCase();
const digits=v=>String(v??'').replace(/\D/g,'');
const num=v=>{const x=Number(v);return Number.isFinite(x)?x:0;};
const pad=v=>String(v).padStart(2,'0');
function salMoment(raw=''){
  const s=String(raw||'').trim();
  const m=s.match(/^(\d{1,2})\/(\d{1,2})\/(20\d{2})\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?/i);
  if(m){
    let h=Number(m[4]);const ap=code(m[6]);
    if(ap==='PM'&&h<12)h+=12;if(ap==='AM'&&h===12)h=0;
    return {epoch:Date.UTC(+m[3],+m[1]-1,+m[2],h,+m[5]),date:`${m[3]}-${pad(m[1])}-${pad(m[2])}`,time:`${pad(h)}:${m[5]}`};
  }
  const t=Date.parse(s);if(!Number.isFinite(t))return{epoch:0,date:'',time:''};
  const d=new Date(t);
  return{epoch:t,date:`${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`,time:`${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`};
}
function piecesAndWeight(event){
  return {pieces:num(event.Pieces),weight:num(event.Weight)};
}
function normalizeFlight(value=''){
  const m=code(value).replace(/\s+/g,'').match(/^(?:SV|SVA)?0*(\d{1,4}[A-Z]?)$/);
  return m?`SV${m[1]}`:'';
}
function clearUnverifiedDelhiArrival(input,reason){
  return {...input,arrivalDate:'',arrivalTime:'',scheduledArrivalDate:'',
    scheduledArrivalTime:'',arrivalIsActual:false,arrivalEstimate:false,
    arrivalVerifiedAbsent:true,finalArrivalPending:true,eta:'',
    arrivalTimeSource:reason};
}
export function applySaudiaConnectionGuard(shipment={},data=null){
  const s={...shipment};
  if(!digits(s.mawb).startsWith('065')||!data||typeof data!=='object')return s;
  if(data.Awb&&digits(data.Awb)!==digits(s.mawb))return s;
  const finalDestination=code(s.destination||data.Destination);
  if(!/^[A-Z]{3}$/.test(finalDestination))return s;
  const events=(Array.isArray(data.Parts)?data.Parts:[])
    .flatMap(p=>Array.isArray(p?.Events)?p.Events:[])
    .filter(Boolean)
    .map((event,index)=>({...event,_position:index,_moment:salMoment(event.DateTime_LT)}))
    .sort((a,b)=>a._moment.epoch-b._moment.epoch||a._position-b._position);
  const latest=events.at(-1);
  if(!latest)return s;
  const latestAirport=code(latest.Airport);
  const latestStatus=code(latest.Status);
  const finalArrivals=events.filter(e=>/^(ARR|DLV)$/.test(code(e.Status))&&code(e.Airport)===finalDestination);
  const confirmedFinalPieces=Number(s.arrivedPieces||0);
  // A dated ARR at a connection station is a real transit arrival, not Delhi ARR.
  if(latestStatus==='ARR'&&/^[A-Z]{3}$/.test(latestAirport)&&latestAirport!==finalDestination){
    const info=piecesAndWeight(latest);
    const flightNo=normalizeFlight(latest.Flight_Number)||s.flightNo||'';
    const movementDate=salMoment(latest.Flight_Date).date||latest._moment.date;
    let out={...s,status:confirmedFinalPieces>0?'PART ARRIVED':'IN TRANSIT',
      sourceStatus:'ARR',airport:latestAirport,currentLocation:latestAirport,
      transitAirport:latestAirport,transitArrivalDate:latest._moment.date,
      transitArrivalTime:latest._moment.time,transitArrivalTimeZone:'SAL LOCAL',
      finalArrivalPending:true,flightDestination:code(latest.Flight_Dest)||latestAirport,
      flightNo,remarks:confirmedFinalPieces>0?s.remarks||'':'Arrived at '+latestAirport+' (transit); '+finalDestination+' arrival pending',
      saudiaTransitVerified:true};
    if(confirmedFinalPieces===0&&!finalArrivals.length)
      out=clearUnverifiedDelhiArrival(out,'SAL confirmed ARR at '+latestAirport+' only; final '+finalDestination+' arrival not confirmed');
    // Replace stale earlier MAN/FOW rows for the same physical load. Keep genuine
    // destination-arrived portions and independent per-part Mail flags unchanged.
    if(info.pieces>0){
      const previous=Array.isArray(s.partShipments)?s.partShipments:[];
      const arrived=previous.filter(p=>p?.arrivalIsActual===true);
      const transit={partId:[flightNo,movementDate,info.pieces,info.weight].join('|'),
        partKey:[flightNo,movementDate,info.pieces,info.weight].join('|'),
        pieces:info.pieces,weight:info.weight,flightNo,flightDate:movementDate,
        flightDestination:latestAirport,transitAirport:latestAirport,
        transitArrivalDate:latest._moment.date,transitArrivalTime:latest._moment.time,
        arrivalDate:'',arrivalTime:'',arrivalIsActual:false,arrivalEstimate:false,
        totalPieces:num(s.totalPieces),totalWeight:num(s.totalWeight),
        status:'IN TRANSIT',sourceStatus:'ARR',
        remarks:'Arrived at '+latestAirport+' (transit) '+latest._moment.date+' '+latest._moment.time+' SAL local; final '+finalDestination+' arrival pending'};
      const room=Math.max(0,num(s.totalPieces)-confirmedFinalPieces-info.pieces);
      let remaining=room;
      const others=previous.filter(p=>p?.arrivalIsActual!==true&&
          !(normalizeFlight(p.flightNo)===flightNo&&num(p.pieces)===info.pieces))
        .filter(p=>{const count=num(p.pieces);if(count<=0||count>remaining)return false;remaining-=count;return true;});
      out.partShipments=[...arrived,transit,...others];
    }
    return out;
  }
  // SAL may expose DEP before its connection-station ARR card is released.
  // Such a JED-bound flight must never inherit a stale Delhi arrival clock.
  const legDestination=code(latest.Flight_Dest||s.flightDestination);
  if(confirmedFinalPieces===0&&!finalArrivals.length&&legDestination&&
     legDestination!==finalDestination&&/^(MAN|FOW|DEP)$/.test(latestStatus)){
    return {...clearUnverifiedDelhiArrival(s,'SAL flight '+(s.flightNo||'')+
      ' is bound for '+legDestination+', not final '+finalDestination),
      finalArrivalPending:true};
  }
  return s;
}
// The locked primary reader already records the flight's destination. If
// SAL's public API is temporarily unavailable, it is still unsafe to keep a
// Delhi ETA for a JED-bound operating flight.
export function guardSaudiaConnectingFlightWithoutSal(shipment={}){
  const s={...shipment};
  if(!digits(s.mawb).startsWith('065'))return s;
  const finalDestination=code(s.destination),legDestination=code(s.flightDestination);
  if(!finalDestination||!legDestination||finalDestination===legDestination||
     s.arrivalIsActual===true)return s;
  const arrivedPieces=num(s.arrivedPieces);
  const remainingPieces=Math.max(0,num(s.totalPieces)-arrivedPieces);
  if(!remainingPieces)return s;
  const currentFlight=normalizeFlight(s.flightNo);
  const history=Array.isArray(s.partLoadHistory)?s.partLoadHistory:[];
  const latestFlight=history.filter(h=>
    currentFlight&&normalizeFlight(h?.flightNo)===currentFlight&&
    num(h?.departed?.pieces)>0&&num(h?.departed?.pieces)<=remainingPieces).at(-1);
  const previous=Array.isArray(s.partShipments)?s.partShipments:[];
  const confirmedArrivals=previous.filter(p=>p?.arrivalIsActual===true);
  const existingPending=previous.find(p=>p?.arrivalIsActual!==true&&
    normalizeFlight(p?.flightNo)===currentFlight&&num(p?.pieces)===remainingPieces);
  let out={...s,finalArrivalPending:true};
  // Preserve the actual 49-piece DEL ARR (including its date, clock and Mail YES).
  // Clear a stale master DEL clock ONLY when no physical piece has reached DEL.
  if(!arrivedPieces)out=clearUnverifiedDelhiArrival(out,
    'Current flight bound for '+legDestination+'; '+finalDestination+' ETA unverified');
  if(arrivedPieces)out.status='PART ARRIVED';
  else if(/ARRIVED|LANDED|DESTINATION/i.test(code(out.status)))out.status='IN TRANSIT';
  if(!latestFlight)return out;
  const flightDate=salMoment(latestFlight.flightDate).date||
    (String(s.flightDate||'').match(/^20\d{2}-\d{2}-\d{2}/)||[])[0]||'';
  const weight=num(latestFlight.departed?.weight);
  const partId=[currentFlight,flightDate,remainingPieces,weight].join('|');
  const pending={...existingPending,partId,partKey:partId,
    pieces:remainingPieces,weight:weight||num(existingPending?.weight),
    flightNo:currentFlight,flightDate,
    flightDestination:legDestination,transitAirport:legDestination,
    totalPieces:num(s.totalPieces),totalWeight:num(s.totalWeight),
    arrivalDate:'',arrivalTime:'',arrivalIsActual:false,arrivalEstimate:false,
    status:'IN TRANSIT',sourceStatus:'DEP',
    remarks:'Departed on '+currentFlight+' towards '+legDestination+
      '; '+finalDestination+' arrival pending'};
  out.partShipments=[...confirmedArrivals,pending];
  out.partLoad=true;
  out.isPartLoad=arrivedPieces>0;
  return out;
}
export async function guardSaudiaFromLatestSal(mawb,shipment={}){
  const s={...shipment,mawb};
  if(!digits(mawb).startsWith('065'))return s;
  const safeFallback=guardSaudiaConnectingFlightWithoutSal(s);
  try{
    const url=`${SAL_API}?trackId=${encodeURIComponent(mawb)}&CurrentCulture=en-us`;
    const response=await fetch(url,{headers:{Accept:'application/json',Referer:SAL_PAGE},cache:'no-store',signal:AbortSignal.timeout(9000)});
    if(!response.ok)return safeFallback;
    const outer=await response.json();
    let data=outer?.message;
    if(typeof data==='string')data=JSON.parse(data);
    if(!data||typeof data!=='object')return safeFallback;
    return applySaudiaConnectionGuard(safeFallback,data);
  }catch{return safeFallback;}
}
