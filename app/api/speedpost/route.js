import { neon } from '@neondatabase/serverless';
import { readSession } from '../../../lib/mayaviAuth.js';
import { speedPostNumber, trackSpeedPost } from '../../../lib/speedpost.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;

function database(){
  const url=process.env.DATABASE_URL||process.env.POSTGRES_URL||process.env.NEON_DATABASE_URL||process.env.DATABASE_URL_UNPOOLED||'';
  if(!url)throw new Error('Mayavi database is unavailable.');
  return neon(url);
}
function json(body,status=200){
  return Response.json(body,{status,headers:{'cache-control':'no-store'}});
}
async function authorized(request,sql){
  const session=readSession(request);
  if(!session)return{ok:false,status:401,error:'Please log in to Mayavi.'};
  const name=String(session.username||'').trim().toLowerCase();
  if(name!=='admin'&&name!=='sonu')return{ok:false,status:403,error:'Speed Post is private to Admin and Sonu.'};
  const users=await sql`SELECT username,role,is_active FROM mayavi_users WHERE lower(username)=lower(${name}) LIMIT 1`;
  const user=users[0];
  if(!user?.is_active||String(user.username).toLowerCase()!==name||(name==='admin'&&user.role!=='admin'))
    return{ok:false,status:403,error:'Speed Post access is not active.'};
  return{ok:true,username:name};
}
function validStoredField(field,value){
  const v=String(value||'').trim();
  if(!v)return false;
  if(['origin','destination','address'].includes(field)&&/^(COUNTRY|BOOKING OFFICE|ORIGIN|DESTINATION|ADDRESS|POST OFFICE|CITY|STATE|UNKNOWN|N.A|NO DATA|—|-)$/i.test(v))return false;
  return true;
}
function canonicalOrigin(value=''){
  const raw=String(value||'').trim();
  // Canonicalise the actual returned booking office; never fill New Delhi
  // unless a current, AWB-matched tracking response explicitly says Delhi.
  if(/^new\s+delhi(?:\b|,|\s+-)/i.test(raw)||/^delhi\s+foreign\s+post(?:\b|,|\s+-)/i.test(raw))return 'New Delhi';
  return raw;
}
// Validate photo OCR before touching customer recipient fields.
function validConsigneeName(v){
  return v.length>=3&&v.length<=100&&/[A-Za-z]{2}/.test(v)
    &&/^[\p{L}][\p{L}.'’\-\s]*[\p{L}]$/u.test(v)
    &&!/^(?:TO|CONSIGNEE|RECIPIENT|FROM|SENDER|ADDRESS|UNKNOWN|CN22)$/i.test(v)
    &&!/sender.?s signature|customs|declaration|postage/i.test(v);
}
function validConsigneeAddress(v){
  if(v.length<15||v.length>700||!/[A-Za-z]{3}/.test(v)||/[|=<>]/.test(v))return false;
  if(/sender.?s signature|size\s*\d|white or green|customs declaration|tariff|postage|CN22|CN23|important/i.test(v))return false;
  // Require physical address evidence; printed CN22 tables often contain a
  // number and letters but are not street addresses.
  const street=/\b\d{1,6}[A-Z]?\s+[A-Za-z0-9' -]{2,45}\s+(?:RD|ROAD|ST|STREET|AVE|AVENUE|LANE|LN|DR|DRIVE|HILL|WAY|CLOSE|COURT|CT|BLVD|PLACE|PL)\b/i;
  const postcode=/\b(?:[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}|[A-Z]\d[A-Z][ -]?\d[A-Z]\d|\d{5}(?:-\d{4})?)\b/i;
  return street.test(v)&&postcode.test(v)&&v.split(',').length>=2;
}
function rowToResult(row){
  return {...(row.data||{}),trackingNo:row.tracking_no,createdAt:row.created_at,updatedAt:row.updated_at};
}

export async function GET(request){
  try{
    const sql=database(),auth=await authorized(request,sql);
    if(!auth.ok)return json({ok:false,error:auth.error},auth.status);
    const rows=await sql`SELECT tracking_no,data,created_at,updated_at FROM mayavi_speedpost ORDER BY updated_at DESC LIMIT 300`;
    return json({ok:true,rows:rows.map(rowToResult)});
  }catch(e){return json({ok:false,error:e?.message||'Speed Post records unavailable.'},503)}
}
export async function POST(request){
  try{
    const sql=database(),auth=await authorized(request,sql);
    if(!auth.ok)return json({ok:false,error:auth.error},auth.status);
    const body=await request.json().catch(()=>({}));
    const trackingNo=speedPostNumber(body?.trackingNo||'');
    if(!trackingNo)return json({ok:false,error:'Use an ED + 9 digits + IN tracking number.'},400);
    const action=body?.action==='refresh'?'refresh':body?.action==='photo-add'?'photo-add':'add';
    // Saving an uploaded parcel photo first associates OCR fields with its own
    // ED number. No external tracking request is required to persist it.
    if(action==='photo-add'){
      const clean=(v,max)=>String(v||'').normalize('NFKC')
        .replace(/[\x00-\x1f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
      const consigneeName=clean(body?.consigneeName,100);
      const consigneeAddress=clean(body?.consigneeAddress,700);
      // Do not store generic labels or an unverified string as a consignee.
      const validName=validConsigneeName(consigneeName);
      const validAddress=validConsigneeAddress(consigneeAddress);
      const now=new Date().toISOString();
      const ocrData={};
      if(validName)ocrData.consigneeName=consigneeName;
      if(validAddress)ocrData.consigneeAddress=consigneeAddress;
      if(validName||validAddress){
        ocrData.consigneeSource='OCR of TO block on user-uploaded EMS photo (unverified)';
        ocrData.consigneeOcrAt=now;
      }
      const initialData=JSON.stringify({
        trackingNo,status:'Pending Tracking',enteredBy:auth.username,
        savedAt:now,...ocrData
      });
      const inserted=await sql`INSERT INTO mayavi_speedpost (tracking_no,data,created_at,updated_at)
        VALUES (${trackingNo},${initialData}::jsonb,NOW(),NOW())
        ON CONFLICT (tracking_no) DO NOTHING
        RETURNING tracking_no,data,created_at,updated_at`;
      if(inserted.length)return json({ok:true,created:true,pendingTracking:true,photoSaved:true,
        row:rowToResult(inserted[0])});
      // Duplicate ED: retain the existing parcel, fill ONLY blank recipient
      // fields. Replace old malformed OCR address with a newly valid address.
      const nameInfo=JSON.stringify(validName?{consigneeName}:{});
      const addressInfo=JSON.stringify(validAddress?{consigneeAddress}:{});
      const metadata=JSON.stringify(validName||validAddress?{
        consigneeSource:'OCR of TO block on uploaded EMS photo (unverified)',
        consigneeOcrAt:now
      }:{});
      const duplicate=await sql`UPDATE mayavi_speedpost
        SET data=jsonb_set(jsonb_set(
          data
          || CASE WHEN COALESCE(BTRIM(data->>'consigneeName'),'')=''
            THEN ${nameInfo}::jsonb ELSE '{}'::jsonb END
          || CASE WHEN COALESCE(BTRIM(data->>'consigneeAddress'),'')=''
             OR ((data->>'consigneeSource') LIKE 'OCR%'
               AND (data->>'consigneeAddress') ~* '(sender.?s signature|size [0-9]|[|=]|white or green|customs declaration)')
            THEN ${addressInfo}::jsonb ELSE '{}'::jsonb END
          || CASE WHEN
              (COALESCE(BTRIM(data->>'consigneeName'),'')='' AND ${validName})
              OR (COALESCE(BTRIM(data->>'consigneeAddress'),'')='' AND ${validAddress})
              OR ((data->>'consigneeSource') LIKE 'OCR%'
                AND (data->>'consigneeAddress') ~* '(sender.?s signature|size [0-9]|[|=]|white or green|customs declaration)' AND ${validAddress})
            THEN ${metadata}::jsonb ELSE '{}'::jsonb END,
          '{duplicateAlert}','true'::jsonb,true),
          '{duplicateCount}',to_jsonb(COALESCE((data->>'duplicateCount')::int,0)+1),true),
          updated_at=NOW()
        WHERE tracking_no=${trackingNo}
        RETURNING tracking_no,data,created_at,updated_at`;
      if(duplicate.length)return json({ok:true,duplicate:true,photoSaved:true,
        consigneeDataRead:validName||validAddress,row:rowToResult(duplicate[0]),
        message:validName||validAddress?
          'Existing ED retained; missing consignee fields filled where readable.':
          'Existing ED retained. OCR recipient text unclear; review the photo.'});
      return json({ok:false,error:'Could not save the ED photo record.'},503);
    }
    // Same ED entered again is a duplicate ADD, not a second shipment.
    // Return the existing row without expensive tracking or replacing its fields.
    if(action==='add'){
      // First persist the ED number. Remote tracking must never prevent saving.
      // Unique tracking_no enforces one row per packet even for simultaneous adds.
      const initialData=JSON.stringify({
        trackingNo,status:'Pending Tracking',enteredBy:auth.username,
        savedAt:new Date().toISOString()
      });
      // jsonb_build_object() is variadic/polymorphic, so an untyped text
      // placeholder triggers PostgreSQL "could not determine data type of $2".
      // Sending one explicit ::jsonb payload avoids ambiguous parameter types.
      const inserted=await sql`INSERT INTO mayavi_speedpost (tracking_no,data,created_at,updated_at)
        VALUES (${trackingNo},${initialData}::jsonb,NOW(),NOW())
        ON CONFLICT (tracking_no) DO NOTHING
        RETURNING tracking_no,data,created_at,updated_at`;
      if(inserted.length)return json({ok:true,created:true,pendingTracking:true,row:rowToResult(inserted[0]),
        message:'ED number saved. Tracking details are being checked.'});
      // Duplicate entry: blink existing row and global warning, do not add another.
      const duplicate=await sql`UPDATE mayavi_speedpost
        SET data=jsonb_set(
          jsonb_set(
            jsonb_set(data,'{duplicateAlert}','true'::jsonb,true),
            '{duplicateCount}',to_jsonb(COALESCE((data->>'duplicateCount')::integer,0)+1),true),
          '{lastDuplicateAt}',to_jsonb(NOW()::text),true),
          updated_at=NOW()
        WHERE tracking_no=${trackingNo}
        RETURNING tracking_no,data,created_at,updated_at`;
      if(duplicate.length)return json({ok:true,duplicate:true,row:rowToResult(duplicate[0]),
        message:'Duplicate ED number: existing shipment highlighted. No second row created.'});
      return json({ok:false,error:'Could not save or locate the ED record.'},503);
    }
    // Refresh only fetches details for an existing record. Saving was already done.
    const existing=await sql`SELECT tracking_no,data,created_at,updated_at
      FROM mayavi_speedpost WHERE tracking_no=${trackingNo} LIMIT 1`;
    if(!existing.length)return json({ok:false,error:'ED number not saved. Add it first.'},404);
    const result=await trackSpeedPost(trackingNo);
    if(!result.ok){
      // Tracking may be inaccessible or rate-limited: keep the saved ED and all
      // previous fields intact, and surface the pending/error state to the UI.
      return json({ok:true,trackingPending:true,
        error:result.error||'Source unavailable',row:rowToResult(existing[0])});
    }
    const old=await sql`SELECT data FROM mayavi_speedpost WHERE tracking_no=${trackingNo} LIMIT 1`;
    const previous=old?.[0]?.data||{};
    const data={...result.shipment,enteredBy:previous.enteredBy||auth.username,
      retainedFields:[],lastChecked:new Date().toISOString()};
    // Headers such as COUNTRY and BOOKING OFFICE are never shipment locations.
    for(const key of ['origin','destination','address']){
      if(!validStoredField(key,data[key]))data[key]='';
    }
    data.origin=canonicalOrigin(data.origin);
    // A delivered parcel must not regress into Active on a partial refresh.
    if(previous.delivered===true||/^delivered$/i.test(String(previous.status||''))){
      data.delivered=true;
      data.status='Delivered';
      if(previous.deliveredAt&&!data.deliveredAt)data.deliveredAt=previous.deliveredAt;
    }else if(data.delivered===true||/^delivered$/i.test(String(data.status||''))){
      data.delivered=true;
      data.status='Delivered';
      data.deliveredAt=data.deliveredAt||new Date().toISOString();
    }
    // Preserve duplicate warning across ordinary shipment refreshes.
    data.duplicateAlert=previous.duplicateAlert===true;
    data.duplicateCount=Number(previous.duplicateCount)||0;
    if(previous.lastDuplicateAt)data.lastDuplicateAt=previous.lastDuplicateAt;
    // Keep previously verified fields if absent from the newest third-party response;
    // the client marks these retained values as such, never claiming fresh verification.
    for(const field of ['destination','address','tariff','bookingDate','weight','articleType','outForDeliveryAt']){
      if(!data[field]&&validStoredField(field,previous[field])){
        data[field]=previous[field];
        data.retainedFields.push(field);
      }
    }
    // If weight could not be refetched, retain its truthful last source metadata
    // along with the retained number. Never relabel a screenshot as live.
    if(data.retainedFields.includes('weight')){
      if(previous.weightSource)data.weightSource=previous.weightSource;
      if(previous.weightRaw)data.weightRaw=previous.weightRaw;
      if(previous.weightUnitInferred===true)data.weightUnitInferred=true;
    }
    if(data.weight&&data.weightSource?.includes('bare digits interpreted as grams'))data.weightUnitInferred=true;
    // Sender metadata comes from the photo's FROM section after human review.
    // Third-party tracking cannot replace it and routine refresh must retain it.
    if(previous.senderName)data.senderName=previous.senderName;
    if(previous.senderNameSource)data.senderNameSource=previous.senderNameSource;
    if(previous.senderNameConfirmedAt)data.senderNameConfirmedAt=previous.senderNameConfirmedAt;
    // Consignee is read from the photo, not tracking-site location fields.
    for(const key of ['consigneeName','consigneeAddress','consigneeSource','consigneeOcrAt']){
      if(previous[key]&&!data[key])data[key]=previous[key];
    }
    const rows=await sql`INSERT INTO mayavi_speedpost (tracking_no,data,created_at,updated_at)
      VALUES (${trackingNo},${JSON.stringify(data)}::jsonb,NOW(),NOW())
      ON CONFLICT (tracking_no) DO UPDATE SET data=EXCLUDED.data, updated_at=NOW()
      RETURNING tracking_no,data,created_at,updated_at`;
    return json({ok:true,row:rowToResult(rows[0])});
  }catch(e){return json({ok:false,error:e?.message||'Speed Post tracking failed.'},503)}
}
// Admin and Sonu can acknowledge duplicate alerts without deleting the parcel.
export async function PATCH(request){
  try{
    const sql=database(),auth=await authorized(request,sql);
    if(!auth.ok)return json({ok:false,error:auth.error},auth.status);
    const body=await request.json().catch(()=>({}));
    const trackingNo=speedPostNumber(body?.trackingNo||'');
    if(!trackingNo)return json({ok:false,error:'Please confirm a valid ED tracking number.'},400);
    if(body?.action==='save-sender'){
      const senderName=String(body?.senderName||'').normalize('NFKC')
        .replace(/[\x00-\x1f]/g,' ').replace(/\s+/g,' ').trim();
      if(senderName.length<3||senderName.length>100||!/[A-Za-z]{2}/.test(senderName))
        return json({ok:false,error:'Review and enter the sender name from the FROM block.'},400);
      const info=JSON.stringify({
        senderName,
        senderNameSource:'User-confirmed OCR of FROM section of EMS parcel photo',
        senderNameConfirmedAt:new Date().toISOString()
      });
      const stored=await sql`UPDATE mayavi_speedpost
        SET data=data || ${info}::jsonb, updated_at=NOW()
        WHERE tracking_no=${trackingNo}
        RETURNING tracking_no,data,created_at,updated_at`;
      if(!stored.length)return json({ok:false,error:'Save the ED packet first, then confirm its sender name.'},404);
      return json({ok:true,row:rowToResult(stored[0]),senderSaved:true});
    }
    if(body?.action!=='acknowledge-duplicate')
      return json({ok:false,error:'Unsupported Speed Post action.'},400);
    const updated=await sql`UPDATE mayavi_speedpost
      SET data=jsonb_set(data,'{duplicateAlert}','false'::jsonb,true),updated_at=NOW()
      WHERE tracking_no=${trackingNo}
      RETURNING tracking_no,data,created_at,updated_at`;
    if(!updated.length)return json({ok:false,error:'ED tracking record not found.'},404);
    return json({ok:true,row:rowToResult(updated[0])});
  }catch(e){return json({ok:false,error:e?.message||'Duplicate alert acknowledgement failed.'},503)}
}

export async function DELETE(request){
  try{
    const sql=database(),auth=await authorized(request,sql);
    if(!auth.ok)return json({ok:false,error:auth.error},auth.status);
    const body=await request.json().catch(()=>({}));
    const trackingNo=speedPostNumber(body?.trackingNo||'');
    if(!trackingNo)return json({ok:false,error:'Invalid tracking number.'},400);
    const rows=await sql`DELETE FROM mayavi_speedpost WHERE tracking_no=${trackingNo} RETURNING tracking_no`;
    return json({ok:true,deleted:Boolean(rows.length)});
  }catch(e){return json({ok:false,error:e?.message||'Unable to remove tracking number.'},503)}
}
