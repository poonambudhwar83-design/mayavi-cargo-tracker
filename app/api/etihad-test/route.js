import { trackEtihad } from '../../../lib/etihad.js';
import { normalizeMawb } from '../../../lib/airlines.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;
export const preferredRegion='bom1';

async function run(input){
  const mawb=normalizeMawb(input);
  if(!mawb||!mawb.startsWith('607-')) return Response.json({ok:false,error:'Enter a valid Etihad 607 MAWB.'},{status:400});
  const result=await trackEtihad(mawb);
  return Response.json(result,{status:result?.ok?200:503});
}

export async function GET(request){
  return run(new URL(request.url).searchParams.get('mawb'));
}

export async function POST(request){
  let body={};
  try{body=await request.json();}catch{}
  return run(body?.mawb);
}
