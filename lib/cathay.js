import { normalizeMawb } from './airlines.js';

const BASE='https://www.cathaycargoterminal.com/en-us/Shipment-Tracking';
const AIRLINE={name:'Cathay Cargo',iata:'CX',url:'https://www.cathaycargo.com/en-us/track-and-trace.html'};
const MONTH='(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)';
const DATE=`\\d{1,2}\\s+${MONTH}\\s+20\\d{2}`;
const TIME='\\d{1,2}:\\d{2}';
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
function section(text,start,next){
  const i=text.search(start);if(i<0)return'';const rest=text.slice(i);const n=next?rest.slice(1).search(next):-1;return n>=0?rest.slice(0,n+1):rest.slice(0,1200);
}
function latestStatus(text=''){
  if(/Cargo Delivered\s*\(DLV\)|\bDLV\b/i.test(text))return'DELIVERED';
  if(/Received from Flight\s*\(RCF\)|\bRCF\b/i.test(text))return'ARRIVED';
  if(/Departure Flight\s*\(DEP\)|\bDEP\b/i.test(text))return'IN TRANSIT';
  if(/Received from Shipper\s*\(RCS\)|\bRCS\b/i.test(text))return'BOOKED';
  return'TRACKING';
}
function parseMilestones(plain){
  const out={pieces:'',weight:'',flightNo:'',arrival:{date:'',time:''},arrivalIsActual:false};
  const rcs=section(plain,/Received from Shipper\s*\(RCS\)/i,/Departure Flight|Received from Flight|Cargo Delivered/i);
  const dep=section(plain,/Departure Flight\s*\(DEP\)/i,/Received from Flight|Cargo Delivered/i);
  const rcf=section(plain,/Received from Flight\s*\(RCF\)/i,/Cargo Delivered/i);
  const dlv=section(plain,/Cargo Delivered\s*\(DLV\)/i,null);

  if(rcs){
    const m=rcs.match(new RegExp(`Received On\\s+Pieces\\s+Received Wt\\s+(${DATE}\\s+${TIME})\\s+(\\d{1,6})\\s+([\\d,.]+)`,'i'));
    if(m){out.pieces=m[2];out.weight=m[3].replace(/,/g,'');}
  }
  if(dep){
    const flights=[...dep.matchAll(new RegExp(`\\b(CX\\d{2,4})\\s+(${DATE})\\s+(${TIME})\\s*\\(STD\\)\\s+(\\d{1,6})\\s+([\\d,.]+)`,'gi'))];
    if(flights.length){const m=flights[flights.length-1];out.flightNo=m[1].toUpperCase();out.pieces=m[4];out.weight=m[5].replace(/,/g,'');}
  }
  if(rcf){
    const flights=[...rcf.matchAll(new RegExp(`\\b(CX\\d{2,4})\\s+(${DATE})(?:\\s+${TIME})?\\s+(\\d{1,6})\\s+([\\d,.]+)\\s+(${DATE}\\s+${TIME})`,'gi'))];
    if(flights.length){const m=flights[flights.length-1];out.flightNo=m[1].toUpperCase();out.pieces=m[3];out.weight=m[4].replace(/,/g,'');out.arrival=dateTime(m[5]);out.arrivalIsActual=true;}
  }
  if(dlv){
    const delivered=[...dlv.matchAll(new RegExp(`(${DATE}\\s+${TIME})\\s+(\\d{1,6})\\s+([\\d,.]+)`,'gi'))];
    if(delivered.length){const m=delivered[delivered.length-1];out.pieces=m[2];out.weight=m[3].replace(/,/g,'');}
  }
  return out;
}
function parse(text,mawb){
  const plain=cleanHtml(text); const digits=mawb.replace(/\D/g,''),suffix=digits.slice(3);
  if(!plain.includes(mawb)&&!plain.includes(digits)&&!plain.includes(suffix)){
    if(/Please Enter Air Waybill Number/i.test(plain))return{notFound:true};
    return null;
  }
  const od=plain.match(/Origin\s+Destination[\s\S]{0,100}?\b([A-Z]{3})\b\s+([A-Z]{3})\b/i);
  const origin=(od?.[1]||pick(plain,/Origin\s*[:\-]?\s*([A-Z]{3})\b/i)).toUpperCase();
  const destination=(od?.[2]||pick(plain,/Destination\s*[:\-]?\s*([A-Z]{3})\b/i)).toUpperCase();
  const ms=parseMilestones(plain);
  const status=latestStatus(plain);
  const shipment={mawb,carrierCode:'CX',airlineName:'Cathay Cargo',origin,destination,bags:ms.pieces,pieces:ms.pieces,weight:ms.weight,flightNo:ms.flightNo,arrivalDate:ms.arrival.date,arrivalTime:ms.arrival.time,arrivalIsActual:ms.arrivalIsActual,status,officialTracker:AIRLINE.url,source:'Cathay Cargo Terminal official tracking'};
  const useful=Boolean((origin&&destination)||shipment.pieces||shipment.weight||shipment.flightNo||shipment.arrivalDate||status!=='TRACKING');
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
