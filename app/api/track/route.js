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

async function locateOrCreate(mawb, debug) {
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

function localDateParts(raw = '') {
  const s = String(raw || '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{1,2}):(\d{2})/);
  if (m) return {date:`${m[1]}-${m[2]}-${m[3]}`, time:`${String(m[4]).padStart(2,'0')}:${m[5]}`};
  m = s.match(/^(\d{1,2})[-\/]([A-Za-z]{3})[-\/](\d{2,4})[ T](\d{1,2}):(\d{2})/);
  if (m) {
    const months={jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'};
    let y=String(m[3]); if(y.length===2)y=`20${y}`;
    const mo=months[m[2].toLowerCase()];
    if(mo)return{date:`${y}-${mo}-${String(m[1]).padStart(2,'0')}`,time:`${String(m[4]).padStart(2,'0')}:${m[5]}`};
  }
  return {date:'',time:''};
}

function looksDate(v) {
  return typeof v === 'string' && (/\d{4}-\d{2}-\d{2}[T\s]\d{1,2}:\d{2}/.test(v) || /\d{1,2}[-\/][A-Za-z]{3}[-\/]\d{2,4}[ T]\d{1,2}:\d{2}/.test(v));
}

function objectNodes(value, out = [], depth = 0) {
  if (depth > 8 || value == null) return out;
  if (Array.isArray(value)) {
    value.forEach(v => objectNodes(v, out, depth + 1));
    return out;
  }
  if (typeof value === 'object') {
    out.push(value);
    Object.values(value).forEach(v => objectNodes(v, out, depth + 1));
  }
  return out;
}

function valueByRegex(obj, re) {
  if (!obj || typeof obj !== 'object') return '';
  for (const [k,v] of Object.entries(obj)) {
    if (re.test(k) && looksDate(v)) return v;
  }
  return '';
}

function nodeText(obj) {
  if (!obj || typeof obj !== 'object') return '';
  return Object.entries(obj)
    .filter(([,v]) => typeof v === 'string' || typeof v === 'number')
    .map(([k,v]) => `${k}:${v}`)
    .join(' ');
}

function nodeIata(obj) {
  const nodes = objectNodes(obj, [], 0).slice(0,12);
  for (const n of nodes) {
    const v = n?.location?.iata || n?.iata || n?.airport_code || n?.airport || '';
    const s = String(v).toUpperCase();
    if (/^[A-Z]{3}$/.test(s)) return s;
  }
  return '';
}

function eventArrivalFromMovements(raw, destination, status) {
  const finished = /LANDED|ARRIVED|DELIVERED|COMPLETED/.test(String(status).toUpperCase());
  const nodes = objectNodes(raw?.movements || [], []);
  const candidates = [];

  for (const n of nodes) {
    const txt = nodeText(n);
    const isArr = /(?:^|\b)(ARR)(?:\b|$)|arrival|arrived/i.test(txt);
    const isRcf = /(?:^|\b)RCF(?:\b|$)|received from flight/i.test(txt);
    if (!isArr || isRcf) continue;

    const actual = valueByRegex(n, /actual.*(?:date|time)|(?:date|time).*actual|actual_at|actual$/i);
    const estimated = valueByRegex(n, /estimated|estimate|eta|expected/i);
    const scheduled = valueByRegex(n, /scheduled|planned/i);
    const generic = valueByRegex(n, /date|time|occurred|event_at|timestamp/i);
    const value = actual || estimated || scheduled || generic;
    if (!value) continue;

    const kind = actual ? 'actual' : estimated ? 'estimated' : scheduled ? 'scheduled' : 'event';
    const iata = nodeIata(n);
    let score = 100;
    if (destination && iata === destination) score += 180;
    if (finished && kind === 'actual') score += 120;
    if (!finished && kind === 'estimated') score += 110;
    if (!finished && kind === 'scheduled') score += 80;
    if (iata && destination && iata !== destination) score -= 120;
    candidates.push({value, kind, iata, score});
  }

  candidates.sort((a,b) => b.score - a.score);
  return candidates[0] || null;
}

function genericArrival(raw, destination, status) {
  const finished = /LANDED|ARRIVED|DELIVERED|COMPLETED/.test(String(status).toUpperCase());
  const candidates = [];

  function walk(v, path = '', parent = null, depth = 0) {
    if (depth > 9 || v == null) return;
    if (Array.isArray(v)) return v.forEach((x,i) => walk(x, `${path}[${i}]`, v, depth + 1));
    if (typeof v === 'object') {
      for (const [k,x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k, v, depth + 1);
      return;
    }
    if (!looksDate(v)) return;
    const p = path.toLowerCase();
    if (/rcf|received_from_flight|date_of_dep|departure|created_at|updated_at|checked_at/.test(p)) return;
    if (!/arr|eta|expected|scheduled.*arrival|planned.*arrival/.test(p)) return;

    let score = 60;
    let kind = 'event';
    if (/actual.*arr|arr.*actual/.test(p)) {score += 100; kind='actual';}
    else if (/eta|estimated|expected/.test(p)) {score += 90; kind='estimated';}
    else if (/scheduled|planned/.test(p)) {score += 70; kind='scheduled';}
    const iata = nodeIata(parent || {});
    if (destination && iata === destination) score += 140;
    if (finished && kind === 'actual') score += 80;
    if (!finished && kind === 'estimated') score += 70;
    candidates.push({value:v, kind, iata, score});
  }

  walk(raw);
  candidates.sort((a,b) => b.score - a.score);
  return candidates[0] || null;
}

function pickFlight(raw, destination) {
  const nodes = objectNodes(raw?.movements || [], []);
  const found = [];
  for (const n of nodes) {
    const iata = nodeIata(n);
    for (const [k,v] of Object.entries(n || {})) {
      if (!/flight.*(?:no|number)|flight_no|flight_number/i.test(k)) continue;
      const m = String(v || '').toUpperCase().match(/\b([A-Z0-9]{2,3})[-\s]?(\d{2,4})\b/);
      if (m) found.push({flight:`${m[1]}${m[2]}`, score:destination && iata===destination?100:0});
    }
  }
  found.sort((a,b)=>b.score-a.score);
  if(found.length)return found[0].flight;

  let fallback='';
  function walk(v, key=''){
    if(v==null)return;
    if(Array.isArray(v))return v.forEach(x=>walk(x,key));
    if(typeof v==='object')return Object.entries(v).forEach(([k,x])=>walk(x,k));
    if(!/flight.*(?:no|number)|flight_no|flight_number/i.test(key))return;
    const m=String(v).toUpperCase().match(/\b([A-Z0-9]{2,3})[-\s]?(\d{2,4})\b/);if(m)fallback=`${m[1]}${m[2]}`;
  }
  walk(raw);
  return fallback;
}

function normalizeStatus(value = '') {
  const s = String(value || '').toUpperCase().replace(/\s+/g, '_');
  if (s === 'NEW') return 'REGISTERED';
  if (/INPROGRESS|IN_PROGRESS/.test(s)) return 'WAITING FOR CARRIER DATA';
  if (/DELIVER/.test(s)) return 'DELIVERED';
  if (/LANDED|ARRIVED|COMPLETED/.test(s)) return 'ARRIVED';
  if (/DELAY|EXCEPTION/.test(s)) return 'DELAYED';
  if (/EN_ROUTE|ENROUTE|IN_TRANSIT|DEPART/.test(s)) return 'IN TRANSIT';
  if (/BOOK|RECEIVED|RCS|MANIFEST/.test(s)) return 'RECEIVED';
  return s.replace(/_/g,' ') || 'TRACKING';
}

function mapShipment(raw, mawb) {
  const route = raw?.route || {};
  const airline = raw?.airline || {};
  const cargo = raw?.cargo || {};
  const destination = firstIata(route?.destination);
  const sourceStatus = raw?.status || raw?.status_extended?.status || '';
  const status = normalizeStatus(sourceStatus);

  // Prefer true flight ARR events. Do NOT use RCF as flight arrival; RCF is cargo received from flight.
  const arrival = eventArrivalFromMovements(raw, destination, sourceStatus) || genericArrival(raw, destination, sourceStatus);
  const parts = localDateParts(arrival?.value || '');
  const actual = arrival?.kind === 'actual' || (/ARRIVED|DELIVERED/.test(status) && Boolean(arrival?.value));

  return {
    mawb,
    shipsgoShipmentId: raw?.id || null,
    carrierCode: String(airline?.iata || '').toUpperCase(),
    airlineName: airline?.name || '',
    origin: firstIata(route?.origin),
    destination,
    bags: cargo?.pieces ?? '',
    pieces: cargo?.pieces ?? '',
    weight: cargo?.weight ?? '',
    volume: cargo?.volume ?? '',
    flightNo: pickFlight(raw, destination),
    arrivalDate: parts.date,
    arrivalTime: parts.time,
    eta: !actual && arrival?.value ? arrival.value : null,
    actualArrival: actual && arrival?.value ? arrival.value : null,
    arrivalIsActual: actual,
    status,
    shipsgoRawStatus: sourceStatus,
    transshipments: route?.ts_count ?? '',
    transitTime: route?.transit_time ?? '',
    updatedAt: raw?.updated_at || raw?.checked_at || '',
    source:'ShipsGo Air API'
  };
}

function hasUsefulData(s) {
  return Boolean(s?.origin || s?.destination || s?.pieces || s?.weight || s?.flightNo || s?.arrivalDate);
}

function waiting(mawb, message = '') {
  return {
    mawb, carrierCode:'', airlineName:'', origin:'', destination:'', bags:'', pieces:'', weight:'', volume:'', flightNo:'',
    arrivalDate:'', arrivalTime:'', eta:null, actualArrival:null, arrivalIsActual:false,
    status:'CHECKING', source:'ShipsGo Air API', message
  };
}

async function getDetails(id) {
  const detail = await shipsgo(`/air/shipments/${id}`);
  if (!detail.ok) return {error:detail.data?.message || detail.data?.error || `ShipsGo returned HTTP ${detail.status}`, status:detail.status};
  return {raw:detail.data?.shipment || {}};
}

async function track(mawb) {
  const debug = {stage:'START', provider:'ShipsGo Air API'};
  try {
    if (!token()) {
      return {ok:false, error:'SHIPSGO_API_TOKEN is not configured in Vercel.', debug:{...debug, stage:'SHIPSGO_NOT_CONFIGURED'}};
    }

    const located = await locateOrCreate(mawb, debug);
    if (located.error) {
      return {ok:false, error:located.error, debug:{...debug, stage:located.code || 'SHIPSGO_LOCATE_FAILED'}};
    }

    debug.shipmentId = located.id;
    debug.stage = 'SHIPSGO_DETAILS';

    let result = await getDetails(located.id);
    if (result.error) {
      return {ok:false, error:String(result.error), debug:{...debug, stage:'SHIPSGO_DETAILS_FAILED', httpStatus:result.status}};
    }

    let raw = result.raw;
    let mapped = mapShipment(raw, mawb);

    // Creating a shipment starts ShipsGo tracking, but the first carrier check can be asynchronous.
    // Give a newly registered / empty shipment a few short polls within this request.
    const delays = [2500, 4000, 5500];
    for (let i=0; i<delays.length && !hasUsefulData(mapped) && /^(NEW|INPROGRESS|IN_PROGRESS)?$/i.test(String(raw?.status || '')); i++) {
      debug.stage = `SHIPSGO_WAIT_FIRST_CHECK_${i+1}`;
      await sleep(delays[i]);
      result = await getDetails(located.id);
      if (result.error) break;
      raw = result.raw;
      mapped = mapShipment(raw, mawb);
    }

    debug.shipsgoStatus = raw?.status || '';
    debug.checkedAt = raw?.checked_at || '';
    debug.shipmentCreated = Boolean(debug.shipmentCreated);

    if (!hasUsefulData(mapped) && /NEW/i.test(String(raw?.status || ''))) {
      debug.stage = 'SHIPSGO_REGISTERED_WAITING_FIRST_CHECK';
      return {
        ok:true,
        shipment:mapped,
        message:'MAWB has been added to ShipsGo. ShipsGo has not completed its first airline check yet.',
        debug
      };
    }

    if (!hasUsefulData(mapped) && /INPROGRESS|IN_PROGRESS/i.test(String(raw?.status || ''))) {
      debug.stage = 'SHIPSGO_WAITING_CARRIER_DATA';
      return {
        ok:true,
        shipment:mapped,
        message:'ShipsGo is tracking this MAWB, but the airline has not published usable shipment data yet.',
        debug
      };
    }

    debug.stage = 'SUCCESS';
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
      trackingError:r.message || '',
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
      mode:'MAWB → auto-create/find in ShipsGo → wait for first carrier check → fetch current details → Mayavi'
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
