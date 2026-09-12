import { normalizeMawb } from './airlines.js';
import { trackWithBrowser } from './browserTracker.js';

const URL='https://www.etihadcargo.com/en/e-services/shipment-tracking';

export async function trackEtihad(input){
  const mawb=normalizeMawb(input);
  if(!mawb||!mawb.startsWith('607-'))return{ok:false,reason:'INVALID ETIHAD MAWB',officialTracker:URL};
  const result=await trackWithBrowser(mawb);
  if(!result?.ok)return{...result,officialTracker:URL,adapter:'Etihad Cargo official shipment-tracking adapter'};
  const shipment={
    ...result.shipment,
    mawb,
    carrierCode:'EY',
    airlineName:'Etihad Cargo',
    officialTracker:URL,
    source:result.shipment?.source||'Etihad Cargo official shipment tracking'
  };
  return{...result,shipment,officialTracker:URL,adapter:'Etihad Cargo official shipment-tracking adapter'};
}
