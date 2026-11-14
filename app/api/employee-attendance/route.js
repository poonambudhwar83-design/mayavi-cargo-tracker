import {randomUUID} from 'node:crypto';
import {neon} from '@neondatabase/serverless';
import {readSession} from '../../../lib/mayaviAuth.js';
import {SALARY_COMPANIES,SALARY_DESIGNATIONS,salaryCompany,salaryDesignation,salaryAmount} from '../../../lib/salaryMath.js';
import {attendanceMonth,attendanceDate,attendanceTime,attendanceStatus,deriveLateMinutes} from '../../../lib/employeeAttendance.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const reply=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store, private'}});
const adminOnly=request=>{const s=readSession(request);return s?.role==='admin'?s:null};
const sqlClient=()=>{
 const url=process.env.DATABASE_URL||process.env.POSTGRES_URL||process.env.NEON_DATABASE_URL||process.env.DATABASE_URL_UNPOOLED;
 if(!url)throw Error('Mayavi database unavailable.');
 return neon(url);
};
const validId=value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value||''));
const cleanName=s=>String(s??'').trim().replace(/\s+/g,' ');
async function ensureTables(sql){
 // Uses the existing Salary employee register; does not create a second staff list.
 await sql.query("CREATE TABLE IF NOT EXISTS mayavi_salary_employees(id UUID PRIMARY KEY,employee_name TEXT NOT NULL,company_name TEXT NOT NULL DEFAULT '',designation TEXT NOT NULL DEFAULT '',normalized_name TEXT NOT NULL UNIQUE,default_salary NUMERIC(14,2) NOT NULL DEFAULT 0,is_active BOOLEAN NOT NULL DEFAULT TRUE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
 await sql.query("ALTER TABLE mayavi_salary_employees ADD COLUMN IF NOT EXISTS reporting_time TEXT NOT NULL DEFAULT ''");
 // Separate from Salary is_active: hide from Attendance without deleting payroll
 // employees or historic salary and attendance records.
 await sql.query("ALTER TABLE mayavi_salary_employees ADD COLUMN IF NOT EXISTS attendance_hidden BOOLEAN NOT NULL DEFAULT FALSE");
 await sql.query("CREATE TABLE IF NOT EXISTS mayavi_employee_attendance(employee_id UUID NOT NULL REFERENCES mayavi_salary_employees(id),attendance_date DATE NOT NULL,status TEXT NOT NULL CHECK(status IN ('PRESENT','HALF_DAY','PAID_LEAVE','SICK_LEAVE','UNPAID_LEAVE','ABSENT','HOLIDAY','WEEK_OFF')),check_in TEXT NOT NULL DEFAULT '',expected_start TEXT NOT NULL DEFAULT '',late_minutes INTEGER,remarks TEXT NOT NULL DEFAULT '',updated_by TEXT NOT NULL DEFAULT '',updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(employee_id,attendance_date))");
 await sql.query("CREATE INDEX IF NOT EXISTS mayavi_employee_attendance_date_idx ON mayavi_employee_attendance(attendance_date)");
}
function mapEmployee(row){
 return {id:String(row.id),employeeName:row.employee_name,companyName:row.company_name||'',
 designation:row.designation||'',isActive:row.is_active,reportingTime:row.reporting_time||'',
 attendanceHidden:Boolean(row.attendance_hidden)};
}
function mapEntry(row){
 return {employeeId:String(row.employee_id),date:row.attendance_date,status:row.status,
 checkIn:row.check_in||'',expectedStart:row.expected_start||'',
 lateMinutes:row.late_minutes===null?null:Number(row.late_minutes),remarks:row.remarks||'',
 updatedBy:row.updated_by||'',updatedAt:row.updated_at};
}
export async function GET(request){
 if(!adminOnly(request))return reply({ok:false,error:'Admin only.'},403);
 const month=attendanceMonth(new URL(request.url).searchParams.get('month'));
 if(!month)return reply({ok:false,error:'Select a valid month.'},400);
 try{
  const sql=sqlClient();await ensureTables(sql);
  const [employees,entries]=await Promise.all([
   sql.query("SELECT id,employee_name,company_name,designation,is_active,reporting_time,attendance_hidden FROM mayavi_salary_employees ORDER BY is_active DESC,lower(employee_name)"),
   sql.query("SELECT employee_id,to_char(attendance_date,'YYYY-MM-DD') AS attendance_date,status,check_in,expected_start,late_minutes,remarks,updated_by,updated_at FROM mayavi_employee_attendance WHERE attendance_date >= $1::date AND attendance_date < ($1::date + INTERVAL '1 month') ORDER BY attendance_date DESC",[month+'-01'])
  ]);
  return reply({ok:true,month,employees:employees.map(mapEmployee),entries:entries.map(mapEntry),companies:SALARY_COMPANIES,designations:SALARY_DESIGNATIONS});
 }catch(e){console.error('employee_attendance_get',String(e?.message||e).slice(0,220));return reply({ok:false,error:'Employee attendance could not load.'},503);}
}
export async function POST(request){
 const admin=adminOnly(request);if(!admin)return reply({ok:false,error:'Admin only.'},403);
 const body=await request.json().catch(()=>({}));
 const action=String(body.action||'');
 if(!['add_employee','set_active','save_reporting_time','save_day','delete_day','remove_from_attendance','restore_to_attendance'].includes(action))
  return reply({ok:false,error:'Unsupported employee action.'},400);
 try{
  const sql=sqlClient();await ensureTables(sql);
  if(action==='add_employee'){
   const employeeName=cleanName(body.employeeName),companyName=salaryCompany(body.companyName),designation=salaryDesignation(body.designation);
   if(employeeName.length<2||employeeName.length>100)return reply({ok:false,error:'Enter an employee name (2–100 characters).'},400);
   if(!companyName||!designation)return reply({ok:false,error:'Choose company and designation from the Salary employee list.'},400);
   const amount=body.salaryAmount===''||body.salaryAmount===null||body.salaryAmount===undefined?0:salaryAmount(body.salaryAmount);
   if(amount===null)return reply({ok:false,error:'Invalid basic monthly salary.'},400);
   const reportingTime=body.reportingTime?attendanceTime(body.reportingTime):'';
   if(body.reportingTime&&!reportingTime)return reply({ok:false,error:'Reporting time must be HH:MM.'},400);
   const id=randomUUID();
   const inserted=await sql.query("INSERT INTO mayavi_salary_employees(id,employee_name,company_name,designation,normalized_name,default_salary,reporting_time) VALUES ($1::uuid,$2,$3,$4,$5,$6,$7) ON CONFLICT(normalized_name) DO NOTHING RETURNING id",
    [id,employeeName,companyName,designation,employeeName.toLocaleLowerCase('en-IN'),amount,reportingTime]);
   if(!inserted.length)return reply({ok:false,error:'Employee already exists. Use Restore if archived.'},409);
   return reply({ok:true,id,message:employeeName+' added to Salary and Attendance.'});
  }
  if(!validId(body.employeeId))return reply({ok:false,error:'Select a valid employee.'},400);
  const id=String(body.employeeId);
  if(action==='remove_from_attendance'||action==='restore_to_attendance'){
   if(body.confirm!==true)return reply({ok:false,error:'Confirm employee removal or restore.'},400);
   // "Delete" removes only the Attendance list entry; historic entries and
   // payroll remain intact. Explicit restoration is possible at any time.
   const hide=action==='remove_from_attendance';
   const updated=await sql.query("UPDATE mayavi_salary_employees SET attendance_hidden=$2 WHERE id=$1::uuid RETURNING employee_name,attendance_hidden",[id,hide]);
   if(!updated.length)return reply({ok:false,error:'Employee not found.'},404);
   return reply({ok:true,attendanceHidden:Boolean(updated[0].attendance_hidden),
    message:updated[0].employee_name+(hide?' removed from the Attendance list. Salary and past records are preserved.':' restored to Attendance list.')});
  }
  if(action==='set_active'){
   if(typeof body.isActive!=='boolean')return reply({ok:false,error:'Choose Archive or Restore.'},400);
   const changed=await sql.query("UPDATE mayavi_salary_employees SET is_active=$2 WHERE id=$1::uuid RETURNING employee_name,is_active",[id,body.isActive]);
   if(!changed.length)return reply({ok:false,error:'Employee not found.'},404);
   return reply({ok:true,message:changed[0].employee_name+(body.isActive?' restored.':' archived. Historical salary and attendance preserved.')});
  }
  if(action==='save_reporting_time'){
   const time=body.reportingTime?attendanceTime(body.reportingTime):'';
   if(body.reportingTime&&!time)return reply({ok:false,error:'Reporting time must be HH:MM.'},400);
   const saved=await sql.query("UPDATE mayavi_salary_employees SET reporting_time=$2 WHERE id=$1::uuid AND is_active=TRUE RETURNING employee_name,reporting_time",[id,time]);
   if(!saved.length)return reply({ok:false,error:'Active employee not found.'},404);
   return reply({ok:true,message:'Official reporting time saved for '+saved[0].employee_name+'. Past recorded late minutes preserved.'});
  }
  const date=attendanceDate(body.date);
  if(!date)return reply({ok:false,error:'Enter a valid attendance date.'},400);
  const match=await sql.query("SELECT id,employee_name,reporting_time,is_active,attendance_hidden FROM mayavi_salary_employees WHERE id=$1::uuid LIMIT 1",[id]);
  if(!match.length)return reply({ok:false,error:'Employee not found.'},404);
  if(action==='delete_day'){
   await sql.query("DELETE FROM mayavi_employee_attendance WHERE employee_id=$1::uuid AND attendance_date=$2::date",[id,date]);
   return reply({ok:true,message:'Attendance entry cleared for '+match[0].employee_name+' on '+date+'.'});
  }
  if(!match[0].is_active)return reply({ok:false,error:'Employee is archived. Restore to record new attendance.'},400);
  if(match[0].attendance_hidden)return reply({ok:false,error:'Employee was removed from Attendance. Restore employee to enter attendance.'},400);
  const status=attendanceStatus(body.status);
  if(!status)return reply({ok:false,error:'Select a valid attendance status.'},400);
  const onDuty=status==='PRESENT'||status==='HALF_DAY';
  const checkIn=onDuty&&body.checkIn?attendanceTime(body.checkIn):'';
  if(onDuty&&body.checkIn&&!checkIn)return reply({ok:false,error:'Check-in must be HH:MM.'},400);
  const manual=body.manualLateMinutes===null||body.manualLateMinutes===undefined||String(body.manualLateMinutes).trim()===''?null:Number(body.manualLateMinutes);
  if(manual!==null&&(!Number.isSafeInteger(manual)||manual<0||manual>1440))return reply({ok:false,error:'Late minutes must be between 0 and 1440.'},400);
  const expectedStart=onDuty?match[0].reporting_time||'':'';
  const lateMinutes=deriveLateMinutes({checkIn,expectedStart,manualLateMinutes:manual,status});
  const remarks=cleanName(body.remarks).slice(0,500);
  await sql.query("INSERT INTO mayavi_employee_attendance(employee_id,attendance_date,status,check_in,expected_start,late_minutes,remarks,updated_by) VALUES ($1::uuid,$2::date,$3,$4,$5,$6,$7,$8) ON CONFLICT(employee_id,attendance_date) DO UPDATE SET status=EXCLUDED.status,check_in=EXCLUDED.check_in,expected_start=EXCLUDED.expected_start,late_minutes=EXCLUDED.late_minutes,remarks=EXCLUDED.remarks,updated_by=EXCLUDED.updated_by,updated_at=NOW()",
    [id,date,status,checkIn,expectedStart,lateMinutes,remarks,admin.username||'admin']);
  return reply({ok:true,message:'Attendance saved for '+match[0].employee_name+' on '+date+'.'});
 }catch(e){
  console.error('employee_attendance_post',String(e?.message||e).slice(0,220));
  if(e?.code==='23505')return reply({ok:false,error:'Employee name already exists.'},409);
  return reply({ok:false,error:'Could not save employee attendance.'},503);
 }
}
