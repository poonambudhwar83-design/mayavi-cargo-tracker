import { normalizeMawb } from './airlines.js';

const PUBLIC='https://china.saudiacargo.com/e-services';
const BASES=[
  'https://china.saudiacargo.com/e-services/track-shipment',
  'https://svcnewwebappchina.azurewebsites.net/e-services/track-shipment',
  'https://saudiacargo.com/e-services/track-shipment'
];
const AIRLINE={name:'Saudia Cargo',iata:'SV',url:PUBLIC};
const clean=s=>String(s||'')
  .replace(/<script[\s\S]*?<\/script>/gi,' ')
  .replace(/<style[\s\S]*?<\/style>/gi,' ')
  .replace(/<[^>]+>/g,' ')
  .replace(/&nbsp;|&#160;/gi,' ')
  .replace(/&amp;/gi,'&')
  .replace(/&quot;/gi,'"')
  .replace(/&#39;/gi,"'")
  .replace(/\s+/g,' ')
  .trim();
const pick=(s,rx)=>(s.match(rx)||[])[1]||'';
function airport(s=''){const m=String(s).toUpperCase().match(/\b([A-Z]{3})\b/);return m?m[1]:''}
function status(text=''){
  if(/\bDLV\b|delivered/i.test(text))return'DELIVERED';
  if(/\bRCF\b|received at destination|received from flight/i.test(text))return'ARRIVED';
  if(/\bARR\b|arrived|landed/i.test(text))return'ARRIVED';
  if(/\bDEP\b|departed|in transit|airborne/i.test(text))return'IN TRANSIT';
  if(/\bRCS\b|received from shipper|accepted|booked|manifested/i.test(text))return'BOOKED';
  if(/delay|late|exception/i.test(text))return'DELAYED';
  return'TRACKING';
}
function dateTime(v=''){
  const s=String(v);let m=s.match(/(20\d{2})[-\/]([01]\d)[-\/]([0-3]\d)[ T](\d{1,2}):(\d{2})/);
  if(m)return{date:`${m[1]}-${m[2]}-${m[3]}`,time:`${String(m[4]).padStart(2,'0')}:${m[5]}`};
  m=s.match(/([0-3]?\d)[-\/]([01]?\d)[-\/](20\d{2})[ T](\d{1,2}):(\d{2})/);
  if(m)return{date:`${m[3]}-${String(m[2]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`,time:`${String(m[4]).padStart(2,'0')}:${m[5]}`};
  return{date:'',time:''};
}
function parse(html,mawb){
  const text=clean(html),digits=mawb.replace(/\D/g,''),serial=digits.slice(3);
  const haystack=`${text} ${html}`;
  const mentions=haystack.includes(mawb)||haystack.includes(digits)||haystack.includes(serial);
  if(/no shipment|not found|invalid awb|no result|shipment does not exist/i.test(text))return{notFound:true};
  if(!mentions)return null;

  const route=text.match(/(?:Origin|From)\s*[:\-]?\s*([A-Z]{3})[\s\S]{0,140}?(?:Destination|To)\s*[:\-]?\s*([A-Z]{3})/i)
    ||text.match(/\b([A-Z]{3})\s*(?:-|→|>)\s*([A-Z]{3})\b/);
  const origin=airport(route?.[1]||pick(text,/(?:Origin|From)\s*[:\-]?\s*([A-Z]{3})/i)||pick(html,/"origin"\s*:\s*"([A-Z]{3})"/i));
  const destination=airport(route?.[2]||pick(text,/(?:Destination|To)\s*[:\-]?\s*([A-Z]{3})/i)||pick(html,/"destination"\s*:\s*"([A-Z]{3})"/i));
  const pieces=pick(text,/(?:Pieces?|Pcs?|No\.? of Pieces|Number of Pieces)\s*[:\-]?\s*(\d{1,6})/i)||pick(text,/\b(\d{1,6})\s*(?:PCS|Pieces?)\b/i)||pick(html,/"(?:pieces|numberOfPieces|pieceCount)"\s*:\s*"?(\d{1,6})/i);
  const weight=(pick(text,/(?:Gross Weight|Weight)\s*[:\-]?\s*([\d,.]+)\s*(?:KG|KGS)?/i)||pick(text,/\b([\d,.]+)\s*(?:KG|KGS)\b/i)||pick(html,/"(?:weight|grossWeight)"\s*:\s*"?([\d,.]+)/i)).replace(/,/g,'');
  const flights=[...haystack.matchAll(/\bSV[-\s]?(\d{2,4})\b/gi)];
  const flightNo=flights.length?`SV${flights[flights.length-1][1]}`:'';
  let arrival=dateTime((text.match(/(?:Actual Arrival|Arrived|Arrival Time|ATA)[\s\S]{0,160}/i)||[])[0]||pick(html,/"(?:actualArrival|arrivalTime|ata)"\s*:\s*"([^"]+)"/i));
  let arrivalIsActual=Boolean(arrival.date);
  if(!arrival.date)arrival=dateTime((text.match(/(?:Estimated Arrival|Expected Arrival|Scheduled Arrival|ETA)[\s\S]{0,180}/i)||[])[0]||pick(html,/"(?:estimatedArrival|scheduledArrival|eta)"\s*:\s*"([^"]+)"/i));
  const st=status(text||html);
  const shipment={mawb,carrierCode:'SV',airlineName:'Saudia Cargo',origin,destination,bags:pieces,pieces,weight,flightNo,arrivalDate:arrival.date,arrivalTime:arrival.time,arrivalIsActual,status:st,officialTracker:PUBLIC,source:'Saudia Cargo current public tracking'};
  const useful=Boolean((origin&&destination)||pieces||weight||flightNo||arrival.date||st!=='TRACKING');
  return useful?{useful:true,shipment}:null;
}

export async function trackSaudia(input){
  const mawb=normalizeMawb(input);if(!mawb||!mawb.startsWith('065-'))return{ok:false,reason:'INVALID SAUDIA MAWB',airline:AIRLINE};
  const digits=mawb.replace(/\D/g,''),serial=digits.slice(3);
  const values=[mawb,digits,serial];
  const attempts=[];
  for(const base of BASES){
    for(const value of values){
      const urls=[`${base}?awbNumber=${encodeURIComponent(value)}`,`${base}?awb=${encodeURIComponent(value)}`];
      for(const url of urls){
        try{
          const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36','accept':'text/html,application/xhtml+xml,application/json','accept-language':'en-US,en;q=0.9'},cache:'no-store',redirect:'follow',signal:AbortSignal.timeout(9000)});
          attempts.push(`${new URL(url).host}:${r.status}`);
          if(!r.ok)continue;
          const html=await r.text();const p=parse(html,mawb);
          if(p?.notFound)continue;
          if(p?.useful)return{ok:true,airline:AIRLINE,shipment:p.shipment,debug:{stage:'SUCCESS',source:'saudia-current-public',url,attempts}};
        }catch(e){attempts.push(`${new URL(url).host}:${e?.name||'ERR'}`);}
      }
    }
  }
  return{ok:false,reason:'SAUDIA CURRENT PUBLIC TRACKER RETURNED NO VERIFIED SHIPMENT DATA',airline:AIRLINE,debug:{stage:'NO_DATA',attempts:attempts.slice(-12),officialTracker:PUBLIC}};
}
