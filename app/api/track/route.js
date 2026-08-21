export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const API_BASE = 'https://api.aircargomcp.com/track';

function normalizeMawb(value = '') {
  const digits = String(value).replace(/\D/g, '');
  if (digits.length !== 11) return '';
  return `${digits.slice(0, 3)}-${digits.slice(3)}`;
}

function latestFlightFromRoutes(routes = []) {
  if (!Array.isArray(routes)) return '';
  const withFlight = routes.filter(r => r?.flight_number);
  if (!withFlight.length) return '';
  const active = withFlight.find(r => !/ARRIVED|DELIVERED|COMPLETED/i.test(String(r?.status || '')));
  return String((active || withFlight[withFlight.length - 1])?.flight_number || '').trim();
}

function normalizeStatus(value = '') {
  const s = String(value || '').trim();
  if (!s) return 'TRACKING';
  const upper = s.toUpperCase().replace(/[ -]+/g, '_');
  if (upper === 'DELIVERED') return 'DELIVERED';
  if (upper === 'ARRIVED') return 'ARRIVED';
  if (upper === 'IN_TRANSIT' || upper === 'TRANSIT') return 'IN_TRANSIT';
  if (upper === 'DELAYED' || upper === 'LATE') return 'DELAYED';
  return upper;
}

function shipmentFromAirCargoMcp(data, mawb) {
  const actualArrival = data?.arrival?.actual || (data?.eta_is_actual ? data?.eta : null) || null;
  const eta = data?.eta || data?.arrival?.estimated || null;
  const flightNo = data?.flight_number || latestFlightFromRoutes(data?.routes) || '';

  return {
    mawb: data?.awb || mawb,
    carrierCode: data?.airline_iata || '',
    airlineName: data?.airline_name || '',
    origin: data?.origin || '',
    originName: data?.origin_name || '',
    destination: data?.destination || '',
    destinationName: data?.destination_name || '',
    destinationTimezone: data?.destination_location?.timezone || '',
    bags: data?.pieces ?? '',
    pieces: data?.pieces ?? '',
    weight: data?.weight_kg ?? '',
    weightKg: data?.weight_kg ?? '',
    flightNo,
    eta,
    actualArrival,
    etaIsActual: Boolean(data?.eta_is_actual),
    departureEstimated: data?.departure?.estimated || null,
    departureActual: data?.departure?.actual || null,
    arrivalEstimated: data?.arrival?.estimated || null,
    arrivalActual: data?.arrival?.actual || null,
    status: normalizeStatus(data?.status),
    events: Array.isArray(data?.events) ? data.events : [],
    routes: Array.isArray(data?.routes) ? data.routes : [],
    providerUpdatedAt: data?.metadata?.updated_at || null,
    fromCache: Boolean(data?.metadata?.from_cache),
    cacheExpires: data?.metadata?.cache_expires || null,
    source: 'AirCargoMCP API'
  };
}

export async function GET() {
  return Response.json({
    configured: Boolean(process.env.AIRCARGO_MCP_API_KEY),
    provider: 'AirCargoMCP',
    endpoint: 'https://api.aircargomcp.com/track/{MAWB}'
  });
}

export async function POST(request) {
  let body = {};
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: 'Invalid request body.' }, { status: 400 });
  }

  const mawb = normalizeMawb(body?.mawb);
  if (!mawb) {
    return Response.json({ ok: false, error: 'Enter a valid 11-digit MAWB.' }, { status: 400 });
  }

  const apiKey = process.env.AIRCARGO_MCP_API_KEY;
  if (!apiKey) {
    return Response.json({
      ok: false,
      provider: 'AirCargoMCP',
      code: 'AIRCARGO_MCP_KEY_MISSING',
      error: 'AirCargoMCP is connected in the code, but AIRCARGO_MCP_API_KEY is not set in Vercel yet.'
    }, { status: 503 });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);

  try {
    const response = await fetch(`${API_BASE}/${encodeURIComponent(mawb)}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json'
      },
      cache: 'no-store',
      signal: controller.signal
    });

    let payload = null;
    try { payload = await response.json(); } catch {}

    if (!response.ok) {
      const providerMessage = payload?.error?.message || payload?.message || payload?.error || '';
      const code = response.status === 401 || response.status === 403
        ? 'AIRCARGO_MCP_AUTH_FAILED'
        : response.status === 429
          ? 'AIRCARGO_MCP_RATE_LIMIT'
          : response.status === 404
            ? 'AIRCARGO_MCP_NOT_FOUND'
            : 'AIRCARGO_MCP_ERROR';
      return Response.json({
        ok: false,
        provider: 'AirCargoMCP',
        code,
        error: providerMessage || `AirCargoMCP returned HTTP ${response.status}.`,
        httpStatus: response.status
      }, { status: response.status });
    }

    const data = payload?.data || payload;
    if (!data || typeof data !== 'object') {
      return Response.json({
        ok: false,
        provider: 'AirCargoMCP',
        code: 'AIRCARGO_MCP_EMPTY_RESPONSE',
        error: 'AirCargoMCP returned no shipment data.'
      }, { status: 502 });
    }

    const shipment = shipmentFromAirCargoMcp(data, mawb);
    return Response.json({
      ok: true,
      provider: 'AirCargoMCP',
      source: 'AirCargoMCP API',
      airlinePrimary: true,
      shipment,
      providerMeta: {
        statusCode: data?.metadata?.status_code || null,
        updatedAt: data?.metadata?.updated_at || null,
        fromCache: Boolean(data?.metadata?.from_cache),
        cacheExpires: data?.metadata?.cache_expires || null
      }
    });
  } catch (error) {
    const aborted = error?.name === 'AbortError';
    return Response.json({
      ok: false,
      provider: 'AirCargoMCP',
      code: aborted ? 'AIRCARGO_MCP_TIMEOUT' : 'AIRCARGO_MCP_NETWORK_ERROR',
      error: aborted ? 'AirCargoMCP request timed out after 20 seconds.' : (error?.message || 'AirCargoMCP request failed.')
    }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}
