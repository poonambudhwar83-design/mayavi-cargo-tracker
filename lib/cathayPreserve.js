// Cathay-only safeguard: a partially loaded carrier page must not erase
// previously extracted AWB-matched flight/arrival data.
// Fresh, complete published CX flight/arrival information always wins.
const digits=value=>String(value||'').replace(/\D/g,'');
const str=value=>String(value??'').trim();
const dateOk=value=>/^20\d{2}-\d{2}-\d{2}$/.test(str(value));
const timeOk=value=>/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(str(value));
const cxFlight=value=>str(value).replace(/\s+/g,'').toUpperCase();

export function preserveCathayFlight(previous={},incoming={},mawb=''){
  const id=digits(mawb||incoming.mawb||previous.mawb);
  if(!/^160\d{8}$/.test(id))return incoming;
  const oldId=digits(previous.mawb||previous.awb);
  if(oldId&&oldId!==id)return incoming;
  if(!previous||typeof previous!=='object')return incoming;

  const oldFlight=cxFlight(previous.flightNo),newFlight=cxFlight(incoming.flightNo);
  const changedFlight=Boolean(newFlight&&oldFlight&&newFlight!==oldFlight);
  const changedRoute=['origin','destination'].some(key=>
    str(previous[key])&&str(incoming[key])&&str(previous[key]).toUpperCase()!==str(incoming[key]).toUpperCase()
  );
  // Never attach a previous flight's ETA to a different published movement.
  if(changedFlight||changedRoute)return incoming;

  const out={...incoming};
  if(!newFlight&&/^CX\d{1,4}[A-Z]?$/.test(oldFlight))out.flightNo=previous.flightNo;
  for(const key of ['flightDate','finalFlightNo','finalFlightDate','departureDate','departureTime']){
    if(!str(out[key])&&str(previous[key]))out[key]=previous[key];
  }

  const oldArrival=dateOk(previous.arrivalDate)&&timeOk(previous.arrivalTime);
  const freshArrival=dateOk(incoming.arrivalDate)&&timeOk(incoming.arrivalTime);
  // A changed published date/time is real evidence. Never combine
  // a new arrival date with an older time.
  const sameDate=!str(incoming.arrivalDate)||incoming.arrivalDate===previous.arrivalDate;
  const sameTime=!str(incoming.arrivalTime)||incoming.arrivalTime===previous.arrivalTime;
  if(oldArrival&&!freshArrival&&sameDate&&sameTime){
    out.arrivalDate=previous.arrivalDate;
    out.arrivalTime=previous.arrivalTime;
    for(const key of ['arrivalTimeZone','arrivalTimeSource','scheduledArrivalDate',
      'scheduledArrivalTime','scheduledArrivalTimeZone']){
      if(!str(out[key])&&str(previous[key]))out[key]=previous[key];
    }
    out.arrivalIsActual=previous.arrivalIsActual===true;
    if(previous.arrivalEstimate===true)out.arrivalEstimate=true;
    out.arrivalVerifiedAbsent=false;
  }
  if(str(incoming.status).toUpperCase()==='TRACKING'&&
     ['BOOKED','IN TRANSIT','DEPARTED','ARRIVED','DELIVERED','PART ARRIVED'].includes(str(previous.status).toUpperCase())){
    out.status=previous.status;
  }
  return out;
}
