import { NextResponse } from 'next/server';

const REGISTER_URL = 'https://api.track123.com/gateway/open-api/tk/v2.1/aviation/track/import';

function normalizeMawb(v = '') {
  const digits = String(v).replace(/\D/g, '');
  return digits.length >= 11 ? `${digits.slice(0,3)}-${digits.slice(3,11)}` : String(v).trim();
}

async function callTrack123(apiKey, body) {
  const r = await fetch(REGISTER_URL, {
    method: 'POST',
    headers: {
      'Track123-Api-Secret': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify(body),
    cache: 'no-store'
  });
  const text = await r.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  return { ok: r.ok, status: r.status, data };
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
    let result = await callTrack123(apiKey, [
      { trackingNo, carrierCode: carrierCode || undefined }
    ]);

    if (!result.ok) {
      const retry = await callTrack123(apiKey, {
        trackNoInfos: [{ trackingNo, carrierCode: carrierCode || undefined }]
      });
      if (retry.ok) result = retry;
    }

    return NextResponse.json({ ok: result.ok, status: result.status, details: result.data }, { status: result.ok ? 200 : 502 });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Registration failed.' }, { status: 500 });
  }
}
