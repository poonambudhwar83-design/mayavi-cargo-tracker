import { createWorker } from 'tesseract.js';
import { normalizeMawb } from './airlines.js';

const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
function first(text,rx){return clean((String(text||'').match(rx)||[])[1]||'');}
function statusFrom(raw=''){
  const s=String(raw||'').trim().toUpperCase();
  if(s==='DLV')return'ARRIVED';
  if(s==='XXX')return'IN TRANSIT';
  if(s==='BKD')return'BOOKED';
  if(s==='ARR')return'ARRIVED';
  if(s==='DEP'||s==='RCF'||s==='MAN')return'IN TRANSIT';
  if(s==='RCS')return'BOOKED';
  if(s==='DLY')return'DELAYED';
  return s||'TRACKING';
}

export function parseSaudiaScreenshotText(text='',input=''){
  const mawb=normalizeMawb(input),flat=clean(text),upper=flat.toUpperCase();
  const wanted=String(mawb||'').replace(/\D/g,'');
  const seen=upper.replace(/\D/g,'');

  // Saudia result card uses short state/status codes. These are authoritative for phase 1.
  // BKD = Booked, DLV = Arrived, XXX = In Transit.
  const sourceStatus=first(upper,/\b(?:STATUS|STATE)\s*:?\s*(DLV|XXX|BKD|ARR|DEP|RCF|MAN|RCS|DLY)\b/i).toUpperCase();

  // Read only the core fields visible in the official result / More Information section first.
  const destination=first(upper,/\bDESTINATION\s*:?\s*([A-Z]{3})\b/i).toUpperCase();
  const pieces=first(upper,/\b(?:TOTAL\s*(?:NUMBER\s*OF\s*)?PIECES|PIECES|PCS|BAGS?)\s*:?\s*(\d{1,6})\b/i);
  const weight=first(upper,/\b(?:GROSS\s*)?WEIGHT\s*:?\s*([\d,.]+)\s*(?:KG|KGS?)?\b/i).replace(/,/g,'');
  const fd=first(upper,/\bFLIGHT\s*(?:NO\.?|NUMBER)\s*:?\s*SV\s*[- ]?(\d{1,4})\b/i);
  const flightNo=fd?`SV${fd}`:'';
  const flightDate=first(upper,/\bFLIGHT\s*DATE\s*:?\s*([0-3]?\d[A-Z]{3}\d{2,4}|20\d{2}[-\/.]\d{1,2}[-\/.]\d{1,2})\b/i).toUpperCase();

  // Keep these available for later phases, but they do not drive the current status/arrival logic.
  const volume=first(upper,/\bVOLUME\s*:?\s*([\d,.]+)\s*(?:M3|M³|CBM)?\b/i).replace(/,/g,'');
  const segmentNo=first(upper,/\bSEGMENT\s*NO\.?\s*:?\s*(\d+)\b/i);
  const sourceEventDateTime=first(upper,/\bDATE\s*:?\s*([^A-Z]{0,4}[0-2]?\d:[0-5]\d\s*[-–—]\s*[0-3]?\d[A-Z]{3}\d{2,4})\b/i);
  const status=statusFrom(sourceStatus);

  const shipment={
    mawb,carrierCode:'SV',airlineName:'Saudia Cargo',origin:'',destination,
    flightNo,pieces,bags:pieces,weight,flightDate,volume,segmentNo,
    sourceStatus,status,
    // Arrival / booking date-time will be handled in the next Saudia phase.
    arrivalDate:'',arrivalTime:'',arrivalIsActual:false,bookingDate:'',
    sourceEventDateTime,
    source:'Saudia Cargo official Submit result card screenshot',
    officialTracker:'https://saudiacargo.com/en/digital-services?tab=trackShipment'
  };
  const mawbMatches=!wanted||seen.includes(wanted);
  const useful=mawbMatches&&Boolean(destination||pieces||weight||flightNo||flightDate||sourceStatus);
  return{shipment,useful,sourceStatus,textSample:flat.slice(0,2200)};
}

export async function readSaudiaScreenshot({mawb,screenshotBase64,timeoutMs=35000}){
  const normalized=normalizeMawb(mawb);
  if(!normalized||!normalized.startsWith('065-')||!screenshotBase64)return{ok:false,reason:'VALID SAUDIA MAWB AND SCREENSHOT REQUIRED'};
  let worker;
  try{
    worker=await createWorker('eng');
    const work=worker.recognize(Buffer.from(String(screenshotBase64).replace(/^data:image\/[^;]+;base64,/i,''),'base64')).then(r=>({kind:'result',r})).catch(e=>({kind:'error',e}));
    const timeout=new Promise(resolve=>setTimeout(()=>resolve({kind:'timeout'}),timeoutMs));
    const result=await Promise.race([work,timeout]);
    if(result.kind==='timeout')return{ok:false,reason:'SAUDIA SCREENSHOT OCR TIMEOUT'};
    if(result.kind==='error')throw result.e;
    const parsed=parseSaudiaScreenshotText(result.r?.data?.text||'',normalized);
    if(!parsed.useful)return{ok:false,reason:'NO VERIFIED SAUDIA CORE FIELDS FOUND IN SUBMIT RESULT CARD SCREENSHOT',debug:parsed};
    return{ok:true,shipment:parsed.shipment,debug:{sourceStatus:parsed.sourceStatus,textSample:parsed.textSample}};
  }catch(e){return{ok:false,reason:e?.message||String(e)};}
  finally{try{if(worker)await worker.terminate()}catch{}}
}
