import { normalizeMawb } from './airlines.js';

const BASE='https://www.cathaycargoterminal.com/en-us/Shipment-Tracking';
const AIRLINE={name:'Cathay Cargo',iata:'CX',url:'https://www.cathaycargo.com/en-us/track-and-trace.html'};
const cleanHtml=s=>String(s||'')
  .replace(/<script[\s\S]*?<\/script>/gi,' ')
  .replace(/<style[\s\S]*?<\/style>/gi,' ')
  .replace(/<[^>]+>/g,' ')
  .replace(/&nbsp;|&#160;/gi,' ')
  .replace(/&amp;/gi,'&')
  .replace(/\s+/g,' ')
  .trim();
const pick=(s,rx)=>(s.match(rx)||[])[1]||'';
const months={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
function dateTime(v=''){
  const s=String(v).toUpperCase();
  const m=s.match(/(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+(20\d{2})(?:\s+(\d{1,2}):(\d{2}))?/);
  if(!m)return{date:'',time:''};
  return{date:`${m[3]}-${months[m[2]]}-${String(m[1]).padStart(2,'0')}`,time:m[4]?`${String(m[4]).padStart(2,'0')}:${m[5]}`:''};
}
function latestStatus(text=''){
  if(/Cargo Delivered\s*\(DLV\)|\bDLV\b/i.test(text))return'DELIVERED';
  if(/Received from Flight\s*\(RCF\)|\bRCF\b/i.test(text))return'ARRIVED';
  if(/Departure Flight\s*\(DEP\)|\bDEP\b/i.test(text))return'IN TRANSIT';
  if(/Received from Shipper\s*\(RCS\)|\bRCS\b/i.test(text))return'BOOKED';
  return'TRACKING';
}
function lastFlight(text=''){
  const all=[...text.matchAll(/\b(CX\d{2,4})\s+(\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+20\d{2})(?:\s+(\d{1,2}:\d{2}))?/gi)];
  if(!all.length)return{flightNo:'',arrival:{date:'',time:''}};
  const m=all[all.length-1];return{flightNo:m[1].toUpperCase(),arrival:dateTime(`${m[2]} ${m[3]||''}`)};
}
function parse(text,mawb){
  const plain=cleanHtml(text); const digits=mawb.replace(/\D/g,''),suffix=digits.slice(3);
  if(!plain.includes(mawb)&&!plain.includes(digits)&&!plain.includes(suffix)){
    if(/Please Enter Air Waybill Number/i.test(plain))return{notFound:true};
    return null;
  }
  const origin=pick(plain,/Origin\s+Destination[\s\S]{0,80}?\b([A-Z]{3})\b\s+([A-Z]{3})\b/i)||pick(plain,/Origin\s*[:\-]?\s*([A-Z]{3})\b/i);
  let destination='';
  const od=plain.match(/Origin\s+Destination[\s\S]{0,80}?\b([A-Z]{3})\b\s+([A-Z]{3})\b/i);if(od)destination=od[2];
  if(!destination)destination=pick(plain,/Destination\s*[:\-]?\s*([A-Z]{3})\b/i);
  const pieceMatches=[...plain.matchAll(/(?:Pieces|Delivered Pieces)\s+(?:Received Wt|Weight)?\s*(\d{1,6})\b/gi)];
  const pieces=pieceMatches.length?pieceMatches[pieceMatches.length-1][1]:pick(plain,/\b(\d{1,6})\s+(?:pieces?|pcs?)\b/i);
  const weightMatches=[...plain.matchAll(/(?:Received Wt|Delivered Weight|Weight)\s*(?:kg)?\s*([\d,.]+)/gi)];
  const weight=(weightMatches.length?weightMatches[weightMatches.length-1][1]:pick(plain,/\b([\d,.]+)\s*kg\b/i)).replace(/,/g,'');
  const flight=lastFlight(plain);
  let arrival=flight.arrival,arrivalIsActual=false;
  const rcf=plain.match(/Received from Flight[\s\S]{0,500}?Received On\s+(\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+20\d{2}\s+\d{1,2}:\d{2})/i);
  if(rcf){arrival=dateTime(rcf[1]);arrivalIsActual=true;}
  const dlv=plain.match(/Cargo Delivered[\s\S]{0,350}?Delivered Date[\s\S]{0,120}?(\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+20\d{2}\s+\d{1,2}:\d{2})/i);
  if(dlv){arrival=dateTime(dlv[1]);arrivalIsActual=true;}
  const status=latestStatus(plain);
  const shipment={mawb,carrierCode:'CX',airlineName:'Cathay Cargo',origin:origin.toUpperCase(),destination:destination.toUpperCase(),bags:pieces,pieces,weight,flightNo:flight.flightNo,arrivalDate:arrival.date,arrivalTime:arrival.time,arrivalIsActual,status,officialTracker:AIRLINE.url,source:'Cathay Cargo Terminal official tracking'};
  const useful=Boolean((shipment.origin&&shipment.destination)||shipment.pieces||shipment.weight||shipment.flightNo||shipment.arrivalDate||shipment.status!=='TRACKING');
  return useful?{useful:true,shipment}:null;
}

export async function trackCathay(input){
  const mawb=normalizeMawb(input);if(!mawb||!mawb.startsWith('160-'))return{ok:false,reason:'INVALID CATHAY MAWB',airline:AIRLINE};
  const suffix=mawb.replace(/\D/g,'').slice(3);
  const urls=[`${BASE}/AWBPrefix/160/AWBSuffix/${suffix}`,`${BASE}?AWBPrefix=160&AWBSuffix=${suffix}`];
  let last='';
  for(const url of urls){
    try{
      const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0','accept-language':'en-US,en;q=0.9'},cache:'no-store',signal:AbortSignal.timeout(12000)});
      last=`HTTP ${r.status}`;if(!r.ok)continue;
      const html=await r.text();const p=parse(html,mawb);
      if(p?.notFound)continue;
      if(p?.useful)return{ok:true,airline:AIRLINE,shipment:p.shipment,debug:{stage:'SUCCESS',source:'cathay-terminal',url}};
    }catch(e){last=e?.message||String(e);}
  }
  return{ok:false,reason:'CATHAY TERMINAL RETURNED NO VERIFIED SHIPMENT DATA',airline:AIRLINE,debug:{stage:'NO_DATA',last}};
}
