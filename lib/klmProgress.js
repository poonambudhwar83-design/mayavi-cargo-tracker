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
  const rows=section(text).replace(/\r/g,'').split('\n').map(t=>t.trim()).filter(Boolean);
  const events=[];
  let station='',block=[];
  const flush=()=>{
    if(!station||!block.length){block=[];return;}
    // myCargo's Station view is a grid. Chrome innerText may put the event,
    // piece count, and "Estimated" timestamp on three separate lines.
    const flat=block.join(' ').replace(/\s+/g,' ').trim();
    const rx=/\b(ACCEPTED|DEPARTED|ARRIVAL|ARRIVED|DELIVERED)\s+(\d{1,6})\s*(?:pcs?|pieces?)?\s+(?:(Estimated|Actual)\s*:\s*)?(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s+(\d{1,2}:\d{2})/ig;
    for(const m of flat.matchAll(rx)){
      const date=yyyy(m[4],m[5]);
      if(date)events.push({station,code:m[1].toUpperCase(),
        pieces:m[2],date,time:m[6],
        estimated:String(m[3]||'').toUpperCase()==='ESTIMATED'});
    }
    block=[];
  };
  for(const row of rows){
    const bare=row.match(/^([A-Z]{3})$/);
    const lead=row.match(/^([A-Z]{3})\s+(?=ACCEPTED|DEPARTED|ARRIVAL|ARRIVED|DELIVERED\b)/i);
    if((bare&&!MON[bare[1]])||lead){
      flush();
      station=(bare?bare[1]:lead[1]).toUpperCase();
      if(lead)block.push(row.slice(lead[0].length));
      continue;
    }
    if(station)block.push(row);
  }
  flush();
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
  const stationDeparted=station.filter(e=>e.code==='DEPARTED'&&!e.estimated).sort(sort).at(-1);
  const actualDeparture=departed||stationDeparted;
  if(actualDeparture){result.departureDate=actualDeparture.date;result.departureTime=actualDeparture.time;
    result.departureOrigin=actualDeparture.station;result.departureIsActual=true;
    result.departureTimeZone=actualDeparture.station==='DEL'?'IST':'LOCAL';
    result.departureTimeSource=departed?'KLM List View actual DEP':'KLM Station View actual departure';}
  const arrived=list.filter(e=>['ARR','RCF','DLV'].includes(e.code)&&
    result.destination&&e.station===result.destination).sort(sort).at(-1);
  const stationArrived=station.filter(e=>['ARRIVAL','ARRIVED','DELIVERED'].includes(e.code)&&
    !e.estimated&&result.destination&&e.station===result.destination).sort(sort).at(-1);
  const actualArrival=arrived||stationArrived;
  if(actualArrival){result.arrivalDate=actualArrival.date;result.arrivalTime=actualArrival.time;
    result.arrivalTimeZone=actualArrival.station==='DEL'?'IST':'LOCAL';
    result.arrivalIsActual=true;result.arrivalEstimate=false;
    result.arrivalTimeSource=arrived?'KLM List View actual '+arrived.code:'KLM Station View actual '+actualArrival.code;
    result.status=['DLV','DELIVERED'].includes(actualArrival.code)?'DELIVERED':'ARRIVED';}
  // The Station View displays DEL ARRIVAL Estimated separately from actual ARR.
  // Populate the expected arrival without ever promoting it to an actual event.
  if(!actualArrival&&result.arrivalIsActual!==true){
    // The estimated Station View arrival must never suppress an actual DEP
    // milestone from List View. They represent independent facts.
    if(actualDeparture)result.status='DEPARTED';
    else if(last&&['BKG','BKD','FWB','FOH','RCS'].includes(last.code))
      result.status='BOOKED';
    else if(station.some(e=>e.code==='ACCEPTED'&&!e.estimated)&&
      (!result.status||['TRACKING','BOOKED'].includes(result.status)))
      result.status='IN TRANSIT';
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
