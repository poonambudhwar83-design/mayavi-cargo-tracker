import {parseJepoDeliveryDate} from './jepoDeliveryDate.js';
// JEPO Express public tracking status mapping.
// Do not manufacture scan events or change a delivered record on a stale scan.
export function cleanJepoTrackingNo(input){
  const awb=String(input??'').trim().replace(/\s+/g,'').toUpperCase();
  return /^[A-Z0-9-]{3,60}$/.test(awb)?awb:'';
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
  // JEPO's internal 6-digit number is the number typed into the form.
  // The result's Fwd No is often a different *downstream carrier* AWB (UPS,
  // FedEx etc.) and must NOT be compared with the submitted JEPO number.
  // Instead, verify the browser submitted this exact reference and that a
  // fresh, post-submit result appeared. Do not trust stale page content.
  if(cleanJepoTrackingNo(result?.submittedAwb)!==awb||result?.freshResult!==true)
    throw Error('The JEPO form did not confirm a fresh result for this tracking number.');
  const body=String(result?.bodyText??'');
  const forwarded=body.match(/\b(?:Fwd|Forwarding|AWB)\s*No\s*:\s*([A-Z0-9-]+)/i);
  if(!forwarded)throw Error('JEPO returned no verifiable forwarded shipment number.');
  const carrierAwb=String(forwarded[1]||'').trim().toUpperCase();
  const status=safeText(result?.status)||safeText(body.match(/\bStatus\s*:\s*(?:\n\s*)?([^\n\r]+)/i)?.[1]);
  // Only a status shown after the site has produced the matching AWB is authoritative.
  if(!status||status.length>100||/^(?:status|loading|not estimated|track|unknown)$/i.test(status))
    throw Error('JEPO did not expose a verified shipment status.');
  const progress=safeText(result?.latestProgress);
  const liveEventWhen=safeText(result?.latestEventWhen).slice(0,120);
  if(!progress)throw Error('JEPO Progress timeline was missing; last known details retained.');
  const mappedStatus=sourceStatusToBranch(status);
  // Date is supplied only when the website timeline includes a delivered
  // event; never use the current check time to invent a past delivery date.
  const deliveredDate=mappedStatus==='DELIVERED'?parseJepoDeliveryDate(result?.deliveredScanDate):null;
  return {awb,carrierAwb,liveStatus:status.slice(0,100),liveRemarks:progress.slice(0,400),liveEventWhen,
    mappedStatus,deliveredDate};
}


// Some JEPO records expose a real Progress table while the separate Status
// field is temporarily empty. Capture their source event without inventing
// a transport status. Only the standalone JEPO register opts into this.
export function validateJepoProgressOnlyResult(result,expectedAwb){
 const awb=cleanJepoTrackingNo(expectedAwb);
 if(!awb||cleanJepoTrackingNo(result?.submittedAwb)!==awb||result?.freshResult!==true)
  throw Error('JEPO progress was not verified for the submitted AWB.');
 const body=String(result?.bodyText??'');
 const forwarded=body.match(/\b(?:Fwd|Forwarding|AWB)\s*No\s*:\s*([A-Z0-9-]+)/i);
 const carrierAwb=String(forwarded?.[1]||'').trim().toUpperCase();
 if(carrierAwb.length<6||!/\d/.test(carrierAwb))
  throw Error('JEPO progress has no verifiable downstream AWB.');
 const progress=safeText(result?.latestProgress);
 if(!progress)throw Error('JEPO progress timeline is empty.');
 return {
  awb,carrierAwb,liveStatus:'',mappedStatus:'',
  liveRemarks:progress.slice(0,400),
  liveEventWhen:safeText(result?.latestEventWhen).slice(0,120),
  deliveredDate:null,progressOnly:true
 };
}
