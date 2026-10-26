import {randomUUID} from 'node:crypto';
import {neon} from '@neondatabase/serverless';
import {readSession} from '../../../lib/mayaviAuth.js';
import {allowedBranch,dateValid,decimal,LOAD_STATUSES,initialBranchStatus,requiresExtraCost,jepoAmount,branchPayment} from '../../../lib/branchLoads.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const json=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
function connection(){
  const url=process.env.DATABASE_URL||process.env.POSTGRES_URL||process.env.NEON_DATABASE_URL||process.env.DATABASE_URL_UNPOOLED||'';
  if(!url)throw new Error('Shared Mayavi database is not configured.');
  return neon(url);
}
async function authenticate(request,sql){
  const session=readSession(request);
  if(!session)return {error:'Please sign in to Mayavi.',status:401};
  const users=await sql`SELECT username,role,is_active,branch_scope,session_version FROM mayavi_users WHERE lower(username)=${session.username} LIMIT 1`;
  const u=users[0];
  if(!u||!u.is_active||Number(u.session_version)!==Number(session.sessionVersion||0))return {error:'Session revoked. Please log in again.',status:401};
  if(u.role==='admin'&&session.role==='admin')return {admin:true,username:u.username,branch:null};
  const branch=allowedBranch(u.branch_scope)||allowedBranch(u.username);
  if(!branch||u.role!=='employee'||session.role!=='employee')
    return {error:'Jind / Karnal page access is restricted.',status:403};
  return {admin:false,username:u.username,branch};
}
async function ensure(sql){
  await sql`CREATE TABLE IF NOT EXISTS mayavi_branch_loads(
    id TEXT PRIMARY KEY,
    branch TEXT NOT NULL CHECK(branch IN ('JIND','KARNAL')),
    record_date DATE NOT NULL,
    load_kg NUMERIC(15,3) NOT NULL CHECK(load_kg>0),
    rate NUMERIC(15,4) NOT NULL CHECK(rate>=0),
    amount NUMERIC(18,2) GENERATED ALWAYS AS (ROUND(load_kg*rate,2)) STORED,
    received NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK(received>=0),
    balance NUMERIC(18,2) GENERATED ALWAYS AS (ROUND(load_kg*rate,2)-received) STORED,
    jepo_rate NUMERIC(15,4),
    paid_to_jepo NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK(paid_to_jepo>=0),
    paid_to_branch NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK(paid_to_branch>=0),
    extra_cost NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK(extra_cost>=0),
    destination TEXT NOT NULL,
    service TEXT NOT NULL DEFAULT '',
    commodity TEXT NOT NULL DEFAULT '',
    tracking_no TEXT NOT NULL DEFAULT '',
    delivery_status TEXT NOT NULL DEFAULT 'PENDING',
    created_by TEXT NOT NULL DEFAULT '',
    updated_by TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await sql`ALTER TABLE mayavi_branch_loads ADD COLUMN IF NOT EXISTS tracking_no TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE mayavi_branch_loads ADD COLUMN IF NOT EXISTS delivery_status TEXT NOT NULL DEFAULT 'PENDING'`;
  await sql`ALTER TABLE mayavi_branch_loads ADD COLUMN IF NOT EXISTS extra_cost NUMERIC(18,2) NOT NULL DEFAULT 0`;
  // NULL denotes older financial records: show an inferred rate while retaining
  // their original JEPO amount until explicitly edited and saved.
  await sql`ALTER TABLE mayavi_branch_loads ADD COLUMN IF NOT EXISTS jepo_rate NUMERIC(15,4)`;
  await sql`CREATE INDEX IF NOT EXISTS mayavi_branch_loads_date_branch ON mayavi_branch_loads(branch,record_date DESC)`;
}
function textField(value,max=120){return String(value??'').trim().slice(0,max);}
function parse(body,auth){
  const branch=auth.admin?allowedBranch(body.branch):auth.branch;
  const date=textField(body.date,10);
  const weight=decimal(body.weight,3,true),rate=decimal(body.rate,4,true);
  const received=decimal(body.received,2);
  const jepoRate=decimal(body.jepoRate,4,true);
  const paidToJepo=jepoAmount(weight,body.jepoRate);
  const paidToBranch=branchPayment(weight,rate,body.jepoRate);
  const destination=textField(body.destination,100);
  const service=textField(body.service,120),commodity=textField(body.commodity,120);
  const extraCost=requiresExtraCost(commodity)?decimal(body.extraCost,2):0;
  const trackingNo=textField(body.trackingNo,100);
  const status=textField(body.status||initialBranchStatus(branch),30).toUpperCase();
  if(!branch)return {error:'Select Jind or Karnal.'};
  if(!dateValid(date))return {error:'Enter a valid date.'};
  if(weight===null||weight<=0)return {error:'Load received must be greater than 0 kg (up to 3 decimals).'};
  if(rate===null)return {error:'Enter a valid rate (up to 4 decimals).'};
  if(jepoRate===null)return {error:'Enter a valid JEPO Rate per kg (up to 4 decimals).'};
  if([received,paidToJepo,paidToBranch].some(v=>v===null))return {error:'Payments must be valid amounts (up to 2 decimals).'};
  if(paidToBranch<0)return {error:'JEPO Rate is higher than the selling Rate; Paid to Branch cannot be negative.'};
  if(!destination)return {error:'Select or enter destination country.'};
  if(!service)return {error:'Select or enter service.'};
  if(!commodity)return {error:'Select or enter commodity.'};
  if(extraCost===null)return {error:'Extra Cost must be a valid non-negative amount (up to 2 decimals).'};
  if(!LOAD_STATUSES.includes(status))return {error:'Select a valid shipment status.'};
  return {entry:{branch,date,weight,rate,received,jepoRate,paidToJepo,paidToBranch,extraCost,destination,service,commodity,trackingNo,status}};
}
function display(r){return {
  id:r.id,branch:r.branch,date:r.record_date,
  weight:String(r.load_kg),rate:String(r.rate),amount:String(r.amount),
  received:String(r.received),balance:String(r.balance),
  // Existing branch entries predate JEPO Rate. Their paid amount is retained;
  // the rate is inferred for viewing and subsequent edits (never rewritten by GET).
  jepoRate:r.jepo_rate===null||r.jepo_rate===undefined
    ?(Number(r.load_kg)>0?(Number(r.paid_to_jepo)/Number(r.load_kg)).toFixed(4):'0.0000')
    :String(r.jepo_rate),
  paidToJepo:String(r.paid_to_jepo),paidToBranch:String(r.paid_to_branch),extraCost:String(r.extra_cost||0),
  destination:r.destination,service:r.service,commodity:r.commodity,
  trackingNo:r.tracking_no||'',status:r.delivery_status==='PENDING'?initialBranchStatus(r.branch):(r.delivery_status||initialBranchStatus(r.branch)),
  createdBy:r.created_by,updatedBy:r.updated_by,updatedAt:r.updated_at
};}
async function one(sql,id){
  const rows=await sql`SELECT id,branch,to_char(record_date,'YYYY-MM-DD') AS record_date,load_kg,rate,amount,received,balance,
    jepo_rate,paid_to_jepo,paid_to_branch,extra_cost,destination,service,commodity,tracking_no,delivery_status,created_by,updated_by,updated_at
    FROM mayavi_branch_loads WHERE id=${id} LIMIT 1`;
  return rows[0]?display(rows[0]):null;
}
export async function GET(request){
  try{
    const sql=connection(),auth=await authenticate(request,sql);
    if(auth.error)return json({ok:false,error:auth.error},auth.status);
    await ensure(sql);
    const rows=auth.admin
      ?await sql`SELECT id,branch,to_char(record_date,'YYYY-MM-DD') AS record_date,load_kg,rate,amount,received,balance,
        jepo_rate,paid_to_jepo,paid_to_branch,extra_cost,destination,service,commodity,tracking_no,delivery_status,created_by,updated_by,updated_at
        FROM mayavi_branch_loads ORDER BY record_date DESC, created_at DESC LIMIT 10000`
      :await sql`SELECT id,branch,to_char(record_date,'YYYY-MM-DD') AS record_date,load_kg,rate,amount,received,balance,
        jepo_rate,paid_to_jepo,paid_to_branch,extra_cost,destination,service,commodity,tracking_no,delivery_status,created_by,updated_by,updated_at
        FROM mayavi_branch_loads WHERE branch=${auth.branch} ORDER BY record_date DESC, created_at DESC LIMIT 10000`;
    return json({ok:true,rows:rows.map(display),scope:auth.branch||'ALL'});
  }catch(e){return json({ok:false,error:e?.message||'Could not load branch entries.'},503);}
}
export async function POST(request){
  try{
    const sql=connection(),auth=await authenticate(request,sql);
    if(auth.error)return json({ok:false,error:auth.error},auth.status);
    const {entry,error}=parse(await request.json().catch(()=>({})),auth);
    if(error)return json({ok:false,error},400);
    await ensure(sql);
    const id=randomUUID();
    await sql`INSERT INTO mayavi_branch_loads
      (id,branch,record_date,load_kg,rate,received,jepo_rate,paid_to_jepo,paid_to_branch,extra_cost,destination,service,commodity,tracking_no,delivery_status,created_by,updated_by)
      VALUES (${id},${entry.branch},${entry.date}::date,${entry.weight},${entry.rate},${entry.received},${entry.jepoRate},${entry.paidToJepo},${entry.paidToBranch},${entry.extraCost},
       ${entry.destination},${entry.service},${entry.commodity},${entry.trackingNo},${entry.status},${auth.username},${auth.username})`;
    return json({ok:true,row:await one(sql,id)},201);
  }catch(e){return json({ok:false,error:e?.message||'Save failed.'},503);}
}
export async function PATCH(request){
  try{
    const sql=connection(),auth=await authenticate(request,sql);
    if(auth.error)return json({ok:false,error:auth.error},auth.status);
    const body=await request.json().catch(()=>({}));
    const id=textField(body.id,80);
    if(!/^[0-9a-f-]{36}$/i.test(id))return json({ok:false,error:'Invalid entry.'},400);
    // Pure status changes must not silently rewrite historic payout values.
    // The branch scope is enforced in SQL for both operation types.
    if(body.statusOnly===true){
      const status=textField(body.status,30).toUpperCase();
      if(!LOAD_STATUSES.includes(status))return json({ok:false,error:'Invalid shipment status.'},400);
      await ensure(sql);
      const statusRows=auth.admin
        ?await sql`UPDATE mayavi_branch_loads SET delivery_status=${status},updated_by=${auth.username},updated_at=NOW() WHERE id=${id} RETURNING id`
        :await sql`UPDATE mayavi_branch_loads SET delivery_status=${status},updated_by=${auth.username},updated_at=NOW() WHERE id=${id} AND branch=${auth.branch} RETURNING id`;
      return statusRows.length?json({ok:true,row:await one(sql,id)}):json({ok:false,error:'Entry not found or access denied.'},404);
    }
    const {entry,error}=parse(body,auth);
    if(error)return json({ok:false,error},400);
    await ensure(sql);
    const updated=auth.admin
      ?await sql`UPDATE mayavi_branch_loads SET branch=${entry.branch},record_date=${entry.date}::date,load_kg=${entry.weight},rate=${entry.rate},received=${entry.received},
          jepo_rate=${entry.jepoRate},paid_to_jepo=${entry.paidToJepo},paid_to_branch=${entry.paidToBranch},extra_cost=${entry.extraCost},
          destination=${entry.destination},service=${entry.service},commodity=${entry.commodity},tracking_no=${entry.trackingNo},delivery_status=${entry.status},
          updated_by=${auth.username},updated_at=NOW() WHERE id=${id} RETURNING id`
      :await sql`UPDATE mayavi_branch_loads SET record_date=${entry.date}::date,load_kg=${entry.weight},rate=${entry.rate},received=${entry.received},
          jepo_rate=${entry.jepoRate},paid_to_jepo=${entry.paidToJepo},paid_to_branch=${entry.paidToBranch},extra_cost=${entry.extraCost},
          destination=${entry.destination},service=${entry.service},commodity=${entry.commodity},tracking_no=${entry.trackingNo},delivery_status=${entry.status},
          updated_by=${auth.username},updated_at=NOW() WHERE id=${id} AND branch=${auth.branch} RETURNING id`;
    if(!updated.length)return json({ok:false,error:'Entry not found or access denied.'},404);
    return json({ok:true,row:await one(sql,id)});
  }catch(e){return json({ok:false,error:e?.message||'Update failed.'},503);}
}
export async function DELETE(request){
  try{
    const sql=connection(),auth=await authenticate(request,sql);
    if(auth.error)return json({ok:false,error:auth.error},auth.status);
    // Employees may add, edit, and change status, but only Admin may delete.
    // Enforce this on the server: hiding the UI button alone is not sufficient.
    if(!auth.admin)return json({ok:false,error:'Only Admin can delete Jind / Karnal entries.'},403);
    const id=new URL(request.url).searchParams.get('id')||'';
    if(!/^[0-9a-f-]{36}$/i.test(id))return json({ok:false,error:'Invalid entry.'},400);
    await ensure(sql);
    const deleted=await sql`DELETE FROM mayavi_branch_loads WHERE id=${id} RETURNING id`;
    return deleted.length?json({ok:true}):json({ok:false,error:'Entry not found or access denied.'},404);
  }catch(e){return json({ok:false,error:e?.message||'Delete failed.'},503);}
}
