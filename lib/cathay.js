import { normalizeMawb } from './airlines.js';

const TERMINAL='https://www.cathaycargoterminal.com/en-us/Shipment-Tracking';
const CATHAY='https://www.cathaycargo.com/en-us/track-and-trace.html';
const AIRLINE={name:'Cathay Cargo',iata:'CX',url:CATHAY};
const MONTH={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
const pad=v=>String(v).padStart(2,'0');
const clean=s=>String(s||'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/\s+/g,' ').trim();
function dt(v=''){const m=String(v).toUpperCase().match(/(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s+(20\d{2})(?:\s+(\d{1,2}):(\d{2}))?/);return m?{date:`${m[3]}-${MONTH[m[2]]}-${pad(m[1])}`,time:m[4]?`${pad(m[4])}:${m[5]}`:''}:{date:'',time:''}}
function parse(html,mawb){
 const text=clean(html),digits=mawb.replace(/\D/g,''),serial=digits.slice(3); if(!text.includes(digits)&&!text.includes(serial))return null; if(/Reject Reason|is not found/i.test(text))return null;
 const od=text.match(/AWB Type\s+(?:Import|Export)\s+([A-Z]{3})\s+([A-Z]{3})/i)||text.match(/Origin\s+Destination\s+([A-Z]{3})\s+([A-Z]{3})/i);
 const rcs=text.match(/Received from Shipper[\s\S]{0,1600}?(\d{1,2}\s+[A-Z]{3}\s+20\d{2}\s+\d{1,2}:\d{2})\s+(\d{1,6})\s+([\d,.]+)/i);
 const depBlock=(text.match(/Departure Flight[\s\S]{0,4000}?(?=Received from Flight|Cargo Delivered|Last Update|$)/i)||[])[0]||'';
 const deps=[...depBlock.matchAll(/\b(CX\s*\d{2,4})\s+(\d{1,2}\s+[A-Z]{3}\s+20\d{2})\s+(\d{1,2}:\d{2})\s*\(STD\)\s+(\d{1,6})\s+([\d,.]+)/gi)],dep=deps.at(-1);
 const rcfBlock=(text.match(/Received from Flight[\s\S]{0,6000}?(?=Cargo Delivered|Last Update|$)/i)||[])[0]||'';
 const rcfs=[...rcfBlock.matchAll(/\b(CX\s*\d{2,4})\s+(\d{1,2}\s+[A-Z]{3}\s+20\d{2})(?:\s+\d{1,2}:\d{2})?\s+(\d{1,6})\s+([\d,.]+)\s+(\d{1,2}\s+[A-Z]{3}\s+20\d{2}\s+\d{1,2}:\d{2})/gi)],rcf=rcfs.at(-1);
 const arrival=rcf?dt(rcf[5]):{date:'',time:''}; const pieces=rcf?.[3]||dep?.[4]||rcs?.[2]||'',weight=(rcf?.[4]||dep?.[5]||rcs?.[3]||'').replace(/,/g,'');
 return {mawb,carrierCode:'CX',airlineName:'Cathay Cargo',origin:od?.[1]||'',destination:od?.[2]||'',bags:pieces,pieces,weight,bookingDate:rcs?dt(rcs[1]).date:'',flightNo:String(rcf?.[1]||dep?.[1]||'').replace(/\s/g,'').toUpperCase(),arrivalDate:arrival.date,arrivalTime:arrival.time,arrivalIsActual:Boolean(rcf&&arrival.date),status:/Cargo Delivered/i.test(text)?'DELIVERED':rcf?'ARRIVED':dep?'IN TRANSIT':rcs?'BOOKED':'TRACKING',officialTracker:CATHAY,source:'Cathay Cargo Terminal official tracking'};
}
async function get(url){try{const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0','accept':'text/html,application/xhtml+xml'},redirect:'follow',cache:'no-store',signal:AbortSignal.timeout(10000)});if(!r.ok)return null;return await r.text()}catch{return null}}
export async function trackCathay(input){
 const mawb=normalizeMawb(input);if(!mawb||!mawb.startsWith('160-'))return{ok:false,reason:'INVALID CATHAY MAWB',airline:AIRLINE}; const suffix=mawb.replace(/\D/g,'').slice(3);
 const urls=[`${TERMINAL}/AWBPrefix/160/AWBSuffix/${suffix}`,`${TERMINAL}?AWBPrefix=160&AWBSuffix=${suffix}`];
 for(const url of urls){const html=await get(url);if(!html)continue;const shipment=parse(html,mawb);if(shipment)return{ok:true,airline:AIRLINE,shipment,debug:{source:'cathay-terminal-fast'}}}
 return{ok:false,airline:AIRLINE,reason:'CATHAY TERMINAL DATA NOT EXTRACTED'};
}
