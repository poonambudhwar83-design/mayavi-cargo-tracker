export const runtime='nodejs';
export const dynamic='force-dynamic';

function around(text,needle,span=1200){
  const s=String(text||''); const i=s.toLowerCase().indexOf(String(needle||'').toLowerCase());
  if(i<0)return''; return s.slice(Math.max(0,i-span),Math.min(s.length,i+String(needle).length+span));
}

export async function GET(){
  const awb='07922003';
  const url=`https://www.freight.aero/tracking.asp?Carrier=VN&Pfx=738&Portlet=yes&Shipment=${awb}&Site=CargoWeb`;
  try{
    const response=await fetch(url,{redirect:'follow',cache:'no-store',headers:{'user-agent':'Mozilla/5.0','accept-language':'en-US,en;q=0.9'},signal:AbortSignal.timeout(20000)});
    const text=await response.text();
    return Response.json({ok:response.ok,status:response.status,finalUrl:response.url,contentType:response.headers.get('content-type')||'',awbFound:text.includes(awb)||text.includes('738-07922003')||text.includes('73807922003'),noAwb:/No AWB found/i.test(text),aroundAwb:around(text,awb),trackingSection:around(text,'Status'),preview:text.slice(0,18000)});
  }catch(error){
    return Response.json({ok:false,error:error?.message||String(error)},{status:503});
  }
}
