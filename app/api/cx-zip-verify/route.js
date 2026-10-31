import {trackCathayBrowserFallback as trackArchived} from '../../../lib/cathaySeptember19.js';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=120;
export async function GET(){
  const mawb='160-18860310';
  const start=Date.now();
  const r=await trackArchived(mawb,{});
  return Response.json({mawb,archive:'2026-09-19 ZIP',elapsedMs:Date.now()-start,ok:r?.ok===true,shipment:r?.shipment||null,reason:r?.reason||'',debug:{clicked:r?.debug?.clicked||false,form:r?.debug?.awbEntry?.ok||false,pageSample:r?.debug?.pageSample?.slice(0,650)||'',network:(r?.debug?.network||[]).map(x=>({status:x.status,path:x.url?.split('?')[0]?.slice(-130)})).slice(-8)}},{headers:{'cache-control':'no-store'}});
}