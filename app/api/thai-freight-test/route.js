const PAGE='https://chorus.thaicargo.com/skychain/app?service=page%2Fnwp%3ATrackshipmt';
const POST='https://chorus.thaicargo.com/skychain/app';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=120;

const digits=v=>String(v||'').replace(/\D/g,'');
const cleanHtml=s=>String(s||'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;/gi,"'").replace(/\s+/g,' ').trim();
function cookieHeader(raw=''){
  const out=[];
  for(const m of String(raw||'').matchAll(/(?:^|,\s*)([A-Za-z0-9_.-]+)=([^;,]+)/g)){
    const name=m[1];if(/^(?:path|expires|max-age|domain|samesite|secure|httponly)$/i.test(name))continue;out.push(`${name}=${m[2]}`);
  }
  return out.join('; ');
}

export async function GET(req){
  const {searchParams}=new URL(req.url);const full=digits(searchParams.get('mawb')||'');
  if(full.length!==11||!full.startsWith('217'))return Response.json({ok:false,error:'valid 217 mawb required'},{status:400});
  const serial=full.slice(3);
  try{
    const page=await fetch(PAGE,{redirect:'follow',cache:'no-store',headers:{'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36','accept':'text/html,application/xhtml+xml','accept-language':'en-US,en;q=0.9'},signal:AbortSignal.timeout(20000)});
    const html=await page.text();const cookie=cookieHeader(page.headers.get('set-cookie')||'');
    const form=new URLSearchParams();
    const fields={
      service:'direct/1/nwp:Trackshipmt/trackForm',sp:'S1',
      Form1:'selectDoctype,txtPrefix,txtNumber,txtJrn,txtAWBPrefix,txtAWBNumber,txtAWBPrefix$0,txtAWBNumber$0,txtAWBPrefix$1,txtAWBNumber$1,txtAWBPrefix$2,txtAWBNumber$2,txtAWBPrefix$3,txtAWBNumber$3,txtAWBPrefix$4,txtAWBNumber$4,txtAWBPrefix$5,txtAWBNumber$5,txtAWBPrefix$6,txtAWBNumber$6,txtAWBPrefix$7,txtAWBNumber$7,$FormConditional,$JSubmit,$JSubmit$0,$JSubmit$1,$JSubmit$2,$FormConditional$0,$FormConditional$1,reload,pageSize,listSize,advSearch,trackViewHdn',
      trackForm_hdnLastPermissionCheck:'',trackForm_hdnLastPermissionCode:'',hdnFormID:'trackForm',hdnbpval2:'false',
      '$FormConditional':'F','$FormConditional$0':'F','$FormConditional$1':'F',reload:'',pageSize:'10',listSize:'0',advSearch:'F',trackViewHdn:'tableRadio',
      selectDoctype:'AWB',txtPrefix:'217',txtNumber:serial,txtJrn:'',txtAWBPrefix:'217',txtAWBNumber:serial,
      'txtAWBPrefix$0':'217','txtAWBNumber$0':'','txtAWBPrefix$1':'217','txtAWBNumber$1':'','txtAWBPrefix$2':'217','txtAWBNumber$2':'','txtAWBPrefix$3':'217','txtAWBNumber$3':'','txtAWBPrefix$4':'217','txtAWBNumber$4':'','txtAWBPrefix$5':'217','txtAWBNumber$5':'','txtAWBPrefix$6':'217','txtAWBNumber$6':'','txtAWBPrefix$7':'217','txtAWBNumber$7':'',
      '$JSubmit$0':'Track'
    };
    for(const [k,v] of Object.entries(fields))form.set(k,v);
    const r=await fetch(POST,{method:'POST',redirect:'follow',cache:'no-store',headers:{'content-type':'application/x-www-form-urlencoded','accept':'text/html,application/xhtml+xml','accept-language':'en-US,en;q=0.9','user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36','referer':PAGE,'origin':'https://chorus.thaicargo.com',...(cookie?{cookie}:{})},body:form.toString(),signal:AbortSignal.timeout(30000)});
    const result=await r.text();const text=cleanHtml(result);
    const index=text.indexOf('217');
    return Response.json({ok:r.ok,pageStatus:page.status,trackStatus:r.status,finalUrl:r.url,cookie:Boolean(cookie),containsAwb:text.includes(full)||text.includes(serial),textSample:index>=0?text.slice(Math.max(0,index-1000),index+7000):text.slice(0,8000),htmlSample:result.slice(0,12000)});
  }catch(e){return Response.json({ok:false,error:e?.message||String(e)},{status:500});}
}
