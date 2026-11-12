'use client';

import {useEffect,useMemo,useRef,useState} from 'react';
import {BRANCHES,DESTINATIONS,SERVICES,COMMODITIES,LOAD_STATUSES,statusLabel,initialBranchStatus,amounts,requiresExtraCost,requiresBottleCount,minimumJepoExtraCost,allocateExtraCost,dateValid,decimal,jepoAmount,branchPayment,totalJepoForLoad,totalBranchForLoad,branchPayoutForRecord} from '../lib/branchLoads.js';
import {aggregateDailyBranchLoads} from '../lib/branchDailySummary.js';
import {branchMonths} from '../lib/branchMonthlySummary.js';
import {inclusiveTatDays,summarizeBranchTat} from '../lib/branchTatSummary.js';
import {isJindJepoTimeout} from '../lib/jepoTimeoutHighlights.js';
import styles from './BranchLoadsDashboard.module.css';
import BranchProfitDashboard from './BranchProfitDashboard.js';
import BranchMonthlyDashboard from './BranchMonthlyDashboard.js';

const API='/api/branch-loads';
// The same request ID is reused if a save must be retried, preventing duplicate entries.
const newSaveRequestId=()=>typeof crypto!=='undefined'&&typeof crypto.randomUUID==='function'?crypto.randomUUID():null;
// Use one compact column profile for both Daily Load Entry and saved loads.
// Identical colgroups plus synchronized scroll keep headings and values lined up.
const LEDGER_WIDTHS=[98,140,92,90,116,110,100,108,134,146,156,148,184,146,166,200,120,120,124];
const EXTRA_COST_WIDTH=132;
const TOTAL_JEPO_WIDTH=194;
const TAT_WIDTH=94;
const CONFIRMATION_WIDTH=230;
const REMARKS_WIDTH=196;
const ledgerWidth=(extra,delivered=false)=>LEDGER_WIDTHS.reduce((sum,width)=>sum+width,TOTAL_JEPO_WIDTH+CONFIRMATION_WIDTH+REMARKS_WIDTH)+(extra?EXTRA_COST_WIDTH:0)+(delivered?TAT_WIDTH:0);
const ledgerColumns=(extra,delivered=false)=><colgroup>{[...LEDGER_WIDTHS.slice(0,2),...(delivered?[TAT_WIDTH]:[]),...LEDGER_WIDTHS.slice(2,-1),REMARKS_WIDTH,CONFIRMATION_WIDTH,LEDGER_WIDTHS[LEDGER_WIDTHS.length-1],...(extra?[EXTRA_COST_WIDTH]:[]),TOTAL_JEPO_WIDTH].map((width,i)=><col key={i} style={{width:width+'px'}}/>)}</colgroup>;
const todayIST=()=>new Date(Date.now()+330*60000).toISOString().slice(0,10);
const fresh=(branch='JIND')=>({
  branch,date:todayIST(),weight:'',rate:'',received:'',jepoRate:'',extraCost:'',bottleCount:'',remarks:'',confirmationNo:'',confirmationName:'',confirmationMode:'PENDING',
  destination:'',service:'',commodity:'',trackingNo:'',status:initialBranchStatus(branch)
});
const money=value=>Number(value||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
const weightFormat=value=>Number(value||0).toLocaleString('en-IN',{maximumFractionDigits:3});
const weekday=value=>/^\d{4}-\d{2}-\d{2}$/.test(String(value||''))?new Intl.DateTimeFormat('en-IN',{weekday:'long',timeZone:'UTC'}).format(new Date(value+'T00:00:00Z')):'';
const showDate=value=>value?weekday(value)+', '+String(value).split('-').reverse().join('/'):'—';
const compactShowDate=value=>value?weekday(value).slice(0,3)+', '+String(value).split('-').reverse().join('/'):'—';
const employeeName=value=>String(value||'').split(/[._-]/).map(v=>v? v[0].toUpperCase()+v.slice(1):'').join(' ')||'—';
const fmt=(v)=>v===null?'—':'₹'+money(v);
// Only the JEPO portion of Extra Cost goes under Cash; any remainder still
// belongs to the branch. No payment figures are modified by this display.
const jepoCashPart=(commodity,extraCost,bottleCount,{legacy=false}={})=>
  allocateExtraCost(commodity,extraCost,bottleCount,{legacy})?.toJepo??null;
// Branch receives only the remainder after JEPO's fixed Extra Cost share.
// It is already included in Paid to Branch; the Cash label is DISPLAY ONLY.
const branchCashPart=(commodity,extraCost,bottleCount,{legacy=false}={})=>
  allocateExtraCost(commodity,extraCost,bottleCount,{legacy})?.toBranch??null;
function BranchPaymentDisplay({total,cash}){
  return <div className={styles.branchPaymentDisplay}>
    <strong>{fmt(total)}</strong>
    {cash!==null&&cash>0&&<small className={styles.branchCashLabel}>Cash {fmt(cash)}</small>}
  </div>;
}
function JepoPaymentSplit({total,account,cash}){
  return <div className={styles.jepoSplit}>
    <strong className={styles.jepoSplitTotal}>Total <span>{fmt(total)}</span></strong>
    <div className={styles.jepoSplitLine}><span>Account</span><b>{fmt(account)}</b></div>
    <div className={styles.jepoSplitLine}><span>Cash</span><b>{fmt(cash)}</b></div>
  </div>;
}
const safeCsvValue=value=>{const v=String(value??'');return '"'+(/^[=+@\-\t\r]/.test(v)?"'"+v:v).replace(/"/g,'""')+'"';};

// Each amount is calculated once from saved rows. Top totals use both statuses;
// Active and Delivered table footers continue to show their own sheet totals.
function sumLedgerTotals(records=[]){
  return records.reduce((t,r)=>({
    weight:t.weight+Number(r.weight||0),
    amount:t.amount+Number(r.amount||0),
    received:t.received+Number(r.received||0),
    balance:t.balance+Number(r.balance||0),
    paidToJepo:t.paidToJepo+Number(r.paidToJepo||0),
    paidToBranch:t.paidToBranch+branchPayoutForRecord(r),
    totalJepo:t.totalJepo+Number(totalJepoForLoad(r.paidToJepo,r.commodity,r.extraCost,r.bottleCount,{legacy:true})||0),
    cashJepo:t.cashJepo+Number(jepoCashPart(r.commodity,r.extraCost,r.bottleCount,{legacy:true})||0),
    cashBranch:t.cashBranch+Number(branchCashPart(r.commodity,r.extraCost,r.bottleCount,{legacy:true})||0),
    extraCost:t.extraCost+Number(r.extraCost||0)
  }),{weight:0,amount:0,received:0,balance:0,paidToJepo:0,paidToBranch:0,extraCost:0,totalJepo:0,cashJepo:0,cashBranch:0});
}
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
  const isAdmin=currentUser?.role==='admin'||currentUser?.role==='haryana_admin';
  const userBranch=isAdmin?'':String(currentUser?.branchScope||currentUser?.username||'').toUpperCase();
  const [filter,setFilter]=useState(isAdmin?'ALL':userBranch);
  const [rows,setRows]=useState([]);
  const [loaded,setLoaded]=useState(false);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  // Keep save failures visible beside the row button even on a wide scrolling table.
  const [saveError,setSaveError]=useState('');
  const [excelBusy,setExcelBusy]=useState(false);
  const [liveBusy,setLiveBusy]=useState(false);
  const [duplicateInfo,setDuplicateInfo]=useState(null);
  const [checkingDuplicate,setCheckingDuplicate]=useState(false);
  const [editing,setEditing]=useState('new');
  const [sheet,setSheet]=useState('ACTIVE');
  const [selectedMonthlyMonth,setSelectedMonthlyMonth]=useState('');
  const [saveRequestId,setSaveRequestId]=useState(()=>newSaveRequestId());
  const [draft,setDraft]=useState(()=>fresh(userBranch||'JIND'));
  const [search,setSearch]=useState('');
  const [lastUpdated,setLastUpdated]=useState('');
  // Background refresh must never replace a just-saved Active row with an
  // older snapshot. Every successful mutation invalidates in-flight reads.
  const writeRevision=useRef(0);
  const latestRead=useRef(0);
  // Tabs may remount the saved table; start it at the same horizontal
  // position as the entry row, not at a visually shifted column.
  useEffect(()=>{
    const entry=entryScrollRef.current;
    const saved=savedScrollRef.current;
    if(entry&&saved)saved.scrollLeft=entry.scrollLeft;
  },[sheet,editing]);
  const entryScrollRef=useRef(null);
  const savedScrollRef=useRef(null);
  const syncLedgerScroll=source=>{
    const from=source==='entry'?entryScrollRef.current:savedScrollRef.current;
    const to=source==='entry'?savedScrollRef.current:entryScrollRef.current;
    if(from&&to&&Math.abs(to.scrollLeft-from.scrollLeft)>1)to.scrollLeft=from.scrollLeft;
  };
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
    const timer=setInterval(onFocus,20000);
    document.addEventListener('visibilitychange',onFocus);
    window.addEventListener('focus',onFocus);
    return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',onFocus);window.removeEventListener('focus',onFocus);};
  },[]);

  // Detect a duplicate while typing, including loads that have moved to
  // Delivered. Cross-branch lookups return a warning but no private details.
  const normalizedDraftTracking=String(draft.trackingNo||'').trim().toUpperCase().replace(/\s+/g,'');
  useEffect(()=>{
    let active=true;
    const number=String(draft.trackingNo||'').trim().toUpperCase().replace(/\s+/g,'');
    if(!/^[A-Z0-9-]{3,60}$/.test(number)){setDuplicateInfo(null);setCheckingDuplicate(false);return;}
    const local=rows.find(r=>r.id!==editing&&String(r.trackingNo||'').trim().toUpperCase().replace(/\s+/g,'')===number);
    if(local){
      setDuplicateInfo({duplicate:true,trackingNo:number,existing:{id:local.id,branch:local.branch,date:local.date,status:local.status}});
      setCheckingDuplicate(false);return;
    }
    setDuplicateInfo(null);setCheckingDuplicate(true);
    const controller=new AbortController();
    const timer=setTimeout(async()=>{
      try{
        const params=new URLSearchParams({checkTrackingNo:number,excludeId:editing==='new'?'':editing});
        const response=await fetch(API+'?'+params.toString(),{credentials:'include',cache:'no-store',signal:controller.signal});
        const data=await response.json();
        if(active&&response.ok&&data.ok)setDuplicateInfo(data.duplicate?data:null);
      }catch(error){if(active&&error?.name!=='AbortError')setDuplicateInfo(null);}
      finally{if(active)setCheckingDuplicate(false);}
    },320);
    return()=>{active=false;clearTimeout(timer);controller.abort();};
  },[draft.trackingNo,editing,rows]);
  const duplicateTrackingNumbers=useMemo(()=>{
    const counts=new Map();
    for(const row of rows){
      const key=String(row.trackingNo||'').trim().toUpperCase().replace(/\s+/g,'');
      if(key)counts.set(key,(counts.get(key)||0)+1);
    }
    return new Set([...counts].filter(([,count])=>count>1).map(([key])=>key));
  },[rows]);
  // Highlight the existing shipment immediately as someone types its
  // tracking number, even when the database contains only one existing copy.
  const flaggedJepoNumber=value=>{
    const key=String(value||'').trim().toUpperCase().replace(/\s+/g,'');
    return Boolean(key&&(duplicateTrackingNumbers.has(key)||(duplicateInfo?.duplicate&&duplicateInfo.trackingNo===key)));
  };
  // Branch and search filters apply everywhere. Status affects ONLY the table,
  // never the overview cards: Active + Delivered are always counted together.
  const matchingRows=useMemo(()=>rows.filter(r=>
    (filter==='ALL'||r.branch===filter)&&
    (!search||[r.trackingNo,r.destination,r.service,r.commodity,r.branch,r.date,r.confirmationNo,r.confirmationName,r.confirmationMode,r.remarks,r.liveRemarks,r.liveStatus].join(' ').toLowerCase().includes(search.toLowerCase()))
  ),[rows,filter,search]);
  const shown=useMemo(()=>{
    const visible=matchingRows.filter(r=>
      sheet==='SUMMARY'||sheet==='MONTHLY'||(sheet==='DELIVERED'?r.status==='DELIVERED':r.status!=='DELIVERED'));
    if(sheet==='DELIVERED')visible.sort((a,b)=>{
      // Actual delivery date, not the booking date, determines Delivered order.
      // Historical deliveries without a verified date remain after dated rows.
      const byDelivery=String(b.deliveredOn||'').localeCompare(String(a.deliveredOn||''));
      if(byDelivery)return byDelivery;
      const byBooking=String(b.date||'').localeCompare(String(a.date||''));
      return byBooking||String(a.id).localeCompare(String(b.id));
    });
    return visible;
  },[matchingRows,sheet]);
  // Summary combines all booked loads, regardless of current delivery status.
  const dailySummary=useMemo(()=>aggregateDailyBranchLoads(shown),[shown]);
  const summaryTotals=useMemo(()=>dailySummary.reduce((t,r)=>({
    loads:t.loads+r.loads,weight:t.weight+r.weight,branchAmount:t.branchAmount+r.branchAmount
  }),{loads:0,weight:0,branchAmount:0}),[dailySummary]);
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
  const totals=useMemo(()=>sumLedgerTotals(shown),[shown]); // current sheet footer / CSV
  const tatSummary=useMemo(()=>summarizeBranchTat(shown),[shown]); // delivered-only, same branch/search filters
  // In Monthly Data, the top financial cards must show only the selected
  // booking month (Active + Delivered); other tabs retain all-time overview.
  const monthlyMonths=useMemo(()=>branchMonths(matchingRows),[matchingRows]);
  const monthlyMonth=selectedMonthlyMonth&&monthlyMonths.includes(selectedMonthlyMonth)?selectedMonthlyMonth:monthlyMonths[0]||'';
  const monthlyRows=useMemo(()=>matchingRows.filter(r=>String(r.date||'').slice(0,7)===monthlyMonth),[matchingRows,monthlyMonth]);
  const overviewTotals=useMemo(()=>sumLedgerTotals(sheet==='MONTHLY'?monthlyRows:matchingRows),[sheet,monthlyRows,matchingRows]);
  const overviewPeriod=sheet==='MONTHLY'?(monthlyMonth||'Selected Month'):'Active + Delivered';
  // Every commodity may have an optional Extra Cost. Keep this column visible
  // and keep Total JEPO last, for consistent branch and CSV accounting.
  const hasExtraCostColumn=true;
  const preview=amounts(draft.weight,draft.rate,draft.received);
  const jepoPreview=jepoAmount(draft.weight,draft.jepoRate);
  const branchBasePreview=branchPayment(draft.weight,draft.rate,draft.jepoRate);
  const branchPreview=branchBasePreview===null?null:totalBranchForLoad(preview?.amount,jepoPreview,draft.commodity,draft.extraCost,draft.bottleCount);
  const totalJepoPreview=jepoPreview===null?null:totalJepoForLoad(jepoPreview,draft.commodity,draft.extraCost,draft.bottleCount);
  const cashJepoPreview=totalJepoPreview===null?null:jepoCashPart(draft.commodity,draft.extraCost,draft.bottleCount);
  const branchCashPreview=branchPreview===null?null:branchCashPart(draft.commodity,draft.extraCost,draft.bottleCount);
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
      extraCost:Number(row.extraCost||0)?row.extraCost:'',
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
    if(duplicateInfo?.duplicate&&duplicateInfo.trackingNo===normalizedDraftTracking){
      showSaveFailure('Duplicate JEPO Tracking No. '+normalizedDraftTracking+' already exists. Please use the saved entry.');
      return;
    }
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
    if(decimal(draft.extraCost,2)===null){
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
            if(data.duplicate)setDuplicateInfo(data);
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
  async function refreshJepo(records){
    if(liveBusy||busy)return;
    const ids=(records||[]).filter(r=>r?.id&&r.trackingNo).slice(0,6).map(r=>r.id);
    if(!ids.length){setMessage('No saved JEPO Tracking No. for this selection.');return;}
    setLiveBusy(true);setMessage('Checking JEPO website for latest status and progress…');
    try{
      const response=await fetch('/api/branch-loads/jepo-live',{
        method:'POST',credentials:'include',headers:{'content-type':'application/json'},
        body:JSON.stringify({ids})
      });
      const data=await response.json().catch(()=>({}));
      if(!response.ok||!data.ok)throw Error(data.error||'JEPO live tracking could not be checked.');
      recordWrite();await load();
      setMessage(data.updated
        ?'JEPO live: '+data.updated+' tracked, '+data.failed+' unavailable. Status and Live Remarks refreshed.'
        :'JEPO website has not returned verified data. Saved statuses remain unchanged.');
    }catch(e){setMessage('JEPO live tracking: '+(e?.message||'source unavailable')+'. Old records remain saved.');}
    finally{setLiveBusy(false);}
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

  // Shared data powers CSV and real Excel (.xlsx) without changing payment rules.
  function exportTableData(){
    const prefix='mayavi-'+(filter==='ALL'?'jind-karnal':filter.toLowerCase());
    if(sheet==='SUMMARY'){
      const labels=['Date','Day','Branch','No. of Loads','Total Weight (kg)','Total Branch Amount (INR)'];
      const data=dailySummary.map(r=>[r.date,weekday(r.date),r.branch,r.loads,Number(r.weight.toFixed(3)),Number(r.branchAmount.toFixed(2))]);
      data.push(['TOTAL','','',summaryTotals.loads,Number(summaryTotals.weight.toFixed(3)),Number(summaryTotals.branchAmount.toFixed(2))]);
      return {labels,data,filename:prefix+'-daily-summary'};
    }
    const deliveredOffset=sheet==='DELIVERED'?1:0;
    const amountOffset=deliveredOffset*2; // Delivery Date and TAT on Delivered sheet.
    const labels=['Branch',...(deliveredOffset?['Delivery Date']:[]),'Date',...(deliveredOffset?['TAT (Days)']:[]),'Day','Load Received (kg)','Rate (INR/kg)','Amount (INR)','Received (INR)','Balance (INR)','JEPO Rate (INR/kg)','Amount Paid to JEPO (INR)','Amount Paid to Branch (INR)','Destination','Service','Commodity','No. of Bottles','JEPO Tracking No.','Status','Live Remarks','JEPO Status Date/Time','Entered By','Last Edited By','Remarks','Payment Mode','UTR / Confirmation No.',...(isAdmin?['Admin Decision','Decided By','Decided At']:[]),...(hasExtraCostColumn?['Extra Cost (INR)']:[]),'Total Amount Paid to JEPO (INR)'];
    const data=shown.map(r=>[r.branch,...(deliveredOffset?[r.deliveredOn||'']:[]),r.date,...(deliveredOffset?[inclusiveTatDays(r.date,r.deliveredOn)??'']:[]),weekday(r.date),r.weight,r.rate,r.amount,r.received,r.balance,r.jepoRate,r.paidToJepo,branchPayoutForRecord(r),r.destination,r.service,r.commodity,r.bottleCount||'',r.trackingNo||'',r.liveStatus||statusLabel(r.status),r.liveRemarks||'',r.liveEventWhen||'',employeeName(r.createdBy),employeeName(r.updatedBy),r.remarks||'',confirmationModeFor(r),r.confirmationNo||'',...(isAdmin?[r.confirmationDecision==='PENDING'&&r.confirmationApprovedAt?'YES':r.confirmationDecision||'PENDING',r.confirmationDecidedBy||r.confirmationApprovedBy||'',r.confirmationDecidedAt||r.confirmationApprovedAt||'']:[]),...(hasExtraCostColumn?[r.extraCost||0]:[]),totalJepoForLoad(r.paidToJepo,r.commodity,r.extraCost,r.bottleCount,{legacy:true})]);
    const total=Array(labels.length).fill('');
    total[0]='TOTAL';total[3+amountOffset]=totals.weight;total[5+amountOffset]=totals.amount;total[6+amountOffset]=totals.received;
    total[7+amountOffset]=totals.balance;total[9+amountOffset]=totals.paidToJepo;total[10+amountOffset]=totals.paidToBranch;
    if(hasExtraCostColumn)total[labels.indexOf('Extra Cost (INR)')]=totals.extraCost;
    total[labels.length-1]=totals.totalJepo;
    data.push(total);
    return {labels,data,filename:prefix+'-'+sheet.toLowerCase()+'-loads'};
  }
  function downloadCsv(){
    const {labels,data,filename}=exportTableData();
    const csv='\uFEFF'+[labels,...data].map(line=>line.map(safeCsvValue).join(',')).join('\r\n');
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
    const anchor=document.createElement('a');anchor.href=url;anchor.download=filename+'.csv';anchor.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function downloadTatSummaryCsv(){
    if(sheet!=='DELIVERED')return;
    const header=['Group','Service / Company','Country','Verified Deliveries','Average TAT (Days)','Fastest (Days)','Slowest (Days)'];
    const rows=[
      ...tatSummary.byServiceCountry.flatMap(service=>service.countries.map(country=>[
        'Company × Country',service.service,country.name,country.count,country.averageDays??'',country.fastest??'',country.slowest??''
      ])),
      ...tatSummary.byService.map(item=>['Service',item.name,'',item.count,item.averageDays??'',item.fastest??'',item.slowest??'']),
      ...tatSummary.byDestination.map(item=>['Destination','',item.name,item.count,item.averageDays??'',item.fastest??'',item.slowest??''])
    ];
    const csv='\uFEFF'+[header,...rows].map(line=>line.map(safeCsvValue).join(',')).join('\r\n');
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
    const anchor=document.createElement('a');anchor.href=url;
    anchor.download='mayavi-'+(filter==='ALL'?'jind-karnal':filter.toLowerCase())+'-tat-summary.csv';
    anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async function downloadExcel(){
    if(excelBusy)return;
    setExcelBusy(true);
    try{
      const {labels,data,filename}=exportTableData();
      // ExcelJS is loaded only when Excel is requested, keeping regular tracking fast.
      const ExcelJS=(await import('exceljs')).default;
      const workbook=new ExcelJS.Workbook();
      workbook.creator='JEPO Express / Mayavi Cargo';
      workbook.created=new Date();
      const worksheet=workbook.addWorksheet(sheet==='SUMMARY'?'Daily Summary':sheet==='DELIVERED'?'Delivered Loads':'Active Loads');
      worksheet.columns=labels.map((header,i)=>({
        header,key:'col'+i,
        width:/Remarks/.test(header)?34:/Destination|Commodity|Confirmation|Tracking/.test(header)?25:Math.max(15,Math.min(27,header.length+2))
      }));
      const numericLabels=new Set(['No. of Loads','Total Weight (kg)','Total Branch Amount (INR)','Load Received (kg)',
        'Rate (INR/kg)','Amount (INR)','Received (INR)','Balance (INR)','JEPO Rate (INR/kg)',
        'Amount Paid to JEPO (INR)','Amount Paid to Branch (INR)','No. of Bottles','Extra Cost (INR)',
        'Total Amount Paid to JEPO (INR)','TAT (Days)']);
      const numericIndices=new Set(labels.flatMap((label,index)=>numericLabels.has(label)?[index]:[]));
      data.forEach(values=>{
        const rowValues=values.map((v,index)=>numericIndices.has(index)&&v!==''&&v!==null&&v!==undefined?Number(v):(v===null||v===undefined?'':String(v)));
        worksheet.addRow(rowValues);
      });
      worksheet.getRow(1).height=36;
      worksheet.getRow(1).eachCell(cell=>{
        cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF174A91'}};
        cell.font={bold:true,color:{argb:'FFFFFFFF'},size:11};
        cell.alignment={vertical:'middle',wrapText:true};
      });
      worksheet.views=[{state:'frozen',xSplit:2,ySplit:1}];
      // Do not include the final TOTAL row in column filters.
      if(data.length>1)worksheet.autoFilter={from:{row:1,column:1},to:{row:data.length,column:labels.length}};
      for(let i=0;i<labels.length;i++){
        if(numericIndices.has(i))worksheet.getColumn(i+1).numFmt=/Weight/.test(labels[i])?'#,##0.000':/No\. of|TAT/.test(labels[i])?'#,##0':'#,##0.00';
      }
      const totalRow=worksheet.getRow(data.length+1);
      totalRow.font={bold:true,color:{argb:'FF163B74'}};
      totalRow.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFEAF1FC'}};
      if(sheet==='DELIVERED'){
        const matrixSheet=workbook.addWorksheet('TAT by Company Country');
        matrixSheet.columns=[
          {header:'Service / Company',key:'service',width:25},
          {header:'Country',key:'country',width:25},
          {header:'Verified Deliveries',key:'count',width:21},
          {header:'Average TAT (Days)',key:'average',width:22},
          {header:'Fastest (Days)',key:'fastest',width:18},
          {header:'Slowest (Days)',key:'slowest',width:18}
        ];
        for(const service of tatSummary.byServiceCountry)for(const country of service.countries){
          matrixSheet.addRow([service.service,country.name,country.count,country.averageDays??'',country.fastest??'',country.slowest??'']);
        }
        matrixSheet.getRow(1).eachCell(cell=>{
          cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF174A91'}};
          cell.font={bold:true,color:{argb:'FFFFFFFF'}};
        });
        matrixSheet.views=[{state:'frozen',xSplit:2,ySplit:1}];
        matrixSheet.getColumn(4).numFmt='0.0';
        for(const section of [
          {title:'TAT by Service',key:'Service',items:tatSummary.byService},
          {title:'TAT by Country',key:'Destination',items:tatSummary.byDestination}
        ]){
          const summarySheet=workbook.addWorksheet(section.title);
          summarySheet.columns=[
            {header:section.key,key:'name',width:24},
            {header:'Verified Deliveries',key:'count',width:21},
            {header:'Average TAT (Days)',key:'avg',width:22},
            {header:'Fastest (Days)',key:'min',width:18},
            {header:'Slowest (Days)',key:'max',width:18}
          ];
          for(const row of section.items)summarySheet.addRow([row.name,row.count,row.averageDays??'',row.fastest??'',row.slowest??'']);
          summarySheet.getRow(1).eachCell(cell=>{
            cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF174A91'}};
            cell.font={bold:true,color:{argb:'FFFFFFFF'}};
          });
          summarySheet.views=[{state:'frozen',ySplit:1}];
          summarySheet.getColumn(3).numFmt='0.0';
        }
      }
      const buffer=await workbook.xlsx.writeBuffer();
      const url=URL.createObjectURL(new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
      const anchor=document.createElement('a');anchor.href=url;anchor.download=filename+'.xlsx';anchor.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch(error){
      setMessage('Excel download failed: '+(error?.message||'Please try again.'));
    }finally{setExcelBusy(false);}
  }
  const input={type:'number',min:'0',step:'any',inputMode:'decimal'};
  function entryRow(showExtraColumn=false){
    return <tr className={styles.editRow}>
      <td>{isAdmin?<select aria-label="Branch" value={draft.branch} onChange={e=>setDraft(d=>({...d,branch:e.target.value,status:initialBranchStatus(e.target.value)}))}>{BRANCHES.map(x=><option key={x}>{x}</option>)}</select>:<b>{userBranch}</b>}</td>
      <td><input aria-label="Date" required type="date" value={draft.date} onChange={e=>set('date',e.target.value)}/></td>
      <td><input aria-label="Load received kilograms" {...input} required value={draft.weight} placeholder="Weight kg" onChange={e=>set('weight',e.target.value)}/></td>
      <td><input aria-label="Rate per kg" {...input} required value={draft.rate} placeholder="₹/kg" onChange={e=>set('rate',e.target.value)}/></td>
      <td className={styles.computed}>{fmt(preview?.amount??null)}</td>
      <td><input aria-label="Received payment" {...input} value={draft.received} placeholder="₹ received" onChange={e=>set('received',e.target.value)}/></td>
      <td className={styles.computed}>{fmt(preview?.balance??null)}</td>
      <td><input aria-label="JEPO Rate per kg" {...input} required value={draft.jepoRate} placeholder="₹/kg JEPO" onChange={e=>set('jepoRate',e.target.value)}/></td>
      <td className={styles.computed}>{fmt(jepoPreview)}</td>
      <td className={styles.computed}><BranchPaymentDisplay total={branchPreview} cash={branchCashPreview}/></td>
      <td><FieldChoice name="Destination" list={DESTINATIONS} value={draft.destination} onChange={v=>set('destination',v)}/></td>
      <td><FieldChoice name="Service" list={SERVICES} value={draft.service} onChange={v=>set('service',v)}/></td>
      <td><FieldChoice name="Commodity" list={COMMODITIES} value={draft.commodity} onChange={v=>setDraft(d=>({...d,commodity:v,bottleCount:requiresBottleCount(v)?d.bottleCount:''}))}/>{requiresBottleCount(draft.commodity)&&<label className={styles.bottleControl}>No. of Bottles<input aria-label="No. of Bottles" type="number" min="1" max="10000" step="1" required value={draft.bottleCount} placeholder="Enter bottles" onChange={e=>setDraft(d=>{const count=e.target.value;const minimum=minimumJepoExtraCost(d.commodity,count);return {...d,bottleCount:count,extraCost:count&&minimum!==null&&Number(d.extraCost||0)<minimum?String(minimum):d.extraCost};})}/></label>}</td>
      <td className={duplicateInfo?.duplicate?styles.duplicateField:''}>
        <input aria-label="JEPO tracking number" aria-invalid={Boolean(duplicateInfo?.duplicate)}
          placeholder="JEPO tracking" maxLength={100} value={draft.trackingNo} onChange={e=>set('trackingNo',e.target.value)}/>
        {duplicateInfo?.duplicate&&<div role="alert" className={styles.duplicateAlert}>
          <strong>⚠ DUPLICATE JEPO NO.</strong>
          <span>Already saved{duplicateInfo.existing?' • '+duplicateInfo.existing.branch+' • '+(duplicateInfo.existing.date||'')+' • '+statusLabel(duplicateInfo.existing.status):''}. Do not enter twice.</span>
        </div>}
        {!duplicateInfo?.duplicate&&checkingDuplicate&&<small className={styles.duplicateCheck}>Checking duplicate…</small>}
      </td>
      <td><select aria-label="Delivery status" value={draft.status} onChange={e=>set('status',e.target.value)}>{LOAD_STATUSES.map(x=><option key={x} value={x}>{statusLabel(x)}</option>)}</select></td>
      <td className={styles.remarksCell}><span title={rows.find(r=>r.id===editing)?.liveRemarks||''}>{editing==='new'?'—':rows.find(r=>r.id===editing)?.liveRemarks||'Pending live tracking'}</span></td>
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
      {showExtraColumn&&<td className={styles.extraCostCell}>
        <input aria-label="Extra Cost in rupees" {...input} placeholder="₹ Extra Cost" value={draft.extraCost} onChange={e=>set('extraCost',e.target.value)}/><small className={styles.extraSplitHint}>{extraJepoMinimum===null?'Enter bottles to calculate JEPO share':extraJepoMinimum>0?'₹'+extraJepoMinimum+' to JEPO; remaining to Branch':requiresBottleCount(draft.commodity)?'First Ghee bottle free • all Extra Cost to Branch':'Full Extra Cost to Branch'}</small></td>}
      <td className={styles.totalJepoCell}><JepoPaymentSplit total={totalJepoPreview} account={jepoPreview} cash={cashJepoPreview}/></td>
    </tr>;
  }
  function entryRowCells(){
    // The Delivered sheet retains TAT beside the dates while an existing row is edited.
    const cells=entryRow(hasExtraCostColumn).props.children;
    if(sheet!=='DELIVERED')return cells;
    const deliveredOn=rows.find(r=>r.id===editing)?.deliveredOn;
    const tat=inclusiveTatDays(draft.date,deliveredOn);
    return [...cells.slice(0,2),<td key="tat-edit" className={styles.number}>{tat===null?'—':tat+' days'}</td>,...cells.slice(2)];
  }
  const dataCells=record=>[
    <td key="branch"><span className={styles.branchTag} data-branch={record.branch}>{record.branch}</span>
      {isAdmin&&<button type="button" aria-label={'Delete '+record.branch+' entry '+showDate(record.date)} className={styles.quickDelete} disabled={busy} onClick={()=>remove(record)}>Delete</button>}</td>,
    <td key="date" title={sheet==='DELIVERED'?
        (record.deliveredOn?'Delivered: '+showDate(record.deliveredOn)+' • Booked: '+showDate(record.date):'Delivery date not yet verified • Booked: '+showDate(record.date)):
        showDate(record.date)}>
      {sheet==='DELIVERED'?<div>
        <strong style={{display:'block',color:record.deliveredOn?'#186534':'#8793a4',fontSize:11}}>
          {record.deliveredOn?compactShowDate(record.deliveredOn):'Date not verified'}
        </strong>
        <small style={{display:'block',fontSize:10,color:'#64748b'}}>Booked: {compactShowDate(record.date)}</small>
      </div>:compactShowDate(record.date)}
    </td>,
    ...(sheet==='DELIVERED'?[<td key="tat" className={styles.number} title={'Booked '+(record.date||'—')+' • Delivered '+(record.deliveredOn||'not verified')}>
      <strong>{inclusiveTatDays(record.date,record.deliveredOn)===null?'—':inclusiveTatDays(record.date,record.deliveredOn)+' days'}</strong>
    </td>]:[]),
    <td key="weight" className={styles.number}>{weightFormat(record.weight)}</td>,
    <td key="rate" className={styles.number}>{money(record.rate)}</td>,
    <td key="amount" className={styles.number}><b>{money(record.amount)}</b></td>,
    <td key="received" className={styles.number}>{money(record.received)}</td>,
    <td key="balance" className={styles.number}><strong className={Number(record.balance)>0?styles.due:styles.clear}>{money(record.balance)}</strong></td>,
    <td key="jepoRate" className={styles.number}>{money(record.jepoRate)}</td>,
    <td key="jepo" className={styles.number}>{money(record.paidToJepo)}</td>,
    <td key="branchpaid" className={styles.number}><BranchPaymentDisplay total={branchPayoutForRecord(record)} cash={branchCashPart(record.commodity,record.extraCost,record.bottleCount,{legacy:true})}/></td>,
    <td key="destination">{record.destination}</td>,
    <td key="service">{record.service}</td>,
    <td key="commodity">{record.commodity}{requiresBottleCount(record.commodity)&&<small className={styles.bottleNote}>No. of Bottles: {record.bottleCount??'Not recorded'}</small>}</td>,
    <td key="tracking"><b>{record.trackingNo||'—'}</b>
       {record.liveEventWhen&&<small style={{display:'block',fontSize:10,color:'#176b52',marginTop:3}} title="Date/time of last JEPO website tracking event">JEPO status: {record.liveEventWhen}</small>}
       {record.status==='DELIVERED'&&record.deliveredOn&&<small style={{display:'block',fontSize:10,color:'#176b52'}}>Delivered: {compactShowDate(record.deliveredOn)}</small>}
      {isJindJepoTimeout(record)&&<div className={styles.jindTimeoutBadge} role="status" title={record.liveError||'JEPO website timed out'}>
        <span>⚠ JEPO TIMEOUT · AUTO RETRY</span>
        <a href="https://jepoexpress.com/track" target="_blank" rel="noopener noreferrer"
          title="Open JEPO website tracking in a new tab" className={styles.jindTimeoutLink}>Tracking website</a>
      </div>}
      {flaggedJepoNumber(record.trackingNo)&&<span className={styles.duplicateBadge}>DUPLICATE / ALREADY SAVED</span>}
      {record.trackingNo&&<button type="button"
      className={styles.secondary} disabled={liveBusy||busy} style={{marginTop:5,padding:'4px 8px',display:'block',fontSize:10}}
      onClick={()=>void refreshJepo([record])}>Track JEPO</button>}</td>,
    <td key="status">{record.liveStatus&&<strong style={{display:'block',fontSize:11,color:'#1d5798',marginBottom:5}} title="JEPO Website Status">{record.liveStatus}</strong>}<select className={styles.statusChip} data-status={record.status} aria-label={'Status for '+(record.trackingNo||record.branch)} disabled={busy} value={record.status||initialBranchStatus(record.branch)} onChange={e=>changeStatus(record,e.target.value)}>
      {LOAD_STATUSES.map(x=><option key={x} value={x}>{statusLabel(x)}</option>)}
    </select></td>,
    <td key="liveRemarks" className={styles.remarksCell}><span title={record.liveRemarks||record.liveError||'Not checked yet'}>
      {record.liveRemarks||'—'}
      {isJindJepoTimeout(record)&&<strong className={styles.jindTimeoutText} title={record.liveError}>⚠ Tracking timed out — auto retrying</strong>}
    </span>
      {record.liveCheckedAt&&<small style={{display:'block',fontSize:9,color:'#63758d'}}>Last checked {new Date(record.liveCheckedAt).toLocaleString('en-IN')}</small>}</td>,
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
    ...(hasExtraCostColumn?[<td key="extraCost" className={styles.extraCostCell+' '+styles.number}>{'₹'+money(record.extraCost)}</td>]:[]),
    <td key="totalPaidToJepo" className={styles.totalJepoCell+' '+styles.number}><JepoPaymentSplit
      total={totalJepoForLoad(record.paidToJepo,record.commodity,record.extraCost,record.bottleCount,{legacy:true})}
      account={Number(record.paidToJepo||0)}
      cash={jepoCashPart(record.commodity,record.extraCost,record.bottleCount,{legacy:true})}
    /></td>
  ];
  if(sheet==='PROFIT'&&currentUser?.role==='admin')return <main className={styles.page}>
    <header className={styles.heading}><div><small>MAYAVI • MAIN ADMIN ONLY</small><h1>Jind &amp; Karnal — Branch Finance</h1><p>Monthly income, salaries, operating expenses and branch-wise profit or loss</p></div></header>
    <nav className={styles.sheetTabs} aria-label="Branch finance navigation">
      <button type="button" className={styles.sheetTab} onClick={()=>switchSheet('ACTIVE')}>Active Loads</button>
      <button type="button" className={styles.sheetTab} onClick={()=>switchSheet('DELIVERED')}>Delivered Sheet</button>
      <button type="button" className={styles.sheetTab} onClick={()=>switchSheet('SUMMARY')}>Daily Summary</button>
       <button type="button" className={styles.sheetTab} onClick={()=>switchSheet('MONTHLY')}>Monthly Data</button>
      <button type="button" className={styles.activeTab}>Branch Profit &amp; Loss</button>
    </nav>
    <BranchProfitDashboard/>
  </main>;
  return <main className={styles.page}>
    <header className={styles.heading}>
      <div><small>MAYAVI CARGO • DAILY BRANCH REGISTER</small><h1>Jind &amp; Karnal — Daily Load &amp; Payments</h1>
        <p>Daily Load Entry • Active, Delivered & Daily Summary • Overview combines Active + Delivered</p>
        <p style={{fontSize:12,color:'#28744e',fontWeight:800,marginTop:5}}>
          ● JEPO AUTO LIVE — JEPO website checked every 1 hour; this page refreshes saved data every 20 seconds. Track JEPO can be used for a manual check.
          {lastUpdated&&<span style={{color:'#526b81',fontWeight:500}}> • Screen updated {lastUpdated}</span>}
        </p></div>
    </header>
    <div className={styles.metrics} aria-label={sheet==='MONTHLY'?'Selected booking month totals':'Active and Delivered combined summary'}>
      <div><span>{'Total Load • '+overviewPeriod}</span><strong>{weightFormat(overviewTotals.weight)} kg</strong></div>
      <div><span>{'Amount • '+overviewPeriod}</span><strong>{fmt(overviewTotals.amount)}</strong></div>
      <div><span>{'Received • '+overviewPeriod}</span><strong>{fmt(overviewTotals.received)}</strong></div>
      <div><span>{'Balance • '+overviewPeriod}</span><strong>{fmt(overviewTotals.balance)}</strong></div>
      <div><span>{'Paid to JEPO • '+overviewPeriod}</span><strong>{fmt(overviewTotals.paidToJepo)}</strong></div>
      <div><span>{'Paid to Branch • '+overviewPeriod}</span><strong>{fmt(overviewTotals.paidToBranch)}</strong><small className={styles.branchCashLabel}>Cash included: {fmt(overviewTotals.cashBranch)} (Extra Cost remainder)</small></div>
    </div>
    {message&&<div className={styles.message} role="status" aria-live="polite">{message}</div>}
    <form noValidate onSubmit={save}>
      {sheet==='ACTIVE'&&editing==='new'&&<section className={styles.loadEntrySection}>
        <div className={styles.loadEntryTitle}>
          <div><h2>Load Entry</h2><p>Enter load details, then click Save in the same row. Day appears automatically.</p></div>
          <div className={styles.loadEntryActions}><span className={styles.actorName}>Entering as: {currentUser?.displayName||employeeName(currentUser?.username)} • {isAdmin?draft.branch:userBranch}</span></div>
        </div>
        <div className={styles.scroller} ref={entryScrollRef} onScroll={()=>syncLedgerScroll('entry')}><table className={styles.table+' '+styles.entryLedger} style={{width:ledgerWidth(true)+'px',minWidth:'100%'}}>
          {ledgerColumns(true)}
          <thead><tr><th>Branch</th><th>Date &amp; Day{draft.date&&<small className={styles.dayAboveDate}>{weekday(draft.date)}</small>}</th><th>Load Received (kg)</th><th>Rate (₹/kg)</th><th>Amount • Auto</th><th>Received (₹)</th><th>Balance • Auto</th><th>JEPO Rate (₹/kg)</th><th>Paid to JEPO • Auto (₹)</th><th>Paid to Branch • Auto (₹)</th><th>Destination</th><th>Service</th><th>Commodity</th><th>JEPO Tracking No.</th><th>Status</th><th>Live Remarks</th><th>Entered By</th><th>Edited By</th><th>Remarks</th><th>UTR / Cash</th><th>Save</th><th className={styles.extraCostHeader}>Extra Cost (₹)</th><th className={styles.totalJepoHeader}>Total Amount Paid to JEPO (₹)</th></tr></thead>
          <tbody>{entryRow(true)}</tbody>
        </table></div>
      </section>}
    <nav className={styles.sheetTabs} aria-label="Load sheet">
      <button type="button" className={sheet==='ACTIVE'?styles.activeTab:styles.sheetTab} onClick={()=>switchSheet('ACTIVE')}>Active Loads ({activeCount})</button>
      <button type="button" className={sheet==='DELIVERED'?styles.deliveredTab:styles.sheetTab} onClick={()=>switchSheet('DELIVERED')}>Delivered Sheet ({deliveredCount})</button>
      {sheet==='DELIVERED'&&<small style={{fontSize:11,color:'#25603a',fontWeight:700}}>Latest verified delivery date first • Undated past deliveries below</small>}
      <button type="button" className={sheet==='SUMMARY'?styles.summaryTab:styles.sheetTab} onClick={()=>switchSheet('SUMMARY')}>Daily Summary</button>
       <button type="button" className={sheet==='MONTHLY'?styles.summaryTab:styles.sheetTab} onClick={()=>switchSheet('MONTHLY')}>Monthly Data</button>
      {currentUser?.role==='admin'&&<button type="button" className={styles.sheetTab} onClick={()=>switchSheet('PROFIT')}>Branch Profit &amp; Loss</button>}
    </nav>

    {isAdmin&&<p className={styles.hint}>Amount = Weight × Rate • JEPO base = Weight × JEPO Rate • Extra Cost split: Ghee first bottle free; (No. of Bottles − 1) × ₹250 to JEPO. Household and Medicine ₹700 to JEPO; Medicine only: entire Extra Cost to Branch. Nutrition ₹150 to JEPO; remainder to Branch. Electronics / Hookah and all other Extra Cost goes to Branch.</p>}
      {sheet==='MONTHLY'&&<BranchMonthlyDashboard records={matchingRows} isAdmin={isAdmin} branchFilter={filter} onBranchChange={setFilter} selectedMonth={monthlyMonth} onMonthChange={setSelectedMonthlyMonth} showProfit={currentUser?.role==='admin'}/>}
       {sheet==='SUMMARY'&&<section className={styles.summarySection} aria-label="Daily branch summary">
        <div className={styles.summaryHeader}>
          <div>
            <h2>Daily Branch Summary</h2>
            <p>All booked loads grouped by booking date and branch, including loads now marked Delivered.</p>
          </div>
          <strong>{dailySummary.length} daily records</strong>
        </div>
        <div className={styles.scroller}><table className={styles.table+' '+styles.summaryTable}>
          <thead><tr>
            <th>Date &amp; Day</th>
            <th>Branch{isAdmin&&<select aria-label="Daily summary branch filter" className={styles.headerFilter} value={filter} onChange={e=>setFilter(e.target.value)}>
              <option value="ALL">Both</option>{BRANCHES.map(b=><option key={b} value={b}>{b}</option>)}
            </select>}</th>
            <th className={styles.number}>Total Loads</th>
            <th className={styles.number}>Total Weight (kg)</th>
            <th className={styles.number}>Total Branch Amount (₹)</th>
          </tr></thead>
          <tbody>
            {dailySummary.map(r=><tr key={r.branch+'|'+r.date} data-branch={r.branch}>
              <td><strong>{showDate(r.date)}</strong></td>
              <td><span className={styles.branchTag} data-branch={r.branch}>{r.branch}</span></td>
              <td className={styles.number}>{r.loads}</td>
              <td className={styles.number}><strong>{weightFormat(r.weight)}</strong></td>
              <td className={styles.summaryEarnings}>{fmt(r.branchAmount)}</td>
            </tr>)}
            {!loaded&&<tr><td colSpan={5}>Loading daily branch totals…</td></tr>}
            {loaded&&!dailySummary.length&&<tr><td colSpan={5} className={styles.empty}>No loads booked for this branch yet.</td></tr>}
          </tbody>
          <tfoot><tr>
            <td>TOTAL</td><td>{filter==='ALL'?'Both branches':filter}</td>
            <td className={styles.number}>{summaryTotals.loads}</td>
            <td className={styles.number}>{weightFormat(summaryTotals.weight)}</td>
            <td className={styles.summaryEarnings}>{fmt(summaryTotals.branchAmount)}</td>
          </tr></tfoot>
        </table></div>
        <p className={styles.summaryHint}>Branch Amount = Amount − Paid to JEPO + Branch share of Extra Cost. This is branch earnings before any expenses not recorded in these loads.</p>
      </section>}
      {sheet==='DELIVERED'&&<section className={styles.tatSummarySection} aria-label="Service and destination delivery TAT summary">
        <div className={styles.tatSummaryHeading}>
          <div>
            <h2>Delivery TAT Summary</h2>
            <p>Each company’s delivery time by country, plus service-wise and country-wise averages. Booking and delivery dates both count.</p>
            <small>{tatSummary.verifiedCount} dated deliveries out of {tatSummary.deliveredCount} delivered loads
              {tatSummary.missingDateCount>0&&' • '+tatSummary.missingDateCount+' without a valid delivery date excluded'}
            </small>
          </div>
          <div className={styles.tatOverall}><strong>{tatSummary.averageDays===null?'—':tatSummary.averageDays.toFixed(1)+' days'}</strong><span>Overall average TAT</span></div>
        </div>
        <div className={styles.tatMatrixHeading}>
          <h3>Company × Country-wise TAT</h3>
          <p>FedEx, TPL, Speed Post, Self and other saved services — USA, UK, Australia, Canada and Other Countries.</p>
        </div>
        <div className={styles.tatMatrixGrid}>
          {tatSummary.byServiceCountry.map(service=><section key={service.service} className={styles.tatMatrixCard}>
            <div className={styles.tatMatrixService}>
              <strong>{service.service}</strong>
              <small>{service.count} delivered with dates • Avg {service.averageDays===null?'—':service.averageDays.toFixed(1)+' days'}</small>
            </div>
            <div className={styles.tatTableScroll}>
              <table className={styles.tatSummaryTable}>
                <thead><tr><th>Country</th><th>Delivered</th><th>Avg. TAT</th><th>Fastest</th><th>Slowest</th></tr></thead>
                <tbody>{service.countries.map(country=><tr key={country.name}>
                  <td><strong>{country.name}</strong></td>
                  <td>{country.count}</td>
                  <td><strong>{country.averageDays===null?'—':country.averageDays.toFixed(1)+' days'}</strong></td>
                  <td>{country.fastest===null?'—':country.fastest+' days'}</td>
                  <td>{country.slowest===null?'—':country.slowest+' days'}</td>
                </tr>)}</tbody>
              </table>
            </div>
          </section>)}
        </div>
        <div className={styles.tatMatrixHeading}><h3>Overall TAT summaries</h3></div>
        <div className={styles.tatSummaryGrid}>
          {[
            {id:'services',title:'Company / Service-wise TAT',items:tatSummary.byService},
            {id:'destinations',title:'Destination / Country-wise TAT',items:tatSummary.byDestination}
          ].map(group=><div key={group.id} className={styles.tatSummaryCard}>
            <h3>{group.title}</h3>
            <div className={styles.tatTableScroll}>
              <table className={styles.tatSummaryTable}>
                <thead><tr><th>{group.id==='services'?'Service':'Country'}</th><th>Delivered*</th><th>Avg. days</th><th>Fastest</th><th>Slowest</th></tr></thead>
                <tbody>{group.items.map(item=><tr key={item.name}>
                  <td><strong>{item.name}</strong></td>
                  <td>{item.count}</td>
                  <td><strong>{item.averageDays===null?'—':item.averageDays.toFixed(1)}</strong></td>
                  <td>{item.fastest===null?'—':item.fastest}</td>
                  <td>{item.slowest===null?'—':item.slowest}</td>
                </tr>)}</tbody>
              </table>
            </div>
          </div>)}
        </div>
        <p className={styles.tatSummaryNote}>*Only deliveries with valid booking and verified delivery dates. Average TAT = total inclusive TAT days ÷ verified deliveries. All destinations outside USA, UK, Australia and Canada are grouped under Other Countries within each service. Branch and search filters apply to every table. Missing dates show —, never an estimated TAT.</p>
      </section>}
      {sheet!=='SUMMARY'&&sheet!=='MONTHLY'&&<div className={styles.scroller} ref={savedScrollRef} onScroll={()=>syncLedgerScroll('saved')}><table className={styles.table+' '+styles.savedLedger} style={{width:ledgerWidth(hasExtraCostColumn,sheet==='DELIVERED')+'px',minWidth:'100%'}}>
        {ledgerColumns(hasExtraCostColumn,sheet==='DELIVERED')}
        <thead><tr>
          <th>Branch{isAdmin&&<select aria-label="Branch filter" className={styles.headerFilter} value={filter} onChange={e=>setFilter(e.target.value)}><option value="ALL">Both</option>{BRANCHES.map(x=><option key={x} value={x}>{x}</option>)}</select>}</th>
          <th>{sheet==='DELIVERED'?'Delivery Date ↓':'Date'}</th>
          {sheet==='DELIVERED'&&<th title="Booking Date to Delivery Date, both days included">TAT (Days)</th>}
          <th>Load Received (kg)</th><th>Rate (₹/kg)</th><th>Amount (₹) • Auto</th><th>Received (₹)</th><th>Balance (₹) • Auto</th><th>JEPO Rate (₹/kg)</th><th>Amount Paid to JEPO (₹) • Auto</th><th>Amount Paid to Branch (₹) • Auto</th><th>Destination</th><th>Service</th><th>Commodity</th><th>JEPO Tracking No.</th><th>Status</th><th>Live Remarks</th><th>Entered By</th><th>Last Edited By</th><th>Remarks</th><th>UTR / Cash • Admin Yes/No</th><th>Actions</th>{hasExtraCostColumn&&<th className={styles.extraCostHeader}>Extra Cost (₹)</th>}<th className={styles.totalJepoHeader}>Total Amount Paid to JEPO (₹)</th>
        </tr></thead>
        <tbody>
          {/* Daily Load Entry stays above; saved records only in this sheet. */}
          {shown.map(row=>editing===row.id?<tr key={row.id} className={styles.editRow}>{entryRowCells()}</tr>:<tr key={row.id} data-branch={row.branch} className={[row.status==='DELIVERED'?styles.deliveredRow:'',flaggedJepoNumber(row.trackingNo)?styles.duplicateRow:'',isJindJepoTimeout(row)?styles.jindTimeoutRow:''].filter(Boolean).join(' ')}>{dataCells(row)}</tr>)}
          {!loaded&&<tr><td colSpan={22+(hasExtraCostColumn?1:0)+(sheet==='DELIVERED'?1:0)}>Loading branch entries…</td></tr>}
          {loaded&&!shown.length&&<tr><td colSpan={21+(hasExtraCostColumn?1:0)+(sheet==='DELIVERED'?1:0)} className={styles.empty}>{sheet==='ACTIVE'?'No active loads yet. Use the row Save button above.':'No delivered loads yet.'}</td></tr>}
        </tbody>
        <tfoot><tr><td>TOTAL</td><td>{shown.length} entries</td>{sheet==='DELIVERED'&&<td>—</td>}<td className={styles.number}>{weightFormat(totals.weight)}</td><td>—</td><td className={styles.number}>{money(totals.amount)}</td><td className={styles.number}>{money(totals.received)}</td><td className={styles.number}>{money(totals.balance)}</td><td>—</td><td className={styles.number}>{money(totals.paidToJepo)}</td><td className={styles.number}><BranchPaymentDisplay total={totals.paidToBranch} cash={totals.cashBranch}/></td><td colSpan={10}>—</td><td>—</td>{hasExtraCostColumn&&<td className={styles.extraCostCell+' '+styles.number}>{money(totals.extraCost)}</td>}<td className={styles.totalJepoCell+' '+styles.number}><JepoPaymentSplit total={totals.totalJepo} account={totals.paidToJepo} cash={totals.cashJepo}/></td></tr></tfoot>
      </table></div>}
    </form>
    <footer className={styles.foot}>
      <span>Daily loads are saved securely. {lastUpdated&&'Last synced: '+lastUpdated}</span>
      <span className={styles.footerActions}>
        {sheet==='ACTIVE'&&<button type="button" onClick={add} disabled={busy}>+ Daily Entry</button>}
        <button type="button" onClick={()=>void load()}>Refresh</button>
        {sheet!=='SUMMARY'&&sheet!=='MONTHLY'&&<button type="button" disabled={liveBusy||busy||!matchingRows.some(r=>r.trackingNo&&r.status!=='DELIVERED')}
          onClick={()=>void refreshJepo(matchingRows.filter(r=>r.trackingNo&&r.status!=='DELIVERED').slice(0,6))}>
          {liveBusy?'Checking JEPO…':'Refresh JEPO Live'}
        </button>}
        {sheet==='DELIVERED'&&<button type="button" onClick={downloadTatSummaryCsv} disabled={!tatSummary.verifiedCount}>Download TAT Summary CSV</button>}
        {sheet!=='MONTHLY'&&<button type="button" onClick={downloadCsv} disabled={sheet==='SUMMARY'?!dailySummary.length:!shown.length}>Download CSV</button>}
         {sheet!=='MONTHLY'&&<button type="button" onClick={()=>void downloadExcel()} disabled={excelBusy||(sheet==='SUMMARY'?!dailySummary.length:!shown.length)}>{excelBusy?'Preparing Excel…':'Download Excel (.xlsx)'}</button>}
      </span>
    </footer>
  </main>;
}
