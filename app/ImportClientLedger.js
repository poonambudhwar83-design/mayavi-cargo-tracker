'use client';
import {useEffect,useMemo,useState} from 'react';
import {summarizeImportLedger,ledgerAwb,validReceiptAmount,validLedgerDate} from '../lib/importClientLedger.js';
import styles from './ImportClientLedger.module.css';
import ImportClientReceivables from './ImportClientReceivables.js';

const API='/api/import-client-ledger';
const currency=new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',minimumFractionDigits:2,maximumFractionDigits:2});
const weightFmt=new Intl.NumberFormat('en-IN',{maximumFractionDigits:3});
const today=()=>new Date(Date.now()+330*60000).toISOString().slice(0,10);
const money=n=>n===null?'—':currency.format(Number(n)||0);
const requestId=()=>typeof crypto!=='undefined'&&crypto.randomUUID?crypto.randomUUID():'';
const blankPayment=()=>({date:today(),mode:'ACCOUNT',amount:'',remarks:''});
const normalize=v=>String(v||'').trim().toUpperCase();

function csv(rows){
  const cells=[['Client','MAWB','Master Weight (kg)','Rate (INR/kg)','Receivable (INR)','Cash Received (INR)','Account Received (INR)','Total Received (INR)','Balance (INR)'],
    ...rows.map(r=>[r.clientName,r.mawb,r.weight??'',r.rate??'',r.amount??'',r.cashReceived,r.accountReceived,r.received,r.balance??''])];
  const safe=v=>{
    const s=String(v??'');
    return '"'+(/^[=+@\-\t\r]/.test(s)?"'"+s:s).replace(/"/g,'""')+'"';
  };
  const blob=new Blob(['\uFEFF'+cells.map(r=>r.map(safe).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='mayavi-import-client-ledger.csv';a.click();URL.revokeObjectURL(url);
}
function PreviousImportClientLedger({onOpenProfit}){
  const [rows,setRows]=useState([]);
  const [receipts,setReceipts]=useState([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [client,setClient]=useState('');
  const [search,setSearch]=useState('');
  const [selectedAwb,setSelectedAwb]=useState('');
  const [payment,setPayment]=useState(blankPayment);
  const [id,setId]=useState(requestId);
  const [busy,setBusy]=useState(false);
  const [lastLoaded,setLastLoaded]=useState('');

  async function reload(){
    try{
      const response=await fetch(API,{credentials:'include',cache:'no-store'});
      const data=await response.json();
      if(!response.ok||!data.ok)throw new Error(data.error||'Unable to open client ledger.');
      setRows(data.rows||[]);
      setReceipts(data.receipts||[]);
      setLastLoaded(new Date().toLocaleTimeString('en-IN'));
      setError('');
    }catch(e){setError('Ledger refresh failed: '+(e?.message||e));}
    finally{setLoading(false);}
  }
  useEffect(()=>{
    void reload();
    const handle=()=>{if(document.visibilityState==='visible')void reload();};
    const timer=setInterval(handle,30000);
    document.addEventListener('visibilitychange',handle);
    return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',handle);};
  },[]);
  const options=useMemo(()=>summarizeImportLedger(rows),[rows]);
  const visible=useMemo(()=>rows.filter(r=>
    (!client||normalize(r.clientName)===client)&&
    (!search||[r.clientName,r.mawb].join(' ').toLowerCase().includes(search.trim().toLowerCase()))
  ),[rows,client,search]);
  const summaries=useMemo(()=>summarizeImportLedger(visible),[visible]);
  const totals=useMemo(()=>summaries.reduce((a,r)=>({
    mawbs:a.mawbs+r.mawbs,unpriced:a.unpriced+r.unpriced,
    amount:a.amount+r.amount,cash:a.cash+r.cash,account:a.account+r.account,
    received:a.received+r.received,balance:a.balance+r.balance
  }),{mawbs:0,unpriced:0,amount:0,cash:0,account:0,received:0,balance:0}),[summaries]);
  const selected=useMemo(()=>rows.find(r=>r.awb===selectedAwb)||null,[rows,selectedAwb]);
  const history=useMemo(()=>{
    const labels=new Map(rows.map(r=>[r.awb,r]));
    return receipts.filter(p=>{
      const row=labels.get(ledgerAwb(p.awb));
      if(!row||client&&normalize(row.clientName)!==client)return false;
      if(selectedAwb)return ledgerAwb(p.awb)===selectedAwb;
      return !search||[row.clientName,row.mawb,p.date,p.mode,p.remarks].join(' ').toLowerCase().includes(search.trim().toLowerCase());
    }).map(p=>({...p,clientName:labels.get(ledgerAwb(p.awb))?.clientName||'—'}));
  },[receipts,rows,client,search,selectedAwb]);

  function choose(row){
    setSelectedAwb(row.awb);
    setPayment(blankPayment());
    setId(requestId());
    setNotice('');
    setError('');
  }
  async function save(event){
    event.preventDefault();
    if(busy)return;
    if(!selected||selected.amount===null){setError('Choose a MAWB with Weight and Rate available.');return;}
    if(!validLedgerDate(payment.date)){setError('Enter a valid receipt date.');return;}
    if(!['CASH','ACCOUNT'].includes(payment.mode)){setError('Choose Cash or Account.');return;}
    const value=validReceiptAmount(payment.amount);
    if(value===null){setError('Enter a positive payment amount (up to two decimals).');return;}
    setBusy(true);setError('');setNotice('');
    try{
      const response=await fetch(API,{method:'POST',credentials:'include',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({awb:selected.awb,date:payment.date,mode:payment.mode,
          amount:payment.amount,remarks:payment.remarks,clientRequestId:id})});
      const data=await response.json();
      if(!response.ok||!data.ok)throw new Error(data.error||'Payment could not be saved.');
      setPayment(p=>({...p,amount:'',remarks:''}));
      setId(requestId());
      setNotice('Saved '+money(value)+' '+payment.mode+' payment for '+selected.mawb+' on '+payment.date+'.');
      await reload();
    }catch(e){setError('Payment not saved: '+(e?.message||e)+'. Keep the same entry and retry.');}
    finally{setBusy(false);}
  }
  return <main className={styles.page}>
    <header className={styles.heading}>
      <div><small>MAYAVI CARGO • IMPORT FINANCE • ADMIN</small><h1>Client Ledger</h1>
        <p>One receivable per master MAWB (Weight × Import Profit Rate). Record multiple dated Cash or Account receipts against each MAWB.</p></div>
      <button className={styles.download} type="button" onClick={()=>csv(visible)} disabled={!visible.length}>Download Ledger CSV</button>
    </header>
    <section className={styles.summary} aria-label="Import client ledger totals">
      <div><span>MAWB Shipments</span><b>{totals.mawbs}</b></div>
      <div><span>Total Receivable</span><b>{money(totals.amount)}</b></div>
      <div><span>Cash Received</span><b>{money(totals.cash)}</b></div>
      <div><span>Account Received</span><b>{money(totals.account)}</b></div>
      <div><span>Total Received</span><b>{money(totals.received)}</b></div>
      <div className={styles.balance}><span>Remaining Balance</span><b>{money(totals.balance)}</b></div>
    </section>
    {totals.unpriced>0&&<p className={styles.warning} role="note">{totals.unpriced} MAWB(s) still need a saved Rate or Weight before their receivable can be calculated. <button type="button" onClick={onOpenProfit}>Open Import Profit Sheet</button></p>}
    <section className={styles.filters}>
      <label>Client
        <select value={client} onChange={e=>{setClient(e.target.value);setSelectedAwb('');}}>
          <option value="">All Clients ({options.length})</option>
          {options.map(c=><option key={normalize(c.clientName)} value={normalize(c.clientName)}>{c.clientName}</option>)}
        </select>
      </label>
      <label>Search
        <input type="search" placeholder="Client or MAWB" value={search} onChange={e=>setSearch(e.target.value)}/>
      </label>
      <button type="button" className={styles.secondary} onClick={()=>{setClient('');setSearch('');setSelectedAwb('');}}>Clear Filters</button>
      <small>Updated: {lastLoaded||'—'} • All months • Automatic refresh</small>
    </section>
    {error&&<p className={styles.error} role="alert">{error}</p>}
    {notice&&<p className={styles.notice} role="status">{notice}</p>}
    <section className={styles.section}>
      <h2>Client-wise Balance</h2>
      <div className={styles.scroller}><table><thead><tr><th>Client</th><th>MAWBs</th><th>Receivable</th><th>Cash</th><th>Account</th><th>Received</th><th>Balance</th></tr></thead>
        <tbody>{summaries.map(s=><tr key={normalize(s.clientName)}>
          <td><button className={styles.clientLink} onClick={()=>{setClient(normalize(s.clientName));setSelectedAwb('');}}>{s.clientName}</button>{s.unpriced>0&&<small className={styles.missing}>{s.unpriced} rate/weight pending</small>}</td>
          <td>{s.mawbs}</td><td>{money(s.amount)}</td><td>{money(s.cash)}</td><td>{money(s.account)}</td><td>{money(s.received)}</td><td className={s.balance>0?styles.due:styles.settled}>{money(s.balance)}</td>
        </tr>)}
        {!summaries.length&&<tr><td colSpan={7}>{loading?'Loading client records…':'No matching clients.'}</td></tr>}
        </tbody><tfoot><tr><th>Total</th><td>{totals.mawbs}</td><td>{money(totals.amount)}</td><td>{money(totals.cash)}</td><td>{money(totals.account)}</td><td>{money(totals.received)}</td><td>{money(totals.balance)}</td></tr></tfoot></table></div>
    </section>
    <section className={styles.section}>
      <h2>MAWB-wise Receivables</h2>
      <div className={styles.scroller}><table><thead><tr><th>Client</th><th>MAWB</th><th>Weight (kg)</th><th>Rate (₹/kg)</th><th>Amount to Collect</th><th>Cash</th><th>Account</th><th>Total Received</th><th>Balance</th><th>Payment</th></tr></thead>
        <tbody>{visible.map(r=><tr key={r.awb} className={selectedAwb===r.awb?styles.selectedRow:''}>
          <td>{r.clientName}</td><td className={styles.mawb}>{r.mawb}</td><td>{r.weight===null?'—':weightFmt.format(r.weight)}</td>
          <td>{r.rate===null?'Not set':money(r.rate)}</td><td>{money(r.amount)}</td>
          <td>{money(r.cashReceived)}</td><td>{money(r.accountReceived)}</td><td>{money(r.received)}</td>
          <td className={r.balance===null?'':r.balance>0?styles.due:styles.settled}>{money(r.balance)}</td>
          <td><button className={styles.record} type="button" disabled={r.amount===null} onClick={()=>choose(r)}>{selectedAwb===r.awb?'Selected':'Add Receipt'}</button></td>
        </tr>)}
        {!visible.length&&<tr><td colSpan={10}>{loading?'Loading MAWB entries…':'No matching MAWB records.'}</td></tr>}
        </tbody></table></div>
    </section>
    <section className={styles.section} aria-label="Save client receipt">
      <h2>Record Cash / Account Payment</h2>
      <p className={styles.hint}>Select a MAWB above. Every receipt is saved separately with its date and mode. Balance = Weight × Rate − Total Received.</p>
      {selected?<div className={styles.selection}><strong>{selected.clientName} • {selected.mawb}</strong><span>Amount: {money(selected.amount)} • Received: {money(selected.received)} • Balance: {money(selected.balance)}</span><button type="button" className={styles.secondary} onClick={()=>setSelectedAwb('')}>Clear Selection</button></div>:<p className={styles.choose}>Select “Add Receipt” in a MAWB row to enter a payment.</p>}
      <form onSubmit={save} className={styles.paymentForm}>
        <label>Receipt Date<input type="date" value={payment.date} required disabled={!selected||busy} onChange={e=>setPayment(p=>({...p,date:e.target.value}))}/></label>
        <label>Payment Mode<select value={payment.mode} required disabled={!selected||busy} onChange={e=>setPayment(p=>({...p,mode:e.target.value}))}><option value="CASH">Cash</option><option value="ACCOUNT">Account / Bank</option></select></label>
        <label>Amount Received (₹)<input type="number" inputMode="decimal" min="0.01" step="0.01" placeholder="Enter amount" required value={payment.amount} disabled={!selected||busy} onChange={e=>setPayment(p=>({...p,amount:e.target.value}))}/></label>
        <label>Remarks (optional)<input type="text" maxLength={500} placeholder="Payment details" value={payment.remarks} disabled={!selected||busy} onChange={e=>setPayment(p=>({...p,remarks:e.target.value}))}/></label>
        <button type="submit" className={styles.save} disabled={!selected||selected.amount===null||busy}>{busy?'Saving Payment…':'Save Payment'}</button>
      </form>
    </section>
    <section className={styles.section}>
      <h2>Payment History {selected?'• '+selected.mawb:client?'• Selected Client':''}</h2>
      <p className={styles.hint}>Every saved payment remains a separate entry. Select a MAWB to view its payment history.</p>
      <div className={styles.scroller}><table><thead><tr><th>Date</th><th>Client</th><th>MAWB</th><th>Mode</th><th>Received (₹)</th><th>Remarks</th><th>Entered By</th></tr></thead><tbody>
        {history.map(p=><tr key={p.id}><td>{p.date}</td><td>{p.clientName}</td><td className={styles.mawb}>{p.mawb}</td><td><span className={p.mode==='CASH'?styles.cashMode:styles.accountMode}>{p.mode==='CASH'?'Cash':'Account'}</span></td><td>{money(p.amount)}</td><td>{p.remarks||'—'}</td><td>{p.createdBy||'—'}</td></tr>)}
        {!history.length&&<tr><td colSpan={7}>{loading?'Loading payments…':'No payments recorded for this selection.'}</td></tr>}
      </tbody></table></div>
    </section>
  </main>;
}

// Existing per-MAWB ledger implementation is retained above for audit/migration.
// New client-wise running ledger is the active Receivables interface.
export default function ImportClientLedger({onOpenProfit}){
  return <ImportClientReceivables onOpenProfit={onOpenProfit}/>;
}
