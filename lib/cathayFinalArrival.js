// Cathay 160 only. An ETA / arrival clock in the future cannot prove the
// flight or cargo has already reached its FINAL destination.
// Keep the published ETA visible; wait for a fresh destination event before ARRIVED.
// Do not edit the protected Cathay scraping / Booking Status parsers.
const digits = value => String(value||'').replace(/\D/g,'');
const upper = value => String(value||'').trim().toUpperCase();
function istMillis(date='',time=''){
  const d=String(date||'').trim(),t=String(time||'').trim();
  if(!/^20\d{2}-\d{2}-\d{2}$/.test(d)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(t))return null;
  const ms=Date.parse(d+'T'+t+':00+05:30');
  return Number.isFinite(ms)?ms:null;
}
export function guardCathayFinalArrival(shipment={},now=Date.now()){
  const mawb=digits(shipment.mawb||shipment.awb);
  if(!/^160\d{8}$/.test(mawb))return shipment;
  const status=upper(shipment.status);
  if(status!=='ARRIVED'&&status!=='LANDED')return shipment;
  const arrival=istMillis(shipment.arrivalDate,shipment.arrivalTime);
  // Retain verified historic cargo arrivals, and never automatically mark
  // a shipment ARRIVED based only on the passage of a scheduled ETA.
  if(arrival===null||arrival<=now)return shipment;
  const departure=istMillis(shipment.departureDate,shipment.departureTime);
  const departed=shipment.departureIsActual===true||
    (departure!==null&&departure<=now);
  return {...shipment,status:departed?'IN TRANSIT':'BOOKED',
    arrivalIsActual:false,arrivalEstimate:true,
    cxArrivalAwaitingFinalDestination:true,
    statusSource:'Cathay final destination arrival is still in the future (IST)',
    arrivalTimeSource:(shipment.arrivalTimeSource||'Cathay flight arrival')+'; ETA not yet actual'};
}
