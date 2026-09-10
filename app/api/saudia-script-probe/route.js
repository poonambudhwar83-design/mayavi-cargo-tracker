export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;

const SCRIPT='https://china.saudiacargo.com/_next/static/chunks/pages/e-services/track-shipment.js?ts=1789020580515';
const clean=s=>String(s||'').replace(/\s+/g,' ');

export async function GET(){
  try{
    const res=await fetch(SCRIPT,{headers:{'user-agent':'Mozilla/5.0','accept':'*/*'},cache:'no-store'});
    const text=await res.text();
    const marker='./components/eservices-forms/track-shipment-form.js';
    const start=text.indexOf(marker);
    const end=start>=0?text.indexOf('/***/ })',start+marker.length):-1;
    const section=start>=0?text.slice(start,end>start?end:Math.min(text.length,start+450000)):text;
    const endpoints=[...section.matchAll(/["'`]([^"'`]*(?:apis?\/api\/eservices|track[-_/]?shipment)[^"'`]*)["'`]/gi)].map(m=>m[1]).filter((v,i,a)=>v&&a.indexOf(v)===i).slice(0,40);
    const fetches=[];
    for(const m of section.matchAll(/fetch\s*\(/gi)){
      const p=m.index||0;fetches.push(clean(section.slice(Math.max(0,p-700),Math.min(section.length,p+1500))));if(fetches.length>=20)break;
    }
    const recaptcha=[];
    for(const m of section.matchAll(/executeRecaptcha|gReCaptchaToken|recaptcha/gi)){
      const p=m.index||0;const s=clean(section.slice(Math.max(0,p-500),Math.min(section.length,p+900)));if(!recaptcha.includes(s))recaptcha.push(s);if(recaptcha.length>=20)break;
    }
    return Response.json({ok:res.ok,status:res.status,length:text.length,markerFound:start>=0,sectionLength:section.length,endpoints,fetches,recaptcha});
  }catch(e){return Response.json({ok:false,error:clean(e?.message||e)},{status:500});}
}
