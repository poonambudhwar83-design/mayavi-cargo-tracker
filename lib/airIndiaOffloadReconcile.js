// Air India (098) official Activity View partial-offload reconciliation.
// Do not modify the SHA-locked airline reader: this layer only corrects the
// master business status after the official reader succeeds.
// Airline DEPARTURE and later OFFLOADED events are conflicting observations,
// not grounds to claim that master-minus-offloaded pieces reached the aircraft.
const flight = value => String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,'').replace(/^(AI|IX)0+(\d)/,'$1$2');
const month = {JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
const date = (day,mon,year) => year+'-'+(month[String(mon||'').slice(0,3).toUpperCase()]||'')+'-'+String(day).padStart(2,'0');
const flightEvent=/\bDEPARTURE\s+Departed\s+(\d{1,6})\s+pcs\s+[\d,.]+\s+kg\s+on\s+(AI|IX)[- ]?(\d{2,4})[A-Z]?\s*,\s*(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[A-Za-z]*\s+(20\d{2})\s+\d{1,2}:\d{2}\s*\(A\)\s+at\s+([A-Z]{3})\b/gi;
const offloadEvent=/\bOFFLOADED\s+Offloaded\s+(\d{1,6})\s+pcs\s+[\d,.]+\s+kg\s+for\s+(AI|IX)[- ]?(\d{2,4})[A-Z]?\s*,\s*(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[A-Za-z]*\s+(20\d{2})\s+at\s+([A-Z]{3})\b/gi;

export function reconcileAirIndiaPartialOffload(official={},activityText=''){
  const awb=String(official.mawb||'').replace(/\D/g,'');
  const master=Number(official.masterPieces||official.pieces||official.bags||0);
  const offloaded=Number(official.offloadedPieces||0);
  if(!/^098\d{8}$/.test(awb)||String(official.status||'').toUpperCase()!=='OFFLOADED'||
     !Number.isInteger(master)||!Number.isInteger(offloaded)||master<=0||
     offloaded<=0||offloaded>=master)return null;
  const raw=String(activityText||'').replace(/\s+/g,' ').trim();
  const offloads=[...raw.matchAll(offloadEvent)];
  const currentFlight=flight(official.flightNo);
  const currentDate=String(official.flightDate||'');
  const station=String(official.offloadStation||'').toUpperCase();
  // Do not relabel cargo based on a mismatched, stale or unhydrated timeline.
  const currentOffload=offloads.find(m=>
    flight(m[2]+m[3])===currentFlight&&
    date(m[4],m[5],m[6])===currentDate&&
    String(m[7]).toUpperCase()===station);
  if(!currentOffload)return null;
  const departures=[...raw.matchAll(flightEvent)];
  const reported=departures.find(m=>
    m.index>currentOffload.index&&
    flight(m[2]+m[3])===currentFlight&&
    date(m[4],m[5],m[6])===currentDate&&
    String(m[7]).toUpperCase()===station)||null;
  const piecesReported=reported?Number(reported[1]):null;
  const message='PART OFFLOAD: '+offloaded+'/'+master+' pcs offloaded at '+station+'. '+
    (reported?'Air India also reports '+piecesReported+' pcs DEPARTED on '+currentFlight+'; ':'')+
    'Actual loaded balance needs airline verification. 0 kg in Activity View is not verified cargo weight.';
  return {
    status:'PART OFFLOADED',activityMilestone:'PART OFFLOADED',
    offloadReconciliationPending:true,
    offloadedPieces:String(offloaded),
    offloadedWeight:'',
    offloadedWeightUnknown:Number(official.offloadedWeight||0)===0,
    departureReportedPieces:reported?String(piecesReported):'',
    departureEvidence:reported?reported[0]:'',
    arrivalDate:'',arrivalTime:'',scheduledArrivalDate:'',scheduledArrivalTime:'',
    arrivalIsActual:false,arrivalEstimate:false,arrivalVerifiedAbsent:true,
    departureDate:'',departureTime:'',departureIsActual:false,
    remainingPieces:'',
    remarks:message
  };
}
