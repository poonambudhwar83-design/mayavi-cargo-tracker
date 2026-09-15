import { airlineForMawb, normalizeMawb } from '../../../lib/airlines.js';
import { trackOfficial } from '../../../lib/official-tracker.js';
import { trackQatarLiveV2 } from '../../../lib/adapters/qatar-live-v2.js';
import { trackTurkishLive } from '../../../lib/adapters/turkish-live.js';
import { trackKuwaitLive } from '../../../lib/adapters/kuwait-live.js';
import { trackOmanLive } from '../../../lib/adapters/oman-live.js';
import { trackSaudiaSal } from '../../../lib/adapters/saudia-sal.js';
import { trackCathayLive } from '../../../lib/adapters/cathay-live.js';
import { hasExactOfficialAdapter, trackExactOfficial } from '../../../lib/adapters/exact-official.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;

function waiting(mawb,airline,reason=''){
  return{mawb,carrierCode:airline?.iata||'',airlineName:airline?.name||'',origin:'',destination:'',bags:'',pieces:'',weight:'',flightNo:'',arrivalDate:'',arrivalTime:'',eta:null,actualArrival:null,status:'CHECKING',officialTracker:airline?.url||'',source:`${airline?.name||'Official airline'} official tracker`,message:reason};
}

async function handle(mawb){
  const airline=airlineForMawb(mawb);
  const prefix=mawb.replace(/\D/g,'').slice(0,3);

  if(prefix==='065'){
    const sal=await trackSaudiaSal(mawb);
    if(sal.ok)return Response.json({ok:true,configured:true,provider:'SAL official shipment tracker',source:sal.shipment.source,airlinePrimary:true,exactCarrierAdapter:true,officialNetworkCapture:true,noPaidApi:true,noTrackJet:true,shipment:sal.shipment,trackingDebug:sal.debug});
    return Response.json({ok:true,configured:true,provider:'SAL official shipment tracker',source:'SAL official shipment tracker',airlinePrimary:true,exactCarrierAdapter:true,officialNetworkCapture:true,noPaidApi:true,noTrackJet:true,trackingError:sal.reason,trackingDebug:sal.debug,officialTracker:'https://sal.sa/trackshipment',shipment:waiting(mawb,sal.airline||airline,sal.reason)});
  }

  if(prefix==='229'){
    const x=await trackKuwaitLive(mawb);
    if(x.ok)return Response.json({ok:true,configured:true,provider:'Kuwait Airways official website',source:x.shipment.source,airlinePrimary:true,exactCarrierAdapter:true,officialNetworkCapture:true,noPaidApi:true,noTrackJet:true,shipment:x.shipment,trackingDebug:x.debug});
    return Response.json({ok:true,configured:true,provider:'Kuwait Airways official website',source:'Kuwait Airways official cargo tracker',airlinePrimary:true,exactCarrierAdapter:true,officialNetworkCapture:true,noPaidApi:true,noTrackJet:true,trackingError:x.reason,trackingDebug:x.debug,officialTracker:x.airline?.url||airline?.url||'',shipment:waiting(mawb,x.airline||airline,x.reason)});
  }

  if(prefix==='910'){
    const x=await trackOmanLive(mawb);
    if(x.ok)return Response.json({ok:true,configured:true,provider:'Oman Air Cargo official website',source:x.shipment.source,airlinePrimary:true,exactCarrierAdapter:true,officialNetworkCapture:true,noPaidApi:true,noTrackJet:true,shipment:x.shipment,trackingDebug:x.debug});
    return Response.json({ok:true,configured:true,provider:'Oman Air Cargo official website',source:'Oman Air Cargo official tracker',airlinePrimary:true,exactCarrierAdapter:true,officialNetworkCapture:true,noPaidApi:true,noTrackJet:true,trackingError:x.reason,trackingDebug:x.debug,officialTracker:x.airline?.url||airline?.url||'',shipment:waiting(mawb,x.airline||airline,x.reason)});
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
    if(fallback.ok)return Response.json({ok:true,configured:true,provider:'Cathay Cargo official website',source:fallback.shipment.source||'Cathay Cargo official website',airlinePrimary:true,exactCarrierAdapter:true,officialNetworkCapture:true,noPaidApi:true,noTrackJet:true,shipment:fallback.shipment,trackingDebug:{cathayTerminal:cathay.reason,fallback:fallback.debug}});
    return Response.json({ok:true,configured:true,provider:'Cathay Cargo official website',source:'Cathay Cargo official tracker',airlinePrimary:true,exactCarrierAdapter:true,officialNetworkCapture:true,noPaidApi:true,noTrackJet:true,trackingError:cathay.reason,trackingDebug:cathay.debug,officialTracker:airline?.url||'',shipment:waiting(mawb,airline,cathay.reason)});
  }

  if(prefix==='235'){
    const x=await trackTurkishLive(mawb);
    if(x.ok)return Response.json({ok:true,configured:true,provider:'Turkish Cargo official website',source:x.shipment.source,airlinePrimary:true,exactCarrierAdapter:true,officialNetworkCapture:true,noPaidApi:true,noTrackJet:true,shipment:x.shipment,trackingDebug:x.debug});
    return Response.json({ok:true,configured:true,provider:'Turkish Cargo official website',source:'Turkish Cargo official tracker',airlinePrimary:true,exactCarrierAdapter:true,officialNetworkCapture:true,noPaidApi:true,noTrackJet:true,trackingError:x.reason,trackingDebug:x.debug,officialTracker:x.airline?.url||airline?.url||'',shipment:waiting(mawb,x.airline||airline,x.reason)});
  }

  const exact=prefix==='157'||hasExactOfficialAdapter(prefix);
  const result=prefix==='157'?await trackQatarLiveV2(mawb):hasExactOfficialAdapter(prefix)?await trackExactOfficial(mawb):await trackOfficial(mawb);
  if(result.ok)return Response.json({ok:true,configured:true,provider:`${result.airline.name} official website`,source:`${result.airline.name} official website`,airlinePrimary:true,exactCarrierAdapter:exact,officialNetworkCapture:exact,noPaidApi:true,noTrackJet:true,shipment:result.shipment,trackingDebug:result.debug});
  return Response.json({ok:true,configured:true,provider:'Official airline websites',source:'Official airline tracker',airlinePrimary:true,exactCarrierAdapter:exact,officialNetworkCapture:exact,noPaidApi:true,noTrackJet:true,trackingError:result.reason,trackingDebug:result.debug,officialTracker:result.airline?.url||airline?.url||'',shipment:waiting(mawb,result.airline||airline,result.reason)});
}

export async function GET(request){
  const url=new URL(request.url);const query=url.searchParams.get('mawb');
  if(!query)return Response.json({configured:true,provider:'Official airline websites',apiKeyRequired:false,noPaidApi:true,noTrackJet:true,exactAdapters:['229 Kuwait Airways Cargo','910 Oman Air Cargo','235 Turkish Cargo','160 Cathay Cargo','157 Qatar Airways Cargo','065 Saudia Cargo (SAL full timeline)','176 Emirates SkyCargo','098 Air India Cargo','514 Air Arabia Cargo'],mode:'MAWB prefix → exact carrier adapter when mapped → official airline form + official network response'});
  const mawb=normalizeMawb(query);if(!mawb)return Response.json({ok:false,error:'Enter a valid 11-digit MAWB.'},{status:400});return handle(mawb);
}
export async function POST(request){
  let body={};try{body=await request.json()}catch{return Response.json({ok:false,error:'Invalid request body.'},{status:400})}
  const mawb=normalizeMawb(body?.mawb);if(!mawb)return Response.json({ok:false,error:'Enter a valid 11-digit MAWB.'},{status:400});return handle(mawb);
}
