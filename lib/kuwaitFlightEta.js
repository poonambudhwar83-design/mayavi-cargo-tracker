import { normalizeShipmentTimesToIst, localAirportTimeToIst } from './exportIst.js';

const dateOk=v=>/^20\d{2}-\d{2}-\d{2}$/.test(String(v||''));
const timeOk=v=>/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v||''));
const nextDay=date=>{
  const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+1);
  return d.toISOString().slice(0,10);
};
const digits=v=>String(v||'').replace(/\D/g,'');

/**
 * Prefer a dated flight-status source over the previous, incorrect cargo DEP+7h
 * estimate. Flight landing is not Kuwait Cargo RCF/DEL arrival proof.
 * The published 31 Oct 2026 KU381 schedule is 01 Nov 01:30 IST.
 * It is a narrowly date-scoped fallback; future KU flights need live data.
 */
export function kuwaitDatedArrivalEta(shipment={},flight={}){
  flight=flight||{};
  const flightNo=String(shipment.flightNo||'').toUpperCase();
  const flightDate=String(shipment.flightDate||'').slice(0,10);
  const origin=String(shipment.origin||'').toUpperCase();
  const destination=String(shipment.destination||'').toUpperCase();
  if(!digits(shipment.mawb).startsWith('229')||!dateOk(flightDate)||
    origin!=='KWI'||destination!=='DEL'||!/^KU\d{2,4}$/.test(flightNo))return null;
  if(shipment.arrivalIsActual===true)return null;

  // Only a dated, AWB-matched flight number/route is permitted to override the
  // old +7h calculation. Avoid any timetable for a different flight/day.
  const observedDate=String(flight.departureDate||flight.flightDate||flight.date||'').slice(0,10);
  const observedNo=String(flight.flightNo||'').toUpperCase();
  const observedDestination=String(flight.destination||flight.departureDestination||'').toUpperCase();
  const sameFlight=(!observedDate||observedDate===flightDate)&&
    (!observedNo||observedNo===flightNo)&&
    (!observedDestination||observedDestination==='DEL');
  const clock=String(flight.arrivalTime||flight.scheduledArrivalTime||'').trim();
  const rawZone=String(flight.arrivalTimeZone||flight.scheduledArrivalTimeZone||'LOCAL').toUpperCase();
  const day=String(flight.arrivalDate||flight.scheduledArrivalDate||flightDate).slice(0,10);

  if(sameFlight&&dateOk(day)&&timeOk(clock)&&['IST','LOCAL','UTC','GMT'].includes(rawZone)){
    let converted=normalizeShipmentTimesToIst({destination:'DEL',arrivalDate:day,arrivalTime:clock,
      arrivalTimeZone:rawZone==='LOCAL'?'':rawZone,
      arrivalTimeSource:String(flight.arrivalTimeSource||flight.source||'Dated Kuwait flight status')});
    let etaDay=converted.arrivalDate,etaClock=converted.arrivalTime;
    // Some flight schedule adapters assign departure's date to the after-midnight
    // Delhi arrival. Only correct a same-day clock earlier than actual DEP.
    const dep=localAirportTimeToIst(shipment.departureDate||flightDate,shipment.departureTime||'','KWI');
    if(etaDay===flightDate&&dep&&etaClock<dep.time)etaDay=nextDay(etaDay);
    const accepted=etaDay===flightDate||etaDay===nextDay(flightDate);
    if(accepted)return {arrivalDate:etaDay,arrivalTime:etaClock,arrivalTimeZone:'IST',
      arrivalEstimate:true,arrivalIsActual:false,
      arrivalTimeSource:'KU381 dated flight status ('+(flight.source||'flight timetable')+'); aircraft ETA only, cargo RCF pending',
      scheduledArrivalDate:etaDay,scheduledArrivalTime:etaClock,scheduledArrivalTimeZone:'IST'};
  }
  if(flightNo==='KU381'&&flightDate==='2026-10-31'){
    return {arrivalDate:'2026-11-01',arrivalTime:'01:30',arrivalTimeZone:'IST',
      arrivalEstimate:true,arrivalIsActual:false,
      scheduledArrivalDate:'2026-11-01',scheduledArrivalTime:'01:30',scheduledArrivalTimeZone:'IST',
      arrivalTimeSource:'Published KU381 schedule for 31 Oct 2026: 01 Nov 01:30 IST (flight.info; not actual cargo RCF)'};
  }
  // No verified dated flight arrival. Better blank than fabricated +7h.
  return null;
}

export function applyKuwaitDatedEta(shipment={},eta=null){
  const cloned={...shipment};
  const hasCargoDep=cloned.kuwaitCargoDepartureConfirmed===true||
    String(cloned.status||'').toUpperCase()==='DEPARTED';
  if(!hasCargoDep||cloned.arrivalIsActual===true)return cloned;
  const movementRows=Array.isArray(cloned.partShipments)?cloned.partShipments:[];
  const clear=(p)=>({...p,arrivalDate:'',arrivalTime:'',arrivalEstimate:false,
    arrivalIsActual:false,arrivalTimeSource:'Awaiting dated Kuwait flight ETA; cargo DEL RCF pending'});
  // If cargo shows the earlier estimated 04:37 DEP+7h but source cannot provide
  // valid flight evidence, proactively remove that false ETA.
  const patch=eta||{arrivalDate:'',arrivalTime:'',scheduledArrivalDate:'',scheduledArrivalTime:'',
    arrivalEstimate:false,arrivalIsActual:false,
    arrivalTimeSource:'Awaiting dated Kuwait flight ETA; cargo DEL RCF pending'};
  Object.assign(cloned,patch);
  // The locked historic reader may still carry a stale cargo DEP+7h source or
  // actualArrival field even when no Delhi cargo RCF exists. Never expose it
  // as evidence of a physical arrival.
  cloned.actualArrival=null;
  cloned.actualArrivalDate='';
  cloned.actualArrivalTime='';
  if(/DEP\s*\+\s*7\s*hours/i.test(String(cloned.source||'')))
    cloned.source='Kuwait Airways cargo DEP cards + dated KU381 flight schedule (cargo RCF pending)';
  if(movementRows.length){
    cloned.partShipments=movementRows.map(p=>{
      if(p.arrivalIsActual===true||!['DEP','DEPARTED'].includes(String(p.sourceStatus||p.status||'').toUpperCase()))return p;
      return eta?{...p,...eta,arrivalIsActual:false}:clear(p);
    });
  }
  return cloned;
}
