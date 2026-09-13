import { normalizeMawb } from './airlines.js';
import { trackWithBrowser } from './browserTracker.js';

const URL='https://www.etihadcargo.com/en/e-services/shipment-tracking';
const MONTH={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',SEPT:'09',OCT:'10',NOV:'11',DEC:'12'};
const pad=v=>String(v).padStart(2,'0');
function parseDate(s=''){
  const m=String(s).match(/(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[A-Za-z]*\s+(20\d{2})/i);
  if(!m)return'';
  return `${m[3]}-${MONTH[m[2].toUpperCase()]}-${pad(m[1])}`;
}
function parseTime(s=''){const m=String(s).match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);return m?`${pad(m[1])}:${m[2]}`:'';}
function parseEtihadPage(text='',mawb=''){
  const flat=String(text||'').replace(/\s+/g,' ').trim();
  if(!flat)return null;
  const positive=/Your shipment has been delivered|Tracking history|Shipment arrived|Shipment departed|Shipment booked|Flight plan/i.test(flat);
  if(!positive)return null;

  const flightPlan=(flat.match(/Flight\s*plan[\s\S]{0,700}?(?=Tracking\s+history|Want\s+to\s+create|Legend|$)/i)||[])[0]||'';
  const routeCodes=[...flightPlan.matchAll(/\b([A-Z]{3})\b/g)].map(m=>m[1]).filter(x=>!['THE','AND','FOR','PCS','KGS','AWB','HUB','OUT'].includes(x));
  const origin=routeCodes[0]||'';
  const destination=routeCodes.length>1?routeCodes[routeCodes.length-1]:'';

  const piecesPair=flat.match(/Pieces\s*:\s*(\d+)\s*\/\s*(\d+)/i);
  const weightPair=flat.match(/Weight\s*:\s*([\d,.]+)\s*\/\s*([\d,.]+)\s*Kg/i);
  const pieces=piecesPair?.[2]||piecesPair?.[1]||'';
  const weight=(weightPair?.[2]||weightPair?.[1]||'').replace(/,/g,'');

  const delivered=[...flat.matchAll(/(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[A-Za-z]*\s+20\d{2})\s+(\d{1,2}:\d{2})\s*,\s*([A-Z]{3})\s+Shipment delivered/gi)];
  const arrived=[...flat.matchAll(/(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[A-Za-z]*\s+20\d{2})\s+(\d{1,2}:\d{2})\s*,\s*([A-Z]{3})\s+Shipment arrived[\s\S]{0,160}?on\s+(EY\d{2,4})\s+from\s+([A-Z]{3})/gi)];
  const received=[...flat.matchAll(/(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[A-Za-z]*\s+20\d{2})\s+(\d{1,2}:\d{2})\s*,\s*([A-Z]{3})\s+Shipment received from flight[\s\S]{0,120}?on\s+(EY\d{2,4})/gi)];
  const departed=[...flat.matchAll(/(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[A-Za-z]*\s+20\d{2})\s+(\d{1,2}:\d{2})\s*,\s*([A-Z]{3})\s+Shipment departed[\s\S]{0,160}?from\s+([A-Z]{3})\s+to\s+([A-Z]{3})\s+on\s+(EY\d{2,4})/gi)];
  const booked=[...flat.matchAll(/(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[A-Za-z]*\s+20\d{2})\s+(\d{1,2}:\d{2})\s*,\s*([A-Z]{3})\s+Shipment booked(?:\s*\(Confirmed\))?/gi)];

  let status='BOOKED',arrivalDate='',arrivalTime='',arrivalIsActual=false,flightNo='';
  if(delivered.length){status='DELIVERED';const x=delivered[0];arrivalDate=parseDate(x[1]);arrivalTime=parseTime(x[2]);arrivalIsActual=true;}
  else if(received.length||arrived.length){status='ARRIVED';const x=(received[0]||arrived[0]);arrivalDate=parseDate(x[1]);arrivalTime=parseTime(x[2]);arrivalIsActual=true;flightNo=x[4]||'';}
  else if(departed.length){status='IN TRANSIT';const x=departed[0];flightNo=x[6]||'';}

  if(!flightNo){const f=[...flat.matchAll(/\b(EY\d{2,4})\b/g)];flightNo=f.length?f[f.length-1][1]:'';}
  if(!arrivalDate||!arrivalTime){
    const x=arrived[0]||received[0];
    if(x){arrivalDate=arrivalDate||parseDate(x[1]);arrivalTime=arrivalTime||parseTime(x[2]);arrivalIsActual=true;}
  }
  const bookingDate=booked.length?parseDate(booked[0][1]):'';

  return {mawb,carrierCode:'EY',airlineName:'Etihad Cargo',origin,destination,bags:pieces,pieces,weight,flightNo,bookingDate,arrivalDate,arrivalTime,arrivalIsActual,status,officialTracker:URL,source:'Etihad Cargo official tracking history',arrivalTimeSource:arrivalIsActual?'Etihad Cargo actual destination event':'Etihad Cargo flight plan'};
}

export async function trackEtihad(input){
  const mawb=normalizeMawb(input);
  if(!mawb||!mawb.startsWith('607-'))return{ok:false,reason:'INVALID ETIHAD MAWB',officialTracker:URL};
  const result=await trackWithBrowser(mawb);
  const text=result?.debug?.pageText||result?.debug?.arrivalSnippet||result?.shipment?.arrivalSnippet||'';
  const parsed=parseEtihadPage(text,mawb);
  if(parsed)return{ok:true,shipment:parsed,officialTracker:URL,adapter:'Etihad Cargo official tracking-history adapter',debug:{...(result?.debug||{}),etihadAuthoritative:true}};
  if(!result?.ok)return{...result,officialTracker:URL,adapter:'Etihad Cargo official shipment-tracking adapter'};
  const shipment={...result.shipment,mawb,carrierCode:'EY',airlineName:'Etihad Cargo',officialTracker:URL,source:result.shipment?.source||'Etihad Cargo official shipment tracking'};
  return{...result,shipment,officialTracker:URL,adapter:'Etihad Cargo official shipment-tracking adapter'};
}
