export const runtime='nodejs';
export const dynamic='force-dynamic';

function around(text,needle,span=1800){
  const s=String(text||''); const i=s.toLowerCase().indexOf(String(needle||'').toLowerCase());
  if(i<0)return''; return s.slice(Math.max(0,i-span),Math.min(s.length,i+String(needle).length+span));
}

export async function GET(){
  const awb='07922003';
  const url=`https://www.freight.aero/tracking.asp?Carrier=VN&Pfx=738&Portlet=yes&Shipment=${awb}&Site=CargoWeb`;
  try{
    const response=await fetch(url,{redirect:'follow',cache:'no-store',headers:{'user-agent':'Mozilla/5.0','accept-language':'en-US,en;q=0.9'},signal:AbortSignal.timeout(20000)});
    const text=await response.text();
    const asp=[...new Set([...text.matchAll(/[A-Za-z0-9_\/-]+\.asp(?:\?[^\"'<>\s]*)?/gi)].map(m=>m[0]))].slice(0,120);
    return Response.json({ok:response.ok,status:response.status,finalUrl:response.url,awbFound:text.includes(awb),noAwb:/No AWB found/i.test(text),snippets:{checkUuidAndTrack:around(text,'checkUuidAndTrack'),generateAwbInfoObj:around(text,'generateAwbInfoObj'),trackingUuid:around(text,'tracking_uuid'),ajax:around(text,'$.ajax'),ajax2:around(text,'jQuery.ajax'),trackSubmit:around(text,'track-submit')},asp});
  }catch(error){
    return Response.json({ok:false,error:error?.message||String(error)},{status:503});
  }
}
