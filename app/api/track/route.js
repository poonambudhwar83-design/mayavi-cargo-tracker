export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const BASE_URL = 'https://api.shipsgo.com/v2';
const sleep = ms => new Promise(r => setTimeout(r, ms));

function normalizeMawb(value = '') {
  const d = String(value).replace(/\D/g, '');
  return d.length === 11 ? `${d.slice(0,3)}-${d.slice(3)}` : '';
}

function token() {
  return process.env.SHIPSGO_API_TOKEN || process.env.SHIPSGO_TOKEN || '';
}

function safeJson(text = '') {
  try { return JSON.parse(text); } catch { return {}; }
}

async function shipsgo(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 18000);
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      ...options,
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'X-Shipsgo-User-Token': token(),
        ...(options.body ? {'Content-Type':'application/json'} : {}),
        ...(options.headers || {})
      }
    });
    const text = await res.text();
    return {
      ok: res.ok,
      status: res.status,
      data: safeJson(text),
      creditsRemaining: res.headers.get('x-shipsgo-credits-remaining') || '',
      creditsCost: res.headers.get('x-shipsgo-credits-cost') || ''
    };
  } finally {
    clearTimeout(timer);
  }
}

function walk(value, path = '', out = [], depth = 0) {
  if (depth > 8 || value == null) return out;
  if (Array.isArray(value)) {
    value.forEach((v, i) => walk(v, `${path}[${i}]`, out, depth + 1));
    return out;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) walk(v, path ? `${path}.${k}` : k, out, depth + 1);
    return out;
  }
  out.push({path, value});
  return out;
}

function findShipmentId(data, mawb) {
  const target = normalizeMawb(mawb);
  let found = null;
  function visit(v) {
    if (found || v == null) return;
    if (Array.isArray(v)) return v.forEach(visit);
    if (typeof v !== 'object') return;
    const awb = normalizeMawb(v.awb_number || v.awb || '');
    if (awb === target && Number.isFinite(Number(v.id))) {
      found = Number(v.id);
      return;
    }
    for (const child of Object.values(v)) visit(child);
  }
  visit(data);
  return found;
}

async function locateShipment(mawb, debug) {
  debug.stage = 'SHIPSGO_FIND';
  const params = new URLSearchParams();
  params.set('filters[awb_number]', `eq:${mawb}`);
  params.set('take', '10');
  const list = await shipsgo(`/air/shipments?${params.toString()}`);

  if (list.status === 401 || list.status === 403) {
    return {error:'ShipsGo rejected the API token or API access is not activated for this account.', code:'SHIPSGO_AUTH'};
  }
  if (list.ok) {
    const exact = (list.data?.shipments || []).find(x => normalizeMawb(x?.awb_number) === mawb);
    if (exact?.id) {
      debug.shipmentCreated = false;
      return {id:Number(exact.id)};
    }
  }

  debug.stage = 'SHIPSGO_CREATE';
  const created = await shipsgo('/air/shipments', {
    method:'POST',
    body:JSON.stringify({awb_number:mawb})
  });
  debug.creditsRemaining = created.creditsRemaining;
  debug.creditsCost = created.creditsCost;

  if (created.ok) {
    const id = Number(created.data?.shipment?.id || findShipmentId(created.data, mawb));
    if (id) {
      debug.shipmentCreated = true;
      return {id};
    }
  }

  if (created.status === 409) {
    const id = Number(created.data?.shipment?.id || findShipmentId(created.data, mawb));
    if (id) {
      debug.shipmentCreated = false;
      return {id};
    }
    const retry = await shipsgo(`/air/shipments?${params.toString()}`);
    const exact = (retry.data?.shipments || []).find(x => normalizeMawb(x?.awb_number) === mawb);
    if (exact?.id) {
      debug.shipmentCreated = false;
      return {id:Number(exact.id)};
    }
  }

  if (created.status === 401 || created.status === 403) {
    return {error:'ShipsGo rejected the API token or API access is not activated for this account.', code:'SHIPSGO_AUTH'};
  }
  if (created.status === 402) {
    return {error:'ShipsGo API access or tracking credits are not active for this account.', code:'SHIPSGO_PAYMENT'};
  }
  if (created.status === 429) {
    return {error:'ShipsGo rate limit is busy. Please retry shortly.', code:'SHIPSGO_RATE_LIMIT'};
  }

  const msg = created.data?.message || created.data?.error || created.data?.detail || `ShipsGo returned HTTP ${created.status}`;
  return {error:String(msg), code:'SHIPSGO_CREATE_FAILED'};
}

