export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;

const SCRIPT='https://china.saudiacargo.com/_next/static/chunks/pages/e-services/track-shipment.js?ts=1789020580515';
const clean=s=>String(s||'').replace(/\s+/g,' ');

export async function GET(){
  try{
    const res=await fetch(SCRIPT,{headers:{'user-agent':'Mozilla/5.0','accept':'*/*'},cache:'no-store'});
    const text=await res.text();
    const hits=[];
    const positions=[];
    const patterns=[
      /\/apis?\/[A-Za-z0-9_?&=./{}:\-]+/gi,
      /https?:\/\/[^"'`\s)]+/gi,
      /track[-_/]?shipment/gi,
      /awbNumber/gi,
      /grecaptcha/gi,
      /recaptcha/gi,
      /axios/gi,
      /fetch\s*\(/gi,
      /\.post\s*\(/gi,
      /\.get\s*\(/gi
    ];
    for(const rx of patterns){for(const m of text.matchAll(rx))positions.push(m.index||0)}
    positions.sort((a,b)=>a-b);
    for(const p of positions){
      const a=Math.max(0,p-260),b=Math.min(text.length,p+520);
      const snippet=clean(text.slice(a,b));
      if(!hits.includes(snippet))hits.push(snippet);
      if(hits.length>=80)break;
    }
    return Response.json({ok:res.ok,status:res.status,script:SCRIPT,length:text.length,hits});
  }catch(e){
    return Response.json({ok:false,error:clean(e?.message||e)},{status:500});
  }
}
