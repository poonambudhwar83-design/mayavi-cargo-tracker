import { trackBritish } from '../../../../lib/british.js';
import { normalizeMawb } from '../../../../lib/airlines.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;

async function run(value){
  const mawb=normalizeMawb(value);
  if(!mawb||!mawb.startsWith('125-'))return Response.json({ok:false,error:'Enter a valid British Airways/IAG Cargo MAWB beginning 125.'},{status:400});
  const result=await trackBritish(mawb);
  if(result?.ok)return Response.json({ok:true,provider:'British Airways / IAG Cargo official Track & Trace',...result});
  return Response.json({ok:false,mawb,provider:'British Airways / IAG Cargo official Track & Trace',...result},{status:503});
}

export async function POST(request){
  let body={};try{body=await request.json()}catch{return Response.json({ok:false,error:'Invalid request body.'},{status:400});}
  return run(body?.mawb);
}

export async function GET(request){
  const mawb=new URL(request.url).searchParams.get('mawb');
  if(!mawb)return Response.json({ok:true,mode:'Isolated BA/IAG Cargo adapter test endpoint',prefix:'125',officialTracker:'https://www.iagcargo.com/'});
  return run(mawb);
}
