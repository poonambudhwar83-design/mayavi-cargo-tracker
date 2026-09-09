import { airlineForMawb, normalizeMawb } from '../../../lib/airlines.js';
import { trackOfficial } from '../../../lib/official-tracker.js';
import { trackQatarLiveV2 } from '../../../lib/adapters/qatar-live-v2.js';
import { trackTurkishLive } from '../../../lib/adapters/turkish-live.js';
import { hasExactOfficialAdapter, trackExactOfficial } from '../../../lib/adapters/exact-official.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function waiting(mawb, airline, reason = '') {
  return { mawb, carrierCode: airline?.iata || '', airlineName: airline?.name || '', origin: '', destination: '', bags: '', pieces: '', weight: '', flightNo: '', arrivalDate: '', arrivalTime: '', eta: null, actualArrival: null, status: 'CHECKING', officialTracker: airline?.url || '', source: `${airline?.name || 'Official airline'} official tracker`, message: reason };
}

function stripHtml(html='') {
  return String(html).replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/\s+/g,' ').trim();
}
function cathayDateTime(value='') {
  const m=String(value).match(/(\d{1,2})\s+([A-Z]{3})\s+(\d{4})\s+(\d{1,2}):(\d{2})/i);
  if(!m) return {date:'',time:''};
  const months={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
  const mon=months[m[2].toUpperCase()]; if(!mon) return {date:'',time:''};
  return {date:`${m[3]}-${mon}-${String(m[1]).padStart(2,'0')}`,time:`${String(m[4]).padStart(2,'0')}:${m[5]}`};
}
async function trackCathayTerminal(mawb) {
  const digits=mawb.replace(/\D/g,''); if(!digits.startsWith('160')||digits.length!==11) return null;
  const serial=digits.slice(3);
  const url=`https://www.cathaycargoterminal.com/en-us/Shipment-Tracking/AWBPrefix/160/AWBSuffix/${serial}`;
  try {
    const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0','Accept':'text/html,application/xhtml+xml'},cache:'no-store',redirect:'follow'});
    if(!r.ok) return null;
    const text=stripHtml(await r.text());
    if(!text.includes(digits)&&!text.includes(`160-${serial}`)) return null;
    if(/Reject Reason|is not found/i.test(text)) return null;
    const origin=(text.match(/AWB Type\s+(?:Import|Export)\s+([A-Z]{3})\s+([A-Z]{3})/i)||[])[1]||'';
    const destination=(text.match(/AWB Type\s+(?:Import|Export)\s+([A-Z]{3})\s+([A-Z]{3})/i)||[])[2]||'';
    const rcf=text.match(/Received from Flight[\s\S]*?(?:Received On)?[\s\S]*?(CX\s?\d{2,4})\s+(\d{1,2}\s+[A-Z]{3}\s+\d{4})[\s\S]*?(\d{1,2}\s+[A-Z]{3}\s+\d{4}\s+\d{1,2}:\d{2})/i);
    const delivered=text.match(/Cargo Delivered[\s\S]*?(\d{1,2}\s+[A-Z]{3}\s+\d{4}\s+\d{1,2}:\d{2})/i);
    if(!rcf&&!delivered) return null;
    const dt=cathayDateTime(rcf?.[3]||delivered?.[1]||'');
    return { mawb, carrierCode:'CX', airlineName:'Cathay Cargo', origin, destination, bags:'', pieces:'', weight:'', flightNo:(rcf?.[1]||'').replace(/\s+/g,''), arrivalDate:dt.date, arrivalTime:dt.time, arrivalIsActual:Boolean(dt.date), eta:dt.date?`${dt.date}T${dt.time}:00`:null, actualArrival:dt.date?`${dt.date}T${dt.time}:00`:null, status:'ARRIVED', officialTracker:'https://www.cathaycargo.com/en-us/track-and-trace.html', source:'Cathay Cargo Terminal official shipment record' };
  } catch { return null; }
}

async function handle(mawb) {
  const airline = airlineForMawb(mawb);
  const prefix = mawb.replace(/\D/g, '').slice(0, 3);

  if (prefix === '160') {
    const cathay = await trackCathayTerminal(mawb);
    if (cathay) return Response.json({ ok:true, configured:true, provider:'Cathay Cargo official website', source:cathay.source, airlinePrimary:true, exactCarrierAdapter:true, officialNetworkCapture:true, noPaidApi:true, noTrackJet:true, shipment:cathay });
  }

  if (prefix === '235') {
    const turkish = await trackTurkishLive(mawb);
    if (turkish.ok) return Response.json({ ok:true, configured:true, provider:'Turkish Cargo official website', source:turkish.shipment.source, airlinePrimary:true, exactCarrierAdapter:true, officialNetworkCapture:true, noPaidApi:true, noTrackJet:true, shipment:turkish.shipment, trackingDebug:turkish.debug });
    return Response.json({ ok:true, configured:true, provider:'Turkish Cargo official website', source:'Turkish Cargo official tracker', airlinePrimary:true, exactCarrierAdapter:true, officialNetworkCapture:true, noPaidApi:true, noTrackJet:true, trackingError:turkish.reason, trackingDebug:turkish.debug, officialTracker:turkish.airline?.url || airline?.url || '', shipment:waiting(mawb, turkish.airline || airline, turkish.reason) });
  }

  const exact = prefix === '157' || hasExactOfficialAdapter(prefix);
  const result = prefix === '157' ? await trackQatarLiveV2(mawb) : hasExactOfficialAdapter(prefix) ? await trackExactOfficial(mawb) : await trackOfficial(mawb);

  if (result.ok) {
    return Response.json({ ok: true, configured: true, provider: `${result.airline.name} official website`, source: `${result.airline.name} official website`, airlinePrimary: true, exactCarrierAdapter: exact, officialNetworkCapture: exact, noPaidApi: true, noTrackJet: true, shipment: result.shipment, trackingDebug: result.debug });
  }

  return Response.json({ ok: true, configured: true, provider: 'Official airline websites', source: 'Official airline tracker', airlinePrimary: true, exactCarrierAdapter: exact, officialNetworkCapture: exact, noPaidApi: true, noTrackJet: true, trackingError: result.reason, trackingDebug: result.debug, officialTracker: result.airline?.url || airline?.url || '', shipment: waiting(mawb, result.airline || airline, result.reason) });
}

export async function GET(request) {
  const url = new URL(request.url); const query = url.searchParams.get('mawb');
  if (!query) return Response.json({ configured:true, provider:'Official airline websites', apiKeyRequired:false, noPaidApi:true, noTrackJet:true, exactAdapters:['235 Turkish Cargo','160 Cathay Cargo','157 Qatar Airways Cargo','065 Saudia Cargo','176 Emirates SkyCargo','098 Air India Cargo','514 Air Arabia Cargo'], mode:'MAWB prefix → exact carrier adapter when mapped → official airline form + official network response' });
  const mawb=normalizeMawb(query); if(!mawb) return Response.json({ok:false,error:'Enter a valid 11-digit MAWB.'},{status:400}); return handle(mawb);
}

export async function POST(request) {
  let body={}; try{body=await request.json();}catch{return Response.json({ok:false,error:'Invalid request body.'},{status:400});}
  const mawb=normalizeMawb(body?.mawb); if(!mawb) return Response.json({ok:false,error:'Enter a valid 11-digit MAWB.'},{status:400}); return handle(mawb);
}
