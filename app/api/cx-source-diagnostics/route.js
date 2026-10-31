export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=100;
const root='https://www.cathaycargoterminal.com/en-us/Shipment-Tracking';
const numbers=['18860310','18865044','18863806'];
export async function GET(){
 const results=[];
 for(const suffix of numbers){
   for(const url of [root+'?AWBPrefix=160&AWBSuffix='+suffix,root+'/AWBPrefix/160/AWBSuffix/'+suffix,'https://www.cpsl.com.hk/en-us/Shipment-Tracking?AWBPrefix=160&AWBSuffix='+suffix]){
    try{const res=await fetch(url,{redirect:'follow',cache:'no-store',signal:AbortSignal.timeout(9000),headers:{accept:'text/html,application/xhtml+xml','user-agent':'Mozilla/5.0'}});const body=await res.text();const m=body.match(/\\bCX\\s*\\d{2,4}\\b/g)||[];results.push({suffix,url,status:res.status,redirect:res.url,bytes:body.length,exactMatch:body.includes(suffix),flightMatches:[...new Set(m)].slice(0,6),hasRcs:/Received from Shipper|Departure Flight/.test(body),preview:body.includes(suffix)?body.slice(Math.max(0,body.indexOf(suffix)-150),body.indexOf(suffix)+380).replace(/<[^>]*>/g,' ').slice(0,400):body.slice(0,190)});}
    catch(e){results.push({suffix,url,error:String(e?.message||e)});}
   }
 }
 return Response.json({results},{headers:{'Cache-Control':'no-store'}});
}