'use client';

import {useCallback,useEffect,useMemo,useState} from 'react';
import {LIBRARY_DURATIONS,libraryTodayIST,libraryPaidThrough,libraryRenewalList,libraryRenewalState,libraryMoney} from '../lib/libraryManagement.js';
import styles from './LibraryDashboard.module.css';

const LIBRARY_API='/api/library-management';
const EXPENSE_API='/api/library-expenses';
const HEADS=['Salary','Stationery','Daily Utilities','Rent','Electricity Bill','Misc','Misc for Home'];
const NAV=[{id:'seats',label:'Seat Bookings'},{id:'without',label:'Without Seat'},{id:'renewals',label:'Renewal List'},{id:'expenses',label:'Daily Expenses'}];
const money=value=>'₹'+Number(value||0).toLocaleString('en-IN',{maximumFractionDigits:2});
const dateText=value=>value?String(value).split('-').reverse().join('/'):'—';
const durationText=value=>LIBRARY_DURATIONS.find(x=>x.value===value)?.label||value;
const firstStudent=(type='WITH_SEAT',seatNo='')=>({
 id:'',seatType:type,seatNo:String(seatNo||''),studentName:'',bookingDate:libraryTodayIST(),
 duration:'1m',amount:'',paymentKind:'FULL',pay1:'',pay2:'',payMode1:'CASH',payMode2:'CASH',remarks:''
});
const firstExpense=()=>({id:'',date:libraryTodayIST(),head:'Salary',amount:'',remarks:''});
const csvCell=value=>'"'+(/^[=+\-@\t\r]/.test(String(value??''))?"'":'')+String(value??'').replace(/"/g,'""')+'"';
function downloadCsv(rows,name){
 const blob=new Blob(['\uFEFF'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});
 const url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download=name+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
}
function Field({label,children}){return <label className={styles.field}>{label}{children}</label>;}
function Metric({label,value,note}){return <div className={styles.metric}><div className={styles.metricLabel}>{label}</div><div className={styles.metricValue}>{value}</div>{note&&<div className={styles.metricSub}>{note}</div>}</div>;}
function PaymentFields({draft,setDraft}){
 const update=(key,value)=>setDraft(old=>({...old,[key]:value}));
 const part=draft.paymentKind==='PART';
 return <>
  <Field label="Fee Payment"><select className={styles.input} value={draft.paymentKind} onChange={e=>update('paymentKind',e.target.value)}>
   <option value="FULL">Complete Payment</option><option value="PART">Part Payment</option>
  </select></Field>
  {part?<>
   <Field label="Payment 1 (₹)"><input className={styles.input} type="number" min="0" step=".01" value={draft.pay1} placeholder="First amount" onChange={e=>update('pay1',e.target.value)}/></Field>
   <Field label="Payment 1 Mode"><select className={styles.input} value={draft.payMode1} onChange={e=>update('payMode1',e.target.value)}><option value="CASH">Cash</option><option value="ONLINE">Online</option></select></Field>
   <Field label="Payment 2 (₹)"><input className={styles.input} type="number" min="0" step=".01" value={draft.pay2} placeholder="Second amount, optional" onChange={e=>update('pay2',e.target.value)}/></Field>
   <Field label="Payment 2 Mode"><select className={styles.input} value={draft.payMode2||'CASH'} onChange={e=>update('payMode2',e.target.value)}><option value="CASH">Cash</option><option value="ONLINE">Online</option></select></Field>
  </>:<Field label="Payment Mode"><select className={styles.input} value={draft.payMode1} onChange={e=>update('payMode1',e.target.value)}><option value="CASH">Cash</option><option value="ONLINE">Online</option></select></Field>}
  {part&&<div className={styles.field}>Remaining Fee<strong className={styles.balance}>{money(Math.max(0,Number(draft.amount||0)-Number(draft.pay1||0)-Number(draft.pay2||0)))}</strong></div>}
 </>;
}
export default function LibraryDashboard({initialTab='seats'}){
 const [tab,setTab]=useState(initialTab);
 const [today,setToday]=useState(libraryTodayIST);
 const [students,setStudents]=useState([]);
 const [cycles,setCycles]=useState([]);
 const [seatCapacity,setSeatCapacity]=useState(225);
 const [capacityDraft,setCapacityDraft]=useState('225');
 const [studentDraft,setStudentDraft]=useState(null);
 const [renewDraft,setRenewDraft]=useState(null);
 const [historyStudent,setHistoryStudent]=useState(null);
 const [showArchived,setShowArchived]=useState(false);
 const [search,setSearch]=useState('');
 const [expenses,setExpenses]=useState([]);
 const [expenseMonth,setExpenseMonth]=useState(libraryTodayIST().slice(0,7));
 const [expenseDraft,setExpenseDraft]=useState(firstExpense);
 const [loading,setLoading]=useState(true),[expenseLoading,setExpenseLoading]=useState(false),[busy,setBusy]=useState(false);
 const [message,setMessage]=useState('');
 useEffect(()=>setTab(initialTab),[initialTab]);
 useEffect(()=>{const id=setInterval(()=>setToday(libraryTodayIST()),60000);return()=>clearInterval(id);},[]);
 const loadStudents=useCallback(async()=>{
  setLoading(true);
  try{
   const res=await fetch(LIBRARY_API,{cache:'no-store',credentials:'include'});
   const data=await res.json();
   if(!res.ok||!data.ok)throw Error(data.error||'Unable to load students.');
   setStudents(data.students||[]);setCycles(data.cycles||[]);
   setSeatCapacity(data.seatCapacity||225);setCapacityDraft(String(data.seatCapacity||225));
  }catch(error){setMessage(error.message||'Library students unavailable.');}
  finally{setLoading(false);}
 },[]);
 const loadExpenses=useCallback(async()=>{
  setExpenseLoading(true);
  try{
   const res=await fetch(EXPENSE_API+'?month='+encodeURIComponent(expenseMonth),{cache:'no-store',credentials:'include'});
   const data=await res.json();
   if(!res.ok||!data.ok)throw Error(data.error||'Unable to load expenses.');
   setExpenses(data.expenses||[]);
  }catch(error){setMessage(error.message||'Library expenses unavailable.');}
  finally{setExpenseLoading(false);}
 },[expenseMonth]);
 useEffect(()=>{void loadStudents();},[loadStudents]);
 useEffect(()=>{if(tab==='expenses')void loadExpenses();},[loadExpenses,tab]);
 const active=useMemo(()=>students.filter(s=>s.isActive),[students]);
 const archived=useMemo(()=>students.filter(s=>!s.isActive),[students]);
 const seatRows=useMemo(()=>active.filter(s=>s.seatType==='WITH_SEAT'),[active]);
 const noSeatRows=useMemo(()=>active.filter(s=>s.seatType==='WITHOUT_SEAT'),[active]);
 const seatLookup=useMemo(()=>new Map(seatRows.map(s=>[Number(s.seatNo),s])),[seatRows]);
 const dueRows=useMemo(()=>libraryRenewalList(active,today),[active,today]);
 const balanceTotal=useMemo(()=>active.reduce((sum,s)=>sum+Number(s.balance||0),0),[active]);
 const q=search.trim().toLowerCase();
 const matches=s=>!q||String(s.studentName||'').toLowerCase().includes(q)||String(s.seatNo??'').includes(q);
 const feeTotal=expenses.reduce((sum,x)=>sum+x.amount,0);
 const expenseTotals=HEADS.map(head=>({head,amount:expenses.filter(e=>e.head===head).reduce((sum,e)=>sum+e.amount,0)}));
 const history=historyStudent?cycles.filter(c=>c.studentId===historyStudent.id).sort((a,b)=>b.cycleStart.localeCompare(a.cycleStart)):[];
 async function post(url,payload,refresh){
  setBusy(true);setMessage('');
  try{
   const res=await fetch(url,{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
   const data=await res.json();
   if(!res.ok||!data.ok)throw Error(data.error||'Unable to save.');
   setMessage('✓ '+(data.message||'Saved.'));
   await refresh();
   return true;
  }catch(error){setMessage(error.message||'Unable to save.');return false;}
  finally{setBusy(false);}
 }
 const openStudent=(row=null,type='WITH_SEAT',seatNo='')=>{
  setStudentDraft(row?{...row,seatNo:String(row.seatNo??''),amount:String(row.amount),pay1:String(row.pay1),pay2:row.paymentKind==='PART'?String(row.pay2):'',payMode2:row.payMode2||'CASH'}:firstStudent(type,seatNo));
  setTimeout(()=>document.getElementById('library-booking-form')?.scrollIntoView({behavior:'smooth',block:'center'}),50);
 };
 async function saveStudent(event){
  event.preventDefault();if(!studentDraft)return;
  const ok=await post(LIBRARY_API,{action:studentDraft.id?'update_student':'add_student',...studentDraft},loadStudents);
  if(ok)setStudentDraft(null);
 }
 const openRenew=row=>{
  setRenewDraft({id:row.id,studentName:row.studentName,seatNo:row.seatNo,expectedDueDate:row.dueDate,
   duration:row.duration,amount:String(row.amount),paymentKind:'FULL',pay1:'',pay2:'',payMode1:'CASH',payMode2:'CASH'});
 };
 async function saveRenew(event){
  event.preventDefault();if(!renewDraft)return;
  const ok=await post(LIBRARY_API,{action:'renew',...renewDraft},loadStudents);
  if(ok)setRenewDraft(null);
 }
 async function archiveStudent(row,restore=false){
  if(!window.confirm((restore?'Restore ':'Archive ')+row.studentName+'? '+(restore?'The saved seat must be available.':'The seat will become available; past payment history will be kept.')))return;
  await post(LIBRARY_API,{action:restore?'restore_student':'archive_student',id:row.id,confirm:true},loadStudents);
 }
 async function changeCapacity(){
  if(!window.confirm('Set library seat capacity to '+capacityDraft+'?'))return;
  await post(LIBRARY_API,{action:'set_capacity',capacity:Number(capacityDraft)},loadStudents);
 }
 async function saveExpense(event){
  event.preventDefault();
  const ok=await post(EXPENSE_API,{action:'save',...expenseDraft},loadExpenses);
  if(ok){
   setExpenseMonth(expenseDraft.date.slice(0,7));
   setExpenseDraft(firstExpense());
  }
 }
 async function removeExpense(row){
  if(!window.confirm('Delete '+row.head+' expense '+money(row.amount)+' on '+dateText(row.date)+'?'))return;
  const ok=await post(EXPENSE_API,{action:'delete',id:row.id,confirm:true},loadExpenses);
  if(ok)setExpenseDraft(firstExpense());
 }
 const editExpense=row=>{
  setExpenseDraft({...row,amount:String(row.amount)});
  setTimeout(()=>document.getElementById('library-expense-form')?.scrollIntoView({behavior:'smooth',block:'center'}),50);
 };
 const tableHeaders=['Student','Booking Date','Plan','Paid Through','Renewal Due','Amount','Payment','Payment 1','Payment 2','Balance','Remarks','Action'];
 const exportStudent=(rows,label)=>{
  downloadCsv([['Seat No','Student Name','Booking Date','Current Period Start','Duration','Paid Through','Renewal Due','Fee','Payment Type','Payment 1','Mode 1','Payment 2','Mode 2','Balance','Remarks'],
   ...rows.map(row=>[row?.seatNo??'',row?.studentName??'',row?.bookingDate??'',row?.cycleStart??'',durationText(row?.duration)||'',row?.paidThrough??'',row?.dueDate??'',row?.amount??'',row?.paymentKind??'',row?.pay1??'',row?.payMode1??'',row?.pay2??'',row?.payMode2??'',row?.balance??'',row?.remarks??''])],label);
 };
 const renderStudentCells=row=>{
  const due=libraryRenewalState(row.dueDate,today),part=row.paymentKind==='PART';
  return <>
   <td style={{fontWeight:800}}>{row.studentName}</td>
   <td>{dateText(row.bookingDate)}</td>
   <td>{durationText(row.duration)}</td>
   <td>{dateText(row.paidThrough)}</td>
   <td className={due==='OVERDUE'?styles.overdue:due==='DUE'?styles.due:styles.ok}>{dateText(row.dueDate)}{due==='OVERDUE'?' · Overdue':due==='DUE'?' · Due':''}</td>
   <td>{money(row.amount)}</td>
   <td><span className={styles.badge} data-balance={row.balance>0?'yes':'no'}>{part?'Part Payment':'Complete'}</span></td>
   <td>{money(row.pay1)} · {row.payMode1==='ONLINE'?'Online':'Cash'}</td>
   <td>{part?(row.pay2>0?money(row.pay2)+' · '+(row.payMode2==='ONLINE'?'Online':'Cash'):'—'):'—'}</td>
   <td className={row.balance>0?styles.balance:styles.ok}>{money(row.balance)}</td>
   <td title={row.remarks||''} style={{maxWidth:220,overflow:'hidden',textOverflow:'ellipsis'}}>{row.remarks||'—'}</td>
   <td><div className={styles.tableActions}>
    <button type="button" className={styles.button+' '+styles.secondary+' '+styles.small} onClick={()=>openStudent(row)}>Edit</button>
    <button type="button" className={styles.button+' '+styles.secondary+' '+styles.small} onClick={()=>setHistoryStudent(row)}>History</button>
    {row.dueDate<=today&&<button type="button" className={styles.button+' '+styles.small} onClick={()=>openRenew(row)}>Renew</button>}
    <button type="button" className={styles.button+' '+styles.danger+' '+styles.small} onClick={()=>void archiveStudent(row)}>Archive</button>
   </div></td>
  </>;
 };
 return <main className={styles.shell}><div className={styles.inner}>
  <header className={styles.top}>
   <div><div className={styles.eyebrow}>MAYAVI · ADMIN · LIBRARY</div><h1 className={styles.title}>Library Management</h1>
    <p className={styles.subtitle}>Seat register · Without-seat students · Daily renewal reminders · Library-only expenses</p></div>
   <div className={styles.controls}><button className={styles.button+' '+styles.secondary} disabled={loading} onClick={()=>void loadStudents()}>{loading?'Loading…':'Refresh Students'}</button></div>
  </header>
  <nav aria-label="Library pages" className={styles.tabs}>{NAV.map(item=><button key={item.id} type="button" className={styles.tab} data-selected={tab===item.id?'yes':'no'} onClick={()=>{setTab(item.id);setMessage('')}}>{item.label}{item.id==='renewals'&&dueRows.length>0?' ('+dueRows.length+')':''}</button>)}</nav>
  {message&&<div className={styles.notice} role="status">{message}</div>}
  <section className={styles.metrics} aria-label="Library overview">
   <Metric label="Total Seats" value={seatCapacity}/>
   <Metric label="Occupied Seats" value={seatRows.length}/>
   <Metric label="Available Seats" value={Math.max(0,seatCapacity-seatRows.length)}/>
   <Metric label="Without Seat" value={noSeatRows.length}/>
   <Metric label="Renewals Due" value={dueRows.length} note={'As of '+dateText(today)}/>
   <Metric label="Outstanding Fee" value={money(balanceTotal)}/>
  </section>
  {(tab==='seats'||tab==='without')&&<>
   <section className={styles.panel} aria-label="Library student sheet tools">
    <div className={styles.head}><div><h2>{tab==='seats'?'Seat-wise Booking Sheet':'Without Seat Student Sheet'}</h2>
     <p>{tab==='seats'?'All '+seatCapacity+' seats are listed. Tap Add for an available seat.':'Students without allocated seats use the same booking, renewal and payment columns.'}</p></div>
     <div className={styles.controls}>
      <Field label="SEARCH"><input className={styles.input+' '+styles.search} type="search" value={search} placeholder="Name or seat number" onChange={e=>setSearch(e.target.value)}/></Field>
      <button className={styles.button} onClick={()=>openStudent(null,tab==='seats'?'WITH_SEAT':'WITHOUT_SEAT')}>+ Add Student</button>
      <button className={styles.button+' '+styles.secondary} onClick={()=>exportStudent(tab==='seats'?seatRows:noSeatRows,tab==='seats'?'library-seat-bookings':'library-without-seat')}>Download CSV</button>
     </div>
    </div>
    {tab==='seats'&&<div className={styles.controls} style={{marginBottom:12,background:'#f4f8fc',padding:10,borderRadius:9}}>
     <Field label="SEAT CAPACITY (EDITABLE)"><input className={styles.input} type="number" min="1" max="500" value={capacityDraft} onChange={e=>setCapacityDraft(e.target.value)} style={{width:110}}/></Field>
     <button className={styles.button+' '+styles.secondary} disabled={busy||Number(capacityDraft)===seatCapacity} onClick={()=>void changeCapacity()}>Save Capacity</button>
     <span className={styles.help}>Default 225, editable if the correct total is 215.</span>
    </div>}
   </section>
   {studentDraft&&<section className={styles.panel} id="library-booking-form" aria-label="Add or edit library student">
    <div className={styles.head}><h2>{studentDraft.id?'Edit Student Booking':'Add Student Booking'}</h2>
     <button className={styles.button+' '+styles.secondary} type="button" onClick={()=>setStudentDraft(null)}>Close</button></div>
    <form onSubmit={saveStudent}>
     <div className={styles.formGrid}>
      <Field label="STUDENT NAME"><input className={styles.input} autoFocus required minLength={2} maxLength={120} value={studentDraft.studentName} onChange={e=>setStudentDraft(x=>({...x,studentName:e.target.value}))}/></Field>
      <Field label="BOOKING TYPE"><select className={styles.input} value={studentDraft.seatType} onChange={e=>setStudentDraft(x=>({...x,seatType:e.target.value,seatNo:e.target.value==='WITHOUT_SEAT'?'':x.seatNo}))}><option value="WITH_SEAT">With Seat</option><option value="WITHOUT_SEAT">Without Seat</option></select></Field>
      {studentDraft.seatType==='WITH_SEAT'&&<Field label="SEAT NUMBER"><select className={styles.input} required value={studentDraft.seatNo} onChange={e=>setStudentDraft(x=>({...x,seatNo:e.target.value}))}>
       <option value="">Select a seat</option>{Array.from({length:seatCapacity},(_,i)=>i+1).map(n=><option key={n} value={n} disabled={Boolean(seatLookup.get(n)&&seatLookup.get(n).id!==studentDraft.id)}>{n}{seatLookup.has(n)&&seatLookup.get(n).id!==studentDraft.id?' · Booked':''}</option>)}
      </select></Field>}
      <Field label="BOOKING DATE"><input className={styles.input} type="date" required value={studentDraft.bookingDate} onChange={e=>setStudentDraft(x=>({...x,bookingDate:e.target.value}))}/></Field>
      <Field label="FEE PERIOD"><select className={styles.input} value={studentDraft.duration} onChange={e=>setStudentDraft(x=>({...x,duration:e.target.value}))}>{LIBRARY_DURATIONS.map(d=><option key={d.value} value={d.value}>{d.label}</option>)}</select></Field>
      <Field label="TOTAL FEE (₹)"><input className={styles.input} type="number" required min="0" step=".01" value={studentDraft.amount} placeholder="Enter manual fee" onChange={e=>setStudentDraft(x=>({...x,amount:e.target.value}))}/></Field>
      <PaymentFields draft={studentDraft} setDraft={setStudentDraft}/>
      <Field label="REMARKS"><input className={styles.input} value={studentDraft.remarks} maxLength={600} placeholder="Optional" onChange={e=>setStudentDraft(x=>({...x,remarks:e.target.value}))}/></Field>
     </div>
     <p className={styles.help}>A full payment shows one amount and Cash/Online mode. Part payment opens two editable amount fields; remaining fee is calculated automatically. Fee periods use calendar dates.</p>
     <div className={styles.formActions}><button type="submit" disabled={busy} className={styles.button}>{busy?'Saving…':studentDraft.id?'Save Changes':'Save Booking'}</button><button type="button" className={styles.button+' '+styles.secondary} onClick={()=>setStudentDraft(null)}>Cancel</button></div>
    </form>
   </section>}
   <section className={styles.panel}>
    <div className={styles.tableScroll}><table className={styles.table}><thead><tr>{tab==='seats'&&<th className={styles.firstCol}>Seat No</th>}{tableHeaders.map(h=><th key={h}>{h}</th>)}</tr></thead>
     <tbody>{tab==='seats'?Array.from({length:seatCapacity},(_,i)=>i+1).filter(n=>!q||String(n).includes(q)||matches(seatLookup.get(n)||{})).map(n=>{
      const s=seatLookup.get(n);
      return <tr key={'seat-'+n}><td className={styles.firstCol}>{n}</td>{s?renderStudentCells(s):<td colSpan={tableHeaders.length}>
       <span className={styles.ok}>Available</span> <button type="button" className={styles.button+' '+styles.secondary+' '+styles.small} onClick={()=>openStudent(null,'WITH_SEAT',n)}>+ Add Student</button>
      </td>}</tr>;
     }):noSeatRows.filter(matches).sort((a,b)=>a.studentName.localeCompare(b.studentName)).map(s=><tr key={s.id}>{renderStudentCells(s)}</tr>)}
     {tab==='without'&&!noSeatRows.filter(matches).length&&<tr><td className={styles.empty} colSpan={tableHeaders.length}>No without-seat students added yet.</td></tr>}
     </tbody></table></div>
    <p className={styles.foot}>Every student has one active fee period. Dates are calculated from the booking or latest renewal start. Archive frees the seat without deleting payment history. Payment 2 is shown only for part payment.</p>
   </section>
   <section className={styles.panel}>
    <label className={styles.help}><input type="checkbox" checked={showArchived} onChange={e=>setShowArchived(e.target.checked)}/> Show archived library students ({archived.length})</label>
    {showArchived&&<div className={styles.tableScroll} style={{maxHeight:250,marginTop:10}}><table className={styles.table} style={{minWidth:650}}><thead><tr>{['Student','Seat','Booking Date','Last Renewal Due','Action'].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>
     {archived.map(s=><tr key={s.id}><td>{s.studentName}</td><td>{s.seatType==='WITH_SEAT'?s.seatNo:'Without Seat'}</td><td>{dateText(s.bookingDate)}</td><td>{dateText(s.dueDate)}</td><td><div className={styles.tableActions}><button className={styles.button+' '+styles.small} onClick={()=>void archiveStudent(s,true)}>Restore</button><button className={styles.button+' '+styles.secondary+' '+styles.small} onClick={()=>setHistoryStudent(s)}>History</button></div></td></tr>)}
     </tbody></table></div>}
   </section>
  </>}
  {tab==='renewals'&&<section className={styles.panel} aria-label="Library daily renewal list">
   <div className={styles.head}><div><h2>Daily Renewal List</h2><p>Due today and overdue students, oldest due dates first. Renewed students disappear automatically after saving their new period.</p></div>
    <div className={styles.controls}><Field label="FIND STUDENT"><input className={styles.input+' '+styles.search} value={search} onChange={e=>setSearch(e.target.value)} placeholder="Student / seat"/></Field>
     <button className={styles.button+' '+styles.secondary} onClick={()=>downloadCsv([['Seat Type','Seat No','Student Name','Booking Date','Renewal Due','Amount','Fee Balance','Status','Remarks'],...dueRows.map(x=>[x.seatType,x.seatNo??'',x.studentName,x.bookingDate,x.dueDate,x.amount,x.balance,libraryRenewalState(x.dueDate,today),x.remarks])],'library-renewals-'+today)}>Download CSV</button></div>
   </div>
   <div className={styles.tableScroll}><table className={styles.table} style={{minWidth:960}}><thead><tr>{['Seat / Type','Student','Booking Date','Previous Plan','Renewal Due','Last Fee','Balance','Status','Action'].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>
    {dueRows.filter(matches).map(s=><tr key={s.id}><td>{s.seatType==='WITH_SEAT'?'Seat '+s.seatNo:'Without Seat'}</td><td style={{fontWeight:800}}>{s.studentName}</td><td>{dateText(s.bookingDate)}</td><td>{durationText(s.duration)}</td>
     <td className={s.dueDate<today?styles.overdue:styles.due}>{dateText(s.dueDate)}</td><td>{money(s.amount)}</td>
     <td className={s.balance>0?styles.balance:styles.ok}>{money(s.balance)}</td><td>{s.dueDate<today?'Overdue':'Due Today'}</td>
     <td><div className={styles.tableActions}><button className={styles.button+' '+styles.small} onClick={()=>openRenew(s)}>Renew</button><button className={styles.button+' '+styles.secondary+' '+styles.small} onClick={()=>setHistoryStudent(s)}>History</button></div></td></tr>)}
    {!dueRows.filter(matches).length&&<tr><td colSpan={9} className={styles.empty}>No pending renewals for {dateText(today)}.</td></tr>}
   </tbody></table></div>
   <p className={styles.foot}>Example: a 3 October one-month booking is valid through 2 November; renewal is due from 3 November. Payments in 2 or 3 months shift the renewal by that selected duration.</p>
  </section>}
  {tab==='expenses'&&<>
   <section className={styles.metrics}>
    <Metric label="Selected Month Expense" value={money(feeTotal)} note={expenseMonth}/>
    <Metric label="Expense Entries" value={expenses.length}/>
   </section>
   <section className={styles.panel} id="library-expense-form" aria-label="Add daily library expense">
    <div className={styles.head}><div><h2>Daily Library Expenses</h2><p>Separate from JEPO/Mayavi cargo company expense records.</p></div>
     <div className={styles.controls}><Field label="SUMMARY MONTH"><input className={styles.input} type="month" min="2020-01" max={today.slice(0,7)} value={expenseMonth} onChange={e=>setExpenseMonth(e.target.value)}/></Field>
      <button type="button" className={styles.button+' '+styles.secondary} disabled={expenseLoading} onClick={()=>void loadExpenses()}>{expenseLoading?'Loading…':'Refresh Expenses'}</button></div></div>
    <form onSubmit={saveExpense}>
     <div className={styles.formGrid}>
      <Field label="DATE"><input className={styles.input} required type="date" max={today} value={expenseDraft.date} onChange={e=>setExpenseDraft(x=>({...x,date:e.target.value}))}/></Field>
      <Field label="EXPENSE HEAD"><select className={styles.input} value={expenseDraft.head} onChange={e=>setExpenseDraft(x=>({...x,head:e.target.value}))}>{HEADS.map(head=><option key={head} value={head}>{head}</option>)}</select></Field>
      <Field label="AMOUNT (₹)"><input className={styles.input} required type="number" min=".01" step=".01" placeholder="Enter amount" value={expenseDraft.amount} onChange={e=>setExpenseDraft(x=>({...x,amount:e.target.value}))}/></Field>
      <Field label="REMARKS"><input className={styles.input} maxLength={600} placeholder="Details / reason" value={expenseDraft.remarks} onChange={e=>setExpenseDraft(x=>({...x,remarks:e.target.value}))}/></Field>
     </div>
     <div className={styles.formActions}><button className={styles.button} disabled={busy} type="submit">{busy?'Saving…':expenseDraft.id?'Update Expense':'Save Daily Expense'}</button>
      {expenseDraft.id&&<button type="button" className={styles.button+' '+styles.secondary} onClick={()=>setExpenseDraft(firstExpense())}>Cancel Edit</button>}</div>
    </form>
   </section>
   <section className={styles.panel} aria-label="Month-wise library expenses summary">
    <div className={styles.head}><h2>Head-wise Monthly Expense Summary</h2></div>
    <div className={styles.summary}>{expenseTotals.map(x=><div key={x.head} className={styles.summaryItem}><span>{x.head}</span><strong>{money(x.amount)}</strong></div>)}</div>
   </section>
   <section className={styles.panel} aria-label="Editable library expense register">
    <div className={styles.head}><div><h2>Daily Expense Register · {expenseMonth}</h2><p>Latest date first · Every entry can be edited or deleted.</p></div>
     <button type="button" className={styles.button+' '+styles.secondary} onClick={()=>downloadCsv([['Date','Expense Head','Amount','Remarks'],...expenses.map(x=>[x.date,x.head,x.amount,x.remarks])],'library-expenses-'+expenseMonth)}>Download CSV</button></div>
    <div className={styles.tableScroll}><table className={styles.table} style={{minWidth:700}}><thead><tr><th>Date</th><th>Expense Head</th><th>Amount</th><th>Remarks</th><th>Action</th></tr></thead><tbody>
     {expenses.map(row=><tr key={row.id}><td>{dateText(row.date)}</td><td style={{fontWeight:800}}>{row.head}</td><td>{money(row.amount)}</td><td style={{maxWidth:380,whiteSpace:'normal'}}>{row.remarks||'—'}</td>
      <td><div className={styles.tableActions}><button type="button" className={styles.button+' '+styles.secondary+' '+styles.small} onClick={()=>editExpense(row)}>Edit</button><button type="button" className={styles.button+' '+styles.danger+' '+styles.small} onClick={()=>void removeExpense(row)}>Delete</button></div></td></tr>)}
     {!expenses.length&&<tr><td colSpan={5} className={styles.empty}>No expense entries for this month.</td></tr>}
     <tr className={styles.totalRow}><td colSpan={2}>Monthly Total</td><td>{money(feeTotal)}</td><td colSpan={2}></td></tr>
    </tbody></table></div>
   </section>
  </>}
  {renewDraft&&<div className={styles.dialogShade} onMouseDown={e=>{if(e.target===e.currentTarget&&!busy)setRenewDraft(null)}}>
   <section className={styles.dialog} aria-label="Renew a library student's fee" role="dialog" aria-modal="true">
    <div className={styles.dialogHead}><div><h2>Renew · {renewDraft.studentName}</h2><p>{renewDraft.seatNo?'Seat '+renewDraft.seatNo:'Without Seat'} · Previous due: {dateText(renewDraft.expectedDueDate)}</p></div><button type="button" className={styles.button+' '+styles.secondary} disabled={busy} onClick={()=>setRenewDraft(null)}>Close</button></div>
    <form onSubmit={saveRenew}><div className={styles.formGrid}>
     <Field label="NEXT FEE PERIOD"><select className={styles.input} value={renewDraft.duration} onChange={e=>setRenewDraft(x=>({...x,duration:e.target.value}))}>{LIBRARY_DURATIONS.map(d=><option key={d.value} value={d.value}>{d.label}</option>)}</select></Field>
     <Field label="NEW TOTAL FEE (₹)"><input className={styles.input} required min="0" type="number" step=".01" value={renewDraft.amount} onChange={e=>setRenewDraft(x=>({...x,amount:e.target.value}))}/></Field>
     <PaymentFields draft={renewDraft} setDraft={setRenewDraft}/>
    </div><p className={styles.help}>Save Renewal moves the student into the next fee period. For overdue bookings, the new period starts on the renewal day; saved previous records stay in History.</p>
    <div className={styles.formActions}><button className={styles.button} disabled={busy} type="submit">{busy?'Saving…':'Confirm Renewal'}</button><button type="button" className={styles.button+' '+styles.secondary} onClick={()=>setRenewDraft(null)}>Cancel</button></div></form>
   </section></div>}
  {historyStudent&&<div className={styles.dialogShade} onMouseDown={e=>{if(e.target===e.currentTarget)setHistoryStudent(null)}}>
   <section className={styles.dialog} role="dialog" aria-modal="true" aria-label="Library student renewal and payment history">
    <div className={styles.dialogHead}><div><h2>Payment & Renewal History</h2><p>{historyStudent.studentName} · {historyStudent.seatNo?'Seat '+historyStudent.seatNo:'Without Seat'}</p></div><button className={styles.button+' '+styles.secondary} onClick={()=>setHistoryStudent(null)}>Close</button></div>
    <div className={styles.tableScroll}><table className={styles.table} style={{minWidth:700}}><thead><tr>{['Period Start','Duration','Next Due','Fee','Payment 1','Payment 2','Balance'].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>
     {history.map(x=><tr key={x.id}><td>{dateText(x.cycleStart)}</td><td>{durationText(x.duration)}</td><td>{dateText(x.dueDate)}</td><td>{money(x.amount)}</td><td>{money(x.pay1)} · {x.payMode1}</td><td>{x.paymentKind==='PART'?money(x.pay2)+(x.pay2?' · '+x.payMode2:''):'—'}</td><td>{money(Math.max(0,x.amount-x.pay1-x.pay2))}</td></tr>)}
     {!history.length&&<tr><td colSpan={7} className={styles.empty}>No history found.</td></tr>}
    </tbody></table></div>
   </section></div>}
 </div></main>;
}
