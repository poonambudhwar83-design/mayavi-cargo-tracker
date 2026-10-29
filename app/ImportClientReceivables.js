'use client';
import {useCallback,useEffect,useMemo,useState} from 'react';
import {ledgerAwb} from '../lib/importClientLedger.js';
import styles from './ImportClientLedger.module.css';
const API='/api/import-client-receivables';
const rupee=n=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:2}).format(Number(n)||0);
const kg=n=>n===null||n===undefined?'—':new Intl.NumberFormat('en-IN',{maximumFractionDigits:4}).format(Number(n));
const today=()=>new Date(Date.now()+330*60000).toISOString().slice(0,10);
const newId=()=>typeof crypto!=='undefined'&&crypto.randomUUID?crypto.randomUUID():'';
const mono={fontWeight:850,whiteSpace:'nowrap',color:'#173d78'};
const cell={whiteSpace:'nowrap'};
const card={border:'1px solid #d1def0',borderRadius:10,background:'#f8fbff',padding:'12px 15px',minWidth:165};
const inlineForm={display:'flex',alignItems:'end',flexWrap:'wrap',gap:12};
const field={display:'grid',gap:5,fontSize:12,fontWeight:800,color:'#34516e'};
const input={minHeight:39,border:'1px solid #b5c7db',borderRadius:8,padding:'8px 10px',minWidth:145,fontSize:13,color:'#183657',background:'#fff'};
const btn={minHeight:38,border:'1px solid #1c60a2',borderRadius:8,background:'#1c60a2',color:'#fff',padding:'9px 13px',fontWeight:800,cursor:'pointer'};
const lightBtn={...btn,background:'#fff',color:'#1c60a2'};
function downloadCsv(filename,columns,rows){
  const quote=value=>{
    const v=String(value??'');
    return '"'+(/^[=+@\-\t\r]/.test(v)?"'"+v:v).replace(/"/g,'""')+'"';
  };
  const csv='\uFEFF'+[columns,...rows].map(r=>r.map(quote).join(',')).join('\r\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download=filename+'.csv';a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export default function ImportClientReceivables({onOpenProfit}){
  const [clients,setClients]=useState([]),[client,setClient]=useState('');
  const [lastLoaded,setLastLoaded]=useState(''),[error,setError]=useState(''),
    [notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
  const [openingAmount,setOpeningAmount]=useState('');
  const [manualAwb,setManualAwb]=useState(''),[lookup,setLookup]=useState('');
  const [payment,setPayment]=useState({date:today(),mode:'ACCOUNT',amount:'',remarks:''});
  const [paymentId,setPaymentId]=useState(newId),[legacy,setLegacy]=useState([]);
  const [paymentFeedback,setPaymentFeedback]=useState({type:'',message:''});
  const refresh=useCallback(async()=>{
    try{
      const response=await fetch(API,{credentials:'include',cache:'no-store'});
      const data=await response.json();
      if(!response.ok||!data.ok)throw Error(data.error||'Unable to load receivables.');
      setClients(data.clients||[]);setLegacy(data.legacyReceipts||[]);
      setLastLoaded(new Date().toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata'}));
      setError('');
    }catch(e){setError('Receivables refresh failed: '+String(e.message||e));}
    finally{setLoading(false);}
  },[]);
  useEffect(()=>{
    void refresh();
    const t=setInterval(()=>{if(document.visibilityState==='visible')void refresh();},60000);
    const onShow=()=>{if(document.visibilityState==='visible')void refresh();};
    document.addEventListener('visibilitychange',onShow);
    return()=>{clearInterval(t);document.removeEventListener('visibilitychange',onShow);};
  },[refresh]);
  const selected=clients.find(x=>x.key===client)||null;
  const recentPayments=useMemo(()=>clients.flatMap(c=>c.receipts.map(p=>({
    ...p,clientName:c.name,clientKey:c.key
  }))).sort((a,b)=>String(b.date).localeCompare(String(a.date))||
    new Date(b.created_at||0)-new Date(a.created_at||0)).slice(0,30),[clients]);
  const totals=useMemo(()=>clients.reduce((s,c)=>{
    if(c.hasOpening){s.opening+=c.totals.openingPending;s.invoiced+=c.totals.newReceivables;
      s.received+=c.totals.receipts;s.due+=c.totals.netBalance;s.credit+=c.totals.credit;}
    s.pendingMasters+=c.active.length;s.notifications+=c.unread;return s;
  },{opening:0,invoiced:0,received:0,due:0,credit:0,pendingMasters:0,notifications:0}),[clients]);
  function select(key){
    const c=clients.find(x=>x.key===key);
    setClient(key);setOpeningAmount(c?.hasOpening?String(c.opening.amount):'');
    setPayment({date:today(),mode:'ACCOUNT',amount:'',remarks:''});
    setPaymentId(newId());setManualAwb('');setLookup('');setError('');setNotice('');
    setPaymentFeedback({type:'',message:''});
  }
  async function saveAction(payload,success){
    if(busy)return;
    setBusy(true);setError('');setNotice('');
    try{
      const r=await fetch(API,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},
        body:JSON.stringify(payload)});
      const data=await r.json();
      if(!r.ok||!data.ok)throw Error(data.error||'Save failed.');
      setNotice(success(data));await refresh();
      return true;
    }catch(e){setError('Not saved: '+String(e?.message||e));return false;}
    finally{setBusy(false);}
  }
  async function saveOpening(event){
    event.preventDefault();if(!selected)return;
    await saveAction({action:'OPENING',client:selected.key,amount:openingAmount},data=>
      'Opening balance saved for '+selected.name+'. Starting date is preserved on later edits.');
  }
  async function savePayment(event){
    event.preventDefault();
    if(!selected?.hasOpening||busy)return;
    const key=selected.key,requestId=paymentId;
    const submitted={...payment};
    setBusy(true);setError('');setNotice('');
    setPaymentFeedback({type:'pending',message:'Saving amount received and checking shared database…'});
    try{
      const response=await fetch(API,{method:'POST',credentials:'include',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'RECEIPT',client:key,date:submitted.date,
          mode:submitted.mode,amount:submitted.amount,remarks:submitted.remarks,
          clientRequestId:requestId})});
      const data=await response.json().catch(()=>({}));
      if(!response.ok||!data.ok)throw Error(data.error||'Server rejected payment (HTTP '+response.status+').');
      const savedId=String(data.receipt?.id||'');
      if(!savedId||data.verifiedInDatabase!==true)
        throw Error('Receipt was not confirmed by the database. Retry with the same entry.');
      // Re-read the shared ledger; do not tell the user payment is visible
      // until its exact receipt ID is present on the GET response.
      const verification=await fetch(API,{credentials:'include',cache:'no-store'});
      const snapshot=await verification.json().catch(()=>({}));
      if(!verification.ok||!snapshot.ok)
        throw Error('Payment was saved ('+savedId.slice(0,8)+'), but ledger refresh failed. Use Refresh Ledger; do not re-enter it.');
      const clientAfter=(snapshot.clients||[]).find(x=>x.key===key);
      const visible=clientAfter?.receipts?.some(p=>p.id===savedId);
      setClients(snapshot.clients||[]);
      setLegacy(snapshot.legacyReceipts||[]);
      setLastLoaded(new Date().toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata'}));
      if(!visible){
        setPaymentFeedback({type:'warning',message:'Payment saved, reference '+savedId.slice(0,8)+', but not yet visible in the ledger. Refresh; do not save it twice.'});
        return;
      }
      const message=rupee(data.receipt.amount)+' '+data.receipt.mode+
        ' payment saved and verified. Receipt '+savedId.slice(0,8)+
        '. Remaining opening due: '+rupee(clientAfter.opening.balance)+'.';
      setPaymentFeedback({type:'success',message});
      setNotice(message);
      setPayment(p=>({...p,amount:'',remarks:''}));
      setPaymentId(newId());
    }catch(e){
      const msg=String(e?.message||e);
      setPaymentFeedback({type:'error',message:msg});
      setError('Payment save issue: '+msg);
      // Keep the same amount, date and request ID for a safe retry.
    }finally{
      setBusy(false);
    }
  }
  async function manual(event){
    event.preventDefault();
    const awb=ledgerAwb(manualAwb);
    if(!awb){setError('Enter a valid 11-digit MAWB.');return;}
    const ok=await saveAction({action:'MANUAL',awb},data=>
      data.mawb+' added to client receivables: '+rupee(data.amount)+'.');
    if(ok)setManualAwb('');
  }
  const active=(selected?.active||[]).filter(r=>!lookup||r.mawb.includes(lookup)||r.clientName.toLowerCase().includes(lookup.toLowerCase()));
  const history=(selected?.historical||[]).filter(r=>!lookup||r.mawb.includes(lookup));
  return <main className={styles.page}>
    <header className={styles.heading}>
      <div><small>MAYAVI CARGO • IMPORT FINANCE • ADMIN</small>
        <h1>Client Ledger • Receivables</h1>
        <p>Client-wise opening balance → Customs Cleared MAWB charges → lump-sum receipts automatically allocated to oldest dues. Active Masters are shown separately and are not billed until cleared.</p>
      </div>
      <button style={lightBtn} type="button" onClick={()=>void refresh()} disabled={busy}>Refresh Ledger</button>
    </header>
    <section aria-label="All client totals" className={styles.summary}>
      <div><span>Remaining Opening Dues</span><b>{rupee(totals.opening)}</b></div>
      <div><span>New Cleared Receivables</span><b>{rupee(totals.invoiced)}</b></div>
      <div><span>Amount Received</span><b>{rupee(totals.received)}</b></div>
      <div><span>Net Client Balance</span><b>{rupee(totals.due)}</b></div>
      <div><span>Unallocated Credit</span><b>{rupee(totals.credit)}</b></div>
      <div className={styles.balance}><span>New Clearance Alerts</span><b>{totals.notifications}</b></div>
    </section>
    <section className={styles.filters}>
      <label>Choose Client<select value={client} onChange={e=>select(e.target.value)}>
        <option value="">Select client / All clients</option>
        {clients.map(c=><option value={c.key} key={c.key}>{c.name}{c.unread?' • '+c.unread+' new':''}</option>)}
      </select></label>
      <small>Last refreshed: {lastLoaded||'—'} IST • Auto-refresh while portal is open</small>
      <button type="button" className={styles.secondary} onClick={()=>select('')}>All Clients</button>
    </section>
    {error&&<p className={styles.error} role="alert">{error}</p>}
    {notice&&<p className={styles.notice} role="status">{notice}</p>}
    <section className={styles.section}>
      <h2>Client-wise Running Balances</h2>
      <div className={styles.scroller}><table><thead><tr>
        <th>Client</th><th>Opening Pending</th><th>New MAWB Amount</th>
        <th>Total Received</th><th>Net Balance</th><th>Credit</th>
        <th>Active Masters</th><th>New Alerts</th></tr></thead><tbody>
        {clients.map(c=><tr key={c.key} style={client===c.key?{background:'#e0f2fe'}:{}}>
          <td><button type="button" className={styles.clientLink} onClick={()=>select(c.key)}>{c.name}</button></td>
          <td>{c.hasOpening?rupee(c.totals.openingPending):<span className={styles.missing}>Not set</span>}</td>
          <td>{c.hasOpening?rupee(c.totals.newReceivables):'—'}</td>
          <td>{c.hasOpening?rupee(c.totals.receipts):'—'}</td>
          <td className={c.totals?.netBalance>0?styles.due:styles.settled}>{c.hasOpening?rupee(c.totals.netBalance):'—'}</td>
          <td>{c.hasOpening?rupee(c.totals.credit):'—'}</td><td>{c.active.length}</td>
          <td>{c.unread>0?<b style={{color:'#b45309'}}>{c.unread} new</b>:'—'}</td>
        </tr>)}
        {!clients.length&&<tr><td colSpan={8}>{loading?'Loading…':'No import clients yet.'}</td></tr>}
      </tbody></table></div>
    </section>
    <section className={styles.section} aria-label="Recent client payments">
      <h2>Recent Amount Received • All Clients</h2>
      <p className={styles.hint}>Every successfully saved Cash / Account payment appears here, even without selecting a client. A failed or unsaved payment will not appear.</p>
      <div className={styles.scroller}><table><thead><tr>
        <th>Client</th><th>Date</th><th>Mode</th><th>Amount Received</th><th>Receipt Reference</th><th>Remarks</th>
      </tr></thead><tbody>
        {recentPayments.map(p=><tr key={p.id}>
          <td><button type="button" className={styles.clientLink} onClick={()=>select(p.clientKey)}>{p.clientName}</button></td>
          <td>{p.date}</td><td>{p.mode}</td><td style={{fontWeight:900,color:'#087851'}}>{rupee(p.amount)}</td>
          <td style={mono}>{p.id.slice(0,8)}</td><td>{p.remarks||'—'}</td>
        </tr>)}
        {!recentPayments.length&&<tr><td colSpan={6}>{loading?'Loading saved receipts…':'No new client-level receipts saved yet.'}</td></tr>}
      </tbody></table></div>
    </section>
    {selected&&<>
      <section className={styles.section}>
        <h2>{selected.name} • Opening Balance</h2>
        <p className={styles.hint}>Opening balance covers old outstanding dues. New Active Masters will be charged only on Customs Clear after the opening setup. Saving again changes only the amount, not the start date.</p>
        <form onSubmit={saveOpening} style={inlineForm}>
          <label style={field}>Opening Balance (₹)
            <input style={input} type="number" min="0" step="0.01" required value={openingAmount}
              onChange={e=>setOpeningAmount(e.target.value)}/></label>
          <button style={btn} disabled={busy} type="submit">{busy?'Saving…':selected.hasOpening?'Update Opening':'Save Opening Balance'}</button>
          {selected.hasOpening&&<div style={{display:'flex',gap:11,flexWrap:'wrap',alignItems:'center'}}>
  <span style={{...card,background:'#fff'}}><small style={{color:'#54718e',fontWeight:800}}>Original Opening</small><strong style={{display:'block',color:'#153a65',fontSize:16}}>{rupee(selected.opening.amount)}</strong></span>
  <span style={{...card,background:'#f0fdf4'}}><small style={{color:'#54718e',fontWeight:800}}>Receipts Adjusted Against Opening</small><strong style={{display:'block',color:'#0c7950',fontSize:16}}>{rupee(selected.opening.received)}</strong></span>
  <span style={{...card,background:'#fff7ed'}}><small style={{color:'#87501d',fontWeight:800}}>Remaining Opening Due</small><strong style={{display:'block',color:'#9a3412',fontSize:19}}>{rupee(selected.opening.balance)}</strong></span>
  <small style={{color:'#577087'}}>Opening started: {selected.opening.startDate}</small>
</div>}
        </form>
      </section>
      {selected.unread>0&&<section className={styles.warning} role="status">
        <strong>{selected.unread} newly Customs Cleared MAWB(s) have been automatically added to {selected.name}'s ledger.</strong>
        <button type="button" disabled={busy} onClick={()=>void saveAction({action:'ACKNOWLEDGE',client:selected.key},x=>x.acknowledged+' clearance alerts acknowledged.')}>Mark Alerts Read</button>
      </section>}
      {selected.pendingRate.length>0&&<p className={styles.warning}>
        {selected.pendingRate.length} new cleared MAWB(s) require Weight or Rate before their amounts can be added.
        <button type="button" onClick={onOpenProfit}>Open Import Profit Sheet</button>
      </p>}
      {selected.hasOpening&&<>
        <section className={styles.section}>
          <h2>Record Lump-sum Amount Received • {selected.name}</h2>
          <p className={styles.hint} style={{fontWeight:800,color:'#135b44'}}>Latest saved opening due: {rupee(selected.opening.balance)} • Receipts credited against opening: {rupee(selected.opening.received)}</p>
          <p className={styles.hint}>The entire payment is recorded once against the client—not separately against every MAWB. Opening due is cleared first; the rest settles oldest MAWB, then partial MAWB, then remains as advance credit. <strong>Older payment dates are allowed, even before the opening-balance setup date.</strong></p>
          <form onSubmit={savePayment} style={inlineForm}>
            <label style={field}>Received Date<input style={input} type="date" max={today()} required value={payment.date} onChange={e=>setPayment(p=>({...p,date:e.target.value}))}/></label>
            <label style={field}>Mode<select style={input} value={payment.mode} onChange={e=>setPayment(p=>({...p,mode:e.target.value}))}><option value="ACCOUNT">Account / Bank</option><option value="CASH">Cash</option></select></label>
            <label style={field}>Amount Received (₹)<input style={input} type="number" min="0.01" step="0.01" required placeholder="E.g. 2000000" value={payment.amount} onChange={e=>setPayment(p=>({...p,amount:e.target.value}))}/></label>
            <label style={field}>Remarks<input style={input} maxLength={500} placeholder="Reference / UTR (optional)" value={payment.remarks} onChange={e=>setPayment(p=>({...p,remarks:e.target.value}))}/></label>
            <button style={btn} type="submit" disabled={busy||!payment.amount}>{busy?'Saving…':'Save Amount Received'}</button>
          </form>
          {paymentFeedback.message&&<p role={paymentFeedback.type==='error'?'alert':'status'}
             style={{margin:'12px 0',padding:'12px 14px',borderRadius:9,fontWeight:800,fontSize:13,
               border:'1px solid '+(paymentFeedback.type==='error'?'#fca5a5':paymentFeedback.type==='success'?'#86efac':'#fcd34d'),
               background:paymentFeedback.type==='error'?'#fef2f2':paymentFeedback.type==='success'?'#f0fdf4':'#fffbeb',
               color:paymentFeedback.type==='error'?'#991b1b':paymentFeedback.type==='success'?'#166534':'#92400e'}}>
             {paymentFeedback.message}</p>}
          <div style={{margin:'8px 0',fontSize:12,fontWeight:700,color:'#415e79'}}>
            Saved receipts for {selected.name}: <strong>{selected.receipts.length}</strong>
            {selected.receipts.length>0&&<span> • Latest: {rupee(selected.receipts[selected.receipts.length-1].amount)} on {selected.receipts[selected.receipts.length-1].date} ({selected.receipts[selected.receipts.length-1].mode})</span>}
          </div>
          <div style={{display:'flex',flexWrap:'wrap',gap:10,marginTop:15}}>
            {[['Opening Pending',selected.totals.openingPending],['Cleared MAWBs Due',selected.invoices.reduce((n,x)=>n+x.balance,0)],['Unallocated Credit',selected.totals.credit],['Net Balance',selected.totals.netBalance]].map(([label,value])=>
              <div style={card} key={label}><small style={{display:'block',color:'#55708d',fontWeight:800}}>{label}</small><b style={{color:'#173f71',fontSize:18}}>{rupee(value)}</b></div>)}
          </div>
        </section>
        <section className={styles.section}>
          <h2>MAWB-wise Receivables • Cleared & Billed ({selected.invoices.length})</h2>
          <p className={styles.hint}>Amount = Rate × (Master Weight + Excess Weight). Invoices are frozen at recognition; one MAWB is billed only once. Payment allocation is oldest-first.</p>
          <div style={{marginBottom:12}}>
            <button style={lightBtn} type="button" onClick={()=>downloadCsv('client-'+selected.key+'-mawb-ledger',
              ['MAWB','Cleared Date','Source','Master Weight','Excess Weight','Rate','Amount','Received','Remaining','Status'],
              selected.invoices.map(i=>[i.mawb,i.eventDate,i.source,i.weight,i.extraWeight,i.rate,i.amount,i.received,i.balance,i.paymentStatus]))}>Download MAWB Ledger CSV</button>
          </div>
          <div className={styles.scroller}><table><thead><tr>
            <th>MAWB</th><th>Recognition Date</th><th>Source</th><th>Weight</th><th>Extra Weight</th><th>Rate</th><th>Amount</th>
            <th>Received / Allocated</th><th>Pending</th><th>Payment Status</th></tr></thead><tbody>
            {selected.invoices.map(i=><tr key={i.awb}>
              <td style={mono}>{i.mawb}{!i.acknowledged&&i.source==='AUTO'&&<small style={{color:'#b45309',display:'block'}}>NEW CLEARANCE</small>}</td>
              <td>{i.eventDate}</td><td>{i.source}</td><td>{kg(i.weight)}</td><td>{kg(i.extraWeight)}</td>
              <td>{rupee(i.rate)}</td><td>{rupee(i.amount)}</td><td>{rupee(i.received)}</td>
              <td className={i.balance>0?styles.due:styles.settled}>{rupee(i.balance)}</td>
              <td>{i.paymentStatus}</td>
            </tr>)}
            {!selected.invoices.length&&<tr><td colSpan={10}>No MAWB billed after opening setup yet. They will appear automatically after Customs Clear.</td></tr>}
          </tbody></table></div>
        </section>
        <section className={styles.section}>
          <h2>Daily Opening & Closing Balance</h2>
          <p className={styles.hint}>Each day's opening equals the previous day's closing. Net closing = Opening + Customs Cleared billed today − Payments received today. Negative closing is customer advance credit. Payments entered for older dates appear on their actual payment date, including dates before the opening balance was first saved.</p>
          <button style={lightBtn} type="button" onClick={()=>downloadCsv('client-'+selected.key+'-daily-balances',
            ['Date','Opening Balance','New Customs Cleared Amount','Amount Received','Closing Balance'],
            selected.daily.map(d=>[d.date,d.opening,d.newReceivables,d.amountReceived,d.closing]))}>Download Daily Balances CSV</button>
          <div className={styles.scroller} style={{marginTop:12}}><table><thead><tr>
            <th>Date</th><th>Daily Opening</th><th>New Cleared Amount</th><th>Amount Received</th><th>Closing Balance</th></tr></thead><tbody>
            {[...selected.daily].reverse().map(d=><tr key={d.date}><td>{d.date}</td><td>{rupee(d.opening)}</td>
              <td>{rupee(d.newReceivables)}</td><td>{rupee(d.amountReceived)}</td>
              <td className={d.closing>0?styles.due:styles.settled}>{rupee(d.closing)}</td></tr>)}
          </tbody></table></div>
        </section>
        <section className={styles.section}>
          <h2>Amount Received History & Allocation</h2>
          <p className={styles.hint}>The allocation shows exactly which amount was used for opening dues and which MAWB(s) were fully or partly cleared.</p>
          <div className={styles.scroller}><table><thead><tr>
            <th>Date</th><th>Mode</th><th>Amount</th><th>Applied To</th><th>Advance Credit</th><th>Remarks</th></tr></thead><tbody>
            {[...selected.receipts].reverse().map(p=><tr key={p.id}>
              <td>{p.date}</td><td>{p.mode}</td><td>{rupee(p.amount)}</td>
              <td style={{textAlign:'left'}}>{p.allocations.map((a,i)=><div key={i}>{a.target}: <b>{rupee(a.amount)}</b></div>)}</td>
              <td>{rupee(p.unallocated)}</td><td>{p.remarks||'—'}</td></tr>)}
            {!selected.receipts.length&&<tr><td colSpan={6}>No lump-sum receipts recorded.</td></tr>}
          </tbody></table></div>
        </section>
      </>}
      <section className={styles.section}>
        <h2>Active Import Masters • Auto-monitored ({selected.active.length})</h2>
        <p className={styles.hint}>Shown as a forecast only. When a complete master moves to Customs Cleared after opening setup, Mayavi adds its rate × (weight + extra weight) to this client's ledger and displays a notification.</p>
        <label style={field}>Filter Masters<input style={input} type="search" placeholder="Search MAWB" value={lookup} onChange={e=>setLookup(e.target.value)}/></label>
        <div className={styles.scroller} style={{marginTop:12}}><table><thead><tr>
          <th>MAWB</th><th>Weight</th><th>Excess Weight</th><th>Rate</th><th>Expected Amount (not yet billed)</th></tr></thead><tbody>
          {active.map(s=><tr key={s.awb}><td style={mono}>{s.mawb}</td><td>{kg(s.weight)}</td><td>{kg(s.extraWeight)}</td><td>{s.rate===null?'Rate pending':rupee(s.rate)}</td><td>{s.amount===null?'Pending rate/weight':rupee(s.amount)}</td></tr>)}
          {!active.length&&<tr><td colSpan={5}>No Active Masters for this client.</td></tr>}
        </tbody></table></div>
      </section>
      <section className={styles.section}>
        <h2>Manually Add an Older Customs Cleared MAWB</h2>
        <p className={styles.hint}>For masters cleared before the client's opening date, or a missed cleared master. Weight, Excess Weight and Rate come from the existing shipment / Import Profit Sheet; they are not entered twice. Each MAWB can be added once.</p>
        <form onSubmit={manual} style={inlineForm}>
          <label style={field}>MAWB<input style={input} list="historical-mawbs" placeholder="11-digit AWB" maxLength={13} value={manualAwb} onChange={e=>setManualAwb(e.target.value)}/></label>
          <datalist id="historical-mawbs">{selected.historical.map(s=><option key={s.awb} value={s.mawb}>{rupee(s.amount)}</option>)}</datalist>
          <button type="submit" disabled={busy||!selected.hasOpening} style={btn}>Add Cleared MAWB</button>
        </form>
        <div className={styles.scroller} style={{marginTop:12}}><table><thead><tr>
          <th>MAWB</th><th>Cleared Date</th><th>Weight</th><th>Extra Weight</th><th>Rate</th><th>Amount</th><th>Add</th></tr></thead><tbody>
          {history.slice(0,150).map(s=><tr key={s.awb}>
            <td style={mono}>{s.mawb}</td><td>{String(s.clearedAt).slice(0,10)}</td>
            <td>{kg(s.weight)}</td><td>{kg(s.extraWeight)}</td><td>{s.rate===null?'—':rupee(s.rate)}</td>
            <td>{s.amount===null?'Rate/Weight needed':rupee(s.amount)}</td>
            <td><button style={lightBtn} disabled={busy||!selected.hasOpening||s.amount===null}
              onClick={()=>void saveAction({action:'MANUAL',awb:s.awb},x=>x.mawb+' added to ledger.')}>Add</button></td>
          </tr>)}
          {!history.length&&<tr><td colSpan={7}>No older unbilled cleared MAWB found.</td></tr>}
        </tbody></table></div>
      </section>
    </>}
    <section className={styles.section}>
      <h2>Previous MAWB-specific Receipts (Preserved Audit)</h2>
      <p className={styles.hint}>Receipts saved in the previous ledger remain in their original journal. They are not automatically subtracted again from the new opening balances. Use the new client-level Amount Received form for future payments.</p>
      <div className={styles.scroller}><table><thead><tr><th>MAWB</th><th>Date</th><th>Mode</th><th>Amount</th><th>Remarks</th></tr></thead><tbody>
        {legacy.map((p,i)=><tr key={i}><td>{p.awb}</td><td>{p.date}</td><td>{p.mode}</td><td>{rupee(p.amount)}</td><td>{p.remarks||'—'}</td></tr>)}
        {!legacy.length&&<tr><td colSpan={5}>No previous MAWB-specific receipts.</td></tr>}
      </tbody></table></div>
    </section>
  </main>;
}
