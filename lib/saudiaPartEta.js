import { normalizeShipmentTimesToIst } from './exportIst.js';

// SAL FOW confirms cargo loading on the named flight; SAL DEP confirms it
// departed. Neither flight event is evidence that the cargo reached DEL.
const upper=v=>String(v||'').toUpperCase().trim();
const date=v=>String(v||'').slice(0,10);
const flight=v=>upper(v).replace(/[^A-Z0-9]/g,'').replace(/^SV0+(\d+)$/,'SV$1');
const clock=v=>/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v||''));

export async function applySaudiaPartFlightEtas(shipment={},flightSchedule=null){
  if(!Array.isArray(shipment.partShipments)||typeof flightSchedule!=='function')return shipment;
  const final=upper(shipment.destination),cache=new Map();
  const parts=[];
  for(const p of shipment.partShipments){
    const stage=upper(p.sourceStatus),flightNo=flight(p.flightNo),flightDate=date(p.flightDate);
    const dest=upper(p.flightDestination||shipment.flightDestination||final);
    const from=upper(p.flightOrigin||'');
    if(p.arrivalIsActual===true||!['FOW','DEP'].includes(stage)
      ||!/^SV\d{2,4}$/.test(flightNo)||!/^20\d{2}-\d{2}-\d{2}$/.test(flightDate)
      ||!/^[A-Z]{3}$/.test(dest)){
      parts.push(p);continue;
    }
    const key=[flightNo,flightDate,from,dest].join('|');
    if(!cache.has(key)){
      let result=null;
      try{result=await flightSchedule({flightNo,date:flightDate,origin:from,destination:dest});}catch{}
      cache.set(key,result);
    }
    const found=cache.get(key);
    const reportedFlight=flight(found?.flightNo||'');
    const reportedDest=upper(found?.departureDestination||found?.destination||'');
    const reportedOrigin=upper(found?.departureOrigin||found?.origin||'');
    const reportedDate=date(found?.departureDate||found?.flightDate||'');
    const match=Boolean(found?.ok&&(!reportedFlight||reportedFlight===flightNo)
      &&(!reportedDate||reportedDate===flightDate)
      &&(!reportedDest||reportedDest===dest)
      &&(!from||!reportedOrigin||from===reportedOrigin));
    const rawDate=match?date(found.arrivalDate||found.scheduledArrivalDate):'';
    const rawTime=match?(found.arrivalTime||found.scheduledArrivalTime||''):'';
    let eta=null;
    if(/^20\d{2}-\d{2}-\d{2}$/.test(rawDate)&&clock(rawTime)){
      const normalized=normalizeShipmentTimesToIst({
        destination:dest,arrivalDate:rawDate,arrivalTime:rawTime,
        arrivalTimeZone:found.arrivalTimeZone||found.scheduledArrivalTimeZone||'LOCAL',
        arrivalTimeSource:found.arrivalTimeSource||found.source||'Dated flight schedule'
      });
      if(normalized.arrivalDate&&clock(normalized.arrivalTime))eta=normalized;
    }
    const status=stage==='DEP'?'DEPARTED':'IN TRANSIT';
    const arrivalLabel=stage==='DEP'?'FLIGHT DEPARTED • CONFIRMED ETA':'ESTIMATED ARRIVAL • FOW';
    const next={...p,status,departureIsActual:stage==='DEP',
      saudiaArrivalStage:stage==='DEP'?'CONFIRMED_ETA':'ESTIMATED',
      arrivalIsActual:false,
      flightEtaEvidence:eta?[flightNo,flightDate,dest,eta.arrivalDate,eta.arrivalTime,'IST'].join(' '):'',
      remarks:eta
        ?[arrivalLabel+':',flightNo,'to',dest,eta.arrivalDate,eta.arrivalTime,'IST (flight ETA only; cargo not arrived)'].join(' ')
        :[arrivalLabel+':',flightNo,'to',dest,'• published arrival time pending'].join(' ')};
    if(dest===final){
      next.arrivalDate=eta?.arrivalDate||'';
      next.arrivalTime=eta?.arrivalTime||'';
      next.arrivalTimeZone='IST';
      next.arrivalTimeSource=eta?arrivalLabel+'; dated '+flightNo+' schedule':'';
      next.arrivalEstimate=Boolean(eta);
    }else{
      // Never put a JED transit ETA in the DEL arrival column.
      next.arrivalDate='';next.arrivalTime='';next.arrivalEstimate=false;
      next.transitEstimatedArrivalDate=eta?.arrivalDate||'';
      next.transitEstimatedArrivalTime=eta?.arrivalTime||'';
      next.transitEstimatedArrivalStation=dest;
      next.transitEtaLabel=arrivalLabel;
    }
    parts.push(next);
  }
  return {...shipment,partShipments:parts};
}
