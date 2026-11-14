// Employee attendance uses local ISO booking dates and explicit recorded events.
// Do not assume Sundays, festivals, unpaid days or check-ins when no entry exists.
export const ATTENDANCE_STATUSES=Object.freeze([
 {value:'PRESENT',label:'Present',tone:'green'},
 {value:'HALF_DAY',label:'Half day',tone:'orange'},
 {value:'PAID_LEAVE',label:'Leave',tone:'indigo'},
 {value:'SICK_LEAVE',label:'Sick leave',tone:'indigo'},
 {value:'UNPAID_LEAVE',label:'Unpaid leave',tone:'amber'},
 {value:'ABSENT',label:'Absent',tone:'red'},
 {value:'HOLIDAY',label:'Company holiday',tone:'blue'},
 {value:'WEEK_OFF',label:'Weekly off',tone:'slate'}
]);
const leaves=new Set(['PAID_LEAVE','SICK_LEAVE','UNPAID_LEAVE']);
const statuses=new Set(ATTENDANCE_STATUSES.map(x=>x.value));
export const attendanceMonth=value=>/^(20\d{2})-(0[1-9]|1[0-2])$/.test(String(value||''))?value:'';
export function attendanceDate(value){
 const s=String(value||'');
 if(!/^20\d{2}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(s))return '';
 const t=new Date(s+'T00:00:00Z');
 return !Number.isNaN(t.valueOf())&&t.toISOString().slice(0,10)===s?s:'';
}
export function attendanceTime(value){
 const s=String(value??'').trim();
 return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(s)?s:'';
}
export const attendanceStatus=value=>statuses.has(value)?value:'';
export const attendanceLabel=value=>ATTENDANCE_STATUSES.find(x=>x.value===value)?.label||'Not marked';
export function deriveLateMinutes({checkIn='',expectedStart='',manualLateMinutes=null,status='PRESENT'}={}){
 if(status!=='PRESENT'&&status!=='HALF_DAY')return null;
 if(manualLateMinutes!==null&&manualLateMinutes!==undefined&&String(manualLateMinutes).trim()!==''){
  const n=Number(manualLateMinutes);
  return Number.isSafeInteger(n)&&n>=0&&n<=1440?n:null;
 }
 const start=attendanceTime(expectedStart),arrived=attendanceTime(checkIn);
 if(!start||!arrived)return null;
 const toMinutes=t=>Number(t.slice(0,2))*60+Number(t.slice(3,5));
 return Math.max(0,toMinutes(arrived)-toMinutes(start));
}
// Only past dates and dates through today in IST count towards a report.
export const todayAttendanceIST=()=>new Date(Date.now()+330*60000).toISOString().slice(0,10);
export function attendanceCountedDates(month,asOfDate=todayAttendanceIST()){
 const m=attendanceMonth(month),day=attendanceDate(asOfDate);
 if(!m||!day)return [];
 const [year,number]=m.split('-').map(Number);
 const max=new Date(Date.UTC(year,number,0)).getUTCDate();
 const current=day.slice(0,7);
 const total=m<current?max:m>current?0:Math.min(max,Number(day.slice(-2)));
 return Array.from({length:total},(_,i)=>m+'-'+String(i+1).padStart(2,'0'));
}
export function attendanceMonthlySummary(employees=[],entries=[],options={}){
 const days=options.month?attendanceCountedDates(options.month,options.asOfDate||todayAttendanceIST()):null;
 const counted=days?new Set(days):null;
 const map=new Map((employees||[]).map(e=>[String(e.id),{
  ...e,present:0,autoPresent:0,leaveDays:0,fullLeave:0,halfLeave:0,
  paidLeave:0,unpaidLeave:0,sickLeave:0,absent:0,
  holidays:0,weeklyOff:0,lateDays:0,lateMinutes:0,marked:0,dates:[]
 }]));
 for(const entry of entries||[]){
  if(counted&&!counted.has(entry.date))continue;
  const e=map.get(String(entry.employeeId));if(!e)continue;
  e.marked++;e.dates.push(entry.date);
  if(entry.status==='PRESENT')e.present++;
  if(entry.status==='HALF_DAY'){e.present+=.5;e.leaveDays+=.5;e.halfLeave++;}
  if(leaves.has(entry.status)){e.leaveDays++;e.fullLeave++;}
  if(entry.status==='PAID_LEAVE')e.paidLeave++;
  if(entry.status==='UNPAID_LEAVE')e.unpaidLeave++;
  if(entry.status==='SICK_LEAVE')e.sickLeave++;
  if(entry.status==='ABSENT')e.absent++;
  if(entry.status==='HOLIDAY')e.holidays++;
  if(entry.status==='WEEK_OFF')e.weeklyOff++;
  const minutes=Number(entry.lateMinutes);
  if(entry.lateMinutes!==null&&entry.lateMinutes!==undefined&&Number.isFinite(minutes)&&minutes>0){
   e.lateDays++;e.lateMinutes+=minutes;
  }
 }
 // Unmarked means Present for counted dates, without writing attendance rows.
 // A recorded WEEK_OFF or HOLIDAY supersedes this default.
 if(days)for(const e of map.values()){
  e.autoPresent=Math.max(0,days.length-new Set(e.dates).size);
  e.present+=e.autoPresent;
 }
 return [...map.values()];
}
export function attendanceRollup(rows=[]){
 return rows.reduce((a,r)=>({
  employees:a.employees+1,present:a.present+r.present,autoPresent:a.autoPresent+r.autoPresent,leaveDays:a.leaveDays+r.leaveDays,fullLeave:a.fullLeave+r.fullLeave,halfLeave:a.halfLeave+r.halfLeave,
  absent:a.absent+r.absent,holidays:a.holidays+r.holidays,weeklyOff:a.weeklyOff+r.weeklyOff,
  lateDays:a.lateDays+r.lateDays,lateMinutes:a.lateMinutes+r.lateMinutes
 }),{employees:0,present:0,autoPresent:0,leaveDays:0,fullLeave:0,halfLeave:0,absent:0,holidays:0,weeklyOff:0,lateDays:0,lateMinutes:0});
}
