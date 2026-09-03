import { normalizeMawb } from './airlines.js';

const OFFICIAL='https://www.qrcargo.com/s/track-your-shipment';
const AIRLINE={name:'Qatar Airways Cargo',iata:'QR',url:OFFICIAL};

export async function trackQatar(input){
  const mawb=normalizeMawb(input);
  if(!mawb||!mawb.startsWith('157-')){
    return {ok:false,reason:'INVALID QATAR AIRWAYS CARGO MAWB',airline:AIRLINE,officialTracker:OFFICIAL};
  }

  // Qatar's public tracking UI is Salesforce/JavaScript based and applies a security check,
  // so a server-side fetch cannot reliably submit/prefill the AWB without the user's browser.
  // Return a deterministic official fallback instead of a generic API-key error.
  return {
    ok:false,
    reason:'QATAR AUTO TRACKING UNAVAILABLE — USE QATAR OFFICIAL TRACK',
    airline:AIRLINE,
    officialTracker:OFFICIAL,
    manualHint:`Open Qatar Cargo and enter AWB ${mawb} (or serial ${mawb.slice(4)}).`,
    debug:{stage:'MANUAL_OFFICIAL',source:'qatar-official-salesforce',officialTracker:OFFICIAL}
  };
}
