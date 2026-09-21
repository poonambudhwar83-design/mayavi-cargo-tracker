import { NextResponse } from 'next/server';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=30;

const QUERY_URL='https://api.track123.com/gateway/open-api/tk/v2.1/aviation/track/query';

function normalizeMawb(v=''){
  const d=String(v).replace(/\D/g,'');
  return d.length===11?`${d.slice(0,3)}-${d.slice(3)}`:'';
}

async function post(body){
  const key=process.env.TRACK123_API_KEY;
  if(!key)return {missing:true};
  const r=await fetch(QUERY_URL,{
    method:'POST',
    headers:{'Track123-Api-Secret':key,'Content-Type':'application/json','Accept':'application/json'},
    body:JSON.stringify(body),
    cache:'no-store',
    signal:AbortSignal.timeout(20000)
  });
  const text=await r.text();
  let data=null;try{data=JSON.parse(text)}catch{}
  return {ok:r.ok,status:r.status,data,text:text.slice(0,12000)};
}

export async function GET(request){
  const key=process.env.TRACK123_API_KEY;
  const q=new URL(request.url).searchParams.get('mawb');
  if(!q)return NextResponse.json({configured:Boolean(key),airCargoMcpConfigured:Boolean(process.env.AIRCARGO_MCP_API_KEY),trackingMoreConfigured:Boolean(process.env.TRACKINGMORE_API_KEY)});
  const mawb=normalizeMawb(q);
  if(!mawb)return NextResponse.json({configured:Boolean(key),ok:false,error:'invalid mawb'},{status:400});
  if(!key)return NextResponse.json({configured:false,ok:false,error:'TRACK123_API_KEY missing'},{status:503});
  const bodies=[
    [{trackingNo:mawb}],
    {trackingNoInfos:[{trackingNo:mawb}]},
    {trackNoInfos:[{trackNo:mawb}]},
    {trackNos:[mawb]}
  ];
  const attempts=[];
  for(const body of bodies){
    const res=await post(body);
    attempts.push({body,res});
    if(res.ok)return NextResponse.json({configured:true,ok:true,mawb,result:res,attempts});
  }
  return NextResponse.json({configured:true,ok:false,mawb,attempts},{status:502});
}
