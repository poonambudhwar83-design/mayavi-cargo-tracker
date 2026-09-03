import { createWorker } from 'tesseract.js';
import { airlineForMawb, normalizeMawb } from './airlines.js';

const MONTHS={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
const pad=v=>String(v).padStart(2,'0');
const first=(s,rx)=>(String(s).match(rx)||[])[1]||'';
function clean(v=''){return String(v||'').replace(/\s+/g,' ').trim()}
function digits(v=''){return String(v||'').replace(/\D/g,'')}
function parseDate(segment=''){
  const s=String(segment).toUpperCase();let m=s.match(/(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})/);if(m)return`${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m=s.match(/(\d{1,2})[-\/.](\d{1,2})[-\/.](20\d{2})/);if(m)return`${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  m=s.match(/(\d{1,2})[\s\-]+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s\-,]+(20\d{2})/);if(m)return`${m[3]}-${MONTHS[m[2]]}-${pad(m[1])}`;
  m=s.match(/(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s\-]+(\d{1,2})[\s\-,]+(20\d{2})/);if(m)return`${m[3]}-${MONTHS[m[1]]}-${pad(m[2])}`;return'';
}
function parseTime(segment=''){const m=String(segment).match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);return m?`${pad(m[1])}:${m[2]}`:''}
function windowAround(flat,rx,before=180,after=300){const m=rx.exec(flat);if(!m)return'';const i=m.index||0;return flat.slice(Math.max(0,i-before),Math.min(flat.length,i+after));}
function statusFromVerifiedText(flat='',awb='',flightNo=''){
  const upper=flat.toUpperCase();
  const arrived=windowAround(upper,/\bDELIVERED\b|\bDLV\b|\bARRIVED\b|\bLANDED\b|ACTUAL\s+ARRIVAL|RECEIVED\s+FROM\s+FLIGHT|\bRCF\b/i,120,320);
  if(arrived){if(/\bDELIVERED\b|\bDLV\b/i.test(arrived))return{status:'DELIVERED',evidence:'strong',snippet:arrived};return{status:'ARRIVED',evidence:'strong',snippet:arrived};}
  const delayed=windowAround(upper,/\bDELAYED\b|\bDELAY\b|\bLATE\b|OFFLOAD|SHORT\s+SHIP|EXCEPTION/i,160,300);
  if(delayed){
    const serial=digits(awb).slice(3),flight=String(flightNo||'').toUpperCase();
    const shipmentLinked=(serial&&digits(delayed).includes(serial))||(flight&&delayed.includes(flight))||/FLIGHT|SHIPMENT|AWB|AIR WAYBILL/i.test(delayed);
    if(shipmentLinked)return{status:'DELAYED',evidence:'strong',snippet:delayed};
  }
  const transit=windowAround(upper,/\bDEPARTED\b|\bDEP\b|IN\s+TRANSIT|IN\s+FLIGHT|AIRBORNE/i,120,260);
  if(transit)return{status:'IN TRANSIT',evidence:'medium',snippet:transit};
  const booked=windowAround(upper,/\bBOOKED\b|\bRCS\b|ACCEPTED|RECEIVED\s+FROM\s+SHIPPER/i,120,260);
  if(booked)return{status:'BOOKED',evidence:'medium',snippet:booked};
  return{status:'',evidence:'none',snippet:''};
}
function parseOcrText(text,mawb){
  const airline=airlineForMawb(mawb)||{};const iata=String(airline.iata||'').toUpperCase();const flat=clean(text),upper=flat.toUpperCase();
  let route=upper.match(/\bORIGIN\b\s*[:\-]?\s*([A-Z]{3})\b[\s\S]{0,140}?\bDESTINATION\b\s*[:\-]?\s*([A-Z]{3})\b/)
    ||upper.match(/\bFROM\b\s*[:\-]?\s*([A-Z]{3})\b[\s\S]{0,140}?\bTO\b\s*[:\-]?\s*([A-Z]{3})\b/)
    ||upper.match(/\b([A-Z]{3})\s*(?:→|->|—|-)\s*([A-Z]{3})\b/);
  const origin=route?.[1]||'',destination=route?.[2]||'';
  const pieces=first(flat,/(?:Pieces?|Pcs?|No\.?\s*of\s*Pieces|Piece Count)\s*[:\-]?\s*(\d{1,6})/i)||first(flat,/\b(\d{1,6})\s*(?:PCS|PIECES?)\b/i);
  const weight=(first(flat,/(?:Gross\s*Weight|Chargeable\s*Weight|Weight)\s*[:\-]?\s*([\d,.]+)\s*(?:KG|KGS)?/i)||first(flat,/\b([\d,.]+)\s*(?:KG|KGS)\b/i)).replace(/,/g,'');
  let flightNo='';if(iata){const esc=iata.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');const m=upper.match(new RegExp(`\\b${esc}\\s*[- ]?(\\d{2,4})\\b`));if(m)flightNo=`${iata}${m[1]}`;}
  if(!flightNo)flightNo=first(upper,/\b([A-Z]{2}\d{2,4})\b/);
  const actual=windowAround(flat,/ATA|ACTUAL\s+ARRIVAL|ARRIVED|RECEIVED\s+FROM\s+FLIGHT|\bRCF\b|LANDED/i,100,360);
  const estimated=windowAround(flat,/ETA|ESTIMATED\s+ARRIVAL|EXPECTED\s+ARRIVAL|SCHEDULED\s+ARRIVAL/i,100,360);
  let arrivalDate=parseDate(actual),arrivalTime=parseTime(actual),arrivalIsActual=Boolean(arrivalDate||arrivalTime);
  if(!arrivalDate&&!arrivalTime){arrivalDate=parseDate(estimated);arrivalTime=parseTime(estimated);arrivalIsActual=false;}
  const st=statusFromVerifiedText(flat,mawb,flightNo);
  const serial=digits(mawb).slice(3),awbMatched=Boolean(serial&&digits(flat).includes(serial));
  const concrete=Boolean((origin&&destination)||pieces||weight||flightNo||arrivalDate||arrivalTime);
  return {mawb,carrierCode:iata,airlineName:airline.name||'',origin,destination,bags:pieces,pieces,weight,flightNo,arrivalDate,arrivalTime,arrivalIsActual,status:st.status,statusEvidence:st.evidence,ocrAwbMatched:awbMatched,source:'Official airline screenshot OCR',screenshotSnippet:st.snippet||actual||estimated||'',concrete};
}

export async function readTrackingScreenshot({mawb,screenshotBase64}){
  const normalized=normalizeMawb(mawb);if(!normalized||!screenshotBase64)return{ok:false,reason:'NO SCREENSHOT TO OCR'};
  let worker;
  try{
    worker=await createWorker('eng');
    const result=await worker.recognize(Buffer.from(screenshotBase64,'base64'));
    const text=result?.data?.text||'';const shipment=parseOcrText(text,normalized);
    if(!shipment.concrete&&!shipment.status)return{ok:false,reason:'SCREENSHOT OCR FOUND NO VERIFIED SHIPMENT FIELDS',shipment,debug:{textSample:clean(text).slice(0,900)}};
    return{ok:true,shipment,debug:{textSample:clean(text).slice(0,1200)}};
  }catch(e){return{ok:false,reason:e?.message||String(e)};}
  finally{try{if(worker)await worker.terminate()}catch{}}
}
