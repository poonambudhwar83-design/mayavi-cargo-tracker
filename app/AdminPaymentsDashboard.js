'use client';
import { useEffect, useState } from 'react';
import styles from './AdminPaymentsDashboard.module.css';

const PAY='/api/admin-payments',LEDGER='/api/admin-accounts';
const nowIST=()=>new Date(Date.now()+330*60000).toISOString().slice(0,10);
const currentMonth=()=>nowIST().slice(0,7);
const INR=new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'});
const formatDate=v=>v?v.split('-').reverse().join('/'):'—';
const money=n=>INR.format(Number(n)||0);
const blankPayment=month=>({month,name:'',direction:'PAY',amount:'',dueDate:'',remarks:''});
const blankLedger=month=>({month,transactionDate:month===currentMonth()?nowIST():month+'-01',
  accountHolder:'',credit:'',debit:'',remarks:''});
function offsetMonth(value,by){
  const [year,month]=value.split('-').map(Number);
  return new Date(Date.UTC(year,month-1+by,1)).toISOString().slice(0,7);
}
function labelMonth(value){
  return new Date(value+'-01T00:00:00Z').toLocaleDateString('en-IN',{year:'numeric',month:'long',timeZone:'UTC'});
}
async function requestJson(url,options={}){
  const response=await fetch(url,{credentials:'include',cache:'no-store',...options});
  const result=await response.json();
  if(!response.ok||!result.ok)throw Error(result.error||'Could not save or load records.');
  return result;
}
export default function AdminPaymentsDashboard(){
  const [month,setMonth]=useState(currentMonth);
  const [payments,setPayments]=useState([]);
  const [accounts,setAccounts]=useState([]);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [payEdit,setPayEdit]=useState('');
  const [accountEdit,setAccountEdit]=useState('');
  const [payDraft,setPayDraft]=useState(()=>blankPayment(currentMonth()));
  const [accountDraft,setAccountDraft]=useState(()=>blankLedger(currentMonth()));

  async function load(m=month){
    setLoading(true);
    try{
      const [p,a]=await Promise.all([
        requestJson(PAY+'?month='+encodeURIComponent(m)),
        requestJson(LEDGER+'?month='+encodeURIComponent(m))
      ]);
      setPayments(p.rows||[]);
      setAccounts(a.rows||[]);
    }catch(e){setMessage(e.message||'Unable to load payment records.');}
    finally{setLoading(false)}
  }
  useEffect(()=>{
    setPayEdit('');setAccountEdit('');
    setPayDraft(blankPayment(month));setAccountDraft(blankLedger(month));
    setMessage('');
    load(month);
  },[month]);

  const payTotal=direction=>payments.filter(r=>r.direction===direction)
    .reduce((sum,r)=>sum+Number(r.amount||0),0);
  const creditTotal=accounts.reduce((sum,r)=>sum+Number(r.credit||0),0);
  const debitTotal=accounts.reduce((sum,r)=>sum+Number(r.debit||0),0);
  const changePay=(field,value)=>setPayDraft(d=>({...d,[field]:value}));
  const changeAccount=(field,value)=>setAccountDraft(d=>({...d,[field]:value}));

  async function savePayment(event){
    event.preventDefault();if(busy||!payEdit)return;
    setBusy(true);setMessage('');
    try{
      await requestJson(PAY,{method:payEdit==='new'?'POST':'PATCH',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({...payDraft,...(payEdit==='new'?{}:{id:payEdit})})});
      setPayEdit('');setPayDraft(blankPayment(month));
      await load(month);setMessage('Payment saved.');
    }catch(e){setMessage(e.message||'Payment save failed.');}
    finally{setBusy(false);}
  }
  async function saveAccount(event){
    event.preventDefault();if(busy||!accountEdit)return;
    setBusy(true);setMessage('');
    try{
      await requestJson(LEDGER,{method:accountEdit==='new'?'POST':'PATCH',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({...accountDraft,...(accountEdit==='new'?{}:{id:accountEdit})})});
      setAccountEdit('');setAccountDraft(blankLedger(month));
      await load(month);setMessage('Account entry saved. All balances recalculated.');
    }catch(e){setMessage(e.message||'Account save failed.');}
    finally{setBusy(false);}
  }
  async function removeRecord(type,row){
    if(!window.confirm('Delete '+(type==='payment'?'payment for '+row.name:'account transaction for '+row.accountHolder)+'?'))return;
    setBusy(true);setMessage('');
    try{
      await requestJson((type==='payment'?PAY:LEDGER)+'?id='+encodeURIComponent(row.id),{method:'DELETE'});
      if(type==='payment')setPayEdit('');else setAccountEdit('');
      await load(month);setMessage('Record deleted.');
    }catch(e){setMessage(e.message||'Delete failed.');}
    finally{setBusy(false);}
  }
  function paymentFields(){
    return <>
      <td><input aria-label="Person or company" required maxLength={200} placeholder="Name" value={payDraft.name} onChange={e=>changePay('name',e.target.value)}/></td>
      <td><select aria-label="To pay or to receive" value={payDraft.direction} onChange={e=>changePay('direction',e.target.value)}>
        <option value="PAY">Dena Hai</option><option value="RECEIVE">Lena Hai</option>
      </select></td>
      <td><input aria-label="Amount" required type="number" min="0.01" step="0.01" value={payDraft.amount} onChange={e=>changePay('amount',e.target.value)}/></td>
      <td><input aria-label="Pending date" required type="date" value={payDraft.dueDate} onChange={e=>changePay('dueDate',e.target.value)}/></td>
      <td><input aria-label="Remarks" maxLength={1000} placeholder="Remarks" value={payDraft.remarks} onChange={e=>changePay('remarks',e.target.value)}/></td>
      <td><div className={styles.actions}><button disabled={busy} type="submit">Save</button><button type="button" disabled={busy} onClick={()=>setPayEdit('')}>Cancel</button></div></td>
    </>;
  }
  function accountFields(){
    return <>
      <td><input required aria-label="Date of transaction" type="date" value={accountDraft.transactionDate} onChange={e=>changeAccount('transactionDate',e.target.value)}/></td>
      <td><input required aria-label="Account holder name" maxLength={200} placeholder="Account holder" value={accountDraft.accountHolder} onChange={e=>changeAccount('accountHolder',e.target.value)}/></td>
      <td><input aria-label="Credit" type="number" min="0" step="0.01" placeholder="0.00" value={accountDraft.credit} onChange={e=>changeAccount('credit',e.target.value)}/></td>
      <td><input aria-label="Debit" type="number" min="0" step="0.01" placeholder="0.00" value={accountDraft.debit} onChange={e=>changeAccount('debit',e.target.value)}/></td>
      <td><input aria-label="Remarks" maxLength={1000} placeholder="Remarks" value={accountDraft.remarks} onChange={e=>changeAccount('remarks',e.target.value)}/></td>
      <td><strong>Auto</strong></td>
      <td><div className={styles.actions}><button type="submit" disabled={busy}>Save</button><button type="button" disabled={busy} onClick={()=>setAccountEdit('')}>Cancel</button></div></td>
    </>;
  }
  return <section className={styles.wrapper}>
    <div className={styles.heading}>
      <div><h2>Payments &amp; Account Details</h2><p>Import-sheet style registers • Admin private</p></div>
    </div>
    <div className={styles.period}>
      <button type="button" aria-label="Previous month" onClick={()=>setMonth(m=>offsetMonth(m,-1))}>‹</button>
      <label>Month <input type="month" value={month} onChange={e=>e.target.value&&setMonth(e.target.value)}/></label>
      <button type="button" aria-label="Next month" onClick={()=>setMonth(m=>offsetMonth(m,1))}>›</button>
      <strong>{labelMonth(month)}</strong>
    </div>
    {message&&<div className={styles.message} role="status">{message}</div>}

    <div className={styles.sectionHead}>
      <div><h3>1. Payments — Dena Hai / Lena Hai</h3>
        <small>To pay: {money(payTotal('PAY'))} • To receive: {money(payTotal('RECEIVE'))}</small></div>
      <button type="button" className={styles.primary} disabled={busy} onClick={()=>{
        setPayEdit('new');setPayDraft(blankPayment(month));setMessage('');
      }}>+ Add Payment</button>
    </div>
    <form onSubmit={savePayment}>
      <div className={styles.tableScroll}>
        <table className={styles.payTable}>
          <thead><tr><th>Name — Jisko Dena / Kisse Lena</th><th>Type</th><th>Amount (₹)</th><th>Pending Date</th><th>Remarks</th><th>Actions</th></tr></thead>
          <tbody>
            {payEdit==='new'&&<tr className={styles.editingRow}>{paymentFields()}</tr>}
            {payments.map(row=>payEdit===row.id?
              <tr key={row.id} className={styles.editingRow}>{paymentFields()}</tr>:
              <tr key={row.id}><td>{row.name||'—'}</td>
                <td><span className={row.direction==='RECEIVE'?styles.receive:styles.pending}>{row.direction==='RECEIVE'?'Lena Hai':'Dena Hai'}</span></td>
                <td className={styles.amount}>{money(row.amount)}</td><td>{formatDate(row.dueDate)}</td>
                <td className={styles.remarks}>{row.remarks||'—'}</td>
                <td><div className={styles.actions}>
                  <button type="button" disabled={busy} onClick={()=>{
                    setPayEdit(row.id);setPayDraft({month,name:row.name||'',direction:row.direction||'PAY',amount:row.amount||'',dueDate:row.dueDate||'',remarks:row.remarks||''});
                  }}>Edit</button>
                  <button type="button" className={styles.delete} disabled={busy} onClick={()=>removeRecord('payment',row)}>Delete</button>
                </div></td></tr>)}
            {loading&&<tr><td colSpan={6} className={styles.empty}>Loading…</td></tr>}
            {!loading&&!payments.length&&payEdit!=='new'&&<tr><td colSpan={6} className={styles.empty}>No payments for this month.</td></tr>}
          </tbody>
          <tfoot><tr><td>Monthly Total</td><td>Dena / Lena</td><td className={styles.amount}>{money(payTotal('PAY'))} / {money(payTotal('RECEIVE'))}</td><td colSpan={3}></td></tr></tfoot>
        </table>
      </div>
    </form>

    <div className={styles.sectionHead}>
      <div><h3>2. Account Details — Credit / Debit Ledger</h3>
        <small>Monthly credit: {money(creditTotal)} • Monthly debit: {money(debitTotal)}</small></div>
      <button type="button" className={styles.primary} disabled={busy} onClick={()=>{
        setAccountEdit('new');setAccountDraft(blankLedger(month));setMessage('');
      }}>+ Add Account Entry</button>
    </div>
    <form onSubmit={saveAccount}>
      <div className={styles.tableScroll}>
        <table className={styles.ledgerTable}>
          <thead><tr><th>Date</th><th>Name of Account Holder</th><th>Credit (₹)</th><th>Debit (₹)</th><th>Remarks</th><th>Balance (₹)</th><th>Actions</th></tr></thead>
          <tbody>
            {accountEdit==='new'&&<tr className={styles.editingRow}>{accountFields()}</tr>}
            {accounts.map(row=>accountEdit===row.id?
              <tr key={row.id} className={styles.editingRow}>{accountFields()}</tr>:
              <tr key={row.id}><td>{formatDate(row.transactionDate)}</td>
                <td>{row.accountHolder}</td>
                <td className={styles.amount}>{Number(row.credit)?money(row.credit):'—'}</td>
                <td className={styles.amount}>{Number(row.debit)?money(row.debit):'—'}</td>
                <td className={styles.remarks}>{row.remarks||'—'}</td>
                <td className={styles.amount}><strong>{money(row.balance)}</strong></td>
                <td><div className={styles.actions}>
                  <button type="button" disabled={busy} onClick={()=>{
                    setAccountEdit(row.id);setAccountDraft({month,transactionDate:row.transactionDate||month+'-01',accountHolder:row.accountHolder||'',credit:row.credit||'',debit:row.debit||'',remarks:row.remarks||''});
                  }}>Edit</button>
                  <button type="button" className={styles.delete} disabled={busy} onClick={()=>removeRecord('account',row)}>Delete</button>
                </div></td></tr>)}
            {loading&&<tr><td colSpan={7} className={styles.empty}>Loading…</td></tr>}
            {!loading&&!accounts.length&&accountEdit!=='new'&&<tr><td colSpan={7} className={styles.empty}>No account entries for this month.</td></tr>}
          </tbody>
          <tfoot><tr><td colSpan={2}>Monthly Movement</td>
            <td className={styles.amount}>{money(creditTotal)}</td><td className={styles.amount}>{money(debitTotal)}</td><td colSpan={3}></td></tr></tfoot>
        </table>
      </div>
    </form>
    <p className={styles.footnote}>Each account holder’s running balance = all credits − all debits, including earlier months. Enter either Credit or Debit for each transaction.</p>
  </section>;
}
