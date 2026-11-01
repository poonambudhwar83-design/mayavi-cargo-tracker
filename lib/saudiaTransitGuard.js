import { normalizeShipmentTimesToIst } from './exportIst.js';
import { normalizeSalFlightDate } from './saudiaFlightDate.js';
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
  // Preserve completed SAL physical reconciliation. The latest flight may
  // carry only 8/121 bags: rebuilding a 121-bag virtual row from its 188.4 kg
  // would hide the other 113-bag, 2661.6 kg receipt. Once actual physical
  // parts reconstruct the full master, NO history-only fallback may replace
  // those parts with a single flight's departed quantity.
  const grossPieces=num(s.totalPieces);
  const grossWeight=num(s.totalWeight);
  const physical=previous.filter(p=>num(p?.pieces)>0&&num(p?.weight)>0);
  const accountedPieces=physical.reduce((sum,p)=>sum+num(p.pieces),0);
  const accountedWeight=physical.reduce((sum,p)=>sum+num(p.weight),0);
  const completePhysical=physical.length>1&&grossPieces>0&&
    accountedPieces===grossPieces&&
    (grossWeight<=0||Math.abs(accountedWeight-grossWeight)<0.5);
  if(completePhysical){
    // JED RCF/receipts are transit movement, not DEL cargo arrival.
    if(!arrivedPieces&&physical.every(p=>code(p.sourceStatus)==='RCF'&&
      code(p.transitAirport||p.flightDestination)===legDestination))
      out.status='IN TRANSIT';
    return out;
  }
  if(!latestFlight)return out;
  const departedPieces=num(latestFlight.departed?.pieces);
  const departedWeight=num(latestFlight.departed?.weight);
  const outstandingWeight=Math.max(0,grossWeight-num(s.arrivedWeight));
  // Reconstruct only when the latest physical flight actually covers the
  // ENTIRE outstanding balance, in both bags and weight.
  if(departedPieces!==remainingPieces||
     (outstandingWeight>0&&departedWeight>0&&
      Math.abs(departedWeight-outstandingWeight)>0.5))return out;
  // Any different known unarrived physical part must stay independent.
  if(previous.some(p=>p?.arrivalIsActual!==true&&num(p.pieces)>0&&
       (normalizeFlight(p.flightNo)!==currentFlight||num(p.pieces)!==departedPieces)))
    return out;
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
export async function guardSaudiaFromLatestSal(mawb,shipment={},options={}){
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
    const located=applySaudiaConnectionGuard(safeFallback,data);
    return await planSaudiaDelhiPreArrival(located,data,options);
  }catch{return safeFallback;}
}

/**
 * Upcoming Delhi arrival is a different business question from an actual SAL ARR.
 * Only a dated AWB-matched MAN/FOW/DEP with Flight_Dest=DEL may create a
 * prospective DEL flight, and only a matched flight schedule/ETA may create a
 * six-hour-before-arrival Mail deadline. A hub ARR never supplies this clock.
 */
