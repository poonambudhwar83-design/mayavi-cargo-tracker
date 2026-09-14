import { trackThai } from '../../../lib/thai.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=120;

export async function GET(req){
  const {searchParams}=new URL(req.url);
  const mawb=searchParams.get('mawb')||'';
  const result=await trackThai(mawb);
  return Response.json(result,{status:result?.ok?200:503});
}
