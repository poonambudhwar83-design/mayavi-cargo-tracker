// Verified dated public flight schedule, retained only when live sources are down.
// A published aircraft timetable is not SAL confirmation that cargo is loaded.
const known=Object.freeze({
  'SV756|2026-11-02|JED|DEL':Object.freeze({
    arrivalTime:'09:45',verifiedOn:'2026-11-01',
    sourceUrl:'https://www.flightstats.com/v2/flight-tracker/SV/756?date=02&month=11&year=2026'
  })
});
export function lastVerifiedSaudiaSchedule({flightNo='',flightDate='',origin='',destination=''}={}){
  const key=[flightNo,flightDate,origin,destination].map(x=>String(x||'').trim().toUpperCase()).join('|');
  const record=known[key];
  if(!record)return null;
  return{arrivalDate:String(flightDate).trim(),arrivalTime:record.arrivalTime,
    arrivalIsActual:false,source:'Last-verified FlightStats published schedule',
    url:record.sourceUrl,verifiedOn:record.verifiedOn};
}
