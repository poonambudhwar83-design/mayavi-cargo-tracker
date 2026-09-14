import { trackSaudiaDirect as trackSaudiaDirectV6 } from '../../../../lib/saudiaDirectV6.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=120;

export async function GET(request){
  const {searchParams}=new URL(request.url);
  const mawb=searchParams.get('mawb')||'06511493554';
  const result=await trackSaudiaDirectV6(mawb);
  return Response.json(result,{status:200});
}
