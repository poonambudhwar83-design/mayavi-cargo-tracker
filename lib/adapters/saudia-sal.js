import { normalizeMawb, airlineForMawb } from '../airlines.js';

const OFFICIAL_TRACKER = 'https://sal.sa/trackshipment';

// SAFETY / COMPLIANCE MODE:
// SAL automated access is intentionally disabled.
// This module must not launch a browser, scrape SAL, call SAL APIs,
// poll SAL, retry SAL, or send any background request to SAL.
// Re-enable only if an officially authorized SAL API/integration is approved.

export async function trackSaudiaSal(inputMawb){
  const mawb = normalizeMawb(inputMawb);
  const airline = airlineForMawb(mawb);

  if(!mawb || !mawb.replace(/\D/g,'').startsWith('065')){
    return {
      ok:false,
      reason:'NOT SAUDIA',
      airline,
      officialTracker:OFFICIAL_TRACKER,
      manualOnly:true,
      automationDisabled:true
    };
  }

  return {
    ok:false,
    technical:false,
    reason:'SAL AUTOMATION DISABLED - MANUAL TRACKING ONLY',
    airline,
    officialTracker:OFFICIAL_TRACKER,
    manualOnly:true,
    automationDisabled:true,
    safeMode:true
  };
}
