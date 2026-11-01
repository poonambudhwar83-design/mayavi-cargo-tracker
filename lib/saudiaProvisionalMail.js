// A Saudia RCS booking is not proof of cargo uplift or arrival. Staff may
// nevertheless plan mail against a published, dated final-flight timetable.
// Keep this operational mail deadline distinct from a confirmed cargo ETA.
import { importMailSixHoursBefore } from './importEtaTimeline.js';

const code=value=>String(value??'').trim().toUpperCase();
const digits=value=>String(value??'').replace(/\D/g,'');
const validTime=value=>/^([01]\d|2[0-3]):[0-5]\d$/.test(String(value??''));

export function saudiaRcsProvisionalMailTime(shipment={}){
  const s=shipment||{};
  if(!digits(s.mawb||s.awb).startsWith('065')||s._saudiaPendingVirtual===true)return'';
  if(code(s.sourceStatus)!=='RCS'||code(s.saudiaArrivalStage)!=='PLANNED')return'';
  if(s.arrivalIsActual===true||s.disAfterFow===true||s.offloadedAfterDeparture===true)return'';
  const final=code(s.destination),flightDestination=code(s.flightDestination||s.finalFlightDestination);
  if(!final||(flightDestination&&flightDestination!==final))return'';
  if(!code(s.flightNo).match(/^SV\d{1,4}[A-Z]?$/))return'';
  const date=String(s.saudiaRcsScheduledDate||'').trim();
  if(!/^20\d{2}-\d{2}-\d{2}$/.test(date)||date!==String(s.arrivalDate||'').trim()
    ||date!==String(s.flightDate||s.plannedFlightDate||'').trim())return'';
  if(!validTime(s.saudiaRcsScheduledTime))return'';
  if(!/^(FlightStats (scheduled|estimated) arrival|Flightera scheduled arrival|Last-verified FlightStats published schedule|SAL scheduled\/estimated arrival)$/i.test(String(s.saudiaRcsTimeSource||'')))return'';
  return importMailSixHoursBefore(date,String(s.saudiaRcsScheduledTime));
}
