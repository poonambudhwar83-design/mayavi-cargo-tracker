import { neon } from '@neondatabase/serverless';
import { trackSpeedPost } from '../../../../lib/speedpost.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;

// Background retry for saved Speed Post EDs. The lookup always asks BOTH
// MySpeedPost EMS and TrackParcel; only ED-matched values are accepted.
function db(){
  const url=process.env.DATABASE_URL||process.env.POSTGRES_URL||process.env.NEON_DATABASE_URL||process.env.DATABASE_URL_UNPOOLED||'';
  if(!url)throw Error('Speed Post database not configured.');
  return neon(url);
}
function good(value){return value!==undefined&&value!==null&&String(value).trim()!==''}
async function updateOne(sql,row){
  const id=String(row.tracking_no||'');
  if(!/^ED\d{9}IN$/.test(id))return{success:false};
  const tracked=await trackSpeedPost(id);
  if(!tracked?.ok||!tracked.shipment)return{success:false};
  const incoming=tracked.shipment;
  // Only reliable, nonempty fields replace saved source data. Never replace
  // consignee (manual/OCR), sender, or user-entered destination.
  const patch={lastChecked:new Date().toISOString(),retainedFields:[]};
  for(const field of [
    'origin','address','tariff','bookingDate','articleType','weight',
    'weightSource','weightRaw','weightUnitInferred','outForDeliveryAt',
    'lastUpdated','source','trackingUrl','detailsSource','trackParcelUrl',
    'trackParcelVerifiedAt','verifiedAt','deliveryTimeSource','deliveredAtText','trackParcelDeliveredAtText'
  ])if(good(incoming[field])&&(field!=='origin'||!/indiapost\.gov\.in|TrackParcel is not India Post|checked 20\d{2}[-/]\d{2}[-/]\d{2}/i.test(String(incoming[field]))))patch[field]=incoming[field];
  if(incoming.outForDelivery===true)patch.outForDelivery=true;
  const destinationPatch=good(incoming.destination)?{destination:incoming.destination}:{};
  // A Delivered label without an actual dated delivery event is not enough.
  // Explicit operator disputes remain Pending Verification until verified.
  const verified=Boolean(incoming.statusVerifiedSource);
  const delivered=verified&&/^delivered$/i.test(String(incoming.status||''))&&
    Boolean(incoming.deliveredAtText);
  const statusPatch=verified?(delivered?
    {status:'Delivered',delivered:true,outForDelivery:false,statusVerifiedSource:incoming.statusVerifiedSource}:
    {status:/^delivered$/i.test(String(incoming.status||''))?'Pending Verification':(incoming.status||'Pending Verification'),delivered:false,statusVerifiedSource:incoming.statusVerifiedSource}):{};
  const statusJson=JSON.stringify(statusPatch);
  await sql`UPDATE mayavi_speedpost SET
    data=data
      || ${JSON.stringify(patch)}::jsonb
      || (CASE WHEN data->>'destinationSource'='Manually entered by operator'
          THEN '{}'::jsonb ELSE ${JSON.stringify(destinationPatch)}::jsonb END)
      || (CASE WHEN COALESCE(data->>'manualStatusResetAt','')<>''
          THEN (CASE WHEN ${delivered} THEN ${statusJson}::jsonb
            ELSE '{"status":"Pending Verification","delivered":false}'::jsonb END)
          ELSE ${statusJson}::jsonb END),
    updated_at=NOW() WHERE tracking_no=${id}`;
  return{success:true,delivered:statusPatch.delivered===true};
}
export async function GET(request){
  const secret=process.env.CRON_SECRET;
  if(!secret||request.headers.get('authorization')!==`Bearer ${secret}`)
    return Response.json({ok:false,error:'Unauthorized.'},{status:401});
  try{
    const sql=db();
    // Oldest checked first. Delivered rows are revisited only while receipt
    // data (tariff/weight/booking/delivery date) remains incomplete.
    const rows=await sql`SELECT tracking_no,data FROM mayavi_speedpost
      WHERE COALESCE(data->>'delivered','false') <> 'true'
        OR COALESCE(data->>'tariff','')=''
        OR COALESCE(data->>'weight','')=''
        OR COALESCE(data->>'bookingDate','')=''
        OR COALESCE(data->>'deliveredAtText','')=''
      ORDER BY COALESCE(data->>'lastChecked','') ASC,updated_at ASC
      LIMIT 12`;
    let checked=0,updated=0,errors=0;
    const workers=Array.from({length:Math.min(3,rows.length)},async(_,worker)=>{
      for(let index=worker;index<rows.length;index+=3){
        checked++;
        try{const outcome=await updateOne(sql,rows[index]);if(outcome.success)updated++;else errors++;}
        catch{errors++;}
      }
    });
    await Promise.all(workers);
    return Response.json({ok:true,checked,updated,errors,
      note:'Incomplete ED rows remain eligible for the next scheduled check.'});
  }catch(e){
    return Response.json({ok:false,error:e?.message||'Speed Post sync unavailable.'},{status:503});
  }
}
