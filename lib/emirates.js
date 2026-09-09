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
  return'';
}
function normalizeFromPanel(result){
  if(!result?.ok)return result;
  const text=String(result?.debug?.panelSample||result?.debug?.opened?.bodySample||'').replace(/\s+/g,' ').trim();
  const shipment={...(result.shipment||{})};
  let strongArrivalEvidence=false;
  if(text){
    const header=text.split(/Tracking Details/i)[0]||text;
    const codes=[...header.matchAll(/\(([A-Z]{3})\)/g)].map(m=>m[1]);
    if(codes.length>=2){shipment.origin=codes[0];shipment.destination=codes[codes.length-1];}

    const tracking=text.split(/Tracking Details/i)[1]||text;
    const pw=tracking.match(/\b(\d{1,6})\s+Pieces?\s+([\d,.]+)\s*K(?:G|GS)?\b/i)
      ||text.match(/\b(\d{1,6})\s+Pieces?\s+([\d,.]+)\s*K(?:G|GS)?\b/i)
      ||text.match(/(?:Pieces?|Pcs?)\s*[:\-]?\s*(\d{1,6})[\s\S]{0,80}?(?:Gross\s*Weight|Weight)\s*[:\-]?\s*([\d,.]+)/i);
    if(pw){shipment.pieces=pw[1];shipment.bags=pw[1];shipment.weight=pw[2].replace(/,/g,'');}

    const arrFlight=tracking.match(/Arrived\s+at\s+[A-Z]{3}\s+on\s+Flight\s+EK[- ]?(\d{2,4})/i)
      ||tracking.match(/Received\s+at\s+[A-Z]{3}\s+from\s+Flight\s+No\.?\s*EK[- ]?(\d{2,4})/i);
    if(arrFlight)shipment.flightNo=`EK${arrFlight[1]}`;

    if(!shipment.flightNo){
      const bookedFlight=tracking.match(/Booked\s+on\s+Flight\s+EK[- ]?(\d{2,4})/i)
        ||text.match(/Booked\s+on\s+Flight\s+EK[- ]?(\d{2,4})/i);
      if(bookedFlight)shipment.flightNo=`EK${bookedFlight[1]}`;
    }

    const arrived=text.match(/Shipment\s+has\s+arrived\s+at\s+([A-Z]{3})\s+on\s+[A-Za-z]{3},?\s+(\d{1,2}\s+[A-Za-z]{3}\s+20\d{2})\s+(\d{1,2}:\d{2})/i);
    if(arrived){
      shipment.destination=arrived[1].toUpperCase();
      shipment.arrivalDate=parseDate(arrived[2]);
      shipment.arrivalTime=arrived[3].padStart(5,'0');
      shipment.arrivalIsActual=true;
      shipment.status='ARRIVED';
      shipment.arrivalEvidence='Emirates actual arrival banner';
      strongArrivalEvidence=true;
    }

    const notified=text.match(/(?:Agent|Consignee)\s+has\s+been\s+Notified\s+of\s+arrival\s+of\s+Shipment\s+at\s+([A-Z]{3})/i)
      ||text.match(/Notified\s+of\s+arrival\s+of\s+Shipment\s+at\s+([A-Z]{3})/i);
    if(notified){
      shipment.destination=notified[1].toUpperCase();
      shipment.status='ARRIVED';
      shipment.arrivalEvidence='Emirates notification confirms shipment arrival at destination';
      strongArrivalEvidence=true;
    }

    const received=text.match(/(?:Received\s+at\s+destination|Received\s+at\s+([A-Z]{3})\s+from\s+Flight|\bRCF\b)/i);
    if(received){
      if(received[1])shipment.destination=received[1].toUpperCase();
      shipment.status='ARRIVED';
      shipment.arrivalEvidence='Emirates received-at-destination milestone';
      strongArrivalEvidence=true;
    }

    if(!strongArrivalEvidence){
      const expected=text.match(/Expected\s+to\s+arrive\s+at\s+([A-Z]{3})\s+on\s+(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+(\d{1,2}\s+[A-Za-z]{3}\s+20\d{2})\s+(\d{1,2}:\d{2})/i);
      if(expected){
        shipment.destination=expected[1].toUpperCase();
        shipment.arrivalDate=parseDate(expected[2]);
        shipment.arrivalTime=expected[3].padStart(5,'0');
        shipment.arrivalIsActual=false;
      }else{
        const eta=tracking.match(/\bETA\s+(\d{1,2}:\d{2}),?\s+(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+([A-Za-z]{3})\s+(\d{1,2}),?\s+(20\d{2})/i);
        if(eta){
          shipment.arrivalTime=eta[1].padStart(5,'0');
          shipment.arrivalDate=parseDate(`${eta[2]} ${eta[3]}, ${eta[4]}`);
          shipment.arrivalIsActual=false;
        }
      }

      if(/\bDEP\b|Departed\s+from|Flight\s+departed/i.test(tracking))shipment.status='IN TRANSIT';
      else if(/\bBKD\b|Booked\s+on\s+Flight/i.test(tracking))shipment.status='BOOKED';
    }

    if(!shipment.flightNo){
      const legs=[...text.matchAll(/\bEK\s*[- ]?(\d{2,4})\s+([A-Z]{3})\b/gi)];
      const match=[...legs].reverse().find(m=>!shipment.destination||m[2].toUpperCase()===shipment.destination)||legs[legs.length-1];
      if(match)shipment.flightNo=`EK${match[1]}`;
    }
  }

  if(!strongArrivalEvidence&&!shipment.arrivalIsActual&&(shipment.arrivalDate||shipment.arrivalTime)&&shipment.status!=='BOOKED'&&shipment.status!=='DELAYED')shipment.status='IN TRANSIT';
  if(shipment.status==='ARRIVED'&&!shipment.arrivalIsActual&&!strongArrivalEvidence)shipment.status='IN TRANSIT';
  shipment.source=text?'Emirates eSkyCargo Tracking Details screenshot + rendered text':shipment.source||'Emirates eSkyCargo official tracking';
  return {...result,shipment};
}

function hasConcreteDetails(s={}){
  return Boolean((s.origin&&s.destination)||s.pieces||s.bags||s.weight||s.flightNo||s.arrivalDate||s.arrivalTime||s.status==='ARRIVED'||s.status==='DELIVERED');
}

export async function trackEmirates(mawb){
  let result=normalizeFromPanel(await trackEmiratesBase(mawb));
  if(!result?.ok||!result?.screenshotBase64||hasConcreteDetails(result.shipment))return result;

  const ocr=await readTrackingScreenshot({mawb,screenshotBase64:result.screenshotBase64,timeoutMs:25000});
  if(!ocr?.ok)return result;

  const base={...(result.shipment||{})};
  const shot=ocr.shipment||{};
  for(const key of ['origin','destination','pieces','bags','weight','flightNo','bookingDate','arrivalDate','arrivalTime']){
    if(!base[key]&&shot[key])base[key]=shot[key];
  }
  if(!base.arrivalIsActual&&shot.arrivalIsActual){base.arrivalIsActual=true;}
  if((!base.status||base.status==='TRACKING')&&shot.status)base.status=shot.status;
  base.source='Emirates eSkyCargo Tracking Details screenshot OCR + rendered text';

  return {...result,shipment:base,screenshotOcrUsed:true,debug:{...(result.debug||{}),ocr:ocr.debug||null}};
}
