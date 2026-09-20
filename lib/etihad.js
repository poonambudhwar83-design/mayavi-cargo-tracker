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
function parseFlightPlanArrival(block='',fullText='',destination=''){
  const text=String(block||'');
  const yearFallback=(String(fullText).match(/\b(20\d{2})\b/)||[])[1]||String(new Date().getUTCFullYear());
  const pairRe=/(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[A-Za-z]*(?:\s+(20\d{2}))?[\s,|/-]{0,20}([01]?\d|2[0-3]):([0-5]\d)/gi;
  const make=m=>({date:`${m[3]||yearFallback}-${MONTH[String(m[2]).toUpperCase()]||''}-${pad(m[1])}`,time:`${pad(m[4])}:${m[5]}`});

  // Prefer the date+time pair physically nearest the final destination in the flight plan.
  // This prevents a date from one leg being combined with a time from another leg.
  if(destination){
    const codeRe=new RegExp(`\\b${String(destination).toUpperCase()}\\b`,'g');
    const hits=[...text.toUpperCase().matchAll(codeRe)];
    for(let i=hits.length-1;i>=0;i--){
      const pos=hits[i].index||0;
      const segment=text.slice(Math.max(0,pos-180),Math.min(text.length,pos+260));
      const pairs=[...segment.matchAll(pairRe)];
      if(pairs.length)return make(pairs[pairs.length-1]);
    }
  }

  // Fallback: use the last complete date+time pair, never independent last date/last time values.
  const pairs=[...text.matchAll(pairRe)];
  if(!pairs.length)return{date:'',time:''};
  return make(pairs[pairs.length-1]);
}
function parseEtihadPage(text='',mawb=''){
  const flat=String(text||'').replace(/\s+/g,' ').trim();
  if(!flat)return null;
  const positive=/Your shipment has been delivered|Your shipment is in transit|Tracking history|Shipment arrived|Shipment departed|Shipment booked|Flight plan/i.test(flat);
  if(!positive)return null;

  const flightPlan=(flat.match(/Flight\s*plan[\s\S]{0,700}?(?=Tracking\s+history|Want\s+to\s+create|Legend|$)/i)||[])[0]||'';
  const timedStations=[...flightPlan.matchAll(/\b([A-Z]{3})\s+(\d{1,2}:\d{2})\b/g)].map(m=>m[1].toUpperCase());
  const ignored=new Set(['THE','AND','FOR','PCS','KGS','AWB','HUB','OUT','NEW','MON','TUE','WED','THU','FRI','SAT','SUN','JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC']);
  const routeCodes=[...flightPlan.matchAll(/\b([A-Z]{3})\b/g)].map(m=>m[1]).filter(x=>!ignored.has(x));
  let origin=timedStations[0]||routeCodes[0]||'';
  let destination=timedStations.length>1?timedStations.at(-1):(routeCodes.length>1?routeCodes.at(-1):'');
  let planArrival=parseFlightPlanArrival(flightPlan,flat,destination);

  const piecesPair=flat.match(/Pieces\s*:\s*(\d+)\s*\/\s*(\d+)/i);
  const weightPair=flat.match(/Weight\s*:\s*([\d,.]+)\s*\/\s*([\d,.]+)\s*Kg/i);
  const pieces=piecesPair?.[2]||piecesPair?.[1]||'';
  const weight=(weightPair?.[2]||weightPair?.[1]||'').replace(/,/g,'');

  const delivered=[...flat.matchAll(/(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[A-Za-z]*\s+20\d{2})\s+(\d{1,2}:\d{2})\s*,\s*([A-Z]{3})\s+Shipment delivered/gi)];
  const arrived=[...flat.matchAll(/(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[A-Za-z]*\s+20\d{2})\s+(\d{1,2}:\d{2})\s*,\s*([A-Z]{3})\s+Shipment arrived[\s\S]{0,160}?on\s+(EY\d{2,4})\s+from\s+([A-Z]{3})/gi)];
  const received=[...flat.matchAll(/(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[A-Za-z]*\s+20\d{2})\s+(\d{1,2}:\d{2})\s*,\s*([A-Z]{3})\s+Shipment received from flight[\s\S]{0,120}?on\s+(EY\d{2,4})/gi)];
  const departed=[...flat.matchAll(/(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[A-Za-z]*\s+20\d{2})\s+(\d{1,2}:\d{2})\s*,\s*([A-Z]{3})\s+Shipment departed[\s\S]{0,160}?from\s+([A-Z]{3})\s+to\s+([A-Z]{3})\s+on\s+(EY\d{2,4})/gi)];
  const booked=[...flat.matchAll(/(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[A-Za-z]*\s+20\d{2})\s+(\d{1,2}:\d{2})\s*,\s*([A-Z]{3})\s+Shipment booked(?:\s*\(Confirmed\))?/gi)];

  const atFinal=x=>Boolean(x&&destination&&String(x[3]||'').toUpperCase()===destination);
  const finalDelivered=delivered.find(atFinal)||null;
  const finalArrived=arrived.find(atFinal)||null;
  const finalReceived=received.find(atFinal)||null;
  const historyDestination=(delivered[0]?.[3]||received[0]?.[3]||arrived[0]?.[3]||'').toUpperCase();
  const historyOriginDeparture=[...departed].reverse().find(x=>String(x[3]||'').toUpperCase()===String(x[4]||'').toUpperCase())||departed.at(-1)||null;
  if(historyOriginDeparture?.[4])origin=String(historyOriginDeparture[4]).toUpperCase();
  if(historyDestination)destination=historyDestination;
  planArrival=parseFlightPlanArrival(flightPlan,flat,destination);
  const originDeparture=departed.find(x=>String(x[3]||'').toUpperCase()===origin&&String(x[4]||'').toUpperCase()===origin)||historyOriginDeparture;
  const bannerInTransit=/Your shipment is in transit/i.test(flat);

  let status='BOOKED',arrivalDate='',arrivalTime='',arrivalIsActual=false,flightNo='';
  if(finalDelivered){
    status='DELIVERED';arrivalDate=parseDate(finalDelivered[1]);arrivalTime=parseTime(finalDelivered[2]);arrivalIsActual=true;
  }else if(finalReceived||finalArrived){
    status='ARRIVED';const x=finalReceived||finalArrived;arrivalDate=parseDate(x[1]);arrivalTime=parseTime(x[2]);arrivalIsActual=true;flightNo=x[4]||'';
  }else if(bannerInTransit||departed.length){
    status='IN TRANSIT';
    const onward=departed.find(x=>destination&&String(x[5]||'').toUpperCase()===destination)||departed[0];
    flightNo=onward?.[6]||'';
    arrivalDate=planArrival.date;arrivalTime=planArrival.time;arrivalIsActual=false;
  }

  if(!flightNo){
    const bookedToFinal=[...flat.matchAll(/\b(EY\d{2,4})\s+from\s+([A-Z]{3})\s*-\s*([A-Z]{3})\s+on\s+(\d{1,2}-[A-Za-z]{3}-20\d{2})\s+(\d{1,2}:\d{2})/gi)].find(x=>destination&&String(x[3]||'').toUpperCase()===destination);
    if(bookedToFinal)flightNo=bookedToFinal[1];
  }
  if(!flightNo){const f=[...flat.matchAll(/\b(EY\d{2,4})\b/g)];flightNo=f.length?f[f.length-1][1]:'';}
  if(!arrivalDate&&!arrivalTime&&!arrivalIsActual){arrivalDate=planArrival.date;arrivalTime=planArrival.time;}
  const bookingDate=booked.length?parseDate(booked[0][1]):'';

  return {mawb,carrierCode:'EY',airlineName:'Etihad Cargo',origin,destination,bags:pieces,pieces,weight,flightNo,bookingDate,departureDate:originDeparture?parseDate(originDeparture[1]):'',departureTime:originDeparture?parseTime(originDeparture[2]):'',departureFlightNo:originDeparture?.[6]||'',departureOrigin:originDeparture?String(originDeparture[4]||origin).toUpperCase():origin,departureDestination:originDeparture?String(originDeparture[5]||'').toUpperCase():'',departureIsActual:Boolean(originDeparture),departureTimeSource:originDeparture?'Etihad tracking history origin Shipment departed event':'',arrivalDate,arrivalTime,arrivalIsActual,status,officialTracker:URL,source:'Etihad Cargo official tracking history',arrivalTimeSource:arrivalIsActual?'Etihad Cargo actual final-destination event':'Etihad Cargo flight plan'};
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
