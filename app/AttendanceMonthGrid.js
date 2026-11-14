'use client';
import {useMemo,useState} from 'react';
import {ATTENDANCE_STATUSES,attendanceMonthlySummary} from '../lib/employeeAttendance.js';
import styles from './AttendanceMonthGrid.module.css';

const shortCodes={PRESENT:'P',HALF_DAY:'½',PAID_LEAVE:'L',SICK_LEAVE:'SL',UNPAID_LEAVE:'UL',ABSENT:'A',HOLIDAY:'H',WEEK_OFF:'WO'};
const labels=Object.fromEntries(ATTENDANCE_STATUSES.map(x=>[x.value,x.label]));
const weekday=date=>new Date(date+'T00:00:00Z').toLocaleDateString('en-IN',{weekday:'short',timeZone:'UTC'});
export function attendanceMonthDates(month){
 if(!/^20\d\d-(0[1-9]|1[0-2])$/.test(String(month||'')))return [];
 const [year,m]=month.split('-').map(Number);
 const days=new Date(Date.UTC(year,m,0)).getUTCDate();
 return Array.from({length:days},(_,i)=>month+'-'+String(i+1).padStart(2,'0'));
}
export default function AttendanceMonthGrid({month,employees=[],entries=[],savingKey='',onQuickMark=()=>{},onEdit=()=>{},onExport=()=>{}}){
 const [mark,setMark]=useState('PRESENT');
 const dates=useMemo(()=>attendanceMonthDates(month),[month]);
 const byDay=useMemo(()=>new Map(entries.map(row=>[String(row.employeeId)+'|'+row.date,row])),[entries]);
 const summaries=useMemo(()=>attendanceMonthlySummary(employees,entries),[employees,entries]);
 const colCount=dates.length+6;
 return <section aria-label="Excel style monthly attendance sheet" className={styles.wrap}>
  <div className={styles.topbar}>
   <div><h2>Monthly Attendance Sheet</h2><p>Employees on the left • dates across the top • monthly totals on the right</p></div>
   <button type="button" className={styles.export} onClick={()=>onExport(dates)}>Download Attendance Sheet CSV</button>
  </div>
  <div className={styles.controls}>
   <label className={styles.picker}>Mark attendance as
    <select aria-label="Choose attendance status for one-click marking" value={mark} onChange={e=>setMark(e.target.value)}>
     {ATTENDANCE_STATUSES.map(status=><option key={status.value} value={status.value}>{shortCodes[status.value]} – {status.label}</option>)}
    </select>
   </label>
   <span className={styles.guide}>Choose a status, then tap a date cell to save. <strong>✎</strong> opens late time / remarks.</span>
  </div>
  <div className={styles.legend} aria-label="Attendance code legend">
   {ATTENDANCE_STATUSES.map(item=><span key={item.value} className={styles.legendItem}><b data-status={item.value}>{shortCodes[item.value]}</b>{item.label}</span>)}
   <span className={styles.legendItem}><b className={styles.lateMark}>●</b>Late arrival</span>
  </div>
  <div className={styles.scroll} role="region" aria-label="Monthly attendance table" tabIndex={0}>
   <table className={styles.sheet}>
    <thead><tr>
     <th className={styles.empHeading}>Employee</th>
     <th className={styles.companyHeading}>Company</th>
     {dates.map(date=><th key={date} className={new Date(date+'T00:00:00Z').getUTCDay()===0?styles.sunday:styles.dateHeading} title={date}>
      <span>{date.slice(-2)}</span><small>{weekday(date)}</small></th>)}
     <th className={styles.totalHeading}>P</th><th className={styles.totalHeading}>Leave</th>
     <th className={styles.totalHeading}>Absent</th><th className={styles.totalHeading}>Late</th>
    </tr></thead>
    <tbody>
     {summaries.map((employee,rowIndex)=><tr key={employee.id}>
      <th scope="row" className={styles.employeeCell}><span>{rowIndex+1}. {employee.employeeName}</span>{!employee.isActive&&<small>Archived</small>}</th>
      <td className={styles.companyCell}>{employee.companyName||'—'}</td>
      {dates.map(date=>{
       const row=byDay.get(String(employee.id)+'|'+date);
       const status=row?.status||'';
       const cellKey=employee.id+'|'+date;
       const onSave=()=>onQuickMark(employee,date,mark,row);
       const isSaving=savingKey===cellKey;
       return <td key={date} className={styles.dayCell} data-status={status||'EMPTY'} data-sunday={new Date(date+'T00:00:00Z').getUTCDay()===0?'yes':'no'}>
        <button type="button" className={styles.markButton} disabled={Boolean(savingKey)||!employee.isActive}
         aria-label={employee.employeeName+', '+date+': '+(labels[status]||'Not marked')+'. Click to mark '+labels[mark]}
         title={(labels[status]||'Not marked')+(row?.remarks?' • '+row.remarks:'')+(row?.lateMinutes>0?' • '+row.lateMinutes+' minutes late':'')}
         onClick={onSave}>{isSaving?'…':shortCodes[status]||'+'}
         {row?.lateMinutes>0&&<span className={styles.lateDot} title={row.lateMinutes+' min late'}/>}
        </button>
        {row&&<button type="button" className={styles.editButton} aria-label={'Edit '+employee.employeeName+' on '+date+' time and remarks'}
         title="Edit check-in time, late minutes, reason" onClick={()=>onEdit(employee,date,row)} disabled={Boolean(savingKey)}>✎</button>}
       </td>;
      })}
      <td className={styles.totalCell}>{employee.present}</td>
      <td className={styles.totalCell} data-alert={employee.leaveDays>0?'yes':'no'}>{employee.leaveDays}</td>
      <td className={styles.totalCell} data-alert={employee.absent>0?'yes':'no'}>{employee.absent}</td>
      <td className={styles.totalCell} data-alert={employee.lateDays>0?'yes':'no'}>{employee.lateDays}</td>
     </tr>)}
     {!summaries.length&&<tr><td colSpan={colCount} className={styles.empty}>No employees match your selection. Change company/search filter or add an employee below.</td></tr>}
    </tbody>
   </table>
  </div>
  <p className={styles.footnote}>Blank (+) means not marked, not absent. Sundays are shaded for convenience but are not automatically holidays. ½ = Half day. Late minutes are recorded in the detail editor, not guessed.</p>
 </section>;
}
