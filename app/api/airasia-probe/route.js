export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=45;
// Temporary public-form integration diagnostic. Never expose cookies, hidden
// token VALUES, user details, whole HTML, or shipper/consignee information.
const URL='https://airasia.smartkargo.com/FrmAWBTracking.aspx';
const attr=(tag,name)=>{const m=String(tag).match(new RegExp('\\b'+name+'\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))','i'));return m?.[1]??m?.[2]??m?.[3]??''};
const clean=x=>String(x||'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]*>/g,' ').replace(/&nbsp;/gi,' ').replace(/\s+/g,' ').trim();
const headers={'user-agent':'Mozilla/5.0 (compatible; Mayavi AirAsia cargo adapter/1.0)','accept':'text/html,application/xhtml+xml','cache-control':'no-cache'};
export async function GET(){
 try{
  const start=Date.now();
  const get=await fetch(URL,{headers,cache:'no-store',signal:AbortSignal.timeout(20000)});
  const html=(await get.text()).slice(0,600000);
  const inputs=[...html.matchAll(/<input\b[^>]*>/gi)].map(m=>({name:attr(m[0],'name'),id:attr(m[0],'id'),type:attr(m[0],'type')||'text',value:attr(m[0],'value'),placeholder:attr(m[0],'placeholder')}));
  for(const m of html.matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/gi)){const tag='<textarea '+m[1]+'>';inputs.push({name:attr(tag,'name'),id:attr(tag,'id'),type:'textarea',value:clean(m[2]),placeholder:attr(tag,'placeholder')});}
  const buttons=[...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/gi)].map(m=>({name:attr(m[0],'name'),id:attr(m[0],'id'),type:attr(m[0],'type'),text:clean(m[0]).slice(0,80)})).slice(0,12);
  const form=(html.match(/<form\b[^>]*>/i)||[])[0]||'';
  const prefix=inputs.find(v=>v.name&&v.type!=='hidden'&&/prefix/i.test(v.id+' '+v.name+' '+v.placeholder));
  const awb=inputs.find(v=>v.name&&v.type!=='hidden'&&/awb|airway/i.test(v.id+' '+v.name+' '+v.placeholder)&&v.name!==prefix?.name);
  const click=inputs.find(v=>v.name&&/submit|button/i.test(v.type)&&/track|search/i.test(v.name+' '+v.value+' '+v.id));
  const meta={http:get.status,url:get.url,elapsedMs:Date.now()-start,title:(html.match(/<title[^>]*>([^<]+)/i)||[])[1]||'',formAction:attr(form,'action'),formMethod:attr(form,'method'),inputs:inputs.filter(v=>v.type!=='hidden').slice(0,15).map(({name,id,type,value,placeholder})=>({name,id,type,placeholder,value:value.slice(0,30)})),hiddenNames:inputs.filter(v=>v.type==='hidden').map(v=>v.name).slice(0,20),buttons};
  if(!prefix||!awb)return Response.json({ok:false,...meta,reason:'Prefix/AWB fields absent',pageSample:clean(html).slice(0,500)});
  const fields=new URLSearchParams();
  for(const f of inputs)if(f.name&&f.type==='hidden')fields.set(f.name,f.value||'');
  fields.set(prefix.name,'807');
  fields.set(awb.name,'12990261');
  if(click)fields.set(click.name,click.value||'Track');
  const cookie=get.headers.get('set-cookie')?.split(';')[0]||'';
  const response=await fetch(URL,{method:'POST',headers:{...headers,'content-type':'application/x-www-form-urlencoded',referer:URL,origin:'https://airasia.smartkargo.com',...(cookie?{cookie}:{})},body:fields.toString(),cache:'no-store',signal:AbortSignal.timeout(20000)});
  const body=(await response.text()).slice(0,850000);
  const txt=clean(body);
  const headersFound=[...body.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map(m=>clean(m[1])).slice(0,45);
  // Emit tracking columns and event labels only, never names/addresses.
  const eventLines=txt.match(/.{0,90}(?:BOOKED|ACCEPTED|DEPARTED|ARRIVED|OFFLOADED|LOAD|STATUS HISTORY|AWB DETAILS|NO DATA|NOT FOUND).{0,120}/gi)||[];
  const bookingRows=[...body.matchAll(/<tr\\b[^>]*>([\\s\\S]*?)<\\/tr>/gi)].map(m=>[...m[1].matchAll(/<td\\b[^>]*>([\\s\\S]*?)<\\/td>/gi)].map(x=>clean(x[1]).slice(0,55))).filter(cells=>cells.some(c=>/^(Booked|Accepted|Departed|Arrived|Offloaded|Received from flight)$/i.test(c))||cells.some(c=>/^(?:AK|NZ|D7|FD)\\s*\\d{2,4}$/i.test(c))).slice(0,12);
  return Response.json({ok:true,bookingRows,...meta,postHttp:response.status,postUrl:response.url,postLength:body.length,responseTitle:(body.match(/<title[^>]*>([^<]+)/i)||[])[1]||'',hasExactMawb:txt.includes('12990261'),has807:txt.includes('807'),headersFound,events:eventLines.slice(0,12).map(x=>x.slice(0,200)),postSample:txt.slice(0,350)});
 }catch(e){return Response.json({ok:false,reason:String(e?.message||e)});}
}
