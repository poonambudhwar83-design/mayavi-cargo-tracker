import { trackSaudiaViaTrackingMorePublic } from '../../../lib/saudiaTrackingMorePublic.js';
import { trackSaudiaViaChina } from '../../../lib/saudiaChina.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;

export async function GET(req){
  const { searchParams }=new URL(req.url);
  const mawb=String(searchParams.get('mawb')||'').trim();
  if(!mawb)return Response.json({ok:false,error:'mawb required'},{status:400});
  const [trackingMore,china]=await Promise.allSettled([
    trackSaudiaViaTrackingMorePublic(mawb),
    trackSaudiaViaChina(mawb)
  ]);
  const unwrap=x=>x.status==='fulfilled'?x.value:{ok:false,reason:x.reason?.message||String(x.reason||'failed')};
  return Response.json({ok:true,mawb,trackingMore:unwrap(trackingMore),china:unwrap(china)});
}
