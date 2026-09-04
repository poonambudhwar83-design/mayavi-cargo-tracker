import { trackEmirates as trackEmiratesBase } from './emiratesEsky.js';

const MONTH={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
const pad=v=>String(v).padStart(2,'0');
function parseDate(s=''){
  const t=String(s).toUpperCase();
  let m=t.match(/(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s+(20\d{2})/);
  if(m)return `${m[3]}-${MONTH[m[2]]}-${pad(m[1])}`;
  m=t.match(/(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s+(\d{1,2}),?\s+(20\d{2})/);
  if(m)return `${m[3]}-${MONTH[m[1]]}-${pad(m[2])}`;
  return'';
}
function normalizeFromPanel(result){
  if(!result?.ok)return result;
  const text=String(result?.debug?.panelSample||result?.debug?.opened?.bodySample||'').replace(/\s+/g,' ').trim();
  if(!text)return result;

  const shipment={...(result.shipment||{})};

  // Overall shipment route is shown in the header before Show Details.
  const header=text.split(/Show Details/i)[0]||text;
  const codes=[...header.matchAll(/\(([A-Z]{3})\)/g)].map(m=>m[1]);
  if(codes.length>=2){shipment.origin=codes[0];shipment.destination=codes[1];}

  // Prefer the most recent Tracking Details piece/weight pair, e.g. "49 Pieces 1345 K".
  const tracking=text.split(/Tracking Details/i)[1]||text;
  const pw=tracking.match(/\b(\d{1,6})\s+Pieces?\s+([\d,.]+)\s*K(?:G|GS)?\b/i);
  if(pw){shipment.pieces=pw[1];shipment.bags=pw[1];shipment.weight=pw[2].replace(/,/g,'');}

  // Use the final arrival flight, not the first leg.
  const arrFlight=tracking.match(/Arrived\s+at\s+[A-Z]{3}\s+on\s+Flight\s+EK[- ]?(\d{2,4})/i)
    ||tracking.match(/Received\s+at\s+[A-Z]{3}\s+from\s+Flight\s+No\.?\s*EK[- ]?(\d{2,4})/i);
  if(arrFlight)shipment.flightNo=`EK${arrFlight[1]}`;

  // Top status gives the actual destination arrival date/time.
  const arrived=text.match(/Shipment\s+has\s+arrived\s+at\s+([A-Z]{3})\s+on\s+[A-Za-z]{3},?\s+(\d{1,2}\s+[A-Za-z]{3}\s+20\d{2})\s+(\d{1,2}:\d{2})/i);
  if(arrived){
    shipment.destination=arrived[1].toUpperCase();
    shipment.arrivalDate=parseDate(arrived[2]);
    shipment.arrivalTime=arrived[3].padStart(5,'0');
    shipment.arrivalIsActual=true;
    shipment.status='ARRIVED';
  }

  shipment.source='Emirates eSkyCargo Tracking Details screenshot + rendered text';
  return {...result,shipment};
}

export async function trackEmirates(mawb){
  return normalizeFromPanel(await trackEmiratesBase(mawb));
}
