export const runtime='edge';
export const dynamic='force-dynamic';
// Public connectivity diagnostic only: no MAWB or customer data is used.
// This endpoint does not proxy or transmit any private tracking details.
export async function GET(){
  const urls=[
    'https://www.afklcargo.com/WW/en/homepage/homepage',
    'https://www.afklcargo.com/mycargo/api/tnt-api/shipments/not-a-real-shipment'
  ];
  const tests=await Promise.all(urls.map(async(u)=>{
    const started=Date.now();
    try{
      const controller=new AbortController();
      const timer=setTimeout(()=>controller.abort(),6500);
      try{
        const r=await fetch(u,{cache:'no-store',headers:{accept:'text/html,application/json,*/*','user-agent':'Mozilla/5.0'},signal:controller.signal});
        return{type:u.includes('tnt-api')?'awbApi':'homepage',status:r.status,contentType:r.headers.get('content-type')||'',bytes:Number(r.headers.get('content-length')||0),elapsedMs:Date.now()-started};
      }finally{clearTimeout(timer)}
    }catch(e){return{type:u.includes('tnt-api')?'awbApi':'homepage',status:0,error:String(e?.name||'NetworkError'),elapsedMs:Date.now()-started}}
  }));
  return Response.json({ok:true,network:'Vercel Edge',tests},{headers:{'Cache-Control':'no-store'}});
}
