import { normalizeMawb } from './airlines.js';

const API='https://api.lufthansa-cargo.com/lhcargo/handling/shipmenttracking/v4/shipment';
const PUBLIC='https://www.lufthansa-cargo.com/en/eservices/etracking/tracking/-/awb';
const AIRLINE={name:'Lufthansa Cargo',iata:'LH',url:'https://www.lufthansa-cargo.com/en/eservices/etracking'};

function arr(v){return Array.isArray(v)?v:(v==null?[]:[v]);}
function first(...v){for(const x of v){if(x!==undefined&&x!==null&&String(x)!=='')return x;}return'';}
function normStatus(v=''){
  const s=String(v).toUpperCase();
  if(/\bDLV\b|\bDDL\b|DELIVERED/.test(s))return'DELIVERED';
  if(/\bARR\b|\bRCF\b|\bNFD\b|ARRIVED|RECEIVED FROM FLIGHT/.test(s))return'ARRIVED';
  if(/\bDEP\b|\bMAN\b|\bTFD\b|\bRCT\b|DEPARTED|IN TRANSIT/.test(s))return'IN TRANSIT';
  if(/\bRCS\b|\bBKD\b|BOOKED|RECEIVED FROM SHIPPER/.test(s))return'BOOKED';
  if(/\bDIS\b|DELAY|OFFLOAD|SHORTSHIPPED|MISSING/.test(s))return'DELAYED';
  return'TRACKING';
}
function splitDateTime(v=''){
  const s=String(v||'').trim();if(!s)return{date:'',time:''};
  let m=s.match(/(20\d{2})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})/);
  if(m)return{date:`${m[1]}-${m[2]}-${m[3]}`,time:`${m[4]}:${m[5]}`};
  m=s.match(/(\d{2})[.\/]([01]\d)[.\/](20\d{2})[ T](\d{2}):(\d{2})/);
  if(m)return{date:`${m[3]}-${m[2]}-${m[1]}`,time:`${m[4]}:${m[5]}`};
  return{date:'',time:''};
}
function findShipment(root={}){return root?.shipmentTrackingStatus?.shipment||root?.shipment||root?.data?.shipmentTrackingStatus?.shipment||root?.data?.shipment||root?.data||root;}
function milestonesOf(root={},shipment={}){
  const plan=root?.shipmentTrackingStatus?.milestonePlan||root?.milestonePlan||root?.data?.shipmentTrackingStatus?.milestonePlan||shipment?.milestonePlan||{};
  return arr(plan?.milestones?.milestone||plan?.milestone||root?.shipmentTrackingStatus?.shipmentStatusEvents?.event||root?.shipmentStatusEvents?.event);
}
function eventsOf(root={}){return arr(root?.shipmentTrackingStatus?.events?.event||root?.events?.event||root?.data?.shipmentTrackingStatus?.events?.event||root?.data?.events?.event);}
function parseApi(root,mawb){
  const shipment=findShipment(root);if(!shipment||typeof shipment!=='object')return null;
  const booking=shipment?.booking||root?.shipmentTrackingStatus?.booking||root?.booking||{};
  const events=eventsOf(root),milestones=milestonesOf(root,shipment);
  const statusCode=first(root?.shipmentTrackingStatus?.status,shipment?.status,root?.status,events?.[0]?.type);
  const origin=first(booking?.origin,shipment?.origin,milestones.find(x=>x?.flight?.flightSegmentOrigin)?.flight?.flightSegmentOrigin);
  const destination=first(booking?.destination,shipment?.destination,[...milestones].reverse().find(x=>x?.flight?.flightSegmentDestination)?.flight?.flightSegmentDestination);
  const totals=booking?.totals||shipment?.totals||{};
  const bestEvent=events.find(e=>['DLV','DDL','RCF','ARR'].includes(String(e?.type||'').toUpperCase()))||events[0]||{};
  const bestMilestone=[...milestones].reverse().find(m=>m?.actualTime||m?.plannedTime)||{};
  const flightMilestone=[...milestones].reverse().find(m=>m?.flight?.flightNumber)||{};
  const f=flightMilestone?.flight||{};
  const dt=splitDateTime(first(bestEvent?.actualTime,bestMilestone?.actualTime,bestMilestone?.plannedTime,root?.shipmentTrackingStatus?.flightMovementDetails?.eta));
  const pieces=String(first(bestEvent?.actualTotals?.noOfPieces,bestMilestone?.actualTotals?.noOfPieces,bestMilestone?.plannedTotals?.noOfPieces,totals?.noOfPieces));
  const weight=String(first(bestEvent?.actualTotals?.weight,bestMilestone?.actualTotals?.weight,bestMilestone?.plannedTotals?.weight,totals?.weight));
  const carrier=String(first(f?.flightCarrierCode,root?.shipmentTrackingStatus?.flightMovementDetails?.flightCarrierCode,'LH')).toUpperCase();
  const fn=String(first(f?.flightNumber,root?.shipmentTrackingStatus?.flightMovementDetails?.flightNumber));
  const flightNo=fn?(fn.toUpperCase().startsWith(carrier)?fn.toUpperCase():`${carrier}${fn}`):'';
  const out={mawb,carrierCode:'LH',airlineName:'Lufthansa Cargo',origin:String(origin||'').toUpperCase(),destination:String(destination||'').toUpperCase(),bags:pieces,pieces,weight,flightNo,arrivalDate:dt.date,arrivalTime:dt.time,arrivalIsActual:Boolean(bestEvent?.actualTime||bestMilestone?.actualTime),status:normStatus(statusCode),officialTracker:`${PUBLIC}/020/${mawb.slice(4)}`,source:'Lufthansa Cargo official Shipment Tracking API'};
  return ((out.origin&&out.destination)||out.pieces||out.weight||out.flightNo||out.arrivalDate||out.status!=='TRACKING')?out:null;
}

