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
