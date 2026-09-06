import { createWorker } from 'tesseract.js';
import { normalizeMawb } from './airlines.js';

const MONTHS={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
const pad=v=>String(v).padStart(2,'0');
const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
const first=(s,rx)=>(String(s).match(rx)||[])[1]||'';
function eventStamp(e={}){const t=Date.parse(`${e.date||''}T${e.time||'00:00'}:00Z`);return Number.isFinite(t)?t:0}
function compactDate(day,month,year){const m=MONTHS[String(month).slice(0,3).toUpperCase()];if(!m)return'';const y=String(year).length===2?`20${year}`:String(year);return`${y}-${m}-${pad(day)}`}
function eventsFromText(text=''){
  const flat=clean(text).toUpperCase(),anchors=[];
  const compact=/\b([01]?\d|2[0-3])\s*[:.]\s*([0-5]\d)\s*[-–—]\s*([0-3]?\d)\s*(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s*(\d{2,4})\s*(?:LOCAL\s*TIME)?/g;
  for(const m of flat.matchAll(compact))anchors.push({index:m.index||0,time:`${pad(m[1])}:${m[2]}`,date:compactDate(m[3],m[4],m[5])});
  const verbose=/\b([0-3]?\d)\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s+(20\d{2})\s+([01]?\d|2[0-3])[:.]([0-5]\d)\b/g;
  for(const m of flat.matchAll(verbose))anchors.push({index:m.index||0,time:`${pad(m[4])}:${m[5]}`,date:`${m[3]}-${MONTHS[m[2]]}-${pad(m[1])}`});
  anchors.sort((a,b)=>a.index-b.index);const uniq=[];for(const a of anchors){if(!uniq.some(x=>Math.abs(x.index-a.index)<10))uniq.push(a)}
  return uniq.map((a,i)=>({...a,text:flat.slice(a.index,i+1<uniq.length?uniq[i+1].index:Math.min(flat.length,a.index+700)).trim()}));
}
function arrival(t=''){return /\bARRIVED?\b|\(ARR\)|\bRCF\b|RECEIVED\s+FROM\s+FLIGHT|ACTUAL\s+ARRIVAL|LANDED/.test(t)}
function departure(t=''){return /\bDEPARTED?\b|\(DEP\)|AIRBORNE|IN\s+TRANSIT/.test(t)}
function booking(t=''){return /\bRCS\b|RECEIVED\s+FROM\s+SHIPPER|\bBOOKED\b|ACCEPTED/.test(t)}
function manifest(t=''){return /MANIFESTED\s+ON\s+FLIGHT|\(MAN\)|PLANNED\s+FOR\s+FLIGHT/.test(t)}
function delayed(t=''){return /DISCREPANCY|\(DIS\)|DELAY|LATE|OFFLOAD|EXCEPTION/.test(t)}
function eventFields(e={}){
  const t=String(e.text||'').toUpperCase();
  const flight=first(t,/\bSV\s*[- ]?(\d{2,4})\b/);
  const destination=first(t,/,\s*([A-Z]{3})\b/)||first(t,/\bTO\b[\s\S]{0,120}?\(([A-Z]{3})\)/);
  const pieces=first(t,/(?:PIECES?|PCS?)\s*[:\-]?\s*(\d{1,6})/);
  const weight=(first(t,/WEIGHT\s*[:\-]?\s*([\d,.]+)/)||'').replace(/,/g,'');
  return{flightNo:flight?`SV${flight}`:'',destination,pieces,weight};
}
export function parseSaudiaScreenshotText(text='',input=''){
  const mawb=normalizeMawb(input),flat=clean(text),upper=flat.toUpperCase(),events=eventsFromText(flat),chron=[...events].sort((a,b)=>eventStamp(a)-eventStamp(b)),latest=[...chron].reverse();
  const arrivalEvent=latest.find(e=>arrival(e.text))||null,latestOperational=latest.find(e=>arrival(e.text)||departure(e.text)||booking(e.text)||manifest(e.text)||delayed(e.text))||null;
  const bookingEvent=chron.find(e=>/\bRCS\b|RECEIVED\s+FROM\s+SHIPPER/.test(e.text))||chron.find(e=>booking(e.text))||null;
  const af=eventFields(arrivalEvent||{}),lf=eventFields(latestOperational||{});
  const destination=af.destination||lf.destination||first(upper,/\bDESTINATION\s*[:\-]?\s*([A-Z]{3})\b/);
  const origin=first(upper,/\bORIGIN\s*[:\-]?\s*([A-Z]{3})\b/)||(/KING\s+KHALED[\s\S]{0,80}?\(RUH\)/.test(upper)?'RUH':'');
  const flightNo=af.flightNo||lf.flightNo||(first(upper,/\bSV\s*[- ]?(\d{2,4})\b/)?`SV${first(upper,/\bSV\s*[- ]?(\d{2,4})\b/)}`:'');
  const pieces=af.pieces||lf.pieces||first(upper,/(?:TOTAL\s+NUMBER\s+OF\s+PIECES|PIECES?|PCS?)\s*[:\-]?\s*(\d{1,6})/);
  const weight=(af.weight||lf.weight||first(upper,/WEIGHT\s*[:\-]?\s*([\d,.]+)/)||'').replace(/,/g,'');
  let status='';if(latestOperational){if(arrival(latestOperational.text))status='ARRIVED';else if(departure(latestOperational.text))status='IN TRANSIT';else if(delayed(latestOperational.text))status='DELAYED';else if(booking(latestOperational.text)||manifest(latestOperational.text))status='BOOKED';}
  if(arrivalEvent&&!status)status='ARRIVED';
  const shipment={mawb,carrierCode:'SV',airlineName:'Saudia Cargo',origin,destination,flightNo,pieces,bags:pieces,weight,bookingDate:bookingEvent?.date||'',arrivalDate:arrivalEvent?.date||'',arrivalTime:arrivalEvent?.time||'',arrivalIsActual:Boolean(arrivalEvent?.date&&arrivalEvent?.time),status,source:'Saudia Cargo official screenshot timeline OCR',officialTracker:'https://china.saudiacargo.com/e-services/track-shipment'};
  const useful=Boolean(events.length||destination||pieces||flightNo||shipment.bookingDate||shipment.arrivalDate||shipment.arrivalTime||status);
  return{shipment,useful,eventCount:events.length,arrivalEvent:arrivalEvent?.text||'',latestEvent:latestOperational?.text||'',textSample:flat.slice(0,1800)};
}
export async function readSaudiaScreenshot({mawb,screenshotBase64,timeoutMs=35000}){
  const normalized=normalizeMawb(mawb);if(!normalized||!normalized.startsWith('065-')||!screenshotBase64)return{ok:false,reason:'VALID SAUDIA MAWB AND SCREENSHOT REQUIRED'};
  let worker;
  try{
    worker=await createWorker('eng');
    const work=worker.recognize(Buffer.from(String(screenshotBase64).replace(/^data:image\/[^;]+;base64,/i,''),'base64')).then(r=>({kind:'result',r})).catch(e=>({kind:'error',e}));
    const timeout=new Promise(resolve=>setTimeout(()=>resolve({kind:'timeout'}),timeoutMs));const result=await Promise.race([work,timeout]);
    if(result.kind==='timeout')return{ok:false,reason:'SAUDIA SCREENSHOT OCR TIMEOUT'};if(result.kind==='error')throw result.e;
    const parsed=parseSaudiaScreenshotText(result.r?.data?.text||'',normalized);if(!parsed.useful)return{ok:false,reason:'NO VERIFIED SAUDIA TIMELINE FIELDS FOUND',debug:parsed};
    return{ok:true,shipment:parsed.shipment,debug:{eventCount:parsed.eventCount,arrivalEvent:parsed.arrivalEvent.slice(0,500),latestEvent:parsed.latestEvent.slice(0,500),textSample:parsed.textSample}};
  }catch(e){return{ok:false,reason:e?.message||String(e)};}finally{try{if(worker)await worker.terminate()}catch{}}
}
