import { trackVietnam } from '../../../lib/vietnam.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;

export async function GET(request){
  const mawb=new URL(request.url).searchParams.get('mawb')||'';
  const result=await trackVietnam(mawb);
  return Response.json(result,{status:result?.ok?200:503});
}
