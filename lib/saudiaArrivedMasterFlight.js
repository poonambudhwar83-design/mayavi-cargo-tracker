// Use the actual destination cargo ARR/DLV physical rows for the displayed
// Saudia master flight, not an earlier connecting-leg DEP still in history.
// Never infer cargo arrival from a passenger flight ETA or a transit RCF.
const num=value=>{const x=Number(value);return Number.isFinite(x)?x:0;};
const code=value=>String(value||'').trim().toUpperCase();
const date=value=>(String(value||'').match(/20\d{2}-\d{2}-\d{2}/)||[])[0]||'';
const flight=value=>/^SV\d{1,4}[A-Z]?$/i.test(String(value||'').trim())?code(value):'';
export function resolveSaudiaArrivedMasterFlight(input={}){
  const mawb=String(input.mawb||input.awb||'').replace(/\D/g,'');
  if(!mawb.startsWith('065'))return input;
  const destination=code(input.destination);
  if(!/^[A-Z]{3}$/.test(destination))return input;
  const parts=Array.isArray(input.partShipments)?input.partShipments:[];
  const confirmed=parts.filter(p=>p?.arrivalIsActual===true
    &&flight(p.flightNo)
    &&(!p.flightDestination||code(p.flightDestination)===destination)
    &&date(p.arrivalDate));
  if(!confirmed.length)return input;
  // Resolve the master only when all its physical pieces have actually
  // reached the final destination; partial loads keep their current flight.
  const totalPieces=num(input.totalPieces);
  const totalWeight=num(input.totalWeight);
  const arrivedPieces=confirmed.reduce((n,p)=>n+num(p.pieces),0);
  const arrivedWeight=confirmed.reduce((n,p)=>n+num(p.weight),0);
  if(!totalPieces||arrivedPieces<totalPieces
    ||(totalWeight>0&&arrivedWeight<totalWeight-0.5))return input;
  const last=[...confirmed].sort((a,b)=>
    (date(a.arrivalDate)+String(a.arrivalTime||''))
      .localeCompare(date(b.arrivalDate)+String(b.arrivalTime||''))).at(-1);
  const finalFlight=flight(last.flightNo);
  if(!finalFlight)return input;
  const arrivalDate=date(last.arrivalDate);
  const arrivalTime=String(last.arrivalTime||'');
  return {...input,
    flightNo:finalFlight,
    flightDate:date(last.flightDate)||arrivalDate,
    flightDestination:destination,
    finalFlightNo:finalFlight,
    finalFlightDate:date(last.flightDate)||arrivalDate,
    finalFlightDestination:destination,
    status:'ARRIVED',
    arrivalDate,
    arrivalTime:arrivalTime||input.arrivalTime||'',
    arrivalIsActual:true,
    arrivalEstimate:false,
    arrivalVerifiedAbsent:false,
    finalArrivalPending:false,
    saudiaArrivalStage:'ACTUAL',
    arrivalTimeSource:last.arrivalTimeSource||input.arrivalTimeSource||'SAL actual destination ARR/DLV'
  };
}
