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
function parseTime12(s=''){
  const t=String(s||'').trim().toUpperCase();
  const m=t.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);if(!m)return /^\d{1,2}:\d{2}$/.test(t)?t.padStart(5,'0'):'';
  let h=Number(m[1]);if(h===12)h=0;if(m[3]==='PM')h+=12;return `${pad(h)}:${m[2]}`;
}
function headlineArrival(text='',destination=''){
  const dest=String(destination||'').toUpperCase()||'[A-Z]{3}';
  const actual=new RegExp(`Shipment\\s+has\\s+arrived\\s+at\\s+${dest}\\s+on\\s+(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\\s+(\\d{1,2}\\s+[A-Za-z]{3}\\s+20\\d{2})\\s+(\\d{1,2}:\\d{2})`,'i').exec(text);
  if(actual){const date=parseDate(actual[1]);if(date)return{date,time:actual[2].padStart(5,'0'),actual:true,source:'headline'};}
  const expected=new RegExp(`Expected\\s+to\\s+arrive\\s+at\\s+${dest}\\s+on\\s+(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\\s+(\\d{1,2}\\s+[A-Za-z]{3}\\s+20\\d{2})\\s+(\\d{1,2}:\\d{2})`,'i').exec(text);
  if(expected){const date=parseDate(expected[1]);if(date)return{date,time:expected[2].padStart(5,'0'),actual:false,source:'headline'};}
  return null;
}
function actualFinalMilestone(tracking='',destination=''){
  const dest=String(destination||'').toUpperCase();if(!dest)return null;
  const patterns=[
    new RegExp(`\\bARR\\s+${dest},\\s*(\\d{1,2}:\\d{2}\\s*(?:AM|PM)),\\s*([A-Za-z]{3}\\s+\\d{1,2},\\s*20\\d{2})`,'i'),
    new RegExp(`\\bRCF\\s+${dest},\\s*(\\d{1,2}:\\d{2}\\s*(?:AM|PM)),\\s*([A-Za-z]{3}\\s+\\d{1,2},\\s*20\\d{2})`,'i')
  ];
  for(const rx of patterns){const m=tracking.match(rx);if(m){const date=parseDate(m[2]),time=parseTime12(m[1]);if(date&&time)return{date,time,actual:true,source:/^ARR/i.test(m[0])?'ARR milestone':'RCF milestone'};}}
  return null;
}
function finalLegPlan(tracking='',destination=''){
  const dest=String(destination||'').toUpperCase();if(!dest)return null;
  const routeRx=new RegExp(`([A-Z]{3})\\s+${dest}\\s+(?:ATD|ETD)\\s+(\\d{1,2}:\\d{2}),\\s+(?:ATA|ETA)\\s+(\\d{1,2}:\\d{2}),\\s+((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\\s+[A-Za-z]{3}\\s+\\d{1,2},?\\s+20\\d{2})(?:\\s+((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\\s+[A-Za-z]{3}\\s+\\d{1,2},?\\s+20\\d{2}))?`,'i');
  const m=tracking.match(routeRx);if(!m)return null;
  const arrivalDate=parseDate(m[5]||m[4]);if(!arrivalDate)return null;
  return{date:arrivalDate,time:m[3].padStart(5,'0'),actual:false,origin:m[1].toUpperCase(),departTime:m[2].padStart(5,'0'),source:'final-leg schedule'};
}
function finalFlightNumber(tracking='',destination=''){
  const dest=String(destination||'').toUpperCase();if(!dest)return'';
  const patterns=[
    new RegExp(`(?:Arrived\\s+at\\s+${dest}\\s+on\\s+Flight\\s+EK[- ]?(\\d{2,4}[A-Z]?)|Received\\s+at\\s+${dest}\\s+from\\s+Flight\\s+No\\.\\s*EK[- ]?(\\d{2,4}[A-Z]?))`,'i'),
    new RegExp(`Booked\\s+on\\s+Flight\\s+EK[- ]?(\\d{2,4}[A-Z]?).{0,100}?[A-Z]{3}-${dest}`,'i'),
    new RegExp(`Flight\\s+EK[- ]?(\\d{2,4}[A-Z]?).{0,100}?[A-Z]{3}-${dest}`,'i')
  ];
  for(const rx of patterns){const m=tracking.match(rx);if(m)return`EK${m[1]||m[2]}`;}
  return'';
}
function normalizeFromPanel(result){
  if(!result?.ok)return result;
  const text=String(result?.debug?.panelSample||result?.debug?.opened?.bodySample||'').replace(/\s+/g,' ').trim();
  const shipment={...(result.shipment||{})};
  if(text){
    const header=text.split(/Tracking Details/i)[0]||text;
    const codes=[...header.matchAll(/\(([A-Z]{3})\)/g)].map(m=>m[1]);if(codes.length>=2){shipment.origin=codes[0];shipment.destination=codes[codes.length-1];}
    const tracking=text.split(/Tracking Details/i)[1]||text;
    const finalDest=String(shipment.destination||'').toUpperCase();

    const pw=tracking.match(/\b(\d{1,6})\s+Pieces?\s+([\d,.]+)\s*K(?:G|GS)?\b/i)||text.match(/\b(\d{1,6})\s+Pieces?\s+([\d,.]+)\s*K(?:G|GS)?\b/i)||text.match(/(?:Pieces?|Pcs?)\s*[:\-]?\s*(\d{1,6})[\s\S]{0,80}?(?:Gross\s*Weight|Weight)\s*[:\-]?\s*([\d,.]+)/i);
    if(pw){shipment.pieces=pw[1];shipment.bags=pw[1];shipment.weight=pw[2].replace(/,/g,'');}

    const bookedEvents=[...tracking.matchAll(/\bBKD\s+[A-Z]{3},\s*(\d{1,2}:\d{2}\s*(?:AM|PM)),\s*([A-Za-z]{3}\s+\d{1,2},\s*20\d{2})/gi)]
      .map(m=>({date:parseDate(m[2]),time:parseTime12(m[1])})).filter(x=>x.date&&x.time)
      .sort((a,b)=>`${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`));
    if(bookedEvents.length){shipment.bookingDate=bookedEvents[0].date;shipment.bookingTime=bookedEvents[0].time;shipment.bookingDateSource='Emirates BKD milestone timestamp';}

    const headline=headlineArrival(text,finalDest);
    const actualMilestone=actualFinalMilestone(tracking,finalDest);
    const actualArrival=headline?.actual?headline:actualMilestone;
    const plannedArrival=!actualArrival?(headline&&!headline.actual?headline:finalLegPlan(tracking,finalDest)):null;

    if(actualArrival){
      shipment.arrivalDate=actualArrival.date;
      shipment.arrivalTime=actualArrival.time;
      shipment.arrivalIsActual=true;
      shipment.status='ARRIVED';
      shipment.arrivalEvidence=`Emirates final destination ${finalDest} ${actualArrival.source}`;
    }else if(plannedArrival){
      shipment.arrivalDate=plannedArrival.date;
      shipment.arrivalTime=plannedArrival.time;
      shipment.arrivalIsActual=false;
      shipment.arrivalEvidence=`Emirates final destination ${finalDest} ${plannedArrival.source}`;
      shipment.status=/\bDEP\b|Departed\s+to|Departed\s+from|Flight\s+departed/i.test(tracking)?'IN TRANSIT':'BOOKED';
    }else if(/\bDEP\b|Departed\s+to|Departed\s+from|Flight\s+departed/i.test(tracking)){
      shipment.status='IN TRANSIT';shipment.arrivalIsActual=false;
    }else if(/\bBKD\b|Booked\s+on\s+Flight/i.test(tracking)){
      shipment.status='BOOKED';shipment.arrivalIsActual=false;
    }

    const finalFlight=finalFlightNumber(tracking,finalDest);if(finalFlight)shipment.flightNo=finalFlight;
  }
  if(shipment.status==='ARRIVED'&&!shipment.arrivalIsActual)shipment.status='IN TRANSIT';
  shipment.source=text?'Emirates eSkyCargo Tracking Details screenshot + rendered text':shipment.source||'Emirates eSkyCargo official tracking';
  return {...result,shipment};
}
function hasConcreteDetails(s={}){return Boolean((s.origin&&s.destination)||s.pieces||s.bags||s.weight||s.flightNo||s.arrivalDate||s.arrivalTime||s.status==='ARRIVED'||s.status==='DELIVERED'||s.status==='DEPARTED'||s.status==='IN TRANSIT');}
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
