export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;

const ENDPOINT='https://china.saudiacargo.com/apis/api/eservices/track-shipment';
const AWBS=['06511479705','06511807655'];
const clean=s=>String(s||'').replace(/\s+/g,' ').trim();

async function tryCall(awb,body){
  try{
    const res=await fetch(ENDPOINT,{method:'POST',headers:{'content-type':'application/json','accept':'application/json,text/plain,*/*','user-agent':'Mozilla/5.0','referer':'https://china.saudiacargo.com/e-services/track-shipment'},body:JSON.stringify(body),cache:'no-store',redirect:'follow'});
    const text=await res.text();
    return {status:res.status,ok:res.ok,body:clean(text).slice(0,6000)};
  }catch(e){return {status:0,ok:false,error:clean(e?.message||e)};}
}

export async function GET(){
  const tests=[];
  for(const awb of AWBS){
    tests.push({awb,emptyRecaptcha:await tryCall(awb,{awb,recaptcha:''}),omittedRecaptcha:await tryCall(awb,{awb})});
  }
  return Response.json({ok:true,endpoint:ENDPOINT,tests});
}
