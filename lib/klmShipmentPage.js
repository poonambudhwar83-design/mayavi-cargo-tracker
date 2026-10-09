// Only the current AWB-specific public KLM myCargo detail page is accepted.
// No fixtures, screenshot fallback or fabricated arrival milestones.
const digits=v=>String(v??'').replace(/\D/g,'');
const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
const pad=v=>String(v).padStart(2,'0');
const MON={JAN:1,FEB:2,MAR:3,APR:4,MAY:5,JUN:6,JUL:7,AUG:8,SEP:9,OCT:10,NOV:11,DEC:12};
const dateOf=(d,mon,year)=>String(year)+'-'+pad(MON[mon.toUpperCase()])+'-'+pad(d);
function weightKg(input){
  let n=String(input||'').replace(/\s/g,'');
  if(n.includes(',')&&n.includes('.'))
    n=n.lastIndexOf(',')>n.lastIndexOf('.')?n.replace(/\./g,'').replace(',','.'):n.replace(/,/g,'');
  else if(n.includes(','))n=/,\d{1,2}$/.test(n)?n.replace(',','.'):n.replace(/,/g,'');
  else if(/^\d{1,3}(?:\.\d{3})+$/.test(n))n=n.replace(/\./g,'');
  const value=Number(n);
  return Number.isFinite(value)&&value>0&&value<1000000?String(Number(value.toFixed(3))):'';
}
export function parseKlmShipmentPageText(pageText='',expectedAwb='',year=new Date().getUTCFullYear()){
  const target=digits(expectedAwb),page=String(pageText||'');
  if(!/^074\d{8}$/.test(target))return null;
  // Reject a filled homepage form or result for another AWB.
  if(!digits(page).includes(target)||!/Shipment\s+details/i.test(page)||
     !/Flight\s+(?:schedule|details)|Progress\s+details/i.test(page))return null;
  const header=page.split(/Shipment\s+details/i)[0].slice(0,2500);
  const route=header.match(/\b([A-Z]{3})\s*(?:➜|➝|→|->|➔|►|to)\s*([A-Z]{3})\b/i);
  const detail=page.split(/Shipment\s+details/i)[1]
    ?.split(/Flight\s+(?:schedule|details)|Progress\s+details|Warehouse\s+address/i)[0]||'';
  const cargo=detail.match(/\b(\d{1,6})\s*(?:pcs?|pieces?)\s*[,;]\s*(\d[\d., ]{0,17})\s*(kg|kgs|kgm)\b/i);
  const explicit=detail.match(/\b(?:gross|total|shipment)\s*(?:gross\s*)?weight\b\s*:?\s*(\d[\d., ]{0,17})\s*(kg|kgs|kgm)\b/i);
  const pieces=cargo?.[1]||'',weight=weightKg(cargo?.[2]||explicit?.[1]||'');
  const flightSection=page.split(/Flight\s+(?:schedule|details)/i)[1]
    ?.split(/Estimated\s+Pick\s*up|Progress\s+details|Shipment\s+milestones/i)[0]||'';
  const legs=[];
  const RX=/\b([A-Z]{3})\s*[-–—]\s*([A-Z]{3})\s+(?:[^\w]{0,12}\s*)?\b((?:KL|AF|MP)\s*0*\d{2,4})\b\s+(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s+(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s+(\d{1,2}:\d{2})\s+(\d{1,6})\s+pieces?\s*(CONFIRMED|PENDING|BOOKED|CANCELLED)?/ig;
  for(const m of clean(flightSection).matchAll(RX)){
    const depMonth=MON[m[5].toUpperCase()],arrMonth=MON[m[8].toUpperCase()];
    legs.push({origin:m[1].toUpperCase(),destination:m[2].toUpperCase(),
      flightNo:m[3].replace(/\s/g,'').toUpperCase(),
      departureDate:dateOf(m[4],m[5],year),departureTime:m[6],
      arrivalDate:dateOf(m[7],m[8],arrMonth<depMonth?year+1:year),arrivalTime:m[9],
      pieces:m[10],flightStatus:String(m[11]||'').toUpperCase()});
  }
  if(!legs.length&&!weight&&!pieces)return null;
  const last=legs.at(-1),first=legs[0];
  const origin=first?.origin||route?.[1]?.toUpperCase()||'';
  const destination=last?.destination||route?.[2]?.toUpperCase()||'';
  const out={mawb:target.slice(0,3)+'-'+target.slice(3),airlineName:'KLM Cargo',
    carrierCode:'KL',origin,destination,status:/\bEN\s*ROUTE\b/i.test(header)?'IN TRANSIT':'BOOKED',
    arrivalIsActual:false,arrivalEstimate:Boolean(last?.arrivalDate&&last?.arrivalTime),
    source:'AFKLM live AWB-specific Shipment Details and Flight Schedule',
    officialTracker:'https://afklcargo.com/mycargo/shipment/detail/'+target};
  if(weight){out.weight=weight;out.masterWeight=weight;out.weightSource='KLM official Shipment details cargo kg';}
  if(pieces){out.pieces=pieces;out.bags=pieces;out.masterPieces=pieces;}
  if(legs.length){
    out.flightSchedule=legs;
    out.via=legs.length>1?legs.slice(0,-1).map(l=>l.destination).join(' / '):'';
    out.flightNo=last.flightNo;out.finalFlightNo=last.flightNo;
    out.flightDate=last.departureDate;out.finalFlightDate=last.departureDate;
    out.scheduledArrivalDate=last.arrivalDate;out.scheduledArrivalTime=last.arrivalTime;
    // Local Time on KLM page: Delhi clock is already IST.
    out.scheduledArrivalTimeZone=destination==='DEL'?'IST':'LOCAL';
    out.arrivalDate=last.arrivalDate;out.arrivalTime=last.arrivalTime;
    out.arrivalTimeZone=out.scheduledArrivalTimeZone;
    out.arrivalTimeSource='KLM official flight schedule ETA, not cargo ARR';
  }
  return out;
}
