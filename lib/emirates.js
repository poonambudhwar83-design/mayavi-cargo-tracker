import { trackEmirates as trackEmiratesBase } from './emiratesFast.js';
import { readTrackingScreenshot } from './screenshotOcr.js';

const MONTH={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
const pad=v=>String(v).padStart(2,'0');
function parseDate(s=''){
  const t=String(s).toUpperCase();
  let m=t.match(/(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s+(20\d{2})/);
  if(m)return `${m[3]}-${MONTH[m[2]]}-${pad(m[1])}`;
  m=t.match(/(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s+(\d{1,2}),?\s+(20\d{2})/);
  if(m)return `${m[3]}-${MONTH[m[1]]}-${pad(m[2])}`;
  m=t.match(/\b(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})\b/);if(m)return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m=t.match(/\b(\d{1,2})[-\/.](\d{1,2})[-\/.](20\d{2})\b/);if(m)return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  return'';
}
function parseArrivalEvidence(tracking='',text='',destination=''){
  const src=String(tracking||text||'').replace(/\s+/g,' ').trim();if(!src)return null;
  const dateToken='(\\d{1,2}\\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[A-Za-z]*\\s+20\\d{2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[A-Za-z]*\\s+\\d{1,2},?\\s+20\\d{2}|20\\d{2}[-\\/.]\\d{1,2}[-\\/.]\\d{1,2}|\\d{1,2}[-\\/.]\\d{1,2}[-\\/.]20\\d{2})';
  const timeToken='(\\d{1,2}:\\d{2})';const dest=String(destination||'').toUpperCase();
  const actualPatterns=[new RegExp(`(?:Shipment\\s+has\\s+arrived|Arrived|\\bARR\\b|\\bRCF\\b|Received\\s+at\\s+destination|Received\\s+at\\s+[A-Z]{3}).{0,220}?${dateToken}.{0,60}?${timeToken}`,'i'),new RegExp(`(?:Arrival|Arrived|\\bARR\\b|\\bRCF\\b).{0,220}?Actual\\s+Time.{0,80}?${dateToken}.{0,40}?${timeToken}`,'i'),new RegExp(`Actual\\s+Time.{0,100}?${dateToken}.{0,40}?${timeToken}.{0,120}?(?:Arrival|Arrived|\\bARR\\b|\\bRCF\\b)`,'i')];
  for(const rx of actualPatterns){const m=src.match(rx);if(m){const d=parseDate(m[1]);if(d)return{date:d,time:m[2].padStart(5,'0'),actual:true};}}
  const plannedPatterns=[new RegExp(`(?:Expected\\s+to\\s+arrive|Estimated\\s+Arrival|ETA|Arrival).{0,220}?${dateToken}.{0,60}?${timeToken}`,'i'),new RegExp(`(?:Arrival|ETA).{0,220}?Planned\\s+Time.{0,80}?${dateToken}.{0,40}?${timeToken}`,'i'),new RegExp(`Planned\\s+Time.{0,100}?${dateToken}.{0,40}?${timeToken}.{0,120}?(?:Arrival|ETA)`,'i')];
  for(const rx of plannedPatterns){const m=src.match(rx);if(m){const d=parseDate(m[1]);if(d)return{date:d,time:m[2].padStart(5,'0'),actual:false};}}
  if(dest){const m=new RegExp(`${dest}.{0,260}?(?:Arrival|Arrived|ETA|\\bARR\\b|\\bRCF\\b).{0,180}?${dateToken}.{0,60}?${timeToken}`,'i').exec(src);if(m){const d=parseDate(m[1]);if(d)return{date:d,time:m[2].padStart(5,'0'),actual:/Arrived|\bARR\b|\bRCF\b/i.test(m[0])};}}
  return null;
}
function normalizeFromPanel(result){
  if(!result?.ok)return result;const text=String(result?.debug?.panelSample||result?.debug?.opened?.bodySample||'').replace(/\s+/g,' ').trim();const shipment={...(result.shipment||{})};let strongArrivalEvidence=false;
  if(text){
    const header=text.split(/Tracking Details/i)[0]||text;const codes=[...header.matchAll(/\(([A-Z]{3})\)/g)].map(m=>m[1]);if(codes.length>=2){shipment.origin=codes[0];shipment.destination=codes[codes.length-1];}
    const tracking=text.split(/Tracking Details/i)[1]||text;
    const latestMatch=tracking.match(/Latest\s+status(?:\s+at\s+[A-Z]{3})?.{0,180}?\b(Departed|DEP|Arrived|ARR|Received|RCF|Booked|BKD)\b/i)||text.match(/Latest\s+status(?:\s+at\s+[A-Z]{3})?.{0,180}?\b(Departed|DEP|Arrived|ARR|Received|RCF|Booked|BKD)\b/i);const latestState=String(latestMatch?.[1]||'').toUpperCase();
    const pw=tracking.match(/\b(\d{1,6})\s+Pieces?\s+([\d,.]+)\s*K(?:G|GS)?\b/i)||text.match(/\b(\d{1,6})\s+Pieces?\s+([\d,.]+)\s*K(?:G|GS)?\b/i)||text.match(/(?:Pieces?|Pcs?)\s*[:\-]?\s*(\d{1,6})[\s\S]{0,80}?(?:Gross\s*Weight|Weight)\s*[:\-]?\s*([\d,.]+)/i);if(pw){shipment.pieces=pw[1];shipment.bags=pw[1];shipment.weight=pw[2].replace(/,/g,'');}
    const arrFlight=tracking.match(/Arrived\s+at\s+[A-Z]{3}\s+on\s+Flight\s+EK[- ]?(\d{2,4})/i)||tracking.match(/Received\s+at\s+[A-Z]{3}\s+from\s+Flight\s+No\.?\s*EK[- ]?(\d{2,4})/i);if(arrFlight)shipment.flightNo=`EK${arrFlight[1]}`;
    if(!shipment.flightNo){const b=tracking.match(/Booked\s+on\s+Flight\s+EK[- ]?(\d{2,4})/i)||text.match(/Booked\s+on\s+Flight\s+EK[- ]?(\d{2,4})/i);if(b)shipment.flightNo=`EK${b[1]}`;}
    const arrived=text.match(/Shipment\s+has\s+arrived\s+at\s+([A-Z]{3})\s+on\s+[A-Za-z]{3},?\s+(\d{1,2}\s+[A-Za-z]{3}\s+20\d{2})\s+(\d{1,2}:\d{2})/i);if(arrived){shipment.destination=arrived[1].toUpperCase();shipment.arrivalDate=parseDate(arrived[2]);shipment.arrivalTime=arrived[3].padStart(5,'0');shipment.arrivalIsActual=true;shipment.status='ARRIVED';strongArrivalEvidence=true;}
    const parsed=parseArrivalEvidence(tracking,text,shipment.destination);if(parsed){shipment.arrivalDate=parsed.date;shipment.arrivalTime=parsed.time;shipment.arrivalIsActual=parsed.actual;if(parsed.actual){shipment.status='ARRIVED';strongArrivalEvidence=true;}}
    const finalDest=String(shipment.destination||'').toUpperCase();
    const departedForDel=/\b(?:Departed|DEP)\b.{0,160}\b(?:DEL|Delhi)\b|\b(?:DEL|Delhi)\b.{0,160}\b(?:Departed|DEP)\b/i.test(tracking);
    if(latestState==='DEPARTED'||latestState==='DEP'){
      shipment.status=(finalDest==='DEL'||departedForDel)?'DEPARTED':'IN TRANSIT';shipment.arrivalIsActual=false;shipment.arrivalEvidence=(finalDest==='DEL'||departedForDel)?'Emirates final leg departed for DEL':'Emirates via leg departed';strongArrivalEvidence=false;
    }else if(latestState==='ARRIVED'||latestState==='ARR'||latestState==='RECEIVED'||latestState==='RCF'){shipment.status='ARRIVED';strongArrivalEvidence=true;}
    else if(latestState==='BOOKED'||latestState==='BKD'){shipment.status='BOOKED';strongArrivalEvidence=false;}
    else if(!strongArrivalEvidence&&/\bDEP\b|Departed\s+from|Flight\s+departed/i.test(tracking)){shipment.status=(finalDest==='DEL'||departedForDel)?'DEPARTED':'IN TRANSIT';}
    if(!shipment.flightNo){const legs=[...text.matchAll(/\bEK\s*[- ]?(\d{2,4})\s+([A-Z]{3})\b/gi)];const m=[...legs].reverse().find(x=>!shipment.destination||x[2].toUpperCase()===shipment.destination)||legs[legs.length-1];if(m)shipment.flightNo=`EK${m[1]}`;}
  }
  if(shipment.status==='ARRIVED'&&!shipment.arrivalIsActual&&!strongArrivalEvidence)shipment.status='IN TRANSIT';shipment.source=text?'Emirates eSkyCargo Tracking Details screenshot + rendered text':shipment.source||'Emirates eSkyCargo official tracking';return {...result,shipment};
}
function hasConcreteDetails(s={}){return Boolean((s.origin&&s.destination)||s.pieces||s.bags||s.weight||s.flightNo||s.arrivalDate||s.arrivalTime||s.status==='ARRIVED'||s.status==='DELIVERED'||s.status==='DEPARTED');}
export async function trackEmirates(mawb){let result=normalizeFromPanel(await trackEmiratesBase(mawb));if(!result?.ok||!result?.screenshotBase64||hasConcreteDetails(result.shipment))return result;const ocr=await readTrackingScreenshot({mawb,screenshotBase64:result.screenshotBase64,timeoutMs:25000});if(!ocr?.ok)return result;const base={...(result.shipment||{})},shot=ocr.shipment||{};for(const key of ['origin','destination','pieces','bags','weight','flightNo','bookingDate','arrivalDate','arrivalTime'])if(!base[key]&&shot[key])base[key]=shot[key];if(!base.arrivalIsActual&&shot.arrivalIsActual)base.arrivalIsActual=true;if((!base.status||base.status==='TRACKING')&&shot.status)base.status=shot.status;base.source='Emirates eSkyCargo Tracking Details screenshot OCR + rendered text';return {...result,shipment:base,screenshotOcrUsed:true,debug:{...(result.debug||{}),ocr:ocr.debug||null}};}
