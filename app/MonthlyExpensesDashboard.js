'use client';
import {useCallback,useEffect,useMemo,useState} from 'react';
import {calculateMonthlyExpenses} from '../lib/monthlyExpenses.js';

const money=new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',minimumFractionDigits:2,maximumFractionDigits:2});
const show=value=>money.format(Number(value)||0);
const monthNow=()=>{
  const p=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit'}).formatToParts(new Date());
  const y=p.find(x=>x.type==='year')?.value||'2026',m=p.find(x=>x.type==='month')?.value||'10';
  return y+'-'+m;
};
const td={padding:'11px 13px',borderBottom:'1px solid #e4ebf3',fontSize:13,verticalAlign:'middle'};
const input={padding:'9px 11px',border:'1px solid #c3d3e5',borderRadius:9,minWidth:155,maxWidth:'100%',boxSizing:'border-box',fontSize:14};
const card={background:'#fff',borderRadius:12,border:'1px solid #dce6f1',padding:16};
function ItemsTable({title,items,total,color}){
  return <div style={{...card,padding:0,overflow:'hidden'}}>
    <h2 style={{margin:0,padding:'14px 16px',background:color,fontSize:16,fontWeight:900}}>{title}</h2>
    <table style={{width:'100%',borderCollapse:'collapse'}}>
      <thead><tr style={{background:'#f8fafe'}}><th style={{...td,textAlign:'left'}}>Particulars</th><th style={{...td,textAlign:'right'}}>Amount (₹)</th></tr></thead>
      <tbody>
        {items.map(item=><tr key={item.label}><td style={{...td,color:'#314d70'}}>{item.label}{item.detail&&<small style={{display:'block',fontSize:11,color:'#60738a',marginTop:4}}>{item.detail}</small>}</td>
          <td style={{...td,textAlign:'right',fontWeight:750,whiteSpace:'nowrap'}}>{show(item.value)}</td></tr>)}
      </tbody>
      <tfoot><tr style={{background:color,fontWeight:900}}>
        <td style={td}>{title==='INCOME'?'TOTAL INCOME':'TOTAL EXPENSES'}</td>
        <td style={{...td,textAlign:'right'}}>{show(total)}</td>
      </tr></tfoot>
    </table>
  </div>;
}
const expenseHeads=[
  {key:'rent',label:'RENT',line:'Rent'},
  {key:'office',label:'OFFICE EXPENSES',line:'Office Expenses'},
  {key:'rooms',label:'ROOMS EXPENSES',line:'Rooms Expenses'},
  {key:'misc',label:'MISCELLANEOUS',line:'Miscellaneous'}
];
const initialExpenses={rent:'',office:'',rooms:'',misc:''};
const initialSavedTotals={rent:0,office:0,rooms:0,misc:0};
export default function MonthlyExpensesDashboard(){
  const [month,setMonth]=useState(monthNow);
  const [record,setRecord]=useState(null);
  const [drafts,setDrafts]=useState(initialExpenses);
  const [savedTotals,setSavedTotals]=useState(initialSavedTotals);
  const [miscRemark,setMiscRemark]=useState('');
  const [miscEntries,setMiscEntries]=useState([]);
  const [legacyMisc,setLegacyMisc]=useState({amount:0,remarks:'Previously saved Miscellaneous (before Remarks)'});
  const [editingTotal,setEditingTotal]=useState(null);
  const [totalEditBusy,setTotalEditBusy]=useState(false);
  const [editingMisc,setEditingMisc]=useState(null);
  const [miscEditBusy,setMiscEditBusy]=useState(false);
  const [dirty,setDirty]=useState({});
  const [saved,setSaved]=useState({});
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState({});
  const [note,setNote]=useState('');
  const load=useCallback(async()=>{
    setLoading(true);
    try{
      // Rent, Office, Rooms and Misc remain editable even if the Income source fails.
      const res=await fetch('/api/monthly-expenses?month='+encodeURIComponent(month)+'&view=expenses',
        {credentials:'include',cache:'no-store'});
      const values=await res.json();
      if(!res.ok||!values.ok)throw new Error(values.error||'Unable to load saved monthly expenses.');
      // Previously saved amounts belong to the monthly summary, not the next entry box.
      setDrafts({...initialExpenses});setMiscRemark('');setEditingMisc(null);setEditingTotal(null);
      setMiscEntries(Array.isArray(values.miscEntries)?values.miscEntries:[]);
      setLegacyMisc(values.legacyMisc||{amount:0,remarks:'Previously saved Miscellaneous (before Remarks)'});
      setSavedTotals({rent:Number(values.rent||0),office:Number(values.office||0),
        rooms:Number(values.rooms||0),misc:Number(values.misc||0)});
      setDirty({});setSaved(values.savedFields||{});
      try{
        const response=await fetch('/api/monthly-expenses?month='+encodeURIComponent(month),
          {credentials:'include',cache:'no-store'});
        const data=await response.json();
        if(!response.ok||!data.ok)throw new Error(data.error||'Unable to load profit figures.');
        setRecord(data);setNote('');
      }catch(error){
        setRecord(null);
        setNote('Expenses are available to edit and save. Income figures could not be loaded: '+(error.message||error));
      }
    }catch(error){setRecord(null);setNote(error.message||'Unable to load saved monthly expenses.');}
    finally{setLoading(false);}
  },[month]);
  useEffect(()=>{void load()},[load]);
  useEffect(()=>{
    if(Object.values(dirty).some(Boolean)||Object.values(busy).some(Boolean)||editingMisc||miscEditBusy||editingTotal||totalEditBusy)return;
    const poll=()=>{if(document.visibilityState!=='hidden')void load()};
    const timer=setInterval(poll,90000);
    return()=>clearInterval(timer);
  },[load,dirty,busy,editingMisc,miscEditBusy,editingTotal,totalEditBusy]);
  // Only persisted totals enter the monthly accounts; a new unsaved entry
  // never affects Total Expenses or Final Profit.
  const metrics=useMemo(()=>record?calculateMonthlyExpenses({...record.values,...savedTotals}):null,[record,savedTotals]);
  function changeExpense(key,value){
    setDrafts(previous=>({...previous,[key]:value}));
    setDirty(previous=>({...previous,[key]:true}));
    setSaved(previous=>({...previous,[key]:false}));
  }
  async function saveExpense(key){
    if(busy[key]||loading||!month)return;
    if(totalEditBusy||(editingTotal?.key===key))return;
    const raw=String(drafts[key]??'').trim();
    if(raw===''||!/^\d+(?:\.\d{1,2})?$/.test(raw)||Number(raw)>999999999){
      setNote('Enter a valid non-negative amount for '+expenseHeads.find(x=>x.key===key)?.line+' (up to 2 decimals).');
      return;
    }
    const remark=key==='misc'?miscRemark.trim().replace(/\s+/g,' '):'';
    if(key==='misc'&&(!remark||remark.length>120)){
      setNote('Enter Miscellaneous Remarks (1–120 characters), e.g. SIIB Monthly.');
      return;
    }
    setBusy(previous=>({...previous,[key]:true}));setNote('');
    try{
      const res=await fetch('/api/monthly-expenses',{method:'PATCH',credentials:'include',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({month,field:key,value:raw,...(key==='misc'?{remarks:remark}:{})})});
      const result=await res.json();
      if(!res.ok||!result.ok)throw new Error(result.error||'Save failed.');
      const verifiedResponse=await fetch('/api/monthly-expenses?month='+encodeURIComponent(month)+'&view=expenses',
        {credentials:'include',cache:'no-store'});
      const verified=await verifiedResponse.json();
      if(!verifiedResponse.ok||!verified.ok||!verified.savedFields?.[key]||
        Number(verified[key])!==Number(result.value))
        throw new Error('Could not confirm saved '+key+' amount in database.');
      if(key==='misc'&&(!result.entry?.id||
        !verified.miscEntries?.some(entry=>entry.id===result.entry.id&&
          entry.remarks===remark&&Number(entry.amount)===Number(raw))))
        throw new Error('Miscellaneous Remarks could not be verified in the database.');
      // The submitted amount is now stored in the monthly running total.
      // Clear only this input, leaving all other unsaved entries untouched.
      setDrafts(previous=>({...previous,[key]:''}));
      if(key==='misc'){
        setMiscRemark('');
        setMiscEntries(verified.miscEntries||[]);
      }
      setSavedTotals(previous=>({...previous,[key]:Number(verified[key])}));
      setDirty(previous=>({...previous,[key]:false}));
      setSaved(previous=>({...previous,[key]:true}));
      setRecord(previous=>previous?{...previous,values:{...previous.values,[key]:Number(verified[key])}}:previous);
      setNote('✓ SAVED TO DATABASE • '+expenseHeads.find(x=>x.key===key)?.line+
        (key==='misc'?' ('+remark+')':'')+
        ': '+show(Number(raw))+' added • Monthly total: '+show(verified[key]));
    }catch(error){
      setSaved(previous=>({...previous,[key]:false}));
      setNote('Not saved: '+(error.message||'Unable to save the expense.'));
    }finally{setBusy(previous=>({...previous,[key]:false}));}
  }
  function beginTotalEdit(key){
    if(!['rent','office','rooms'].includes(key)||totalEditBusy||loading||editingTotal)return;
    setEditingTotal({key,month,amount:String(savedTotals[key]),previousAmount:savedTotals[key]});
    setNote('');
  }
  async function saveTotalEdit(){
    const edit=editingTotal;
    if(!edit||totalEditBusy||loading||edit.month!==month)return;
    const amount=String(edit.amount??'').trim();
    if(!/^\d+(?:\.\d{1,2})?$/.test(amount)||Number(amount)>999999999){
      setNote('Enter a valid saved expense total (up to 2 decimals).');return;
    }
    setTotalEditBusy(true);setNote('');
    try{
      const response=await fetch('/api/monthly-expenses',{method:'PATCH',
        credentials:'include',headers:{'content-type':'application/json'},
        body:JSON.stringify({month,field:'edit_total',category:edit.key,
          value:amount,previousAmount:edit.previousAmount})
      });
      const result=await response.json();
      if(!response.ok||!result.ok)throw new Error(result.error||'Could not edit saved expense total.');
      const check=await fetch('/api/monthly-expenses?month='+encodeURIComponent(month)+'&view=expenses',
        {credentials:'include',cache:'no-store'});
      const verified=await check.json();
      if(!check.ok||!verified.ok||Number(verified[edit.key])!==Number(result.value)||
          Number(result.value)!==Number(amount))
        throw new Error('Saved expense total could not be verified in the database.');
      setSavedTotals(previous=>({...previous,[edit.key]:Number(verified[edit.key])}));
      setRecord(previous=>previous?{...previous,values:{...previous.values,
        [edit.key]:Number(verified[edit.key])}}:previous);
      setEditingTotal(null);
      setNote('✓ UPDATED TO DATABASE • '+expenseHeads.find(h=>h.key===edit.key)?.line+
        ': '+show(verified[edit.key]));
    }catch(error){setNote('Expense edit not confirmed: '+(error.message||'Unable to save changes.'));}
    finally{setTotalEditBusy(false);}
  }
  function beginMiscEdit(entry){
    if(miscEditBusy||loading)return;
    setEditingMisc({id:entry.id,month,amount:String(entry.amount),
      remarks:entry.remarks,previousAmount:entry.amount,previousRemarks:entry.remarks});
    setNote('');
  }
  async function saveMiscEdit(){
    const draft=editingMisc;
    if(!draft||miscEditBusy||loading||draft.month!==month)return;
    const raw=String(draft.amount??'').trim();
    const remark=String(draft.remarks??'').trim().replace(/\s+/g,' ');
    if(!/^\d+(?:\.\d{1,2})?$/.test(raw)||Number(raw)>999999999){
      setNote('Enter a valid non-negative Miscellaneous amount (up to 2 decimals).');
      return;
    }
    if(!remark||remark.length>120){
      setNote('Enter Miscellaneous Remarks (1–120 characters).');
      return;
    }
    setMiscEditBusy(true);setNote('');
    try{
      const isLegacy=draft.id==='legacy';
      const response=await fetch('/api/monthly-expenses',{
        method:'PATCH',credentials:'include',headers:{'content-type':'application/json'},
        body:JSON.stringify({month,field:isLegacy?'edit_legacy_misc':'edit_misc',
          ...(isLegacy?{}:{id:draft.id}),value:raw,remarks:remark,
          previousAmount:draft.previousAmount,previousRemarks:draft.previousRemarks})
      });
      const updated=await response.json();
      if(!response.ok||!updated.ok)throw new Error(updated.error||'Could not update Miscellaneous.');
      const confirmation=await fetch('/api/monthly-expenses?month='+encodeURIComponent(month)+'&view=expenses',
        {credentials:'include',cache:'no-store'});
      const verified=await confirmation.json();
      const savedEntry=isLegacy?verified.legacyMisc:verified.miscEntries?.find(entry=>entry.id===draft.id);
      if(!confirmation.ok||!verified.ok||Number(verified.misc)!==Number(updated.value)||
          !savedEntry||savedEntry.remarks!==remark||Number(savedEntry.amount)!==Number(raw))
        throw new Error('Could not confirm updated Miscellaneous amount and Remarks in the database.');
      setMiscEntries(verified.miscEntries);
      setLegacyMisc(verified.legacyMisc||{amount:0,remarks:'Previously saved Miscellaneous (before Remarks)'});
      setSavedTotals(previous=>({...previous,misc:Number(verified.misc)}));
      setRecord(previous=>previous?{...previous,values:{...previous.values,misc:Number(verified.misc)}}:previous);
      setEditingMisc(null);
      setNote('✓ UPDATED TO DATABASE • '+remark+': '+show(Number(raw))+
        ' • Monthly Miscellaneous Total: '+show(verified.misc));
    }catch(error){
      setNote('Miscellaneous edit not confirmed: '+(error.message||'Unable to update the entry.'));
    }finally{setMiscEditBusy(false)}
  }
  const listedMiscEntries=useMemo(()=>[
    ...miscEntries,
    ...(Number(legacyMisc.amount)>0?[{
      id:'legacy',remarks:legacyMisc.remarks,amount:Number(legacyMisc.amount),
      legacy:true,createdAt:null
    }]:[])
  ],[miscEntries,legacyMisc]);
  const income=record?[{label:'Import Gross Profit',value:record.values.importGross,
    detail:'Profit Sheet Gross '+show(record.source?.import?.grossProfit||0)+
      ' + Protein Deduction '+show(record.source?.import?.proteinDeduction||0)+
      ' + Clothes Deduction '+show(record.source?.import?.clothesDeduction||0)},
    {label:'Export Gross Profit (Export Profit Sheet total)',value:record.values.exportGross},
    {label:'Jind Branch — Amount Paid to Branch',value:record.values.jind},
    {label:'Karnal Branch — Amount Paid to Branch',value:record.values.karnal},
    {label:'Import — 15% Goods Charge Total',value:record.values.goods15},
    {label:'Speed Post — Net Profit',value:record.values.speedPost}]:[];
  const expenses=record?[{label:'Salary — Cash Paid',value:record.values.salaryCash},
    {label:'Salary — Account Paid',value:record.values.salaryAccount},
    ...expenseHeads.map(head=>({label:head.line,value:savedTotals[head.key]}))]:[];
  const caption=new Date(Number(month.slice(0,4)),Number(month.slice(5))-1,1).toLocaleDateString('en-IN',{month:'long',year:'numeric'});
  return <main style={{background:'#f5f8fc',minHeight:'75vh',padding:'22px clamp(12px,3vw,32px)',color:'#183153'}}>
    <div style={{maxWidth:1140,margin:'auto'}}>
      <div style={{display:'flex',justifyContent:'space-between',gap:16,alignItems:'center',flexWrap:'wrap',marginBottom:18}}>
        <div><small style={{color:'#436899',fontWeight:900}}>MAYAVI • ADMIN ONLY</small>
          <h1 style={{margin:'7px 0 4px',fontSize:27}}>Monthly Expenses & Profit</h1>
          <p style={{margin:0,color:'#5d7189'}}>Income from existing Mayavi sheets minus Salary, Rent, Office, Rooms and Misc expenses.</p>
        </div>
        <label style={{display:'grid',gap:5,fontWeight:900,fontSize:12}}>SELECT MONTH
          <input type="month" min="2026-10" max={monthNow()} value={month} disabled={miscEditBusy||totalEditBusy}
            onChange={e=>{setMonth(e.target.value);setRecord(null);setDrafts({...initialExpenses});setMiscRemark('');setMiscEntries([]);setEditingMisc(null);setEditingTotal(null);setLegacyMisc({amount:0,remarks:'Previously saved Miscellaneous (before Remarks)'});setSavedTotals({...initialSavedTotals});setDirty({});setSaved({});setBusy({});}}
            style={{...input,fontWeight:800}}/>
        </label>
      </div>
      {note&&<div role="status" style={{padding:12,background:'#e8f0fd',color:'#1e4b82',borderRadius:10,marginBottom:15,fontWeight:750,fontSize:13}}>{note}</div>}
      <section style={{marginBottom:16}}>
        <h2 style={{margin:'0 0 9px',fontSize:17}}>Monthly Expense Entries — {caption}</h2>
        <p style={{fontSize:12,color:'#64748b',margin:'0 0 12px'}}>Each expense has its own SAVE. After saving, the amount clears from its entry box and is included in that month's saved total. Another entry in the same category adds to the total.</p>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(225px,1fr))',gap:12}}>
          {expenseHeads.map(head=><div key={head.key} style={card}>
            <label htmlFor={'monthly-expense-'+head.key} style={{fontSize:12,fontWeight:900,color:'#365574'}}>{head.label}</label>
            <input id={'monthly-expense-'+head.key} type="number" min="0" max="999999999" step=".01"
              aria-label={'Monthly '+head.line} placeholder="Enter amount to add" value={drafts[head.key]}
              disabled={loading||Boolean(busy[head.key])}
              onChange={e=>changeExpense(head.key,e.target.value)}
              style={{...input,display:'block',width:'100%',margin:'9px 0'}}/>
            {head.key==='misc'&&<label style={{display:'block',fontWeight:800,fontSize:12,color:'#365574',margin:'0 0 9px'}}>
              REMARKS
              <input type="text" aria-label="Miscellaneous Remarks" maxLength={120}
                placeholder="e.g. SIIB Monthly" value={miscRemark}
                disabled={loading||Boolean(busy.misc)}
                onChange={e=>{
                  setMiscRemark(e.target.value);
                  setDirty(previous=>({...previous,misc:true}));
                  setSaved(previous=>({...previous,misc:false}));
                }}
                style={{...input,display:'block',width:'100%',marginTop:6}}/>
            </label>}
            <button type="button" disabled={loading||Boolean(busy[head.key])||!month||(head.key==='misc'&&Boolean(editingMisc))||(editingTotal?.key===head.key)}
              onClick={()=>void saveExpense(head.key)}
              style={{border:0,borderRadius:9,width:'100%',background:saved[head.key]?'#15803d':'#2056a1',
                color:'#fff',fontWeight:900,cursor:'pointer',fontSize:13,padding:'11px 14px'}}>
              {busy[head.key]?'SAVING…':saved[head.key]?'✓ SAVED':'SAVE'}
            </button>
            <small style={{display:'block',marginTop:8,color:'#45617b',fontWeight:750}}>
              Saved this month: {show(savedTotals[head.key])}
            </small>
            {head.key!=='misc'&&<div style={{marginTop:9}}>
              {editingTotal?.key===head.key
                ?<div style={{display:'grid',gap:7,padding:10,borderRadius:9,background:'#f0f6ff'}}>
                  <label style={{fontSize:11,color:'#365574',fontWeight:850}}>EDIT SAVED MONTHLY TOTAL</label>
                  <input type="number" step=".01" min="0" max="999999999"
                    aria-label={'Edit saved '+head.line+' total'} value={editingTotal.amount}
                    disabled={totalEditBusy}
                    onChange={e=>setEditingTotal(previous=>({...previous,amount:e.target.value}))}
                    style={{...input,width:'100%'}}/>
                  <div style={{display:'flex',gap:7}}>
                    <button type="button" disabled={totalEditBusy}
                      onClick={()=>void saveTotalEdit()}
                      style={{flex:1,border:0,borderRadius:8,background:'#2056a1',color:'#fff',
                        padding:'9px 8px',fontSize:12,fontWeight:850}}>
                      {totalEditBusy?'SAVING…':'SAVE CHANGES'}
                    </button>
                    <button type="button" disabled={totalEditBusy}
                      onClick={()=>{setEditingTotal(null);setNote('');}}
                      style={{border:'1px solid #c3d3e5',borderRadius:8,
                        padding:'9px 8px',fontSize:12,fontWeight:850}}>CANCEL</button>
                  </div>
                </div>
                :<button type="button" disabled={loading||Boolean(editingTotal)||totalEditBusy}
                  onClick={()=>beginTotalEdit(head.key)}
                  style={{border:'1px solid #bfd0ea',background:'#eef4ff',
                    borderRadius:8,padding:'8px 10px',width:'100%',
                    color:'#174b87',fontSize:12,fontWeight:800}}>EDIT SAVED TOTAL</button>}
            </div>}
            {dirty[head.key]&&<small style={{display:'block',marginTop:7,color:'#a16207',fontWeight:750}}>Unsaved changes</small>}
          </div>)}
        </div>
        <p style={{fontSize:12,color:'#64748b',margin:'11px 0 7px'}}>
          Previously saved Miscellaneous (before Remarks) is now editable too.
          New itemized entries and older saved amounts are never counted twice.
        </p>
        <div style={{...card,marginTop:12,padding:0,overflow:'hidden'}} aria-label="Saved Miscellaneous entries">
          <h3 style={{padding:'12px 14px',margin:0,background:'#f0f5fc',fontSize:14,color:'#1d4678'}}>
            SAVED MISCELLANEOUS ENTRIES • {caption}
          </h3>
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse',minWidth:660}}>
              <thead><tr style={{background:'#fafcff'}}>
                <th style={{...td,textAlign:'left'}}>Remarks</th>
                <th style={{...td,textAlign:'right'}}>Amount (₹)</th>
                <th style={{...td,textAlign:'right'}}>Saved On (IST)</th>
                <th style={{...td,textAlign:'right'}}>Actions</th>
              </tr></thead>
              <tbody>
                {listedMiscEntries.map(entry=><tr key={entry.id} style={{background:editingMisc?.id===entry.id?'#f1f6ff':'#fff'}}>
                  <td style={td}>{editingMisc?.id===entry.id
                    ?<input type="text" aria-label={'Edit Remarks for '+entry.remarks}
                      maxLength={120} value={editingMisc.remarks} disabled={miscEditBusy}
                      onChange={e=>setEditingMisc(previous=>({...previous,remarks:e.target.value}))}
                      style={{...input,width:'100%',minWidth:170}}/>
                    :entry.remarks}</td>
                  <td style={{...td,textAlign:'right',fontWeight:800}}>
                    {editingMisc?.id===entry.id
                      ?<input type="number" min="0" step=".01" max="999999999"
                        aria-label={'Edit Amount for '+entry.remarks}
                        value={editingMisc.amount} disabled={miscEditBusy}
                        onChange={e=>setEditingMisc(previous=>({...previous,amount:e.target.value}))}
                        style={{...input,width:125,minWidth:105}}/>
                      :show(entry.amount)}
                  </td>
                  <td style={{...td,textAlign:'right',color:'#5e7188',fontSize:12}}>
                    {entry.legacy?'Before Remarks':entry.createdAt?new Date(entry.createdAt).toLocaleString('en-IN',{
                      timeZone:'Asia/Kolkata',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'
                    }):'—'}
                  </td>
                  <td style={{...td,textAlign:'right',whiteSpace:'nowrap'}}>
                    {editingMisc?.id===entry.id
                      ?<div style={{display:'flex',gap:7,justifyContent:'flex-end'}}>
                        <button type="button" disabled={miscEditBusy} onClick={()=>void saveMiscEdit()}
                          style={{border:0,borderRadius:8,background:'#2056a1',color:'#fff',
                            padding:'9px 12px',fontWeight:800,cursor:'pointer'}}>
                          {miscEditBusy?'SAVING…':'SAVE CHANGES'}
                        </button>
                        <button type="button" disabled={miscEditBusy} onClick={()=>{setEditingMisc(null);setNote('');}}
                          style={{border:'1px solid #d7e1ee',borderRadius:8,background:'#f4f6fa',
                            padding:'9px 12px',fontWeight:800,cursor:'pointer'}}>CANCEL</button>
                      </div>
                      :<button type="button" disabled={miscEditBusy||loading||Boolean(editingMisc)}
                        aria-label={'Edit Miscellaneous entry '+entry.remarks}
                        onClick={()=>beginMiscEdit(entry)}
                        style={{border:0,borderRadius:8,background:'#e6effe',color:'#174b87',
                          padding:'9px 13px',fontWeight:800,cursor:'pointer'}}>EDIT</button>}
                  </td>
                </tr>)}

                {!listedMiscEntries.length&&savedTotals.misc===0&&<tr>
                  <td colSpan={4} style={{...td,color:'#64748b',textAlign:'center'}}>
                    No Miscellaneous expenses saved for this month.
                  </td>
                </tr>}
              </tbody>
              <tfoot><tr style={{background:'#eef4fc',fontWeight:900}}>
                <td style={td}>MISCELLANEOUS TOTAL</td>
                <td style={{...td,textAlign:'right'}}>{show(savedTotals.misc)}</td>
                <td style={td}></td><td style={td}></td>
              </tr></tfoot>
            </table>
          </div>
        </div>
      </section>
      {loading&&!record&&<div style={card}>Loading monthly figures…</div>}
      {record&&metrics&&<>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:12,marginBottom:17}}>
          {[['TOTAL INCOME',metrics.totalIncome,'#1e4e87'],['TOTAL EXPENSES',metrics.totalExpenses,'#9a3412'],
            ['FINAL PROFIT',metrics.finalProfit,metrics.finalProfit<0?'#b91c1c':'#167144']].map(([label,value,color])=>
            <div key={label} style={card}><small style={{fontWeight:900,color:'#546b87'}}>{label}</small>
              <div style={{fontSize:23,fontWeight:900,color,marginTop:6,wordBreak:'break-word'}}>{show(value)}</div>
              <small style={{color:'#6b7f94'}}>{caption}</small></div>)}
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,430px),1fr))',gap:14}}>
          <ItemsTable title="INCOME" items={income} total={metrics.totalIncome} color="#e5f5eb"/>
          <ItemsTable title="EXPENSES" items={expenses} total={metrics.totalExpenses} color="#fff0df"/>
        </div>
        <div style={{...card,marginTop:16,background:metrics.finalProfit<0?'#fff1f2':'#eefaf3',
          display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:12}}>
          <strong style={{fontSize:16}}>FINAL PROFIT = TOTAL INCOME − TOTAL EXPENSES</strong>
          <strong style={{fontSize:24,color:metrics.finalProfit<0?'#b91c1c':'#166534'}}>{show(metrics.finalProfit)}</strong>
        </div>
        <p style={{fontSize:12,color:'#60738a',lineHeight:1.7}}>
          Jind and Karnal income matches their Amount Paid to Branch (including the Branch share of Extra Cost), not Total Booking Amount. Import Gross Profit is calculated as the Import Profit Sheet Gross Profit plus a further Protein handling and Clothes SIIB deduction add-back, using each completed physical-part row once. The Profit Sheet Gross Profit already contains one add-back of these deductions; the additional add-back in Monthly Expenses is applied as requested. The 15% Goods Charge is added separately, excluding HH ₹340/bag. Export uses the current Export Profit Sheet Profit total. Salary expense is Cash Paid + Account Paid, once each. Rent, Office Expenses, Rooms Expenses and Miscellaneous are independently saved and accumulated by month. Their entry boxes clear after a verified save. Import/Export totals match the unfiltered monthly Profit Sheets. Speed Post Net Profit is automatically included in Total Income for the same month, using the saved EMS entry dates. Its Tariff, Cash Cost and Packing/Transportation have already been deducted within Speed Post, so they are not subtracted again here.
        </p>
        {record.source.speedPost?.missing>0&&
          <p style={{padding:11,borderRadius:9,background:'#fff6df',color:'#7c5300',fontSize:12,fontWeight:750}}>
            Speed Post Net Profit includes {record.source.speedPost.complete} of {record.source.speedPost.packets} entries.
            {record.source.speedPost.missing} entries are pending a verified weight, tariff, or destination selling rate and are excluded until complete.
          </p>}
        {(record.source.import.completed<record.source.import.totalRows||record.source.export.completed<record.source.export.totalRows)&&
          <p style={{padding:11,borderRadius:9,background:'#fff6df',color:'#7c5300',fontSize:12,fontWeight:750}}>
            Some Profit Sheet rows are missing required inputs: Import {record.source.import.completed}/{record.source.import.totalRows}, Export {record.source.export.completed}/{record.source.export.totalRows}.
          </p>}
      </>}
    </div>
  </main>;
}
