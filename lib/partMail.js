// The physical part, not its screen position, owns its independent Mail YES/NO.
export function partIdentity(part = {}, index = 0) {
  const explicit = String(part?.partKey || part?.partId || '').trim();
  if (explicit) return explicit;
  const pieces = String(part?.pieces ?? '').trim();
  const weight = String(part?.weight ?? '').replace(/,/g, '').trim();
  const fallback = [
    String(part?.flightNo || '').trim().toUpperCase(),
    String(part?.flightDate || part?.departureDate || '').trim(),
    pieces,
    weight
  ].join('|');
  return fallback === '|||' ? `P${index + 1}` : fallback;
}

export function mergePartMail(tracked = [], saved = []) {
  if (!Array.isArray(tracked)) return tracked;
  if (!Array.isArray(saved) || !saved.length) return tracked;
  const byIdentity = new Map(saved.map((part, index) => [partIdentity(part, index), part]));
  return tracked.map((part, index) => {
    // A new flight/part gets its own NO. Never copy YES from an earlier flight.
    const old = byIdentity.get(partIdentity(part, index));
    return old && Object.prototype.hasOwnProperty.call(old, 'mailSent')
      ? { ...part, mailSent: old.mailSent === true, mailUpdatedAt: old.mailUpdatedAt || '' }
      : part;
  });
}

/**
 * Emirates 176: clearance belongs to the actual physical part, not to the
 * master MAWB. Preserve operator decisions when airline tracking rebuilds rows.
 * Never carry a clearance choice to a new part ID or another airline.
 */
export function mergePartCustoms(tracked = [], saved = []) {
  if(!Array.isArray(tracked))return tracked;
  if(!Array.isArray(saved)||!saved.length)return tracked;
  const byId=new Map(saved.map((p,i)=>[partIdentity(p,i),p]));
  return tracked.map((p,i)=>{
    const previous=byId.get(partIdentity(p,i));
    if(!previous||!Object.prototype.hasOwnProperty.call(previous,'customsCleared'))return p;
    return {...p,
      customsCleared:previous.customsCleared===true,
      customsClearedAt:previous.customsClearedAt||'',
      customsClearedBy:previous.customsClearedBy||''
    };
  });
}

// Backward compatible name for existing Emirates callers.
export const mergeEmiratesPartCustoms = mergePartCustoms;
