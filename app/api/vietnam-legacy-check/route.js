export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function GET(){
  const url='https://cargoserv.champ.aero/tracking.asp?Carrier=VN&Pfx=738';
  try{
    const response=await fetch(url,{redirect:'follow',cache:'no-store',signal:AbortSignal.timeout(20000)});
    const text=await response.text();
    return Response.json({ok:response.ok,status:response.status,finalUrl:response.url,contentType:response.headers.get('content-type')||'',preview:text.slice(0,12000)});
  }catch(error){
    return Response.json({ok:false,error:error?.message||String(error)},{status:503});
  }
}