function firstIata(node) {
  return String(node?.location?.iata || node?.iata || '').toUpperCase();
}

function dateParts(raw = '') {
  const s = String(raw || '').trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})/);
  return m ? {date:`${m[1]}-${m[2]}-${m[3]}`, time:`${m[4]}:${m[5]}`} : {date:'',time:''};
}

function looksDate(v) {
  return typeof v === 'string' && /\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}/.test(v);
}

function pickArrival(shipment) {
  const flat = walk(shipment);
  const status = String(shipment?.status || '').toUpperCase();
  const finished = /LANDED|ARRIVED|DELIVERED|RCF|COMPLETED/.test(status);
  const candidates = [];

  for (const item of flat) {
    if (!looksDate(item.value)) continue;
    const p = item.path.toLowerCase();
    let score = 0;
    let actual = false;

    if (/actual.*arr|arrived_at|arrival_actual/.test(p)) { score = 120; actual = true; }
    else if (/eta|estimated.*arr|expected.*arr/.test(p)) score = 110;
    else if (/planned.*arr|scheduled.*arr/.test(p)) score = 100;
    else if (/date_of_arr|arrival.*date|arr.*time/.test(p)) { score = 90; actual = finished; }
    else if (/date_of_rcf/.test(p)) { score = finished ? 65 : 20; actual = finished; }
    else continue;

    if (/origin|departure|date_of_dep/.test(p)) score -= 120;
    if (/destination/.test(p)) score += 10;
    if (/movements/.test(p)) score += 8;
    candidates.push({value:item.value, path:item.path, score, actual});
  }

  candidates.sort((a,b) => b.score - a.score);
  return candidates[0] || null;
}

function pickFlight(shipment) {
  const values = walk(shipment).filter(x => {
    const p = x.path.toLowerCase();
    return /flight(_)?(no|number)|flight\.number|flight_number/.test(p);
  });
  for (let i = values.length - 1; i >= 0; i--) {
    const v = String(values[i].value || '').trim().toUpperCase();
    const m = v.match(/\b([A-Z0-9]{2,3})[-\s]?(\d{2,4})\b/);
    if (m) return `${m[1]}${m[2]}`;
  }
  return '';
}

function normalizeStatus(value = '') {
  const s = String(value || '').toUpperCase().replace(/\s+/g, '_');
  if (/DELIVER/.test(s)) return 'DELIVERED';
  if (/LANDED|ARRIVED|RCF|COMPLETED/.test(s)) return 'ARRIVED';
  if (/DELAY|EXCEPTION/.test(s)) return 'DELAYED';
  if (/EN_ROUTE|ENROUTE|IN_TRANSIT|DEPART|INPROGRESS|IN_PROGRESS/.test(s)) return 'IN TRANSIT';
  if (/BOOK|RECEIVED|RCS|MANIFEST/.test(s)) return 'RECEIVED';
  return s.replace(/_/g,' ') || 'TRACKING';
}

function mapShipment(raw, mawb) {
  const route = raw?.route || {};
  const arrival = pickArrival(raw);
  const parts = dateParts(arrival?.value || '');
  const airline = raw?.airline || {};
  const cargo = raw?.cargo || {};
  const status = normalizeStatus(raw?.status || raw?.status_extended?.status || '');
  const actual = Boolean(arrival?.actual || /ARRIVED|DELIVERED/.test(status));

  return {
    mawb,
    shipsgoShipmentId: raw?.id || null,
    carrierCode: String(airline?.iata || '').toUpperCase(),
    airlineName: airline?.name || '',
    origin: firstIata(route?.origin),
    destination: firstIata(route?.destination),
    bags: cargo?.pieces ?? '',
    pieces: cargo?.pieces ?? '',
    weight: cargo?.weight ?? '',
    volume: cargo?.volume ?? '',
    flightNo: pickFlight(raw),
    arrivalDate: parts.date,
    arrivalTime: parts.time,
    eta: !actual && arrival?.value ? arrival.value : null,
    actualArrival: actual && arrival?.value ? arrival.value : null,
    arrivalIsActual: actual,
    status,
    transshipments: route?.ts_count ?? '',
    transitTime: route?.transit_time ?? '',
    updatedAt: raw?.updated_at || raw?.checked_at || '',
    source:'ShipsGo Air API'
  };
}

