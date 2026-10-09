// One physical shipment event owns its weight, not the full master denominator.
// "350/1000 kg" means this part weighs 350 kg; 1000 kg is reference only.
export function validKg(value){
  const clean=String(value??'').replace(/,/g,'').replace(/\s*(?:kg|kgs|kilograms?)\s*$/i,'').trim();
  if(!/^\d+(?:\.\d+)?$/.test(clean))return null;
  const amount=Number(clean);
  return Number.isFinite(amount)&&amount>0?amount:null;
}

export function partKg(value){
  return validKg(String(value??'').split('/')[0]);
}

export function masterKg(row={}){
  return validKg(row.totalWeight)??validKg(row.masterWeight)??
    validKg(String(row.weight??'').split('/').at(-1));
}

// Arrival must be explicitly supported by actual-arrival tracking, clearance,
// or a dated, part-specific arrived status. An ETA, flight departure, DIS or
// pending balance is never treated as an arrived part.
export function confirmedPartArrival(part={}){
  if(!part||part._saudiaPendingVirtual===true)return false;
  if(part.arrivalIsActual===true||part.customsCleared===true)return true;
  if(part.arrivalIsActual===false||part.arrivalEstimate===true)return false;
  const state=String(part.status||part.sourceStatus||'').toUpperCase();
  return Boolean(part.arrivalDate)&&
    /\b(?:ARRIVED|DELIVERED|RECEIVED)\b/.test(state)&&
    !/OFFLOAD|DISCREP|CANCEL|PENDING|EXPECTED|ESTIMAT/.test(state);
}
