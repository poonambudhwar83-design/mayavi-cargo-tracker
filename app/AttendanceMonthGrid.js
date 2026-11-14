'use client';
import {useMemo,useState} from 'react';
import {ATTENDANCE_STATUSES,attendanceMonthlySummary,attendanceCountedDates,deriveLateMinutes} from '../lib/employeeAttendance.js';
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
export default function AttendanceMonthGrid({month,employees=[],entries=[],savingKey='',onQuickMark=()=>{},onSaveDetails=async()=>false,onClearDay=async()=>false,onExport=()=>{},onRemoveEmployee=()=>{},onRestoreEmployee=()=>{}}){
 const [editor,setEditor]=useState(null);
 const dates=useMemo(()=>attendanceMonthDates(month),[month]);
 const byDay=useMemo(()=>new Map(entries.map(row=>[String(row.employeeId)+'|'+row.date,row])),[entries]);
 const summaries=useMemo(()=>attendanceMonthlySummary(employees,entries,{month}),[employees,entries,month]);
 const countedDates=useMemo(()=>new Set(attendanceCountedDates(month)),[month]);
 const colCount=dates.length+6;
 const isOnDuty=editor&&['PRESENT','HALF_DAY'].includes(editor.status);
 const projectedLate=editor?deriveLateMinutes({
  status:editor.status,checkIn:editor.checkIn,expectedStart:editor.reportingTime,manualLateMinutes:editor.manualLateMinutes
 }):null;
 function openEditor(emp,date,row){
  setEditor({employeeId:emp.id,employeeName:emp.employeeName,date,
   status:row?.status||'PRESENT',checkIn:row?.checkIn||'',
   manualLateMinutes:row?.lateMinutes===null||row?.lateMinutes===undefined?'':String(row.lateMinutes),
   remarks:row?.remarks||'',reportingTime:emp.reportingTime||'',existing:Boolean(row)});
 }
 function changeEditor(key,value){setEditor(current=>current?{...current,[key]:value}:current);}
 async function submitEditor(event){
  event.preventDefault();
  if(!editor)return;
  const ok=await onSaveDetails(editor);
  if(ok)setEditor(null);
 }
 async function clearEditor(){
  if(!editor?.existing)return;
  const ok=await onClearDay(editor);
  if(ok)setEditor(null);
 }
 return <section aria-label="Editable Excel-style monthly attendance sheet" className={styles.wrap}>
  <div className={styles.topbar}>
   <div><h2>Monthly Attendance Sheet</h2><p>Excel-style editable attendance • employee names fixed • every date editable</p></div>
   <button type="button" className={styles.export} onClick={()=>onExport(dates)}>Download Attendance Sheet CSV</button>
  </div>
  <div className={styles.controls}>
   <span className={styles.guide}><strong>Tap a date cell to choose P / A / Leave / Half Day.</strong> Changes save directly. Tap ✎ for check-in time, late minutes, reason, or to clear the date.</span>
  </div>
  <div className={styles.legend} aria-label="Attendance code legend">
   {ATTENDANCE_STATUSES.map(item=><span key={item.value} className={styles.legendItem}><b data-status={item.value}>{shortCodes[item.value]}</b>{item.label}</span>)}
   <span className={styles.legendItem}><b className={styles.lateMark}>●</b>Late arrival</span>
  </div>
  <div className={styles.scroll} role="region" aria-label="Editable monthly attendance table" tabIndex={0}>
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
      <th scope="row" className={styles.employeeCell}>
       <span title={employee.employeeName}>{rowIndex+1}. {employee.employeeName}</span>
       <div className={styles.employeeTools}>
        {!employee.isActive&&<small>Archived</small>}
        {employee.attendanceHidden?<button type="button" className={styles.restoreEmployee}
         aria-label={'Restore employee to Attendance: '+employee.employeeName}
         disabled={Boolean(savingKey)} onClick={()=>onRestoreEmployee(employee)}>Restore</button>:
         <button type="button" className={styles.deleteEmployee}
          aria-label={'Delete employee from Attendance: '+employee.employeeName}
          disabled={Boolean(savingKey)} title="Remove from Attendance list only; salary and saved records stay safe"
          onClick={()=>onRemoveEmployee(employee)}>Delete</button>}
       </div>
      </th>
      <td className={styles.companyCell} title={employee.companyName||''}>{employee.companyName||'—'}</td>
      {dates.map(date=>{
       const row=byDay.get(String(employee.id)+'|'+date);
       const implicitPresent=!row&&countedDates.has(date);
       const status=row?.status||(implicitPresent?'PRESENT':'');
       const cellKey=employee.id+'|'+date;
       const isSaving=savingKey===cellKey;
       return <td key={date} className={styles.dayCell} data-status={status||'EMPTY'} data-sunday={new Date(date+'T00:00:00Z').getUTCDay()===0?'yes':'no'}>
        <select className={styles.cellSelect} aria-label={'Edit attendance '+employee.employeeName+' on '+date}
         value={status} disabled={Boolean(savingKey)||!employee.isActive||Boolean(employee.attendanceHidden)}
         title={(implicitPresent?'Present (automatic: no attendance marked)':labels[status]||'Not marked')+(row?.remarks?' • '+row.remarks:'')+(row?.lateMinutes>0?' • '+row.lateMinutes+' minutes late':'')}
         onChange={event=>{
          const next=event.target.value;
          if(next==='')void onClearDay({employeeId:employee.id,date});
          else void onQuickMark(employee,date,next,row);
         }}>
         <option value="">+</option>
         {ATTENDANCE_STATUSES.map(item=><option key={item.value} value={item.value}>{shortCodes[item.value]} – {item.label}</option>)}
        </select>
        {row?.lateMinutes>0&&<span className={styles.lateDot} title={row.lateMinutes+' min late'}/>}
        <button type="button" className={styles.editButton}
         aria-label={'Edit check-in, lateness and remarks for '+employee.employeeName+' on '+date}
         title="Edit time / lateness / remarks" onClick={()=>openEditor(employee,date,row)}
         disabled={Boolean(savingKey)||!employee.isActive||Boolean(employee.attendanceHidden)}>✎</button>
        {isSaving&&<span className={styles.savingMark} aria-label="Saving">…</span>}
       </td>;
      })}
      <td className={styles.totalCell}>{employee.present}</td>
      <td className={styles.totalCell} data-alert={employee.leaveDays>0?'yes':'no'}>{employee.leaveDays}</td>
      <td className={styles.totalCell} data-alert={employee.absent>0?'yes':'no'}>{employee.absent}</td>
      <td className={styles.totalCell} data-alert={employee.lateDays>0?'yes':'no'}>{employee.lateDays}</td>
     </tr>)}
     {!summaries.length&&<tr><td colSpan={colCount} className={styles.empty}>No employees match your selection. Change company/search filter or add an employee.</td></tr>}
    </tbody>
   </table>
  </div>
  <p className={styles.footnote}>Unmarked dates up to today count as Present automatically (P). Future dates are not counted. Sundays count as Present unless explicitly marked Weekly Off or Holiday. Clear (+) returns a date to automatic Present. Late arrivals show an orange dot. Delete hides an employee from Attendance only; Show Deleted allows restoration without losing history.</p>
  {editor&&<div className={styles.modalShade} onMouseDown={event=>{if(event.target===event.currentTarget&&!savingKey)setEditor(null)}}>
   <div className={styles.modal} role="dialog" aria-modal="true" aria-label={'Edit attendance '+editor.employeeName+' '+editor.date}>
    <form onSubmit={submitEditor}>
     <header><div><small>EDIT ATTENDANCE</small><h3>{editor.employeeName}</h3><p>{editor.date.split('-').reverse().join('/')} • {weekday(editor.date)}</p></div>
      <button type="button" className={styles.close} aria-label="Close attendance editor" disabled={Boolean(savingKey)} onClick={()=>setEditor(null)}>✕</button></header>
     <div className={styles.modalFields}>
      <label>Status
       <select aria-label="Edit day attendance status" value={editor.status}
        onChange={event=>{const status=event.target.value;setEditor(current=>({...current,status,checkIn:['PRESENT','HALF_DAY'].includes(status)?current.checkIn:'',manualLateMinutes:['PRESENT','HALF_DAY'].includes(status)?current.manualLateMinutes:''}))}}>
        {ATTENDANCE_STATUSES.map(item=><option key={item.value} value={item.value}>{item.label}</option>)}
       </select>
      </label>
      <label>Check-in time
       <input aria-label="Employee actual arrival time" type="time" value={editor.checkIn} disabled={!isOnDuty}
        onChange={event=>changeEditor('checkIn',event.target.value)}/>
      </label>
      <label>Late minutes (optional)
       <input aria-label="Employee late minutes" type="number" min="0" max="1440" step="1" value={editor.manualLateMinutes} disabled={!isOnDuty} placeholder="Auto from check-in"
        onChange={event=>changeEditor('manualLateMinutes',event.target.value)}/>
      </label>
      <label className={styles.wideField}>Remarks / Reason
       <textarea aria-label="Attendance leave or late arrival reason" rows={3} maxLength={500} value={editor.remarks}
        placeholder="Reason for leave, late arrival or follow-up…" onChange={event=>changeEditor('remarks',event.target.value)}/>
      </label>
     </div>
     <p className={styles.lateHint}>Official reporting: {editor.reportingTime||'Not set'} • Late: {projectedLate===null?'Not calculated':projectedLate+' min'}</p>
     <footer>
      {editor.existing&&<button type="button" className={styles.clear} disabled={Boolean(savingKey)} onClick={()=>void clearEditor()}>Clear This Date</button>}
      <button type="button" className={styles.cancel} disabled={Boolean(savingKey)} onClick={()=>setEditor(null)}>Cancel</button>
      <button type="submit" className={styles.save} disabled={Boolean(savingKey)}>{savingKey?'Saving…':'Save Attendance'}</button>
     </footer>
    </form>
   </div>
  </div>}
 </section>;
}
