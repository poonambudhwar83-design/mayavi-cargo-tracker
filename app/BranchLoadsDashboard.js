'use client';

import {useEffect,useMemo,useRef,useState} from 'react';
import {BRANCHES,DESTINATIONS,SERVICES,COMMODITIES,LOAD_STATUSES,statusLabel,initialBranchStatus,amounts,requiresExtraCost,requiresBottleCount,minimumJepoExtraCost,allocateExtraCost,dateValid,decimal,jepoAmount,branchPayment,totalJepoForLoad,totalBranchForLoad} from '../lib/branchLoads.js';
import styles from './BranchLoadsDashboard.module.css';

const API='/api/branch-loads';
// The same request ID is reused if a save must be retried, preventing duplicate entries.
const newSaveRequestId=()=>typeof crypto!=='undefined'&&typeof crypto.randomUUID==='function'?crypto.randomUUID():null;
// Saved entries can be denser than the editable form.  Keeping two width
// profiles makes the ledger compact without crowding Date, Rate or the selects.
// Every header and row within its table still uses the same colgroup.
const ENTRY_WIDTHS=[108,160,118,108,118,122,110,116,138,144,152,148,192,146,166,120,122,130];
const SAVED_WIDTHS=[104,158,90,88,110,109,98,98,117,119,112,102,155,123,142,100,106,120];
const EXTRA_COST_WIDTH=132;
const TOTAL_JEPO_WIDTH=194;
const CONFIRMATION_WIDTH=230;
const REMARKS_WIDTH=196;
const ledgerWidth=(extra,editable=false)=>(editable?ENTRY_WIDTHS:SAVED_WIDTHS).reduce((sum,width)=>sum+width,TOTAL_JEPO_WIDTH+CONFIRMATION_WIDTH+REMARKS_WIDTH)+(extra?EXTRA_COST_WIDTH:0);
const ledgerColumns=(extra,editable=false)=>{
  const widths=editable?ENTRY_WIDTHS:SAVED_WIDTHS;
  // Confirmation sits immediately before the Save/Actions column in both
  // headers and rows. Keep Total JEPO as the last column.
  return <colgroup>{[...widths.slice(0,-1),REMARKS_WIDTH,CONFIRMATION_WIDTH,widths[widths.length-1],...(extra?[EXTRA_COST_WIDTH]:[]),TOTAL_JEPO_WIDTH].map((width,i)=><col key={i} style={{width:width+'px'}}/>)}</colgroup>;
};
const todayIST=()=>new Date(Date.now()+330*60000).toISOString().slice(0,10);
const fresh=(branch='JIND')=>({
  branch,date:todayIST(),weight:'',rate:'',received:'',jepoRate:'',extraCost:'',bottleCount:'',remarks:'',confirmationNo:'',confirmationName:'',confirmationMode:'PENDING',
  destination:'',service:'',commodity:'',trackingNo:'',status:initialBranchStatus(branch)
});
const money=value=>Number(value||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
const weightFormat=value=>Number(value||0).toLocaleString('en-IN',{maximumFractionDigits:3});
const weekday=value=>/^\d{4}-\d{2}-\d{2}$/.test(String(value||''))?new Intl.DateTimeFormat('en-IN',{weekday:'long',timeZone:'UTC'}).format(new Date(value+'T00:00:00Z')):'';
const showDate=value=>value?weekday(value)+', '+String(value).split('-').reverse().join('/'):'—';
const employeeName=value=>String(value||'').split(/[._-]/).map(v=>v? v[0].toUpperCase()+v.slice(1):'').join(' ')||'—';
const fmt=(v)=>v===null?'—':'₹'+money(v);
// Only the JEPO portion of Extra Cost goes under Cash; any remainder still
// belongs to the branch. No payment figures are modified by this display.
const jepoCashPart=(commodity,extraCost,bottleCount,{legacy=false}={})=>
  allocateExtraCost(commodity,extraCost,bottleCount,{legacy})?.toJepo??null;
function JepoPaymentSplit({total,account,cash}){
  return <div className={styles.jepoSplit}>
    <strong className={styles.jepoSplitTotal}>Total <span>{fmt(total)}</span></strong>
    <div className={styles.jepoSplitLine}><span>Account</span><b>{fmt(account)}</b></div>
    <div className={styles.jepoSplitLine}><span>Cash</span><b>{fmt(cash)}</b></div>
  </div>;
}
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
  // Keep save failures visible beside the row button even on a wide scrolling table.
  const [saveError,setSaveError]=useState('');
  const [editing,setEditing]=useState('new');
  const [sheet,setSheet]=useState('ACTIVE');
  const [saveRequestId,setSaveRequestId]=useState(()=>newSaveRequestId());
  const [draft,setDraft]=useState(()=>fresh(userBranch||'JIND'));
  const [search,setSearch]=useState('');
  const [lastUpdated,setLastUpdated]=useState('');
  // Background refresh must never replace a just-saved Active row with an
  // older snapshot. Every successful mutation invalidates in-flight reads.
  const writeRevision=useRef(0);
  const latestRead=useRef(0);
  const recordWrite=()=>{writeRevision.current+=1;latestRead.current+=1;};

  async function load(){
    const read=++latestRead.current,revision=writeRevision.current;
    const current=()=>read===latestRead.current&&revision===writeRevision.current;
    try{
      const res=await fetch(API,{credentials:'include',cache:'no-store'});
      const data=await res.json();
      if(!res.ok||!data.ok)throw new Error(data.error||'Unable to load branch records.');
      if(!current())return;
      setRows(data.rows||[]);
      setLastUpdated(new Date().toLocaleTimeString('en-IN'));
      setMessage(m=>m.startsWith('Unable')?'':m);
    }catch(e){if(current())setMessage('Unable to load records: '+(e?.message||e));}
    finally{if(current())setLoaded(true);}
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
    (!search||[r.trackingNo,r.destination,r.service,r.commodity,r.branch,r.date,r.confirmationNo,r.confirmationName,r.confirmationMode,r.remarks].join(' ').toLowerCase().includes(search.toLowerCase()))
  ),[rows,filter,sheet,search]);
  // Active Loads includes every undelivered load, regardless of entry date.
  const activeCount=useMemo(()=>rows.filter(r=>(filter==='ALL'||r.branch===filter)&&r.status!=='DELIVERED').length,[rows,filter]);
  const deliveredCount=useMemo(()=>rows.filter(r=>(filter==='ALL'||r.branch===filter)&&r.status==='DELIVERED').length,[rows,filter]);
  // The Admin sees all pending confirmations regardless of selected branch,
  // date filter, or whether a shipment has moved to Delivered Sheet.
  const confirmationModeFor=row=>row.confirmationMode==='PENDING'&&row.confirmationNo?'UTR':(row.confirmationMode||'PENDING');
  const awaitingAdminDecision=row=>(confirmationModeFor(row)==='CASH'||(confirmationModeFor(row)==='UTR'&&Boolean(row.confirmationNo?.trim())))&&
    row.confirmationDecision!=='YES'&&row.confirmationDecision!=='NO'&&!row.confirmationApprovedAt;
  // Pending Yes/No actions are displayed beside their own transaction row;
  // no separate approval queue that detaches a decision from the saved load.
  function switchSheet(next){
    setSheet(next);setMessage('');setSaveError('');setSearch('');
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
    cashJepo:t.cashJepo+Number(jepoCashPart(r.commodity,r.extraCost,r.bottleCount,{legacy:true})||0),
    extraCost:t.extraCost+(requiresExtraCost(r.commodity)?Number(r.extraCost||0):0)
  }),{weight:0,amount:0,received:0,balance:0,paidToJepo:0,paidToBranch:0,extraCost:0,totalJepo:0,cashJepo:0}),[shown]);
  // Extra Cost appears only for mixed-household entries; the derived Total JEPO
  // payment is always the very last column, whether Extra Cost exists or not.
  const hasExtraCostColumn=shown.some(r=>requiresExtraCost(r.commodity))||
    (editing!==''&&editing!=='new'&&requiresExtraCost(draft.commodity));
  const preview=amounts(draft.weight,draft.rate,draft.received);
  const jepoPreview=jepoAmount(draft.weight,draft.jepoRate);
  const branchBasePreview=branchPayment(draft.weight,draft.rate,draft.jepoRate);
  const branchPreview=branchBasePreview===null?null:totalBranchForLoad(preview?.amount,jepoPreview,draft.commodity,draft.extraCost,draft.bottleCount);
  const totalJepoPreview=jepoPreview===null?null:totalJepoForLoad(jepoPreview,draft.commodity,draft.extraCost,draft.bottleCount);
  const cashJepoPreview=totalJepoPreview===null?null:jepoCashPart(draft.commodity,draft.extraCost,draft.bottleCount);
  const extraJepoMinimum=minimumJepoExtraCost(draft.commodity,draft.bottleCount);
  const set=(field,value)=>setDraft(d=>({...d,[field]:value}));
  function showSaveFailure(reason){
    const message='Save nahi hua: '+String(reason||'Please check the entry.');
    setMessage(message);
    setSaveError(message);
  }

  function add(){
    setSheet('ACTIVE');setDraft({...fresh(isAdmin&&filter!=='ALL'?filter:userBranch||'JIND'),date:todayIST()});
    setEditing('new');setSaveRequestId(newSaveRequestId());setMessage('');setSaveError('');
  }
  function edit(row){
    setEditing(row.id);
    setDraft({
      branch:row.branch,date:row.date||todayIST(),weight:row.weight||'',rate:row.rate||'',
      received:row.received||'',jepoRate:row.jepoRate??'',
      extraCost:requiresExtraCost(row.commodity)?(Number(row.extraCost||0)?row.extraCost:''):'',
      bottleCount:row.bottleCount??'',
      destination:row.destination||'',service:row.service||'',commodity:row.commodity||'',
      trackingNo:row.trackingNo||'',remarks:row.remarks||'',confirmationNo:row.confirmationNo||'',confirmationName:row.confirmationName||'',confirmationMode:confirmationModeFor(row),status:row.status||initialBranchStatus(row.branch)
    });
    setMessage('');setSaveError('');
  }
  function cancel(){setEditing(sheet==='ACTIVE'?'new':'');setSaveRequestId(newSaveRequestId());setDraft({...fresh(isAdmin&&filter!=='ALL'?filter:userBranch||'JIND'),date:todayIST()});setMessage('');setSaveError('');}
  async function save(event){
    event?.preventDefault?.();
    if(busy||!editing)return;
    setSaveError('');
    // Native HTML form validation silently blocks submit for far-right fields
    // inside the horizontally-scrolling ledger. Validate here and show feedback.
    if(!dateValid(draft.date)){showSaveFailure('select a valid Entry Date.');return;}
    if(decimal(draft.weight,3,true)===null||Number(draft.weight)<=0){
      showSaveFailure('enter Load Received in kg (greater than 0).');return;
    }
    if(decimal(draft.rate,4,true)===null){
      showSaveFailure('enter a valid Rate per kg.');return;
    }
    if(decimal(draft.received,2)===null){
      showSaveFailure('Received must be a valid amount. Leave blank if unpaid.');return;
    }
    if(!draft.destination||draft.destination==='__other__'){
      showSaveFailure('select or type Destination.');return;
    }
    if(!draft.service||draft.service==='__other__'){
      showSaveFailure('select or type Service.');return;
    }
    if(!draft.commodity||draft.commodity==='__other__'){
      showSaveFailure('select or type Commodity.');return;
    }
    if(jepoPreview===null){
      showSaveFailure('enter JEPO Rate per kg (use 0 only if the rate really is zero).');return;
    }
    if(branchBasePreview===null||branchBasePreview<0){
      showSaveFailure('JEPO Rate cannot exceed the selling Rate.');return;
    }
    if(requiresBottleCount(draft.commodity)&&(!/^[1-9]\d{0,4}$/.test(String(draft.bottleCount))||Number(draft.bottleCount)>10000)){
      showSaveFailure('enter the No. of Bottles (1–10000).');return;
    }
    if(requiresExtraCost(draft.commodity)&&decimal(draft.extraCost,2)===null){
      showSaveFailure('Extra Cost must be a valid amount.');return;
    }
    if(requiresExtraCost(draft.commodity)&&extraJepoMinimum!==null&&Number(draft.extraCost||0)<extraJepoMinimum){
      showSaveFailure(''+draft.commodity+' requires Extra Cost of at least ₹'+extraJepoMinimum+'. JEPO gets ₹'+extraJepoMinimum+' and the rest goes to Branch.');return;
    }
    if(branchPreview===null||branchPreview<0){
      showSaveFailure('check Extra Cost and payment amounts.');return;
    }
    const currentId=editing;
    const expectedBranch=isAdmin?draft.branch:userBranch;
    // Retry only transient network/server failures; the server deduplicates POST
    // with clientRequestId, so a successful first attempt cannot be entered twice.
    const payload={...draft,...(currentId==='new'?{clientRequestId:saveRequestId}:{id:currentId})};
    setBusy(true);setMessage('Saving to Mayavi database…');
    try{
      let saved=null;
      for(let attempt=0;attempt<2;attempt++){
        try{
          const res=await fetch(API,{method:currentId==='new'?'POST':'PATCH',
            headers:{'content-type':'application/json'},credentials:'include',
            cache:'no-store',body:JSON.stringify(payload)
          });
          const data=await res.json().catch(()=>({ok:false,error:'Server did not return a valid save confirmation.'}));
          if(!res.ok||!data.ok){
            if(res.status===401)throw new Error('Session expired. Please sign in again; your entry has not been cleared.');
            if(res.status===403)throw new Error('Account access denied. Please contact Admin; your entry has not been cleared.');
            if(res.status>=500&&attempt===0)continue;
            throw new Error(data.error||'Save failed. Please check all fields.');
          }
          if(!data.row?.id||data.row.branch!==expectedBranch)throw new Error('Save confirmation did not match the branch. Please refresh the register before trying again.');
          saved=data.row;
          break;
        }catch(e){
          // A browser network error is safe to retry with the same request ID.
          if(e instanceof TypeError&&attempt===0)continue;
          throw e;
        }
      }
      if(!saved)throw new Error('Could not confirm save after retry. Your typed entry is still here.');
      recordWrite();
      setRows(prev=>currentId==='new'?[saved,...prev.filter(r=>r.id!==saved.id)]:prev.map(r=>r.id===currentId?saved:r));
      setSaveRequestId(newSaveRequestId());
      setEditing(saved.status==='DELIVERED'?'': 'new');
      setDraft({...fresh(saved.branch),date:saved.date});
      setSheet(saved.status==='DELIVERED'?'DELIVERED':'ACTIVE');
      setSearch('');
      setSaveError('');
      setMessage('✓ '+saved.branch+' entry SAVED in database ('+showDate(saved.date)+'). '+(saved.status==='DELIVERED'?'See Delivered Sheet.':'Entry is in Active Loads. You can add the next load.'));
    }catch(e){
      showSaveFailure(''+(e?.message||'Please try again. Your entered details are still here.'));
    }finally{setBusy(false);}
  }
  async function remove(row){
    if(!isAdmin)return;
    if(!window.confirm('Delete '+row.branch+' entry dated '+showDate(row.date)+'?'))return;
    setBusy(true);setMessage('');
    try{
      const res=await fetch(API+'?id='+encodeURIComponent(row.id),{method:'DELETE',credentials:'include'});
      const data=await res.json();
      if(!res.ok||!data.ok)throw new Error(data.error||'Delete failed.');
      recordWrite();
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
      recordWrite();
      setRows(prev=>prev.map(r=>r.id===row.id?data.row:r));
      setMessage(status==='DELIVERED'
        ?'Delivered — the entry has moved to Delivered Sheet.'
        :'Status updated. The entry is in Active Register.');
    }catch(e){setMessage(e?.message||'Unable to update status.');}
    finally{setBusy(false);}
  }
  async function decideTransaction(row,decision){
    if(!isAdmin||busy||!['YES','NO'].includes(decision)||!awaitingAdminDecision(row))return;
    const mode=confirmationModeFor(row);
    const summary=row.branch+' • '+(mode==='CASH'?'Cash':'UTR: '+row.confirmationNo)+' • Received '+fmt(row.received);
    if(!window.confirm('Mark this transaction '+decision+'?\\n'+summary))return;
    setBusy(true);setMessage('Saving Admin '+decision+' decision…');
    try{
      const response=await fetch(API,{method:'PATCH',credentials:'include',cache:'no-store',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({id:row.id,approveConfirmation:true,confirmationDecision:decision,
          confirmationMode:mode,confirmationNo:row.confirmationNo||'',expectedReceived:row.received})
      });
      const data=await response.json().catch(()=>({ok:false,error:'Could not read Admin decision confirmation.'}));
      if(!response.ok||!data.ok||!data.row||data.row.confirmationDecision!==decision)
        throw new Error(data.error||'Decision could not be saved. Refresh and try again.');
      recordWrite();
      setRows(prev=>prev.map(r=>r.id===row.id?data.row:r));
      setMessage('✓ '+row.branch+' '+(mode==='CASH'?'Cash':row.confirmationNo)+' marked '+decision+' by Admin.');
    }catch(e){setMessage('Admin decision not saved: '+(e?.message||'Please try again.'));}
    finally{setBusy(false);}
  }
  function downloadCsv(){
    const labels=['Branch','Date','Day','Load Received (kg)','Rate (INR/kg)','Amount (INR)','Received (INR)','Balance (INR)','JEPO Rate (INR/kg)','Amount Paid to JEPO (INR)','Amount Paid to Branch (INR)','Destination','Service','Commodity','No. of Bottles','JEPO Tracking No.','Status','Entered By','Last Edited By','Remarks','Payment Mode','UTR / Confirmation No.',...(isAdmin?['Admin Decision','Decided By','Decided At']:[]),...(hasExtraCostColumn?['Extra Cost (INR)']:[]),'Total Amount Paid to JEPO (INR)'];
    const data=shown.map(r=>[r.branch,r.date,weekday(r.date),r.weight,r.rate,r.amount,r.received,r.balance,r.jepoRate,r.paidToJepo,r.paidToBranch,r.destination,r.service,r.commodity,r.bottleCount||'',r.trackingNo||'',statusLabel(r.status),employeeName(r.createdBy),employeeName(r.updatedBy),r.remarks||'',confirmationModeFor(r),r.confirmationNo||'',...(isAdmin?[r.confirmationDecision==='PENDING'&&r.confirmationApprovedAt?'YES':r.confirmationDecision||'PENDING',r.confirmationDecidedBy||r.confirmationApprovedBy||'',r.confirmationDecidedAt||r.confirmationApprovedAt||'']:[]),...(hasExtraCostColumn?[requiresExtraCost(r.commodity)?r.extraCost||0:'']:[]),totalJepoForLoad(r.paidToJepo,r.commodity,r.extraCost,r.bottleCount,{legacy:true})]);
    // Keep export totals precisely under the same labels after adding fields.
    const totalsRow=Array(labels.length).fill('');
    totalsRow[0]='TOTAL';totalsRow[3]=totals.weight;totalsRow[5]=totals.amount;
    totalsRow[6]=totals.received;totalsRow[7]=totals.balance;
    totalsRow[9]=totals.paidToJepo;totalsRow[10]=totals.paidToBranch;
    if(hasExtraCostColumn)totalsRow[labels.indexOf('Extra Cost (INR)')]=totals.extraCost;
    totalsRow[labels.length-1]=totals.totalJepo;data.push(totalsRow);
    const csv='\uFEFF'+[labels,...data].map(line=>line.map(safeCsvValue).join(',')).join('\r\n');
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
    const anchor=document.createElement('a');
    anchor.href=url;anchor.download='mayavi-'+(filter==='ALL'?'jind-karnal':filter.toLowerCase())+'-'+sheet.toLowerCase()+'-loads.csv';
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
      <td><FieldChoice name="Commodity" list={COMMODITIES} value={draft.commodity} onChange={v=>setDraft(d=>({...d,commodity:v,extraCost:requiresExtraCost(v)?d.extraCost:'',bottleCount:requiresBottleCount(v)?d.bottleCount:''}))}/>{requiresBottleCount(draft.commodity)&&<label className={styles.bottleControl}>No. of Bottles<input aria-label="No. of Bottles" type="number" min="1" max="10000" step="1" required value={draft.bottleCount} placeholder="Enter bottles" onChange={e=>setDraft(d=>{const count=e.target.value;const minimum=Number(count||0)*250;return {...d,bottleCount:count,extraCost:count&&Number(d.extraCost||0)<minimum?String(minimum):d.extraCost};})}/></label>}</td>
      <td><input aria-label="JEPO tracking number" placeholder="JEPO tracking" maxLength={100} value={draft.trackingNo} onChange={e=>set('trackingNo',e.target.value)}/></td>
      <td><select aria-label="Delivery status" value={draft.status} onChange={e=>set('status',e.target.value)}>{LOAD_STATUSES.map(x=><option key={x} value={x}>{statusLabel(x)}</option>)}</select></td>
      <td className={styles.audit}>{editing==='new'?currentUser?.displayName||employeeName(currentUser?.username):employeeName(rows.find(r=>r.id===editing)?.createdBy)}</td>
      <td className={styles.audit}>{editing==='new'?'—':currentUser?.displayName||employeeName(currentUser?.username)}</td>
      <td className={styles.remarksCell}><textarea aria-label="Remarks" rows={2} maxLength={500} placeholder="Write remarks (optional)" value={draft.remarks} onChange={e=>set('remarks',e.target.value)}/></td>
      <td className={styles.confirmCell}><div className={styles.confirmInputs}>
        <select aria-label="Payment confirmation mode" value={draft.confirmationMode||'PENDING'} onChange={e=>setDraft(d=>({...d,confirmationMode:e.target.value,confirmationNo:e.target.value==='UTR'?d.confirmationNo:''}))}>
          <option value="PENDING">Pending / Not available</option>
          <option value="UTR">UTR / Transaction No.</option>
          <option value="CASH">Cash</option>
        </select>
        {draft.confirmationMode==='UTR'&&<input aria-label="Amount confirmation number" autoComplete="off" maxLength={120} placeholder="Enter UTR if available" value={draft.confirmationNo} onChange={e=>set('confirmationNo',e.target.value)}/>}
      </div><small className={styles.confirmHelp}>UTR optional. Cash / Pending also saves.</small></td>
      <td className={styles.actions}><button type="button" onClick={save} disabled={busy} aria-label="Save this load row">{busy?'Saving…':'Save'}</button><button type="button" className={styles.secondary} disabled={busy} onClick={cancel}>Cancel</button>{saveError&&<p role="alert" className={styles.inlineSaveError}>{saveError}</p>}</td>
      {showExtraColumn&&<td className={styles.extraCostCell}>{requiresExtraCost(draft.commodity)?
        <><input aria-label="Extra Cost in rupees" {...input} placeholder="₹ Extra Cost" value={draft.extraCost} onChange={e=>set('extraCost',e.target.value)}/><small className={styles.extraSplitHint}>{extraJepoMinimum===null?'Enter bottles to calculate JEPO share':extraJepoMinimum>0?'₹'+extraJepoMinimum+' to JEPO; remaining to Branch':'Full Extra Cost to Branch'}</small></>:'—'}</td>}
      <td className={styles.totalJepoCell}><JepoPaymentSplit total={totalJepoPreview} account={jepoPreview} cash={cashJepoPreview}/></td>
    </tr>;
  }
  function entryRowCells(){
    // Reuse the complete edit row cell layout for existing entries.
    return entryRow(hasExtraCostColumn).props.children;
  }
  const dataCells=record=>[
    <td key="branch"><span className={styles.branchTag} data-branch={record.branch}>{record.branch}</span>
      {isAdmin&&<button type="button" aria-label={'Delete '+record.branch+' entry '+showDate(record.date)} className={styles.quickDelete} disabled={busy} onClick={()=>remove(record)}>Delete</button>}</td>,
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
    <td key="remarks" className={styles.remarksCell}><span title={record.remarks||''}>{record.remarks||'—'}</span></td>,
    <td key="confirmation" className={styles.confirmCell}>
      <div className={styles.transactionInline}>
        <div className={styles.transactionDetails}>
          <strong className={styles.confirmNumber}>{confirmationModeFor(record)==='CASH'?'Cash':confirmationModeFor(record)==='UTR'?'UTR':'Pending'}</strong>
          {confirmationModeFor(record)==='UTR'&&<small className={styles.confirmName}>{record.confirmationNo||'UTR not entered'}</small>}
        </div>
        {isAdmin&&awaitingAdminDecision(record)&&<div className={styles.adminDecisionButtons}>
          <button type="button" className={styles.approveButton} disabled={busy} onClick={()=>decideTransaction(record,'YES')}>Yes</button>
          <button type="button" className={styles.rejectButton} disabled={busy} onClick={()=>decideTransaction(record,'NO')}>No</button>
        </div>}
      </div>
      {isAdmin&&(record.confirmationDecision==='YES'||record.confirmationApprovedAt
        ?<span className={styles.confirmApproved}>Yes • Confirmed</span>
        :record.confirmationDecision==='NO'
          ?<span className={styles.confirmIncomplete}>No • Not confirmed</span>
          :awaitingAdminDecision(record)
            ?<span className={styles.confirmPendingBlink}>Pending Admin Decision</span>:null)}
    </td>,
    <td key="actions" className={styles.actions}><button type="button" onClick={()=>edit(record)} disabled={busy}>Edit</button></td>,
    ...(hasExtraCostColumn?[<td key="extraCost" className={styles.extraCostCell+' '+styles.number}>{requiresExtraCost(record.commodity)?'₹'+money(record.extraCost):'—'}</td>]:[]),
    <td key="totalPaidToJepo" className={styles.totalJepoCell+' '+styles.number}><JepoPaymentSplit
      total={totalJepoForLoad(record.paidToJepo,record.commodity,record.extraCost,record.bottleCount,{legacy:true})}
      account={Number(record.paidToJepo||0)}
      cash={jepoCashPart(record.commodity,record.extraCost,record.bottleCount,{legacy:true})}
    /></td>
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
    {message&&<div className={styles.message} role="status" aria-live="polite">{message}</div>}
    <form noValidate onSubmit={save}>
      {sheet==='ACTIVE'&&editing==='new'&&<section className={styles.loadEntrySection}>
        <div className={styles.loadEntryTitle}>
          <div><h2>Load Entry</h2><p>Enter load details, then click Save in the same row. Day appears automatically.</p></div>
          <div className={styles.loadEntryActions}><span className={styles.actorName}>Entering as: {currentUser?.displayName||employeeName(currentUser?.username)} • {isAdmin?draft.branch:userBranch}</span></div>
        </div>
        <div className={styles.scroller}><table className={styles.table+' '+styles.entryLedger} style={{width:ledgerWidth(requiresExtraCost(draft.commodity),true)+'px',minWidth:'100%'}}>
          {ledgerColumns(requiresExtraCost(draft.commodity),true)}
          <thead><tr><th>Branch</th><th>Date &amp; Day</th><th>Load Received (kg)</th><th>Rate (₹/kg)</th><th>Amount • Auto</th><th>Received (₹)</th><th>Balance • Auto</th><th>JEPO Rate (₹/kg)</th><th>Paid to JEPO • Auto (₹)</th><th>Paid to Branch • Auto (₹)</th><th>Destination</th><th>Service</th><th>Commodity</th><th>JEPO Tracking No.</th><th>Status</th><th>Entered By</th><th>Edited By</th><th>Remarks</th><th>UTR / Cash</th><th>Save</th>{requiresExtraCost(draft.commodity)&&<th className={styles.extraCostHeader}>Extra Cost (₹)</th>}<th className={styles.totalJepoHeader}>Total Amount Paid to JEPO (₹)</th></tr></thead>
          <tbody>{entryRow(requiresExtraCost(draft.commodity))}</tbody>
        </table></div>
      </section>}
    <nav className={styles.sheetTabs} aria-label="Load sheet">
      <button type="button" className={sheet==='ACTIVE'?styles.activeTab:styles.sheetTab} onClick={()=>switchSheet('ACTIVE')}>Active Loads ({activeCount})</button>
      <button type="button" className={sheet==='DELIVERED'?styles.deliveredTab:styles.sheetTab} onClick={()=>switchSheet('DELIVERED')}>Delivered Sheet ({deliveredCount})</button>
    </nav>

    {isAdmin&&<p className={styles.hint}>Amount = Weight × Rate • JEPO base = Weight × JEPO Rate • Extra Cost split: Ghee ₹250 per bottle to JEPO, Medicine ₹700 to JEPO, Nutrition ₹150 to JEPO; remainder to Branch. Electronics / Hookah Extra Cost goes to JEPO.</p>}
      <div className={styles.scroller}><table className={styles.table+' '+styles.savedLedger} style={{width:ledgerWidth(hasExtraCostColumn)+'px',minWidth:'100%'}}>
        {ledgerColumns(hasExtraCostColumn)}
        <thead><tr>
          <th>Branch{isAdmin&&<select aria-label="Branch filter" className={styles.headerFilter} value={filter} onChange={e=>setFilter(e.target.value)}><option value="ALL">Both</option>{BRANCHES.map(x=><option key={x} value={x}>{x}</option>)}</select>}</th>
          <th>Date</th>
          <th>Load Received (kg)</th><th>Rate (₹/kg)</th><th>Amount (₹) • Auto</th><th>Received (₹)</th><th>Balance (₹) • Auto</th><th>JEPO Rate (₹/kg)</th><th>Amount Paid to JEPO (₹) • Auto</th><th>Amount Paid to Branch (₹) • Auto</th><th>Destination</th><th>Service</th><th>Commodity</th><th>JEPO Tracking No.</th><th>Status</th><th>Entered By</th><th>Last Edited By</th><th>Remarks</th><th>UTR / Cash • Admin Yes/No</th><th>Actions</th>{hasExtraCostColumn&&<th className={styles.extraCostHeader}>Extra Cost (₹)</th>}<th className={styles.totalJepoHeader}>Total Amount Paid to JEPO (₹)</th>
        </tr></thead>
        <tbody>
          {/* Daily Load Entry stays above; saved records only in this sheet. */}
          {shown.map(row=>editing===row.id?<tr key={row.id} className={styles.editRow}>{entryRowCells()}</tr>:<tr key={row.id} data-branch={row.branch} className={row.status==='DELIVERED'?styles.deliveredRow:''}>{dataCells(row)}</tr>)}
          {!loaded&&<tr><td colSpan={21+(hasExtraCostColumn?1:0)}>Loading branch entries…</td></tr>}
          {loaded&&!shown.length&&<tr><td colSpan={21+(hasExtraCostColumn?1:0)} className={styles.empty}>{sheet==='ACTIVE'?'No active loads yet. Use the row Save button above.':'No delivered loads yet.'}</td></tr>}
        </tbody>
        <tfoot><tr><td>TOTAL</td><td>{shown.length} entries</td><td className={styles.number}>{weightFormat(totals.weight)}</td><td>—</td><td className={styles.number}>{money(totals.amount)}</td><td className={styles.number}>{money(totals.received)}</td><td className={styles.number}>{money(totals.balance)}</td><td>—</td><td className={styles.number}>{money(totals.paidToJepo)}</td><td className={styles.number}>{money(totals.paidToBranch)}</td><td colSpan={10}>—</td>{hasExtraCostColumn&&<td className={styles.extraCostCell+' '+styles.number}>{money(totals.extraCost)}</td>}<td className={styles.totalJepoCell+' '+styles.number}><JepoPaymentSplit total={totals.totalJepo} account={totals.paidToJepo} cash={totals.cashJepo}/></td></tr></tfoot>
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
