import { normalizeMawb } from './airlines.js';
const URL='https://airasia.smartkargo.com/FrmAWBTracking.aspx';
const clean=s=>String(s||'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<br\s*\/?>/gi,' | ').replace(/<\/(?:tr|td|th|div|p)>/gi,' | ').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/\s+/g,' ').trim();
const attribute=(s,key)=>{const m=String(s).match(new RegExp('\\b'+key+'\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))','i'));return m?.[1]??m?.[2]??m?.[3]??''};
const date=s=>{
 let m=String(s).match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/);if(m)return [m[1],m[2].padStart(2,'0'),m[3].padStart(2,'0')].join('-');
 m=String(s).match(/\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})\b/);
 return m?[m[3],m[2].padStart(2,'0'),m[1].padStart(2,'0')].join('-'):'';
};
const time=s=>{const m=String(s||'').match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);return m?m[1].padStart(2,'0')+':'+m[2]:''};
function parse(html,mawb){
 const full=normalizeMawb(mawb),serial=full.slice(4),text=clean(html);
 // The input textbox can echo a submitted MAWB. An echoed value alone
 // is NOT proof the cargo site returned a shipment.
 const rows=[...String(html).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(m=>clean(m[1]));
 const exactRows=rows.filter(r=>r.includes(serial)||r.includes(full)||r.includes(full.replace('-','')));
 const proof=exactRows.length>0&&/awb|air\s?waybill|shipment|tracking|pieces|weight|origin|destination/i.test(text)&&!/(awb details not available|no records found|no data found|invalid awb)/i.test(text);
 if(!proof)return null;
 const record=text.slice(Math.max(0,text.indexOf(serial)-150),text.indexOf(serial)+15000);
 const field=label=>{const rx=new RegExp('\\b'+label+'\\b\\s*[:|\\-]?\\s*([A-Z0-9.,/ -]{1,55})','i');return (record.match(rx)||[])[1]?.trim()||''};
 const origin=field('Origin').match(/\b[A-Z]{3}\b/i)?.[0]?.toUpperCase()||'';
 const destination=field('Destination').match(/\b[A-Z]{3}\b/i)?.[0]?.toUpperCase()||'';
 const pieces=field('Pieces?').match(/\b\d{1,6}\b/)?.[0]||'';
 const weight=field('Weight').match(/\b[\d,.]+\b/)?.[0]?.replace(/,/g,'')||'';
 const statusRows=rows.filter(r=>/\b(booked|accepted|departed|arrived|offloaded|received from flight|delivered|manifested)\b/i.test(r));
 const milestone=statusRows.at(-1)||'';
 const label=milestone.match(/\b(OFFLOADED|DELIVERED|ARRIVED|RECEIVED FROM FLIGHT|DEPARTED|ACCEPTED|BOOKED|MANIFESTED)\b/i)?.[1]?.toUpperCase()||'';
 const st=label==='RECEIVED FROM FLIGHT'?'ARRIVED':label==='MANIFESTED'||label==='ACCEPTED'?'BOOKED':label||'TRACKING';
 // Do not call a mere flight schedule actual cargo arrival. Keep date blank
 // without a dated final-destination carrier ARR/RCF milestone.
 const isArrival=st==='ARRIVED'&&destination&&new RegExp('\\b'+destination+'\\b').test(milestone);
 const flightNo=(record.match(/\b(?:AK|D7|FD|QZ|Z2)\s*\d{2,4}\b/i)||[])[0]?.replace(/\s/g,'').toUpperCase()||'';
 if(!origin&&!destination&&!pieces&&!weight&&!statusRows.length)return null;
 return {mawb:full,carrierCode:'AK',airlineName:'AirAsia Cargo / Teleport',origin,destination,pieces,bags:pieces,weight,masterWeight:weight,flightNo,
 bookingDate:'',arrivalDate:isArrival?date(milestone):'',arrivalTime:isArrival?time(milestone):'',
 arrivalIsActual:Boolean(isArrival&&date(milestone)),status:isArrival?'ARRIVED':st,
 remarks:st==='OFFLOADED'?'AirAsia official shipment history: OFFLOADED':'',
 officialTracker:URL,source:'AirAsia SmartKargo AWB-specific tracking response',airasiaLiveVerifiedAt:new Date().toISOString()};
}
export async function trackAirAsia(input){
 const mawb=normalizeMawb(input);
 if(!/^807-\d{8}$/.test(mawb))return {ok:false,reason:'INVALID AIRASIA 807 MAWB',officialTracker:URL};
 try{
 const initial=await fetch(URL,{headers:{'user-agent':'Mozilla/5.0','accept':'text/html'},cache:'no-store',signal:AbortSignal.timeout(18000)});
 if(!initial.ok)return {ok:false,reason:'AIRASIA FORM HTTP '+initial.status,officialTracker:URL};
 const html=await initial.text(),form=new URLSearchParams();
 for(const m of html.matchAll(/<input\b[^>]*>/gi)){
  const tag=m[0],name=attribute(tag,'name'),type=attribute(tag,'type').toLowerCase();
  if(name&&type==='hidden')form.set(name,attribute(tag,'value'));
 }
 const allFields=[
  ...[...html.matchAll(/<input\b[^>]*>/gi)].map(m=>({tag:m[0],type:attribute(m[0],'type').toLowerCase()})),
  ...[...html.matchAll(/<textarea\b[^>]*>/gi)].map(m=>({tag:m[0],type:'textarea'}))
 ];
 const getDesc=f=>[attribute(f.tag,'name'),attribute(f.tag,'id'),attribute(f.tag,'placeholder')].join(' ').toLowerCase();
 const prefix=allFields.find(f=>f.type!=='hidden'&&/prefix/.test(getDesc(f)));
 const number=allFields.find(f=>f.type!=='hidden'&&/(awb|airway)/.test(getDesc(f))&&!/prefix/.test(getDesc(f)));
 const submit=allFields.find(f=>/submit|button/.test(f.type)&&/track|go/i.test(getDesc(f)+' '+attribute(f.tag,'value')));
 if(!prefix||!number)return {ok:false,reason:'AIRASIA SMARTKARGO FORM FIELDS NOT FOUND',officialTracker:URL};
 form.set(attribute(prefix.tag,'name'),'807');
 form.set(attribute(number.tag,'name'),mawb.slice(4));
 if(submit)form.set(attribute(submit.tag,'name'),attribute(submit.tag,'value')||'Track');
 const cookie=initial.headers.get('set-cookie')?.split(';')[0]||'';
 const response=await fetch(URL,{method:'POST',headers:{'user-agent':'Mozilla/5.0','content-type':'application/x-www-form-urlencoded','accept':'text/html',origin:'https://airasia.smartkargo.com',referer:URL,...(cookie?{cookie}:{})},body:form.toString(),cache:'no-store',signal:AbortSignal.timeout(20000)});
 if(!response.ok)return {ok:false,reason:'AIRASIA TRACKING HTTP '+response.status,officialTracker:URL};
 const shipment=parse((await response.text()).slice(0,850000),mawb);
 if(!shipment)return {ok:false,reason:'AIRASIA OFFICIAL AWB DATA NOT VERIFIED',officialTracker:URL};
 return {ok:true,shipment,officialTracker:URL,adapter:'AirAsia official SmartKargo'};
 }catch(e){return {ok:false,reason:'AIRASIA CONNECTION: '+String(e?.message||e),officialTracker:URL}}
}
