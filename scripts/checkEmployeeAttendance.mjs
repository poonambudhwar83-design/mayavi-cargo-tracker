import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {attendanceMonth,attendanceDate,attendanceTime,attendanceStatus,deriveLateMinutes,attendanceMonthlySummary,attendanceRollup} from '../lib/employeeAttendance.js';

assert.equal(attendanceMonth('2026-11'),'2026-11');
assert.equal(attendanceMonth('2026-13'),'');
assert.equal(attendanceDate('2026-02-29'),'');
assert.equal(attendanceDate('2024-02-29'),'2024-02-29');
assert.equal(attendanceDate('2026-11-14'),'2026-11-14');
assert.equal(attendanceTime('09:30'),'09:30');
assert.equal(attendanceTime('25:22'),'');
assert.equal(attendanceStatus('PAID_LEAVE'),'PAID_LEAVE');
assert.equal(attendanceStatus('UNKNOWN'),'');
assert.equal(deriveLateMinutes({status:'PRESENT',expectedStart:'09:30',checkIn:'10:11'}),41);
assert.equal(deriveLateMinutes({status:'PRESENT',expectedStart:'09:30',checkIn:'09:00'}),0);
assert.equal(deriveLateMinutes({status:'HALF_DAY',expectedStart:'09:30',checkIn:'10:40'}),70);
assert.equal(deriveLateMinutes({status:'ABSENT',expectedStart:'09:30',checkIn:'10:40'}),null);
assert.equal(deriveLateMinutes({status:'PRESENT',expectedStart:'09:30',checkIn:'',manualLateMinutes:'12'}),12);
assert.equal(deriveLateMinutes({status:'PRESENT',expectedStart:'09:30',checkIn:'',manualLateMinutes:'2000'}),null);
const employees=[{id:'one',employeeName:'A'},{id:'two',employeeName:'B'}];
const entries=[
 {employeeId:'one',date:'2026-11-02',status:'PRESENT',lateMinutes:22},
 {employeeId:'one',date:'2026-11-03',status:'PRESENT',lateMinutes:0},
 {employeeId:'one',date:'2026-11-04',status:'HALF_DAY',lateMinutes:14},
 {employeeId:'one',date:'2026-11-05',status:'PAID_LEAVE',lateMinutes:null},
 {employeeId:'one',date:'2026-11-06',status:'SICK_LEAVE',lateMinutes:null},
 {employeeId:'one',date:'2026-11-07',status:'UNPAID_LEAVE',lateMinutes:null},
 {employeeId:'one',date:'2026-11-08',status:'HOLIDAY',lateMinutes:null},
 {employeeId:'one',date:'2026-11-09',status:'WEEK_OFF',lateMinutes:null},
 {employeeId:'one',date:'2026-11-10',status:'ABSENT',lateMinutes:null}
];
const rows=attendanceMonthlySummary(employees,entries);
assert.equal(rows.length,2);
assert.equal(rows[0].marked,9);
assert.equal(rows[0].present,2.5);
assert.equal(rows[0].leaveDays,3.5);
assert.equal(rows[0].paidLeave,1);
assert.equal(rows[0].sickLeave,1);
assert.equal(rows[0].unpaidLeave,1);
assert.equal(rows[0].holidays,1);
assert.equal(rows[0].weeklyOff,1);
assert.equal(rows[0].absent,1);
assert.equal(rows[0].lateDays,2);
assert.equal(rows[0].lateMinutes,36);
assert.equal(rows[1].marked,0);
assert.equal(attendanceRollup(rows).leaveDays,3.5);
const api=readFileSync('app/api/employee-attendance/route.js','utf8');
const ui=readFileSync('app/EmployeeAttendanceDashboard.js','utf8');
const navigation=readFileSync('app/UnifiedDashboard.js','utf8');
const sidebar=readFileSync('app/MayaviSidebar.js','utf8');
assert.ok(api.includes("s?.role==='admin'"),'Employee attendance must stay Admin-only');
assert.ok(api.includes('mayavi_salary_employees'),'Reuse existing Salary employee list');
assert.ok(api.includes('mayavi_employee_attendance'),'Persist daily entries');
assert.ok(api.includes('PRIMARY KEY(employee_id,attendance_date)'),'Only one entry for each date and employee');
assert.ok(api.includes('ON CONFLICT(employee_id,attendance_date) DO UPDATE'),'Editable saved attendance');
assert.ok(api.includes('SET is_active=$2'),'Archive and restore employee without deleting salary history');
assert.ok(!api.includes('DELETE FROM mayavi_salary_employees'),'No destructive deletion of salary roster');
const grid=readFileSync('app/AttendanceMonthGrid.js','utf8');
const gridStyles=readFileSync('app/AttendanceMonthGrid.module.css','utf8');
assert.ok(ui.includes("<AttendanceMonthGrid key={month} month={month} employees={list} entries={entries} savingKey={savingKey}"));
assert.ok(ui.includes('async function quickMark(emp,date,status,current)'));
assert.ok(ui.includes("persistGridEntry('save_day',payload,emp.employeeName)"),'Each attendance select must persist immediately');
assert.ok(ui.includes('onSaveDetails={saveGridDetails} onClearDay={clearGridDay}'));
assert.ok(ui.includes('showAdvanced&&<>'),'Long employee forms collapsed by default');
assert.ok(ui.includes('Manage Employees / Late Details'));
assert.ok(ui.includes('downloadMonthlySheet(dates)'));
assert.ok(grid.includes('Monthly Attendance Sheet'));
assert.ok(grid.includes('attendanceMonthDates(month)'));
assert.ok(grid.includes('onQuickMark(employee,date,next,row)'));
assert.ok(grid.includes('onSaveDetails(editor)'));
assert.ok(grid.includes('onClearDay(editor)'));
assert.ok(grid.includes("row?.lateMinutes>0"));
assert.ok(grid.includes('<option value="">+</option>'),'Blank attendance remains unmarked and can be cleared');
assert.ok(grid.includes('className={styles.cellSelect}'),'Every grid cell must be directly editable');
assert.ok(grid.includes('value={status} disabled={Boolean(savingKey)||!employee.isActive}'));
assert.ok(grid.includes('aria-label="Edit day attendance status"'));
assert.ok(grid.includes('aria-label="Employee actual arrival time"'));
assert.ok(grid.includes('aria-label="Employee late minutes"'));
assert.ok(grid.includes('aria-label="Attendance leave or late arrival reason"'));
assert.ok(grid.includes('onChange={event=>{'));
assert.ok(ui.includes("persistGridEntry('delete_day',"),'Clearing an attendance date must persist');
assert.ok(ui.includes("const lateMinutes=deriveLateMinutes("));
assert.ok(gridStyles.includes('.cellSelect{'));
assert.ok(gridStyles.includes('.modalShade{'));
assert.ok(grid.includes('Download Attendance Sheet CSV'));
assert.ok(grid.includes('Sundays are shaded'));
assert.ok(gridStyles.includes('position:sticky'));
assert.ok(gridStyles.includes('.employeeCell,.companyCell'));
assert.ok(gridStyles.includes('.lateDot'));
assert.ok(ui.includes('Employee Attendance & Leave'));
assert.ok(ui.includes('Save Attendance'));
assert.ok(ui.includes('OFFICIAL REPORTING TIME'));
assert.ok(ui.includes('Monthly Attendance Summary'));
assert.ok(ui.includes('Download Summary CSV'));
assert.ok(ui.includes('Download Daily Register CSV'));
assert.ok(ui.includes('Archive'));
assert.ok(navigation.includes("<EmployeeAttendanceDashboard/>"));
assert.ok(sidebar.includes("sections.push({title:'STAFF ATTENDANCE'"));
assert.ok(sidebar.includes("page('attendance','Attendance','EMPLOYEE_ATTENDANCE')"));
assert.ok(!sidebar.includes("page('attendance','Employee Attendance','EMPLOYEE_ATTENDANCE')"));
assert.ok(navigation.includes('>ATTENDANCE</button>'));
console.log('Attendance: monthly holidays, leaves, half days, late timings, archive and staff history verified.');
