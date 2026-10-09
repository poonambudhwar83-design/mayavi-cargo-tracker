export const runtime='nodejs';
export const dynamic='force-dynamic';
// Only this KLM connectivity probe runs in Frankfurt. Do not change any
// existing airline's function region, lock or route.
export const preferredRegion='fra1';
const hosts=[
  {name:'AFKLM homepage',url:'https://www.afklcargo.com/GB/en/homepage/homepage'},
  {name:'AFKLM API edge',url:'https://api.airfranceklm.com/cargo/tracking/awbs/000-00000000'}
];
export async function GET(){
  const tested=await Promise.all(hosts.map(async item=>{
    const start=Date.now();
    try{
      const response=await fetch(item.url,{
        headers:{accept:'application/json,text/html,*/*'},
        cache:'no-store',redirect:'manual',signal:AbortSignal.timeout(6500)
      });
      return{name:item.name,http:response.status,elapsedMs:Date.now()-start};
    }catch(err){
      return{name:item.name,http:0,error:String(err?.name||'NetworkError'),
        elapsedMs:Date.now()-start};
    }
  }));
  return Response.json({region:'fra1',tested},
    {headers:{'Cache-Control':'no-store'}});
}
