import { trackCathay } from '../../../lib/cathay.js';
import { normalizeMawb } from '../../../lib/airlines.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const preferredRegion='hkg1';
export const maxDuration=300;

async function run(value){
  const mawb=normalizeMawb(value);
  if(!mawb||!mawb.startsWith('160-'))return Response.json({ok:false,error:'Enter a valid Cathay 160 MAWB.'},{status:400});
  const result=await trackCathay(mawb);
  return Response.json(result,{status:result?.ok?200:503});
}
export async function GET(request){
  return run(new URL(request.url).searchParams.get('mawb'));
}
export async function POST(request){
  let body={};try{body=await request.json()}catch{}
  return run(body?.mawb);
}
