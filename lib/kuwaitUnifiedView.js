// Kuwait full-load consolidation: a display projection, not a destructive DB merge.
// Keep the exact original split movements for audit, mail, customs, and later
// partial DEL RCF. Do not collapse a mere MAN/PRE or different flights.
const asNumber=value=>{
  const n=Number(String(value??'').replace(/,/g,'').trim());
  return Number.isFinite(n)?n:0;
};
const clean=value=>String(value??'').trim().toUpperCase();
const digits=value=>String(value??'').replace(/\D/g,'');
const sameNonempty=(items,key)=>{
  const first=clean(items[0]?.[key]);
  return Boolean(first&&items.every(item=>clean(item?.[key])===first));
};

/**
 * Return a single Kuwait master row ONLY when every physical part of the
 * SAME flight has a cargo-confirmed DEP of the complete AWB gross quantity.
 * Any later partial RCF or mixed Customs marks restores independent parts.
 * The saved row's partShipments array is intentionally never modified.
 */
export function consolidatedKuwaitDeparture(row={}){
  if(!digits(row.mawb||row.awb).startsWith('229')||
    row.kuwaitCargoDepartureConfirmed!==true||
    row.arrivalIsActual===true)return null;
  const parts=Array.isArray(row.partShipments)?row.partShipments.filter(Boolean):[];
  if(parts.length<2)return null;
  const totalPieces=asNumber(row.totalPieces||row.masterPieces||row.pieces||row.bags);
  const totalWeight=asNumber(row.totalWeight||row.masterWeight||row.weight);
  if(totalPieces<2||totalWeight<=0)return null;
  if(!parts.every(part=>asNumber(part.pieces)>0&&asNumber(part.weight)>0
      &&part.departureIsActual===true&&part.arrivalIsActual!==true
      &&clean(part.sourceStatus)==='DEP'&&clean(part.status)==='DEPARTED'
      &&clean(part.eventStation)==='KWI')
    ||!sameNonempty(parts,'flightNo')||!sameNonempty(parts,'flightDate')
    ||!sameNonempty(parts,'departureDate')||!sameNonempty(parts,'departureTime')
    ||parts.reduce((sum,part)=>sum+asNumber(part.pieces),0)!==totalPieces
    ||Math.abs(parts.reduce((sum,part)=>sum+asNumber(part.weight),0)-totalWeight)>0.05)
    return null;
  // A partially cleared split must remain visible separately in Active and
  // Customs Cleared until both parts are consistently in the same view.
  const cleared=parts.every(part=>part.customsCleared===true);
  if(parts.some(part=>part.customsCleared===true)&&!cleared)return null;
  const mailSent=parts.every(part=>part.mailSent===true);
  const first=parts[0];
  const sameEta=parts.every(part=>part.arrivalDate===first.arrivalDate
      &&part.arrivalTime===first.arrivalTime
      &&part.arrivalEstimate===first.arrivalEstimate);
  return {...row,
    bags:String(totalPieces),pieces:String(totalPieces),weight:String(totalWeight),
    flightNo:first.flightNo,flightDate:first.flightDate,
    status:clean(row.status)==='IN TRANSIT'?'DEPARTED':row.status,
    mailSent,customsCleared:cleared,
    customsClearedAt:cleared?(parts.find(part=>part.customsClearedAt)?.customsClearedAt||row.customsClearedAt||''):'',
    arrivalDate:sameEta?first.arrivalDate:(row.arrivalDate||''),
    arrivalTime:sameEta?first.arrivalTime:(row.arrivalTime||''),
    arrivalEstimate:sameEta?first.arrivalEstimate===true:row.arrivalEstimate===true,
    arrivalIsActual:false,
    _kuwaitConsolidated:true,
    _kuwaitSplitHistory:parts.map(part=>({
      pieces:part.pieces,weight:part.weight,flightNo:part.flightNo,
      sourceStatus:part.sourceStatus,mailSent:part.mailSent,
      customsCleared:part.customsCleared
    })),
    remarks:'FULL LOAD DEPARTED · '+totalPieces+'/'+totalPieces+
      ' bags, '+totalWeight+' kg on '+first.flightNo+
      ' · '+parts.length+' split movements retained in history'
  };
}
