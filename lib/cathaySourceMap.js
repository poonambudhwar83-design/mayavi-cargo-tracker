// Cathay (160) data lineage: the Cargo Terminal posts accepted pieces/weight and
// dated flight movements; Cathay Cargo Booking Details posts flight allotment and
// scheduled/actual arrival. Never borrow another AWB's schedule or invent a flight.
export const CATHAY_BOOKING_URL='https://www.cathaycargo.com/en-us/track-and-trace.html';
const digits=value=>String(value||'').replace(/\D/g,'');
const present=value=>String(value??'').trim().length>0;
const matches=(entry,mawb)=>Boolean(entry&&digits(entry.mawb||entry.awb)===digits(mawb));
const dateOk=value=>/^20\d{2}-\d{2}-\d{2}$/.test(String(value||''));
const timeOk=value=>/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(value||''));
const flightOk=value=>/^CX\d{1,4}[A-Z]?$/i.test(String(value||'').replace(/\s+/g,''));

export function annotateCathaySources(shipment={},evidence={}){
  const mawb=shipment.mawb||evidence.mawb||'';
  if(!/^160\d{8}$/.test(digits(mawb)))return shipment;
  const terminal=evidence.terminal?.shipment||null;
  const booking=evidence.booking?.ok===true?evidence.booking.shipment:null;
  const terminalMatched=matches(terminal,mawb);
  const bookingMatched=matches(booking,mawb)&&Boolean(
    flightOk(booking.flightNo)&&
    (dateOk(booking.arrivalDate)&&timeOk(booking.arrivalTime)||dateOk(booking.flightDate)));
  const out={...shipment};
  // The terminal's AWB-specific Received from Shipper card, not a local
  // manual master, is authoritative for accepted pieces and weight.
  if(terminalMatched){
    for(const key of ['origin','destination','pieces','bags','weight','bookingDate']){
      if(present(terminal[key]))out[key]=terminal[key];
    }
    if(present(terminal.weight))out.weightSource='Cathay Cargo Terminal / Received from Shipper (RCS)';
    if(present(terminal.pieces)||present(terminal.bags))
      out.piecesSource='Cathay Cargo Terminal / Received from Shipper (RCS)';
    if(present(terminal.bookingDate))out.bookingDateSource='Cathay Cargo Terminal / Received from Shipper (RCS)';
  }
  // Flight number comes from the AWB's Booking Details allotment, or the
  // Terminal's own dated Departure Flight / Received from Flight movement.
  if(bookingMatched&&flightOk(booking.flightNo)){
    out.flightNoSource='Cathay Cargo Track & Trace / Booking Details';
  }else if(terminalMatched&&flightOk(terminal.flightNo)){
    out.flightNoSource='Cathay Cargo Terminal / Departure Flight';
  }else if(flightOk(out.flightNo)&&!present(out.flightNoSource)){
    out.flightNoSource='Previously verified CX flight (retained)';
  }

  let arrivalProvenance='';
  if(bookingMatched&&dateOk(booking.arrivalDate)&&timeOk(booking.arrivalTime)){
    arrivalProvenance=booking.arrivalIsActual===true
      ?'Cathay Cargo Track & Trace / Booking Details (Actual)'
      :'Cathay Cargo Track & Trace / Booking Details (Scheduled/Estimated)';
  }else if(evidence.flightStatus&&dateOk(evidence.flightStatus.arrivalDate)&&
            timeOk(evidence.flightStatus.arrivalTime)&&
            flightOk(out.flightNo)&&
            String(evidence.flightStatus.flightNo||'').replace(/\s+/g,'').toUpperCase()===
            String(out.flightNo).replace(/\s+/g,'').toUpperCase()){
    arrivalProvenance='Cathay Pacific flight status / matched flight and date';
  }
  if(arrivalProvenance){
    out.arrivalTimeSource=arrivalProvenance;
    out.arrivalDetailsSource=arrivalProvenance;
  }else if(dateOk(out.arrivalDate)&&timeOk(out.arrivalTime)){
    out.arrivalDetailsSource=out.arrivalTimeSource||'Previously verified CX arrival (retained)';
  }

  const detailsComplete=flightOk(out.flightNo)&&dateOk(out.arrivalDate)&&timeOk(out.arrivalTime);
  out.cxBookingDetailsPending=!detailsComplete;
  out.cxTrackingSources={
    terminal:{url:evidence.terminalUrl||'https://www.cathaycargoterminal.com/en-us/Shipment-Tracking',
      status:terminalMatched?'AWB_MATCHED':'UNAVAILABLE',
      provides:'Accepted pieces, gross weight, route, RCS, dated departure / RCF'},
    bookingDetails:{url:CATHAY_BOOKING_URL,
      status:bookingMatched?'AWB_MATCHED':String(evidence.bookingReason||'').includes('403')?'ACCESS_DENIED':'UNAVAILABLE',
      provides:'AWB-matched flight allotment, scheduled / estimated / actual arrival'},
    flightInformation:{url:'https://www.cathaypacific.com/',
      status:evidence.flightStatus?'MATCHED_FLIGHT_STATUS':'UNAVAILABLE',
      provides:'Arrival time after verified flight number and flight date'}
  };
  out.cxBookingDetailsMessage=detailsComplete
    ?'CX flight and arrival details were matched to the shipment.'
    :'CX booking flight/arrival not available from a verified live source. Do not infer an ETA from weight or RCS.';
  return out;
}