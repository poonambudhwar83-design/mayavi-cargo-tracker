import { normalizeMawb } from './airlines.js';
import { trackWithBrowser } from './browserTracker.js';

const URL='https://6ecargo.goindigo.in/FrmAWBTracking.aspx';
const pad=v=>String(v).padStart(2,'0');
function dateOnly(v=''){const m=String(v).match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/);return m?`${m[3]}-${pad(m[2])}-${pad(m[1])}`:'';}
function timeOnly(v=''){const m=String(v).match(/\b([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?\b/);return m?`${pad(m[1])}:${m[2]}`:'';}
function clean(html=''){return String(html).replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/\s+/g,' ').trim();}

export function parseIndigoTracking(html='',mawb=''){
  const text=clean(html),upper=text.toUpperCase();
  const route=upper.match(/\b([A-Z]{3})\s*-\s*([A-Z]{3})\b/);
  const origin=route?.[1]||'',destination=route?.[2]||'';
  const pc=text.match(/\b(\d{1,6})\s*P\s*\/\s*([\d,.]+)\s*KGS?\b/i);
  const pieces=pc?.[1]||'',weight=(pc?.[2]||'').replace(/,/g,'');
  const flightMatches=[...upper.matchAll(/\b(6E\s*\d{2,4})\b/g)].map(m=>m[1].replace(/\s+/g,''));
  const flightNo=flightMatches.at(-1)||'';
  const booked=text.match(/\bBOOKED\b[\s\S]{0,220}?(\d{1,2}\/\d{1,2}\/20\d{2})\s+(\d{1,2}:\d{2})/i);
  const arrived=text.match(/\bARRIVED\b[\s\S]{0,260}?(\d{1,2}\/\d{1,2}\/20\d{2})[\s\S]{0,120}?(\d{1,2}:\d{2}(?::\d{2})?)/i);
  const manifested=text.match(/\bMANIFESTED\b[\s\S]{0,260}?(\d{1,2}\/\d{1,2}\/20\d{2})[\s\S]{0,120}?(\d{1,2}:\d{2}(?::\d{2})?)/i);
  const bookingDate=booked?dateOnly(booked[1]):'';
  const arrivalDate=arrived?dateOnly(arrived[1]):(manifested?dateOnly(manifested[1]):'');
  const arrivalTime=arrived?timeOnly(arrived[2]):'';
  let status='TRACKING';
  if(/\bDELIVERED\b/.test(upper)||/\bARRIVED\b/.test(upper))status='ARRIVED';
  else if(/\bDEPARTED\b|\bMANIFESTED\b|\bIN TRANSIT\b/.test(upper))status='IN TRANSIT';
  else if(/\bBOOKED\b|\bACCEPTED\b/.test(upper))status='BOOKED';
  if(/\bDELAYED\b|\bOFFLOAD(?:ED)?\b|\bLATE\b/.test(upper))status='DELAYED';
  return{mawb,carrierCode:'6E',airlineName:'IndiGo CarGo',origin,destination,bags:pieces,pieces,weight,flightNo,bookingDate,arrivalDate,arrivalTime,arrivalIsActual:Boolean(arrived),status,officialTracker:URL,source:'IndiGo CarGo official AWB Tracking'};
}

export async function trackIndigo(input){
  const mawb=normalizeMawb(input);
  if(!mawb||!mawb.startsWith('312-'))return{ok:false,reason:'INVALID INDIGO MAWB',officialTracker:URL};
  const serial=mawb.slice(4);
  const direct=`${URL}?AWBNo=${encodeURIComponent(serial)}&AWBPrefix=312`;
  try{
    const res=await fetch(direct,{headers:{'user-agent':'Mozilla/5.0'}});
    if(res.ok){
      const html=await res.text();
      const shipment=parseIndigoTracking(html,mawb);
      const useful=Boolean((shipment.origin&&shipment.destination)||shipment.pieces||shipment.weight||shipment.flightNo||shipment.bookingDate||shipment.arrivalDate||shipment.arrivalTime||shipment.status!=='TRACKING');
      if(useful)return{ok:true,shipment,officialTracker:direct,adapter:'IndiGo CarGo direct AWB page'};
    }
  }catch{}
  const fallback=await trackWithBrowser(mawb);
  if(!fallback?.ok)return{...fallback,officialTracker:URL,adapter:'IndiGo CarGo prepared adapter'};
  return{...fallback,shipment:{...fallback.shipment,mawb,carrierCode:'6E',airlineName:'IndiGo CarGo',officialTracker:URL},officialTracker:URL,adapter:'IndiGo CarGo prepared adapter'};
}