export async function planSaudiaDelhiPreArrival(shipment={},data=null,{flightSchedule=null}={}){
  const s={...shipment};
  if(!digits(s.mawb).startsWith('065')||!data||typeof data!=='object')return s;
  if(data.Awb&&digits(data.Awb)!==digits(s.mawb))return s;
  const final=code(s.destination||data.Destination);
  if(!/^[A-Z]{3}$/.test(final))return s;
  const arrivedPieces=num(s.arrivedPieces);
  const totalPieces=num(s.totalPieces||data.TotalPieces);
  const remainingPieces=Math.max(0,totalPieces-arrivedPieces);
  if(!remainingPieces)return s;
  const raw=(Array.isArray(data.Parts)?data.Parts:[])
    .flatMap(p=>Array.isArray(p?.Events)?p.Events:[])
    .filter(Boolean)
    .map((event,index)=>({...event,_index:index,_moment:salMoment(event.DateTime_LT)}))
    .sort((a,b)=>a._moment.epoch-b._moment.epoch||a._index-b._index);
  // A final-flight manifestation that happened before this same physical load
  // reached JED is stale and must not be reused as today's arrival forecast.
  const latestHubArrival=raw.filter(e=>code(e.Status)==='ARR'
    &&code(e.Airport)!==final&&num(e.Pieces)>0)
    .sort((a,b)=>b._moment.epoch-a._moment.epoch)[0];
  const cancelled=(candidate)=>raw.some(e=>
    /^(DIS|DUS)$/.test(code(e.Status))&&e._moment.epoch>=candidate._moment.epoch
    &&(!normalizeFlight(e.Flight_Number)||normalizeFlight(e.Flight_Number)===normalizeFlight(candidate.Flight_Number))
    &&(!num(e.Pieces)||num(e.Pieces)===num(candidate.Pieces)));
  const candidates=raw.filter(e=>
    /^(MAN|FOW|DEP)$/.test(code(e.Status))&&code(e.Flight_Dest)===final
    &&normalizeFlight(e.Flight_Number)&&salMoment(e.Flight_Date).date
    &&num(e.Pieces)>0&&num(e.Pieces)<=remainingPieces
    &&!cancelled(e)
    &&(!latestHubArrival||num(e.Pieces)!==num(latestHubArrival.Pieces)
       ||e._moment.epoch>latestHubArrival._moment.epoch
       // The connection can be pre-manifested before JED receives the cargo.
       // A later operating date is still legitimate advanced notice.
       ||salMoment(e.Flight_Date).date>latestHubArrival._moment.date)
  );
  if(!candidates.length)return s;
  const chosen=candidates.at(-1);
  const flightNo=normalizeFlight(chosen.Flight_Number);
  const flightDate=salMoment(chosen.Flight_Date).date;
  const pieces=num(chosen.Pieces),weight=num(chosen.Weight);
  const departureAirport=code(chosen.Flight_Origin)||code(chosen.Airport)||'';
  const evidence=code(chosen.Status);
  const canEstimate=evidence==='FOW'||evidence==='DEP';
  let etaDate='',etaTime='',etaSource='';
  const planned=salMoment(chosen.Scheduled_Arrival||chosen.ScheduledArrival
    ||chosen.Estimated_Arrival||chosen.EstimatedArrival||chosen.ETA||'');
  if(canEstimate&&planned.date&&planned.time){
    const ist=normalizeShipmentTimesToIst({
      destination:final,arrivalDate:planned.date,arrivalTime:planned.time,
      arrivalTimeZone:'LOCAL',
      arrivalTimeSource:'SAL dated final '+final+' flight published ETA'
    });
    etaDate=ist.arrivalDate||'';etaTime=ist.arrivalTime||'';
    etaSource='SAL dated final '+final+' flight ETA (not cargo ARR)';
  }
  // No hard-coded SV760 17:00 fallback and no unrelated saved master ETA.
  if(canEstimate&&!etaTime&&typeof flightSchedule==='function'){
    try{
      const flight=await flightSchedule({flightNo,date:flightDate,
        origin:departureAirport,destination:final});
      const reportedDest=code(flight?.departureDestination);
      const reportedOrigin=code(flight?.departureOrigin);
      const reportedFlight=normalizeFlight(flight?.flightNo);
      const reportedDate=salMoment(flight?.departureDate||flight?.flightDate).date;
      const routeMatches=(!reportedDest||reportedDest===final)
        &&(!reportedOrigin||!departureAirport||reportedOrigin===departureAirport)
        &&(!reportedDate||reportedDate===flightDate)
        &&(!reportedFlight||reportedFlight===flightNo);
      const time=flight?.arrivalTime||flight?.scheduledArrivalTime||'';
      const date=flight?.arrivalDate||flight?.scheduledArrivalDate||'';
      if(flight?.ok&&routeMatches&&date&&/^([01]\d|2[0-3]):[0-5]\d$/.test(time)){
        const ist=normalizeShipmentTimesToIst({
          destination:final,arrivalDate:date,arrivalTime:time,
          arrivalTimeZone:flight.arrivalTimeZone||flight.scheduledArrivalTimeZone||'LOCAL',
          arrivalTimeSource:flight.arrivalTimeSource||flight.source||'Dated flight schedule'
        });
        if(ist.arrivalDate&&ist.arrivalTime){
          etaDate=ist.arrivalDate;etaTime=ist.arrivalTime;
          etaSource='Verified dated '+flightNo+' '+final+' flight ETA (not cargo ARR)';
        }
      }
    }catch{}
  }
  const previous=Array.isArray(s.partShipments)?s.partShipments:[];
  const arrived=previous.filter(p=>p?.arrivalIsActual===true);
  const former=previous.find(p=>p?.arrivalIsActual!==true
    &&num(p.pieces)===pieces&&Math.abs(num(p.weight)-weight)<1);
  const partId=[flightNo,flightDate,pieces,weight].join('|');
  const pending={
    ...former,partId,partKey:partId,pieces,weight,flightNo,flightDate,
    flightOrigin:departureAirport,flightDestination:final,
    transitAirport:'',transitArrivalDate:'',transitArrivalTime:'',
    totalPieces,totalWeight:num(s.totalWeight||data.TotalWeight),
    arrivalDate:etaTime?etaDate:'',arrivalTime:etaTime,
    arrivalTimeZone:'IST',arrivalEstimate:Boolean(etaTime),arrivalIsActual:false,
    arrivalTimeSource:etaSource,status:evidence==='DEP'?'DEPARTED':evidence==='FOW'?'IN TRANSIT':'BOOKED',
    saudiaArrivalStage:evidence==='DEP'?'CONFIRMED_ETA':evidence==='FOW'?'ESTIMATED':'PLANNED',
    sourceStatus:evidence,
    remarks:evidence==='MAN'
      ?'SAL MANIFESTED: '+flightNo+' to '+final+'; '+(etaTime?'planned ETA, not actual arrival':'ETA time pending')
      :evidence==='FOW'
      ?'SAL FOW: loaded on '+flightNo+' to '+final+'; '+(etaTime?'ETA pending actual arrival':'ETA time pending')
      :'SAL DEP: '+flightNo+' departed for '+final+'; '+(etaTime?'planned ETA, not actual arrival':'ETA time pending')
  };
  // A newly assigned final flight gets its own Mail YES/NO. Never carry the
  // transit-leg decision to a different flight or part.
  if(!former||normalizeFlight(former.flightNo)!==flightNo||
      String(former.flightDate||'')!==flightDate){
    pending.mailSent=false;pending.mailUpdatedAt='';
  }
  const leftover=Math.max(0,remainingPieces-pieces);
  let capacity=leftover;
  const otherPending=previous.filter(p=>p?.arrivalIsActual!==true
    &&!(num(p.pieces)===pieces&&Math.abs(num(p.weight)-weight)<1))
    .filter(p=>{const q=num(p.pieces);if(!q||q>capacity)return false;capacity-=q;return true;});
  const parts=[...arrived,pending,...otherPending];
  return {...s,
    partShipments:parts,partLoad:parts.length>1||pieces<totalPieces,
    isPartLoad:arrivedPieces>0&&arrivedPieces<totalPieces,
    status:arrivedPieces>0?'PART ARRIVED':pending.status,
    flightNo,flightDate,flightDestination:final,
    finalFlightNo:flightNo,finalFlightDate:flightDate,finalFlightDestination:final,
    finalFlightSourceStatus:evidence,finalArrivalPending:true,
    saudiaPreArrivalVerified:true,
    saudiaArrivalStage:evidence==='DEP'?'CONFIRMED_ETA':evidence==='FOW'?'ESTIMATED':'PLANNED',
    // Do not replace the actual Delhi arrival clock of a previously delivered
    // part with this upcoming part's ETA; the dashboard uses each part's ETA.
    ...(arrivedPieces>0?{}:{
      arrivalDate:pending.arrivalDate,arrivalTime:pending.arrivalTime,
      scheduledArrivalDate:pending.arrivalDate,scheduledArrivalTime:pending.arrivalTime,
      arrivalEstimate:pending.arrivalEstimate,arrivalIsActual:false,
      arrivalVerifiedAbsent:!pending.arrivalTime,
      arrivalTimeZone:'IST',arrivalTimeSource:etaSource,
      eta:pending.arrivalDate&&pending.arrivalTime
        ?pending.arrivalDate+'T'+pending.arrivalTime+':00':null
    })
  };
}


