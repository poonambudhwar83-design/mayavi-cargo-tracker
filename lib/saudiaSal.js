import { normalizeMawb } from './airlines.js';

const OFFICIAL_TRACKER = 'https://sal.sa/trackshipment';

// SAL automated access has been removed from Mayavi.
// This stub intentionally performs no browser launch, API call, fetch, or request.
// Reintroduce integration only through a SAL-authorized API or written approval.
export async function trackSaudiaViaSal(input){
  const mawb = normalizeMawb(input);
  if(!mawb || !mawb.startsWith('065-')){
    return { ok:false, reason:'INVALID SAUDIA MAWB', officialTracker:OFFICIAL_TRACKER };
  }
  return {
    ok:false,
    reason:'SAL AUTOMATION REMOVED - USE OFFICIAL TRACKER / AUTHORIZED API',
    officialTracker:OFFICIAL_TRACKER,
    safeMode:true
  };
}
