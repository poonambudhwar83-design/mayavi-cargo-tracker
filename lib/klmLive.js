// KLM 074 - official live AWB data only. No user screenshots, cached example,
// inferred weights or login circumvention. The public myCargo endpoint is used
// only while accessible; the sanctioned Cargo Tracking API needs configured
// credentials in Vercel (never passed through the browser).
const digits=v=>String(v??'').replace(/\D/g,'');
const knownDate=s=>/^\d{4}-\d{2}-\d{2}$/.test(String(s||''));
const trim=v=>String(v??'').trim();
const field=(obj,names)=> {
  if(!obj||typeof obj!=='object')return undefined;
  for(const name of names)if(obj[name]!==undefined&&obj[name]!==null&&obj[name]!=='')return obj[name];
};
const code=v=>{
  const s=trim(v&&typeof v==='object'?(field(v,['iataCode','airportCode','stationCode','code','iata','id'])??''):v).toUpperCase();
  return /^[A-Z]{3}$/.test(s)?s:'';
};
const flightNumber=v=>{
  let n=v;
  if(n&&typeof n==='object')n=field(n,['flightNumber','flightNo','number','code']);
  const m=trim(n).toUpperCase().replace(/\s/g,'').match(/^(KL|AF|MP)0*(\d{2,4})$/);
  return m?m[1]+m[2].padStart(3,'0'):'';
};
const weightKg=(v,unit='')=>{
  if(v&&typeof v==='object'&&!Array.isArray(v)){unit=field(v,['unit','uom','weightUnit','unitOfMeasurement'])||unit;v=field(v,['value','amount','quantity','weight','grossWeight']);}
  if(v===undefined||v===null)return'';
  const s=trim(v).match(/^([\d][\d., ]{0,18})\s*(kg|kgs|kgm|kilograms?|lb|lbs|pounds?)?$/i);
  if(!s)return'';
  const u=trim(s[2]||unit).toUpperCase();
  if(u&&!/^(KG|KGS|KGM|KILOGRAMS?|LB|LBS|POUNDS?)$/.test(u))return'';
  let n=s[1].replace(/ /g,'');
  if(n.includes(',')&&n.includes('.'))n=n.lastIndexOf(',')>n.lastIndexOf('.')?n.replace(/\./g,'').replace(',','.'):n.replace(/,/g,'');
  else if(n.includes(','))n=/,\d{1,2}$/.test(n)?n.replace(',','.'):n.replace(/,/g,'');
  else if(/^\d{1,3}(?:\.\d{3})+$/.test(n))n=n.replace(/\./g,'');
  const val=Number(n)*(u.startsWith('LB')||u.startsWith('POUND')?0.45359237:1);
  return Number.isFinite(val)&&val>0&&val<=1000000?String(Number(val.toFixed(3))):'';
};
const datetime=(v)=>{
  const text=trim(v&&typeof v==='object'?field(v,['value','dateTime','time','actual','scheduled']):v);
  if(!text)return null;
  let m=text.match(/^(20\d{2}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?([Zz]|[+-]\d{2}:?\d{2})?$/);
  if(m){
    if(m[3]){
      let off=m[3].toUpperCase();
      if(/^[+-]\d{4}$/.test(off))off=off.slice(0,3)+':'+off.slice(3);
      const date=new Date(text.replace(m[3],off));
      if(!Number.isNaN(date.getTime())){
        const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).map(p=>[p.type,p.value]));
        return{date:parts.year+'-'+parts.month+'-'+parts.day,time:parts.hour+':'+parts.minute,zone:'IST'};
      }
    }
    return{date:m[1],time:m[2],zone:'LOCAL'};
  }
  m=text.match(/^(20\d{2}-\d{2}-\d{2})$/);
  if(m)return{date:m[1],time:'',zone:'LOCAL'};
  return null;
};
function walkers(root){
  const found=[],q=[{v:root,path:'root',depth:0}];let tries=0;
  while(q.length&&tries++<600){
    const {v,path,depth}=q.shift();if(!v||typeof v!=='object'||depth>9)continue;
    if(Array.isArray(v)){for(const a of v.slice(0,60))if(typeof a==='object')q.push({v:a,path,depth:depth+1});continue;}
    found.push({obj:v,path,depth});
    for(const [key,value] of Object.entries(v))if(value&&typeof value==='object'&&
      !/attachment|document|consignee|shipper|address|contact|party|customer|trackingurl/i.test(key))
      q.push({v:value,path:path+'.'+key.toLowerCase(),depth:depth+1});
  }
  return found;
}
function matchesRecord(record,mawb){
  const wanted=digits(mawb);
  if(!record||typeof record!=='object')return false;
  for(const {obj} of walkers(record)){
    for(const [key,v] of Object.entries(obj)){
      if(/^(awb|awbnumber|awbno|airwaybill|airwaybillnumber|airwaybillno|airwaybillid|awbidentifier|airwaybillreference)$/i.test(key.replace(/[^a-z]/ig,''))&&
        (typeof v==='string'||typeof v==='number')&&digits(v)===wanted)return true;
    }
  }
  return false;
}
export function parseKlmLiveJson(payload,mawb,source='KLM official live shipment API'){
  const normalized=digits(mawb);
  if(!/^074\d{8}$/.test(normalized)||!payload||typeof payload!=='object')return null;
  let records=Array.isArray(payload)?payload:
    Array.isArray(payload.shipments)?payload.shipments:
    Array.isArray(payload.data)?payload.data:
    Array.isArray(payload.results)?payload.results:[payload];
  const record=records.find(x=>matchesRecord(x,mawb));
  // An AWB merely appearing in a search box, error payload or page script
  // is not sufficient verification of the actual shipment.
  if(!record)return null;
  const nodes=walkers(record), top=nodes.filter(x=>!/(?:\.events|\.milestones|\.flights|\.legs|\.bookings|\.segments|\.history)/i.test(x.path));
  const main=top.map(x=>x.obj);
  function first(names){for(const obj of main){const value=field(obj,names);if(value!==undefined)return value;}}
  const shipment={
    mawb:normalized.slice(0,3)+'-'+normalized.slice(3),
    airlineName:'KLM Cargo',carrierCode:'KL',
    origin:code(first(['origin','originAirport','originStation','originCode','departureAirport','departureStation'])),
    destination:code(first(['destination','destinationAirport','destinationStation','destinationCode','finalDestination'])),
    status:'TRACKING',arrivalIsActual:false,arrivalEstimate:false,
    officialTracker:'https://www.afklcargo.com/mycargo/shipment/detail/'+normalized.slice(0,3)+'-'+normalized.slice(3),
    source,klmLiveVerifiedAt:new Date().toISOString()
  };
  for(const [label,names] of [
    ['Gross weight',['grossWeight','totalGrossWeight','grossWt','totalWeight','shipmentWeight','weight']],
    ['Chargeable weight',['chargeableWeight','chargeableWt','totalChargeableWeight']]
  ]){
    const v=first(names);const w=weightKg(v,first(['weightUnit','weightUom','unitOfWeight','grossWeightUnit']));
    if(w){shipment.weight=w;shipment.masterWeight=w;shipment.weightSource=source+' - '+label;break;}
  }
  const p=first(['totalPieces','numberOfPieces','pieces','pieceCount','totalPieceCount','numberOfPackages']);
  if(p!==undefined&&/^\d{1,6}$/.test(String(p))){shipment.pieces=String(p);shipment.bags=String(p);shipment.masterPieces=String(p);}
  const legs=[];
  for(const {obj,path} of nodes){
    if(!/(?:bookings|legs|flights|segments|schedule|routing)/i.test(path))continue;
    const fn=flightNumber(field(obj,['flightNumber','flightNo','flight','flightCode']));
    const origin=code(field(obj,['origin','departureStation','departureAirport','from','originAirport']));
    const destination=code(field(obj,['destination','arrivalStation','arrivalAirport','to','destinationAirport']));
    if(!fn||!origin||!destination)continue;
    const dep=datetime(field(obj,['scheduledDeparture','departureDateTime','scheduledDepartureTime','departureTime','departureDate','std']));
    const arr=datetime(field(obj,['scheduledArrival','arrivalDateTime','scheduledArrivalTime','arrivalTime','arrivalDate','sta']));
    legs.push({flightNo:fn,origin,destination,departureDate:dep?.date||'',departureTime:dep?.time||'',
      arrivalDate:arr?.date||'',arrivalTime:arr?.time||'',arrivalTimeZone:arr?.zone||'LOCAL',
      flightStatus:trim(field(obj,['flightStatus','status'])).toUpperCase(),pieces:trim(field(obj,['pieces','numberOfPieces']))});
  }
  const unique=[...new Map(legs.map(x=>[x.flightNo+'|'+x.origin+'|'+x.destination+'|'+x.departureDate,x])).values()];
  if(unique.length){
    const final=unique.findLast(x=>x.destination===shipment.destination)||unique.at(-1);
    shipment.flightSchedule=unique;
    shipment.origin ||=unique[0].origin;
    shipment.destination ||=final.destination;
    if(unique.length>1)shipment.via=unique.slice(0,-1).map(x=>x.destination).join(' / ');
    shipment.flightNo=final.flightNo;shipment.finalFlightNo=final.flightNo;
    shipment.flightDate=final.departureDate;shipment.finalFlightDate=final.departureDate;
    if(final.arrivalDate&&final.arrivalTime){
      shipment.arrivalDate=final.arrivalDate;shipment.arrivalTime=final.arrivalTime;
      shipment.arrivalEstimate=true;
      shipment.arrivalTimeZone=final.arrivalTimeZone==='IST'||final.destination==='DEL'?'IST':'LOCAL';
      shipment.arrivalTimeSource=source+' - final booked flight ETA (not cargo ARR)';
      shipment.scheduledArrivalDate=final.arrivalDate;shipment.scheduledArrivalTime=final.arrivalTime;
      shipment.scheduledArrivalTimeZone=shipment.arrivalTimeZone;
    }
  }
  const events=[];
  for(const {obj,path} of nodes){
    if(!/(?:event|milestone|progress|history)/i.test(path))continue;
    const eventCode=trim(field(obj,['eventCode','eventType','statusCode','fsuCode','code','type'])).toUpperCase();
    if(!/^(BKG|BKD|RCS|DEP|ARR|RCF|DLV)$/.test(eventCode))continue;
    const stamp=datetime(field(obj,['eventActualTime','actualDateTime','eventDateTime','eventTime','dateTime','timestamp']));
    const location=code(field(obj,['station','stationCode','airport','location','locationCode','airportCode']));
    if(stamp?.date&&stamp.time)events.push({eventCode,location,...stamp});
  }
  const booking=events.filter(x=>['BKG','BKD'].includes(x.eventCode)).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time))[0];
  if(booking){shipment.bookingDate=booking.date;shipment.bookingTime=booking.time;}
  else{
    const created=datetime(first(['bookingDate','bookedAt','bookingDateTime']));
    if(created)shipment.bookingDate=created.date;
  }
  const arrived=events.filter(e=>['RCF','ARR','DLV'].includes(e.eventCode)&&e.location&&e.location===shipment.destination)
    .sort((a,b)=>(b.date+b.time).localeCompare(a.date+a.time))[0];
  const departed=events.filter(e=>e.eventCode==='DEP').sort((a,b)=>(b.date+b.time).localeCompare(a.date+a.time))[0];
  if(departed){shipment.departureDate=departed.date;shipment.departureTime=departed.time;shipment.departureTimeZone=departed.zone;shipment.departureIsActual=true;shipment.status='DEPARTED';}
  if(arrived){shipment.arrivalDate=arrived.date;shipment.arrivalTime=arrived.time;
    shipment.arrivalTimeZone=arrived.zone==='IST'||shipment.destination==='DEL'?'IST':'LOCAL';
    shipment.arrivalEstimate=false;shipment.arrivalIsActual=true;
    shipment.arrivalTimeSource=source+' - final destination '+arrived.eventCode+' event';
    shipment.status=arrived.eventCode==='DLV'?'DELIVERED':'ARRIVED';
  }else if(booking||unique.length)shipment.status=departed?'DEPARTED':'BOOKED';
  if(!shipment.origin&&!shipment.destination&&!shipment.weight&&!shipment.pieces&&!shipment.flightNo&&!events.length)return null;
  return shipment;
}
async function apiFetch(url,headers,mawb,source){
  try{
    const res=await fetch(url,{headers,cache:'no-store',signal:AbortSignal.timeout(11000)});
    const contentType=res.headers.get('content-type')||'';
    if(!res.ok)return{ok:false,reason:'HTTP '+res.status,debug:{http:res.status,source}};
    if(!/json/i.test(contentType))return{ok:false,reason:'Non-JSON response',debug:{http:res.status,source,contentType}};
    const data=await res.json();
    const shipment=parseKlmLiveJson(data,mawb,source);
    if(shipment)return{ok:true,shipment,debug:{http:res.status,source,verified:true}};
    return{ok:false,reason:'AWB-matched shipment fields absent',debug:{http:res.status,source,verified:false}};
  }catch(e){return{ok:false,reason:String(e?.message||e),debug:{source,error:String(e?.name||'FetchError')}}}
}
export async function trackKlmFromOfficialLiveApi(mawb){
  const normalized=digits(mawb);
  if(!/^074\d{8}$/.test(normalized))return{ok:false,reason:'Invalid KLM AWB'};
  // First-party public shipment details as used by myCargo. Never scrape a
  // generic page or synthesize results from a previously entered shipment.
  const publicUrl='https://www.afklcargo.com/mycargo/api/tnt-api/shipments/'+normalized.slice(0,3)+'-'+normalized.slice(3);
  const headers={accept:'application/json'};
  const attempts=[];
  const publicResult=await apiFetch(publicUrl,headers,mawb,'AFKLM myCargo live public AWB API');
  if(publicResult.ok)return publicResult;
  attempts.push(publicResult.debug||{reason:publicResult.reason});
  const bearer=process.env.AFKLM_CARGO_API_TOKEN||'';
  const apiKey=process.env.AFKLM_CARGO_API_KEY||'';
  if(bearer||apiKey){
    const credentialed=await apiFetch('https://api.airfranceklm.com/cargo/tracking/awbs/'+normalized,
      {accept:'application/json',...(bearer?{authorization:'Bearer '+bearer}:{}),...(apiKey?{'api-key':apiKey}:{})},
      mawb,'AFKLM authorized Cargo Tracking API');
    if(credentialed.ok)return credentialed;
    attempts.push(credentialed.debug||{reason:credentialed.reason});
  }
  return{ok:false,reason:'Official KLM live AWB API unavailable or shipment data unverified',
    debug:{attempts,cargoApiConfigured:Boolean(bearer||apiKey),publicReason:publicResult.reason}};
}