function waiting(mawb, message = '') {
  return {
    mawb, carrierCode:'', airlineName:'', origin:'', destination:'', bags:'', pieces:'', weight:'', volume:'', flightNo:'',
    arrivalDate:'', arrivalTime:'', eta:null, actualArrival:null, arrivalIsActual:false,
    status:'CHECKING', source:'ShipsGo Air API', message
  };
}

async function track(mawb) {
  const debug = {stage:'START', provider:'ShipsGo Air API'};
  try {
    if (!token()) {
      return {ok:false, error:'SHIPSGO_API_TOKEN is not configured in Vercel.', debug:{...debug, stage:'SHIPSGO_NOT_CONFIGURED'}};
    }

    const located = await locateShipment(mawb, debug);
    if (located.error) {
      return {ok:false, error:located.error, debug:{...debug, stage:located.code || 'SHIPSGO_LOCATE_FAILED'}};
    }

    debug.shipmentId = located.id;
    debug.stage = 'SHIPSGO_DETAILS';
    let detail = await shipsgo(`/air/shipments/${located.id}`);

    if (!detail.ok) {
      const msg = detail.data?.message || detail.data?.error || `ShipsGo returned HTTP ${detail.status}`;
      return {ok:false, error:String(msg), debug:{...debug, stage:'SHIPSGO_DETAILS_FAILED', httpStatus:detail.status}};
    }

    let raw = detail.data?.shipment || {};
    let mapped = mapShipment(raw, mawb);

    if (debug.shipmentCreated && !mapped.origin && !mapped.arrivalDate && !mapped.flightNo && !mapped.pieces) {
      await sleep(2500);
      detail = await shipsgo(`/air/shipments/${located.id}`);
      if (detail.ok) {
        raw = detail.data?.shipment || raw;
        mapped = mapShipment(raw, mawb);
      }
    }

    debug.stage = 'SUCCESS';
    debug.shipsgoStatus = raw?.status || '';
    debug.checkedAt = raw?.checked_at || '';
    return {ok:true, shipment:mapped, debug};
  } catch (e) {
    const message = e?.name === 'AbortError' ? 'ShipsGo request timed out.' : (e?.message || String(e));
    return {ok:false, error:message, debug:{...debug, stage:'SHIPSGO_ERROR'}};
  }
}

async function handle(mawb) {
  const r = await track(mawb);
  if (r.ok) {
    return Response.json({
      ok:true,
      configured:true,
      provider:'ShipsGo Air API',
      source:'ShipsGo Air API',
      airlinePrimary:true,
      shipment:r.shipment,
      trackingDebug:r.debug
    });
  }
  return Response.json({
    ok:true,
    configured:Boolean(token()),
    provider:'ShipsGo Air API',
    source:'ShipsGo Air API diagnostic',
    airlinePrimary:true,
    trackingError:r.error,
    trackingDebug:r.debug,
    shipment:waiting(mawb, r.error)
  });
}

export async function GET(request) {
  const url = new URL(request.url);
  const q = url.searchParams.get('mawb');
  if (!q) {
    return Response.json({
      configured:Boolean(token()),
      provider:'ShipsGo Air API',
      apiKeyRequired:true,
      envVar:'SHIPSGO_API_TOKEN',
      mode:'MAWB → ShipsGo create/find shipment → ShipsGo details → Mayavi'
    });
  }
  const mawb = normalizeMawb(q);
  if (!mawb) return Response.json({ok:false,error:'Enter a valid 11-digit MAWB.'},{status:400});
  return handle(mawb);
}

export async function POST(request) {
  let body = {};
  try { body = await request.json(); } catch { return Response.json({ok:false,error:'Invalid request body.'},{status:400}); }
  const mawb = normalizeMawb(body?.mawb);
  if (!mawb) return Response.json({ok:false,error:'Enter a valid 11-digit MAWB.'},{status:400});
  return handle(mawb);
}
