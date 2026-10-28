import {neon} from '@neondatabase/serverless';
import {readSession} from '../../../lib/mayaviAuth.js';
import {totalJepoForLoad,totalBranchForLoad,initialBranchStatus} from '../../../lib/branchLoads.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const reply=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'private, no-store'}});
const text=(value)=>String(value??'');
function database(){
  const url=process.env.DATABASE_URL||process.env.POSTGRES_URL||process.env.NEON_DATABASE_URL||process.env.DATABASE_URL_UNPOOLED||'';
  if(!url)throw new Error('Mayavi database is unavailable.');
  return neon(url);
}
async function authorize(request,sql){
  const session=readSession(request);
  if(!session||session.role!=='haryana_admin'||session.branchScope!=='HARYANA'||session.username!=='haryanaadmin')return false;
  const users=await sql.query('SELECT username,role,branch_scope,is_active,session_version FROM mayavi_users WHERE lower(username)=$1 LIMIT 1',[session.username]);
  const user=users[0];
  return Boolean(user&&user.username==='haryanaadmin'&&user.role==='employee'&&user.branch_scope==='HARYANA'&&user.is_active&&Number(user.session_version)===Number(session.sessionVersion));
}
function load(row){
  const amount=Number(row.amount||0),jepo=Number(row.paid_to_jepo||0),extra=Number(row.extra_cost||0);
  return {
    id:row.id,branch:row.branch,date:row.record_date,
    weight:text(row.load_kg),rate:text(row.rate),amount:text(row.amount),
    received:text(row.received),balance:text(row.balance),
    jepoRate:text(row.jepo_rate??(Number(row.load_kg)>0?jepo/Number(row.load_kg):0)),
    paidToJepo:text(row.paid_to_jepo),
    paidToBranch:text(totalBranchForLoad(amount,jepo,row.commodity,extra,row.bottle_count,{legacy:true})??0),
    extraCost:text(extra),
    totalJepo:text(totalJepoForLoad(jepo,row.commodity,extra,row.bottle_count,{legacy:true})??0),
    destination:row.destination,service:row.service,commodity:row.commodity,
    bottleCount:row.bottle_count,trackingNo:row.tracking_no||'',
    status:row.delivery_status==='PENDING'?initialBranchStatus(row.branch):row.delivery_status,
    remarks:row.remarks||'',confirmationMode:row.amount_confirmation_mode||'PENDING',
    confirmationNo:row.amount_confirmation_no||'',confirmationName:row.amount_confirmation_name||'',
    confirmationDecision:row.amount_confirmation_decision||'PENDING',
    confirmationApprovedAt:row.amount_confirmation_approved_at||null,
    createdBy:row.created_by||'',updatedBy:row.updated_by||''
  };
}
function master(row){
  const d=row.data||{};
  const parts=Array.isArray(d.partShipments)?d.partShipments:[];
  const pendingParts=parts.filter(p=>p&&p.customsCleared!==true);
  if(d.customsCleared===true&&!pendingParts.length)return null;
  const awb=text(d.mawb||row.awb).replace(/\D/g,'');
  return {
    mawb:awb.length===11?awb.slice(0,3)+'-'+awb.slice(3):text(row.awb),
    airline:text(d.airlineName||d.airline),client:text(d.clientName||d.client),
    company:text(d.companyName||d.companyType),goods:text(d.goodsDescription),
    origin:text(d.origin),destination:text(d.destination),via:text(d.via),
    flightNo:text(d.flightNo||d.flight),flightDate:text(d.flightDate),
    bookingDate:text(d.bookingDate),departureDate:text(d.departureDate),
    departureTime:text(d.departureTime),arrivalDate:text(d.arrivalDate),
    arrivalTime:text(d.arrivalTime),bags:text(d.bags||d.pieces),
    weight:text(d.weight),status:text(d.status),remarks:text(d.remarks),
    enteredBy:text(d.enteredBy),lastChecked:d.lastChecked||row.updated_at,
    parts:pendingParts.map(p=>({
      bags:text(p.bags||p.pieces||p.arrivedPieces),weight:text(p.weight||p.partWeight),
      flightNo:text(p.flightNo),arrivalDate:text(p.arrivalDate),
      arrivalTime:text(p.arrivalTime),status:text(p.status)
    }))
  };
}
export async function GET(request){
  try{
    const sql=database();
    if(!await authorize(request,sql))return reply({ok:false,error:'Haryana Admin login required.'},403);
    const [branchRows,shipmentRows]=await Promise.all([
      sql.query("SELECT id,branch,to_char(record_date,'YYYY-MM-DD') AS record_date,load_kg,rate,amount,received,balance,jepo_rate,paid_to_jepo,extra_cost,destination,service,commodity,bottle_count,tracking_no,remarks,delivery_status,created_by,updated_by,amount_confirmation_no,amount_confirmation_name,amount_confirmation_mode,amount_confirmation_decision,amount_confirmation_approved_at FROM mayavi_branch_loads ORDER BY record_date DESC,created_at DESC LIMIT 10000",[]),
      sql.query("SELECT awb,data,updated_at FROM mayavi_shipments WHERE COALESCE(data->>'shipmentType','IMPORT')='IMPORT' ORDER BY updated_at DESC LIMIT 5000",[])
    ]);
    return reply({ok:true,readOnly:true,branchLoads:branchRows.map(load),
      activeMasters:shipmentRows.map(master).filter(Boolean),updatedAt:new Date().toISOString()});
  }catch(error){
    return reply({ok:false,error:error?.message||'Unable to load Haryana Admin data.'},503);
  }
}
