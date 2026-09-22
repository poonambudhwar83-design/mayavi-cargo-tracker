import { airlineForMawb, normalizeMawb } from '../../../lib/airlines.js';
import { trackOfficial } from '../../../lib/official-tracker.js';
import { trackQatarLiveV2 } from '../../../lib/adapters/qatar-live-v2.js';
import { trackTurkishLive } from '../../../lib/adapters/turkish-live.js';
import { trackKuwaitLive } from '../../../lib/adapters/kuwait-live.js';
import { trackOmanLive } from '../../../lib/adapters/oman-live.js';
import { trackSaudiaSal } from '../../../lib/adapters/saudia-sal.js';
import { trackCathayLive } from '../../../lib/adapters/cathay-live.js';
import { trackVietnamChamp } from '../../../lib/adapters/vietnam-champ.js';
import { hasExactOfficialAdapter, trackExactOfficial } from '../../../lib/adapters/exact-official.js';
import { fetchFlightEta } from '../../../lib/aerodatabox.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;

function waiting(mawb,airline,reason=''){
  return{mawb,carrierCode:airline?.iata||'',airlineName:airline?.name||'',origin:'',destination:'',bags:'',pieces:'',weight:'',flightNo:'',arrivalDate:'',arrivalTime:'',eta:null,actualArrival:null,status:'CHECKING',officialTracker:airline?.url||'',source:`${airline?.name||'Official airline'} official tracker`,message:reason};
}

async function liveEtaOverlay(shipment={}){
  const carrier=String(shipment?.carrierCode||'').toUpperCase();
  const status=String(shipment?.status||'').toUpperCase();
  // Air India may publish the operating flight at MANIFESTED/ACCEPTED stage.
  // Do not turn that into an arrival clock before an actual DEP/IN TRANSIT milestone.
  if(carrier==='AI' && /MANIFESTED|ACCEPTED|EXECUTED|FREIGHT ON HAND|BOOKED|RCS|TRACKING/.test(status)) return shipment;
  if(!shipment?.flightNo || shipment?.arrivalIsActual || shipment?.actualArrival) return shipment;
  let live=null; try{ live=await fetchFlightEta(shipment.flightNo); }catch{}
  if(!live?.eta) return shipment;
  const m=String(live.eta).match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if(!m) return shipment;
  return {...shipment,
    arrivalDate:`${m[1]}-${m[2]}-${m[3]}`, arrivalTime:`${m[4]}:${m[5]}`,
    eta:`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00`,
    liveFlightEta:true,
    source:`${shipment.source||'Official airline tracker'} + live flight ETA`
  };
}
function liveJson(payload){
  if(!payload?.shipment) return Response.json(payload);
  return liveEtaOverlay(payload.shipment).then(shipment=>Response.json({...payload,shipment}));
}

