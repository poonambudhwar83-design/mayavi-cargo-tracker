import { neon } from '@neondatabase/serverless';
import { trackEthiopian } from '../../../../lib/ethiopian.js';
import { markEthiopianReschedulePending } from '../../../../lib/ethiopianReschedule.js';
import { localAirportTimeToIst } from '../../../../lib/exportIst.js';
import { refreshScope } from '../../../../lib/autoRefreshScope.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=120;

// Refresh ONLY Ethiopian AWBs, independently of the slow general multi-carrier
// cron. Never overwrite Mail, Customs, client details or operator decisions.
const FIELDS=[
  'carrierCode','airlineName','origin','destination','via','pieces','bags',
  'weight','masterWeight','flightNo','flightDate','finalFlightNo',
  'finalFlightDate','flightSchedule','historyEvents','bookingDate',
  'bookingTime','departureDate','departureTime','departureIsActual',
  'departureTimeSource','arrivalDate','arrivalTime','arrivalIsActual',
  'arrivalEstimate','arrivalTimeZone','arrivalTimeSource',
  'scheduledArrivalDate','scheduledArrivalTime','scheduledArrivalTimeZone',
  'scheduledArrivalTimeSource','status','statusSource','sourceStatus',
  'flightTrackingSource','flightTrackingCheckedAt','ethiopianLiveVerifiedAt',
  'arrivalVerifiedAbsent','reschedulePending','rescheduleReason'
];
const digits=x=>String(x||'').replace(/\D/g,'');
const validDate=x=>/^20\d\d-\d\d-\d\d$/.test(String(x||''));
const validTime=x=>/^\d\d:\d\d$/.test(String(x||''));
const ms=(d,t)=>Date.parse(d+'T'+t+':00+05:30');

function isOldInvalidEta(row={}){
  if(row.arrivalIsActual===true||!validDate(row.arrivalDate)||!validTime(row.arrivalTime))return false;
  const leg=(row.flightSchedule||[]).filter(l=>l.destination===row.destination&&l.flightNo===row.finalFlightNo).at(-1);
  if(!leg||!leg.origin||!leg.destination)return false;
  const route=new RegExp('\\bfrom\\s+'+leg.origin+'\\s+to\\s+'+leg.destination+'\\b','i');
  const dep=(row.historyEvents||[]).filter(e=>
    /DEPARTED ON FLIGHT|LOADED ON FLIGHT/i.test(String(e.label||''))&&
    route.test(String(e.description||''))&&validDate(e.date)&&validTime(e.time))
    .sort((a,b)=>(a.date+' '+a.time).localeCompare(b.date+' '+b.time)).at(-1);
  if(!dep)return false;
  const converted=localAirportTimeToIst(dep.date,dep.time,leg.origin);
  return Boolean(converted&&ms(row.arrivalDate,row.arrivalTime)<=ms(converted.date,converted.time));
}

async function refreshOne(sql,row){
  const awb=digits(row.awb);
  if(!/^071\d{8}$/.test(awb))return{mawb:awb,ok:false,error:'Invalid Ethiopian AWB'};
  const checkedAt=new Date().toISOString();
  let response;
  try{response=await trackEthiopian(awb);}catch(e){response={ok:false,reason:String(e?.message||e)};}
  if(!response?.ok||!response.shipment?.ethiopianLiveVerifiedAt){
    const error=String(response?.reason||'Ethiopian official tracking unavailable').slice(0,250);
    // Failed carrier request MUST NOT replace last verified flight/movement data.
    await sql`UPDATE mayavi_shipments SET
      data=data||${JSON.stringify({trackingError:error,
        ethiopianLastRefreshSucceeded:false,lastChecked:checkedAt,backendAutoRefresh:true})}::jsonb,
      tracking_checked_at=now() WHERE awb=${awb}`;
    return{mawb:awb,ok:false,error};
  }
  const shipment=markEthiopianReschedulePending(response.shipment);
  const patch={lastChecked:checkedAt,trackingError:'',
    backendAutoRefresh:true,ethiopianLastRefreshSucceeded:true};
  for(const name of FIELDS){
    if(Object.hasOwn(shipment,name)&&shipment[name]!==undefined&&
       shipment[name]!==null&&shipment[name]!=='')patch[name]=shipment[name];
  }
  if(shipment.arrivalVerifiedAbsent===true){
    // Never restore an old ETA when final-leg date verification fails.
    Object.assign(patch,{arrivalDate:'',arrivalTime:'',arrivalIsActual:false,
      arrivalEstimate:false,arrivalVerifiedAbsent:true,
      scheduledArrivalDate:'',scheduledArrivalTime:'',
      arrivalTimeSource:shipment.arrivalTimeSource||'Verified flight ETA not yet available'});
  }else if(shipment.arrivalDate&&shipment.arrivalTime){
    patch.arrivalVerifiedAbsent=false;
  }else if(isOldInvalidEta(row.data)){
    Object.assign(patch,{arrivalDate:'',arrivalTime:'',arrivalIsActual:false,
      arrivalEstimate:false,arrivalVerifiedAbsent:true,
      arrivalTimeSource:'Previous estimated arrival predates verified final departure'});
  }
  if(row.data?.arrivalIsActual===true&&shipment.arrivalIsActual!==true){
    // Do not downgrade a previously confirmed cargo arrival.
    for(const name of ['arrivalDate','arrivalTime','arrivalIsActual',
      'arrivalEstimate','arrivalVerifiedAbsent','arrivalTimeSource'])delete patch[name];
    patch.status=row.data.status||patch.status;
  }
  await sql`UPDATE mayavi_shipments SET data=data||${JSON.stringify(patch)}::jsonb,
    version=version+1,updated_at=now(),tracking_checked_at=now()
    WHERE awb=${awb}`;
  return{mawb:awb,ok:true,status:patch.status||'',
    arrivalDate:patch.arrivalDate||'',arrivalTime:patch.arrivalTime||''};
}

export async function GET(request){
  const secret=process.env.CRON_SECRET;
  if(secret&&request.headers.get('authorization')!=='Bearer '+secret)
    return Response.json({ok:false,error:'Unauthorized'},{status:401});
  const db=process.env.DATABASE_URL||process.env.POSTGRES_URL||
    process.env.NEON_DATABASE_URL||process.env.DATABASE_URL_UNPOOLED||'';
  if(!db)return Response.json({ok:false,error:'Database unavailable'},{status:503});
  try{
    const sql=neon(db);
    const rows=await sql`SELECT awb,data FROM mayavi_shipments
      WHERE awb LIKE '071%' AND COALESCE(data->>'customsCleared','false')!='true'
      ORDER BY updated_at DESC LIMIT 20`;
    const eligible=rows.filter(r=>refreshScope(r.data||{})!=='SKIP');
    const results=[];
    for(let i=0;i<eligible.length;i+=3){
      const batch=await Promise.allSettled(eligible.slice(i,i+3).map(r=>refreshOne(sql,r)));
      for(const x of batch)results.push(x.status==='fulfilled'?x.value:
        {ok:false,error:String(x.reason?.message||x.reason)});
    }
    return Response.json({ok:true,carrier:'ET',skippedOutsideActiveAnd72h:rows.length-eligible.length,checked:results.length,
      refreshed:results.filter(x=>x.ok).length,results});
  }catch(e){return Response.json({ok:false,error:String(e?.message||e)},{status:503});}
}