const decode=s=>String(s||'').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;/gi,"'");
function cleanHtml(html=''){
  return decode(html)
    .replace(/<script[\s\S]*?<\/script>/gi,' ')
    .replace(/<style[\s\S]*?<\/style>/gi,' ')
    .replace(/<[^>]+>/g,' ')
    .replace(/\s+/g,' ').trim();
}
const pick=(s,r)=>(s.match(r)||[])[1]||'';
function parsePublic(html,mawb,url){
  const text=cleanHtml(html),serial=mawb.slice(4),digits=mawb.replace(/\D/g,'');
  if(/shipment not found|no shipment|invalid.*airwaybill|no result/i.test(text))return{notFound:true};
  const mentions=text.includes(serial)||text.includes(digits)||text.includes(mawb);
  const status=normStatus(text);
  const route=text.match(/(?:Origin|From)\s*[:\-]?\s*([A-Z]{3})[\s\S]{0,100}?(?:Destination|To)\s*[:\-]?\s*([A-Z]{3})/i);
  const origin=(route?.[1]||pick(text,/(?:Origin|From)\s*[:\-]?\s*([A-Z]{3})\b/i)).toUpperCase();
  const destination=(route?.[2]||pick(text,/(?:Destination|To)\s*[:\-]?\s*([A-Z]{3})\b/i)).toUpperCase();
  const pieces=pick(text,/(?:Pieces?|Pcs?|Number of Pieces)\s*[:\-]?\s*(\d{1,6})/i)||pick(text,/\b(\d{1,6})\s*(?:PCS|Pieces?)\b/i);
  const weight=(pick(text,/(?:Gross Weight|Weight)\s*[:\-]?\s*([\d,.]+)\s*(?:KG|KGS)?/i)||pick(text,/\b([\d,.]+)\s*(?:KG|KGS)\b/i)).replace(/,/g,'');
  const flights=[...text.matchAll(/\bLH\s*[- ]?(\d{2,4})\b/gi)];
  const flightNo=flights.length?`LH${flights[flights.length-1][1]}`:'';
  let dt=splitDateTime((text.match(/(?:Actual Arrival|Arrival|Arrived|ATA)[\s\S]{0,120}/i)||[])[0]||'');
  let arrivalIsActual=Boolean(dt.date);
  if(!dt.date){dt=splitDateTime((text.match(/(?:Estimated Arrival|Expected Arrival|Scheduled Arrival|ETA)[\s\S]{0,120}/i)||[])[0]||'');arrivalIsActual=false;}
  const out={mawb,carrierCode:'LH',airlineName:'Lufthansa Cargo',origin,destination,bags:pieces,pieces,weight,flightNo,arrivalDate:dt.date,arrivalTime:dt.time,arrivalIsActual,status,officialTracker:url,source:'Lufthansa Cargo public eTracking'};
  const useful=Boolean((origin&&destination)||pieces||weight||flightNo||dt.date||(mentions&&status!=='TRACKING'));
  return useful?{shipment:out}:null;
}
function embeddedUrls(html=''){
  const urls=new Set();
  for(const m of String(html).matchAll(/https?:\/\/(?:origin\.|static\.)?tracking\.lufthansa-cargo\.com[^"'<>\s]*/gi))urls.add(decode(m[0]));
  return [...urls].slice(0,4);
}
async function fetchText(url,ms=10000){
  const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0','accept':'text/html,application/xhtml+xml,application/json','accept-language':'en-US,en;q=0.9'},cache:'no-store',redirect:'follow',signal:AbortSignal.timeout(ms)});
  return{r,text:await r.text()};
}
async function publicFallback(mawb){
  const serial=mawb.slice(4),page=`${PUBLIC}/020/${serial}`;
  let last='';
  try{
    const {r,text}=await fetchText(page,10000);last=`PUBLIC HTTP ${r.status}`;
    if(r.ok){
      const p=parsePublic(text,mawb,page);if(p?.notFound)return{ok:false,notFound:true,reason:'LUFTHANSA AWB NOT FOUND',airline:AIRLINE,debug:{stage:'PUBLIC_NOT_FOUND',url:page}};
      if(p?.shipment)return{ok:true,airline:AIRLINE,shipment:p.shipment,debug:{stage:'SUCCESS',source:'lufthansa-public-page',url:page}};
      for(const base of embeddedUrls(text)){
        const candidates=[base,`${base}${base.includes('?')?'&':'?'}awb=${serial}&prefix=020`,`${base}${base.includes('?')?'&':'?'}aWBNumber=${serial}&aWBPrefix=020`];
        for(const url of candidates){
          try{const x=await fetchText(url,8000);last=`EMBED HTTP ${x.r.status}`;if(!x.r.ok)continue;const q=parsePublic(x.text,mawb,page);if(q?.shipment)return{ok:true,airline:AIRLINE,shipment:q.shipment,debug:{stage:'SUCCESS',source:'lufthansa-public-embed',url}};}catch(e){last=e?.message||String(e);}
        }
      }
    }
  }catch(e){last=e?.message||String(e);}
  return{ok:false,reason:'LUFTHANSA PUBLIC ETRACKING RETURNED NO VERIFIED SHIPMENT DATA',airline:AIRLINE,debug:{stage:'PUBLIC_NO_DATA',last,url:page},officialTracker:page};
}

export async function trackLufthansa(input){
  const mawb=normalizeMawb(input);if(!mawb||!mawb.startsWith('020-'))return{ok:false,reason:'INVALID LUFTHANSA MAWB',airline:AIRLINE};
  const serial=mawb.slice(4),key=process.env.LUFTHANSA_API_KEY;
  let apiFailure='';
  if(key){
    const url=`${API}?aWBPrefix=020&aWBNumber=${serial}`;
    try{
      const r=await fetch(url,{headers:{accept:'application/json',apikey:key,'user-agent':'MayaviCargoTracker/3.5'},cache:'no-store',signal:AbortSignal.timeout(12000)});
      const text=await r.text();
      if(r.status===404||/not found|no shipment/i.test(text))return{ok:false,notFound:true,reason:'LUFTHANSA AWB NOT FOUND',airline:AIRLINE,debug:{stage:'NOT_FOUND',status:r.status}};
      if(r.ok){let json;try{json=JSON.parse(text)}catch{};const shipment=json&&parseApi(json,mawb);if(shipment)return{ok:true,airline:AIRLINE,shipment,debug:{stage:'SUCCESS',source:'lufthansa-official-api',url}};apiFailure='LUFTHANSA API RETURNED NO VERIFIED SHIPMENT DATA';}
      else apiFailure=`LUFTHANSA API HTTP ${r.status}`;
    }catch(e){apiFailure=`LUFTHANSA API ERROR: ${e?.name==='TimeoutError'?'TIMEOUT':(e?.message||String(e))}`;}
  }
  const pub=await publicFallback(mawb);
  if(pub.ok||pub.notFound)return pub;
  return{...pub,reason:apiFailure?`${pub.reason}; ${apiFailure}`:pub.reason,debug:{...pub.debug,apiConfigured:Boolean(key),apiFailure}};
}
