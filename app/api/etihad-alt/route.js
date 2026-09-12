import { trackEtihadAlternate } from '../../../lib/etihadAlternate.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;
export const preferredRegion='bom1';

function mawbFrom(req){
  try{return new URL(req.url).searchParams.get('mawb')||'';}catch{return'';}
}
export async function GET(req){
  const mawb=mawbFrom(req);
  const result=await trackEtihadAlternate(mawb);
  return Response.json(result,{status:result?.ok?200:503});
}
