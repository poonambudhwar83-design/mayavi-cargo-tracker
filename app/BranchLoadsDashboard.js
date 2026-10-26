'use client';

import {useEffect,useMemo,useState} from 'react';
import {BRANCHES,DESTINATIONS,SERVICES,COMMODITIES,LOAD_STATUSES,statusLabel,initialBranchStatus,amounts,requiresExtraCost,requiresBottleCount,allocateExtraCost,jepoAmount,branchPayment,totalJepoForLoad,totalBranchForLoad} from '../lib/branchLoads.js';
import styles from './BranchLoadsDashboard.module.css';

const API='/api/branch-loads';
// One shared width blueprint keeps saved values exactly beneath their respective headings.
const LEDGER_WIDTHS=[92,184,126,110,138,136,132,125,160,165,145,120,202,161,176,133,132,151];
const ledgerColumns=extra=><colgroup>{[...LEDGER_WIDTHS,...(extra?[142]:[]),192].map((width,i)=><col key={i} style={{width:width+'px'}}/>)}</colgroup>;
const todayIST=()=>new Date(Date.now()+330*60000).toISOString().slice(0,10);
const fresh=(branch='JIND')=>({
  branch,date:todayIST(),weight:'',rate:'',received:'',jepoRate:'',extraCost:'',bottleCount:'',
  destination:'',service:'',commodity:'',trackingNo:'',status:initialBranchStatus(branch)
});
const money=value=>Number(value||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
const weightFormat=value=>Number(value||0).toLocaleString('en-IN',{maximumFractionDigits:3});
const weekday=value=>/^\d{4}-\d{2}-\d{2}$/.test(String(value||''))?new Intl.DateTimeFormat('en-IN',{weekday:'long',timeZone:'UTC'}).format(new Date(value+'T00:00:00Z')):'';
const showDate=value=>value?weekday(value)+', '+String(value).split('-').reverse().join('/'):'—';
const employeeName=value=>String(value||'').split(/[._-]/).map(v=>v? v[0].toUpperCase()+v.slice(1):'').join(' ')||'—';
const fmt=(v)=>v===null?'—':'₹'+money(v);
const safeCsvValue=value=>{const v=String(value??'');return '"'+(/^[=+@\-\t\r]/.test(v)?"'"+v:v).replace(/"/g,'""')+'"';};

function FieldChoice({name,list,value,onChange}){
  const selected=list.includes(value)&&value!=='Other'?value:value?'__other__':'';
  return <div className={styles.choice}>
    <select aria-label={name} required value={selected} onChange={e=>onChange(e.target.value==='__other__'?'__other__':e.target.value)}>
      <option value="">Select {name.toLowerCase()}</option>
      {list.filter(x=>x!=='Other').map(x=><option key={x} value={x}>{x}</option>)}
      <option value="__other__">Other / Enter manually</option>
    </select>
    {selected==='__other__'&&<input aria-label={'Enter '+name} required autoComplete="off" placeholder={'Type '+name.toLowerCase()} maxLength={120} value={value==='__other__'?'':value} onChange={e=>onChange(e.target.value||'__other__')}/>}
  </div>;
}

export default function BranchLoadsDashboard({currentUser}){
  const isAdmin=currentUser?.role==='admin';
  const userBranch=isAdmin?'':String(currentUser?.branchScope||currentUser?.username||'').toUpperCase();
  const [filter,setFilter]=useState(isAdmin?'ALL':userBranch);
  const [rows,setRows]=useState([]);
  const [loaded,setLoaded]=useState(false);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [editing,setEditing]=useState('new');
  const [sheet,setSheet]=useState('ACTIVE');
  const [dayFilter,setDayFilter]=useState(()=>isAdmin?'':todayIST());
  const [draft,setDraft]=useState(()=>fresh(userBranch||'JIND'));
  const [search,setSearch]=useState('');
  const [month,setMonth]=useState('');
  const [lastUpdated,setLastUpdated]=useState('');

  async function load(){
    try{
      const res=await fetch(API,{credentials:'include',cache:'no-store'});
      const data=await res.json();
      if(!res.ok||!data.ok)throw new Error(data.error||'Unable to load branch records.');
      setRows(data.rows||[]);
      setLastUpdated(new Date().toLocaleTimeString('en-IN'));
      setMessage(m=>m.startsWith('Unable')?'':m);
    }catch(e){setMessage('Unable to load records: '+(e?.message||e));}
    finally{setLoaded(true);}
  }
  useEffect(()=>{
    void load();
    const onFocus=()=>{if(document.visibilityState==='visible')void load()};
    const timer=setInterval(onFocus,30000);
    document.addEventListener('visibilitychange',onFocus);
    window.addEventListener('focus',onFocus);
    return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',onFocus);window.removeEventListener('focus',onFocus);};
  },[]);

  const shown=useMemo(()=>rows.filter(r=>
    (filter==='ALL'||r.branch===filter)&&
    (sheet==='DELIVERED'?(r.status==='DELIVERED'):(r.status!=='DELIVERED'))&&
    (!dayFilter||r.date===dayFilter)&&
    (!month||String(r.date||'').startsWith(month))&&
    (!search||[r.trackingNo,r.destination,r.service,r.commodity,r.branch,r.date].join(' ').toLowerCase().includes(search.toLowerCase()))
  ),[rows,filter,sheet,dayFilter,month,search]);
  const activeCount=useMemo(()=>rows.filter(r=>(filter==='ALL'||r.branch===filter)&&r.status!=='DELIVERED').length,[rows,filter]);
  const deliveredCount=useMemo(()=>rows.filter(r=>(filter==='ALL'||r.branch===filter)&&r.status==='DELIVERED').length,[rows,filter]);
  function switchSheet(next){
    setSheet(next);setMessage('');setDayFilter(next==='ACTIVE'&&!isAdmin?todayIST():'');setMonth('');setSearch('');
    setEditing(next==='ACTIVE'?'new':'');
    setDraft(fresh(isAdmin&&filter!=='ALL'?filter:userBranch||'JIND'));
  }
  const totals=useMemo(()=>shown.reduce((t,r)=>({
    weight:t.weight+Number(r.weight||0),
    amount:t.amount+Number(r.amount||0),
    received:t.received+Number(r.received||0),
    balance:t.balance+Number(r.balance||0),
    paidToJepo:t.paidToJepo+Number(r.paidToJepo||0),
    paidToBranch:t.paidToBranch+Number(r.paidToBranch||0),
    totalJepo:t.totalJepo+Number(totalJepoForLoad(r.paidToJepo,r.commodity,r.extraCost,r.bottleCount,{legacy:true})||0),
    extraCost:t.extraCost+(requiresExtraCost(r.commodity)?Number(r.extraCost||0):0)
  }),{weight:0,amount:0,received:0,balance:0,paidToJepo:0,paidToBranch:0,extraCost:0,totalJepo:0}),[shown]);
  // Extra Cost appears only for mixed-household entries; the derived Total JEPO
  // payment is always the very last column, whether Extra Cost exists or not.
  const hasExtraCostColumn=shown.some(r=>requiresExtraCost(r.commodity))||
    (editing!==''&&editing!=='new'&&requiresExtraCost(draft.commodity));
  const preview=amounts(draft.weight,draft.rate,draft.received);
  const jepoPreview=jepoAmount(draft.weight,draft.jepoRate);
  const branchBasePreview=branchPayment(draft.weight,draft.rate,draft.jepoRate);
  const branchPreview=branchBasePreview===null?null:totalBranchForLoad(preview?.amount,jepoPreview,draft.commodity,draft.extraCost,draft.bottleCount);
  const totalJepoPreview=jepoPreview===null?null:totalJepoForLoad(jepoPreview,draft.commodity,draft.extraCost,draft.bottleCount);
  const set=(field,value)=>setDraft(d=>({...d,[field]:value}));

  function add(){
    setSheet('ACTIVE');setDraft({...fresh(isAdmin&&filter!=='ALL'?filter:userBranch||'JIND'),date:dayFilter||todayIST()});
    setEditing('new');setMessage('');
  }
  function edit(row){
    setEditing(row.id);
    setDraft({
      branch:row.branch,date:row.date||todayIST(),weight:row.weight||'',rate:row.rate||'',
      received:row.received||'',jepoRate:row.jepoRate??'',
      extraCost:requiresExtraCost(row.commodity)?(Number(row.extraCost||0)?row.extraCost:''):'',
      bottleCount:row.bottleCount??'',
      destination:row.destination||'',service:row.service||'',commodity:row.commodity||'',
      trackingNo:row.trackingNo||'',status:row.status||initialBranchStatus(row.branch)
    });
    setMessage('');
  }
  function cancel(){setEditing(sheet==='ACTIVE'?'new':'');setDraft({...fresh(isAdmin&&filter!=='ALL'?filter:userBranch||'JIND'),date:dayFilter||todayIST()});setMessage('');}
  async function save(event){
    event.preventDefault();
    if(busy||!editing)return;
    if(['destination','service','commodity'].some(k=>!draft[k]||draft[k]==='__other__')){
      setMessage('Please select or type Destination, Service and Commodity.');return;
    }
    if(preview===null){setMessage('Enter a positive Load Weight and valid Rate / Received amounts.');return;}
    if(jepoPreview===null){setMessage('Please enter a valid JEPO Rate per kg.');return;}
    if(branchBasePreview===null||branchBasePreview<0){setMessage('JEPO Rate must not exceed the selling Rate.');return;}
    if(requiresBottleCount(draft.commodity)&&(!/^[1-9]\d{0,4}$/.test(String(draft.bottleCount))||Number(draft.bottleCount)>10000)){setMessage('Enter No. of Bottles (1–10000).');return;}
    if(requiresBottleCount(draft.commodity)&&Number(draft.extraCost||0)<Number(draft.bottleCount)*250){setMessage('Ghee Extra Cost must be at least ₹250 × No. of Bottles. The remainder goes to Branch.');return;}
    if(branchPreview===null||branchPreview<0){setMessage('Check Extra Cost and payment amounts.');return;}
    const currentId=editing;
    setBusy(true);setMessage('');
    try{
      const res=await fetch(API,{method:currentId==='new'?'POST':'PATCH',
        headers:{'content-type':'application/json'},credentials:'include',
        body:JSON.stringify({...draft,...(currentId==='new'?{}:{id:currentId})})
      });
      const data=await res.json();
      if(!res.ok||!data.ok)throw new Error(data.error||'Save failed.');
      setRows(prev=>currentId==='new'?[data.row,...prev]:prev.map(r=>r.id===currentId?data.row:r));
      // Every dated load is independent; next entry stays open on Active.
      setEditing(sheet==='ACTIVE'?'new':'');
      setDraft({...fresh(data.row.branch),date:data.row.date});
      if(sheet==='ACTIVE'){if(!isAdmin)setDayFilter(data.row.date);setMonth('');setSearch('');}
      setMessage(data.row.status==='DELIVERED'
        ?'Delivered load saved and moved to Delivered Sheet.'
        :'Entry saved in shared Mayavi database. Admin can see it under JIND / KARNAL LOADS. Add the next load.');
    }catch(e){setMessage(e?.message||'Could not save entry.');}
    finally{setBusy(false);}
  }
  async function remove(row){
    if(!isAdmin)return;
    if(!window.confirm('Delete '+row.branch+' entry dated '+showDate(row.date)+'?'))return;
    setBusy(true);setMessage('');
    try{
      const res=await fetch(API+'?id='+encodeURIComponent(row.id),{method:'DELETE',credentials:'include'});
      const data=await res.json();
      if(!res.ok||!data.ok)throw new Error(data.error||'Delete failed.');
      setRows(p=>p.filter(r=>r.id!==row.id));
      if(editing===row.id)setEditing(sheet==='ACTIVE'?'new':'');
      setMessage('Entry deleted.');
    }catch(e){setMessage(e?.message||'Unable to delete.');}
    finally{setBusy(false);}
  }
  async function changeStatus(row,status){
    if(busy||status===row.status)return;
    setBusy(true);setMessage('');
    try{
      const response=await fetch(API,{method:'PATCH',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({id:row.id,status,statusOnly:true})});
      const data=await response.json();
      if(!response.ok||!data.ok)throw new Error(data.error||'Status change failed.');
      setRows(prev=>prev.map(r=>r.id===row.id?data.row:r));
      setMessage(status==='DELIVERED'
        ?'Delivered — the entry has moved to Delivered Sheet.'
        :'Status updated. The entry is in Active Register.');
    }catch(e){setMessage(e?.message||'Unable to update status.');}
    finally{setBusy(false);}
  }
  function downloadCsv(){
    const labels=['Branch','Date','Day','Load Received (kg)','Rate (INR/kg)','Amount (INR)','Received (INR)','Balance (INR)','JEPO Rate (INR/kg)','Amount Paid to JEPO (INR)','Amount Paid to Branch (INR)','Destination','Service','Commodity','No. of Bottles','JEPO Tracking No.','Status','Entered By','Last Edited By',...(hasExtraCostColumn?['Extra Cost (INR)']:[]),'Total Amount Paid to JEPO (INR)'];
    const data=shown.map(r=>[r.branch,r.date,weekday(r.date),r.weight,r.rate,r.amount,r.received,r.balance,r.jepoRate,r.paidToJepo,r.paidToBranch,r.destination,r.service,r.commodity,r.bottleCount||'',r.trackingNo||'',statusLabel(r.status),employeeName(r.createdBy),employeeName(r.updatedBy),...(hasExtraCostColumn?[requiresExtraCost(r.commodity)?r.extraCost||0:'']:[]),totalJepoForLoad(r.paidToJepo,r.commodity,r.extraCost,r.bottleCount,{legacy:true})]);
    data.push(['TOTAL','','',totals.weight,'',totals.amount,totals.received,totals.balance,'',totals.paidToJepo,totals.paidToBranch,'','','','','','','','',...(hasExtraCostColumn?[totals.extraCost]:[]),totals.totalJepo]);
    const csv='\uFEFF'+[labels,...data].map(line=>line.map(safeCsvValue).join(',')).join('\r\n');
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
    const anchor=document.createElement('a');
    anchor.href=url;anchor.download='mayavi-'+(filter==='ALL'?'jind-karnal':filter.toLowerCase())+'-'+sheet.toLowerCase()+'-loads'+(dayFilter?'-'+dayFilter:month?'-'+month:'')+'.csv';
    anchor.click();URL.revokeObjectURL(url);
  }
  const input={type:'number',min:'0',step:'any',inputMode:'decimal'};
  function entryRow(showExtraColumn=false){
    return <tr className={styles.editRow}>
      <td>{isAdmin?<select aria-label="Branch" value={draft.branch} onChange={e=>setDraft(d=>({...d,branch:e.target.value,status:initialBranchStatus(e.target.value)}))}>{BRANCHES.map(x=><option key={x}>{x}</option>)}</select>:<b>{userBranch}</b>}</td>
      <td><input aria-label="Date" required type="date" value={draft.date} onChange={e=>set('date',e.target.value)}/>{draft.date&&<small className={styles.dateDay}>{weekday(draft.date)}</small>}</td>
      <td><input aria-label="Load received kilograms" {...input} required value={draft.weight} placeholder="Weight kg" onChange={e=>set('weight',e.target.value)}/></td>
      <td><input aria-label="Rate per kg" {...input} required value={draft.rate} placeholder="₹/kg" onChange={e=>set('rate',e.target.value)}/></td>
      <td className={styles.computed}>{fmt(preview?.amount??null)}</td>
      <td><input aria-label="Received payment" {...input} value={draft.received} placeholder="₹ received" onChange={e=>set('received',e.target.value)}/></td>
      <td className={styles.computed}>{fmt(preview?.balance??null)}</td>
      <td><input aria-label="JEPO Rate per kg" {...input} required value={draft.jepoRate} placeholder="₹/kg JEPO" onChange={e=>set('jepoRate',e.target.value)}/></td>
      <td className={styles.computed}>{fmt(jepoPreview)}</td>
      <td className={styles.computed}>{fmt(branchPreview)}</td>
      <td><FieldChoice name="Destination" list={DESTINATIONS} value={draft.destination} onChange={v=>set('destination',v)}/></td>
      <td><FieldChoice name="Service" list={SERVICES} value={draft.service} onChange={v=>set('service',v)}/></td>
      <td><FieldChoice name="Commodity" list={COMMODITIES} value={draft.commodity} onChange={v=>setDraft(d=>({...d,commodity:v,extraCost:requiresExtraCost(v)?d.extraCost:'',bottleCount:requiresBottleCount(v)?d.bottleCount:''}))}/>{requiresBottleCount(draft.commodity)&&<label className={styles.bottleControl}>No. of Bottles<input aria-label="No. of Bottles" type="number" min="1" max="10000" step="1" required value={draft.bottleCount} placeholder="Enter bottles" onChange={e=>set('bottleCount',e.target.value)}/></label>}</td>
      <td><input aria-label="JEPO tracking number" placeholder="JEPO tracking" maxLength={100} value={draft.trackingNo} onChange={e=>set('trackingNo',e.target.value)}/></td>
      <td><select aria-label="Delivery status" value={draft.status} onChange={e=>set('status',e.target.value)}>{LOAD_STATUSES.map(x=><option key={x} value={x}>{statusLabel(x)}</option>)}</select></td>
      <td className={styles.audit}>{editing==='new'?currentUser?.displayName||employeeName(currentUser?.username):employeeName(rows.find(r=>r.id===editing)?.createdBy)}</td>
      <td className={styles.audit}>{editing==='new'?'—':currentUser?.displayName||employeeName(currentUser?.username)}</td>
      <td className={styles.actions}><button type="submit" disabled={busy}>{busy?'Saving…':'Save'}</button><button type="button" className={styles.secondary} disabled={busy} onClick={cancel}>Cancel</button></td>
      {showExtraColumn&&<td className={styles.extraCostCell}>{requiresExtraCost(draft.commodity)?
        <input aria-label="Extra Cost in rupees" {...input} placeholder="₹ Extra Cost" value={draft.extraCost} onChange={e=>set('extraCost',e.target.value)}/>:'—'}</td>}
      <td className={styles.totalJepoCell}>{fmt(totalJepoPreview)}</td>
    </tr>;
  }
  function entryRowCells(){
    // Reuse the complete edit row cell layout for existing entries.
    return entryRow(hasExtraCostColumn).props.children;
  }
  const dataCells=record=>[
    <td key="branch"><span className={styles.branchTag} data-branch={record.branch}>{record.branch}</span></td>,
    <td key="date">{showDate(record.date)}</td>,
    <td key="weight" className={styles.number}>{weightFormat(record.weight)}</td>,
    <td key="rate" className={styles.number}>{money(record.rate)}</td>,
    <td key="amount" className={styles.number}><b>{money(record.amount)}</b></td>,
    <td key="received" className={styles.number}>{money(record.received)}</td>,
    <td key="balance" className={styles.number}><strong className={Number(record.balance)>0?styles.due:styles.clear}>{money(record.balance)}</strong></td>,
    <td key="jepoRate" className={styles.number}>{money(record.jepoRate)}</td>,
    <td key="jepo" className={styles.number}>{money(record.paidToJepo)}</td>,
    <td key="branchpaid" className={styles.number}>{money(record.paidToBranch)}</td>,
    <td key="destination">{record.destination}</td>,
    <td key="service">{record.service}</td>,
    <td key="commodity">{record.commodity}{requiresBottleCount(record.commodity)&&<small className={styles.bottleNote}>No. of Bottles: {record.bottleCount??'Not recorded'}</small>}</td>,
    <td key="tracking"><b>{record.trackingNo||'—'}</b></td>,
    <td key="status"><select className={styles.statusChip} data-status={record.status} aria-label={'Status for '+(record.trackingNo||record.branch)} disabled={busy} value={record.status||initialBranchStatus(record.branch)} onChange={e=>changeStatus(record,e.target.value)}>
      {LOAD_STATUSES.map(x=><option key={x} value={x}>{statusLabel(x)}</option>)}
    </select></td>,
    <td key="entered"><strong className={styles.audit}>{employeeName(record.createdBy)}</strong></td>,
    <td key="edited"><span className={styles.audit}>{employeeName(record.updatedBy)}</span></td>,
    <td key="actions" className={styles.actions}><button type="button" onClick={()=>edit(record)} disabled={busy}>Edit</button>{isAdmin&&<button type="button" onClick={()=>remove(record)} disabled={busy} className={styles.danger}>Delete</button>}</td>,
    ...(hasExtraCostColumn?[<td key="extraCost" className={styles.extraCostCell+' '+styles.number}>{requiresExtraCost(record.commodity)?'₹'+money(record.extraCost):'—'}</td>]:[]),
    <td key="totalPaidToJepo" className={styles.totalJepoCell+' '+styles.number}>{fmt(totalJepoForLoad(record.paidToJepo,record.commodity,record.extraCost,record.bottleCount,{legacy:true}))}</td>
  ];
  return <main className={styles.page}>
    <header className={styles.heading}>
      <div><small>MAYAVI CARGO • DAILY BRANCH REGISTER</small><h1>Jind &amp; Karnal — Daily Load &amp; Payments</h1>
        <p>Daily Load Entry above • Shared saved Jind and Karnal records • Admin sees both branches • Separate Delivered sheet</p></div>
    </header>
    <div className={styles.metrics}>
      <div><span>Total Load</span><strong>{weightFormat(totals.weight)} kg</strong></div>
      <div><span>Amount</span><strong>{fmt(totals.amount)}</strong></div>
      <div><span>Received</span><strong>{fmt(totals.received)}</strong></div>
      <div><span>Balance</span><strong>{fmt(totals.balance)}</strong></div>
      <div><span>Paid to JEPO</span><strong>{fmt(totals.paidToJepo)}</strong></div>
      <div><span>Paid to Branch</span><strong>{fmt(totals.paidToBranch)}</strong></div>
    </div>
    <form onSubmit={save}>
      {sheet==='ACTIVE'&&editing==='new'&&<section className={styles.loadEntrySection}>
        <div className={styles.loadEntryTitle}>
          <div><h2>Load Entry</h2><p>Enter today's load here. Change date for an earlier entry. Day appears automatically.</p></div>
          <span className={styles.actorName}>Entering as: {currentUser?.displayName||employeeName(currentUser?.username)} • {isAdmin?draft.branch:userBranch}</span>
        </div>
        <div className={styles.scroller}><table className={styles.table}>
          {ledgerColumns(requiresExtraCost(draft.commodity))}
          <thead><tr><th>Branch</th><th>Date &amp; Day</th><th>Load Received (kg)</th><th>Rate (₹/kg)</th><th>Amount • Auto</th><th>Received (₹)</th><th>Balance • Auto</th><th>JEPO Rate (₹/kg)</th><th>Paid to JEPO • Auto (₹)</th><th>Paid to Branch • Auto (₹)</th><th>Destination</th><th>Service</th><th>Commodity</th><th>JEPO Tracking No.</th><th>Status</th><th>Entered By</th><th>Edited By</th><th>Save</th>{requiresExtraCost(draft.commodity)&&<th className={styles.extraCostHeader}>Extra Cost (₹)</th>}<th className={styles.totalJepoHeader}>Total Amount Paid to JEPO (₹)</th></tr></thead>
          <tbody>{entryRow(requiresExtraCost(draft.commodity))}</tbody>
        </table></div>
      </section>}
    <nav className={styles.sheetTabs} aria-label="Load sheet">
      <button type="button" className={sheet==='ACTIVE'?styles.activeTab:styles.sheetTab} onClick={()=>switchSheet('ACTIVE')}>Active Loads ({activeCount})</button>
      <button type="button" className={sheet==='DELIVERED'?styles.deliveredTab:styles.sheetTab} onClick={()=>switchSheet('DELIVERED')}>Delivered Sheet ({deliveredCount})</button>
    </nav>
    {message&&<div className={styles.message} role="status">{message}</div>}
    <p className={styles.hint}>Amount = Load Received (kg) × Rate; Balance = Amount − Received. Amount Paid to JEPO = Load Received (kg) × JEPO Rate (₹/kg). Paid to Branch = Amount − Amount Paid to JEPO (auto-calculated). Extra Cost is recorded separately for Household and Medicine / Ghee / Electronics. For Ghee, JEPO Extra Cost = No. of Bottles × ₹250, and the remainder goes to Branch; for other mixed-household commodities the full Extra Cost goes to JEPO.</p>
      <div className={styles.scroller}><table className={styles.table}>
        {ledgerColumns(hasExtraCostColumn)}
        <thead><tr>
          <th>Branch{isAdmin&&<select aria-label="Branch filter" className={styles.headerFilter} value={filter} onChange={e=>setFilter(e.target.value)}><option value="ALL">Both</option>{BRANCHES.map(x=><option key={x} value={x}>{x}</option>)}</select>}</th>
          <th>Date{sheet==='ACTIVE'&&<><input aria-label="Filter by date" className={styles.headerDate} type="date" value={dayFilter} onChange={e=>{setDayFilter(e.target.value);setMonth('')}}/><button type="button" className={styles.headerLink} onClick={()=>{setDayFilter('');setMonth('')}}>All dates</button></>}</th>
          <th>Load Received (kg)</th><th>Rate (₹/kg)</th><th>Amount (₹) • Auto</th><th>Received (₹)</th><th>Balance (₹) • Auto</th><th>JEPO Rate (₹/kg)</th><th>Amount Paid to JEPO (₹) • Auto</th><th>Amount Paid to Branch (₹) • Auto</th><th>Destination</th><th>Service</th><th>Commodity</th><th>JEPO Tracking No.</th><th>Status</th><th>Entered By</th><th>Last Edited By</th><th>Actions</th>{hasExtraCostColumn&&<th className={styles.extraCostHeader}>Extra Cost (₹)</th>}<th className={styles.totalJepoHeader}>Total Amount Paid to JEPO (₹)</th>
        </tr></thead>
        <tbody>
          {/* Daily Load Entry stays above; saved records only in this sheet. */}
          {shown.map(row=>editing===row.id?<tr key={row.id} className={styles.editRow}>{entryRowCells()}</tr>:<tr key={row.id} data-branch={row.branch} className={row.status==='DELIVERED'?styles.deliveredRow:''}>{dataCells(row)}</tr>)}
          {!loaded&&<tr><td colSpan={19+(hasExtraCostColumn?1:0)}>Loading branch entries…</td></tr>}
          {loaded&&!shown.length&&editing!=='new'&&<tr><td colSpan={19+(hasExtraCostColumn?1:0)} className={styles.empty}>No saved loads in this sheet. Use Load Entry above for new loads.</td></tr>}
        </tbody>
        <tfoot><tr><td>TOTAL</td><td>{shown.length} entries</td><td className={styles.number}>{weightFormat(totals.weight)}</td><td>—</td><td className={styles.number}>{money(totals.amount)}</td><td className={styles.number}>{money(totals.received)}</td><td className={styles.number}>{money(totals.balance)}</td><td>—</td><td className={styles.number}>{money(totals.paidToJepo)}</td><td className={styles.number}>{money(totals.paidToBranch)}</td><td colSpan={8}>—</td>{hasExtraCostColumn&&<td className={styles.extraCostCell+' '+styles.number}>{money(totals.extraCost)}</td>}<td className={styles.totalJepoCell+' '+styles.number}>{fmt(totals.totalJepo)}</td></tr></tfoot>
      </table></div>
    </form>
    <footer className={styles.foot}>
      <span>Daily loads are saved securely. {lastUpdated&&'Last synced: '+lastUpdated}</span>
      <span className={styles.footerActions}>
        {sheet==='ACTIVE'&&<button type="button" onClick={add} disabled={busy}>+ Daily Entry</button>}
        <button type="button" onClick={()=>void load()}>Refresh</button>
        <button type="button" onClick={downloadCsv} disabled={!shown.length}>Download CSV</button>
      </span>
    </footer>
  </main>;
}
