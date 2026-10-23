'use client';
import { useEffect, useState } from 'react';
import styles from './AdminPaymentsDashboard.module.css';

const API = '/api/admin-payments';
const nowIST = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const firstMonth = () => nowIST().slice(0, 7);
const INR = new Intl.NumberFormat('en-IN', { style:'currency', currency:'INR' });
const blank = month => ({ month, name:'', amount:'', dueDate:'', paidDate:'' });
const showDate = value => value ? value.split('-').reverse().join('/') : '—';
function offsetMonth(value, by) {
  const [y,m] = value.split('-').map(Number);
  return new Date(Date.UTC(y, m-1+by, 1)).toISOString().slice(0,7);
}
function labelMonth(value) {
  return new Date(value+'-01T00:00:00Z')
    .toLocaleDateString('en-IN',{year:'numeric',month:'long',timeZone:'UTC'});
}
export default function AdminPaymentsDashboard() {
  const [month,setMonth] = useState(firstMonth);
  const [rows,setRows] = useState([]);
  const [loading,setLoading] = useState(true);
  const [busy,setBusy] = useState(false);
  const [editing,setEditing] = useState('');
  const [draft,setDraft] = useState(()=>blank(firstMonth()));
  const [message,setMessage] = useState('');

  useEffect(()=>{
    const controller = new AbortController();
    setLoading(true);setMessage('');setEditing('');setDraft(blank(month));
    (async()=>{
      try {
        const res=await fetch(API+'?month='+encodeURIComponent(month),{credentials:'include',cache:'no-store',signal:controller.signal});
        const data=await res.json();
        if(!res.ok||!data.ok)throw new Error(data.error||'Could not load payments.');
        if(!controller.signal.aborted)setRows(data.rows||[]);
      } catch(e) {
        if(!controller.signal.aborted){setRows([]);setMessage(e.message||'Could not load payments.')}
      } finally {if(!controller.signal.aborted)setLoading(false)}
    })();
    return ()=>controller.abort();
  },[month]);

  const total = rows.reduce((sum,x)=>sum+Number(x.amount||0),0);
  function startNew(){setEditing('new');setDraft(blank(month));setMessage('')}
  function startEdit(row){
    setEditing(row.id);
    setDraft({month,name:row.name||'',amount:row.amount||'',dueDate:row.dueDate||'',paidDate:row.paidDate||''});
    setMessage('');
  }
  function change(field,value){setDraft(previous=>({...previous,[field]:value}))}
  async function save(e){
    e.preventDefault();
    if(!editing||busy)return;
    const id=editing;
    setBusy(true);setMessage('');
    try {
      const res=await fetch(API,{method:id==='new'?'POST':'PATCH',credentials:'include',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({...draft,...(id==='new'?{}:{id})})});
      const data=await res.json();
      if(!res.ok||!data.ok)throw new Error(data.error||'Unable to save.');
      setRows(previous=>id==='new'?[data.row,...previous]:previous.map(r=>r.id===id?data.row:r));
      setEditing('');setDraft(blank(month));setMessage('Payment saved.');
    }catch(e){setMessage(e.message||'Save failed.')}finally{setBusy(false)}
  }
  async function remove(row) {
    if(!window.confirm('Delete payment for '+row.name+'?'))return;
    setBusy(true);setMessage('');
    try {
      const res=await fetch(API+'?id='+encodeURIComponent(row.id),{method:'DELETE',credentials:'include'});
      const data=await res.json();
      if(!res.ok||!data.ok)throw new Error(data.error||'Delete failed.');
      setRows(previous=>previous.filter(r=>r.id!==row.id));
      if(editing===row.id)setEditing('');
      setMessage('Payment deleted.');
    } catch(e){setMessage(e.message||'Delete failed.')}finally{setBusy(false)}
  }
  const fieldRow=(
    <tr className={styles.editingRow}>
      <td><input aria-label="Name" required maxLength={200} placeholder="Person to pay" value={draft.name} onChange={e=>change('name',e.target.value)}/></td>
      <td><input aria-label="Amount in rupees" required min="0.01" step="0.01" type="number" placeholder="Amount" value={draft.amount} onChange={e=>change('amount',e.target.value)}/></td>
      <td><input aria-label="Due date" required type="date" value={draft.dueDate} onChange={e=>change('dueDate',e.target.value)}/></td>
      <td><input aria-label="Paid date" type="date" value={draft.paidDate} onChange={e=>change('paidDate',e.target.value)}/></td>
      <td><div className={styles.actions}>
        <button type="submit" disabled={busy}>Save</button>
        <button type="button" disabled={busy} onClick={()=>setEditing('')}>Cancel</button>
      </div></td>
    </tr>
  );
  return <section className={styles.wrapper}>
    <div className={styles.heading}>
      <div><h2>Payments</h2><p>Simple month-wise payment record.</p></div>
      <button type="button" className={styles.primary} onClick={startNew} disabled={busy}>+ Add Payment</button>
    </div>
    <div className={styles.period}>
      <button type="button" aria-label="Previous month" onClick={()=>setMonth(x=>offsetMonth(x,-1))}>‹</button>
      <label>Month <input type="month" value={month} onChange={e=>e.target.value&&setMonth(e.target.value)} /></label>
      <button type="button" aria-label="Next month" onClick={()=>setMonth(x=>offsetMonth(x,1))}>›</button>
      <strong>{labelMonth(month)}</strong>
    </div>
    {message&&<div className={styles.message} role="status">{message}</div>}
    <form onSubmit={save}>
      <div className={styles.tableScroll}>
        <table>
          <thead><tr><th>Name (Whom to Pay)</th><th>Amount (₹)</th><th>Due Date</th><th>Paid Date</th><th>Actions</th></tr></thead>
          <tbody>
            {editing==='new'&&fieldRow}
            {rows.map(row=>editing===row.id?
              <tr key={row.id} className={styles.editingRow}>
                <td><input aria-label="Name" required maxLength={200} value={draft.name} onChange={e=>change('name',e.target.value)}/></td>
                <td><input aria-label="Amount" required min="0.01" step="0.01" type="number" value={draft.amount} onChange={e=>change('amount',e.target.value)}/></td>
                <td><input aria-label="Due date" required type="date" value={draft.dueDate} onChange={e=>change('dueDate',e.target.value)}/></td>
                <td><input aria-label="Paid date" type="date" value={draft.paidDate} onChange={e=>change('paidDate',e.target.value)}/></td>
                <td><div className={styles.actions}><button disabled={busy} type="submit">Save</button><button disabled={busy} type="button" onClick={()=>setEditing('')}>Cancel</button></div></td>
              </tr>:
              <tr key={row.id}>
                <td>{row.name||'—'}</td>
                <td className={styles.amount}>{INR.format(Number(row.amount||0))}</td>
                <td>{showDate(row.dueDate)}</td>
                <td>{row.paidDate?<span className={styles.paid}>{showDate(row.paidDate)}</span>:<span className={styles.pending}>Pending</span>}</td>
                <td><div className={styles.actions}><button type="button" disabled={busy} onClick={()=>startEdit(row)}>Edit</button><button type="button" className={styles.delete} disabled={busy} onClick={()=>remove(row)}>Delete</button></div></td>
              </tr>)}
            {!loading&&rows.length===0&&editing!=='new'&&<tr><td colSpan={5} className={styles.empty}>No payments saved for this month.</td></tr>}
            {loading&&<tr><td colSpan={5} className={styles.empty}>Loading…</td></tr>}
          </tbody>
          <tfoot><tr><td>Total</td><td className={styles.amount}>{INR.format(total)}</td><td colSpan={3}></td></tr></tfoot>
        </table>
      </div>
    </form>
  </section>;
}
