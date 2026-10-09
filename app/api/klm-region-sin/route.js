export const runtime='nodejs';
export const dynamic='force-dynamic';
export const preferredRegion='sin1';
// KLM origin diagnostic only. No user AWB, saved cargo, or credentials sent.
const hosts=['https://afklcargo.com/WW/en/homepage/homepage','https://www.afklcargo.com/WW/en/homepage/homepage'];
export async function GET(){
 const tested=await Promise.all(hosts.map(async (url)=>{
  const started=Date.now();
  try{
   const r=await fetch(url,{method:'GET',headers:{accept:'text/html,*/*'},redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(5000)});
   return{host:new URL(url).host,http:r.status,elapsedMs:Date.now()-started};
  }catch(e){return{host:new URL(url).host,http:0,error:e?.name||'NetworkError',elapsedMs:Date.now()-started}}
 }));
 return Response.json({targetRegion:'sin1',tested},{headers:{'Cache-Control':'no-store'}});
}
