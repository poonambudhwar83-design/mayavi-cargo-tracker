'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { airlineForMawb, CONFIGURED_PREFIXES } from '../lib/airlines.js';
import { normalizeExportTimesToIst } from '../lib/exportIst.js';
import { partIdentity, mergePartMail, mergePartCustoms } from '../lib/partMail.js';
import { confirmedPartArrival, masterKg, partKg } from '../lib/arrivalWeights.js';
import { averageWeightPerBag } from '../lib/averageBagWeight.js';
import { consolidatedKuwaitDeparture } from '../lib/kuwaitUnifiedView.js';
import { refreshScope } from '../lib/autoRefreshScope.js';
import { notifyProfitSourceChanged } from '../lib/profitSync.js';
import { resolveSaudiaArrivedMasterFlight } from '../lib/saudiaArrivedMasterFlight.js';
import { matchSaudiaRcfParts } from '../lib/saudiaRcfParts.js';
import { preserveCathayFlight } from '../lib/cathayPreserve.js';
import { guardCathayFinalArrival } from '../lib/cathayFinalArrival.js';
import { guardSaudiaConnectingFlightWithoutSal, enforceSaudiaArrivalEvidence } from '../lib/saudiaTransitGuard.js';

const KEY='mayavi_v3_shipments';
const TAB_KEY='mayavi_dashboard_active_tab';
const SERVER_POLL=60*1000;
const bagAverageFormat=new Intl.NumberFormat('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
function normalize(v=''){const d=String(v).replace(/\D/g,'');return d.length===11?`${d.slice(0,3)}-${d.slice(3)}`:''}
function digits(v=''){return String(v).replace(/\D/g,'')}
function pad(v){return String(v).padStart(2,'0')}
function cleanWeight(v=''){return String(v||'').replace(/\s*(kg|kgs|kilograms?)\s*$/i,'').trim()}
function shipmentTypeOf(value=''){const t=String(value||'').trim().toUpperCase();return t==='OTHER_COUNTRIES_IMPORT'?'OTHER_COUNTRIES_IMPORT':t==='OTHER_COUNTRIES'?'OTHER_COUNTRIES':t==='EXPORT'?'EXPORT':'IMPORT'}
function isPrivateType(value=''){return ['OTHER_COUNTRIES','OTHER_COUNTRIES_IMPORT'].includes(shipmentTypeOf(value))}
function isImportLikeType(value=''){return ['IMPORT','OTHER_COUNTRIES_IMPORT'].includes(shipmentTypeOf(value))}
function isExportLikeType(value=''){const t=shipmentTypeOf(value);return t==='EXPORT'||t==='OTHER_COUNTRIES'}
function weightForTotal(row={}){return masterKg(row)||0}
function summaryRowWeight(row={},tab='IMPORT'){
  // "Total Weight" means the sum of the cargo weights shown on this sheet,
  // NOT just the parts already arrived. Future manifests/FOW, departed and
  // in-transit parts must contribute their physical numerator (kg).
  // Never add the master denominator again for a split MAWB.
  if(row._saudiaPendingVirtual===true)return partKg(row.weight)||0;
  if(row._partKey)return partKg(row.weight)||0;
  const fractional=isImportLikeType(tab)&&String(row.weight||'').includes('/')&&
    (row.isPartLoad===true||row.partLoad===true||
      /PART ARRIVED|PART LOAD|PART SHIPMENT/i.test(String(row.status||'')));
  return fractional?(partKg(row.weight)||0):weightForTotal(row);
}
function weightMinusForTotal(row={}){const n=Number(String(row.weightMinus??'').replace(/,/g,'').trim());return Number.isFinite(n)&&n>=0?n:0}
function normalizeFlightNo(mawb='',value=''){const n=normalize(mawb),f=String(value||'').trim().replace(/\s+/g,'').toUpperCase();if(n.startsWith('065-')&&/^\d{1,4}$/.test(f))return`SV${f}`;return f}
function formatEntryDate(value=''){if(!value)return'';const d=new Date(value);if(!Number.isFinite(d.getTime()))return'';return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()}`}
function formatTime24(value=''){
  const raw=String(value||'').trim();if(!raw)return'';
  const match=raw.match(/^(\d{1,2}):([0-5]\d)(?::[0-5]\d)?\s*(AM|PM)?$/i);
  if(!match)return raw;
  let hour=Number(match[1]);
  if(match[3]){
    if(hour<1||hour>12)return raw;
    hour=hour%12+(match[3].toUpperCase()==='PM'?12:0);
  }else if(hour>23)return raw;
  return pad(hour)+':'+match[2];
}
function formatDateTime24(value=''){
  const raw=String(value||'').trim();if(!raw)return'';
  const match=raw.match(/^(20\d{2}-\d{2}-\d{2})\s+(.+)$/);
  return match?match[1]+' '+formatTime24(match[2]):raw;
}
function istDateTimeValue(date='',time=''){
  const dm=String(date||'').trim().match(/^(20\d{2})-(\d{2})-(\d{2})$/);
  const tm=formatTime24(time).match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if(!dm||!tm)return null;
  const d=new Date(Date.UTC(Number(dm[1]),Number(dm[2])-1,Number(dm[3]),Number(tm[1]),Number(tm[2])));
  return d.toISOString().slice(0,10)===dm[1]+'-'+dm[2]+'-'+dm[3]?d:null;
}
function dateTimeValue(date='',time=''){const dm=String(date).match(/^(\d{4})-(\d{2})-(\d{2})$/),tm=String(time).match(/^(\d{1,2}):(\d{2})/);if(!dm||!tm)return null;const d=new Date(Number(dm[1]),Number(dm[2])-1,Number(dm[3]),Number(tm[1]),Number(tm[2]),0,0);return Number.isFinite(d.getTime())?d:null}
function previousDate(date=''){const m=String(date||'').match(/^(20\d{2})-(\d{2})-(\d{2})$/);if(!m)return false;const now=new Date(),today=`${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;return String(date)<today}
function mailTimeFrom(date='',time=''){
  const d=istDateTimeValue(date,time);if(!d)return'';
  return new Date(d.getTime()-6*60*60*1000).toISOString().slice(0,16).replace('T',' ');
}
function handoverTimeFrom(date='',time=''){
  const d=istDateTimeValue(date,time);if(!d)return'';
  return new Date(d.getTime()-5*60*60*1000).toISOString().slice(0,16).replace('T',' ');
}
function departurePassed(row={}){const d=dateTimeValue(row.departureDate||row.flightDate||'',row.departureTime||'');return Boolean(d&&Date.now()>=d.getTime())}
function airportCode(value=''){const m=String(value||'').toUpperCase().match(/\b([A-Z]{3})\b/);return m?.[1]||''}
function explicitMovementStation(row={}){
  for(const value of [row.arrivalStation,row.arrivalAirport,row.currentLocation,row.lastLocation,row.eventStation,row.deliveryStation,row.airport,row.location]){
    const code=airportCode(value);if(code)return code;
  }
  return'';
}
function explicitViaForStatus(row={}){
  const origin=airportCode(row.origin),destination=airportCode(row.destination);
  for(const value of [row.via,row.transitAirport,row.routeVia,row.connectionAirport,row.hub,row.departureDestination]){
    const code=airportCode(value);if(code&&code!==origin&&code!==destination)return code;
  }
  return'';
}
function viaForRow(row={}){
  const origin=airportCode(row.origin),destination=airportCode(row.destination),n=normalize(row.mawb||row.awb||'');
  // AirAsia 807: show every AWB-verified transit airport in journey order.
  // Generic airportCode() only returns one IATA code and would hide SIN.
  // Do not let the older fallback display the origin DEL as a transit stop.
  if(n.startsWith('807-')){
    const legs=Array.isArray(row.flightSchedule)?row.flightSchedule:[];
    const stops=legs.map(leg=>airportCode(leg.destination)).filter(code=>code&&code!==origin&&code!==destination);
    const saved=String(row.via||'').toUpperCase().match(/\b[A-Z]{3}\b/g)||[];
    const via=[...new Set((stops.length?stops:saved).filter(code=>code!==origin&&code!==destination))];
    if(via.length)return via.join(' / ');
  }
  // The old generic fallback displayed KWI itself as a VIA on direct
  // KU381 KWI -> DEL, which in turn incorrectly labelled DEP as IN TRANSIT.
  if(n.startsWith('229-')&&origin==='KWI'&&destination==='DEL'){
    const stop=[row.via,row.transitAirport,row.routeVia,row.connectionAirport,row.hub]
      .map(airportCode).find(code=>code&&code!==origin&&code!==destination);
    return stop||'';
  }
  const explicit=[row.via,row.transitAirport,row.routeVia,row.connectionAirport,row.hub].map(airportCode).find(Boolean);
  if(explicit)return explicit;
  const departureDestination=airportCode(row.departureDestination);
  if(departureDestination&&departureDestination!==destination)return departureDestination;
  const airport=airportCode(row.airport);
  if(airport&&airport!==origin&&airport!==destination)return airport;
  const current=airportCode(row.currentLocation);
  if(current&&current!==origin&&current!==destination)return current;
  // Verified operating patterns requested for Mayavi display when the source does not expose a via field.
  if(n.startsWith('065-')&&origin==='DMM'&&destination&&destination!=='RUH')return'RUH';
  if(n.startsWith('910-')&&origin!=='MCT'&&destination&&destination!=='MCT')return'MCT';
  return origin||'';
}
function businessStatus(raw='',timingStatus='',arrivalDate='',mawb='',row={}){
  const s=String(raw||'').toUpperCase();
  const n=normalize(mawb);
  const via=viaForRow(row).toUpperCase();
  const origin=String(row.origin||'').toUpperCase(),destination=String(row.destination||'').toUpperCase();
  const directDelhi=destination==='DEL'&&!via;
  // A missed Ethiopian final-leg ETA must remain visible as RESCHEDULED,
  // not be collapsed to BOOKED by the generic display mapper.
  if(s.includes('RESCHEDUL'))return'RESCHEDULED';
  if(n.startsWith('229-')&&origin==='KWI'&&destination==='DEL'&&!via
     &&row.kuwaitCargoDepartureConfirmed===true
     &&(s==='DEPARTED'||s==='IN TRANSIT'||s==='DEP'))return'DEPARTED';
  if(n.startsWith('065-')&&String(row.sourceStatus||'').toUpperCase()==='FOW'&&row.arrivalIsActual!==true&&s==='IN TRANSIT')return'EXPECTED';
  if(s.includes('PART ARRIVED'))return'PART ARRIVED';
  if(s.includes('PART DEPARTED')||s.includes('PART SHIPMENT')||s.includes('PART LOAD'))return'PART LOAD';
  if(s.includes('DELIVER'))return'DELIVERED';
  // Thai CHORUS destination RCF is an actual arrival even when a BKK via leg
  // remains in saved departureDestination. Do not let the via heuristic undo it.
  if(n.startsWith('217-')&&row.arrivalIsActual===true&&
     airportCode(row.destination)&&s==='ARRIVED')return'ARRIVED';
  const arrivedSignal=s.includes('ARRIVED')||s.includes('DESTINATION')||s.includes('LANDED')||s.includes('RCF');
  if(arrivedSignal){
    const finalDestination=airportCode(row.destination);
    const movementStation=explicitMovementStation(row);
    const explicitVia=explicitViaForStatus(row);
    if(finalDestination&&((movementStation&&movementStation!==finalDestination)||(!movementStation&&explicitVia&&airportCode(row.departureDestination)===explicitVia)))return'IN TRANSIT';
    return'ARRIVED';
  }
  if(s.includes('OFFLOAD')){
    // IndiGo status history can legitimately contain BOTH DEP and a later
    // offload. Keep both events visible while latest airline status remains
    // offloaded; neither event confirms cargo arrival at DEL.
    if(n.startsWith('312-')&&row._partKey&&row.departureConfirmed===true&&row.offloadedAfterDeparture===true){
      return 'DEPARTED → OFFLOADED';
    }
    return 'OFFLOADED';
  }
  if(s.includes('DELAY')||s.includes('LATE'))return'DELAYED';
  // Emirates: a generic DEP can be an intermediate/via leg. Only the parser's
  // explicit final-leg departure should display DEPARTED; otherwise keep it IN TRANSIT.
  if(n.startsWith('176-')&&(s.includes('IN TRANSIT')||s==='DEP'||s.includes('DEPART')))return s==='DEPARTED'?'DEPARTED':'IN TRANSIT';
  if(s.includes('DEPART')||s.includes('AIRBORNE')||s.includes('IN FLIGHT')||s==='DEP')return'DEPARTED';
  if((n.startsWith('065-')||via==='RUH')&&(s.includes('FOW')||s.includes('FOH')||s.includes('TRANSIT')||s.includes('IN TRANSIT')))return'IN TRANSIT';
  if(s.includes('IN TRANSIT')||s.includes('TRANSIT'))return directDelhi?'DEPARTED':'IN TRANSIT';
  if(timingStatus==='EARLY'||s.includes('EARLY'))return'EARLY ARRIVAL';
  if(timingStatus==='DELAYED')return'DELAYED';
  if(s.includes('PRE-MANIFEST'))return'PRE-MANIFESTED';
  if((n.startsWith('229-')||n.startsWith('098-'))&&s==='MANIFESTED')return'MANIFESTED';
  if(n.startsWith('098-')&&['BUILD UP','EXECUTED','ACCEPTED','FREIGHT ON HAND'].includes(s))return s;
  if(s.includes('MANIFEST')||s.includes('ACCEPT')||s.includes('BUILT')||s.includes('EXECUT')||s.includes('BOOK'))return'BOOKED';
  return'BOOKED';
}
// SAL's FOW is a Saudia-specific event. Other airlines' flight ETAs
// must never inherit the "EXPECTED (FOW)" label on the shared dashboard.
function expectedArrivalLabel(row={}){
  if(row.arrivalEstimate!==true)return'';
  const isSaudia=digits(row.mawb).startsWith('065');
  if(isSaudia){
    const stage=String(row.saudiaArrivalStage||'').toUpperCase();
    const event=String(row.sourceStatus||'').toUpperCase();
    if(stage==='CONFIRMED_ETA'||event==='DEP')return'FLIGHT DEPARTED • CONFIRMED ETA';
    if(stage==='ESTIMATED'||event==='FOW')return'ESTIMATED ARRIVAL • FOW';
  }
  return'EXPECTED ARRIVAL';
}
// Older saved Saudia rows can contain carrier event wording until the next live sync.
 // Display a business-friendly label only for prefix 065; never rewrite other airlines.
function shipmentDisplayRemarks(row={}){
  const original=String(row.remarks||'');
  return digits(row.mawb).startsWith('065')?original.replace(/\bFOW\b/gi,'Loaded (FOW)'):original;
}
function tone(status=''){const s=String(status).toUpperCase();if(s.includes('OFFLOAD')||s.includes('RESCHEDUL'))return'delayed';if(s.includes('PART ARRIVED')||s.includes('PART LOAD'))return'transit';if(s.includes('DELIVER')||s.includes('ARRIVED'))return'arrived';if(s.includes('TRANSIT')||s.includes('DEPART')||s.includes('AIRBORNE')||s.includes('IN FLIGHT'))return'transit';if(s.includes('DELAY'))return'delayed';if(s.includes('EARLY'))return'early';return'booked'}
function trackingProgress(status=''){const s=String(status||'').toUpperCase();if(s.includes('DELIVER'))return 6;if(s.includes('ARRIVED')||s.includes('RCF')||s.includes('LANDED'))return 5;if(s.includes('DELAY')||s.includes('RESCHEDUL'))return 4;if(s.includes('TRANSIT')||s.includes('DEPART')||s.includes('AIRBORNE')||s.includes('IN FLIGHT'))return 3;if(s.includes('BOOK')||s.includes('ACCEPT')||s.includes('MANIFEST'))return 2;return 0}
function recoverTurkishLocal(server={},local={}){
  const out={...server};let changed=false;
  const keys=['bookingDate','bookingTime','flightNo','flightDate','origin','destination','via','bags','pieces','weight','volume','departureDate','departureTime','departureFlightNo','departureOrigin','departureDestination','scheduledDeparture','scheduledArrivalDate','scheduledArrivalTime','arrivalDate','arrivalTime','actualArrivalDate','actualArrivalTime','actualArrival','deliveryStation','deliveryDate','deliveryTime','deliveredAt','arrivalTimeSource','departureTimeSource','source','provider'];
  for(const key of keys){
    const sv=out[key],lv=local?.[key];
    if((sv===''||sv===null||sv===undefined)&&lv!==''&&lv!==null&&lv!==undefined){out[key]=lv;changed=true}
  }
  if(local?.arrivalIsActual===true&&out.arrivalIsActual!==true){out.arrivalIsActual=true;changed=true}
  if(trackingProgress(local?.status)>trackingProgress(out.status)){out.status=local.status;changed=true}
  if(changed){
    out.trackingError='';
    out.manualHint='';
    out.localRecoveryAt=new Date().toISOString();
    out.source=out.source||'Recovered verified Turkish browser data';
  }
  return{row:out,changed};
}
function decorateTiming(existing={},incoming={}){
  const raw=enforceSaudiaArrivalEvidence({...existing,...incoming});
  // Malaysia final-arrival absence is an explicit value, not a missing value.
  // Never let scheduled/legacy fields rebuild a stale arrival after refresh.
  if((normalize(incoming.mawb||existing.mawb||existing.awb||'').startsWith('232-')||normalize(incoming.mawb||existing.mawb||existing.awb||'').startsWith('098-'))&&incoming.arrivalVerifiedAbsent===true){
    raw.arrivalDate=''; raw.arrivalTime=''; raw.scheduledArrivalDate=''; raw.scheduledArrivalTime='';
  }
  const shipmentType=shipmentTypeOf(raw.shipmentType);
  const exportLike=isExportLikeType(shipmentType);
  const arrivalChanged=Object.prototype.hasOwnProperty.call(incoming,'arrivalDate')||Object.prototype.hasOwnProperty.call(incoming,'arrivalTime');
  const departureChanged=Object.prototype.hasOwnProperty.call(incoming,'departureDate')||Object.prototype.hasOwnProperty.call(incoming,'departureTime')||Object.prototype.hasOwnProperty.call(incoming,'flightDate');
  const scheduledChanged=Object.prototype.hasOwnProperty.call(incoming,'scheduledArrivalDate')||Object.prototype.hasOwnProperty.call(incoming,'scheduledArrivalTime');
  const merged=normalizeExportTimesToIst({
    ...raw,
    shipmentType,
    arrivalTimeZone:arrivalChanged?(incoming.arrivalTimeZone||''):(raw.arrivalTimeZone||''),
    departureTimeZone:departureChanged?(incoming.departureTimeZone||''):(raw.departureTimeZone||''),
    scheduledArrivalTimeZone:scheduledChanged?(incoming.scheduledArrivalTimeZone||''):(raw.scheduledArrivalTimeZone||'')
  });
  if(normalize(incoming.mawb||existing.mawb||existing.awb||'').startsWith('160-')){
    Object.assign(merged,guardCathayFinalArrival(merged));
  }
  const via=viaForRow(merged);

  const rowMawb=normalize(incoming.mawb||existing.mawb||existing.awb||'');
  const scheduledArrivalDate=merged.scheduledArrivalDate||merged.arrivalDate||'';
  const scheduledArrivalTime=merged.scheduledArrivalTime||merged.arrivalTime||'';
  const saudiaMawb=normalize(rowMawb).startsWith('065-');
  const saudiaFlightDate=String(merged.flightDate||'').match(/^(20\d{2}-\d{2}-\d{2})/)?.[1]||'';
  const hasIncomingArrivalDate=Object.prototype.hasOwnProperty.call(incoming,'arrivalDate');
  // SAL flightDate alone is a planned flight, never AWB arrival evidence.
  const arrivalDate=hasIncomingArrivalDate?(merged.arrivalDate||''):(merged.arrivalDate||'');
  const arrivalTime=Object.prototype.hasOwnProperty.call(incoming,'arrivalTime')?(merged.arrivalTime||''):(merged.arrivalTime||'');

  const planned=dateTimeValue(scheduledArrivalDate,scheduledArrivalTime);
  const current=dateTimeValue(arrivalDate,arrivalTime);
  let timingDeltaMinutes=null,timingStatus='';
  if(planned&&current){
    timingDeltaMinutes=Math.round((current-planned)/60000);
    timingStatus=timingDeltaMinutes>60?'DELAYED':timingDeltaMinutes<-60?'EARLY':'ON TIME';
  }

  const rawStatus=incoming.status||existing.status||'';
  const status=businessStatus(rawStatus,timingStatus,arrivalDate,incoming.mawb||existing.mawb||existing.awb||'',merged);
  const wasDelayed=existing.wasDelayed===true||incoming.wasDelayed===true||String(existing.status||'').toUpperCase().includes('DELAY')||String(incoming.status||'').toUpperCase().includes('DELAY')||existing.timingStatus==='DELAYED'||incoming.timingStatus==='DELAYED'||timingStatus==='DELAYED';
  const movedAfterDelay=wasDelayed&&(status==='DEPARTED'||status==='IN TRANSIT'||status==='ARRIVED'||status==='PART ARRIVED');
  const remarks=movedAfterDelay
    ? (merged.remarks?String(merged.remarks).includes('Flight was delayed')?merged.remarks:`${merged.remarks} / Flight was delayed`:'Flight was delayed')
    : (merged.remarks||'');

  const hasIncomingFlight=Object.prototype.hasOwnProperty.call(incoming,'flightNo')||Object.prototype.hasOwnProperty.call(incoming,'flight');
  const airAsiaLegs=rowMawb.startsWith('807-')&&Array.isArray(merged.flightSchedule)?merged.flightSchedule:[];
  const airAsiaOriginLeg=airAsiaLegs.find(leg=>leg.origin===merged.origin)||airAsiaLegs[0]||null;
  const airAsiaFinalLeg=airAsiaLegs.filter(leg=>leg.destination===merged.destination).at(-1)||airAsiaLegs.at(-1)||null;
  const airAsiaSelectedFlight=rowMawb.startsWith('807-')?(exportLike?(airAsiaOriginLeg?.flightNo||merged.departureFlightNo||merged.firstFlightNo):(airAsiaFinalLeg?.flightNo||merged.finalFlightNo)):'';
  const flightNo=normalizeFlightNo(rowMawb,airAsiaSelectedFlight||(hasIncomingFlight?(incoming.flightNo||incoming.flight||''):(existing.flightNo||existing.flight||'')));
  const bookingDate=incoming.bookingDate||existing.bookingDate||'';
  const bookingTime=incoming.bookingTime||existing.bookingTime||'';
  const mailArrivalDate=String(arrivalDate||'').split('/').map(x=>x.trim()).filter(Boolean).at(-1)||'';
  const mailTime=isImportLikeType(shipmentType)?mailTimeFrom(mailArrivalDate,arrivalTime):'';
  const mailSent=isImportLikeType(shipmentType)?merged.mailSent===true:undefined;
  const customsCleared=isImportLikeType(shipmentType)?merged.customsCleared===true:undefined;
  const masterCopyReceived=exportLike?merged.masterCopyReceived===true:undefined;
  const departureDate=exportLike?(rowMawb.startsWith('807-')&&merged.departureIsActual!==true?(airAsiaOriginLeg?.date||merged.scheduledDepartureDate||merged.departureDate||''):(merged.departureDate||merged.flightDate||'')):merged.departureDate;
  const departureTime=exportLike?(merged.departureTime||merged.etd||merged.estimatedDepartureTime||merged.scheduledDepartureTime||''):merged.departureTime;
  const handoverTime=exportLike?handoverTimeFrom(departureDate,departureTime):'';
  const handoverDone=exportLike?merged.handoverDone===true:undefined;

  return resolveSaudiaArrivedMasterFlight({...merged,via,flightNo,bookingDate,bookingTime,destination:merged.destination||'',shipmentType,departureDate,departureTime,handoverTime,handoverDone,scheduledArrivalDate,scheduledArrivalTime,arrivalDate,arrivalTime,arrivalIsActual:Boolean(merged.arrivalIsActual),timingDeltaMinutes,timingStatus,status,wasDelayed,remarks,mailTime,mailSent,customsCleared,masterCopyReceived});
}
function clientStyle(name=''){const s=String(name||'').trim();if(!s)return{};let h=0;for(let i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))%360;return {backgroundColor:`hsl(${h} 75% 92%)`,color:`hsl(${h} 48% 28%)`,borderColor:`hsl(${h} 55% 76%)`}}
function officialUrl(row={}){
  const n=normalize(row.mawb),airline=airlineForMawb(n),serial=n.slice(4),allDigits=digits(n);
  // Only add carrier-published MAWB detail routes. Do not change any shipment tracking logic.
  // Flydubai (FZ/141): official Accelya Search & Track document route.
  // Prefill this row's AWB when the operator clicks the carrier link.
  if(n.startsWith('098-'))return 'https://aicargoportal.airindia.com/icargoneoportal/app/main/#/app';
  if(n.startsWith('141-'))return `https://prdonofz.accelya.io/app/offerandorder/#/shipments/list?type=D&values=${encodeURIComponent(allDigits)}`;
  // Emirates e-SkyCargo uses the same published Search & Track deep-link format.
  // THAI CHORUS legacy GET AWB link. Prefills prefix/serial when supported
  // by the carrier; clipboard fallback is already provided by openOfficial().
  if(n.startsWith('217-'))return `https://chorus.thaicargo.com/skychain/app?PID=WEB01-10&doc_typ=AWB&awb_pre=217&awb_no=${encodeURIComponent(serial)}`;
  if(n.startsWith('176-'))return `https://eskycargo.emirates.com/app/offerandorder/#/shipments/list?type=D&values=${encodeURIComponent(allDigits)}`;
  if(n.startsWith('020-'))return `https://www.lufthansa-cargo.com/en/eservices/etracking/awb-details/-/awb/020/${encodeURIComponent(serial)}`;
  if(n.startsWith('075-')||n.startsWith('125-'))return `https://www.iagcargo.com/iagcargo/portlet/en/html/601/main/search?awb.cia=${n.slice(0,3)}&awb.cod=${encodeURIComponent(serial)}`;
  if(n.startsWith('074-'))return `https://afklcargo.com/mycargo/shipment/detail/${digits(n)}`;
  if(n.startsWith('157-'))return `https://www.qrcargo.com/s/track-your-shipment?documentNumber=${encodeURIComponent(serial)}&documentPrefix=157&documentType=MAWB`;
  if(n.startsWith('232-'))return `https://www.maskargo.com/en/shipment-tracking.html?prefixNumber=232&awbNumber=${encodeURIComponent(serial)}`;
  if(n.startsWith('607-'))return `https://www.etihadcargo.com/en/e-services/track-shipment?awb=${encodeURIComponent(allDigits)}`;
  // Open only carrier-supported tracking deep links. The other airline links stay unchanged.
  if(n.startsWith('235-'))return `https://www.turkishcargo.com/en/online-services/shipment-tracking?awbInput=${encodeURIComponent(n)}&quick=True`;
  if(n.startsWith('312-'))return `https://6ecargo.goindigo.in/FrmAWBTracking.aspx?AWBNo=${encodeURIComponent(serial)}&AWBPrefix=312`;
  if(n.startsWith('807-'))return `https://airasia.smartkargo.com/FrmAWBTracking.aspx?AWBNo=${encodeURIComponent(serial)}&AWBPrefix=807`;
  if(n.startsWith('514-'))return 'https://airarabia-g9.ibsplc.aero/icargoneoportal/app/main/#/app';
  return airline?.url||row.officialTracker||'';
}
function officialHasDirectMawb(row={}){const n=normalize(row.mawb);return ['020-','074-','075-','125-','141-','157-','176-','217-','232-','235-','312-','607-','807-'].some(prefix=>n.startsWith(prefix))}
function copyOfficialAwb(awb=''){
  const full=digits(awb);if(!/^\d{11}$/.test(full))return false;
  // Air India Cargo uses one AWB Number field containing all 11 digits.
  const value=full;
  // Synchronous copy fallback matters: the carrier page opens in another tab,
  // and async clipboard writes can lose focus/user activation during that switch.
  try{
    const field=document.createElement('textarea');
    field.value=value;
    field.setAttribute('readonly','');
    field.style.position='fixed';field.style.opacity='0';field.style.pointerEvents='none';
    document.body.appendChild(field);field.select();
    const copied=document.execCommand('copy');
    field.remove();
    if(copied)return true;
  }catch{}
  try{navigator.clipboard?.writeText(value).catch(()=>{})}catch{}
  return false;
}
function openOfficial(row={}){
  const n=normalize(row.mawb),url=officialUrl(row);if(!url)return;
  const copied=copyOfficialAwb(n);
  window.open(url,'_blank','noopener,noreferrer');
  return copied;
}
function dbToRow(record={}){const d=record.data||{};return decorateTiming({}, {...d,mawb:normalize(d.mawb||d.awb||record.awb),clientName:d.clientName??d.client??'',companyType:d.companyType||'',companyName:d.companyName||'',airlineName:d.airlineName??d.airline??'',carrierCode:d.carrierCode??d.airlineCode??'',flightNo:d.flightNo??d.flight??'',pieces:d.pieces??d.bags??'',bags:d.bags??d.pieces??'',weight:cleanWeight(d.weight),goodsDescription:d.goodsDescription??d.goods_description??'',bookingDate:d.bookingDate||'',shipmentType:shipmentTypeOf(d.shipmentType),officialTracker:d.officialTracker||d.sourceUrl||'',enteredBy:d.enteredBy||'',enteredByUsername:d.enteredByUsername||'',enteredAt:d.enteredAt||'',mailSent:isImportLikeType(d.shipmentType)?d.mailSent===true:undefined,customsCleared:isImportLikeType(d.shipmentType)?d.customsCleared===true:undefined,masterCopyReceived:isExportLikeType(d.shipmentType)?d.masterCopyReceived===true:undefined,lastChecked:d.lastChecked||record.tracking_checked_at||record.updated_at||'',_dbUpdatedAt:record.updated_at||''})}
function withoutMeta(row={}){const {_dbUpdatedAt,...clean}=row;return clean}
function hasIndependentCustomsParts(row={}){
  // Only rows which actually expand into physical part rows can be archived
  // individually; a repeat/full-load flight does not qualify.
  return expandPartRows([row]).some(part=>Boolean(part._partKey));
}
// Customs Cleared Import is a live, IST-calendar-month view.
function importArrivalMonth(value=''){
  const raw=String(value||'').trim();
  let m=raw.match(/^(20\d{2})[-/](\d{1,2})[-/](\d{1,2})(?:\D|$)/);
  let year,month,day;
  if(m){year=Number(m[1]);month=Number(m[2]);day=Number(m[3]);}
  else{
    m=raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](20\d{2})(?:\D|$)/);
    if(!m)return'';
    day=Number(m[1]);month=Number(m[2]);year=Number(m[3]);
  }
  const d=new Date(Date.UTC(year,month-1,day));
  if(d.getUTCFullYear()!==year||d.getUTCMonth()+1!==month||d.getUTCDate()!==day)return'';
  return year+'-'+pad(month);
}
function currentImportIstMonth(){
  const items=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit'}).formatToParts(new Date());
  return items.find(x=>x.type==='year')?.value+'-'+items.find(x=>x.type==='month')?.value;
}
function isCustomsArchived(row={}){const kuwait=consolidatedKuwaitDeparture(row);return isImportLikeType(row.shipmentType)&&(kuwait?kuwait.customsCleared===true:row.customsCleared===true)}
function isExportArchived(row={}){return isExportLikeType(row.shipmentType)&&row.handoverDone===true&&row.masterCopyReceived===true}
function isPartArrived(row={}){return String(row.status||'').toUpperCase().includes('PART ARRIVED')}
// Thai AirAsia's 900 SmartKargo record can confirm its 31 Oct final
// booking without confirming the flight/cargo has landed at DEL. Keep the
// confirmed-arrival fields empty in the database but show the matching
// scheduled final-leg ETA with an unambiguous pending label in the UI.
function airAsiaScheduledFinalArrival(row={}){
  if(!digits(row.mawb||row.awb||'').startsWith('900')||
    row.arrivalIsActual===true||row.arrivalVerifiedAbsent!==true)return null;
  const date=String(row.scheduledArrivalDate||'').slice(0,10);
  const time=formatTime24(row.scheduledArrivalTime||'');
  const destination=String(row.destination||'').toUpperCase();
  const finalDestination=String(row.finalFlightDestination||'').toUpperCase();
  if(!/^20\d{2}-\d{2}-\d{2}$/.test(date)||destination!=='DEL'||
    (finalDestination&&finalDestination!==destination))return null;
  return{date,time};
}
function arrivalSortTime(row={}){
 const scheduled=airAsiaScheduledFinalArrival(row);
 const d=dateTimeValue(row.arrivalDate||scheduled?.date,row.arrivalTime||scheduled?.time);
 return d?d.getTime():Number.POSITIVE_INFINITY;
}
function mailTimeForRow(row={}){
  // Match the Mail Time column, including a provisional Emirates MAWB-level ETA.
  // No part-specific arrival is inferred when the connecting part is unconfirmed.
  return formatDateTime24(row.mailTime)||
    mailTimeFrom(row.arrivalDate,row.arrivalTime)||
    ((airAsiaScheduledFinalArrival(row)?.time)?mailTimeFrom(airAsiaScheduledFinalArrival(row).date,airAsiaScheduledFinalArrival(row).time):'')||
    (row._emiratesMasterEta?mailTimeFrom(row._emiratesMasterEta.date,row._emiratesMasterEta.time):'');
}
// Flash only overdue, unmailed Import entries. The displayed Mail Time is IST.
function importMailOverdue(row={},nowMs=Date.now()){
  if(row.mailSent===true||row._saudiaPendingVirtual===true)return false;
  // Saudia only: FOW/EXPECTED is not departure. Blink NO only after DEP or
  // AWB-verified actual arrival, while retaining the existing overdue clock.
  if(digits(row.mawb).startsWith('065')){
    const movement=String(row.status||'').toUpperCase();
    const event=String(row.sourceStatus||'').toUpperCase();
    if(event==='FOW'||!(movement==='DEPARTED'||event==='DEP'||row.arrivalIsActual===true||row._partArrivalConfirmed===true))return false;
  }
  const m=mailTimeForRow(row).match(/^(20\d{2}-\d{2}-\d{2})\s+(\d{2}:\d{2})$/);
  if(!m)return false;
  const wallClock=istDateTimeValue(m[1],m[2]);
  return Boolean(wallClock&&nowMs>=wallClock.getTime()-330*60*1000);
}
function mailSortTime(row={}){
  const value=mailTimeForRow(row),date=value.slice(0,10),time=value.slice(11);
  return istDateTimeValue(date,time)?.getTime()??Number.POSITIVE_INFINITY;
}
// Export NO blinks as soon as the displayed handover deadline (-5h) passes in IST.
function exportHandoverOverdue(row={},nowMs=Date.now()){
  if(row.handoverDone===true)return false;
  const displayed=formatDateTime24(row.handoverTime||handoverTimeFrom(row.departureDate||row.flightDate||'',row.departureTime||''));
  const m=displayed.match(/^(20\d{2}-\d{2}-\d{2})\s+(\d{2}:\d{2})$/);
  if(!m)return false;
  const wallClock=istDateTimeValue(m[1],m[2]);
  return Boolean(wallClock&&nowMs>=wallClock.getTime()-330*60*1000);
}
function handoverSortTime(row={}){const d=dateTimeValue(row.departureDate||row.flightDate||'',row.departureTime||'');if(!d)return Number.POSITIVE_INFINITY;d.setHours(d.getHours()-5);return d.getTime()}
function priorityValue(row={}){const s=String(row.status||'').toUpperCase();if(s.includes('ARRIVED')&&!s.includes('PART ARRIVED'))return 0;if(s.includes('PART ARRIVED'))return 1;if(s.includes('IN TRANSIT')||s.includes('TRANSIT')||s.includes('DEPART')||s.includes('AIRBORNE')||s.includes('IN FLIGHT'))return 2;if(s.includes('DELAY')||s.includes('RESCHEDUL'))return 3;return 4}
function sortPriority(list=[]){return [...list].sort((a,b)=>{const p=priorityValue(a)-priorityValue(b);if(p)return p;const at=arrivalSortTime(a),bt=arrivalSortTime(b);if(at!==bt)return at-bt;return (Date.parse(b.lastChecked||b._dbUpdatedAt||0)||0)-(Date.parse(a.lastChecked||a._dbUpdatedAt||0)||0)})}
// A flight has one dated ETA, even when several Saudia MAWBs share it.
// A timestamp explicitly marked as a live/estimated flight arrival takes
// precedence over older scheduled clocks. Actual cargo-part arrival is never
// propagated to another MAWB or physical part.
function harmonizeSaudiaFlightEtas(viewRows=[],sourceRows=viewRows){
  const flightInfo=(r,parent={})=>{
    const mawb=r.mawb||parent.mawb||'';
    if(!digits(mawb).startsWith('065'))return null;
    const flight=normalizeFlightNo(mawb,r.flightNo||parent.flightNo||'');
    const date=String(r.arrivalDate||r.flightDate||parent.arrivalDate||'').slice(0,10);
    const destination=String(r.destination||parent.destination||'').toUpperCase();
    // Never spread an ETA between a JED/RUH connecting flight and a DEL flight.
    const legDest=String(r.flightDestination||(!r.flightNo?parent.flightDestination:'')||'').toUpperCase();
    if(legDest&&legDest!==destination)return null;
    if(!/^SV\d{2,4}$/.test(flight)||!/^20\d{2}-\d{2}-\d{2}$/.test(date)||destination!=='DEL')return null;
    return {key:flight+'|'+date+'|DEL',date,flight};
  };
  const latestByFlight=new Map();
  for(const master of sourceRows){
    for(const candidate of [master,...(Array.isArray(master.partShipments)?master.partShipments:[])]){
      if(candidate.arrivalIsActual===true)continue;
      const info=flightInfo(candidate,master);
      if(!info)continue;
      const time=formatTime24(candidate.arrivalTime||'');
      const source=String(candidate.arrivalTimeSource||'');
      if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)||
        !/(?:live estimated|estimated arrival|flight-status ETA|predicted arrival)/i.test(source))continue;
      const fresh=Date.parse(master.lastChecked||master._dbUpdatedAt||'')||0;
      const previous=latestByFlight.get(info.key);
      if(!previous||fresh>previous.fresh)
        latestByFlight.set(info.key,{...info,time,source,fresh});
    }
  }
  if(!latestByFlight.size)return viewRows;
  return viewRows.map(master=>{
    const info=flightInfo(master);
    const latest=info&&latestByFlight.get(info.key);
    if(!latest||master.arrivalIsActual===true)return master;
    const matchingPart=part=>{
      const pInfo=flightInfo(part,master);
      if(!pInfo||pInfo.key!==latest.key||part.arrivalIsActual===true||
        !/^(DEPARTED|IN TRANSIT|EXPECTED)$/i.test(String(part.status||'')))return part;
      return {...part,arrivalTime:latest.time,arrivalEstimate:true,arrivalIsActual:false,
        arrivalTimeSource:latest.source+'; shared matching dated Saudia flight ETA (not actual cargo arrival)'};
    };
    return {...master,arrivalTime:latest.time,arrivalEstimate:true,arrivalIsActual:false,
      arrivalTimeSource:latest.source+'; shared matching dated Saudia flight ETA (not actual cargo arrival)',
      partShipments:Array.isArray(master.partShipments)?master.partShipments.map(matchingPart):master.partShipments};
  });
}
// SAL FOW or RCS is not confirmed offload. After the rapid departure window,
// label a still-unconverted FOW as a check item ONLY when SAL itself has
// confirmed DEP for the same dated flight on another movement.
function saudiaFowNeedsOffloadCheck(part={},masters=[],now=Date.now()){
  const mawb=digits(part.mawb);
  if(!mawb.startsWith('065')||!/^(?:FOW|RCS)$/.test(String(part.sourceStatus||'').toUpperCase())||part.arrivalIsActual===true)return false;
  const flight=normalizeFlightNo(part.mawb,part.flightNo||'');
  const date=String(part.flightDate||part.arrivalDate||'').slice(0,10);
  const dparts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(now));
  const df=x=>dparts.find(p=>p.type===x)?.value||'';
  const istToday=df('year')+'-'+df('month')+'-'+df('day');
  if(!flight||!/^20\d{2}-\d{2}-\d{2}$/.test(date)||date!==istToday)return false;
  const cutoff=Date.parse(date+'T15:00:00+05:30');
  const freshCutoff=Date.parse(date+'T14:30:00+05:30');
  if(now<cutoff||(Date.parse(part.lastChecked||part._dbUpdatedAt||0)||0)<freshCutoff)return false;
  return masters.some(master=>{
    if(!digits(master.mawb).startsWith('065'))return false;
    const updated=Date.parse(master.lastChecked||master._dbUpdatedAt||0)||0;
    if(updated<freshCutoff)return false;
    const matches=x=>normalizeFlightNo(master.mawb,x.flightNo||master.flightNo||'')===flight&&
      String(x.flightDate||x.arrivalDate||master.flightDate||master.arrivalDate||'').slice(0,10)===date;
    return (String(master.sourceStatus||'').toUpperCase()==='DEP'&&matches(master))||
      (Array.isArray(master.partShipments)&&master.partShipments.some(p=>
        String(p.status||'').toUpperCase()==='DEPARTED'&&matches(p)));
  });
}
function saudiaDisplayPriority(row={}){
  const s=String(row.status||'').toUpperCase();
  if(s==='DEPARTED'||s==='DEP')return 0;
  if(s==='IN TRANSIT'||s==='EXPECTED'||String(row.sourceStatus||'').toUpperCase()==='FOW')return 1;
  if(s==='ARRIVED'||s==='PART ARRIVED')return 2;
  return 3;
}
function sortForDashboard(list=[],activeTab='IMPORT'){
  if(isExportLikeType(activeTab))return [...list].sort((a,b)=>{const ah=handoverSortTime(a),bh=handoverSortTime(b);if(ah!==bh)return ah-bh;return (Date.parse(b.lastChecked||b._dbUpdatedAt||0)||0)-(Date.parse(a.lastChecked||a._dbUpdatedAt||0)||0)});
  return [...list].sort((a,b)=>{
    if(digits(a.mawb).startsWith('065')&&digits(b.mawb).startsWith('065')){
      // Pre-arrival mail deadlines take precedence over older arrived parts.
      const at=mailSortTime(a),bt=mailSortTime(b);
      if(at!==bt&&(Number.isFinite(at)||Number.isFinite(bt)))return at-bt;
      const rank=saudiaDisplayPriority(a)-saudiaDisplayPriority(b);
      if(rank)return rank;
    }
    const am=mailSortTime(a),bm=mailSortTime(b);
    if(am!==bm)return am-bm;
    const p=priorityValue(a)-priorityValue(b);
    if(p)return p;
    return (Date.parse(b.lastChecked||b._dbUpdatedAt||0)||0)-(Date.parse(a.lastChecked||a._dbUpdatedAt||0)||0);
  });
}
// A SAL DEP part sometimes has a flight/date but no own arrival clock.
// A published MAWB ETA may be used ONLY if the part matches that exact flight,
// date and destination. It is explicitly an estimate, never actual cargo ARR.
function saudiaMatchingPartEta(master={},part={}){
  if(part.arrivalIsActual===true||String(part.arrivalTime||'').trim())return'';
  if(!/^(DEPARTED|IN TRANSIT)$/i.test(String(part.status||'')))return'';
  if(String(master.destination||'').toUpperCase()!=='DEL')return'';
  if(part.flightDestination&&String(part.flightDestination).toUpperCase()!=='DEL')return'';
  if(master.flightDestination&&String(master.flightDestination).toUpperCase()!=='DEL')return'';
  const flight=normalizeFlightNo(master.mawb,master.flightNo||'');
  const partFlight=normalizeFlightNo(master.mawb,part.flightNo||'');
  const date=String(master.arrivalDate||'').slice(0,10);
  const partDate=String(part.arrivalDate||part.flightDate||'').slice(0,10);
  const flightDate=String(part.flightDate||'').slice(0,10);
  const eta=formatTime24(master.arrivalTime||'');
  if(!flight||flight!==partFlight||!date||date!==partDate||date!==flightDate||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(eta)||master.arrivalIsActual===true)return'';
  return eta;
}
// Saudia SAL can publish a physical part's MAN flight/date before it publishes
// that part's arrival fields. Render the manifest date immediately. Only show
// a provisional arrival clock if the master ETA matches this same flight/date.
// Never treat a manifest as a confirmed arrival or backfill a different flight.
function saudiaManifestPlan(master={},part={}){
  // A MAN flight date belongs in flight planning, NOT the Arrival columns.
  // Estimated/confirmed dates show only after AWB-specific SAL FOW/DEP.
  if(!/^(FOW|DEP)$/.test(String(part.sourceStatus||'').toUpperCase()))return null;
  if(part.arrivalDate||part.arrivalIsActual===true)return null;
  // Hub-bound MAN/FOW flight dates are NOT Delhi arrival dates.
  if(part.flightDestination&&String(part.flightDestination).toUpperCase()!==String(master.destination||'').toUpperCase())return null;
  const flightDate=String(part.flightDate||'').slice(0,10);
  if(!/^20\d{2}-\d{2}-\d{2}$/.test(flightDate))return null;
  const partFlight=normalizeFlightNo(master.mawb,part.flightNo);
  const masterFlight=normalizeFlightNo(master.mawb,master.flightNo);
  const masterDate=String(master.arrivalDate||'').slice(0,10);
  const masterTime=formatTime24(master.arrivalTime||'');
  const matched=Boolean((!master.flightDestination||String(master.flightDestination).toUpperCase()==='DEL')&&
    partFlight&&masterFlight&&partFlight===masterFlight&&
    masterDate===flightDate&&/^([01]\d|2[0-3]):[0-5]\d$/.test(masterTime)&&
    master.arrivalIsActual!==true);
  return {date:matched?masterDate:flightDate,time:matched?masterTime:'',
    label:matched?'DEL FLIGHT • PLANNED ETA':'DEL FLIGHT DATE • ETA PENDING'};
}
function expandPartRows(list=[]){
  return list.flatMap(savedRow=>{
    // A saved Saudia master can contain a confirmed SV1125 50-bag DEP in
    // partLoadHistory while its older partShipments array only contains the
    // 49 bags which reached DEL. Reconstruct the missing pending part in view
    // even before the background SAL refresh writes it to Neon.
    const row=digits(savedRow.mawb).startsWith('065')
      ?enforceSaudiaArrivalEvidence(guardSaudiaConnectingFlightWithoutSal(savedRow)):savedRow;
    const prefix=digits(row.mawb).slice(0,3);
    // Kuwait: one verified full-master cargo DEP on the same KU flight is
    // one row, while 55/32 physical parts stay in stored audit history.
    // If a part arrives separately or clearance becomes mixed, unmerge.
    if(prefix==='229'){
      const one=consolidatedKuwaitDeparture(row);
      if(one)return[one];
    }
    if(prefix!=='065'&&prefix!=='098'&&prefix!=='312'&&prefix!=='176'&&prefix!=='229')return[row];

    const raw=Array.isArray(row.partShipments)?row.partShipments.filter(Boolean):[];
    const status=String(row.status||'').toUpperCase();
    const fractional=[row.bags,row.pieces,row.weight].some(v=>/^\s*[^/]+\/[^/]+\s*$/.test(String(v||'')));
    const genuinePartLoad=row.isPartLoad===true||row.partLoad===true||status.includes('PART ARRIVED')||status.includes('PART LOAD')||status.includes('PART SHIPMENT')||fractional;
    if(!genuinePartLoad)return[row];

    // A part row represents a physical movement. Arrival date/time can change
    // while that same part progresses, so they must NOT be used to decide that
    // another dashboard row exists.
    const seen=new Set(),parts=[];
    for(const p of raw){
      const identity=String(p.partKey||p.partId||'').trim()||[
        String(p.flightNo||'').trim().toUpperCase(),
        String(p.flightDate||p.departureDate||'').trim(),
        String(p.pieces||'').trim(),
        String(p.weight||'').replace(/,/g,'').trim()
      ].join('|');
      if(!identity||identity==='|||')continue;
      if(seen.has(identity)){
        // An older DEP card and the later confirmed ARR may share the same
        // physical part ID. Preserve the ARR whichever order SAL returned.
        if(prefix==='065'&&p.arrivalIsActual===true){
          const at=parts.findIndex(old=>String(old.partKey||old.partId||'')===identity);
          if(at>=0&&parts[at].arrivalIsActual!==true){
            const previous=parts[at];
            parts[at]={...p,
              mailSent:p.mailSent??previous.mailSent,
              mailUpdatedAt:p.mailUpdatedAt||previous.mailUpdatedAt||'',
              customsCleared:p.customsCleared??previous.customsCleared,
              customsClearedAt:p.customsClearedAt||previous.customsClearedAt||'',
              customsClearedBy:p.customsClearedBy||previous.customsClearedBy||''};
          }
        }
        continue;
      }
      seen.add(identity);
      parts.push(p);
    }

    // Saudia: mirror the physical split-load balance in Active Masters even when
    // SAL has no new MAN/FOW/DEP flight card for the remainder. This is the
    // general version of the original ZIP's DIS-only pending-balance row.
    // The record is VIEW ONLY: never invent a flight, ETA, DEP, ARR or Mail YES.
    // For example 065-11493661 must show 49/99 ARRIVED and 50/99 PENDING.
    // Never fabricate an unverified physical row by subtraction. A balance
    // row is permitted only with explicit SAL evidence, not total-minus-part.
    if(prefix==='065'&&row.saudiaVerifiedPendingBalance===true){
      const masterTotal=Number(row.totalPieces||row.masterPieces||String(row.bags||row.pieces||'').split('/').at(-1)||0);
      const recordedArrived=Number(row.arrivedPieces??0);
      const confirmedArrived=parts
        .filter(p=>p.arrivalIsActual===true)
        .reduce((sum,p)=>sum+(Number(p.pieces)||0),0);
      const arrived=Math.min(masterTotal,Math.max(recordedArrived,confirmedArrived));
      // Repeated DEP and ARR for the same physical flight/part identity must
      // count once, with the confirmed destination ARR taking precedence.
      const actualKeys=new Set(parts.filter(p=>p.arrivalIsActual===true)
        .map(p=>String(p.partKey||p.partId||'')));
      for(let i=parts.length-1;i>=0;i--){
        const p=parts[i];
        if(p.arrivalIsActual!==true&&actualKeys.has(String(p.partKey||p.partId||''))
          &&String(p.partKey||p.partId||''))parts.splice(i,1);
      }
      const unarrived=parts.filter(p=>p.arrivalIsActual!==true&&p._saudiaPendingVirtual!==true);
      let available=Math.max(0,masterTotal-arrived);
      // Accept only identifiable physical movements within the real balance.
      // Never overstate bag counts when SAL repeats an old DEP/FOW card.
      for(const p of unarrived){
        const q=Number(p.pieces)||0;
        if(q>0&&q<=available)available-=q;
        else {const at=parts.indexOf(p);if(at>=0)parts.splice(at,1);}
      }
      if(masterTotal>0&&parts.length>0&&available>0){
        const arrivedWeight=parts.filter(p=>p.arrivalIsActual===true)
          .reduce((sum,p)=>sum+(Number(p.weight)||0),0);
        const knownPendingWeight=parts.filter(p=>p.arrivalIsActual!==true)
          .reduce((sum,p)=>sum+(Number(p.weight)||0),0);
        const totalWeight=Number(row.totalWeight||row.masterWeight||0);
        const pendingWeight=Number(row.pendingWeight??row.remainingWeight??0);
        const remainderWeight=Math.max(0,(pendingWeight>0?pendingWeight:Math.max(0,totalWeight-arrivedWeight))-knownPendingWeight);
        const cancelled=row.disAfterFow===true||/^(?:DIS|DUS)$/i.test(String(row.sourceStatus||''));
        const balanceKey='SAL_PENDING_BALANCE|'+masterTotal+'|'+available;
        parts.push({
          partId:balanceKey,partKey:balanceKey,_saudiaPendingVirtual:true,
          pieces:available,totalPieces:masterTotal,
          weight:remainderWeight||'',totalWeight:totalWeight||'',
          flightNo:'',flightDate:'',flightDestination:'',transitAirport:'',
          arrivalDate:'',arrivalTime:'',arrivalIsActual:false,arrivalEstimate:false,
          status:cancelled?'OFFLOADED':'PENDING AT SAUDIA',
          sourceStatus:cancelled?'DIS':'RCS',mailSent:false,customsCleared:false,
          remarks:cancelled
            ?'SAL DIS/DUS — balance offloaded; awaiting next flight'
            :'Balance at Saudia — awaiting MAN/FOW/DEP flight assignment (not yet arrived)'
        });
      }
    }

    if(prefix==='065'&&status==='ARRIVED'&&parts.length>1){
      const masterCount=Number(row.totalPieces||row.masterPieces||0);
      const arrivedCount=Number(row.arrivedPieces||0);
      const allArrived=parts.every(p=>p.arrivalIsActual===true&&String(p.status||'').toUpperCase()==='ARRIVED');
      const actualTimes=new Set(parts.map(p=>[p.arrivalDate||'',p.arrivalTime||''].join(' ')));
      if(masterCount>0&&arrivedCount>=masterCount&&allArrived&&actualTimes.size===1)
        return[{...row,partLoad:false,isPartLoad:false}];
    }

    // Duplicate MAWB display is allowed only for a true split shipment with at
    // least two distinct physical parts. Otherwise always show one master row.
    // A single remaining Saudia physical part after DIS/DUS still owns its Mail flag.
    // Show that one part with its own YES/NO rather than switching to master Mail.
    const only=parts.length===1?parts[0]:null;
    const onlyWeight=only?partKg(only.weight):null;
    const fullWeight=masterKg(row);
    const onlyPieces=only?Number(only.pieces||0):0;
    const fullPieces=Number(String(only?.totalPieces||row.masterPieces||row.totalPieces||row.bags||row.pieces||'').split('/').at(-1));
    const singlePhysicalPart=Boolean(only&&(
      (onlyWeight!==null&&fullWeight!==null&&onlyWeight<fullWeight)||
      (onlyPieces>0&&Number.isFinite(fullPieces)&&fullPieces>onlyPieces)
    ));
    if(parts.length<2&&!singlePhysicalPart&&
      !(prefix==='065'&&parts.length===1&&(row.partLoad===true||row.isPartLoad===true)))
      return[{...row,partLoad:false,isPartLoad:false}];

    // IndiGo safeguard: if the master total is known and every movement carries
    // the full master quantity, this is offload/rebooking history, not part load.
    // A repeated MAWB row is allowed only when at least one physical movement is
    // smaller than the master total (for example 17/32 and 15/32).
    if(prefix==='312'){
      const total=Number(row.masterPieces||parts.find(p=>Number(p.totalPieces)>0)?.totalPieces||row.pieces||row.bags||0);
      if(total>0){
        const hasPartial=parts.some(p=>{const n=Number(p.pieces||0);return n>0&&n<total});
        if(!hasPartial)return[{...row,partLoad:false,isPartLoad:false}];
      }
    }

    // An Emirates MAWB may publish a final-destination ETA before it confirms
    // which connecting flight carries each split part. Show that published ETA
    // only as a clearly labelled MAWB-level reference, NEVER as a part's
    // confirmed arrival or part-specific ETA. A later verified individual
    // part date/time always takes precedence; the physical parts remain distinct.
    const emiratesMasterEta=prefix==='176'&&row.arrivalIsActual!==true&&
      parts.length>=2&&parts.every(part=>part.arrivalIsActual!==true)&&
      /(?:ETA|EXPECTED)/i.test(String(row.arrivalEvidence||''))&&
      /^20\d{2}-\d{2}-\d{2}$/.test(String(row.scheduledArrivalDate||row.arrivalDate||''))&&
      /^([01]\d|2[0-3]):[0-5]\d$/.test(String(row.scheduledArrivalTime||row.arrivalTime||''))
      ?{date:row.scheduledArrivalDate||row.arrivalDate,
        time:row.scheduledArrivalTime||row.arrivalTime}:null;

    const saudiaRcfByPart=prefix==='065'?matchSaudiaRcfParts(row,parts):[];
    return parts.map((p,idx)=>{const saudiaPlan=prefix==='065'?saudiaManifestPlan(row,p):null;const rcf=saudiaRcfByPart[idx];const saudiaEta=prefix==='065'?saudiaMatchingPartEta(row,p):'';return({...row,
      _saudiaManifestPlan:saudiaPlan,
      _saudiaTransitEta:prefix==='065'&&p.transitEstimatedArrivalDate&&p.transitEstimatedArrivalTime
        ?{date:p.transitEstimatedArrivalDate,time:p.transitEstimatedArrivalTime,station:p.transitEstimatedArrivalStation||p.flightDestination||'',label:p.transitEtaLabel||''}:null,
      _saudiaExpectedPart:prefix==='065'&&p.status==='IN TRANSIT',
      _emiratesMasterEta:emiratesMasterEta&&!p.arrivalDate&&!p.arrivalTime?emiratesMasterEta:null,
      _partKey:p._saudiaPendingVirtual?'':`${digits(row.mawb)}::${partIdentity(p,idx)}`,
      _saudiaPendingVirtual:p._saudiaPendingVirtual===true,
      _partIndex:idx,
      _partArrivalConfirmed:confirmedPartArrival(p),
      bags:p.totalPieces?`${p.pieces}/${p.totalPieces}`:(p.pieces||row.bags),
      pieces:p.totalPieces?`${p.pieces}/${p.totalPieces}`:(p.pieces||row.pieces),
      weight:p.totalWeight?`${p.weight}/${p.totalWeight}`:(p.weight||row.weight),
      flightNo:p.flightNo||'',
      flightDate:p.flightDate||'',
      departureDate:p.departureDate||'',
      departureTime:p.departureTime||'',
      departureConfirmed:p.departureConfirmed===true,
      offloadedAfterDeparture:p.offloadedAfterDeparture===true,
      offloadDate:p.offloadDate||'',
      offloadTime:p.offloadTime||'',
      arrivalDate:p.arrivalDate||'',
      arrivalTime:p.arrivalTime||saudiaEta||'',
      arrivalIsActual:p.arrivalIsActual===true,
      arrivalEstimate:p.arrivalEstimate===true||Boolean(saudiaEta),
      arrivalTimeSource:p.arrivalTimeSource||(saudiaEta?'Matching Saudia flight/date planned ETA; IST, not actual arrival':''),
      status:p.status||row.status,
      saudiaRcfFollowUp:Boolean(rcf),
      saudiaRcfStation:rcf?.station||'',
      saudiaRcfDate:rcf?.date||'',
      saudiaRcfPieces:rcf?.pieces||0,
      saudiaRcfEventId:rcf?.id||'',
      // Each Saudia physical part owns its own station and latest event. The
      // master may currently be at JED while another part already arrived DEL.
      airport:prefix==='065'?(p._saudiaPendingVirtual?'':p.arrivalIsActual===true?row.destination:(p.transitAirport||row.airport||'')):row.airport,
      currentLocation:prefix==='065'?(p._saudiaPendingVirtual?'SAUDIA PENDING':p.arrivalIsActual===true?row.destination:(p.transitAirport||row.currentLocation||'')):row.currentLocation,
      sourceStatus:prefix==='065'?(p.arrivalIsActual===true?'ARR':/^(ARR|DEP)$/.test(String(p.sourceStatus||'').toUpperCase())?String(p.sourceStatus).toUpperCase():p.status==='DEPARTED'?'DEP':p.status==='IN TRANSIT'?'FOW':row.sourceStatus):prefix==='229'?(p.sourceStatus||row.sourceStatus):row.sourceStatus,
      mailTime:mailTimeFrom(p.arrivalDate||'',p.arrivalTime||saudiaEta||'')||(saudiaPlan?.time?mailTimeFrom(saudiaPlan.date,saudiaPlan.time):''),
      mailSent:p.mailSent===true,
      mailUpdatedAt:p.mailUpdatedAt||'',
      customsCleared:p.customsCleared===true,
      customsClearedAt:p.customsClearedAt||'',
      customsClearedBy:p.customsClearedBy||'',
      remarks:p.remarks||'Part Shipment'
    });});
  });
}
function uniq(rows,key){return [...new Set(rows.map(r=>String(r?.[key]||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b))}
function dedupeRowsByMawb(list=[]){
  const byMawb=new Map();
  const freshness=(row={})=>Math.max(
    Date.parse(row._dbUpdatedAt||0)||0,
    Date.parse(row.lastChecked||0)||0,
    Date.parse(row.enteredAt||0)||0
  );
  for(const row of list){
    const key=digits(row?.mawb);
    if(!key)continue;
    const previous=byMawb.get(key);
    if(!previous||freshness(row)>freshness(previous))byMawb.set(key,row);
  }
  return [...byMawb.values()];
}
function stickyColumn(left,width,header=false){return {position:'sticky',left,zIndex:header?30:4,minWidth:width,width,background:header?'#f8fafc':'#fff',boxShadow:'1px 0 0 #e2e8f0'}}
function companyChoice(row={}){const t=String(row.companyType||'').toUpperCase(),n=String(row.companyName||'').trim();if(t==='KCC'||t==='PV'||t==='OTHER')return t;if(n.toUpperCase()==='KCC')return'KCC';if(n.toUpperCase()==='PV')return'PV';return n?'OTHER':''}
function companyFilterLabel(row={}){const type=companyChoice(row);return type==='OTHER'?(String(row.companyName||'').trim()||'Other'):type}

export default function DashboardClient({isAdmin=false,haryanaMode=false,currentUser=null,onLogout=null,onOpenSpeedPost=null,onOpenAdminNotes=null}){
  const [rows,setRows]=useState([]),[mawb,setMawb]=useState(''),[client,setClient]=useState(''),[busy,setBusy]=useState(false),[note,setNote]=useState(''),[loaded,setLoaded]=useState(false),[shared,setShared]=useState(false),[activeTab,setActiveTab]=useState('IMPORT');
  const [adminView,setAdminView]=useState('ACTIVE'),[clientFilter,setClientFilter]=useState(''),[originFilter,setOriginFilter]=useState(''),[destinationFilter,setDestinationFilter]=useState(''),[prefixFilter,setPrefixFilter]=useState('');
  const [goodsFilter,setGoodsFilter]=useState(''),[companyFilter,setCompanyFilter]=useState(''),[enteredByFilter,setEnteredByFilter]=useState('');
  const [currentImportMonth,setCurrentImportMonth]=useState(currentImportIstMonth);
  const [mailClock,setMailClock]=useState(Date.now());
  // Duplicate alerts persist on the original shared Active/Cleared master.
  const [duplicateFocus,setDuplicateFocus]=useState(null);
  useEffect(()=>{const id=setInterval(()=>setMailClock(Date.now()),15000);return()=>clearInterval(id)},[]);
  const rowsRef=useRef(rows);
  rowsRef.current=rows;
  useEffect(()=>{const timer=setInterval(()=>setCurrentImportMonth(currentImportIstMonth()),60000);return()=>clearInterval(timer)},[]);
  const employeeName=String(currentUser?.displayName||'').trim(),employeeUsername=String(currentUser?.username||'').trim();
  const canWeightMinus=isAdmin;
  const privateTab=isPrivateType(activeTab);
   const importLikeTab=isImportLikeType(activeTab);
  const exportLikeTab=isExportLikeType(activeTab);
  async function persistRows(list,markEntry=false,allowClientUpdate=false){const clean=list.filter(x=>normalize(x?.mawb)).map(withoutMeta);if(!clean.length)return[];const res=await fetch('/api/shipments',{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({rows:clean,markEntry,allowClientUpdate})});const data=await res.json();if(!data.ok)throw new Error(data.error||'Shared database save failed.');notifyProfitSourceChanged();return data.rows||[]}
  async function persistRow(row,markEntry=false,allowClientUpdate=false){return persistRows([row],markEntry,allowClientUpdate)}
  useEffect(()=>{if(haryanaMode){setActiveTab('IMPORT');setAdminView('ACTIVE');return;}try{const saved=localStorage.getItem(TAB_KEY);if(saved==='IMPORT'||saved==='EXPORT'||(isAdmin&&isPrivateType(saved)))setActiveTab(saved)}catch{}},[isAdmin,haryanaMode]);
  useEffect(()=>{try{localStorage.setItem(TAB_KEY,activeTab)}catch{}},[activeTab]);
  useEffect(()=>{let active=true;(async()=>{let local=[];try{local=dedupeRowsByMawb(JSON.parse(localStorage.getItem(KEY)||'[]').map(x=>decorateTiming({}, {...x,mawb:normalize(x?.mawb||x?.awb),shipmentType:shipmentTypeOf(x?.shipmentType)})).filter(x=>x.mawb&&(haryanaMode?shipmentTypeOf(x.shipmentType)==='IMPORT':isAdmin||!isPrivateType(x.shipmentType))))}catch{}// Display this authenticated browser's last saved shipment data without waiting for network.
    // The server remains authoritative and replaces this snapshot after loading.
    if(active&&local.length)setRows(local);
    try{const res=await fetch('/api/shipments',{cache:'no-store',credentials:'include'});const data=await res.json();if(!data.ok)throw new Error(data.error||'Shared database unavailable');const server=dedupeRowsByMawb((data.rows||[]).map(dbToRow).filter(x=>x.mawb));const map=new Map(server.map(x=>[digits(x.mawb),x]));const migrate=[];for(const l of local){const key=digits(l.mawb),s=map.get(key);if(!s)continue;const lt=Date.parse(l.lastChecked||l._dbUpdatedAt||0)||0,st=Date.parse(s.lastChecked||s._dbUpdatedAt||0)||0;if(key.startsWith('235')){const recovered=recoverTurkishLocal(s,l);if(recovered.changed){map.set(key,recovered.row);migrate.push(recovered.row)}continue}const serverAuthoritative=key.startsWith('071')||key.startsWith('098')||key.startsWith('160')||key.startsWith('232')||key.startsWith('312')||key.startsWith('176')||key.startsWith('141')||key.startsWith('065');if(!serverAuthoritative&&lt>st){const mergedLocal={...l};for(const wk of ['shipmentType','clientName','client','companyType','companyName','goodsDescription','enteredBy','enteredByUsername','enteredAt','mailSent','mailUpdatedAt','customsCleared','customsClearedAt','customsClearedBy','masterCopyReceived','masterCopyReceivedAt','masterCopyReceivedBy','handoverDone','handoverUpdatedAt','handoverUpdatedBy','weightMinus','weightMinusUpdatedAt','weightMinusUpdatedBy']){if(Object.prototype.hasOwnProperty.call(s,wk))mergedLocal[wk]=s[wk];else delete mergedLocal[wk]}map.set(key,mergedLocal)}}const merged=[...map.values()].sort((a,b)=>(Date.parse(b.lastChecked||b._dbUpdatedAt||0)||0)-(Date.parse(a.lastChecked||a._dbUpdatedAt||0)||0));if(!active)return;setRows(merged);setShared(true);setLoaded(true);localStorage.setItem(KEY,JSON.stringify(merged.map(withoutMeta)));if(migrate.length)persistRows(migrate).catch(()=>{})}catch(e){if(!active)return;setRows(local);setLoaded(true);setShared(false);setNote(`Shared database unavailable — showing this browser backup only. ${e.message||''}`)}})();return()=>{active=false}},[isAdmin]);
  useEffect(()=>{if(typeof window!=='undefined'&&loaded)localStorage.setItem(KEY,JSON.stringify(dedupeRowsByMawb(rows).map(withoutMeta)))},[rows,loaded]);
  // Pull fresh rows from our own shared database once a minute. This does NOT
  // call airline websites; it only makes the open dashboard reflect tracking
  // results that the backend/another tab has already saved, so stale ETA/ATA
  // values cannot sit on screen until the one-hour page reload.
  useEffect(()=>{if(!loaded)return;let stopped=false,running=false;const syncServer=async()=>{if(stopped||running)return;running=true;try{
    const res=await fetch('/api/shipments',{cache:'no-store',credentials:'include'});
    const data=await res.json();if(!data.ok)return;
    const server=dedupeRowsByMawb((data.rows||[]).map(dbToRow).filter(x=>x.mawb&&(haryanaMode?shipmentTypeOf(x.shipmentType)==='IMPORT':isAdmin||!isPrivateType(x.shipmentType))));
    setRows(current=>{
      const cleanCurrent=dedupeRowsByMawb(current);
      const localMap=new Map(cleanCurrent.map(x=>[digits(x.mawb),x]));
      const out=[];
      for(const sr of server){
        const key=digits(sr.mawb),lr=localMap.get(key);localMap.delete(key);
        if(!lr){out.push(sr);continue}
        if(key.startsWith('235')){out.push(recoverTurkishLocal(sr,lr).row);continue}
        const st=Math.max(Date.parse(sr._dbUpdatedAt||0)||0,Date.parse(sr.lastChecked||0)||0);
        const lt=Math.max(Date.parse(lr._dbUpdatedAt||0)||0,Date.parse(lr.lastChecked||0)||0);
        out.push(key.startsWith('071')||key.startsWith('098')||key.startsWith('160')||key.startsWith('232')||key.startsWith('312')||key.startsWith('176')||key.startsWith('141')||key.startsWith('065')||st>=lt?sr:lr);
      }
      for(const lr of localMap.values())if(haryanaMode?shipmentTypeOf(lr.shipmentType)==='IMPORT':isAdmin||!isPrivateType(lr.shipmentType))out.push(lr);
      return dedupeRowsByMawb(out);
    });
    setShared(true);
  }catch{}finally{running=false}};
  const onIndigoSynced=()=>syncServer();
  // Server is authoritative for Cathay (160) flight/arrival fields too.
  // Incomplete client refreshes can stamp newer local timestamps on blank rows;
  // do not let them override a verified CX679/ETA already saved in shared Neon.
  // Mobile browsers suspend polling while backgrounded. Sync saved rows as soon
  // as the user returns to Mayavi so Air India updates appear on the phone.
  const onForeground=()=>{if(document.visibilityState==='visible')syncServer()};
  window.addEventListener('mayavi:indigo-synced',onIndigoSynced);
  document.addEventListener('visibilitychange',onForeground);
  window.addEventListener('pageshow',onForeground);
  // Initial hydration already fetched this same list; avoid a duplicate request on open.
   const id=setInterval(syncServer,SERVER_POLL);
  return()=>{stopped=true;clearInterval(id);window.removeEventListener('mayavi:indigo-synced',onIndigoSynced);document.removeEventListener('visibilitychange',onForeground);window.removeEventListener('pageshow',onForeground)}
  },[loaded,isAdmin]);
  // Keep the mounted dashboard visible during refreshes. Server and airline
  // syncs update rows in place; do not blank the table with a periodic full-page reload.
  // Keep active masters fresh from their airline source; manual row refresh should not be required for status changes.
  // Saved rows paint first. Live carrier checks start later, in small batches:
  // opening Mayavi must never flood /api/track with every active master.
  useEffect(()=>{
    if(!loaded)return;
    let stopped=false,running=false;
    const MIN_REFRESH_GAP_MS=10*60*1000;
    const BATCH_LIMIT=24;
    const syncActive=async()=>{
      if(stopped||running||document.visibilityState==='hidden')return;
      running=true;
      try{
        const isPhone=window.matchMedia?.('(max-width:640px)')?.matches===true;
        const now=Date.now();
        const list=dedupeRowsByMawb(rowsRef.current)
          .filter(r=>refreshScope(r)!=='SKIP')
          .filter(r=>{
            const checked=Date.parse(r.lastChecked||r._dbUpdatedAt||'');
            const cxMissing=digits(r.mawb).startsWith('160')&&(!r.flightNo||!r.arrivalDate||!r.arrivalTime);
            const gap=cxMissing?5*60*1000:MIN_REFRESH_GAP_MS;
            return !Number.isFinite(checked)||now-checked>=gap;
          })
          .sort((a,b)=>{
            const aiPriority=isPhone?Number(digits(b.mawb).startsWith('098'))-Number(digits(a.mawb).startsWith('098')):0;
            const cxA=digits(a.mawb).startsWith('160')&&(!a.flightNo||!a.arrivalDate||!a.arrivalTime);
            const cxB=digits(b.mawb).startsWith('160')&&(!b.flightNo||!b.arrivalDate||!b.arrivalTime);
            const cxPriority=Number(cxB)-Number(cxA);
            const importPriority=(a.shipmentType==='IMPORT'?0:1)-(b.shipmentType==='IMPORT'?0:1);
            const agePriority=(Date.parse(a.lastChecked||a._dbUpdatedAt||'')||0)-(Date.parse(b.lastChecked||b._dbUpdatedAt||'')||0);
            return aiPriority||cxPriority||importPriority||agePriority;
          }).slice(0,BATCH_LIMIT);
        for(const row of list){
          if(stopped)break;
          await refreshByMawb(row.mawb,{silent:true});
        }
      }finally{running=false}
    };
    const firstRun=setTimeout(()=>void syncActive(),2500);
    const id=setInterval(()=>void syncActive(),5*60*1000);
    return()=>{stopped=true;clearTimeout(firstRun);clearInterval(id)};
  },[loaded]);
  useEffect(()=>{setClientFilter('');setOriginFilter('');setDestinationFilter('');setPrefixFilter('');setGoodsFilter('');setCompanyFilter('');setEnteredByFilter('')},[activeTab,adminView]);
  const tabRows=useMemo(()=>dedupeRowsByMawb(rows).filter(r=>shipmentTypeOf(r.shipmentType)===activeTab),[rows,activeTab]);
  const duplicateInTab=Boolean(duplicateFocus&&duplicateFocus.shipmentType===activeTab);
  const storedDuplicates=tabRows.filter(r=>r.duplicateAlert===true);
  const duplicateSpotlight=tabRows.find(r=>duplicateInTab&&digits(r.mawb)===digits(duplicateFocus.mawb))
    ||storedDuplicates[0]||null;
  const duplicateVisibleInTab=Boolean(duplicateSpotlight);
  const isDuplicateRow=r=>r.duplicateAlert===true||
    (duplicateInTab&&digits(r.mawb)===digits(duplicateFocus.mawb));
  async function recordDuplicateMawb(existing){
    try{
      const response=await fetch('/api/shipments',{method:'PATCH',credentials:'include',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({operation:'markDuplicate',mawb:existing.mawb})});
      const data=await response.json();
      if(!response.ok||!data.ok)throw new Error(data.error||'Shared alert not saved');
      const saved=dbToRow(data.row);
      setRows(current=>dedupeRowsByMawb([saved,...current.filter(r=>normalize(r.mawb)!==normalize(saved.mawb))]));
      focusExistingMaster(saved);
    }catch(e){
      focusExistingMaster(existing);
      setNote(normalize(existing.mawb)+' already exists. Original highlighted locally, but shared purple warning did not save: '+(e.message||e));
    }
  }
  async function acknowledgeDuplicateMawb(record){
    const awb=normalize(record.mawb);
    try{
      const response=await fetch('/api/shipments',{method:'PATCH',credentials:'include',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({operation:'acknowledgeDuplicate',mawb:awb})});
      const data=await response.json();
      if(!response.ok||!data.ok)throw new Error(data.error||'Could not acknowledge alert');
      const saved=dbToRow(data.row);
      setRows(current=>dedupeRowsByMawb([saved,...current.filter(r=>normalize(r.mawb)!==awb)]));
      setDuplicateFocus(focus=>digits(focus?.mawb)===digits(awb)?null:focus);
      setNote(awb+' duplicate alert acknowledged; original client details retained.');
    }catch(e){setNote('Could not clear duplicate warning: '+(e.message||e))}
  }
  function focusExistingMaster(record){
    const existing={...record,mawb:normalize(record.mawb)};
    const physical=expandPartRows([existing]);
    const fullyCleared=isImportLikeType(existing.shipmentType)
      ?(hasIndependentCustomsParts(existing)
        ?physical.length>0&&physical.every(p=>p.customsCleared===true)
        :isCustomsArchived(existing))
      :isExportArchived(existing);
    const targetView=fullyCleared?'CLEARED':'ACTIVE';
    setDuplicateFocus({mawb:existing.mawb,shipmentType:shipmentTypeOf(existing.shipmentType),targetView});
    setMawb(existing.mawb);setClient('');
    setActiveTab(shipmentTypeOf(existing.shipmentType));
    if(isAdmin)setAdminView(targetView);
    setPrefixFilter('');setClientFilter('');setGoodsFilter('');
    setCompanyFilter('');setEnteredByFilter('');setOriginFilter('');setDestinationFilter('');
    setNote(existing.mawb+' already exists in '+(fullyCleared?'CUSTOMS CLEARED':'ACTIVE')+
      ' • Client: '+(existing.clientName||existing.client||'Not entered')+
      '. Existing master highlighted at the top; no duplicate created.');
  }
  const dashboardRows=useMemo(()=>{
    if(exportLikeTab){
      if(isAdmin&&adminView==='CLEARED')return tabRows.filter(r=>isExportArchived(r)&&
        (activeTab!=='EXPORT'||importArrivalMonth(r.departureDate||r.flightDate)===currentImportMonth||
         isDuplicateRow(r)));
      return tabRows.filter(r=>!isExportArchived(r));
    }
    // Emirates split loads must be included in both candidate views. After
    // expansion, only the cleared physical parts go to Customs Cleared.
    if(isAdmin&&adminView==='CLEARED')return tabRows.filter(r=>hasIndependentCustomsParts(r)||isCustomsArchived(r));
    return tabRows.filter(r=>hasIndependentCustomsParts(r)||!isCustomsArchived(r));
  },[tabRows,activeTab,isAdmin,adminView,currentImportMonth,duplicateFocus,duplicateInTab,storedDuplicates.length]);
  const customsClearedImportCount=useMemo(()=>tabRows.reduce((sum,row)=>
    sum+expandPartRows([row]).filter(p=>p.customsCleared===true&&
      (!p.arrivalDate||importArrivalMonth(p.arrivalDate)===currentImportMonth)).length
  ,0),[tabRows,currentImportMonth]);
  const customsClearedExportCount=useMemo(()=>tabRows.filter(r=>
    isExportArchived(r)&&importArrivalMonth(r.departureDate||r.flightDate)===currentImportMonth).length,
    [tabRows,currentImportMonth]);
  const clearedFilterMode=isAdmin&&adminView==='CLEARED';
  const customsFilterMode=clearedFilterMode&&importLikeTab;
  const filterOptions=useMemo(()=>({clients:uniq(dashboardRows,'clientName'),goods:uniq(dashboardRows,'goodsDescription'),companies:[...new Set(dashboardRows.map(companyFilterLabel).filter(Boolean))].sort((a,b)=>a.localeCompare(b)),enteredBy:uniq(dashboardRows,'enteredBy'),origins:uniq(dashboardRows,'origin'),destinations:uniq(dashboardRows,'destination'),prefixes:[...new Set(dashboardRows.map(r=>digits(r.mawb).slice(0,3)).filter(Boolean))].sort()}),[dashboardRows]);
  const visibleRows=useMemo(()=>{const filtered=dashboardRows.filter(r=>(!prefixFilter||digits(r.mawb).startsWith(prefixFilter))&&(!clientFilter||r.clientName===clientFilter)&&(!goodsFilter||r.goodsDescription===goodsFilter)&&(!companyFilter||companyFilterLabel(r)===companyFilter)&&(!enteredByFilter||r.enteredBy===enteredByFilter)&&(!originFilter||r.origin===originFilter)&&(!destinationFilter||r.destination===destinationFilter));const expanded=expandPartRows(harmonizeSaudiaFlightEtas(filtered,dashboardRows)).map(r=>
    saudiaFowNeedsOffloadCheck(r,dashboardRows,mailClock)?{...r,
      status:'OFFLOADED (UNCONFIRMED)',remarks:String(r.sourceStatus||'').toUpperCase()==='RCS'?'SAL still shows RCS after the same flight departed with other cargo; not loaded / possible offload, awaiting SAL confirmation':'SAL still shows FOW after the same flight departed with other cargo; possible offload, awaiting SAL confirmation'}:r
  ).filter(r=>{
    if(clearedFilterMode&&importLikeTab){
      // Filter AFTER physical part expansion: Sep part goes to Sep archive,
      // Oct part stays visible here even when both share one MAWB.
      return r.customsCleared===true&&(privateTab||!r.arrivalDate||
        importArrivalMonth(r.arrivalDate)===currentImportMonth||
        isDuplicateRow(r));
    }
    if(duplicateInTab&&digits(r.mawb)===digits(duplicateFocus.mawb)&&!isAdmin)return true;
    if(!r._partKey)return true;
    return clearedFilterMode?r.customsCleared===true:r.customsCleared!==true;
  });
  const ordered=sortForDashboard(expanded,activeTab);
  if(!duplicateVisibleInTab)return ordered;
  // Each repeated original MAWB and all of its part rows stay at the top,
  // including on another operator's Import Active Masters screen.
  return [...ordered.filter(r=>isDuplicateRow(r)),
    ...ordered.filter(r=>!isDuplicateRow(r))];
  },[dashboardRows,clearedFilterMode,customsFilterMode,clientFilter,goodsFilter,companyFilter,enteredByFilter,originFilter,destinationFilter,prefixFilter,activeTab,currentImportMonth,privateTab,mailClock,duplicateFocus,duplicateInTab,duplicateVisibleInTab,storedDuplicates.length]);
  const totalWeight=useMemo(()=>{
    const groups=new Map();
    for(const row of visibleRows){
      const key=digits(row.mawb);
      if(!key)continue;
      if(!groups.has(key))groups.set(key,[]);
      groups.get(key).push(row);
    }
    let total=0;
    for(const group of groups.values()){
      const parts=group.filter(r=>Boolean(r._partKey));
      if(parts.length)total+=group.filter(p=>p._partKey||p._saudiaPendingVirtual===true).reduce((sum,p)=>sum+summaryRowWeight(p,activeTab),0);
      else total+=Math.max(0,...group.map(r=>summaryRowWeight(r,activeTab)));
    }
    return total;
  },[visibleRows,activeTab]);
  const totalWeightMinus=useMemo(()=>{const seen=new Set();return visibleRows.reduce((sum,r)=>{const key=digits(r.mawb);if(!key||seen.has(key))return sum;seen.add(key);return sum+weightMinusForTotal(r)},0)},[visibleRows]);
  const stats=useMemo(()=>({total:visibleRows.length,booked:visibleRows.filter(x=>x.status==='BOOKED'||x.status==='PRE-MANIFESTED'||x.status==='MANIFESTED'||x.status==='BUILD UP'||x.status==='EXECUTED'||x.status==='ACCEPTED'||x.status==='FREIGHT ON HAND').length,transit:visibleRows.filter(x=>x.status==='IN TRANSIT'||x.status==='PART ARRIVED').length,arrived:visibleRows.filter(x=>x.status==='ARRIVED'||x.status==='DELIVERED').length,attention:visibleRows.filter(x=>x.status==='DELAYED'||x.status==='RESCHEDULED'||x.status==='EARLY ARRIVAL').length}),[visibleRows]);
  async function track(one,currentShipment={}){const n=normalize(one);if(!n)throw new Error('Enter valid 11-digit MAWB.');const fallback=normalize(n).startsWith('235-')?{flightNo:currentShipment.flightNo||'',flightDate:currentShipment.flightDate||'',departureDate:currentShipment.departureDate||'',departureTime:currentShipment.departureTime||'',origin:currentShipment.origin||'',destination:currentShipment.destination||'',departureFlightNo:currentShipment.departureFlightNo||'',departureOrigin:currentShipment.departureOrigin||'',departureDestination:currentShipment.departureDestination||'',scheduledDeparture:currentShipment.scheduledDeparture||''}:{};const res=await fetch('/api/track',{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({mawb:n,currentShipment:fallback})});const data=await res.json();if(!data.ok){const err=new Error(data.trackingError||data.apiError||data.error||'Tracking failed');err.payload=data;throw err}return {...data.shipment,provider:data.provider||data.shipment?.source||''}}
  async function importTurkishScreenshot(value,file){
    if(!file)return;
    const index=rows.findIndex(x=>normalize(x.mawb)===normalize(value)),row=rows[index];
    if(!row)return;
    setBusy(true);setNote(`Reading verified Turkish Cargo screenshot for ${row.mawb}…`);
    try{
      const form=new FormData();form.append('mawb',row.mawb);form.append('file',file);
      const res=await fetch('/api/turkish-screenshot',{method:'POST',credentials:'include',body:form});
      const data=await res.json();
      if(!data.ok)throw new Error(data.error||'Turkish screenshot could not be read.');
      const next=decorateTiming(row,{...data.shipment,shipmentType:row.shipmentType,clientName:row.clientName,companyType:row.companyType||'',companyName:row.companyName||'',goodsDescription:row.goodsDescription||'',enteredBy:row.enteredBy,enteredByUsername:row.enteredByUsername,enteredAt:row.enteredAt,mailSent:isImportLikeType(row.shipmentType)?row.mailSent:undefined,mailUpdatedAt:isImportLikeType(row.shipmentType)?(row.mailUpdatedAt||''):undefined,customsCleared:isImportLikeType(row.shipmentType)?row.customsCleared===true:undefined,masterCopyReceived:isExportLikeType(row.shipmentType)?row.masterCopyReceived===true:undefined,lastChecked:new Date().toISOString(),trackingError:'',manualHint:''});
      setRows(list=>list.map((x,i)=>i===index?next:x));
      await persistRow(next);setShared(true);setNote(`${row.mawb}: Turkish verified screenshot fields filled and saved.`);
    }catch(e){setNote(`${row.mawb}: ${e.message||e}`)}
    finally{setBusy(false)}
  }
  async function add(){
    const n=normalize(mawb),clientName=String(client||'').trim();
    if(busy)return;
    if(!n){setNote('Please enter valid 11-digit MAWB.');return}
    // Re-entered MAWB can be in Active, Customs Cleared or another tab.
    // Prefer the original client record and avoid a duplicate write.
    const local=rowsRef.current.find(x=>normalize(x.mawb)===n);
    if(local){await recordDuplicateMawb(local);return}
    if(!loaded){setNote('Loading saved masters. Please retry after shared records load.');return}
    setBusy(true);
    let found=null;
    try{
      const response=await fetch('/api/shipments',{cache:'no-store',credentials:'include'});
      const data=await response.json();
      if(!response.ok||!data.ok)throw new Error(data.error||'Shared database unavailable');
      const saved=(data.rows||[]).find(x=>normalize(x.data?.mawb||x.awb)===n);
      if(saved)found=dbToRow(saved);
    }catch(e){
      setBusy(false);
      setNote('Cannot verify existing MAWB in shared database. No new master was created. '+(e.message||e));
      return;
    }
    setBusy(false);
    if(found){
      setRows(current=>dedupeRowsByMawb([found,...current.filter(x=>normalize(x.mawb)!==n)]));
      await recordDuplicateMawb(found);
      return;
    }
    if(!clientName){setNote('Client Name is mandatory. Please enter the client name before adding the MAWB.');return}
    const airline=airlineForMawb(n);
    if(!airline){setNote(`Prefix ${n.slice(0,3)} is not mapped yet.`);return}
    setDuplicateFocus(null);
    const enteredAt=new Date().toISOString();const base=decorateTiming({}, {mawb:n,shipmentType:activeTab,clientName,companyType:'',companyName:'',goodsDescription:importLikeTab?'':undefined,enteredBy:employeeName,enteredByUsername:employeeUsername,enteredAt,airlineName:airline.name,status:'BOOKED',officialTracker:airline.url||'',mailSent:importLikeTab?false:undefined,customsCleared:importLikeTab?false:undefined,masterCopyReceived:exportLikeTab?false:undefined,lastChecked:enteredAt});setRows(r=>[base,...r.filter(x=>normalize(x.mawb)!==n)]);setMawb('');setClient('');setBusy(true);setNote(`${n} added. Fetching live ${airline.name} details…`);try{await persistRow(base,true);setShared(true)}catch(e){setShared(false);setNote(`${n} added locally; shared save failed: ${e.message||e}`)}try{const s=await track(n);const next=decorateTiming(base,{...s,shipmentType:activeTab,clientName,companyType:base.companyType,companyName:base.companyName,goodsDescription:base.goodsDescription,enteredBy:employeeName,enteredByUsername:employeeUsername,enteredAt,mailSent:importLikeTab?false:undefined,customsCleared:importLikeTab?false:undefined,masterCopyReceived:exportLikeTab?base.masterCopyReceived===true:undefined,lastChecked:new Date().toISOString(),trackingError:'',manualHint:''});setRows(r=>r.map(x=>normalize(x.mawb)===n?next:x));try{await persistRow(next);setShared(true);setNote(`${n} live details filled and saved.`)}catch(e){setShared(false);setNote(`${n} live details filled locally; shared save failed: ${e.message||e}`)}}catch(e){const p=e.payload||{};const next=decorateTiming(base,{trackingError:e.message,manualHint:p.manualHint||'',officialTracker:airline.url||p.officialTracker||base.officialTracker,lastChecked:new Date().toISOString()});setRows(r=>r.map(x=>normalize(x.mawb)===n?next:x));try{await persistRow(next)}catch{}setNote(p.manualHint?`${n}: ${p.manualHint}`:`${n} saved. Live tracking will retry; use REFRESH if details stay blank.`)}finally{
    setBusy(false);
    // Only newly-added Cathay masters: if the FIRST official lookup did not
    // provide flight and arrival fields, retry promptly instead of waiting
    // for the five-minute background sweep or requiring ChatGPT intervention.
    // Never blank an already verified arrival, or retry other airlines.
    if(n.startsWith('160-')){
      window.setTimeout(()=>{
        if(document.visibilityState==='hidden')return;
        const latest=rowsRef.current.find(x=>normalize(x.mawb)===n);
        if(latest&&(!latest.flightNo||!latest.arrivalDate||!latest.arrivalTime))
          void refreshByMawb(n,{silent:true});
      },8000);
    }
  }}
  async function refreshByMawb(value,{silent=false}={}){const index=rowsRef.current.findIndex(x=>normalize(x.mawb)===normalize(value)),row=rowsRef.current[index];if(!row)return;if(!silent)setNote(`Refreshing ${row.mawb}…`);let next;try{const s=await track(row.mawb,row);let live={...s};const saudiaDis=normalize(row.mawb).startsWith('065-')&&(s.disAfterFow===true||/\b(?:DIS|DUS)\b|offloaded|not loaded/i.test(String(s.sourceStatus||'')+' '+String(s.discrepancy||'')+' '+String(s.remarks||'')));/* Removed temporary Saudia ETA protection lock: live SAL evidence is authoritative. */if(saudiaDis){live={...s,flightNo:'',flightDate:'',arrivalDate:Number(s.arrivedPieces||0)>0?(s.arrivalDate||''):'',arrivalTime:Number(s.arrivedPieces||0)>0?(s.arrivalTime||''):'',arrivalIsActual:false,saudiaExpectedArrivalLocked:false,expectedDateOverrideSource:'',remarks:s.remarks||'Offloaded / not loaded to flight'};}if(Array.isArray(live.partShipments)){
  live.partShipments=mergePartMail(live.partShipments,row.partShipments||[]);
  if(['065','098','176','312','229'].some(prefix=>digits(row.mawb).startsWith(prefix))&&live.partShipments.length>=1){
    live.partShipments=mergePartCustoms(live.partShipments,row.partShipments||[]);
  }
}if(normalize(row.mawb).startsWith('232-')&&s.arrivalVerifiedAbsent===true){live={...live,arrivalDate:'',arrivalTime:'',arrivalIsActual:false,arrivalVerifiedAbsent:true,mailTime:''};}if(normalize(row.mawb).startsWith('074-')&&s.klmLiveVerifiedAt&&!row.klmLiveVerifiedAt){
   // When replacing an old operator screenshot with the first genuinely live
   // AWB result, do not silently mix missing fields with screenshot values.
   for(const field of ['origin','via','destination','bags','pieces','weight','masterWeight',
     'bookingDate','bookingTime','flightNo','flightDate','finalFlightNo','finalFlightDate',
     'scheduledArrivalDate','scheduledArrivalTime','arrivalDate','arrivalTime',
     'arrivalTimeZone','arrivalTimeSource','flightSchedule']){
     if(s[field]===undefined||s[field]===null||s[field]==='')
       live[field]=field==='flightSchedule'?[]:'';
   }
 }if(digits(row.mawb).startsWith('160'))live=preserveCathayFlight(row,live,row.mawb);next=decorateTiming(row,{...live,shipmentType:row.shipmentType,clientName:row.clientName,companyType:row.companyType||'',companyName:row.companyName||'',goodsDescription:row.goodsDescription||'',enteredBy:row.enteredBy,enteredByUsername:row.enteredByUsername,enteredAt:row.enteredAt,mailSent:isImportLikeType(row.shipmentType)?row.mailSent:undefined,mailUpdatedAt:isImportLikeType(row.shipmentType)?(row.mailUpdatedAt||''):undefined,customsCleared:isImportLikeType(row.shipmentType)?row.customsCleared===true:undefined,masterCopyReceived:isExportLikeType(row.shipmentType)?row.masterCopyReceived===true:undefined,lastChecked:new Date().toISOString(),trackingError:'',manualHint:''});if(normalize(row.mawb).startsWith('098-')){if(s.arrivalVerifiedAbsent===true){next.arrivalDate='';next.arrivalTime='';next.scheduledArrivalDate='';next.scheduledArrivalTime='';next.mailTime='';next.arrivalIsActual=false;}if(s.arrivalDate)next.arrivalDate=s.arrivalDate;if(s.arrivalTime)next.arrivalTime=s.arrivalTime;next.arrivalIsActual=s.arrivalIsActual===true;if(s.arrivalTimeZone)next.arrivalTimeZone=s.arrivalTimeZone;if(s.arrivalTimeSource)next.arrivalTimeSource=s.arrivalTimeSource;next.mailTime=next.shipmentType==='IMPORT'?mailTimeFrom(next.arrivalDate,next.arrivalTime):next.mailTime;}if(normalize(row.mawb).startsWith('065-')){next.saudiaExpectedArrivalLocked=false;next.expectedDateOverrideSource='';}if(saudiaDis){next.flightNo='';next.flightDate='';next.arrivalDate='';next.arrivalTime='';next.mailTime='';next.arrivalIsActual=false;next.saudiaExpectedArrivalLocked=false;next.expectedDateOverrideSource='';next.remarks=live.remarks||'Offloaded / not loaded to flight';}else if(normalize(row.mawb).startsWith('065-')&&!s.flightNo&&!s.arrivalDate&&!s.arrivalTime){next.flightNo='';next.flightDate='';next.arrivalDate='';next.arrivalTime='';next.mailTime='';next.saudiaExpectedArrivalLocked=false;next.expectedDateOverrideSource='';}else if(s.arrivalIsActual===true){next.saudiaExpectedArrivalLocked=false;next.expectedDateOverrideSource='';}setRows(r=>r.map((x,i)=>i===index?next:x))}catch(e){const p=e.payload||{};const retained=decorateTiming(row,{status:row.status||'BOOKED',officialTracker:airlineForMawb(row.mawb)?.url||p.officialTracker||row.officialTracker,manualHint:p.manualHint||row.manualHint,trackingError:e.message,lastChecked:new Date().toISOString()});setRows(r=>r.map((x,i)=>i===index?retained:x));if(!silent)setNote(p.manualHint?`${row.mawb}: ${p.manualHint}`:'Auto refresh had an issue; last verified details and status were retained.');return}try{await persistRow(next);setShared(true);if(!silent)setNote(`${row.mawb} refreshed and shared.`)}catch(e){setShared(false);if(!silent)setNote(`${row.mawb} refreshed. Live details retained; shared save needs a valid login session.`)}}
  async function refreshAll(){setBusy(true);try{const masters=[...new Set(visibleRows.map(r=>normalize(r.mawb)).filter(Boolean))];for(const m of masters)await refreshByMawb(m)}finally{setBusy(false)}}
  // One-tap mobile refresh for existing Air India masters only. Mail/Customs
  // choices are kept by refreshByMawb; locked airline adapters are untouched.
  async function refreshAirIndiaMobile(){
    const masters=[...new Set(rows.filter(r=>digits(r.mawb).startsWith('098')&&['IMPORT','EXPORT'].includes(shipmentTypeOf(r.shipmentType))).map(r=>normalize(r.mawb)).filter(Boolean))];
    if(!masters.length){setNote('No Air India (098) masters found in the dashboard.');return;}
    setBusy(true);
    try{
      for(let i=0;i<masters.length;i++){
        setNote(`Air India ${i+1}/${masters.length}: refreshing ${masters[i]}…`);
        await refreshByMawb(masters[i]);
      }
      setNote(`Air India refresh checked ${masters.length} MAWB(s). Verified details saved; unsuccessful requests retain the previous values.`);
    }finally{setBusy(false)}
  }
  async function setMail(value,sent,partKey=''){
     const index=rows.findIndex(x=>normalize(x.mawb)===normalize(value)),row=rows[index];
     if(!row||isExportLikeType(row.shipmentType))return;
     const unified=consolidatedKuwaitDeparture(row);
     const physicalId=partKey?String(partKey).split('::').slice(1).join('::'):'';
     const partIndex=physicalId&&Array.isArray(row.partShipments)
       ?row.partShipments.findIndex((p,i)=>partIdentity(p,i)===physicalId):-1;
     if(physicalId&&partIndex<0){setNote('Part row changed. Refresh before saving Mail.');return;}
     const at=new Date().toISOString();
     const next=unified
       ?{...row,mailSent:sent,mailUpdatedAt:at,partShipments:row.partShipments.map(p=>({...p,mailSent:sent,mailUpdatedAt:at}))}
       :physicalId
       ?{...row,partShipments:row.partShipments.map((p,i)=>i===partIndex?{...p,mailSent:sent,mailUpdatedAt:at}:p)}
       :{...row,mailSent:sent,mailUpdatedAt:at};
     setRows(list=>list.map(x=>normalize(x.mawb)===normalize(value)?next:x));
     try{
       const res=await fetch('/api/shipments',{
         method:'PATCH',credentials:'include',headers:{'content-type':'application/json'},
         body:JSON.stringify({mawb:row.mawb,mailSent:sent,partKey:physicalId,
           operation:unified?'kuwaitMasterMail':undefined})
       });
       const data=await res.json();
       if(!data.ok)throw new Error(data.error||'Mail update failed');
       if(data.row)setRows(list=>list.map(x=>normalize(x.mawb)===normalize(value)?dbToRow(data.row):x));
       setShared(true);
       notifyProfitSourceChanged();
       setNote(`${row.mawb}${physicalId?' • part '+(partIndex+1):''}: Mail ${sent?'YES':'NO'} saved independently.`);
     }catch(e){
       setRows(list=>list.map(x=>normalize(x.mawb)===normalize(value)?row:x));
       setShared(false);
       setNote(`Mail save failed: ${e.message||e}`);
     }
   }
   async function setCustomsClear(value,cleared,partKey=''){
    const index=rows.findIndex(x=>normalize(x.mawb)===normalize(value)),row=rows[index];
    if(!row||isExportLikeType(row.shipmentType))return;
    const unified=consolidatedKuwaitDeparture(row);
    if(unified){
      if(cleared&&row.partShipments.some(part=>part.mailSent!==true)){
        setNote(`${row.mawb}: Select Mail YES before Customs Clear.`);return;
      }
      const stamp=new Date().toISOString();
      const updated={...row,customsCleared:cleared,
        customsClearedAt:cleared?stamp:'',customsClearedBy:cleared?(employeeName||employeeUsername||'User'):'',
        partShipments:row.partShipments.map(part=>({...part,customsCleared:cleared,
          customsClearedAt:cleared?stamp:'',customsClearedBy:cleared?(employeeName||employeeUsername||'User'):''}))};
      setRows(list=>list.map(item=>normalize(item.mawb)===normalize(value)?updated:item));
      try{
        const res=await fetch('/api/shipments',{method:'PATCH',credentials:'include',headers:{'content-type':'application/json'},
          body:JSON.stringify({mawb:row.mawb,operation:'kuwaitMasterCustoms',customsCleared:cleared})});
        const data=await res.json();if(!data.ok)throw new Error(data.error||'Customs update failed');
        if(data.row)setRows(list=>list.map(item=>normalize(item.mawb)===normalize(value)?dbToRow(data.row):item));
        setShared(true);notifyProfitSourceChanged();
        setNote(`${row.mawb}: Full Kuwait cargo Customs ${cleared?'CLEARED':'PENDING'} updated for all physical parts.`);
      }catch(e){setRows(list=>list.map(item=>normalize(item.mawb)===normalize(value)?row:item));
        setNote(`Kuwait Customs save failed: ${e.message||e}`);}
      return;
    }
    if(hasIndependentCustomsParts(row)){
      const physicalId=String(partKey||'').split('::').slice(1).join('::');
      const partIndex=row.partShipments.findIndex((p,i)=>partIdentity(p,i)===physicalId);
      if(!physicalId||partIndex<0){setNote('Select one part row. Refresh if its ID has changed.');return;}
      if(cleared&&!normalize(row.mawb).startsWith('065-')&&row.partShipments[partIndex].mailSent!==true){
        setNote(`${row.mawb} • part ${partIndex+1}: Select Mail YES first; then click Customs Pending.`);
        return;
      }
      const date=new Date().toISOString();
      const updated={...row,customsCleared:false,customsClearedAt:'',customsClearedBy:'',
        partShipments:row.partShipments.map((p,i)=>i===partIndex?{...p,
          customsCleared:cleared,
          customsClearedAt:cleared?date:'',
          customsClearedBy:cleared?(employeeName||employeeUsername||'User'):''}:p)};
      setRows(list=>list.map(x=>normalize(x.mawb)===normalize(value)?updated:x));
      try{
        const res=await fetch('/api/shipments',{method:'PATCH',credentials:'include',
          headers:{'content-type':'application/json'},
          body:JSON.stringify({mawb:row.mawb,operation:'partCustoms',
            partKey:physicalId,customsCleared:cleared})});
        const data=await res.json();
        if(!data.ok)throw new Error(data.error||'Customs clearance save failed');
        if(data.row)setRows(list=>list.map(x=>normalize(x.mawb)===normalize(value)?dbToRow(data.row):x));
        setShared(true);
        notifyProfitSourceChanged();
        setNote(`${row.mawb} • part ${partIndex+1}: Customs ${cleared?'CLEARED':'PENDING'} saved independently.`);
      }catch(e){
        setRows(list=>list.map(x=>normalize(x.mawb)===normalize(value)?row:x));
        setNote(`Part customs clearance failed: ${e.message||e}`);
      }
      return;
    }
    const next={...row,customsCleared:cleared,customsClearedAt:cleared?new Date().toISOString():'',customsClearedBy:cleared?employeeName:''};
    setRows(r=>r.map((x,i)=>i===index?next:x));
    try{await persistRow(next);setShared(true);
      if(cleared)setNote(`${row.mawb}: Customs cleared — moved to Admin Customs Cleared.`);
      else setNote(`${row.mawb}: Customs mark removed; master returned to Active.`);
    }catch(e){setShared(false);setNote(`Customs clear save failed: ${e.message||e}`)}
  }
  async function setHandover(value,done){const index=rows.findIndex(x=>normalize(x.mawb)===normalize(value)),row=rows[index];if(!row||!isExportLikeType(row.shipmentType))return;const next={...row,handoverDone:done,handoverUpdatedAt:new Date().toISOString(),handoverUpdatedBy:employeeName||'User'};setRows(r=>r.map((x,i)=>i===index?next:x));try{await persistRow(next);setShared(true);setNote(`${row.mawb}: Handover marked ${done?'YES':'NO'} and saved.`)}catch(e){setRows(r=>r.map((x,i)=>i===index?row:x));setShared(false);setNote(`Handover status save failed: ${e.message||e}`)}}
  async function setMasterCopyReceived(value,received){const index=rows.findIndex(x=>normalize(x.mawb)===normalize(value)),row=rows[index];if(!row||!isExportLikeType(row.shipmentType))return;const next={...row,masterCopyReceived:received,masterCopyReceivedAt:received?new Date().toISOString():'',masterCopyReceivedBy:received?(employeeName||'User'):''};setRows(r=>r.map((x,i)=>i===index?next:x));try{await persistRow(next);setShared(true);const archived=next.handoverDone===true&&next.masterCopyReceived===true;setNote(`${row.mawb}: Master Copy Received ${received?'ticked':'unticked'} and saved.${archived?(shipmentTypeOf(row.shipmentType)==='OTHER_COUNTRIES'?' Handover YES + Master Copy tick complete; moved to Other Countries → Customs Cleared.':' Handover YES + Master Copy tick complete; moved to Export Customs Cleared masters.'):(shipmentTypeOf(row.shipmentType)==='OTHER_COUNTRIES'?' It will stay in Other Countries → Active until both Handover YES and Master Copy tick are complete.':' It will stay in Active Export until both Handover YES and Master Copy tick are complete.')}`)}catch(e){setRows(r=>r.map((x,i)=>i===index?row:x));setShared(false);setNote(`Master Copy Received save failed: ${e.message||e}`)}}
  async function saveWeightMinus(value,weightMinus){if(!canWeightMinus)return;const index=rows.findIndex(x=>normalize(x.mawb)===normalize(value)),row=rows[index];if(!row||!isExportLikeType(row.shipmentType))return;const raw=String(weightMinus??'').trim();if(raw!==''&&(!Number.isFinite(Number(raw))||Number(raw)<0)){setNote('Weight Minus must be a positive number or blank.');return}const clean=raw===''?'':String(Number(raw));const next={...row,weightMinus:clean,weightMinusUpdatedAt:new Date().toISOString(),weightMinusUpdatedBy:employeeName||employeeUsername||'User'};setRows(r=>r.map((x,i)=>i===index?next:x));try{await persistRow(next);setShared(true);setNote(`${row.mawb}: Weight Minus ${clean?`${clean} kg`:'cleared'} and saved.`)}catch(e){setRows(r=>r.map((x,i)=>i===index?row:x));setShared(false);setNote(`Weight Minus save failed: ${e.message||e}`)}}
  async function saveGoodsDescription(value,goodsDescription){const index=rows.findIndex(x=>normalize(x.mawb)===normalize(value)),row=rows[index];if(!row||isExportLikeType(row.shipmentType))return;const next={...row,goodsDescription:String(goodsDescription||'').trim(),goodsDescriptionUpdatedAt:new Date().toISOString(),goodsDescriptionUpdatedBy:employeeName||'Admin'};setRows(r=>r.map((x,i)=>i===index?next:x));try{await persistRow(next);setShared(true);setNote(`${row.mawb}: Goods saved.`)}catch(e){setShared(false);setNote(`Goods save failed: ${e.message||e}`)}}
  async function saveCompany(value,companyType,companyName=''){const index=rows.findIndex(x=>normalize(x.mawb)===normalize(value)),row=rows[index];if(!row)return;const type=String(companyType||'').toUpperCase();const name=type==='KCC'?'KCC':type==='PV'?'PV':type==='OTHER'?String(companyName||'').trim():'';const next={...row,companyType:type,companyName:name,companyUpdatedAt:new Date().toISOString(),companyUpdatedBy:employeeName||'User'};setRows(r=>r.map((x,i)=>i===index?next:x));try{await persistRow(next);setShared(true);setNote(`${row.mawb}: Company ${name||type||'cleared'} saved.`)}catch(e){setShared(false);setNote(`Company save failed: ${e.message||e}`)}}
  async function editClientName(value){const index=rows.findIndex(x=>normalize(x.mawb)===normalize(value)),row=rows[index];if(!row)return;const current=String(row.clientName||'').trim();const entered=window.prompt(`Change client name for ${row.mawb}`,current);if(entered===null)return;const clientName=String(entered||'').trim();if(!clientName){setNote('Client name cannot be blank.');return}if(clientName===current){setNote(`${row.mawb}: Client name unchanged.`);return}const next={...row,clientName,client:clientName,clientUpdatedAt:new Date().toISOString(),clientUpdatedBy:employeeName||employeeUsername||'User'};setRows(r=>r.map((x,i)=>i===index?next:x));try{await persistRow(next,false,true);setShared(true);setNote(`${row.mawb}: Client changed from ${current||'—'} to ${clientName} by ${employeeName||employeeUsername||'user'}.`)}catch(e){setRows(r=>r.map((x,i)=>i===index?row:x));setShared(false);setNote(`Client name change failed: ${e.message||e}`)}}
  async function moveShipment(value){const index=rows.findIndex(x=>normalize(x.mawb)===normalize(value)),row=rows[index];if(!row)return;if(isPrivateType(row.shipmentType)){setNote(`${row.mawb} is protected in Other Countries and cannot be moved to an employee-visible tab.`);return}const target=isExportLikeType(row.shipmentType)?'IMPORT':'EXPORT';const next=decorateTiming(row,{...row,shipmentType:target,mailSent:target==='IMPORT'?false:undefined,mailUpdatedAt:target==='IMPORT'?row.mailUpdatedAt:undefined,customsCleared:target==='IMPORT'?false:undefined,customsClearedAt:target==='IMPORT'?'':undefined,customsClearedBy:target==='IMPORT'?'':undefined,masterCopyReceived:target==='EXPORT'?false:undefined,masterCopyReceivedAt:target==='EXPORT'?'':undefined,masterCopyReceivedBy:target==='EXPORT'?'':undefined,lastChecked:row.lastChecked||new Date().toISOString()});setRows(r=>r.map((x,i)=>i===index?next:x));try{await persistRow(next);setShared(true);setNote(`${row.mawb} moved to ${target}.`)}catch(e){setShared(false);setNote(`Could not move shipment: ${e.message||e}`)}}
  async function remove(value){if(!isAdmin)return;const index=rows.findIndex(x=>normalize(x.mawb)===normalize(value)),row=rows[index];if(!row)return;if(!window.confirm(`Delete ${row.mawb} from the shared tracker?`))return;try{const res=await fetch(`/api/shipments?awb=${encodeURIComponent(row.mawb)}`,{method:'DELETE',credentials:'include'});const data=await res.json();if(!data.ok)throw new Error(data.error||'Delete failed');setRows(r=>r.filter((_,i)=>i!==index));setShared(true);notifyProfitSourceChanged();setNote(`${row.mawb} deleted by admin.`)}catch(e){setNote(`Delete blocked: ${e.message||e}`)}}
  const serialWidth=52,mawbWidth=132,goodsWidth=100,clientWidth=118,companyWidth=92;
  const mawbLeft=serialWidth,goodsLeft=serialWidth+mawbWidth,clientLeft=importLikeTab?serialWidth+mawbWidth+goodsWidth:serialWidth+mawbWidth,companyLeft=clientLeft+clientWidth;
  return <main>
    <section className="hero"><div><div className="eyebrow">MAYAVI CARGO • V4.3 • {isAdmin?'ADMIN':'EMPLOYEE'}</div><h1>{isAdmin?'Admin MAWB Dashboard':'Employee MAWB Dashboard'}</h1><p>In-place server sync • Active tracking sync every 10 minutes with Import first • Import masters are ordered by Mail Time ascending • live status automatically changes to Booked, Pre-Manifested, In Transit, Part Arrived, Arrived, Delayed or Early Arrival • every new MAWB records the employee who entered it.</p></div><div className="userPanel"><div className="version">{employeeName||'User'} • {shared?'SHARED ✓':'LOCAL'}</div>{onLogout&&<button className="logoutBtn" onClick={onLogout}>LOGOUT</button>}</div></section>
    {isAdmin&&!haryanaMode&&<section className="adminBar"><div><b>ADMIN ACCESS</b><span>Choose Active Masters, Customs Cleared, Monthly Records, private Other Countries, or Meetings & Daily Updates. Monthly Records keeps closed-month Import and Export snapshots permanently. Other Countries has separate Import and Export tabs, each with Active and Customs Cleared views, visible only to Admin. PART ARRIVED import masters remain visible in both until fully arrived.</span></div></section>}
    {haryanaMode?<section className="adminNavGroup"><section className="adminViews"><button className="active" type="button">ACTIVE IMPORT MASTERS</button></section><section className="typeTabs"><button className="active" type="button">IMPORT</button></section></section>:isAdmin?<section className="adminNavGroup"><section className="adminViews"><button className={adminView==='ACTIVE'&&!privateTab?'active':''} onClick={()=>{if(privateTab)setActiveTab('IMPORT');setAdminView('ACTIVE')}}>ACTIVE MASTERS</button><button className={adminView==='CLEARED'&&!privateTab?'active':''} onClick={()=>{if(privateTab)setActiveTab('IMPORT');setAdminView('CLEARED')}}>CUSTOMS CLEARED ({privateTab?0:(importLikeTab?customsClearedImportCount:customsClearedExportCount)})</button><button onClick={()=>{window.location.href='/monthly'}}>MONTHLY RECORDS</button><button className={privateTab?'active':''} onClick={()=>{setAdminView('ACTIVE');setActiveTab('OTHER_COUNTRIES')}}>OTHER COUNTRIES</button>{onOpenSpeedPost&&<button type="button" onClick={onOpenSpeedPost}>SPEED POST (PRIVATE)</button>}{onOpenAdminNotes&&<button type="button" onClick={onOpenAdminNotes}>MEETINGS &amp; DAILY UPDATES</button>}</section>{privateTab?<><section className="typeTabs"><button className={importLikeTab?'active':''} onClick={()=>{setActiveTab('OTHER_COUNTRIES_IMPORT');setAdminView('ACTIVE')}}>IMPORT</button><button className={!importLikeTab?'active':''} onClick={()=>{setActiveTab('OTHER_COUNTRIES');setAdminView('ACTIVE')}}>EXPORT</button></section><section className="typeTabs"><button className={adminView==='ACTIVE'?'active':''} onClick={()=>setAdminView('ACTIVE')}>ACTIVE ({tabRows.filter(r=>importLikeTab?!isCustomsArchived(r):!isExportArchived(r)).length})</button><button className={adminView==='CLEARED'?'active':''} onClick={()=>setAdminView('CLEARED')}>CUSTOMS CLEARED ({tabRows.filter(r=>importLikeTab?isCustomsArchived(r):isExportArchived(r)).length})</button></section></>:<section className="typeTabs"><button className={importLikeTab?'active':''} onClick={()=>setActiveTab('IMPORT')}>IMPORT</button><button className={activeTab==='EXPORT'?'active':''} onClick={()=>setActiveTab('EXPORT')}>EXPORT</button></section>}</section>:<section className="typeTabs"><button className={importLikeTab?'active':''} onClick={()=>setActiveTab('IMPORT')}>IMPORT</button><button className={activeTab==='EXPORT'?'active':''} onClick={()=>setActiveTab('EXPORT')}>EXPORT</button>{onOpenSpeedPost&&<button type="button" onClick={onOpenSpeedPost}>SPEED POST (PRIVATE)</button>}</section>}
    <section className="stats"><div><b>{stats.total}</b><span>{isAdmin&&adminView==='CLEARED'?'Cleared':privateTab?`OTHER COUNTRIES ${importLikeTab?'IMPORT':'EXPORT'}`:activeTab} MAWB</span></div><div><b>{stats.booked}</b><span>Booked</span></div><div><b>{stats.transit}</b><span>In Transit</span></div><div><b>{stats.arrived}</b><span>Arrived</span></div><div><b>{stats.attention}</b><span>Delayed / Rescheduled / Early</span></div></section>
    {(!isAdmin||adminView==='ACTIVE')&&<section className="entry"><div><label>{privateTab?`OTHER COUNTRIES ${importLikeTab?'IMPORT':'EXPORT'}`:activeTab} MAWB NUMBER</label><input value={mawb} onChange={e=>setMawb(e.target.value)} placeholder="e.g. 157-12345678" onKeyDown={e=>e.key==='Enter'&&add()}/></div><div><label>CLIENT NAME *</label><input required value={client} onChange={e=>setClient(e.target.value)} placeholder="Required client name" onKeyDown={e=>e.key==='Enter'&&add()}/></div><button disabled={busy} onClick={add}>{busy?'TRACKING…':`ADD TO ${privateTab?`OTHER COUNTRIES ${importLikeTab?'IMPORT':'EXPORT'}`:activeTab}`}</button><button className="secondary" disabled={busy||!visibleRows.length} onClick={refreshAll}>REFRESH {activeTab}</button><button className="mobileAirIndiaRefresh" disabled={busy||!rows.some(r=>digits(r.mawb).startsWith('098'))} onClick={refreshAirIndiaMobile}>REFRESH AIR INDIA (098)</button></section>}
    {!loaded&&<div className="note">{rows.length?'Showing saved details while checking for live updates…':'Loading shared shipment entries…'}</div>}
    {note&&<div className="note">{note}</div>}
    <section className="filters"><div><label>MAWB PREFIX / AIRLINE</label><select value={prefixFilter} onChange={e=>setPrefixFilter(e.target.value)}><option value="">All Airlines</option>{filterOptions.prefixes.map(p=>{const sample=dashboardRows.find(r=>digits(r.mawb).startsWith(p));return <option key={p} value={p}>{p}{sample?.airlineName?` - ${sample.airlineName}`:''}</option>})}</select></div>{importLikeTab&&<><div><label>ORIGIN</label><select value={originFilter} onChange={e=>setOriginFilter(e.target.value)}><option value="">All Origins</option>{filterOptions.origins.map(v=><option key={v} value={v}>{v}</option>)}</select></div><div><label>DESTINATION</label><select value={destinationFilter} onChange={e=>setDestinationFilter(e.target.value)}><option value="">All Destinations</option>{filterOptions.destinations.map(v=><option key={v} value={v}>{v}</option>)}</select></div></>}{(prefixFilter||clientFilter||goodsFilter||companyFilter||enteredByFilter||originFilter||destinationFilter)&&<button onClick={()=>{setPrefixFilter('');setClientFilter('');setGoodsFilter('');setCompanyFilter('');setEnteredByFilter('');setOriginFilter('');setDestinationFilter('')}}>CLEAR FILTERS</button>}</section>
    {duplicateVisibleInTab&&<section className="mayaviDuplicateBanner" role="alert">
      <div><strong>DUPLICATE MAWB • {duplicateSpotlight.mawb}</strong>
        <span>Already entered • Client: <b>{duplicateSpotlight?.clientName||'Not entered'}</b> •
          Existing record in {isAdmin&&adminView==='CLEARED'?'CUSTOMS CLEARED':'ACTIVE MASTERS'}.
          Original shipment is pinned at the top with all details. No new master was created.</span>
      </div>
      <button type="button" onClick={()=>acknowledgeDuplicateMawb(duplicateSpotlight)} aria-label="Acknowledge duplicate master">ACKNOWLEDGE</button>
    </section>}
    <section className="tableWrap cargoTrackTable"><table><thead><tr><th style={stickyColumn(0,serialWidth,true)}>S.No.</th>{(!isAdmin||adminView==='ACTIVE')&&<th style={{minWidth:'82px',width:'82px'}}>Entry Date</th>}<th style={stickyColumn(mawbLeft,mawbWidth,true)}>MAWB</th>{importLikeTab&&<th style={stickyColumn(goodsLeft,goodsWidth,true)}><div style={{display:'grid',gap:'4px',minWidth:'100px'}}><span>Goods</span><select aria-label="Filter by goods" value={goodsFilter} onChange={e=>setGoodsFilter(e.target.value)} style={{height:'30px',border:'1px solid #cbd5e1',borderRadius:'7px',background:'#fff',padding:'0 5px',fontSize:'11px',fontWeight:700,color:'#475569',maxWidth:'145px'}}><option value="">All Goods</option>{filterOptions.goods.map(v=><option key={v} value={v}>{v}</option>)}</select></div></th>}<th style={stickyColumn(clientLeft,clientWidth,true)}>{<div style={{display:'grid',gap:'4px',minWidth:'112px'}}><span>Client</span><select value={clientFilter} onChange={e=>setClientFilter(e.target.value)} style={{height:'30px',border:'1px solid #cbd5e1',borderRadius:'7px',background:'#fff',padding:'0 5px',fontSize:'11px',fontWeight:700,color:'#475569'}}><option value="">All Clients</option>{filterOptions.clients.map(v=><option key={v} value={v}>{v}</option>)}</select></div>}</th><th style={stickyColumn(companyLeft,companyWidth,true)}><div style={{display:'grid',gap:'4px',minWidth:'100px'}}><span>Company</span><select aria-label="Filter by company" value={companyFilter} onChange={e=>setCompanyFilter(e.target.value)} style={{height:'30px',border:'1px solid #cbd5e1',borderRadius:'7px',background:'#fff',padding:'0 5px',fontSize:'11px',fontWeight:700,color:'#475569',maxWidth:'145px'}}><option value="">All Companies</option>{filterOptions.companies.map(v=><option key={v} value={v}>{v}</option>)}</select></div></th><th><div style={{display:'grid',gap:'4px',minWidth:'115px'}}><span>Entered By</span><select aria-label="Filter by staff member" value={enteredByFilter} onChange={e=>setEnteredByFilter(e.target.value)} style={{height:'30px',border:'1px solid #cbd5e1',borderRadius:'7px',background:'#fff',padding:'0 5px',fontSize:'11px',fontWeight:700,color:'#475569',maxWidth:'170px'}}><option value="">All Staff</option>{filterOptions.enteredBy.map(v=><option key={v} value={v}>{v}</option>)}</select></div></th><th>Booking Date</th><th>Airline Name</th><th>Origin</th><th>Via</th><th>Destination</th><th style={{minWidth:'76px',width:'76px',paddingLeft:'8px',paddingRight:'1px'}}>Bags/Pieces</th><th style={{minWidth:'58px',width:'58px',paddingLeft:'1px',paddingRight:'8px'}}>Weight</th>{exportLikeTab&&canWeightMinus&&<th style={{minWidth:'100px',width:'100px'}}>Weight Minus</th>}<th>Flight</th>{exportLikeTab&&<><th>Departure Date</th><th>Departure Time</th><th>Handover Date & Time (-5h)</th><th>Handover</th></>}{importLikeTab&&<><th>Arrival Date</th><th>Arrival Time</th><th>Mail Time (-6h)</th><th>Mail</th><th>Customs Clear</th></>}{exportLikeTab&&(!isAdmin||adminView==='ACTIVE')&&<th>Master Copy Received</th>}{exportLikeTab&&<><th>Arrival Date</th><th>Arrival Time</th></>}<th>Status</th><th style={{minWidth:'94px',width:'94px',whiteSpace:'normal',lineHeight:1.15}}>Avg Weight / Bag (kg)</th><th>Action</th>{importLikeTab&&<th style={{minWidth:'190px',width:'190px'}}>Remarks</th>}</tr></thead><tbody>{visibleRows.length?visibleRows.map((r,rowIndex)=><tr key={r._partKey||r.mawb} data-counted-weight-kg={summaryRowWeight(r,activeTab)}
        className={isDuplicateRow(r)?'mayaviDuplicateRow':''}><td style={stickyColumn(0,serialWidth)}><strong>{rowIndex+1}</strong></td>{(!isAdmin||adminView==='ACTIVE')&&<td style={{minWidth:'82px',width:'82px',whiteSpace:'nowrap'}}>{formatEntryDate(r.enteredAt)||'—'}</td>}<td style={stickyColumn(mawbLeft,mawbWidth)}><strong>{r.mawb}</strong>{r.saudiaRcfFollowUp&&<span className="saudiaRcfPill" title="SAL RCF: Received from Flight. Verify whether customs inspection is required before informing client.">RCF • {r.saudiaRcfPieces?String(r.saudiaRcfPieces)+' BAGS • ':''}CHECK CUSTOMS</span>}{r.trackingError&&<small className="err">{digits(r.mawb).startsWith('160')?'Cathay official data unavailable — automatic retry':'Backend will retry automatically'}</small>}{normalize(r.mawb).startsWith('074-')&&!r.klmLiveVerifiedAt&&/operator|screenshot|not live/i.test(String(r.source||''))&&<small className="err">Historical KLM data — NOT LIVE</small>}</td>{importLikeTab&&<td style={stickyColumn(goodsLeft,goodsWidth)}>{<input value={r.goodsDescription||''} onChange={e=>{const value=e.target.value;setRows(list=>list.map(x=>normalize(x.mawb)===normalize(r.mawb)?{...x,goodsDescription:value}:x))}} onBlur={e=>saveGoodsDescription(r.mawb,e.target.value)} placeholder="Goods" style={{width:'88px',height:'32px',border:'1px solid #cbd5e1',borderRadius:'7px',padding:'0 6px',background:'#fff',fontWeight:/\b(PROTEIN|CLOTHES)\b/i.test(String(r.goodsDescription||''))?800:400,color:/\bPROTEIN\b/i.test(String(r.goodsDescription||''))?'#7e22ce':/\bCLOTHES\b/i.test(String(r.goodsDescription||''))?'#db2777':'#111827'}}/>}</td>}<td style={stickyColumn(clientLeft,clientWidth)} onClick={()=>editClientName(r.mawb)} title="Click client name to edit">{r.clientName?<span className="clientChip" style={clientStyle(r.clientName)}>{r.clientName}</span>:'—'}</td><td style={stickyColumn(companyLeft,companyWidth)}><div style={{display:'grid',gap:'2px',minWidth:'82px'}}><select value={companyChoice(r)} onChange={e=>{const type=e.target.value;if(type==='OTHER'){setRows(list=>list.map(x=>normalize(x.mawb)===normalize(r.mawb)?{...x,companyType:'OTHER',companyName:companyChoice(x)==='OTHER'?(x.companyName||''):''}:x));saveCompany(r.mawb,'OTHER',companyChoice(r)==='OTHER'?r.companyName:'')}else saveCompany(r.mawb,type,type)}} style={{width:'82px',height:'28px',border:'1px solid #cbd5e1',borderRadius:'7px',background:'#fff',padding:'0 5px'}}><option value="">Select</option><option value="KCC">KCC</option><option value="PV">PV</option><option value="OTHER">Other</option></select>{companyChoice(r)==='OTHER'&&<input value={r.companyName||''} onChange={e=>{const value=e.target.value;setRows(list=>list.map(x=>normalize(x.mawb)===normalize(r.mawb)?{...x,companyType:'OTHER',companyName:value}:x))}} onBlur={e=>saveCompany(r.mawb,'OTHER',e.target.value)} placeholder="Type company" style={{width:'82px',height:'28px',border:'1px solid #cbd5e1',borderRadius:'7px',padding:'0 6px',background:'#fff'}}/>}</div></td><td>{r.enteredBy?<span className="employeeChip">{r.enteredBy}</span>:'—'}</td><td>{r.bookingDate||'—'}</td><td>{r.airlineName||'—'}</td><td>{r.origin||'—'}</td><td><strong>{viaForRow(r)||'—'}</strong></td><td>{r.destination||'—'}</td><td style={{minWidth:'76px',width:'76px',paddingLeft:'8px',paddingRight:'1px'}}>{r.bags||r.pieces||'—'}</td><td style={{minWidth:'58px',width:'58px',paddingLeft:'1px',paddingRight:'8px'}}>{r.weight?`${(String(r.mawb||'').replace(/\D/g,'').startsWith('098')&&String(r.weight).indexOf('/')<0&&r.masterWeight&&Number(r.masterWeight)>Number(String(r.weight).replace(/[^0-9.]/g,'')))?`${r.weight}/${r.masterWeight}`:r.weight} kg`:'—'}</td>{exportLikeTab&&canWeightMinus&&<td style={{minWidth:'100px',width:'100px'}}><div style={{display:'flex',alignItems:'center',gap:'4px'}}><input type="number" min="0" step="0.01" value={r.weightMinus??''} onChange={e=>{const value=e.target.value;setRows(list=>list.map(x=>normalize(x.mawb)===normalize(r.mawb)?{...x,weightMinus:value}:x))}} onBlur={e=>saveWeightMinus(r.mawb,e.target.value)} placeholder="0" style={{width:'68px',height:'32px',border:'1px solid #cbd5e1',borderRadius:'7px',padding:'0 6px',background:'#fff',fontWeight:700}}/><span style={{fontSize:'11px',fontWeight:700}}>kg</span></div></td>}<td>{normalizeFlightNo(r.mawb,r.flightNo)||(digits(r.mawb).startsWith('160')?<span title="Cathay has not returned verified flight details for this AWB. Automatic carrier checks continue." style={{fontSize:10,fontWeight:800,color:'#9a3412'}}>CX DATA PENDING</span>:'—')}</td>{exportLikeTab&&<><td>{r.departureDate||r.flightDate||'—'}</td><td>{formatTime24(r.departureTime)||'—'}</td><td><strong className="mailTime">{formatDateTime24(r.handoverTime||handoverTimeFrom(r.departureDate||r.flightDate,r.departureTime))||'—'}</strong></td><td><div className="mailChoice"><button className={`mailBtn yes ${r.handoverDone===true?'selected':''}`} onClick={()=>setHandover(r.mawb,true)}>YES</button><button className={`mailBtn no ${r.handoverDone!==true?'selected':''} ${exportHandoverOverdue(r,mailClock)?'urgentBlink':''}`} onClick={()=>setHandover(r.mawb,false)}>NO</button></div></td></>}{importLikeTab&&<><td title={r._emiratesMasterEta?'Emirates MAWB-level ETA only. This physical part has no confirmed final flight or arrival time.':r.arrivalEstimate?r.arrivalTimeSource||'Estimated flight arrival (cargo not yet confirmed arrived)':''}>{r.arrivalDate||airAsiaScheduledFinalArrival(r)?.date||r._saudiaTransitEta?.date||r._saudiaManifestPlan?.date||r._emiratesMasterEta?.date||'—'}{r._saudiaTransitEta?<small style={{display:'block',color:'#925b09',fontSize:'10px',fontWeight:700}}>TRANSIT {r._saudiaTransitEta.station} ETA • DEL PENDING</small>:r._saudiaManifestPlan?<small style={{display:'block',color:'#925b09',fontSize:'10px',fontWeight:700}}>{r._saudiaManifestPlan.label}</small>:r._emiratesMasterEta?<small style={{display:'block',color:'#925b09',fontSize:'10px',fontWeight:700}}>MAWB ETA • PART UNCONFIRMED</small>:airAsiaScheduledFinalArrival(r)?<small style={{display:'block',color:'#925b09',fontSize:'10px',fontWeight:700}}>SCHEDULED ONLY • DEL NOT ARRIVED</small>:r.arrivalEstimate&&<small style={{display:'block',color:'#925b09',fontSize:'10px',fontWeight:700}}>{expectedArrivalLabel(r)}</small>}</td><td title={r._emiratesMasterEta?'Provisional MAWB ETA in IST, not the part-specific arrival time.':r.arrivalEstimate?'IST flight ETA — cargo not yet confirmed arrived':''}>{r._saudiaTransitEta?formatTime24(r._saudiaTransitEta.time):r._saudiaManifestPlan?(formatTime24(r._saudiaManifestPlan.time)||'—'):r._emiratesMasterEta?formatTime24(r._emiratesMasterEta.time):formatTime24(r.arrivalTime||airAsiaScheduledFinalArrival(r)?.time)||'—'}{r._saudiaTransitEta?<small style={{display:'block',color:'#925b09',fontSize:'10px'}}>IST • {r._saudiaTransitEta.label}</small>:r._saudiaManifestPlan?<small style={{display:'block',color:'#925b09',fontSize:'10px'}}>{r._saudiaManifestPlan.time?'IST • PLANNED ETA':'ETA NOT CONFIRMED'}</small>:r._emiratesMasterEta?<small style={{display:'block',color:'#925b09',fontSize:'10px'}}>IST • MASTER ONLY</small>:airAsiaScheduledFinalArrival(r)?<small style={{display:'block',color:'#925b09',fontSize:'10px'}}>IST • EXPECTED ONLY</small>:r.arrivalEstimate&&<small style={{display:'block',color:'#925b09',fontSize:'10px'}}>IST ETA</small>}</td><td><strong className="mailTime">{mailTimeForRow(r)||'—'}</strong>{r._emiratesMasterEta&&<small style={{display:'block',color:'#925b09',fontSize:'10px',fontWeight:700}}>MASTER ETA • PROVISIONAL</small>}</td><td>{r._saudiaPendingVirtual?<span title="Saudia balance without a verified MAN/FOW/DEP assignment. It is not yet an arrived or departed shipment." style={{fontSize:'10px',fontWeight:800,color:'#92400e'}}>AWAITING FLIGHT</span>:<div className="mailChoice"><button className={`mailBtn yes ${r.mailSent===true?'selected':''}`} onClick={()=>setMail(r.mawb,true,r._partKey||'')}>YES</button><button className={`mailBtn no ${r.mailSent!==true?'selected':''} ${importMailOverdue(r,mailClock)?'urgentBlink':''}`} onClick={()=>setMail(r.mawb,false,r._partKey||'')}>NO</button></div>}</td><td>{r._saudiaPendingVirtual?<span title="This Saudia balance has not arrived; Customs Clear is unavailable until an actual part arrival." style={{fontSize:'10px',fontWeight:800,color:'#92400e'}}>AWAITING ARRIVAL</span>:<label className={`customsToggle ${r.customsCleared?'checked':''}`}><input type="checkbox" checked={r.customsCleared===true} onChange={e=>setCustomsClear(r.mawb,e.target.checked,r._partKey||'')}/><span>{r.customsCleared?'CLEARED':'PENDING'}</span></label>}</td></>}{exportLikeTab&&(!isAdmin||adminView==='ACTIVE')&&<td><label className={`customsToggle ${r.masterCopyReceived?'checked':''}`}><input type="checkbox" checked={r.masterCopyReceived===true} onChange={e=>setMasterCopyReceived(r.mawb,e.target.checked)}/><span>{r.masterCopyReceived?'✓':'TICK'}</span></label></td>}{exportLikeTab&&<><td>{r.arrivalDate||'—'}</td><td>{formatTime24(r.arrivalTime)||'—'}</td></>}<td><span className={`badge ${tone(r.status)}`}>{businessStatus(r.status,r.timingStatus,r.arrivalDate,r.mawb,r)}</span>{digits(r.mawb).startsWith('229')&&r.kuwaitFlightDeparted===true&&<small style={{display:'block',fontWeight:800,color:'#185d91',fontSize:11,marginTop:3}} title={r.kuwaitFlightDepartureSource||'Dated aircraft flight status'}>KU FLIGHT DEPARTED • {r.kuwaitCargoDepartureConfirmed?'CARGO DEP CONFIRMED':'CARGO DEP PENDING'}</small>}{r.saudiaRcfFollowUp&&<span className="saudiaRcfPill" title="SAL RCF confirms receipt from flight, not customs inspection. Confirm status before telling the client.">RCF • VERIFY CUSTOMS</span>}</td><td style={{textAlign:'right',fontWeight:800,whiteSpace:'nowrap'}} title="Physical row weight divided by row bags; split shipments calculated independently">{averageWeightPerBag(r)===null?'—':bagAverageFormat.format(averageWeightPerBag(r))}</td><td><div className="actions"><button className="refreshBtn" onClick={()=>refreshByMawb(r.mawb)}>REFRESH</button>{officialUrl(r)&&<a className={`trackLink ${r.trackingError?'urgent':''}`} href={officialUrl(r)} target="_blank" rel="noreferrer" onClick={e=>{e.preventDefault();const copied=openOfficial(r);setNote(officialHasDirectMawb(r)?`${r.mawb} opened using the airline's direct MAWB tracking link.`:digits(r.mawb).startsWith('098')?(copied?`Air India MAWB ${digits(r.mawb)} copied. Paste all 11 digits into AWB Number.`:`Air India portal opened for ${r.mawb}. If its field is blank, copy the MAWB shown here and paste it.`):(copied?`${r.mawb} copied; official tracking portal opened.`:`Official tracking portal opened for ${r.mawb}. Paste the MAWB if its field is blank.`))}}>OFFICIAL TRACK ↗</a>}{!privateTab&&<button className="moveBtn" onClick={()=>moveShipment(r.mawb)}>MOVE TO {importLikeTab?'EXPORT':'IMPORT'}</button>}{isAdmin&&<button className="removeBtn" onClick={()=>remove(r.mawb)}>DELETE</button>}</div></td>{importLikeTab&&<td style={{minWidth:'190px',width:'190px',maxWidth:'220px',whiteSpace:'normal',fontSize:'11px'}}><div className="cargoRemarks" title={r.saudiaRcfFollowUp?'RCF received at '+(r.saudiaRcfStation||'transit')+'; customs inspection must be verified with Saudia before informing client. '+shipmentDisplayRemarks(r):shipmentDisplayRemarks(r)} style={{minHeight:'30px',boxSizing:'border-box',width:'100%',padding:'5px 7px',border:'1px solid #cbd5e1',borderRadius:'6px',background:r.saudiaRcfFollowUp?'#e9e2ff':'#fff',fontWeight:r.remarks?700:400,lineHeight:1.25,...(digits(r.mawb).startsWith('071')?{height:'30px',maxWidth:'190px',whiteSpace:'nowrap',overflowX:'auto',overflowY:'hidden'}:{})}}>{r.saudiaRcfFollowUp?<><strong style={{color:'#4c1d95'}}>SAL RCF {r.saudiaRcfStation||''}{r.saudiaRcfPieces?' · '+r.saudiaRcfPieces+' bags':''} — verify customs check; inform client after confirmation.</strong>{' '}{shipmentDisplayRemarks(r)}</>:shipmentDisplayRemarks(r)}</div></td>}</tr>):<tr><td colSpan={importLikeTab?((!isAdmin||adminView==='ACTIVE')?24:23):((!isAdmin||adminView==='ACTIVE')?(canWeightMinus?25:24):(canWeightMinus?23:22))} className="empty">{isAdmin&&adminView==='CLEARED'?(importLikeTab?'No customs-cleared masters match these filters.':'No export masters with Master Copy Received yet.'):`No ${activeTab.toLowerCase()} MAWB added yet.`}</td></tr>}</tbody>{exportLikeTab&&canWeightMinus&&visibleRows.length>0&&<tfoot><tr><td colSpan={adminView==='ACTIVE'?13:12}></td><td style={{minWidth:'100px',width:'100px',fontWeight:900,whiteSpace:'nowrap'}}>Total: {totalWeightMinus.toLocaleString(undefined,{maximumFractionDigits:2})} kg</td><td colSpan={adminView==='ACTIVE'?11:10}></td></tr></tfoot>}</table></section>
    {(customsFilterMode||(isAdmin&&exportLikeTab)||(!isAdmin&&employeeUsername.toLowerCase()==='sonu'))&&<section className="tableSummary"><span>{visibleRows.length} master{visibleRows.length===1?'':'s'} shown</span><strong>Total Weight: {totalWeight.toLocaleString(undefined,{maximumFractionDigits:2})} kg</strong>{isAdmin&&exportLikeTab&&<strong>Weight Minus: {totalWeightMinus.toLocaleString(undefined,{maximumFractionDigits:2})} kg</strong>}</section>}
    <footer>{CONFIGURED_PREFIXES.length} airline prefixes • Shared Neon storage • Import Mail Time ascending • Import Customs Clear archive • Export / Other Countries Export Master Copy archive • Other Countries Import Mail and Customs Clear • Admin-only private Other Countries • in-place server sync • 10-minute active sync</footer>
  </main>
}