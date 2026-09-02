import { normalizeMawb } from './airlines.js';

const BASE='https://api.lufthansa-cargo.com/lhcargo/handling/shipmenttracking/v4/shipment';
const AIRLINE={name:'Lufthansa Cargo',iata:'LH',url:'https://www.lufthansa-cargo.com/eservices/tracking'};

function arr(v){return Array.isArray(v)?v:(v==null?[]:[v]);}
function first(...v){for(const x of v){if(x!==undefined&&x!==null&&String(x)!=='')return x;}return'';}
function normStatus(v=''){
  const s=String(v).toUpperCase();
  if(['DLV','DDL'].includes(s))return'DELIVERED';
  if(['ARR','RCF','NFD'].includes(s))return'ARRIVED';
  if(['DEP','MAN','TFD','RCT'].includes(s))return'IN TRANSIT';
  if(['RCS','BKD'].includes(s))return'BOOKED';
  if(s==='DIS')return'DELAYED';
  return'TRACKING';
}
function splitDateTime(v=''){
  const s=String(v||'').trim();
  if(!s)return{date:'',time:''};
  const m=s.match(/(20\d{2})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})/);
  if(m)return{date:`${m[1]}-${m[2]}-${m[3]}`,time:`${m[4]}:${m[5]}`};
  return{date:'',time:''};
}
function findShipment(root={}){
  return root?.shipmentTrackingStatus?.shipment||root?.shipment||root?.data?.shipmentTrackingStatus?.shipment||root?.data?.shipment||root?.data||root;
}
function milestonesOf(root={},shipment={}){
  const plan=root?.shipmentTrackingStatus?.milestonePlan||root?.milestonePlan||root?.data?.shipmentTrackingStatus?.milestonePlan||shipment?.milestonePlan||{};
  return arr(plan?.milestones?.milestone||plan?.milestone||root?.shipmentTrackingStatus?.shipmentStatusEvents?.event||root?.shipmentStatusEvents?.event);
}
function eventsOf(root={}){
  return arr(root?.shipmentTrackingStatus?.events?.event||root?.events?.event||root?.data?.shipmentTrackingStatus?.events?.event||root?.data?.events?.event);
}

function parse(root,mawb){
  const shipment=findShipment(root); if(!shipment||typeof shipment!=='object')return null;
  const booking=shipment?.booking||root?.shipmentTrackingStatus?.booking||root?.booking||{};
  const events=eventsOf(root); const milestones=milestonesOf(root,shipment);
  const statusCode=first(root?.shipmentTrackingStatus?.status,shipment?.status,root?.status,events?.[0]?.type);
  const routeOrigin=first(booking?.origin,shipment?.origin,milestones.find(x=>x?.flight?.flightSegmentOrigin)?.flight?.flightSegmentOrigin);
  const routeDestination=first(booking?.destination,shipment?.destination,[...milestones].reverse().find(x=>x?.flight?.flightSegmentDestination)?.flight?.flightSegmentDestination);
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
  const status=normStatus(statusCode);
  const out={mawb,carrierCode:'LH',airlineName:'Lufthansa Cargo',origin:String(routeOrigin||'').toUpperCase(),destination:String(routeDestination||'').toUpperCase(),bags:pieces,pieces,weight,flightNo,arrivalDate:dt.date,arrivalTime:dt.time,arrivalIsActual:Boolean(bestEvent?.actualTime||bestMilestone?.actualTime),status,officialTracker:AIRLINE.url,source:'Lufthansa Cargo official Shipment Tracking API'};
  const useful=Boolean((out.origin&&out.destination)||out.pieces||out.weight||out.flightNo||out.arrivalDate||out.status!=='TRACKING');
  return useful?out:null;
}

export async function trackLufthansa(input){
  const mawb=normalizeMawb(input);if(!mawb||!mawb.startsWith('020-'))return{ok:false,reason:'INVALID LUFTHANSA MAWB',airline:AIRLINE};
  const serial=mawb.replace(/\D/g,'').slice(3);
  const url=`${BASE}?aWBPrefix=020&aWBNumber=${serial}`;
  try{
    const r=await fetch(url,{headers:{accept:'application/json','user-agent':'MayaviCargoTracker/3.4'},cache:'no-store',signal:AbortSignal.timeout(12000)});
    const text=await r.text();
    if(r.status===404||/not found|no shipment/i.test(text))return{ok:false,notFound:true,reason:'LUFTHANSA AWB NOT FOUND',airline:AIRLINE,debug:{stage:'NOT_FOUND',status:r.status}};
    if(!r.ok)return{ok:false,reason:`LUFTHANSA API HTTP ${r.status}`,airline:AIRLINE,debug:{stage:'HTTP_ERROR',status:r.status,preview:text.slice(0,180)}};
    let json;try{json=JSON.parse(text)}catch{return{ok:false,reason:'LUFTHANSA API RETURNED NON-JSON RESPONSE',airline:AIRLINE,debug:{stage:'PARSE_ERROR',preview:text.slice(0,180)}};}
    const shipment=parse(json,mawb);
    if(!shipment)return{ok:false,reason:'LUFTHANSA API RETURNED NO VERIFIED SHIPMENT DATA',airline:AIRLINE,debug:{stage:'NO_DATA'}};
    return{ok:true,airline:AIRLINE,shipment,debug:{stage:'SUCCESS',source:'lufthansa-official-api',url}};
  }catch(e){return{ok:false,reason:`LUFTHANSA API ERROR: ${e?.name==='TimeoutError'?'TIMEOUT':(e?.message||String(e))}`,airline:AIRLINE,debug:{stage:'FETCH_ERROR'}};}
}
