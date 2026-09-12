import { normalizeMawb } from './airlines.js';
import { trackWithBrowser } from './browserTracker.js';

const URL='https://www.etihadcargo.com/en/track-and-trace';

export async function trackEtihad(input){
  const mawb=normalizeMawb(input);
  if(!mawb||!mawb.startsWith('607-'))return{ok:false,reason:'INVALID ETIHAD MAWB',officialTracker:URL};
  const result=await trackWithBrowser(mawb);
  if(!result?.ok)return{...result,officialTracker:URL,adapter:'Etihad Cargo prepared adapter'};
  const shipment={
    ...result.shipment,
    mawb,
    carrierCode:'EY',
    airlineName:'Etihad Cargo',
    officialTracker:URL,
    source:result.shipment?.source||'Etihad Cargo official Track & Trace'
  };
  return{...result,shipment,officialTracker:URL,adapter:'Etihad Cargo prepared adapter'};
}
