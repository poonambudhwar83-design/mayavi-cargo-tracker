// Gulf Air-only tracking entry, hosted in Mumbai for a regional ParcelsApp
// comparison. Keep the shared /api/track route and every other airline intact.
import {GET as getShared, POST as postShared} from '../track/route.js';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const preferredRegion='bom1';
export const maxDuration=300;
const valid=v=>/^072\d{8}$/.test(String(v??'').replace(/\D/g,''));
export async function GET(request){
  if(!valid(new URL(request.url).searchParams.get('mawb')))
    return Response.json({ok:false,error:'Only Gulf Air 072 AWBs are supported here.'},{status:400});
  return getShared(request);
}
export async function POST(request){
  let body={};
  try{body=await request.clone().json()}catch{}
  if(!valid(body.mawb))
    return Response.json({ok:false,error:'Only Gulf Air 072 AWBs are supported here.'},{status:400});
  return postShared(request);
}
