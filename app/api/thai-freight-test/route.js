const PAGE='https://chorus.thaicargo.com/skychain/app?service=page%2Fnwp%3ATrackshipmt';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=120;

const attr=(tag,name)=>{const m=String(tag).match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`,'i'));return m?.[1]||'';};

export async function GET(){
  try{
    const r=await fetch(PAGE,{redirect:'follow',cache:'no-store',headers:{'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36','accept':'text/html,application/xhtml+xml','accept-language':'en-US,en;q=0.9'},signal:AbortSignal.timeout(20000)});
    const html=await r.text();
    const inputs=[...html.matchAll(/<input\b[^>]*>/gi)].map(x=>x[0]).slice(0,120).map(tag=>({type:attr(tag,'type'),name:attr(tag,'name'),id:attr(tag,'id'),value:attr(tag,'value'),placeholder:attr(tag,'placeholder')}));
    const buttons=[...html.matchAll(/<(?:button|input)\b[^>]*(?:type=["']?(?:submit|button)["']?)[^>]*>/gi)].map(x=>x[0]).slice(0,60).map(tag=>({name:attr(tag,'name'),id:attr(tag,'id'),value:attr(tag,'value'),type:attr(tag,'type')}));
    const forms=[...html.matchAll(/<form\b[^>]*>/gi)].map(x=>x[0]).slice(0,20).map(tag=>({action:attr(tag,'action'),method:attr(tag,'method'),id:attr(tag,'id'),name:attr(tag,'name')}));
    const scripts=[...html.matchAll(/<script\b[^>]*src=["']([^"']+)["'][^>]*>/gi)].map(x=>x[1]).slice(0,40);
    return Response.json({ok:r.ok,status:r.status,url:r.url,cookie:Boolean(r.headers.get('set-cookie')),forms,inputs,buttons,scripts,htmlSample:html.slice(0,16000)});
  }catch(e){return Response.json({ok:false,error:e?.message||String(e)},{status:500});}
}
