import { NextResponse } from 'next/server';

const REGISTER_URL = 'https://api.track123.com/gateway/open-api/tk/v2.1/aviation/track/import';

function normalizeMawb(v = '') {
  const digits = String(v).replace(/\D/g, '');
  return digits.length >= 11 ? `${digits.slice(0, 3)}-${digits.slice(3, 11)}` : String(v).trim();
}

async function callTrack123(apiKey, body) {
  const r = await fetch(REGISTER_URL, {
    method: 'POST',
    headers: {
      'Track123-Api-Secret': apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify(body),
    cache: 'no-store'
  });

  const text = await r.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  return { ok: r.ok, status: r.status, data };
}

function businessRejected(data) {
  if (!data || typeof data !== 'object') return false;
  if (data.success === false || data.ok === false) return true;

  const code = data.code ?? data.statusCode ?? data.errorCode;
  if (code !== undefined && code !== null) {
    const s = String(code);
    if (!['0', '200', 'SUCCESS', 'success'].includes(s)) return true;
  }

  const message = String(data.message ?? data.msg ?? data.error ?? '').toLowerCase();
  return /(invalid|unauthor|forbidden|quota|error|failed)/i.test(message);
}

export async function POST(request) {
  try {
    const apiKey = process.env.TRACK123_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'TRACK123_API_KEY is not configured in Vercel.' }, { status: 503 });
    }

    const { mawb, carrierCode = '' } = await request.json();
    if (!mawb) return NextResponse.json({ error: 'MAWB is required.' }, { status: 400 });

    const trackingNo = normalizeMawb(mawb);
    const item = { trackingNo };
    if (carrierCode) item.carrierCode = carrierCode;

    // Current Track123 air-cargo import accepts a list of tracking detail objects.
    let result = await callTrack123(apiKey, [item]);

    // Compatibility fallback for accounts on a slightly different schema revision.
    if (!result.ok || businessRejected(result.data)) {
      result = await callTrack123(apiKey, {
        trackNoInfos: [{ trackingNo, ...(carrierCode ? { carrierCode } : {}) }]
      });
    }

    if (!result.ok || businessRejected(result.data)) {
      return NextResponse.json(
        {
          error: 'Track123 could not register this air-cargo MAWB.',
          status: result.status,
          details: result.data
        },
        { status: 502 }
      );
    }

    return NextResponse.json({ ok: true, status: result.status, details: result.data });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Registration failed.' }, { status: 500 });
  }
}
