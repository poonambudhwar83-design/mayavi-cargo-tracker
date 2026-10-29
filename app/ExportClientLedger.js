'use client';
import {useCallback,useEffect,useMemo,useState} from 'react';
import {ledgerAwb,validLedgerDate,validReceiptAmount} from '../lib/importClientLedger.js';
import {validEiciAmount} from '../lib/exportClientLedger.js';

const API='/api/export-client-ledger';
const money=new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:2});
const number=new Intl.NumberFormat('en-IN',{maximumFractionDigits:3});
const currency=value=>value===null||value===undefined?'—':money.format(Number(value)||0);
const kg=value=>value===null||value===undefined?'—':number.format(value);
const istToday=()=>new Date(Date.now()+330*60000).toISOString().slice(0,10);
const newId=()=>typeof crypto!=='undefined'&&crypto.randomUUID?crypto.randomUUID():'';
const panel={background:'#fff',border:'1px solid #d8e4ef',borderRadius:12,padding:15};
const field={border:'1px solid #aec4df',borderRadius:8,padding:'8px 10px',minHeight:38,background:'#fff',color:'#183352'};
const button={border:0,borderRadius:8,padding:'10px 14px',fontWeight:800,cursor:'pointer',background:'#2257a1',color:'white'};
const head={padding:'9px 12px',background:'#e6effc',color:'#1f3b62',whiteSpace:'nowrap',textAlign:'left',fontSize:12,position:'sticky',top:0};
const cell={padding:'8px 12px',borderBottom:'1px solid #e3eaf2',whiteSpace:'nowrap',fontSize:12};
const columns=['Client','MAWB','Register','Weight (kg)','Account Gross','DHL Commission (−)','Net Account Freight','EICI','EICI GST 18%','Account Due','Cash Due','Total Due','Account Received','Cash Received','Account Balance','Cash Balance','Net Balance'];
function downloadCsv(rows){
  const values=[columns,...rows.map(r=>[r.clientName,r.mawb,r.register,r.weight??'',r.grossAccount??'',r.commission??'',r.netAccount??'',r.eiciAmount??'',r.eiciGst??'',r.accountCharge??'',r.cashCharge??'',r.totalCharge??'',r.accountReceived,r.cashReceived,r.accountBalance??'',r.cashBalance??'',r.balance??''])];
  const csv='\uFEFF'+values.map(row=>row.map(x=>{
    let value=String(x??'');
    if(/^[=+@\-\t\r]/.test(value))value="'"+value;
    return '"'+value.replace(/"/g,'""')+'"';
  }).join(',')).join('\r\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download='mayavi-export-client-ledger.csv';a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export default function ExportClientLedger(){
  const [rows,setRows]=useState([]),[receipts,setReceipts]=useState([]);
  const [months,setMonths]=useState([]),[month,setMonth]=useState('');
  const [client,setClient]=useState(''),[search,setSearch]=useState(''),[selectedAwb,setSelectedAwb]=useState('');
  const [drafts,setDrafts]=useState({}),[lastLoaded,setLastLoaded]=useState('');
  const [payment,setPayment]=useState({date:istToday(),mode:'ACCOUNT',amount:'',remarks:''});
  const [requestId,setRequestId]=useState(newId),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
  const [error,setError]=useState(''),[notice,setNotice]=useState('');
  const refresh=useCallback(async()=>{
    try{
      const response=await fetch(API+(month?'?month='+encodeURIComponent(month):''),{credentials:'include',cache:'no-store'});
      const data=await response.json();
      if(!response.ok||!data.ok)throw Error(data.error||'Export client ledger unavailable.');
      setRows(data.rows||[]);setReceipts(data.receipts||[]);setMonths(data.months||[]);
      setLastLoaded(new Date().toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata'}));setError('');
    }catch(e){setError('Ledger refresh failed: '+String(e?.message||e))}
    finally{setLoading(false)}
  },[month]);
  useEffect(()=>{
    void refresh();
    const timer=setInterval(()=>{if(document.visibilityState==='visible'&&!busy)void refresh()},30000);
    const handle=()=>{if(document.visibilityState==='visible'&&!busy)void refresh()};
    document.addEventListener('visibilitychange',handle);
    return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',handle)};
  },[refresh,busy]);
  const clients=useMemo(()=>[...new Map(rows.map(r=>[r.clientKey,r.clientName])).entries()].sort((a,b)=>a[1].localeCompare(b[1])),[rows]);
  const visible=useMemo(()=>rows.filter(r=>
    (!client||r.clientKey===client)&&(!search||[r.clientName,r.mawb].join(' ').toLowerCase().includes(search.trim().toLowerCase()))
  ),[rows,client,search]);
  const chosen=rows.find(r=>r.awb===selectedAwb)||null;
  const selectedClientRows=rows.filter(r=>r.clientKey===client);
  const selectedScheme=selectedClientRows[0]?.scheme||'3_ACCOUNT_3_CASH';
  const totals=useMemo(()=>visible.reduce((s,r)=>{
    s.masters++;if(r.missingEici)s.pendingEici++;
    if(r.weight===null){s.missingWeight++;return s}
    s.weight+=r.weight;
    for(const key of ['grossAccount','commission','netAccount','eiciAmount','eiciGst','accountCharge','cashCharge','totalCharge','accountReceived','cashReceived','accountBalance','cashBalance','balance'])
      s[key]+=Number(r[key]||0);
    return s;
  },{masters:0,pendingEici:0,missingWeight:0,weight:0,grossAccount:0,commission:0,netAccount:0,eiciAmount:0,eiciGst:0,accountCharge:0,cashCharge:0,totalCharge:0,accountReceived:0,cashReceived:0,accountBalance:0,cashBalance:0,balance:0}),[visible]);
  const shownReceipts=useMemo(()=>{
    const labels=new Map(visible.map(r=>[r.awb,r]));
    return receipts.filter(r=>labels.has(ledgerAwb(r.awb))&&(!selectedAwb||r.awb===selectedAwb))
      .map(r=>({...r,clientName:labels.get(r.awb)?.clientName||''}));
  },[receipts,visible,selectedAwb]);
  async function saveEici(row,raw){
    if(busy)return;
    const amount=validEiciAmount(raw);
    if(amount===null){setError('Enter EICI amount of ₹0 or more (up to two decimals) for '+row.mawb+'.');return}
    if(row.eiciAmount!==null&&Number(row.eiciAmount)===amount){
      setDrafts(p=>{const next={...p};delete next[row.awb];return next});return
    }
    setBusy(true);setError('');setNotice('');
    try{
      const response=await fetch(API,{method:'PATCH',credentials:'include',headers:{'content-type':'application/json'},
        body:JSON.stringify({action:'EICI',awb:row.awb,amount})});
      const data=await response.json();
      if(!response.ok||!data.ok)throw Error(data.error||'EICI save failed.');
      setDrafts(p=>{const next={...p};delete next[row.awb];return next});
      setNotice(row.mawb+' • EICI '+currency(data.eiciAmount)+' saved. GST '+currency(data.eiciGst)+'.');
      await refresh();
    }catch(e){setError('EICI not saved: '+String(e?.message||e))}
    finally{setBusy(false)}
  }
  async function saveSplit(scheme){
    if(!client||busy)return;
    setBusy(true);setError('');setNotice('');
    try{
      const response=await fetch(API,{method:'PATCH',credentials:'include',headers:{'content-type':'application/json'},
        body:JSON.stringify({action:'SPLIT',clientKey:client,scheme})});
      const data=await response.json();
      if(!response.ok||!data.ok)throw Error(data.error||'Client split save failed.');
      setNotice('Client rate split saved: '+(scheme==='2_ACCOUNT_4_CASH'?'₹2 account + ₹4 cash':'₹3 account + ₹3 cash')+' per kg.');
      await refresh();
    }catch(e){setError('Split not saved: '+String(e?.message||e))}
    finally{setBusy(false)}
  }
  async function saveReceipt(event){
    event.preventDefault();
    if(!chosen||busy)return;
    if(!validLedgerDate(payment.date)||validReceiptAmount(payment.amount)===null){
      setError('Enter a valid payment date and positive payment amount.');return
    }
    const sent={...payment},awb=chosen.awb,id=requestId;
    setBusy(true);setError('');setNotice('');
    try{
      const response=await fetch(API,{method:'POST',credentials:'include',headers:{'content-type':'application/json'},
        body:JSON.stringify({awb,date:sent.date,mode:sent.mode,amount:sent.amount,remarks:sent.remarks,clientRequestId:id})});
      const data=await response.json();
      if(!response.ok||!data.ok||!data.verifiedInDatabase)throw Error(data.error||'Payment could not be verified.');
      setNotice(currency(data.receipt.amount)+' '+sent.mode+' receipt saved for '+chosen.mawb+'.');
      setPayment(p=>({...p,amount:'',remarks:''}));setRequestId(newId());await refresh();
    }catch(e){setError('Payment not confirmed: '+String(e?.message||e)+'. Keep the same entry before retrying.')}
    finally{setBusy(false)}
  }
  async function deleteReceipt(item){
    if(busy||!window.confirm('Reverse '+currency(item.amount)+' '+item.mode+' receipt for '+item.mawb+'? The outstanding balance will increase.'))return;
    setBusy(true);setError('');setNotice('');
    try{
      const response=await fetch(API+'?id='+encodeURIComponent(item.id),{method:'DELETE',credentials:'include'});
      const data=await response.json();
      if(!response.ok||!data.ok)throw Error(data.error||'Unable to reverse payment.');
      setNotice('Receipt reversed: '+currency(data.reversedAmount)+' for '+item.mawb+'.');
      await refresh();
    }catch(e){setError('Receipt not reversed: '+String(e?.message||e))}
    finally{setBusy(false)}
  }
  return <main style={{padding:'18px clamp(12px,3vw,32px)',background:'#f5f8fc',color:'#14243b',minHeight:'75vh'}}>
    <header style={{display:'flex',justifyContent:'space-between',gap:12,flexWrap:'wrap',alignItems:'center'}}>
      <div><div style={{fontSize:12,letterSpacing:1,fontWeight:850,color:'#3767a5'}}>MAYAVI CARGO • EXPORT FINANCE • ADMIN</div>
        <h1 style={{fontSize:25,margin:'5px 0'}}>Export Client Ledger</h1>
        <p style={{fontSize:13,color:'#53647a',margin:0}}>Client-wise Export Profit MAWBs • EICI + 18% GST • Account/Cash balances • DHL commission</p>
      </div>
      <div style={{display:'flex',gap:8}}>
        <button type="button" onClick={()=>void refresh()} disabled={busy} style={button}>Refresh Ledger</button>
        <button type="button" onClick={()=>downloadCsv(visible)} disabled={!visible.length} style={button}>Download CSV</button>
      </div>
    </header>
    <section style={{display:'flex',gap:10,flexWrap:'wrap',margin:'16px 0'}}>
      {[['Export MAWBs',totals.masters],['Weight',kg(totals.weight)+' kg'],['Account Due',currency(totals.accountCharge)],['Cash Due',currency(totals.cashCharge)],['Received',currency(totals.accountReceived+totals.cashReceived)],['Outstanding',currency(totals.balance)]].map(([label,value])=>
        <div key={label} style={{...panel,minWidth:155,flex:'1 1 155px'}}><small style={{color:'#506782'}}>{label}</small><div style={{fontSize:22,fontWeight:900,marginTop:4}}>{value}</div></div>)}
    </section>
    {(totals.pendingEici>0||totals.missingWeight>0)&&<p role="note" style={{padding:11,background:'#fff7df',borderRadius:8,fontSize:12}}>
      {totals.pendingEici} MAWB(s) need EICI entered; until then their dues exclude EICI and GST.
      {totals.missingWeight>0?' '+totals.missingWeight+' MAWB(s) need Weight before dues can be calculated.':''}
    </p>}
    <section style={{...panel,display:'flex',alignItems:'end',flexWrap:'wrap',gap:12,marginBottom:14}}>
      <label style={{display:'grid',gap:5,fontSize:12,fontWeight:800}}>Handover Month
        <select style={field} value={month||months.at(-1)||''} onChange={e=>{setMonth(e.target.value);setSelectedAwb('');setLoading(true)}}>
          {months.map(m=><option key={m} value={m}>{new Date(m+'-01T12:00:00').toLocaleDateString('en-IN',{month:'long',year:'numeric'})}</option>)}
        </select>
      </label>
      <label style={{display:'grid',gap:5,fontSize:12,fontWeight:800}}>Client
        <select style={field} value={client} onChange={e=>{setClient(e.target.value);setSelectedAwb('')}}>
          <option value="">All Clients</option>{clients.map(([key,name])=><option key={key} value={key}>{name}</option>)}
        </select>
      </label>
      <label style={{display:'grid',gap:5,fontSize:12,fontWeight:800}}>Search MAWB
        <input style={field} placeholder="Client / MAWB" value={search} onChange={e=>setSearch(e.target.value)}/>
      </label>
      {client&&selectedClientRows.length>0&&<label style={{display:'grid',gap:5,fontSize:12,fontWeight:800}}>Account / Cash Rate Per kg
        {selectedScheme==='DHL'
          ?<div style={{...field,fontWeight:800}}>DHL ₹19 account − ₹8 commission</div>
          :<select style={field} disabled={busy} value={selectedScheme} onChange={e=>void saveSplit(e.target.value)}>
            <option value="3_ACCOUNT_3_CASH">₹3 Account + ₹3 Cash</option>
            <option value="2_ACCOUNT_4_CASH">₹2 Account + ₹4 Cash</option>
          </select>}
      </label>}
      <small style={{marginLeft:'auto',color:'#64748b'}}>Updated {lastLoaded||'—'} IST • Auto-refresh 30 sec</small>
    </section>
    {error&&<p role="alert" style={{padding:11,color:'#9f1239',background:'#ffe4e6',borderRadius:8}}>{error}</p>}
    {notice&&<p role="status" style={{padding:11,color:'#065f46',background:'#e5f9f1',borderRadius:8}}>{notice}</p>}
    <section style={{...panel,overflowX:'auto',padding:0,marginBottom:16}}>
      <table style={{borderCollapse:'collapse',width:'100%',fontSize:12}}>
        <thead><tr><th style={head}>Choose</th>{columns.map(label=><th key={label} style={head}>{label}</th>)}</tr></thead>
        <tbody>{visible.map(row=><tr key={row.awb} style={{background:selectedAwb===row.awb?'#e8f5ff':'#fff'}}>
          <td style={cell}><button type="button" style={{...button,padding:'6px 9px',fontSize:11}} onClick={()=>{setSelectedAwb(row.awb);setPayment({date:istToday(),mode:'ACCOUNT',amount:'',remarks:''});setRequestId(newId())}}>Payment</button></td>
          <td style={{...cell,fontWeight:800}}>{row.clientName}</td>
          <td style={{...cell,fontWeight:800,color:'#1f5599'}}>{row.mawb}</td>
          <td style={cell}>{row.register==='MASTER COPY RECEIVED'?'Master Copy Received':'Active'}</td>
          <td style={cell}>{kg(row.weight)}</td>
          <td style={cell}>{currency(row.grossAccount)}</td>
          <td style={cell}>{currency(row.commission)}</td>
          <td style={cell}>{currency(row.netAccount)}</td>
          <td style={cell}><input type="number" aria-label={'EICI amount for '+row.mawb}
            min="0" step="0.01" placeholder="Enter EICI" disabled={busy}
            value={drafts[row.awb]??(row.eiciAmount===null?'':String(row.eiciAmount))}
            onChange={e=>setDrafts(p=>({...p,[row.awb]:e.target.value}))}
            onBlur={e=>{if(e.target.value.trim()!=='')void saveEici(row,e.target.value)}}
            onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur()}}
            style={{...field,width:115,minHeight:30,padding:'5px 7px'}}/></td>
          <td style={cell}>{currency(row.eiciGst)}</td>
          <td style={cell}>{currency(row.accountCharge)}</td>
          <td style={cell}>{currency(row.cashCharge)}</td>
          <td style={{...cell,fontWeight:800}}>{currency(row.totalCharge)}</td>
          <td style={cell}>{currency(row.accountReceived)}</td>
          <td style={cell}>{currency(row.cashReceived)}</td>
          <td style={cell}>{currency(row.accountBalance)}</td>
          <td style={cell}>{currency(row.cashBalance)}</td>
          <td style={{...cell,fontWeight:900,color:row.balance>0?'#a73232':'#137c4e'}}>{currency(row.balance)}</td>
        </tr>)}
        {!visible.length&&<tr><td colSpan={columns.length+1} style={{padding:25,textAlign:'center'}}>{loading?'Loading Export ledger…':'No Export MAWBs in this selection.'}</td></tr>}</tbody>
        {visible.length>0&&<tfoot><tr style={{background:'#dfeaf9',fontWeight:900}}><td colSpan={4} style={cell}>TOTAL • {visible.length} MAWBs</td>
          <td style={cell}>{kg(totals.weight)}</td>
          {['grossAccount','commission','netAccount','eiciAmount','eiciGst','accountCharge','cashCharge','totalCharge','accountReceived','cashReceived','accountBalance','cashBalance','balance'].map(key=><td key={key} style={cell}>{currency(totals[key])}</td>)}
        </tr></tfoot>}
      </table>
    </section>
    <section style={{...panel,marginBottom:14}}>
      <h2 style={{fontSize:17,margin:'0 0 10px'}}>Record Export Client Payment {chosen?'• '+chosen.clientName+' / '+chosen.mawb:''}</h2>
      {!chosen?<p style={{fontSize:13,color:'#52657f'}}>Use the Payment button beside a MAWB to record a dated Account or Cash receipt.</p>:
      <form onSubmit={saveReceipt} style={{display:'flex',gap:10,alignItems:'end',flexWrap:'wrap'}}>
        <label style={{display:'grid',gap:4,fontSize:12}}>Payment Date<input required type="date" style={field} value={payment.date} onChange={e=>setPayment(p=>({...p,date:e.target.value}))}/></label>
        <label style={{display:'grid',gap:4,fontSize:12}}>Mode<select style={field} value={payment.mode} onChange={e=>setPayment(p=>({...p,mode:e.target.value}))}>
          <option value="ACCOUNT">Account</option><option value="CASH">Cash</option></select></label>
        <label style={{display:'grid',gap:4,fontSize:12}}>Amount (₹)<input required type="number" min="0.01" step="0.01" style={field} value={payment.amount} onChange={e=>setPayment(p=>({...p,amount:e.target.value}))}/></label>
        <label style={{display:'grid',gap:4,fontSize:12}}>Remarks<input style={field} maxLength={500} value={payment.remarks} onChange={e=>setPayment(p=>({...p,remarks:e.target.value}))}/></label>
        <button type="submit" disabled={busy} style={button}>{busy?'Saving…':'Save Payment'}</button>
      </form>}
    </section>
    <section style={panel}>
      <h2 style={{fontSize:17,margin:'0 0 10px'}}>Payment History {chosen?'• '+chosen.mawb:''}</h2>
      <div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse'}}>
        <thead><tr>{['Date','Client','MAWB','Mode','Amount','Remarks','Entered By','Action'].map(x=><th key={x} style={head}>{x}</th>)}</tr></thead>
        <tbody>{shownReceipts.map(p=><tr key={p.id}>
          <td style={cell}>{p.date}</td><td style={cell}>{p.clientName}</td><td style={cell}>{p.mawb}</td>
          <td style={cell}>{p.mode}</td><td style={cell}>{currency(p.amount)}</td>
          <td style={cell}>{p.remarks||'—'}</td><td style={cell}>{p.createdBy||'—'}</td>
          <td style={cell}><button type="button" disabled={busy} onClick={()=>void deleteReceipt(p)} style={{...button,background:'#b42333',padding:'6px 10px'}}>Reverse</button></td>
        </tr>)}
        {!shownReceipts.length&&<tr><td colSpan={8} style={{...cell,padding:18}}>No Export payments recorded for this selection.</td></tr>}</tbody>
      </table></div>
    </section>
    <p style={{fontSize:12,color:'#53647a',lineHeight:1.5}}>
      Account = Account Gross − DHL Commission + EICI + 18% GST. Cash = cash rate × master weight.
      DHL: ₹19/kg Account Gross and ₹8/kg Commission (net ₹11/kg Account; no Cash split). Other clients: ₹3/kg Account and ₹3/kg Cash by default; a client may be set to ₹2/kg Account and ₹4/kg Cash. The EICI field is the total EICI rupee amount for the MAWB; until entered, GST is not included. Each master MAWB is billed once, including part shipments. This ledger does not change Export Profit formulas or Import ledger data.
    </p>
  </main>;
}
