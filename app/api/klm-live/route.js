import { trackKlm } from '../../../lib/klm.js';
import { normalizeMawb } from '../../../lib/airlines.js';
import { createHmac, timingSafeEqual } from 'node:crypto';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const preferredRegion='fra1';
export const maxDuration=180;

function validSignature(mawb,issuedAt,signature){
  // Internal-only endpoint. The public Mayavi /api/track keeps its existing
  // employee/admin access checks; do not expose raw shipment extraction here.
  const secret=process.env.DATABASE_URL;
  if(!secret||!signature||!issuedAt||!Number.isFinite(Number(issuedAt)))return false;
  if(Math.abs(Date.now()-Number(issuedAt))>5*60*1000)return false;
  const expected=createHmac('sha256',secret).update('klm-live|'+mawb+'|'+issuedAt).digest('hex');
  try{return timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(signature,'hex'))}
  catch{return false}
}
export async function GET(request){
  const query=new URL(request.url).searchParams;
  const mawb=normalizeMawb(query.get('mawb')||'');
  if(!/^074-\d{8}$/.test(mawb))return Response.json({ok:false,reason:'Invalid KLM AWB'},{status:400});
  if(!validSignature(mawb,request.headers.get('x-mayavi-issued-at'),
      request.headers.get('x-mayavi-signature')))
    return Response.json({ok:false,reason:'Authorization required'},{status:403});
  const result=await trackKlm(mawb);
  return Response.json({...result,executionRegion:'fra1'},
    {status:result.ok?200:503,headers:{'cache-control':'no-store'}});
}
