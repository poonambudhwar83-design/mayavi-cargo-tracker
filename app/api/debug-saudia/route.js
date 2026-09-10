import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  const url = new URL(request.url);
  const digits = String(url.searchParams.get('mawb') || '').replace(/\D/g, '');
  if (digits.length !== 11 || !digits.startsWith('065')) {
    return NextResponse.json({ ok: false, error: 'Enter a valid 065 Saudia MAWB.' }, { status: 400 });
  }
  const mawb = `${digits.slice(0,3)}-${digits.slice(3)}`;
  const endpoint = `https://sal.sa/TrackShipment/TrackingApi?trackId=${encodeURIComponent(mawb)}&CurrentCulture=en-us`;
  try {
    const res = await fetch(endpoint, {
      headers: {
        Accept: 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        Referer: 'https://sal.sa/trackshipment',
        'User-Agent': 'Mozilla/5.0'
      },
      cache: 'no-store'
    });
    const text = await res.text();
    let outer = null;
    try { outer = JSON.parse(text); } catch {}
    let message = outer?.message ?? null;
    if (typeof message === 'string') {
      try { message = JSON.parse(message); } catch {}
    }
    return NextResponse.json({ ok: res.ok, status: res.status, mawb, outer, message });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
