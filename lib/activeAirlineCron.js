import { refreshScope } from './autoRefreshScope.js';

// The shared dashboard already reads the database each minute. This helper
// selects carrier checks for the independent SERVER job, not the UI poll.
export const BATCH_SIZE=6;
export const MIN_CHECK_GAP_MS=20*60*1000;
const digits=value=>String(value||'').replace(/\D/g,'');
const dateMs=value=>{const t=Date.parse(value||'');return Number.isFinite(t)?t:0;};
const changedAt=row=>Math.max(
  dateMs(row.data?.backendCronAttemptAt),
  dateMs(row.data?.lastChecked),
  dateMs(row.tracking_checked_at)
);

export function activeAirlineCandidates(rows=[],now=new Date(),limit=BATCH_SIZE){
  const time=now instanceof Date?now.getTime():Number(now);
  if(!Number.isFinite(time))return[];
  return rows.filter(row=>{
    const awb=digits(row.awb||row.data?.mawb);
    // Gulf Air is deliberately untouched at the owner's request.
    if(!/^\d{11}$/.test(awb)||awb.startsWith('072'))return false;
    if(refreshScope(row.data||{},new Date(time))!=='ACTIVE')return false;
    return time-changedAt(row)>=MIN_CHECK_GAP_MS;
  }).sort((a,b)=>changedAt(a)-changedAt(b)
    ||String(a.awb).localeCompare(String(b.awb)))
    .slice(0,Math.max(0,Math.min(BATCH_SIZE,Number(limit)||0)));
}

// Only airline-owned movement fields are allowed into a fallback DB patch.
// Operator fields (client, Mail, Customs, remarks, rates, received amounts,
// branch data, profit etc.) must never be overwritten by a cron read.
const MOVEMENT_FIELDS=[
  'airlineName','carrierCode','origin','destination','via','transitAirport',
  'currentLocation','airport','flightNo','flightDate','departureFlightNo',
  'departureOrigin','departureDestination','departureDate','departureTime',
  'departureIsActual','departureTimeZone','departureTimeSource',
  'scheduledDeparture','scheduledDepartureDate','scheduledDepartureTime',
  'arrivalDate','arrivalTime','arrivalIsActual','arrivalEstimate',
  'arrivalTimeZone','arrivalTimeSource','arrivalVerifiedAbsent',
  'scheduledArrivalDate','scheduledArrivalTime','scheduledArrivalTimeZone',
  'scheduledArrivalTimeSource','status','sourceStatus','statusSource',
  'pieces','bags','weight','masterPieces','masterWeight','totalPieces',
  'totalWeight','arrivedPieces','arrivedWeight','remainingPieces',
  'remainingWeight','departedPieces','departedWeight','offloadedPieces',
  'offloadedWeight','nextFlightNo','nextFlightDate','nextPieces','nextWeight',
  'flightSchedule','historyEvents','bookingDate','bookingTime',
  'bookingDateSource','bookingTimeSource','officialTracker',
  'trackingViewFlightNo','trackingViewFlightDate','airIndiaActivityStatus',
  'airIndiaTrackingViewVerifiedAt','flightTrackingSource',
  'flightTrackingCheckedAt','statusUpdatedAt','isPartLoad','partLoad',
  'airIndiaPartReconciled','partShipments'
];
export function safeAirlineMovementPatch(stored={},live={}){
  const raw=String(live.status||'').trim().toUpperCase();
  // A generic provider shell that only reports TRACKING is not evidence.
  if(!raw||raw==='TRACKING')return null;
  const patch={};
  for(const key of MOVEMENT_FIELDS){
    if(!Object.hasOwn(live,key))continue;
    const value=live[key];
    if(value!==null&&value!==undefined&&value!=='')patch[key]=value;
  }
  // Old carrier responses may lag an already-confirmed cargo arrival. An
  // estimate cannot remove a physically verified arrived movement.
  if(stored.arrivalIsActual===true&&live.arrivalIsActual!==true){
    for(const key of ['status','arrivalDate','arrivalTime','arrivalIsActual',
      'arrivalEstimate','arrivalVerifiedAbsent','arrivalTimeSource',
      'arrivedPieces','arrivedWeight','remainingPieces','remainingWeight',
      'partShipments'])delete patch[key];
  }else if(live.arrivalVerifiedAbsent===true&&stored.arrivalIsActual!==true){
    patch.arrivalDate='';patch.arrivalTime='';
    patch.arrivalIsActual=false;patch.arrivalEstimate=false;
    patch.scheduledArrivalDate='';patch.scheduledArrivalTime='';
  }
  return patch;
}
