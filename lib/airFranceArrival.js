// AF 057 only: keep the AWB issuer separate from operating-flight carrier.
export function guardAirFranceArrival(shipment={}){
  const s={...shipment,carrierCode:'AF',airlineName:'Air France Cargo'};
  const total=Number(s.masterPieces||s.totalPieces||s.pieces||0);
  const destination=String(s.destination||'').toUpperCase();
  const events=[
    ...(s.afArrivalEvents||[]).filter(e=>e.location===destination),
    ...(s.klmStationEvents||[]).filter(e=>e.station===destination&&!e.estimated&&['ARRIVAL','ARRIVED','DELIVERED'].includes(e.code))
  ].filter(e=>Number.isInteger(Number(e.pieces))&&Number(e.pieces)>0);
  // ARR/RCF/DLV may describe the same pieces; never add them together.
  const confirmed=Math.max(0,...events.map(e=>Number(e.pieces)));
  if(total>0&&confirmed>0&&confirmed<=total){
    s.totalPieces=String(total);
    s.arrivedPieces=String(confirmed);
    s.remainingPieces=String(total-confirmed);
    s.pendingPieces=String(total-confirmed);
  }
  if(s.arrivalIsActual===true||/^(ARRIVED|DELIVERED)$/.test(s.status||'')){
    if(total>0&&confirmed===total)return s;
    s.arrivalIsActual=false;
    s.arrivalDate=s.scheduledArrivalDate||'';
    s.arrivalTime=s.scheduledArrivalTime||'';
    s.arrivalEstimate=Boolean(s.arrivalDate&&s.arrivalTime);
    s.arrivalTimeSource=s.arrivalEstimate?'AFKLM scheduled arrival (full cargo receipt unverified)':'AFKLM full cargo receipt unverified';
    if(s.arrivalEstimate)s.arrivalTimeZone=s.scheduledArrivalTimeZone||s.arrivalTimeZone||'';
    s.status=total>0&&confirmed>0&&confirmed<total?'PART ARRIVED':'IN TRANSIT';
    if(s.status==='PART ARRIVED'){s.isPartLoad=true;s.partLoad=true;}
    s.afFullArrivalUnverified=true;
  }
  return s;
}
