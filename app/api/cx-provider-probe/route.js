export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=30;
export async function GET(){
 const ids=['160-18860310','16018860310'];
 const out=[];
 for(const id of ids){
  const url='https://tracking.one/api/guest/v1/shipments/air?number='+encodeURIComponent(id)+'&routePath=true';
  try{
   const response=await fetch(url,{headers:{accept:'application/json'},cache:'no-store',signal:AbortSignal.timeout(12000)});
   const body=await response.text();
   let obj=null;try{obj=JSON.parse(body)}catch{}
   const shipment=obj?.shipment||{};
   out.push({id,status:response.status,success:obj?.success,statusCode:obj?.statusCode,bodyPreview:body.slice(0,1400),flightSegments:(shipment?.routeSegments||[]).length});
  }catch(e){out.push({id,error:String(e?.message||e)});}
 }
 return Response.json({results:out},{headers:{'Cache-Control':'no-store'}});
}
