import { normalizeMawb } from '../../../lib/airlines.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const preferredRegion='bom1';
export const maxDuration=60;

const TRACKER_URL='https://6ecargo.goindigo.in/FrmAWBTracking.aspx';

function decode(s=''){
  return String(s).replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n)));
}
function clean(html=''){
  return decode(String(html).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<br\s*\/?>/gi,'\n').replace(/<\/(?:td|th|tr|div|p|li|h\d)>/gi,'\n').replace(/<[^>]+>/g,' ')).replace(/[ \t]+/g,' ').replace(/\n\s*\n+/g,'\n').trim();
}
function headers(extra={}){
  return {
    'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
    'accept':'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'accept-language':'en-IN,en;q=0.9',
    'cache-control':'no-cache',
    'pragma':'no-cache',
    ...extra
  };
}
function attr(tag,name){
  const m=String(tag).match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,'i'));
  return decode(m?.[1]??m?.[2]??m?.[3]??'');
}
function formMeta(html=''){
  const forms=[...String(html).matchAll(/<form\b[^>]*>/gi)].map(m=>({tag:m[0],id:attr(m[0],'id'),name:attr(m[0],'name'),method:attr(m[0],'method'),action:attr(m[0],'action')}));
  const inputs=[...String(html).matchAll(/<input\b[^>]*>/gi)].map(m=>{const t=m[0];return {id:attr(t,'id'),name:attr(t,'name'),type:(attr(t,'type')||'text').toLowerCase(),value:attr(t,'value'),placeholder:attr(t,'placeholder'),onclick:attr(t,'onclick')};});
  const buttons=[...String(html).matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/gi)].map(m=>{const t=m[0];return {id:attr(t,'id'),name:attr(t,'name'),type:(attr(t,'type')||'submit').toLowerCase(),value:attr(t,'value'),text:clean(t),onclick:attr(t,'onclick')};});
  const selects=[...String(html).matchAll(/<select\b[^>]*>[\s\S]*?<\/select>/gi)].map(m=>{const t=m[0];return {id:attr(t,'id'),name:attr(t,'name'),text:clean(t).slice(0,500)};});
  const scripts=[...String(html).matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).filter(s=>/track|postback|awb|prefix/i.test(s)).map(s=>s.replace(/\s+/g,' ').slice(0,2500)).slice(0,12);
  return {forms,inputs:inputs.filter(x=>x.type!=='hidden'),hiddenNames:inputs.filter(x=>x.type==='hidden').map(x=>x.name).filter(Boolean),buttons,selects,scripts};
}
function cookieHeader(response){
  try{const xs=response.headers.getSetCookie?.();if(xs?.length)return xs.map(x=>x.split(';')[0]).join('; ');}catch{}
  return (response.headers.get('set-cookie')||'').split(/,(?=[^;,]+=)/).map(x=>x.split(';')[0]).filter(Boolean).join('; ');
}

export async function GET(req){
  const {searchParams}=new globalThis.URL(req.url);
  const mawb=normalizeMawb(searchParams.get('mawb')||'');
  if(!mawb||!mawb.startsWith('312-'))return Response.json({ok:false,error:'INVALID INDIGO MAWB'},{status:400});
  const serial=mawb.slice(4);
  try{
    const initial=await fetch(TRACKER_URL,{headers:headers({referer:'https://6ecargo.goindigo.in/'}),redirect:'follow',cache:'no-store'});
    const initialHtml=await initial.text();
    const meta=formMeta(initialHtml);
    const queryUrl=`${TRACKER_URL}?AWBNo=${encodeURIComponent(serial)}&AWBPrefix=312`;
    const query=await fetch(queryUrl,{headers:headers({referer:TRACKER_URL}),redirect:'follow',cache:'no-store'});
    const queryHtml=await query.text();
    const text=clean(queryHtml);
    return Response.json({
      ok:initial.ok&&query.ok,
      mawb,
      initialStatus:initial.status,
      queryStatus:query.status,
      cookiePresent:Boolean(cookieHeader(initial)),
      queryUrl,
      hasNoData:/AWB\s+Details\s+not\s+available/i.test(text),
      blocked:/Access Denied|permission to access/i.test(text),
      formMeta:meta,
      preview:text.slice(0,5000)
    });
  }catch(e){
    return Response.json({ok:false,error:String(e?.message||e),mawb},{status:502});
  }
}
