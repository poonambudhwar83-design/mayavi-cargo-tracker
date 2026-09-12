import { normalizeMawb } from './airlines.js';
import { trackWithBrowser } from './browserTracker.js';

const URL='https://cargo.ethiopianairlines.com/my-cargo/track-your-shipment';

export async function trackEthiopian(input){
  const mawb=normalizeMawb(input);
  if(!mawb||!mawb.startsWith('071-'))return{ok:false,reason:'INVALID ETHIOPIAN MAWB',officialTracker:URL};
  const result=await trackWithBrowser(mawb);
  if(!result?.ok)return{...result,officialTracker:URL,adapter:'Ethiopian Cargo prepared adapter'};
  const shipment={
    ...result.shipment,
    mawb,
    carrierCode:'ET',
    airlineName:'Ethiopian Cargo',
    officialTracker:URL,
    source:result.shipment?.source||'Ethiopian Cargo official Track Your Shipment'
  };
  return{...result,shipment,officialTracker:URL,adapter:'Ethiopian Cargo prepared adapter'};
}
