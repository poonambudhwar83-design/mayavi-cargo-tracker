import { createWorker } from 'tesseract.js';
import { normalizeMawb } from './airlines.js';

const MONTHS={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
const pad=v=>String(v).padStart(2,'0');
const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
function iso(day,mon,year){const m=MONTHS[String(mon).slice(0,3).toUpperCase()];if(!m)return'';const y=String(year).length===2?`20${year}`:String(year);return`${y}-${m}-${pad(day)}`}
function dateFromText(s=''){
  const t=String(s||'').toUpperCase();
  let m=t.match(/\b([0-3]?\d)\s*(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s*(\d{2,4})\b/);if(m)return iso(m[1],m[2],m[3]);
  m=t.match(/\b([0-3]?\d)\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s+(20\d{2})\b/);if(m)return iso(m[1],m[2],m[3]);
  m=t.match(/\b(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})\b/);if(m)return`${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  return'';
}
function timedEvents(text=''){
  const flat=clean(text).toUpperCase(),out=[];
  for(const m of flat.matchAll(/\b([01]?\d|2[0-3])\s*[:.]\s*([0-5]\d)\s*[-–—]\s*([0-3]?\d)\s*(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s*(\d{2,4})\s*(?:LOCAL\s*TIME)?/g))out.push({index:m.index||0,time:`${pad(m[1])}:${m[2]}`,date:iso(m[3],m[4],m[5])});
  for(const m of flat.matchAll(/\b([0-3]?\d)\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s+(20\d{2})\s+([01]?\d|2[0-3])[:.]([0-5]\d)\b/g))out.push({index:m.index||0,time:`${pad(m[4])}:${m[5]}`,date:iso(m[1],m[2],m[3])});
  out.sort((a,b)=>a.index-b.index);return out.map((e,i)=>({...e,text:flat.slice(e.index,i+1<out.length?out[i+1].index:Math.min(flat.length,e.index+800))}));
}
function summaryWindow(upper=''){
  const hit=upper.search(/\bSEGMENT(?:ATION)?\s*1\b/);return hit>=0?upper.slice(0,hit):upper.slice(0,2800);
}
function segmentOne(upper=''){
  const m=upper.match(/\bSEGMENT(?:ATION)?\s*1\b/);if(!m)return'';const start=m.index||0;const rest=upper.slice(start+m[0].length);const next=rest.search(/\bSEGMENT(?:ATION)?\s*2\b/);return upper.slice(start,next>=0?start+m[0].length+next:Math.min(upper.length,start+1800));
}
function explicitWeight(text=''){return ((String(text).match(/\bWEIGHT\s*[:\-]?\s*([\d,.]+)\s*(?:KG|KGS|KILOGRAMS?)\b/i)||[])[1]||'').replace(/,/g,'')}
function pieces(text=''){return (String(text).match(/(?:TOTAL\s+NUMBER\s+OF\s+PIECES|NO\.?\s*OF\s*PIECES|PIECES?|PCS?)\s*[:\-]?\s*(\d{1,6})/i)||[])[1]||''}
function destination(text=''){return (String(text).match(/\bDESTINATION\s*[:\-]?\s*([A-Z]{3})\b/i)||[])[1]||''}
function flight(text=''){const f=(String(text).match(/\bSV\s*[- ]?(\d{2,4})\b/i)||[])[1]||'';return f?`SV${f}`:''}
function actualArrivalEvent(events=[]){for(const e of [...events].reverse())if(/\bARRIVED?\b|\bDELIVERED\b|\bDLV\b|\bRCF\b|RECEIVED\s+FROM\s+FLIGHT|LANDED/i.test(e.text))return e;return null}

export function parseSaudiaScreenshotText(text='',input=''){
  const mawb=normalizeMawb(input),flat=clean(text),upper=flat.toUpperCase();
  const summary=summaryWindow(upper),seg1=segmentOne(upper),events=timedEvents(upper),actualArrival=actualArrivalEvent(events);
  const state=(summary.match(/\bSTATE\s*[:\-]?\s*(BOOKED|DELIVERED|ARRIVED|DELAYED|DEPARTED|IN\s+TRANSIT)\b/i)||[])[1]||'';
  const status=state?state.replace(/\s+/g,' ').toUpperCase():'TRACKING';
  const bookingDate=dateFromText(seg1);
  const summaryDate=dateFromText((summary.match(/\bDATE\b[\s:\-]*[^A-Z0-9]{0,8}[0-9A-Z\s\-\/.]{4,30}/i)||[])[0]||summary);
  const arrivalDate=actualArrival?.date||summaryDate||'';
  const arrivalTime=actualArrival?.time||'';
  const shipment={
    mawb,carrierCode:'SV',airlineName:'Saudia Cargo',origin:'',
    destination:destination(summary)||destination(upper),
    flightNo:flight(upper),pieces:pieces(summary)||pieces(upper),bags:pieces(summary)||pieces(upper),
    weight:explicitWeight(summary)||'',bookingDate,arrivalDate,arrivalTime,
    arrivalIsActual:Boolean(actualArrival?.date&&actualArrival?.time),status,
    source:'Saudia Cargo official More Information screenshot',
    officialTracker:'https://china.saudiacargo.com/e-services/track-shipment'
  };
  const useful=Boolean(shipment.destination||shipment.pieces||shipment.weight||shipment.bookingDate||shipment.arrivalDate||status!=='TRACKING');
  return{shipment,useful,summarySample:summary.slice(0,1100),segment1Sample:seg1.slice(0,900),eventCount:events.length,actualArrival:actualArrival?.text||'',textSample:flat.slice(0,2000)};
}

export async function readSaudiaScreenshot({mawb,screenshotBase64,timeoutMs=35000}){
  const normalized=normalizeMawb(mawb);if(!normalized||!normalized.startsWith('065-')||!screenshotBase64)return{ok:false,reason:'VALID SAUDIA MAWB AND SCREENSHOT REQUIRED'};
  let worker;
  try{
    worker=await createWorker('eng');
    const work=worker.recognize(Buffer.from(String(screenshotBase64).replace(/^data:image\/[^;]+;base64,/i,''),'base64')).then(r=>({kind:'result',r})).catch(e=>({kind:'error',e}));
    const timeout=new Promise(resolve=>setTimeout(()=>resolve({kind:'timeout'}),timeoutMs));const result=await Promise.race([work,timeout]);
    if(result.kind==='timeout')return{ok:false,reason:'SAUDIA SCREENSHOT OCR TIMEOUT'};if(result.kind==='error')throw result.e;
    const parsed=parseSaudiaScreenshotText(result.r?.data?.text||'',normalized);if(!parsed.useful)return{ok:false,reason:'NO VERIFIED SAUDIA FIELDS FOUND IN MORE INFORMATION SCREENSHOT',debug:parsed};
    return{ok:true,shipment:parsed.shipment,debug:{eventCount:parsed.eventCount,summarySample:parsed.summarySample,segment1Sample:parsed.segment1Sample,actualArrival:parsed.actualArrival.slice(0,500),textSample:parsed.textSample}};
  }catch(e){return{ok:false,reason:e?.message||String(e)};}finally{try{if(worker)await worker.terminate()}catch{}}
}
