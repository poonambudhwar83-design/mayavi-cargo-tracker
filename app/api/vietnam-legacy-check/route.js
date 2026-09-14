export const runtime='nodejs';
export const dynamic='force-dynamic';

function val(text,name){
  const s=String(text||'');
  const a=s.match(new RegExp(`<input[^>]+(?:name|id)=["']${name}["'][^>]*value=["']([^"']*)["']`,'i'));
  if(a)return a[1];
  const b=s.match(new RegExp(`<input[^>]+value=["']([^"']*)["'][^>]+(?:name|id)=["']${name}["']`,'i'));
  return b?.[1]||'';
}
function selectedCarrier(text){
  const block=(String(text).match(/<select[^>]+id=["']carrier_dropdown_1["'][\s\S]*?<\/select>/i)||[])[0]||'';
  const opt=(block.match(/<option[^>]*selected[^>]*>/i)||[])[0]||'';
  const value=(opt.match(/value=["']([^"']*)["']/i)||[])[1]||'';
  const id=(opt.match(/id\s*=\s*["']([^"']*)["']/i)||[])[1]||'';
  return{value,id,block:block.slice(0,4000)};
}

export async function GET(){
  const serial='07922003',full='73807922003';
  const pageUrl=`https://www.freight.aero/tracking.asp?Carrier=VN&Pfx=738&Portlet=yes&Shipment=${serial}&Site=CargoWeb`;
  try{
    const page=await fetch(pageUrl,{redirect:'follow',cache:'no-store',headers:{'user-agent':'Mozilla/5.0','accept-language':'en-US,en;q=0.9'},signal:AbortSignal.timeout(20000)});
    const html=await page.text();
    const carrier=selectedCarrier(html);
    const portalId=val(html,'portal_id');
    const uuid=val(html,'tracking_uuid');
    const isPortlet=val(html,'is_portlet_val')||val(html,'is_portlet');
    const cookie=page.headers.get('set-cookie')||'';
    const candidates=[carrier.id,carrier.value?.split('-')[0],carrier.value,'VN'].filter(Boolean);
    const attempts=[];
    for(const carrierId of [...new Set(candidates)]){
      const body={portalId,awbInfo:[{awbNumber:full,carrierId,trackingAirline:''}],captchaResponse:'FREIGHT_LOGGED_CAPTCHA'};
      const r=await fetch(`https://www.freight.aero/tracking_service.asp?uuid=${encodeURIComponent(uuid)}&is_portlet=${encodeURIComponent(isPortlet)}`,{method:'POST',redirect:'follow',cache:'no-store',headers:{'content-type':'application/json; charset=utf-8','accept':'application/json, text/javascript, */*; q=0.01','x-requested-with':'XMLHttpRequest','referer':pageUrl,'origin':'https://www.freight.aero','user-agent':'Mozilla/5.0',...(cookie?{cookie}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
      const txt=await r.text();
      attempts.push({carrierId,status:r.status,contentType:r.headers.get('content-type')||'',text:txt.slice(0,16000)});
      if(r.ok&&txt&&!/error|invalid|no awb found/i.test(txt))break;
    }
    return Response.json({ok:true,pageStatus:page.status,pageUrl:page.url,portalId,uuid,isPortlet,carrier,attempts});
  }catch(error){
    return Response.json({ok:false,error:error?.message||String(error)},{status:503});
  }
}
