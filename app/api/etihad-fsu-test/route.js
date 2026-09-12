export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function GET(req){
  const {searchParams}=new URL(req.url);
  const mawb=(searchParams.get('mawb')||'607-54691954').trim();
  const prefix=mawb.replace(/\D/g,'').slice(0,3);
  const out={ok:false,mawb,prefix,checks:[]};
  try{
    const r=await fetch(`https://api.aircargomcp.com/prefix/${prefix}`,{cache:'no-store',signal:AbortSignal.timeout(15000)});
    const text=await r.text();
    let json=null;try{json=JSON.parse(text)}catch{}
    out.checks.push({name:'AirCargoMCP prefix',status:r.status,data:json||text.slice(0,500)});
  }catch(e){out.checks.push({name:'AirCargoMCP prefix',error:e?.message||String(e)});}
  try{
    const r=await fetch(`https://api.aircargomcp.com/track/${encodeURIComponent(mawb)}`,{cache:'no-store',signal:AbortSignal.timeout(20000)});
    const text=await r.text();
    let json=null;try{json=JSON.parse(text)}catch{}
    out.checks.push({name:'AirCargoMCP track unauthenticated',status:r.status,data:json||text.slice(0,500)});
    if(r.ok&&json?.data){out.ok=true;out.shipment=json.data;}
  }catch(e){out.checks.push({name:'AirCargoMCP track unauthenticated',error:e?.message||String(e)});}
  return Response.json(out,{status:out.ok?200:503});
}
