import { normalizeMawb } from './airlines.js';

const OFFICIAL='https://www.qrcargo.com/s/track-your-shipment';
const AIRLINE={name:'Qatar Airways Cargo',iata:'QR',url:OFFICIAL};

function officialUrl(mawb=''){
  const serial=String(mawb).slice(4);
  return `${OFFICIAL}?documentNumber=${encodeURIComponent(serial)}&documentPrefix=157&documentType=MAWB`;
}

export async function trackQatar(input){
  const mawb=normalizeMawb(input);
  if(!mawb||!mawb.startsWith('157-')){
    return {ok:false,reason:'INVALID QATAR AIRWAYS CARGO MAWB',airline:AIRLINE,officialTracker:OFFICIAL};
  }
  const direct=officialUrl(mawb);
  return {
    ok:false,
    reason:'QATAR AUTO TRACKING UNAVAILABLE — USE QATAR OFFICIAL TRACK',
    airline:AIRLINE,
    officialTracker:direct,
    manualHint:`Qatar page will be opened with prefix 157 and serial ${mawb.slice(4)} passed in the URL. If Qatar does not prefill it, paste ${mawb.slice(4)} manually.`,
    debug:{stage:'MANUAL_OFFICIAL',source:'qatar-official-salesforce',officialTracker:direct}
  };
}
