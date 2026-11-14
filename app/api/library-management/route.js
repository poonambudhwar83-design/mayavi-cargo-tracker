import {randomUUID} from 'node:crypto';
import {neon} from '@neondatabase/serverless';
import {readSession} from '../../../lib/mayaviAuth.js';
import {LIBRARY_DURATION_VALUES,libraryDate,libraryRenewalDue,libraryPaidThrough,libraryPayment,libraryTodayIST} from '../../../lib/libraryManagement.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const reply=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store, private'}});
const adminOnly=request=>readSession(request)?.role==='admin';
const validId=value=>/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(String(value||''));
const clean=s=>String(s??'').trim().replace(/\s+/g,' ');
function sqlClient(){
 const url=process.env.DATABASE_URL||process.env.POSTGRES_URL||process.env.NEON_DATABASE_URL||process.env.DATABASE_URL_UNPOOLED;
 if(!url)throw Error('Mayavi database unavailable.');
 return neon(url);
}
async function ensureTables(sql){
 await sql.query("CREATE TABLE IF NOT EXISTS mayavi_library_settings(id SMALLINT PRIMARY KEY CHECK(id=1),seat_capacity INTEGER NOT NULL DEFAULT 225 CHECK(seat_capacity BETWEEN 1 AND 500),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
 await sql.query("INSERT INTO mayavi_library_settings(id,seat_capacity) VALUES (1,225) ON CONFLICT(id) DO NOTHING");
 await sql.query("CREATE TABLE IF NOT EXISTS mayavi_library_students(id UUID PRIMARY KEY,student_name TEXT NOT NULL,seat_type TEXT NOT NULL CHECK(seat_type IN ('WITH_SEAT','WITHOUT_SEAT')),seat_no INTEGER,booking_date DATE NOT NULL,cycle_start DATE NOT NULL,duration_code TEXT NOT NULL,due_date DATE NOT NULL,amount NUMERIC(14,2) NOT NULL DEFAULT 0,payment_kind TEXT NOT NULL DEFAULT 'FULL',pay1 NUMERIC(14,2) NOT NULL DEFAULT 0,pay2 NUMERIC(14,2) NOT NULL DEFAULT 0,pay_mode1 TEXT NOT NULL DEFAULT 'CASH',pay_mode2 TEXT NOT NULL DEFAULT '',remarks TEXT NOT NULL DEFAULT '',is_active BOOLEAN NOT NULL DEFAULT TRUE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),CHECK((seat_type='WITH_SEAT' AND seat_no BETWEEN 1 AND 500) OR (seat_type='WITHOUT_SEAT' AND seat_no IS NULL)))");
 await sql.query("CREATE UNIQUE INDEX IF NOT EXISTS mayavi_library_one_active_student_per_seat ON mayavi_library_students(seat_no) WHERE seat_type='WITH_SEAT' AND is_active=TRUE");
 await sql.query("CREATE INDEX IF NOT EXISTS mayavi_library_due_date_idx ON mayavi_library_students(is_active,due_date)");
 await sql.query("CREATE TABLE IF NOT EXISTS mayavi_library_cycles(id UUID PRIMARY KEY,student_id UUID NOT NULL REFERENCES mayavi_library_students(id),cycle_start DATE NOT NULL,duration_code TEXT NOT NULL,due_date DATE NOT NULL,amount NUMERIC(14,2) NOT NULL,payment_kind TEXT NOT NULL,pay1 NUMERIC(14,2) NOT NULL,pay2 NUMERIC(14,2) NOT NULL,pay_mode1 TEXT NOT NULL,pay_mode2 TEXT NOT NULL,recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(student_id,cycle_start))");
}
const mapped=row=>({
 id:String(row.id),studentName:row.student_name,seatType:row.seat_type,seatNo:row.seat_no===null?null:Number(row.seat_no),
 bookingDate:row.booking_date,cycleStart:row.cycle_start,duration:row.duration_code,dueDate:row.due_date,
 paidThrough:libraryPaidThrough(row.cycle_start,row.duration_code),
 amount:Number(row.amount),paymentKind:row.payment_kind,pay1:Number(row.pay1),pay2:Number(row.pay2),
 payMode1:row.pay_mode1,payMode2:row.pay_mode2,balance:Math.max(0,Math.round((Number(row.amount)-Number(row.pay1)-Number(row.pay2))*100)/100),
 remarks:row.remarks||'',isActive:Boolean(row.is_active)
});
const mapCycle=row=>({
 id:String(row.id),studentId:String(row.student_id),cycleStart:row.cycle_start,duration:row.duration_code,dueDate:row.due_date,
 amount:Number(row.amount),paymentKind:row.payment_kind,pay1:Number(row.pay1),pay2:Number(row.pay2),
 payMode1:row.pay_mode1,payMode2:row.pay_mode2,recordedAt:row.recorded_at
});
const SELECT_STUDENTS="SELECT id,student_name,seat_type,seat_no,to_char(booking_date,'YYYY-MM-DD') AS booking_date,to_char(cycle_start,'YYYY-MM-DD') AS cycle_start,duration_code,to_char(due_date,'YYYY-MM-DD') AS due_date,amount,payment_kind,pay1,pay2,pay_mode1,pay_mode2,remarks,is_active FROM mayavi_library_students";
const SELECT_CYCLES="SELECT id,student_id,to_char(cycle_start,'YYYY-MM-DD') AS cycle_start,duration_code,to_char(due_date,'YYYY-MM-DD') AS due_date,amount,payment_kind,pay1,pay2,pay_mode1,pay_mode2,recorded_at FROM mayavi_library_cycles";
async function getCapacity(sql){
 const rows=await sql.query("SELECT seat_capacity FROM mayavi_library_settings WHERE id=1");
 return Number(rows[0]?.seat_capacity||225);
}
function parseInput(body,capacity){
 const studentName=clean(body.studentName),seatType=body.seatType;
 if(studentName.length<2||studentName.length>120)return {error:'Enter a student name between 2 and 120 characters.'};
 if(!['WITH_SEAT','WITHOUT_SEAT'].includes(seatType))return {error:'Choose With Seat or Without Seat.'};
 const seatNo=seatType==='WITH_SEAT'?Number(body.seatNo):null;
 if(seatType==='WITH_SEAT'&&(!Number.isSafeInteger(seatNo)||seatNo<1||seatNo>capacity))
  return {error:'Seat number must be between 1 and '+capacity+'.'};
 const bookingDate=libraryDate(body.bookingDate);
 if(!bookingDate)return {error:'Select a valid booking date.'};
 const duration=String(body.duration||'');
 if(!LIBRARY_DURATION_VALUES.has(duration))return {error:'Choose 7 days, 15 days or 1–6 months.'};
 const payment=libraryPayment(body);
 if(!payment.ok)return {error:payment.error};
 const remarks=clean(body.remarks).slice(0,600);
 return {studentName,seatType,seatNo,bookingDate,duration,payment,remarks};
}
function parsePayment(body){
 const duration=String(body.duration||'');
 if(!LIBRARY_DURATION_VALUES.has(duration))return {error:'Choose a renewal duration.'};
 const payment=libraryPayment(body);
 if(!payment.ok)return {error:payment.error};
 return {duration,payment};
}
function paymentParams(payment){return [payment.amount,payment.paymentKind,payment.pay1,payment.pay2,payment.payMode1,payment.payMode2]}
export async function GET(request){
 if(!adminOnly(request))return reply({ok:false,error:'Admin only.'},403);
 try{
  const sql=sqlClient();await ensureTables(sql);
  const [capacity,students,cycles]=await Promise.all([
   getCapacity(sql),
   sql.query(SELECT_STUDENTS+" ORDER BY is_active DESC,seat_type,seat_no NULLS LAST,lower(student_name)"),
   sql.query(SELECT_CYCLES+" ORDER BY recorded_at DESC LIMIT 5000")
  ]);
  return reply({ok:true,seatCapacity:capacity,today:libraryTodayIST(),students:students.map(mapped),cycles:cycles.map(mapCycle)});
 }catch(error){
  console.error('library_get',String(error?.message||error).slice(0,250));
  return reply({ok:false,error:'Library register could not load.'},503);
 }
}
export async function POST(request){
 if(!adminOnly(request))return reply({ok:false,error:'Admin only.'},403);
 const body=await request.json().catch(()=>({}));
 const action=String(body.action||'');
 if(!['add_student','update_student','renew','archive_student','restore_student','set_capacity'].includes(action))
  return reply({ok:false,error:'Unsupported library action.'},400);
 try{
  const sql=sqlClient();await ensureTables(sql);
  const capacity=await getCapacity(sql);
  if(action==='set_capacity'){
   const next=Number(body.capacity);
   if(!Number.isSafeInteger(next)||next<1||next>500)return reply({ok:false,error:'Seat capacity must be 1–500.'},400);
   const occupied=await sql.query("SELECT MAX(seat_no) AS highest FROM mayavi_library_students WHERE is_active=TRUE AND seat_type='WITH_SEAT'");
   if(Number(occupied[0]?.highest||0)>next)return reply({ok:false,error:'A currently booked seat is above the new capacity.'},400);
   await sql.query('UPDATE mayavi_library_settings SET seat_capacity=$1,updated_at=NOW() WHERE id=1',[next]);
   return reply({ok:true,message:'Library seat capacity updated to '+next+'.'});
  }
  if(action==='add_student'){
   const parsed=parseInput(body,capacity);if(parsed.error)return reply({ok:false,error:parsed.error},400);
   const {studentName,seatType,seatNo,bookingDate,duration,payment,remarks}=parsed;
   const dueDate=libraryRenewalDue(bookingDate,duration);
   const id=randomUUID(),cycleId=randomUUID();
   // One SQL statement makes the initial booking and its first history cycle atomic.
   const saved=await sql.query("WITH new_student AS (INSERT INTO mayavi_library_students(id,student_name,seat_type,seat_no,booking_date,cycle_start,duration_code,due_date,amount,payment_kind,pay1,pay2,pay_mode1,pay_mode2,remarks) VALUES ($1::uuid,$2,$3,$4,$5::date,$5::date,$6,$7::date,$8,$9,$10,$11,$12,$13,$14) RETURNING id) INSERT INTO mayavi_library_cycles(id,student_id,cycle_start,duration_code,due_date,amount,payment_kind,pay1,pay2,pay_mode1,pay_mode2) SELECT $15::uuid,id,$5::date,$6,$7::date,$8,$9,$10,$11,$12,$13 FROM new_student RETURNING student_id",
    [id,studentName,seatType,seatNo,bookingDate,duration,dueDate,...paymentParams(payment),remarks,cycleId]);
   if(!saved.length)return reply({ok:false,error:'Student was not saved.'},503);
   return reply({ok:true,id,message:studentName+' booked. Renewal due '+dueDate+'.'});
  }
  if(!validId(body.id))return reply({ok:false,error:'Select a valid library student.'},400);
  const id=String(body.id);
  const found=await sql.query(SELECT_STUDENTS+' WHERE id=$1::uuid LIMIT 1',[id]);
  if(!found.length)return reply({ok:false,error:'Student not found.'},404);
  const current=mapped(found[0]);
  if(action==='archive_student'||action==='restore_student'){
   if(body.confirm!==true)return reply({ok:false,error:'Confirm the change.'},400);
   const active=action==='restore_student';
   if(active&&current.seatType==='WITH_SEAT'&&current.seatNo>capacity)return reply({ok:false,error:'Seat exceeds current capacity.'},400);
   await sql.query('UPDATE mayavi_library_students SET is_active=$2,updated_at=NOW() WHERE id=$1::uuid',[id,active]);
   return reply({ok:true,message:current.studentName+(active?' restored.':' archived; seat is available. History is preserved.')});
  }
  if(action==='renew'){
   if(!current.isActive)return reply({ok:false,error:'Restore student before renewal.'},400);
   if(!libraryDate(body.expectedDueDate)||body.expectedDueDate!==current.dueDate)
    return reply({ok:false,error:'Renewal date has changed; refresh the list.'},409);
   const parsed=parsePayment(body);if(parsed.error)return reply({ok:false,error:parsed.error},400);
   // Late renewals restart on payment day so the renewed student leaves the due list.
   const today=libraryTodayIST();
   if(current.dueDate>today)return reply({ok:false,error:'This student is not due yet.'},400);
   const cycleStart=current.dueDate<today?today:current.dueDate;
   const nextDue=libraryRenewalDue(cycleStart,parsed.duration);
   const p=parsed.payment,cycleId=randomUUID();
   const saved=await sql.query("WITH renewed AS (UPDATE mayavi_library_students SET cycle_start=$3::date,duration_code=$4,due_date=$5::date,amount=$6,payment_kind=$7,pay1=$8,pay2=$9,pay_mode1=$10,pay_mode2=$11,updated_at=NOW() WHERE id=$1::uuid AND due_date=$2::date AND is_active=TRUE RETURNING id) INSERT INTO mayavi_library_cycles(id,student_id,cycle_start,duration_code,due_date,amount,payment_kind,pay1,pay2,pay_mode1,pay_mode2) SELECT $12::uuid,id,$3::date,$4,$5::date,$6,$7,$8,$9,$10,$11 FROM renewed RETURNING student_id",
    [id,current.dueDate,cycleStart,parsed.duration,nextDue,...paymentParams(p),cycleId]);
   if(!saved.length)return reply({ok:false,error:'Student was already renewed; refresh.'},409);
   return reply({ok:true,message:current.studentName+' renewed. Next due '+nextDue+'.'});
  }
  if(action==='update_student'){
   if(!current.isActive)return reply({ok:false,error:'Restore student before editing.'},400);
   const parsed=parseInput(body,capacity);if(parsed.error)return reply({ok:false,error:parsed.error},400);
   const {studentName,seatType,seatNo,bookingDate,duration,payment,remarks}=parsed;
   const initialCycle=current.cycleStart===current.bookingDate;
   const cycleStart=initialCycle?bookingDate:current.cycleStart;
   const dueDate=libraryRenewalDue(cycleStart,duration);
   const p=payment;
   // Keep the current paid period and original booking history consistent.
   await sql.query("UPDATE mayavi_library_students SET student_name=$2,seat_type=$3,seat_no=$4,booking_date=$5::date,cycle_start=$6::date,duration_code=$7,due_date=$8::date,amount=$9,payment_kind=$10,pay1=$11,pay2=$12,pay_mode1=$13,pay_mode2=$14,remarks=$15,updated_at=NOW() WHERE id=$1::uuid",
    [id,studentName,seatType,seatNo,bookingDate,cycleStart,duration,dueDate,...paymentParams(p),remarks]);
   await sql.query("UPDATE mayavi_library_cycles SET cycle_start=$2::date,duration_code=$3,due_date=$4::date,amount=$5,payment_kind=$6,pay1=$7,pay2=$8,pay_mode1=$9,pay_mode2=$10 WHERE student_id=$1::uuid AND cycle_start=$11::date",
    [id,cycleStart,duration,dueDate,...paymentParams(p),current.cycleStart]);
   return reply({ok:true,message:studentName+' booking and payment updated.'});
  }
 }catch(error){
  console.error('library_post',String(error?.message||error).slice(0,250));
  if(error?.code==='23505')return reply({ok:false,error:'This seat is already occupied or the renewal was already recorded.'},409);
  return reply({ok:false,error:'Library record could not be saved.'},503);
 }
 return reply({ok:false,error:'Action not completed.'},400);
}
