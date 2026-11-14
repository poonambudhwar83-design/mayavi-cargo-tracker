'use client';
import {useCallback,useEffect,useMemo,useState} from 'react';
import {ATTENDANCE_STATUSES,attendanceMonthlySummary,attendanceRollup,deriveLateMinutes,attendanceLabel} from '../lib/employeeAttendance.js';
import AttendanceMonthGrid from './AttendanceMonthGrid.js';

const API='/api/employee-attendance';
const ink='#17365a',muted='#5e738b',border='#d9e5f2';
const pane={background:'#fff',border:'1px solid '+border,borderRadius:15,padding:18,boxShadow:'0 2px 8px rgba(17,49,86,.035)'};
const input={padding:'9px 11px',background:'#fff',color:'#172c49',border:'1px solid #bed0e3',borderRadius:9,fontSize:13,width:'100%',boxSizing:'border-box'};
const btn={padding:'9px 13px',background:'#e7f0fa',color:'#194b81',fontSize:12,fontWeight:800,border:'1px solid #d6e5f5',borderRadius:9,cursor:'pointer'};
const header={textAlign:'left',position:'sticky',top:0,padding:'11px 10px',whiteSpace:'nowrap',fontSize:12,background:'#e9f2ff',color:ink,borderBottom:'1px solid #d2e2f5'};
const cell={padding:'9px 10px',fontSize:12,borderBottom:'1px solid #eaf0f7',color:'#213e5e',whiteSpace:'nowrap'};
const todayIST=()=>new Date(Date.now()+330*60000).toISOString().slice(0,10);
const formatDate=d=>d?String(d).split('-').reverse().join('/'):'—';
const monthTitle=month=>month?new Date(month+'-01T00:00:00Z').toLocaleDateString('en-IN',{month:'long',year:'numeric',timeZone:'UTC'}):'';
const fmt=v=>Number(v||0).toLocaleString('en-IN',{maximumFractionDigits:2});
const csvEscape=v=>'"'+(/^[=+@\-\t\r]/.test(String(v??''))?"'":'')+String(v??'').replace(/"/g,'""')+'"';
const weekday=date=>date?new Date(date+'T00:00:00Z').toLocaleDateString('en-IN',{weekday:'short',timeZone:'UTC'}):'';
function Field({label,children,wide=false}){return <label style={{display:'grid',gap:5,fontSize:12,fontWeight:800,color:ink,flex:wide?'2 1 220px':'1 1 155px',minWidth:0}}>{label}{children}</label>;}
function StatCard({label,value,note}){return <div style={{background:'#fff',border:'1px solid '+border,borderRadius:12,padding:14}}><div style={{fontSize:11,color:muted,fontWeight:800,textTransform:'uppercase',letterSpacing:.35}}>{label}</div><div style={{fontSize:24,color:ink,fontWeight:900,marginTop:5}}>{value}</div>{note&&<small style={{color:muted}}>{note}</small>}</div>;}
const freshDay=()=>({employeeId:'',date:todayIST(),status:'PRESENT',checkIn:'',manualLateMinutes:'',remarks:''});
export default function EmployeeAttendanceDashboard(){
 const [month,setMonth]=useState(()=>todayIST().slice(0,7));
 const [employees,setEmployees]=useState([]),[entries,setEntries]=useState([]);
 const [company,setCompany]=useState(''),[search,setSearch]=useState(''),[includeArchived,setIncludeArchived]=useState(false);
 const [draft,setDraft]=useState(freshDay),[adding,setAdding]=useState(false),[profile,setProfile]=useState({employeeName:'',companyName:'',designation:'',salaryAmount:'0',reportingTime:''});
 const [startTime,setStartTime]=useState(''),[statusNote,setStatusNote]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
 const [companies,setCompanies]=useState([]),[designations,setDesignations]=useState([]);
 const [showAdvanced,setShowAdvanced]=useState(false);
 const [savingKey,setSavingKey]=useState('');
 const load=useCallback(async()=>{
  setLoading(true);
  try{
   const res=await fetch(API+'?month='+encodeURIComponent(month),{cache:'no-store',credentials:'include'});
   const json=await res.json();
   if(!res.ok||!json.ok)throw Error(json.error||'Attendance could not load.');
   setEmployees(json.employees||[]);setEntries(json.entries||[]);
   setCompanies(json.companies||[]);setDesignations(json.designations||[]);
  }catch(e){setStatusNote(e.message||'Attendance data unavailable.');}
  finally{setLoading(false);}
 },[month]);
 useEffect(()=>{void load();},[load]);
 const selected=employees.find(e=>e.id===draft.employeeId);
 useEffect(()=>{setStartTime(selected?.reportingTime||'');},[selected?.id,selected?.reportingTime]);
 const active=useMemo(()=>employees.filter(e=>e.isActive),[employees]);
 const list=useMemo(()=>employees.filter(e=>(includeArchived||e.isActive)&&(!company||e.companyName===company)&&(!search||e.employeeName.toLowerCase().includes(search.trim().toLowerCase()))),[employees,includeArchived,company,search]);
 const visibleIds=useMemo(()=>new Set(list.map(e=>e.id)),[list]);
 const sums=useMemo(()=>attendanceMonthlySummary(list,entries),[list,entries]);
 const rolled=useMemo(()=>attendanceRollup(sums),[sums]);
 const recent=useMemo(()=>entries.filter(e=>visibleIds.has(e.employeeId)).sort((a,b)=>b.date.localeCompare(a.date)||a.employeeId.localeCompare(b.employeeId)),[entries,visibleIds]);
 const shiftStart=selected?.reportingTime||'';
 const late=deriveLateMinutes({status:draft.status,checkIn:draft.checkIn,expectedStart:shiftStart,manualLateMinutes:draft.manualLateMinutes});
 const field=(k,v)=>setDraft(x=>({...x,[k]:v}));
 async function save(action,payload){
  setBusy(true);setStatusNote('');
  try{
   const res=await fetch(API,{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({action,...payload})});
   const result=await res.json();
   if(!res.ok||!result.ok)throw Error(result.error||'Could not save.');
   setStatusNote('✓ '+(result.message||'Saved.'));
   await load();
   return true;
  }catch(e){setStatusNote(e.message||'Could not save.');return false;}
  finally{setBusy(false);}
 }
 const editDay=row=>{setShowAdvanced(true);setDraft({employeeId:row.employeeId,date:row.date,status:row.status,checkIn:row.checkIn||'',manualLateMinutes:row.lateMinutes===null?'':String(row.lateMinutes),remarks:row.remarks||''});setTimeout(()=>document.getElementById('attendance-day-form')?.scrollIntoView({behavior:'smooth',block:'center'}),40);};
 async function quickMark(emp,date,status,current){
  if(current?.status===status||savingKey||!emp.isActive)return;
  const cellKey=emp.id+'|'+date;
  setSavingKey(cellKey);setStatusNote('');
  try{
   const payload={action:'save_day',employeeId:emp.id,date,status,checkIn:'',manualLateMinutes:null,remarks:current?.remarks||''};
   const response=await fetch(API,{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
   const result=await response.json();
   if(!response.ok||!result.ok)throw Error(result.error||'Attendance could not be saved.');
   setEntries(prev=>[...prev.filter(e=>!(e.employeeId===emp.id&&e.date===date)),
    {employeeId:emp.id,date,status,checkIn:'',expectedStart:status==='PRESENT'||status==='HALF_DAY'?emp.reportingTime||'':'',
     lateMinutes:null,remarks:current?.remarks||'',updatedAt:new Date().toISOString()}]);
   setStatusNote('✓ '+emp.employeeName+' • '+formatDate(date)+' • '+attendanceLabel(status)+' saved.');
  }catch(e){setStatusNote(e?.message||'Could not mark attendance.');}
  finally{setSavingKey('');}
 }
 function openCellEditor(emp,date,row){
  editDay(row||{employeeId:emp.id,date,status:'PRESENT',checkIn:'',lateMinutes:null,remarks:''});
 }
 function downloadMonthlySheet(dates){
  const code={PRESENT:'P',HALF_DAY:'HD',PAID_LEAVE:'L',SICK_LEAVE:'SL',UNPAID_LEAVE:'UL',ABSENT:'A',HOLIDAY:'H',WEEK_OFF:'WO'};
  const lookup=new Map(entries.map(e=>[e.employeeId+'|'+e.date,e]));
  const summaryById=new Map(sums.map(x=>[x.id,x]));
  const lines=[['Employee','Company',...dates.map(date=>date+' '+weekday(date)),'Present Days','Leave Days','Absent Days','Late Days','Late Minutes']];
  for(const emp of list){
   const total=summaryById.get(emp.id)||{};
   lines.push([emp.employeeName,emp.companyName||'',...dates.map(date=>{
    const row=lookup.get(emp.id+'|'+date);
    return row?(code[row.status]||'')+(Number(row.lateMinutes)>0?' (Late '+row.lateMinutes+'m)':''):'';
   }),total.present||0,total.leaveDays||0,total.absent||0,total.lateDays||0,total.lateMinutes||0]);
  }
  downloadCsv(lines,'monthly-attendance-sheet-'+month);
 }
 const pickEmployee=e=>setDraft(d=>({...d,employeeId:e.id,date:d.date.slice(0,7)===month?d.date:month+'-01',status:'PRESENT',checkIn:'',manualLateMinutes:'',remarks:''}));
 async function saveDay(ev){ev.preventDefault();if(!draft.employeeId||!draft.date)return;
  if(await save('save_day',{...draft,manualLateMinutes:draft.manualLateMinutes===''?null:draft.manualLateMinutes})){
   setDraft(d=>({...d,checkIn:'',manualLateMinutes:'',remarks:''}));
  }
 }
 async function addEmployee(ev){ev.preventDefault();if(await save('add_employee',profile)){setAdding(false);setProfile({employeeName:'',companyName:'',designation:'',salaryAmount:'0',reportingTime:''});}}
 function archiveEmployee(emp){
  const next=!emp.isActive;
  if(!window.confirm((next?'Restore ':'Archive ')+emp.employeeName+'? '+(next?'Employee will return to active list.':'Existing salary and attendance history will remain saved.')))return;
  void save('set_active',{employeeId:emp.id,isActive:next});
 }
 function downloadSummary(){
  const lines=[['Employee','Company','Designation','Marked Days','Present Days','Leave Days','Paid Leave','Sick Leave','Unpaid Leave','Absent','Company Holidays','Weekly Off','Late Days','Total Late Minutes'],
   ...sums.map(e=>[e.employeeName,e.companyName,e.designation,e.marked,e.present,e.leaveDays,e.paidLeave,e.sickLeave,e.unpaidLeave,e.absent,e.holidays,e.weeklyOff,e.lateDays,e.lateMinutes])];
  downloadCsv(lines,'employee-attendance-summary-'+month);
 }
 function downloadDetails(){
  const names=new Map(employees.map(e=>[e.id,e.employeeName]));
  downloadCsv([['Date','Day','Employee','Status','Check-in','Reporting Time','Late Minutes','Remarks'],
   ...recent.map(e=>[e.date,weekday(e.date),names.get(e.employeeId)||'—',attendanceLabel(e.status),e.checkIn,e.expectedStart,e.lateMinutes??'',e.remarks])],'employee-attendance-register-'+month);
 }
 function downloadCsv(lines,fileName){
  const body='\uFEFF'+lines.map(line=>line.map(csvEscape).join(',')).join('\r\n');
  const url=URL.createObjectURL(new Blob([body],{type:'text/csv;charset=utf-8'}));
  const anchor=document.createElement('a');anchor.href=url;anchor.download=fileName+'.csv';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
 }
 return <main style={{background:'#f4f8fd',minHeight:'80vh',color:ink,padding:'22px clamp(12px,3vw,35px)'}}>
  <div style={{maxWidth:1480,margin:'0 auto'}}>
   <header style={{display:'flex',gap:15,justifyContent:'space-between',alignItems:'end',flexWrap:'wrap',marginBottom:17}}>
    <div><small style={{fontWeight:900,color:'#5272a0',letterSpacing:1}}>ADMIN • STAFF MANAGEMENT</small>
     <h1 style={{fontSize:27,margin:'7px 0 4px'}}>Employee Attendance & Leave</h1>
     <p style={{color:muted,fontSize:13,margin:0}}>Daily register · Monthly leave totals · Late arrivals · Existing Salary employee list</p>
    </div>
    <div style={{display:'flex',gap:9,alignItems:'end',flexWrap:'wrap'}}>
     <Field label="REPORT MONTH"><input type="month" min="2020-01" max="2100-12" value={month} onChange={e=>{setMonth(e.target.value);setDraft(d=>({...d,date:e.target.value+'-01'}))}} style={{...input,minWidth:160}}/></Field>
     <button style={btn} disabled={loading} type="button" onClick={()=>void load()}>{loading?'Loading…':'Refresh'}</button>
     <button style={{...btn,background:showAdvanced?'#dbeafe':'#fff'}} type="button" onClick={()=>setShowAdvanced(v=>!v)}>{showAdvanced?'Hide Employee Management':'Manage Employees / Late Details'}</button>
    </div>
   </header>
   {statusNote&&<p role="status" style={{padding:'11px 14px',background:'#e7f0ff',borderRadius:10,color:'#184b88',fontWeight:750,fontSize:13}}>{statusNote}</p>}
   <div style={{display:'flex',gap:9,alignItems:'end',flexWrap:'wrap',padding:'10px 12px',borderRadius:11,marginBottom:12,background:'#e8f2ff',border:'1px solid #d2e3f6'}}>
    <Field label="COMPANY"><select aria-label="Filter attendance grid by company" value={company} onChange={e=>setCompany(e.target.value)} style={input}><option value="">All Companies</option>{companies.map(c=><option value={c} key={c}>{c}</option>)}</select></Field>
    <Field label="FIND EMPLOYEE" wide><input aria-label="Search attendance grid employee" type="search" placeholder="Search employee…" value={search} onChange={e=>setSearch(e.target.value)} style={input}/></Field>
    <label style={{fontSize:12,fontWeight:800,color:muted,display:'flex',gap:7,alignItems:'center',paddingBottom:10}}><input type="checkbox" checked={includeArchived} onChange={e=>setIncludeArchived(e.target.checked)}/>Archived</label>
   </div>
   <AttendanceMonthGrid month={month} employees={list} entries={entries} savingKey={savingKey}
    onQuickMark={quickMark} onEdit={openCellEditor} onExport={downloadMonthlySheet}/>
   <section aria-label="Employee attendance monthly overview" style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(145px,1fr))',gap:10,marginBottom:17}}>
    <StatCard label="Employees" value={rolled.employees} note="Selected staff"/>
    <StatCard label="Present Days" value={fmt(rolled.present)}/>
    <StatCard label="Leave Days" value={fmt(rolled.leaveDays)} note="Includes half-days"/>
    <StatCard label="Absent Days" value={fmt(rolled.absent)}/>
    <StatCard label="Late Arrivals" value={fmt(rolled.lateDays)}/>
    <StatCard label="Late Minutes" value={fmt(rolled.lateMinutes)}/>
   </section>
   {showAdvanced&&<>
   <section style={{...pane,marginBottom:16}} aria-label="Staff filters and employee management">
    <div style={{display:'flex',justifyContent:'space-between',gap:10,flexWrap:'wrap',alignItems:'center',marginBottom:11}}>
     <h2 style={{fontSize:17,margin:0}}>Staff Directory <small style={{fontSize:12,color:muted}}>· {active.length} active of {employees.length} total</small></h2>
     <button style={{...btn,background:'#1e559a',color:'#fff'}} onClick={()=>setAdding(v=>!v)}>{adding?'Close Add Form':'+ Add Employee'}</button>
    </div>
    <div style={{display:'flex',gap:10,alignItems:'end',flexWrap:'wrap'}}>
     <Field label="COMPANY"><select value={company} onChange={e=>setCompany(e.target.value)} style={input}><option value="">All Companies</option>{companies.map(c=><option value={c} key={c}>{c}</option>)}</select></Field>
     <Field label="FIND EMPLOYEE" wide><input placeholder="Search by employee name" type="search" value={search} onChange={e=>setSearch(e.target.value)} style={input}/></Field>
     <label style={{fontSize:12,fontWeight:800,color:muted,display:'flex',gap:7,alignItems:'center',paddingBottom:10}}><input type="checkbox" checked={includeArchived} onChange={e=>setIncludeArchived(e.target.checked)}/>Show archived employees</label>
    </div>
    {adding&&<form onSubmit={addEmployee} style={{display:'flex',gap:11,flexWrap:'wrap',alignItems:'end',padding:14,borderRadius:12,background:'#eef5ff',marginTop:13}}>
     <Field label="EMPLOYEE NAME"><input required minLength={2} maxLength={100} style={input} value={profile.employeeName} onChange={e=>setProfile(p=>({...p,employeeName:e.target.value}))}/></Field>
     <Field label="COMPANY"><select required style={input} value={profile.companyName} onChange={e=>setProfile(p=>({...p,companyName:e.target.value}))}><option value="">Select</option>{companies.map(c=><option key={c}>{c}</option>)}</select></Field>
     <Field label="DESIGNATION"><select required style={input} value={profile.designation} onChange={e=>setProfile(p=>({...p,designation:e.target.value}))}><option value="">Select</option>{designations.map(d=><option key={d}>{d}</option>)}</select></Field>
     <Field label="BASE SALARY (₹)"><input type="number" min="0" step=".01" style={input} value={profile.salaryAmount} onChange={e=>setProfile(p=>({...p,salaryAmount:e.target.value}))}/></Field>
     <Field label="REPORTING TIME"><input type="time" style={input} value={profile.reportingTime} onChange={e=>setProfile(p=>({...p,reportingTime:e.target.value}))}/></Field>
     <button type="submit" disabled={busy} style={{...btn,background:'#1c6c53',color:'#fff'}}>Save Employee</button>
    </form>}
    <p style={{fontSize:12,color:muted,marginBottom:0}}>Archive hides an employee from new Salary/Attendance entries without deleting old salary or leave records. To change name, company, designation or salary, use Edit on the Salary page.</p>
    <div style={{maxHeight:300,overflow:'auto',marginTop:12,border:'1px solid '+border,borderRadius:9}}>
     <table style={{borderCollapse:'collapse',width:'100%',minWidth:720}}><thead><tr>{['Employee','Company','Designation','Reporting Time','Attendance','Manage'].map(h=><th key={h} style={header}>{h}</th>)}</tr></thead>
      <tbody>{list.map(e=><tr key={e.id} style={{background:e.isActive?'#fff':'#f5f6f9',opacity:e.isActive?1:.74}}>
       <td style={{...cell,fontWeight:800}}>{e.employeeName}{!e.isActive&&<small> (Archived)</small>}</td>
       <td style={cell}>{e.companyName||'—'}</td><td style={cell}>{e.designation||'—'}</td>
       <td style={cell}>{e.reportingTime||'Not set'}</td>
       <td style={cell}><button style={{...btn,padding:'6px 10px'}} type="button" disabled={!e.isActive} onClick={()=>pickEmployee(e)}>Mark Day</button></td>
       <td style={cell}><button type="button" disabled={busy} style={{...btn,padding:'6px 10px',background:e.isActive?'#fff1f2':'#e7f8ed',color:e.isActive?'#9e2538':'#166534'}} onClick={()=>archiveEmployee(e)}>{e.isActive?'Archive':'Restore'}</button></td>
      </tr>)}
      {!list.length&&<tr><td style={cell} colSpan={6}>No employees match these filters.</td></tr>}
      </tbody>
     </table>
    </div>
   </section>
   <section id="attendance-day-form" style={{...pane,marginBottom:16}} aria-label="Record daily employee attendance">
    <div style={{display:'flex',gap:10,alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',marginBottom:12}}>
     <h2 style={{fontSize:17,margin:0}}>Record Daily Attendance</h2><small style={{color:muted}}>One saved status per employee per date · Existing entry can be edited</small>
    </div>
    <form onSubmit={saveDay}>
     <div style={{display:'flex',gap:12,flexWrap:'wrap'}}>
      <Field label="EMPLOYEE" wide><select required style={input} value={draft.employeeId} onChange={e=>field('employeeId',e.target.value)}>
       <option value="">Select employee</option>{active.map(e=><option key={e.id} value={e.id}>{e.employeeName} · {e.companyName}</option>)}
      </select></Field>
      <Field label="DATE"><input required type="date" min={month+'-01'} max={new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).toISOString().slice(0,10)} style={input} value={draft.date} onChange={e=>field('date',e.target.value)}/></Field>
      <Field label="ATTENDANCE / LEAVE"><select style={input} value={draft.status} onChange={e=>setDraft(d=>({...d,status:e.target.value,checkIn:'',manualLateMinutes:''}))}>{ATTENDANCE_STATUSES.map(v=><option key={v.value} value={v.value}>{v.label}</option>)}</select></Field>
      <Field label="CHECK-IN TIME"><input type="time" style={input} disabled={!['PRESENT','HALF_DAY'].includes(draft.status)} value={draft.checkIn} onChange={e=>field('checkIn',e.target.value)}/></Field>
      <Field label="OFFICIAL REPORTING TIME"><input type="time" style={input} disabled={!selected?.isActive} value={startTime} onChange={e=>setStartTime(e.target.value)}/></Field>
      <div style={{flex:'1 1 150px',display:'flex',gap:6,alignItems:'end'}}><button disabled={!selected||!selected.isActive||busy||startTime===selected?.reportingTime} type="button" style={{...btn,marginBottom:2}} onClick={()=>void save('save_reporting_time',{employeeId:selected.id,reportingTime:startTime})}>Save Reporting Time</button></div>
      <Field label="LATE MINUTES (OPTIONAL)"><input type="number" min="0" max="1440" step="1" disabled={!['PRESENT','HALF_DAY'].includes(draft.status)} placeholder="Auto from check-in" value={draft.manualLateMinutes} onChange={e=>field('manualLateMinutes',e.target.value)} style={input}/></Field>
      <Field label="REMARKS / REASON" wide><input maxLength={500} value={draft.remarks} placeholder="e.g. personal work, doctor's visit" onChange={e=>field('remarks',e.target.value)} style={input}/></Field>
     </div>
     <p style={{fontSize:12,color:muted}}>Late calculated from official reporting time: <strong>{late===null?'Not available':late+' minutes'}</strong>. Weekends and holidays are recorded only when you mark them; blank days are not automatically counted absent.</p>
     <div style={{display:'flex',flexWrap:'wrap',gap:9}}>
      <button type="submit" disabled={!draft.employeeId||busy} style={{...btn,background:'#1f6d58',color:'#fff',fontSize:13}}>{busy?'Saving…':'Save Attendance'}</button>
      <button type="button" style={btn} onClick={()=>setDraft({...freshDay(),date:month===todayIST().slice(0,7)?todayIST():month+'-01'})}>Clear Entry Form</button>
      <button type="button" disabled={!selected||busy} style={{...btn,background:'#fff1f2',color:'#a12539'}} onClick={()=>{if(window.confirm('Clear the saved attendance for this employee and date?'))void save('delete_day',{employeeId:draft.employeeId,date:draft.date})}}>Clear Saved Date</button>
     </div>
    </form>
   </section>
   <section style={{...pane,marginBottom:16}} aria-label="Employee monthly attendance summary">
    <div style={{display:'flex',gap:10,justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',marginBottom:12}}>
     <div><h2 style={{fontSize:17,margin:'0 0 4px'}}>Monthly Attendance Summary · {monthTitle(month)}</h2><small style={{color:muted}}>Only days with saved attendance entries are counted</small></div>
     <button type="button" style={btn} disabled={!sums.length} onClick={downloadSummary}>Download Summary CSV</button>
    </div>
    <div style={{overflowX:'auto',maxHeight:460}}>
     <table style={{borderCollapse:'collapse',minWidth:1130,width:'100%'}}>
      <thead><tr>{['Employee','Company','Present','Total Leave','Paid Leave','Sick Leave','Unpaid Leave','Absent','Holidays','Weekly Off','Late Days','Late Minutes','Marked Days'].map(h=><th key={h} style={header}>{h}</th>)}</tr></thead>
      <tbody>{sums.map(e=><tr key={e.id} style={{background:e.lateDays>3?'#fff9f1':'#fff'}}>
       <td style={{...cell,fontWeight:850}}>{e.employeeName}</td><td style={cell}>{e.companyName||'—'}</td>
       {[e.present,e.leaveDays,e.paidLeave,e.sickLeave,e.unpaidLeave,e.absent,e.holidays,e.weeklyOff,e.lateDays,e.lateMinutes,e.marked].map((v,i)=><td key={i} style={{...cell,fontWeight:i===1||i===8?850:400,color:i===8&&v>0?'#a34120':ink}}>{fmt(v)}</td>)}
      </tr>)}
      {!sums.length&&<tr><td colSpan={13} style={cell}>No employee records.</td></tr>}
      </tbody>
     </table>
    </div>
   </section>
   <section style={pane} aria-label="Detailed daily attendance register">
    <div style={{display:'flex',justifyContent:'space-between',gap:8,flexWrap:'wrap',alignItems:'center',marginBottom:10}}>
     <div><h2 style={{fontSize:17,margin:0}}>Detailed Daily Register</h2><small style={{color:muted}}>Click Edit to correct an entry; each change is saved securely</small></div>
     <button type="button" style={btn} disabled={!recent.length} onClick={downloadDetails}>Download Daily Register CSV</button>
    </div>
    <div style={{maxHeight:440,overflow:'auto'}}>
     <table style={{borderCollapse:'collapse',width:'100%',minWidth:940}}>
      <thead><tr>{['Date & Day','Employee','Status','Check-in','Reporting Time','Late','Remarks','Action'].map(h=><th key={h} style={header}>{h}</th>)}</tr></thead>
      <tbody>{recent.map(r=><tr key={r.employeeId+'|'+r.date}>
       <td style={cell}>{formatDate(r.date)} <small style={{color:muted}}>{weekday(r.date)}</small></td>
       <td style={{...cell,fontWeight:800}}>{employees.find(e=>e.id===r.employeeId)?.employeeName||'—'}</td>
       <td style={cell}>{attendanceLabel(r.status)}</td><td style={cell}>{r.checkIn||'—'}</td>
       <td style={cell}>{r.expectedStart||'—'}</td>
       <td style={{...cell,color:r.lateMinutes>0?'#b45309':muted,fontWeight:800}}>{r.lateMinutes===null?'—':r.lateMinutes+' min'}</td>
       <td style={{...cell,maxWidth:230,overflow:'hidden',textOverflow:'ellipsis'}} title={r.remarks}>{r.remarks||'—'}</td>
       <td style={cell}><button type="button" style={{...btn,padding:'6px 9px'}} onClick={()=>editDay(r)}>Edit</button></td>
      </tr>)}
      {!recent.length&&<tr><td colSpan={8} style={{...cell,textAlign:'center',padding:20}}>No attendance entered in {monthTitle(month)}. Select an employee and record a day above.</td></tr>}
      </tbody>
     </table>
    </div>
   </section>
   </>}
  </div>
 </main>;
}