async function handle(mawb){
  const airline=airlineForMawb(mawb);
  const prefix=mawb.replace(/\D/g,'').slice(0,3);

  if(prefix==='065'){
    // Saudia is intentionally multi-source. SAL is authoritative for the full
    // timeline/part-load logic, while the older official Saudia reader is kept
    // as a field-level fallback so useful booking/route/master data never goes
    // blank just because one SAL card or selector changes.
    const sal=await trackSaudiaSal(mawb);
    let fallback=null;
    try{
      const oldReader=await trackExactOfficial(mawb);
      if(oldReader?.ok)fallback=oldReader.shipment;
    }catch{}
    if(sal.ok){
      const s=sal.shipment||{};
      const shipment={...fallback,...s,
        origin:s.origin||fallback?.origin||'',
        destination:s.destination||fallback?.destination||'',
        bookingDate:s.bookingDate||fallback?.bookingDate||fallback?.bookedDate||'',
        bags:s.bags||s.pieces||fallback?.bags||fallback?.pieces||'',
        pieces:s.pieces||s.bags||fallback?.pieces||fallback?.bags||'',
        weight:s.weight||fallback?.weight||'',
        flightNo:s.flightNo||fallback?.flightNo||'',
        arrivalDate:s.arrivalDate||fallback?.arrivalDate||'',
        arrivalTime:s.arrivalTime||fallback?.arrivalTime||'',
        eta:s.eta||fallback?.eta||null,
        actualArrival:s.actualArrival||fallback?.actualArrival||null,
        status:s.status||fallback?.status||'TRACKING',
        source:fallback?'SAL full timeline + Saudia official fallback':'SAL official full timeline'
      };
      return Response.json({ok:true,configured:true,provider:'SAL + Saudia official shipment trackers',source:shipment.source,airlinePrimary:true,exactCarrierAdapter:true,officialNetworkCapture:true,noPaidApi:true,noTrackJet:true,shipment,trackingDebug:{sal:sal.debug,fallbackUsed:Boolean(fallback)}});
    }
    if(fallback)return liveJson({ok:true,configured:true,provider:'Saudia official shipment tracker',source:fallback.source||'Saudia Cargo official website',airlinePrimary:true,exactCarrierAdapter:true,officialNetworkCapture:true,noPaidApi:true,noTrackJet:true,shipment:fallback,trackingDebug:{salError:sal.reason,fallbackUsed:true}});
    return liveJson({ok:true,configured:true,provider:'SAL official shipment tracker',source:'SAL official shipment tracker',airlinePrimary:true,exactCarrierAdapter:true,officialNetworkCapture:true,noPaidApi:true,noTrackJet:true,trackingError:sal.reason,trackingDebug:sal.debug,officialTracker:'https://sal.sa/trackshipment',shipment:waiting(mawb,sal.airline||airline,sal.reason)});
  }

  if(prefix==='229'){
    const x=await trackKuwaitLive(mawb);
    if(x.ok)return liveJson({ok:true,configured:true,provider:'Kuwait Airways official website',source:x.shipment.source,airlinePrimary:true,exactCarrierAdapter:true,officialNetworkCapture:true,noPaidApi:true,noTrackJet:true,shipment:x.shipment,trackingDebug:x.debug});
    return liveJson({ok:true,configured:true,provider:'Kuwait Airways official website',source:'Kuwait Airways official cargo tracker',airlinePrimary:true,exactCarrierAdapter:true,officialNetworkCapture:true,noPaidApi:true,noTrackJet:true,trackingError:x.reason,trackingDebug:x.debug,officialTracker:x.airline?.url||airline?.url||'',shipment:waiting(mawb,x.airline||airline,x.reason)});
  }

  if(prefix==='910'){
    const x=await trackOmanLive(mawb);
    if(x.ok)return liveJson({ok:true,configured:true,provider:'Oman Air Cargo official website',source:x.shipment.source,airlinePrimary:true,exactCarrierAdapter:true,officialNetworkCapture:true,noPaidApi:true,noTrackJet:true,shipment:x.shipment,trackingDebug:x.debug});
    return liveJson({ok:true,configured:true,provider:'Oman Air Cargo official website',source:'Oman Air Cargo official tracker',airlinePrimary:true,exactCarrierAdapter:true,officialNetworkCapture:true,noPaidApi:true,noTrackJet:true,trackingError:x.reason,trackingDebug:x.debug,officialTracker:x.airline?.url||airline?.url||'',shipment:waiting(mawb,x.airline||airline,x.reason)});
  }

  if(prefix==='160'){
    const cathay=await trackCathayLive(mawb);
    if(cathay.ok){
      // Keep Cathay terminal as authority for route/arrival, but merge any useful
      // pieces/weight/flight fields already exposed by the existing official reader.
      let fallback=null;
      try{const r=await trackOfficial(mawb);if(r?.ok)fallback=r.shipment;}catch{}
      const c=cathay.shipment;
      const shipment={...fallback,...c,
        origin:c.origin||fallback?.origin||'',
        destination:c.destination||fallback?.destination||'',
        arrivalDate:c.arrivalDate||fallback?.arrivalDate||'',
        arrivalTime:c.arrivalTime||fallback?.arrivalTime||'',
        eta:c.eta||fallback?.eta||null,
        actualArrival:c.actualArrival||fallback?.actualArrival||null,
        pieces:c.pieces||fallback?.pieces||fallback?.bags||'',
        bags:c.bags||fallback?.bags||fallback?.pieces||'',
        weight:c.weight||fallback?.weight||'',
        flightNo:c.flightNo||fallback?.flightNo||'',
        status:c.status||fallback?.status||'IN_TRANSIT',
        source:'Cathay Cargo Terminal official shipment record'
      };
      return Response.json({ok:true,configured:true,provider:'Cathay Cargo official website',source:shipment.source,airlinePrimary:true,exactCarrierAdapter:true,officialNetworkCapture:true,noPaidApi:true,noTrackJet:true,shipment,trackingDebug:cathay.debug});
    }
    // If terminal markup changes, retain the existing official reader rather than
    // returning blank data.
    const fallback=await trackOfficial(mawb);
    if(fallback.ok)return liveJson({ok:true,configured:true,provider:'Cathay Cargo official website',source:fallback.shipment.source||'Cathay Cargo official website',airlinePrimary:true,exactCarrierAdapter:true,officialNetworkCapture:true,noPaidApi:true,noTrackJet:true,shipment:fallback.shipment,trackingDebug:{cathayTerminal:cathay.reason,fallback:fallback.debug}});
    return liveJson({ok:true,configured:true,provider:'Cathay Cargo official website',source:'Cathay Cargo official tracker',airlinePrimary:true,exactCarrierAdapter:true,officialNetworkCapture:true,noPaidApi:true,noTrackJet:true,trackingError:cathay.reason,trackingDebug:cathay.debug,officialTracker:airline?.url||'',shipment:waiting(mawb,airline,cathay.reason)});
  }

  if(prefix==='738'){
    const x=await trackVietnamChamp(mawb);
    if(x.ok)return liveJson({ok:true,configured:true,provider:'Vietnam Airlines CHAMP official Track & Trace',source:x.shipment.source,airlinePrimary:true,exactCarrierAdapter:true,officialNetworkCapture:true,noPaidApi:true,noTrackJet:true,shipment:x.shipment,trackingDebug:x.debug});
    // Keep the generic official reader as a resilience fallback if CHAMP changes markup.
    let fallback=null;
    try{const r=await trackOfficial(mawb);if(r?.ok)fallback=r;}catch{}
    if(fallback?.ok)return liveJson({ok:true,configured:true,provider:'Vietnam Airlines CHAMP official Track & Trace',source:fallback.shipment.source||'Vietnam Airlines CHAMP official Track & Trace',airlinePrimary:true,exactCarrierAdapter:true,officialNetworkCapture:true,noPaidApi:true,noTrackJet:true,shipment:fallback.shipment,trackingDebug:{champ:x.debug,fallback:fallback.debug}});
    return liveJson({ok:true,configured:true,provider:'Vietnam Airlines CHAMP official Track & Trace',source:'Vietnam Airlines CHAMP official Track & Trace',airlinePrimary:true,exactCarrierAdapter:true,officialNetworkCapture:true,noPaidApi:true,noTrackJet:true,trackingError:x.reason,trackingDebug:x.debug,officialTracker:'https://track.champ.aero/vn',shipment:waiting(mawb,x.airline||airline,x.reason)});
  }

  if(prefix==='235'){
    const x=await trackTurkishLive(mawb);
    if(x.ok)return liveJson({ok:true,configured:true,provider:'Turkish Cargo official website',source:x.shipment.source,airlinePrimary:true,exactCarrierAdapter:true,officialNetworkCapture:true,noPaidApi:true,noTrackJet:true,shipment:x.shipment,trackingDebug:x.debug});
    return liveJson({ok:true,configured:true,provider:'Turkish Cargo official website',source:'Turkish Cargo official tracker',airlinePrimary:true,exactCarrierAdapter:true,officialNetworkCapture:true,noPaidApi:true,noTrackJet:true,trackingError:x.reason,trackingDebug:x.debug,officialTracker:x.airline?.url||airline?.url||'',shipment:waiting(mawb,x.airline||airline,x.reason)});
  }

  const exact=prefix==='157'||hasExactOfficialAdapter(prefix);
  const result=prefix==='157'?await trackQatarLiveV2(mawb):hasExactOfficialAdapter(prefix)?await trackExactOfficial(mawb):await trackOfficial(mawb);
  if(result.ok)return liveJson({ok:true,configured:true,provider:`${result.airline.name} official website`,source:`${result.airline.name} official website`,airlinePrimary:true,exactCarrierAdapter:exact,officialNetworkCapture:exact,noPaidApi:true,noTrackJet:true,shipment:result.shipment,trackingDebug:result.debug});
  return liveJson({ok:true,configured:true,provider:'Official airline websites',source:'Official airline tracker',airlinePrimary:true,exactCarrierAdapter:exact,officialNetworkCapture:exact,noPaidApi:true,noTrackJet:true,trackingError:result.reason,trackingDebug:result.debug,officialTracker:result.airline?.url||airline?.url||'',shipment:waiting(mawb,result.airline||airline,result.reason)});
}

export async function GET(request){
  const url=new URL(request.url);const query=url.searchParams.get('mawb');
  if(!query)return Response.json({configured:true,provider:'Official airline websites',apiKeyRequired:false,noPaidApi:true,noTrackJet:true,exactAdapters:['229 Kuwait Airways Cargo','910 Oman Air Cargo','235 Turkish Cargo','160 Cathay Cargo','157 Qatar Airways Cargo','065 Saudia Cargo (SAL full timeline)','176 Emirates SkyCargo','098 Air India Cargo','514 Air Arabia Cargo','738 Vietnam Airlines Cargo (CHAMP)'],mode:'MAWB prefix → exact carrier adapter when mapped → official airline form + official network response'});
  const mawb=normalizeMawb(query);if(!mawb)return Response.json({ok:false,error:'Enter a valid 11-digit MAWB.'},{status:400});return handle(mawb);
}
export async function POST(request){
  let body={};try{body=await request.json()}catch{return Response.json({ok:false,error:'Invalid request body.'},{status:400})}
  const mawb=normalizeMawb(body?.mawb);if(!mawb)return Response.json({ok:false,error:'Enter a valid 11-digit MAWB.'},{status:400});return handle(mawb);
}
