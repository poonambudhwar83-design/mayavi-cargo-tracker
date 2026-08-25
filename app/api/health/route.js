export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json({
    ok: true,
    service: 'mayavi-cargo-tracker',
    tracking: 'official-airline-websites',
    trackJet: false,
    timestamp: new Date().toISOString()
  });
}
