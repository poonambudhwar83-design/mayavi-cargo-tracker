// Display-only classification: never alter a shipment's verified status
// because the upstream website ran slowly or did not return a response.
export function isJindJepoTimeout(row){
  if(String(row?.branch||'').toUpperCase()!=='JIND')return false;
  const error=String(row?.liveError||row?.jepo_live_error||'');
  return /\b(?:time[\s-]?out|timed[\s-]?out|waiting failed\s*:\s*\d+ms exceeded|navigation timeout|timeout(?:error)?|waiting for selector .* exceeded|exceeded \d+ms)\b/i.test(error);
}
