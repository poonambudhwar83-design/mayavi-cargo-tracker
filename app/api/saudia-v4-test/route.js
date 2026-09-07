import { trackSaudiaDirect } from '../../../lib/saudiaDirectV4.js';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;
export async function GET(request){
  const mawb=new URL(request.url).searchParams.get('mawb')||'';
  const r=await trackSaudiaDirect(mawb);
  return Response.json({ok:r.ok,reason:r.reason||'',shipment:r.shipment||null,debug:r.debug?{stage:r.debug.stage||'',moreClicked:r.debug.moreClicked||false,apiResponses:r.debug.apiResponses||[],beforeMore:r.debug.beforeMore||'',visibleSample:r.debug.visibleSample||'',ocrReason:r.debug.ocrReason||''}:null},{status:r.ok?200:503});
}
