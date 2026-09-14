import { trackSaudiaViaSal } from '../../../lib/saudiaSalPublic.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;

export async function GET(request){
  const {searchParams}=new URL(request.url);
  const mawb=searchParams.get('mawb')||'06511493554';
  const result=await trackSaudiaViaSal(mawb);
  return Response.json(result,{status:200});
}