/**
 * Final Saudia cargo-arrival evidence gate.
 * SAL RCS/BKD/MAN are only planning states: a flight's historical landing
 * must never fill an AWB's Arrival Date, Arrival Time or Mail Time.
 * SAL FOW = estimated final-flight ETA; SAL DEP = departed-flight confirmed ETA.
 * Only SAL final-destination ARR/DLV is actual cargo arrival.
 * Pure and browser-safe, so both the tracking endpoint and saved dashboard
 * enforce the same rule. Other airlines are completely untouched.
 */
export function enforceSaudiaArrivalEvidence(shipment={}){
  const s={...shipment};
  if(!digits(s.mawb||s.awb).startsWith('065'))return s;
  const final=code(s.destination);
  const masterCode=code(s.finalFlightSourceStatus||s.sourceStatus||s.latestEventCode);
  // Clear an old RCS flight timetable immediately when SAL advances to a
  // physical FOW/DEP/ARR event; the new operational ETA owns the time.
  if(masterCode!=='RCS'){
    s.saudiaRcsScheduledTime='';s.saudiaRcsScheduledDate='';s.saudiaRcsTimeSource='';
  }
  const legDest=code(s.flightDestination||s.finalFlightDestination);
  const station=code(s.airport||s.currentLocation||s.arrivalStation);
  const oldParts=Array.isArray(s.partShipments)?s.partShipments:[];
  const hasActualPart=oldParts.some(p=>p?.arrivalIsActual===true&&
    (!code(p.flightDestination)||code(p.flightDestination)===final));
  const actualMaster=/^(ARR|DLV)$/.test(masterCode)&&final&&station===final;
  if(hasActualPart&&num(s.arrivedPieces)>0){
    // For split load, each arrived row keeps its own actual date/time and Mail YES.
    // A different pending RCS/MAN row must never inherit that clock.
    s.partShipments=oldParts.map(p=>{
      if(p?.arrivalIsActual===true)return p;
      const event=code(p.sourceStatus),dest=code(p.flightDestination);
      if((event==='FOW'||event==='DEP')&&dest===final)return p;
      return {...p,arrivalDate:'',arrivalTime:'',arrivalEstimate:false,
        arrivalIsActual:false,mailTime:'',saudiaArrivalStage:event==='DEP'?'CONFIRMED_ETA':event==='FOW'?'ESTIMATED':'PLANNED'};
    });
    if(!actualMaster)s.arrivalIsActual=false;
    return s;
  }
  if(actualMaster&&s.arrivalIsActual===true){
    s.saudiaArrivalStage='ACTUAL';
    s.arrivalEstimate=false;
    return s;
  }
  const liveFinal=(!legDest||legDest===final);
  const confirmed=liveFinal&&masterCode==='DEP';
  const estimated=liveFinal&&masterCode==='FOW';
  if(confirmed||estimated){
    const validClock=/^20\d{2}-\d{2}-\d{2}$/.test(String(s.arrivalDate||''))
      &&/^([01]\d|2[0-3]):[0-5]\d$/.test(String(s.arrivalTime||''));
    s.saudiaArrivalStage=confirmed?'CONFIRMED_ETA':'ESTIMATED';
    s.arrivalIsActual=false;
    s.arrivalEstimate=validClock;
    s.arrivalVerifiedAbsent=!validClock;
    if(!validClock){
      s.arrivalDate='';s.arrivalTime='';
      s.scheduledArrivalDate='';s.scheduledArrivalTime='';
      s.mailTime='';s.eta=null;
    }
    return s;
  }
  // All earlier states (including 24 Oct flight planned, still RCS on 25 Oct).
  // The scheduled flight's landing is not evidence of the AWB's own ARR.
  s.saudiaArrivalStage='PLANNED';
  s.arrivalDate='';s.arrivalTime='';
  s.scheduledArrivalDate='';s.scheduledArrivalTime='';
  s.mailTime='';s.eta=null;
  s.arrivalIsActual=false;s.arrivalEstimate=false;
  s.arrivalVerifiedAbsent=true;s.finalArrivalPending=true;
  s.arrivalTimeSource='SAL '+(masterCode||'unconfirmed')+
    ': final '+(final||'destination')+' FOW/DEP/ARR not yet verified; planned flight clock hidden';
  // RCS is an acceptance event, not uplift. But if SAL assigns a dated
  // future flight to this AWB, show the DATE as EXPECTED, never an invented
  // arrival clock or an actual ARR. Expired RCS plans stay BOOKED until
  // SAL publishes a fresh assignment; DIS/DUS must never revive an old plan.
  const plannedDate=normalizeSalFlightDate(s.flightDate||s.plannedFlightDate||'');
  const istToday=new Date(Date.now()+330*60000).toISOString().slice(0,10);
  const plannedRcs=masterCode==='RCS'&&normalizeFlight(s.flightNo)
    &&/^20\d{2}-\d{2}-\d{2}$/.test(plannedDate)
    &&plannedDate>=istToday&&(!legDest||legDest===final)
    &&s.disAfterFow!==true&&s.offloadedAfterDeparture!==true;
  if(plannedRcs){
    // A provisional timetable clock is display-only and date-bound. It must
    // not populate arrivalTime or create a six-hour-before-arrival Mail alert.
    if(String(s.saudiaRcsScheduledDate||'')!==plannedDate||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(s.saudiaRcsScheduledTime||''))){
      s.saudiaRcsScheduledTime='';s.saudiaRcsScheduledDate='';s.saudiaRcsTimeSource='';
    }
    s.flightDate=plannedDate;
    s.status='EXPECTED';
    s.arrivalDate=plannedDate;s.scheduledArrivalDate=plannedDate;
    s.arrivalTime='';s.scheduledArrivalTime='';
    s.arrivalEstimate=true;s.arrivalVerifiedAbsent=false;
    s.arrivalTimeSource=s.saudiaRcsScheduledTime
      ?'SAL RCS booked flight; dated passenger flight schedule available, cargo ETA unconfirmed'
      :'SAL RCS booked flight date only — ETA time pending; cargo not yet loaded or arrived';
  }else{
    s.saudiaRcsScheduledTime='';s.saudiaRcsScheduledDate='';s.saudiaRcsTimeSource='';
  }
  // Preserve the flight assignment for staff visibility, but never a bogus ETA.
  s.partShipments=oldParts.map(p=>{
    if(p?.arrivalIsActual===true)return p;
    const event=code(p.sourceStatus),dest=code(p.flightDestination);
    if((event==='FOW'||event==='DEP')&&dest===final)return p;
    return {...p,arrivalDate:'',arrivalTime:'',arrivalEstimate:false,
      arrivalIsActual:false,mailTime:'',saudiaArrivalStage:event==='DEP'?'CONFIRMED_ETA':event==='FOW'?'ESTIMATED':'PLANNED'};
  });
  return s;
}
