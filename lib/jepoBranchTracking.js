// JEPO Express public tracking status mapping.
// Do not manufacture scan events or change a delivered record on a stale scan.
export function cleanJepoTrackingNo(input){
  const awb=String(input??'').trim().replace(/\s+/g,'').toUpperCase();
  return /^[A-Z0-9-]{6,60}$/.test(awb)?awb:'';
}
export function sourceStatusToBranch(status){
  const normalized=String(status??'').trim().replace(/[_-]+/g,' ').replace(/\s+/g,' ').toLowerCase();
  if(!normalized||/not delivered|undelivered|delivery failed|return to|returned to|rto/i.test(normalized))return null;
  if(/\bdelivered\b/.test(normalized))return 'DELIVERED';
  if(/out for delivery|out for shipment delivery/.test(normalized))return 'OUT_FOR_DELIVERY';
  if(/\bpre transit\b|information received|label created|pre shipment|booked/.test(normalized))return 'PRE_TRANSIT';
  if(/\bin transit\b|\bintransit\b/.test(normalized))return 'IN_TRANSIT';
  if(/dispatched|shipped|picked up|departed/.test(normalized))return 'DISPATCHED';
  return null;
}
const safeText=value=>String(value??'').trim().replace(/\s+/g,' ').slice(0,500);
export function validateJepoLiveResult(result,expectedAwb){
  const awb=cleanJepoTrackingNo(expectedAwb);
  if(!awb)throw Error('JEPO tracking number is missing or invalid.');
  const body=String(result?.bodyText??'');
  if(!body.toUpperCase().replace(/\s/g,'').includes(awb)){
    throw Error('JEPO returned a different or unverified AWB; saved status not changed.');
  }
  const foundLabel=body.match(/\b(?:Fwd|AWB|Forwarding)\s*No\s*:\s*([A-Z0-9-]+)/i);
  if(foundLabel&&cleanJepoTrackingNo(foundLabel[1])!==awb)
    throw Error('JEPO result belongs to another shipment.');
  const status=safeText(result?.status)||safeText(body.match(/\bStatus\s*:\s*(?:\n\s*)?([^\n\r]+)/i)?.[1]);
  // Only a status shown after the site has produced the matching AWB is authoritative.
  if(!status||status.length>100||/^(?:status|loading|not estimated|track|unknown)$/i.test(status))
    throw Error('JEPO did not expose a verified shipment status.');
  const progress=safeText(result?.latestProgress);
  if(!progress)throw Error('JEPO Progress timeline was missing; last known details retained.');
  return {awb,liveStatus:status.slice(0,100),liveRemarks:progress.slice(0,400),
    mappedStatus:sourceStatusToBranch(status)};
}
