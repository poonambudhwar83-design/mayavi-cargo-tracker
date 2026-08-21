const BASE = 'https://api.aerodatabox.com';

function firstFlight(data) {
  if (!Array.isArray(data) || !data.length) return null;
  const now = Date.now();
  const scored = data.map(f => {
    const v = f?.arrival?.revisedTime?.utc || f?.arrival?.revisedTime?.local || f?.arrival?.scheduledTime?.utc || f?.arrival?.scheduledTime?.local;
    const t = v ? new Date(v).getTime() : NaN;
    return { f, score: Number.isNaN(t) ? Number.MAX_SAFE_INTEGER : Math.abs(t - now) };
  }).sort((a,b)=>a.score-b.score);
  return scored[0]?.f || data[0];
}

function pickTime(movement = {}) {
  return movement?.revisedTime?.local || movement?.revisedTime?.utc || movement?.predictedTime?.local || movement?.predictedTime?.utc || movement?.scheduledTime?.local || movement?.scheduledTime?.utc || movement?.runwayTime?.local || movement?.runwayTime?.utc || null;
}

export async function fetchFlightEta(flightNo='') {
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
    const f = firstFlight(data);
    if (!f) return null;
    return {
      source: 'AeroDataBox live flight',
      flightNo: f?.number || clean,
      origin: f?.departure?.airport?.iata || f?.departure?.airport?.icao || '',
      destination: f?.arrival?.airport?.iata || f?.arrival?.airport?.icao || '',
      eta: pickTime(f.arrival || {}),
      departureTime: pickTime(f.departure || {}),
      status: f?.status || ''
    };
  } catch {
    return null;
  }
}
