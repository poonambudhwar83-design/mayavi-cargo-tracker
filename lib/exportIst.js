const AIRPORT_TZ = {
  // India
  DEL:'Asia/Kolkata', BOM:'Asia/Kolkata', BLR:'Asia/Kolkata', MAA:'Asia/Kolkata', HYD:'Asia/Kolkata',
  AMD:'Asia/Kolkata', CCU:'Asia/Kolkata', COK:'Asia/Kolkata', ATQ:'Asia/Kolkata', PNQ:'Asia/Kolkata',
  GOI:'Asia/Kolkata', JAI:'Asia/Kolkata', LKO:'Asia/Kolkata', IXC:'Asia/Kolkata', TRV:'Asia/Kolkata',

  // Gulf / Middle East
  DXB:'Asia/Dubai', DWC:'Asia/Dubai', SHJ:'Asia/Dubai', AUH:'Asia/Dubai', RKT:'Asia/Dubai',
  DOH:'Asia/Qatar', KWI:'Asia/Kuwait', MCT:'Asia/Muscat', BAH:'Asia/Bahrain',
  RUH:'Asia/Riyadh', JED:'Asia/Riyadh', DMM:'Asia/Riyadh',

  // UK / Ireland
  LHR:'Europe/London', LGW:'Europe/London', STN:'Europe/London', MAN:'Europe/London',
  BHX:'Europe/London', EDI:'Europe/London', DUB:'Europe/Dublin',

  // Europe
  FRA:'Europe/Berlin', MUC:'Europe/Berlin', BER:'Europe/Berlin',
  CDG:'Europe/Paris', ORY:'Europe/Paris', AMS:'Europe/Amsterdam', BRU:'Europe/Brussels',
  ZRH:'Europe/Zurich', VIE:'Europe/Vienna', MXP:'Europe/Rome', FCO:'Europe/Rome',
  MAD:'Europe/Madrid', BCN:'Europe/Madrid', LIS:'Europe/Lisbon', CPH:'Europe/Copenhagen',
  OSL:'Europe/Oslo', ARN:'Europe/Stockholm', HEL:'Europe/Helsinki', WAW:'Europe/Warsaw',
  PRG:'Europe/Prague', BUD:'Europe/Budapest', ATH:'Europe/Athens', IST:'Europe/Istanbul',

  // East / Southeast Asia
  HKG:'Asia/Hong_Kong', SIN:'Asia/Singapore', BKK:'Asia/Bangkok', KUL:'Asia/Kuala_Lumpur',
  CGK:'Asia/Jakarta', SGN:'Asia/Ho_Chi_Minh', HAN:'Asia/Ho_Chi_Minh',
  TPE:'Asia/Taipei', ICN:'Asia/Seoul', NRT:'Asia/Tokyo', HND:'Asia/Tokyo',
  PVG:'Asia/Shanghai', PEK:'Asia/Shanghai', CAN:'Asia/Shanghai', SZX:'Asia/Shanghai',

  // Australia / New Zealand
  SYD:'Australia/Sydney', MEL:'Australia/Melbourne', BNE:'Australia/Brisbane',
  PER:'Australia/Perth', ADL:'Australia/Adelaide', AKL:'Pacific/Auckland',

  // North America - Canada
  YYZ:'America/Toronto', YVR:'America/Vancouver', YUL:'America/Toronto',
  YYC:'America/Edmonton', YEG:'America/Edmonton',

  // North America - USA
  JFK:'America/New_York', EWR:'America/New_York', BOS:'America/New_York', IAD:'America/New_York',
  ATL:'America/New_York', MIA:'America/New_York', ORD:'America/Chicago', DFW:'America/Chicago',
  IAH:'America/Chicago', LAX:'America/Los_Angeles', SFO:'America/Los_Angeles', SEA:'America/Los_Angeles',
  DEN:'America/Denver',

  // Africa
  ADD:'Africa/Addis_Ababa', NBO:'Africa/Nairobi', JNB:'Africa/Johannesburg',
  CAI:'Africa/Cairo', CMN:'Africa/Casablanca'
};

const pad = v => String(v).padStart(2,'0');

function validDate(v=''){
  return /^20\d{2}-\d{2}-\d{2}$/.test(String(v||'').trim());
}
function validTime(v=''){
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v||'').trim());
}

export function airportTimeZone(code=''){
  return AIRPORT_TZ[String(code||'').trim().toUpperCase()] || '';
}

export function localAirportTimeToIst(date='',time='',airport=''){
  const zone=airportTimeZone(airport);
  if(!zone||!validDate(date)||!validTime(time))return null;
  if(zone==='Asia/Kolkata')return {date,time,timeZone:'IST'};

  const [y,m,d]=String(date).split('-').map(Number);
  const [hh,mm]=String(time).split(':').map(Number);
  const wanted=Date.UTC(y,m-1,d,hh,mm);
  let guess=wanted;

  const partsAt=(ms,timeZone)=>Object.fromEntries(
    new Intl.DateTimeFormat('en-CA',{
      timeZone,year:'numeric',month:'2-digit',day:'2-digit',
      hour:'2-digit',minute:'2-digit',hourCycle:'h23'
    }).formatToParts(new Date(ms))
      .filter(p=>p.type!=='literal')
      .map(p=>[p.type,Number(p.value)])
  );

  // Convert wall-clock airport local time into an absolute instant.
  for(let i=0;i<4;i++){
    const p=partsAt(guess,zone);
    const shown=Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute);
    guess += wanted-shown;
  }

  const ist=partsAt(guess,'Asia/Kolkata');
  return {
    date:`${ist.year}-${pad(ist.month)}-${pad(ist.day)}`,
    time:`${pad(ist.hour)}:${pad(ist.minute)}`,
    timeZone:'IST'
  };
}

export function normalizeExportTimesToIst(row={}){
  if(String(row?.shipmentType||'').toUpperCase()!=='EXPORT')return row;
  const out={...row};

  const depZone=String(out.departureTimeZone||'').toUpperCase();
  if(depZone!=='IST'){
    const depDate=String(out.departureDate||out.flightDate||'').trim();
    const depTime=String(out.departureTime||'').trim();
    const dep=localAirportTimeToIst(depDate,depTime,out.origin||'');
    if(dep){
      out.departureDate=dep.date;
      out.departureTime=dep.time;
      out.departureTimeZone='IST';
      out.departureTimeSource=`${out.departureTimeSource||out.source||'Official source'}; origin local time converted to IST`;
    }
  }

  const arrZone=String(out.arrivalTimeZone||'').toUpperCase();
  if(arrZone!=='IST'){
    const arrDate=String(out.arrivalDate||'').trim();
    const arrTime=String(out.arrivalTime||'').trim();
    const arr=localAirportTimeToIst(arrDate,arrTime,out.destination||'');
    if(arr){
      out.arrivalDate=arr.date;
      out.arrivalTime=arr.time;
      out.arrivalTimeZone='IST';
      out.arrivalTimeSource=`${out.arrivalTimeSource||out.source||'Official source'}; destination local time converted to IST`;
    }
  }

  return out;
}
