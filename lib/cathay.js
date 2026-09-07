import { normalizeMawb } from './airlines.js';
import { trackWithBrowser } from './browserTracker.js';

const BASE='https://www.cathaycargoterminal.com/en-us/Shipment-Tracking';
const AIRLINE={name:'Cathay Cargo',iata:'CX',url:'https://www.cathaycargo.com/en-us/track-and-trace.html'};
const months={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
const clean=s=>String(s||'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/\s+/g,' ').trim();
function dt(v=''){
  const m=String(v).toUpperCase().match(/(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+(20\d{2})(?:\s+(\d{1,2}):(\d{2}))?/);
  return m?{date:`${m[3]}-${months[m[2]]}-${String(m[1]).padStart(2,'0')}`,time:m[4]?`${String(m[4]).padStart(2,'0')}:${m[5]}`:''}:{date:'',time:''};
}
function parseTerminal(html,mawb){
  const text=clean(html),digits=mawb.replace(/\D/g,''),serial=digits.slice(3);
  if(!text.includes(digits)&&!text.includes(mawb)&&!text.includes(serial))return null;
  if(/Reject Reason|is not found/i.test(text))return null;
  const od=text.match(/AWB Type\s+(?:Import|Export)\s+([A-Z]{3})\s+([A-Z]{3})/i)||text.match(/Origin\s+Destination\s+([A-Z]{3})\s+([A-Z]{3})/i);
  const origin=od?.[1]||'',destination=od?.[2]||'';
  const rcs=text.match(/Received from Shipper[\s\S]{0,500}?(\d{1,2}\s+[A-Z]{3}\s+20\d{2}\s+\d{1,2}:\d{2})\s+(\d{1,6})\s+([\d,.]+)/i);
  const depSection=(text.match(/Departure Flight[\s\S]{0,900}?(?=Received from Flight|Cargo Delivered|Last Update|$)/i)||[])[0]||'';
  const deps=[...depSection.matchAll(/\b(CX\d{2,4})\s+(\d{1,2}\s+[A-Z]{3}\s+20\d{2})\s+(\d{1,2}:\d{2})\s*\(STD\)\s+(\d{1,6})\s+([\d,.]+)/gi)];
  const dep=deps.at(-1);
  const rcfSection=(text.match(/Received from Flight[\s\S]{0,1200}?(?=Cargo Delivered|Last Update|$)/i)||[])[0]||'';
  const rcfs=[...rcfSection.matchAll(/\b(CX\d{2,4})\s+(\d{1,2}\s+[A-Z]{3}\s+20\d{2})(?:\s+\d{1,2}:\d{2})?\s+(\d{1,6})\s+([\d,.]+)\s+(\d{1,2}\s+[A-Z]{3}\s+20\d{2}\s+\d{1,2}:\d{2})/gi)];
  const rcf=rcfs.at(-1);
  const delivered=/Cargo Delivered\s*\(DLV\)|Cargo Delivered/i.test(text);
  const arrival=rcf?dt(rcf[5]):{date:'',time:''};
  const booking=rcs?dt(rcs[1]).date:'';
  const pieces=rcf?.[3]||dep?.[4]||rcs?.[2]||'';
  const weight=(rcf?.[4]||dep?.[5]||rcs?.[3]||'').replace(/,/g,'');
  const flightNo=(rcf?.[1]||dep?.[1]||'').toUpperCase();
  const status=delivered?'DELIVERED':rcf?'ARRIVED':dep?'IN TRANSIT':rcs?'BOOKED':'TRACKING';
  return {mawb,carrierCode:'CX',airlineName:'Cathay Cargo',origin,destination,bags:pieces,pieces,weight,bookingDate:booking,flightNo,arrivalDate:arrival.date,arrivalTime:arrival.time,arrivalIsActual:Boolean(rcf&&arrival.date),status,officialTracker:AIRLINE.url,source:'Cathay Cargo Terminal official tracking'};
}
function mergeOfficial(terminal,browser){
  if(!browser)return terminal;
  const b={...browser};
  const browserArrived=/ARRIVED|DELIVERED|RECEIVED.*DESTINATION|LANDED/i.test(String(b.status||''))&&Boolean(b.arrivalIsActual||b.arrivalDate||b.arrivalTime);
  if(browserArrived){
    return {...terminal,...Object.fromEntries(Object.entries(b).filter(([,v])=>v!==''&&v!==null&&v!==undefined)),status:/DELIVERED/i.test(String(b.status))?'DELIVERED':'ARRIVED',arrivalIsActual:true,source:`${terminal.source} + Cathay Cargo official Track & Trace`};
  }
  return {...terminal,bookingDate:terminal.bookingDate||b.bookingDate||'',origin:terminal.origin||b.origin||'',destination:terminal.destination||b.destination||'',flightNo:terminal.flightNo||b.flightNo||'',pieces:terminal.pieces||b.pieces||'',bags:terminal.bags||b.bags||'',weight:terminal.weight||b.weight||''};
}

export async function trackCathay(input){
  const mawb=normalizeMawb(input);if(!mawb||!mawb.startsWith('160-'))return{ok:false,reason:'INVALID CATHAY MAWB',airline:AIRLINE};
  const suffix=mawb.replace(/\D/g,'').slice(3);
  let terminal=null,last='';
  for(const url of [`${BASE}/AWBPrefix/160/AWBSuffix/${suffix}`,`${BASE}?AWBPrefix=160&AWBSuffix=${suffix}`]){
    try{
      const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0','accept-language':'en-US,en;q=0.9'},cache:'no-store',signal:AbortSignal.timeout(12000)});
      last=`HTTP ${r.status}`;if(!r.ok)continue;
      terminal=parseTerminal(await r.text(),mawb);if(terminal)break;
    }catch(e){last=e?.message||String(e);}
  }
  if(!terminal)return{ok:false,reason:'CATHAY TERMINAL RETURNED NO VERIFIED SHIPMENT DATA',airline:AIRLINE,debug:{stage:'NO_DATA',last}};

  if(terminal.status==='ARRIVED'||terminal.status==='DELIVERED')return{ok:true,airline:AIRLINE,shipment:terminal,debug:{stage:'SUCCESS',source:'cathay-terminal-actual'}};

  // Terminal export records often stop at DEP. For those shipments, verify the final
  // destination on Cathay Cargo's own Track & Trace page instead of leaving CX stale.
  try{
    const live=await trackWithBrowser(mawb);
    if(live?.ok){
      const shipment=mergeOfficial(terminal,live.shipment);
      return{ok:true,airline:AIRLINE,shipment,debug:{stage:'SUCCESS',source:'cathay-terminal+official-track-trace',browser:live.debug||null}};
    }
  }catch(e){last=e?.message||String(e);}

  return{ok:true,airline:AIRLINE,shipment:terminal,debug:{stage:'SUCCESS',source:'cathay-terminal',browserFallback:last}};
}
