import { trackEmirates as trackEmiratesBase } from './emiratesFast.js';
import { readTrackingScreenshot } from './screenshotOcr.js';

const MONTH={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
const pad=v=>String(v).padStart(2,'0');
function parseDate(s=''){
  const t=String(s).toUpperCase();
  let m=t.match(/(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s+(20\d{2})/);if(m)return `${m[3]}-${MONTH[m[2]]}-${pad(m[1])}`;
  m=t.match(/(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s+(\d{1,2}),?\s+(20\d{2})/);if(m)return `${m[3]}-${MONTH[m[1]]}-${pad(m[2])}`;
  m=t.match(/\b(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})\b/);if(m)return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m=t.match(/\b(\d{1,2})[-\/.](\d{1,2})[-\/.](20\d{2})\b/);if(m)return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  return'';
}
function parseArrivalEvidence(tracking='',text='',destination=''){
  const src=String(tracking||text||'').replace(/\s+/g,' ').trim();if(!src)return null;
  const dateToken='(\\d{1,2}\\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[A-Za-z]*\\s+20\\d{2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[A-Za-z]*\\s+\\d{1,2},?\\s+20\\d{2}|20\\d{2}[-\\/.]\\d{1,2}[-\\/.]\\d{1,2}|\\d{1,2}[-\\/.]\\d{1,2}[-\\/.]20\\d{2})';
  const timeToken='(\\d{1,2}:\\d{2})';const dest=String(destination||'').toUpperCase();
  const actualPatterns=[new RegExp(`(?:Shipment\\s+has\\s+arrived\\s+at\\s+${dest||'[A-Z]{3}'}|Arrived\\s+at\\s+${dest||'[A-Z]{3}'}|Received\\s+at\\s+${dest||'[A-Z]{3}'}|\\bARR\\b\\s+${dest||'[A-Z]{3}'}|\\bRCF\\b\\s+${dest||'[A-Z]{3}'}).{0,220}?${dateToken}.{0,60}?${timeToken}`,'i')];
  for(const rx of actualPatterns){const m=src.match(rx);if(m){const d=parseDate(m[1]);if(d)return{date:d,time:m[2].padStart(5,'0'),actual:true};}}
  const plannedPatterns=[new RegExp(`(?:Expected\\s+to\\s+arrive(?:\\s+at\\s+${dest||'[A-Z]{3}'})?|Estimated\\s+Arrival|ETA|Arrival).{0,220}?${dateToken}.{0,60}?${timeToken}`,'i')];
  for(const rx of plannedPatterns){const m=src.match(rx);if(m){const d=parseDate(m[1]);if(d)return{date:d,time:m[2].padStart(5,'0'),actual:false};}}
  return null;
}
function normalizeFromPanel(result){
  if(!result?.ok)return result;
  const text=String(result?.debug?.panelSample||result?.debug?.opened?.bodySample||'').replace(/\s+/g,' ').trim();
  const shipment={...(result.shipment||{})};let strongArrivalEvidence=false;
  if(text){
    const header=text.split(/Tracking Details/i)[0]||text;
    const codes=[...header.matchAll(/\(([A-Z]{3})\)/g)].map(m=>m[1]);if(codes.length>=2){shipment.origin=codes[0];shipment.destination=codes[codes.length-1];}
    const tracking=text.split(/Tracking Details/i)[1]||text;
    const finalDest=String(shipment.destination||'').toUpperCase();

    const pw=tracking.match(/\b(\d{1,6})\s+Pieces?\s+([\d,.]+)\s*K(?:G|GS)?\b/i)||text.match(/\b(\d{1,6})\s+Pieces?\s+([\d,.]+)\s*K(?:G|GS)?\b/i)||text.match(/(?:Pieces?|Pcs?)\s*[:\-]?\s*(\d{1,6})[\s\S]{0,80}?(?:Gross\s*Weight|Weight)\s*[:\-]?\s*([\d,.]+)/i);
    if(pw){shipment.pieces=pw[1];shipment.bags=pw[1];shipment.weight=pw[2].replace(/,/g,'');}

    const finalArrivalRx=finalDest?new RegExp(`(?:\\bARR\\b|\\bRCF\\b).{0,80}\\b${finalDest}\\b|(?:Arrived|Received)\\s+at\\s+${finalDest}`,'i'):null;
    const finalArrived=Boolean(finalArrivalRx&&finalArrivalRx.test(tracking));

    const finalLegRx=finalDest?new RegExp(`([A-Z]{3})\\s+${finalDest}\\s+ATD\\s+(\\d{1,2}:\\d{2}),\\s+ETA\\s+(\\d{1,2}:\\d{2}),\\s+(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\\s+([A-Za-z]{3})\\s+(\\d{1,2}),?\\s+(20\\d{2})`,'i'):null;
    const finalLeg=finalLegRx?tracking.match(finalLegRx):null;

    if(finalLeg&&!finalArrived){
      shipment.arrivalTime=finalLeg[3].padStart(5,'0');
      shipment.arrivalDate=parseDate(`${finalLeg[4]} ${finalLeg[5]}, ${finalLeg[6]}`);
      shipment.arrivalIsActual=false;
      shipment.status='DEPARTED';
      shipment.arrivalEvidence=`Emirates final leg ${finalLeg[1].toUpperCase()}-${finalDest} departed at ${finalLeg[2]}`;
      strongArrivalEvidence=false;
    }else{
      const arrived=text.match(new RegExp(`Shipment\\s+has\\s+arrived\\s+at\\s+${finalDest||'[A-Z]{3}'}\\s+on\\s+[A-Za-z]{3},?\\s+(\\d{1,2}\\s+[A-Za-z]{3}\\s+20\\d{2})\\s+(\\d{1,2}:\\d{2})`,'i'));
      if(arrived){shipment.arrivalDate=parseDate(arrived[1]);shipment.arrivalTime=arrived[2].padStart(5,'0');shipment.arrivalIsActual=true;shipment.status='ARRIVED';strongArrivalEvidence=true;}
      const parsed=parseArrivalEvidence(tracking,text,finalDest);
      if(parsed){shipment.arrivalDate=parsed.date;shipment.arrivalTime=parsed.time;shipment.arrivalIsActual=parsed.actual;if(parsed.actual){shipment.status='ARRIVED';strongArrivalEvidence=true;}}
    }

    if(finalArrived){shipment.status='ARRIVED';shipment.arrivalIsActual=true;strongArrivalEvidence=true;shipment.arrivalEvidence=`Emirates final destination ${finalDest} arrival confirmed`;}
    else if(finalLeg){shipment.status='DEPARTED';shipment.arrivalIsActual=false;strongArrivalEvidence=false;}
    else if(!strongArrivalEvidence&&/\bDEP\b|Departed\s+from|Flight\s+departed/i.test(tracking))shipment.status='IN TRANSIT';
    else if(!strongArrivalEvidence&&/\bBKD\b|Booked\s+on\s+Flight/i.test(tracking))shipment.status='BOOKED';

    const finalFlight=finalDest?tracking.match(new RegExp(`(?:Flight\\s+EK[- ]?(\\d{2,4}).{0,120}${finalDest}|EK[- ]?(\\d{2,4}).{0,40}${finalDest})`,'i')):null;
    if(finalFlight)shipment.flightNo=`EK${finalFlight[1]||finalFlight[2]}`;
  }
  if(shipment.status==='ARRIVED'&&!shipment.arrivalIsActual&&!strongArrivalEvidence)shipment.status='IN TRANSIT';
  shipment.source=text?'Emirates eSkyCargo Tracking Details screenshot + rendered text':shipment.source||'Emirates eSkyCargo official tracking';
  return {...result,shipment};
}
function hasConcreteDetails(s={}){return Boolean((s.origin&&s.destination)||s.pieces||s.bags||s.weight||s.flightNo||s.arrivalDate||s.arrivalTime||s.status==='ARRIVED'||s.status==='DELIVERED'||s.status==='DEPARTED');}
export async function trackEmirates(mawb){
  let result=normalizeFromPanel(await trackEmiratesBase(mawb));
  if(!result?.ok||!result?.screenshotBase64||hasConcreteDetails(result.shipment))return result;
  const ocr=await readTrackingScreenshot({mawb,screenshotBase64:result.screenshotBase64,timeoutMs:25000});if(!ocr?.ok)return result;
  const base={...(result.shipment||{})},shot=ocr.shipment||{};
  for(const key of ['origin','destination','pieces','bags','weight','flightNo','bookingDate','arrivalDate','arrivalTime'])if(!base[key]&&shot[key])base[key]=shot[key];
  if(!base.arrivalIsActual&&shot.arrivalIsActual)base.arrivalIsActual=true;
  if((!base.status||base.status==='TRACKING')&&shot.status)base.status=shot.status;
  base.source='Emirates eSkyCargo Tracking Details screenshot OCR + rendered text';
  return {...result,shipment:base,screenshotOcrUsed:true,debug:{...(result.debug||{}),ocr:ocr.debug||null}};
}
