// KLM myCargo shipment-detail Progress Details parser.
// Never infer actual DEP/ARR from future 'Estimated' Station View rows.
const MON={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',
  JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
const pad=v=>String(v).padStart(2,'0');
function section(text=''){
  const p=String(text).split(/Progress\s+details/i);
  return p.length>1?p[1].split(/Shipment\s+details|Flight\s+(?:schedule|details)|Customer\s+service/i)[0]:'';
}
function yyyy(day,mon,year=new Date().getUTCFullYear()){
  const mm=MON[String(mon||'').toUpperCase().slice(0,3)];
  return mm?year+'-'+mm+'-'+pad(day):'';
}
export function parseKlmListEvents(text=''){
  const flat=section(text).replace(/\s+/g,' ');
  const out=[];
  const rx=/\b(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s+(\d{1,2}:\d{2})\s+([A-Z]{3})\s+(BKG|BKD|FWB|FOH|RCS|DEP|ARR|RCF|DLV)\b/ig;
  for(const m of flat.matchAll(rx)){
    const date=yyyy(m[1],m[2]);
    if(date)out.push({code:m[5].toUpperCase(),station:m[4].toUpperCase(),
      date,time:m[3],actual:true});
  }
  return out;
}
export function parseKlmStationEvents(text=''){
  const p=section(text),rows=p.replace(/\r/g,'').split('\n').map(t=>t.trim()).filter(Boolean);
  const events=[];
  let lastStation='';
  for(const row of rows){
    const station=row.match(/^([A-Z]{3})$/);
    if(station){lastStation=station[1];continue;}
    const m=row.match(/^(?:([A-Z]{3})\s+)?(ACCEPTED|DEPARTED|ARRIVAL|ARRIVED|DELIVERED)\s+(\d{1,6})\s*(?:pcs?|pieces?)?\s+(?:(Estimated|Actual)\s*:\s*)?(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s+(\d{1,2}:\d{2})/i);
    if(!m)continue;
    const date=yyyy(m[5],m[6]);
    if(date)events.push({station:(m[1]||lastStation).toUpperCase(),code:m[2].toUpperCase(),
      pieces:m[3],date,time:m[7],estimated:String(m[4]||'').toUpperCase()==='ESTIMATED'});
  }
  return events;
}
export function applyKlmProgressDetails(shipment={},listText='',stationText=''){
  const list=parseKlmListEvents(listText);
  const station=parseKlmStationEvents(stationText);
  if(!list.length&&!station.length)return shipment;
  const result={...shipment,klmListEvents:list,klmStationEvents:station};
  const sort=(a,b)=>(a.date+' '+a.time).localeCompare(b.date+' '+b.time);
  const booked=list.filter(e=>e.code==='BKG'||e.code==='BKD').sort(sort)[0];
  if(booked){result.bookingDate=booked.date;result.bookingTime=booked.time;
    result.bookingDateSource='KLM List View actual BKG';}
  const last=list.slice().sort(sort).at(-1);
  if(last){result.sourceStatus=last.code;result.currentLocation=last.station;
    result.progressLastActualDate=last.date;result.progressLastActualTime=last.time;}
  const departed=list.filter(e=>e.code==='DEP').sort(sort).at(-1);
  if(departed){result.departureDate=departed.date;result.departureTime=departed.time;
    result.departureOrigin=departed.station;result.departureIsActual=true;
    result.departureTimeZone=departed.station==='DEL'?'IST':'LOCAL';
    result.departureTimeSource='KLM List View actual DEP';}
  const arrived=list.filter(e=>['ARR','RCF','DLV'].includes(e.code)&&
    result.destination&&e.station===result.destination).sort(sort).at(-1);
  if(arrived){result.arrivalDate=arrived.date;result.arrivalTime=arrived.time;
    result.arrivalTimeZone=arrived.station==='DEL'?'IST':'LOCAL';
    result.arrivalIsActual=true;result.arrivalEstimate=false;
    result.arrivalTimeSource='KLM List View actual '+arrived.code;
    result.status=arrived.code==='DLV'?'DELIVERED':'ARRIVED';}
  // The Station View displays DEL ARRIVAL Estimated separately from actual ARR.
  // Populate the expected arrival without ever promoting it to an actual event.
  if(!arrived&&result.arrivalIsActual!==true){
    // The estimated Station View arrival must never suppress an actual DEP
    // milestone from List View. They represent independent facts.
    if(departed)result.status='DEPARTED';
    else if(last&&['BKG','BKD','FWB','FOH','RCS'].includes(last.code))
      result.status='BOOKED';
    const estimated=station.filter(e=>e.station===result.destination &&
      ['ARRIVAL','ARRIVED'].includes(e.code) && e.estimated && e.date && e.time)
      .sort(sort).at(-1);
    if(estimated){
      result.arrivalDate=estimated.date;
      result.arrivalTime=estimated.time;
      result.arrivalTimeZone=estimated.station==='DEL'?'IST':'LOCAL';
      result.arrivalIsActual=false;
      result.arrivalEstimate=true;
      result.arrivalTimeSource='KLM Station View estimated destination arrival';
      result.scheduledArrivalDate=estimated.date;
      result.scheduledArrivalTime=estimated.time;
    }
  }
  return result;
}
