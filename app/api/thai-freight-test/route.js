const PAGE='https://www.freight.aero/tracking.asp';
const SERVICE='https://www.freight.aero/tracking_service.asp';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=120;

const digits=v=>String(v||'').replace(/\D/g,'');
function inputValue(html,name){
  const s=String(html||'');
  const a=s.match(new RegExp(`<input[^>]+(?:name|id)=["']${name}["'][^>]*value=["']([^"']*)["']`,'i'));
  if(a)return a[1];
  const b=s.match(new RegExp(`<input[^>]+value=["']([^"']*)["'][^>]+(?:name|id)=["']${name}["']`,'i'));
  return b?.[1]||'';
}

export async function GET(req){
  const {searchParams}=new URL(req.url);
  const raw=searchParams.get('mawb')||'';
  const full=digits(raw);
  if(full.length!==11||!full.startsWith('217'))return Response.json({ok:false,error:'valid 217 mawb required'},{status:400});
  const serial=full.slice(3);
  const pageUrl=`${PAGE}?Carrier=TG&Pfx=217&Portlet=yes&Shipment=${serial}&Site=CargoWeb`;
  try{
    const page=await fetch(pageUrl,{redirect:'follow',cache:'no-store',headers:{'user-agent':'Mozilla/5.0','accept-language':'en-US,en;q=0.9'},signal:AbortSignal.timeout(20000)});
    const html=await page.text();
    const portalId=inputValue(html,'portal_id')||'CHA';
    const uuid=inputValue(html,'tracking_uuid')||'';
    const isPortlet=inputValue(html,'is_portlet_val')||inputValue(html,'is_portlet')||'1';
    const cookie=page.headers.get('set-cookie')||'';
    const body={portalId,awbInfo:[{awbNumber:full,carrierId:'TG',trackingAirline:''}],captchaResponse:'FREIGHT_LOGGED_CAPTCHA'};
    const response=await fetch(`${SERVICE}?uuid=${encodeURIComponent(uuid)}&is_portlet=${encodeURIComponent(isPortlet)}`,{
      method:'POST',redirect:'follow',cache:'no-store',
      headers:{'content-type':'application/json; charset=utf-8','accept':'application/json, text/javascript, */*; q=0.01','x-requested-with':'XMLHttpRequest','referer':pageUrl,'origin':'https://www.freight.aero','user-agent':'Mozilla/5.0',...(cookie?{cookie}:{})},
      body:JSON.stringify(body),signal:AbortSignal.timeout(20000)
    });
    const text=await response.text();
    let payload=null;try{payload=JSON.parse(text)}catch{}
    return Response.json({ok:response.ok,pageStatus:page.status,trackStatus:response.status,portalId,uuid:Boolean(uuid),payload,preview:text.slice(0,5000)});
  }catch(e){return Response.json({ok:false,error:e?.message||String(e)},{status:500});}
}
