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

export async function GET(req){
  const {searchParams}=new globalThis.URL(req.url);
  const mawb=normalizeMawb(searchParams.get('mawb')||'');
  if(!mawb||!mawb.startsWith('312-'))return Response.json({ok:false,error:'INVALID INDIGO MAWB'},{status:400});
  const serial=mawb.slice(4);
  const queryUrl=`${TRACKER_URL}?AWBNo=${encodeURIComponent(serial)}&AWBPrefix=312`;
  try{
    const r=await fetch(queryUrl,{headers:headers({referer:'https://6ecargo.goindigo.in/'}),redirect:'follow',cache:'no-store'});
    const html=await r.text();
    const text=clean(html);
    return Response.json({ok:r.ok,status:r.status,mawb,queryUrl,hasNoData:/AWB\s+Details\s+not\s+available/i.test(text),blocked:/Access Denied|permission to access/i.test(text),preview:text.slice(0,5000)});
  }catch(e){
    return Response.json({ok:false,error:String(e?.message||e),mawb},{status:502});
  }
}
