const BASE = 'https://api.aerodatabox.com';

function movementTime(movement = {}) {
  return movement?.actualTime?.local || movement?.actualTime?.utc ||
    movement?.runwayTime?.local || movement?.runwayTime?.utc ||
    movement?.revisedTime?.local || movement?.revisedTime?.utc ||
    movement?.predictedTime?.local || movement?.predictedTime?.utc ||
    movement?.scheduledTime?.local || movement?.scheduledTime?.utc || null;
}

function actualMovementTime(movement = {}) {
  return movement?.actualTime?.local || movement?.actualTime?.utc ||
    movement?.runwayTime?.local || movement?.runwayTime?.utc || null;
}

function firstFlight(data, options = {}) {
  if (!Array.isArray(data) || !data.length) return null;
  const targetDate = String(options?.date || '').slice(0, 10);
  const origin = String(options?.origin || '').toUpperCase();
  const destination = String(options?.destination || '').toUpperCase();
  const now = Date.now();
  const targetMs = targetDate ? Date.parse(`${targetDate}T12:00:00Z`) : now;

  const scored = data.map(f => {
    const depCode = String(f?.departure?.airport?.iata || f?.departure?.airport?.icao || '').toUpperCase();
    const arrCode = String(f?.arrival?.airport?.iata || f?.arrival?.airport?.icao || '').toUpperCase();
    const v = movementTime(f?.departure || {}) || movementTime(f?.arrival || {});
    const t = v ? new Date(v).getTime() : NaN;
    const localDate = String(v || '').slice(0, 10);

    let score = Number.isNaN(t) ? Number.MAX_SAFE_INTEGER / 4 : Math.abs(t - targetMs);
    if (targetDate && localDate === targetDate) score -= 7 * 24 * 3600000;
    if (origin && depCode && depCode !== origin) score += 30 * 24 * 3600000;
    if (destination && arrCode && arrCode !== destination) score += 30 * 24 * 3600000;
    return { f, score };
  }).sort((a,b)=>a.score-b.score);
  return scored[0]?.f || data[0];
}

function pickTime(movement = {}) {
  return movementTime(movement);
}

export async function fetchFlightEta(flightNo='', options={}) {
  const apiKey = process.env.AERODATABOX_API_KEY;
  const clean = String(flightNo).replace(/[^A-Za-z0-9]/g,'').toUpperCase();
  if (!apiKey || !clean) return null;
  try {
    const r = await fetch(`${BASE}/flights/number/${encodeURIComponent(clean)}`, {
      headers: { 'X-Api-Key': apiKey, Accept: 'application/json' },
      cache: 'no-store'
    });
    if (!r.ok) return null;
    const data = await r.json();
    const f = firstFlight(data, options);
    if (!f) return null;
    return {
      source: 'AeroDataBox live flight',
      flightNo: f?.number || clean,
      origin: f?.departure?.airport?.iata || f?.departure?.airport?.icao || '',
      destination: f?.arrival?.airport?.iata || f?.arrival?.airport?.icao || '',
      eta: pickTime(f.arrival || {}),
      actualArrival: actualMovementTime(f.arrival || {}),
      departureTime: pickTime(f.departure || {}),
      actualDeparture: actualMovementTime(f.departure || {}),
      status: f?.status || ''
    };
  } catch {
    return null;
  }
}
