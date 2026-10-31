'use client';

import {useCallback,useEffect,useMemo,useState} from 'react';

const API='/api/branch-profit';
const todayIST=()=>new Date(Date.now()+330*60000).toISOString().slice(0,10);
const thisMonth=todayIST().slice(0,7);
const branches=['JIND','KARNAL'];
const heads=[['RENT','Rent'],['ELECTRICITY','Electricity'],['PETROL','Petrol (daily)'],['PAPER','Paper'],['STATIONERY','Stationery'],['MISC','Miscellaneous']];
const allHeads=[['SALARY','Salary'],...heads];
const labels=Object.fromEntries(allHeads);
const rupees=n=>'₹'+Number(n||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
const blankWorker=()=>({name:'',amount:''});
const blankDraft=()=>({branch:'JIND',date:todayIST(),category:'RENT',description:'',amount:''});
const card={border:'1px solid #dbe5f2',borderRadius:14,background:'#fff',padding:16,boxShadow:'0 3px 12px #19304f09'};
const field={minHeight:39,padding:'8px 10px',border:'1px solid #cad7e9',borderRadius:8,background:'#fff',color:'#172b4d',fontSize:14,width:'100%',boxSizing:'border-box'};
const action={padding:'9px 14px',borderRadius:8,border:'none',background:'#244cc5',color:'#fff',fontWeight:700,cursor:'pointer'};
const columns={display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:12};
const th={padding:'11px 10px',background:'#eef3fb',textAlign:'left',fontSize:12,color:'#284064',whiteSpace:'nowrap'};
const td={padding:'10px',borderBottom:'1px solid #e9eff7',verticalAlign:'middle',fontSize:13};
const sum=(values)=>Math.round(values.reduce((t,n)=>t+Number(n||0),0)*100)/100;

export default function BranchProfitDashboard(){
  const [month,setMonth]=useState(thisMonth);
  const [filter,setFilter]=useState('ALL');
  const [data,setData]=useState({incomes:{JIND:0,KARNAL:0},expenses:[]});
  const [workers,setWorkers]=useState(Array.from({length:4},blankWorker));
  const [draft,setDraft]=useState(blankDraft);
  const [editing,setEditing]=useState('');
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');

  const load=useCallback(async()=>{
    setLoading(true);
    try{
      const response=await fetch(API+'?month='+encodeURIComponent(month),{credentials:'include',cache:'no-store'});
      const result=await response.json();
      if(!response.ok||!result.ok)throw new Error(result.error||'Unable to load branch finances.');
      setData({incomes:result.incomes||{},expenses:result.expenses||[]});
    }catch(error){setMessage('Unable to refresh: '+(error?.message||error));}
    finally{setLoading(false);}
  },[month]);
  useEffect(()=>{void load()},[load]);
  useEffect(()=>{setDraft(d=>({...d,date:month===thisMonth?todayIST():month+'-01'}));setEditing('');},[month]);

  const report=useMemo(()=>{
    const byBranch={};
    for(const branch of branches){
      const entries=data.expenses.filter(e=>e.branch===branch);
      const byHead=Object.fromEntries(allHeads.map(([key])=>[key,sum(entries.filter(e=>e.category===key).map(e=>e.amount))]));
      const income=Number(data.incomes[branch]||0);
      const expense=sum(Object.values(byHead));
      byBranch[branch]={income,expense,profit:Math.round((income-expense)*100)/100,byHead};
    }
    return byBranch;
  },[data]);

  const selected=filter==='ALL'?branches:[filter];
  const totals={income:sum(selected.map(b=>report[b].income)),
    expense:sum(selected.map(b=>report[b].expense)),
    profit:sum(selected.map(b=>report[b].profit))};
  const visibleExpenses=data.expenses.filter(e=>filter==='ALL'||e.branch===filter);
  const headTotals=Object.fromEntries(allHeads.map(([h])=>[h,sum(selected.map(b=>report[b].byHead[h]))]));

  async function write(entry,method='POST'){
    if(!String(entry.date||'').startsWith(month)){setMessage('Expense date must be in the selected month.');return false;}
    setBusy(true);setMessage('');
    try{
      const response=await fetch(API,{method,credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(entry)});
      const result=await response.json();
      if(!response.ok||!result.ok)throw new Error(result.error||'Save failed.');
      await load();
      setMessage(method==='PATCH'?'Expense updated successfully.':'Expense saved successfully.');
      return true;
    }catch(error){setMessage('Not saved: '+(error?.message||error));return false;}
    finally{setBusy(false);}
  }
  async function saveWorker(index){
    const worker=workers[index];
    if(!worker.name.trim()||!worker.amount){setMessage('Enter the worker name and monthly salary.');return;}
    const branch=draft.branch;
    const ok=await write({branch,date:month+'-01',category:'SALARY',description:worker.name,amount:worker.amount});
    if(ok)setWorkers(previous=>previous.map((w,i)=>i===index?blankWorker():w));
  }
  async function saveExpense(event){
    event.preventDefault();
    const ok=await write({...draft,id:editing||undefined},editing?'PATCH':'POST');
    if(ok){setEditing('');setDraft(previous=>({...blankDraft(),branch:previous.branch,date:month===thisMonth?todayIST():month+'-01'}));}
  }
  function beginEdit(entry){
    setEditing(entry.id);
    setDraft({branch:entry.branch,date:entry.date,category:entry.category,description:entry.description,amount:String(entry.amount)});
    document.getElementById('branch-finance-expense-form')?.scrollIntoView({behavior:'smooth',block:'center'});
  }
  async function remove(entry){
    if(!window.confirm('Delete this saved '+(labels[entry.category]||entry.category)+' expense?'))return;
    setBusy(true);setMessage('');
    try{
      const response=await fetch(API+'?id='+encodeURIComponent(entry.id),{method:'DELETE',credentials:'include'});
      const result=await response.json();
      if(!response.ok||!result.ok)throw new Error(result.error||'Delete failed.');
      await load();setMessage('Expense deleted.');
      if(editing===entry.id){setEditing('');setDraft(blankDraft());}
    }catch(error){setMessage('Not deleted: '+(error?.message||error));}
    finally{setBusy(false);}
  }
  const monthlySalaryWorkers=data.expenses.filter(e=>e.category==='SALARY'&&e.branch===draft.branch).length;
  return <section style={{display:'grid',gap:18,color:'#243450'}}>
    <header style={{...card,background:'linear-gradient(115deg,#f0f5ff,#fff7eb)'}}>
      <small style={{fontWeight:800,letterSpacing:1,color:'#45679e'}}>MAYAVI • CONFIDENTIAL • MAIN ADMIN ONLY</small>
      <h2 style={{margin:'7px 0'}}>Jind &amp; Karnal — Branch Profit &amp; Loss</h2>
      <p style={{margin:'4px 0 16px',fontSize:13}}>Branch income is automatically calculated from <b>Amount Paid to Branch</b> for all booked loads (Active + Delivered). Salary, rent and day-to-day costs are deducted. This is booked profit, not a cash-receipts statement.</p>
      <div style={{...columns,alignItems:'end'}}>
        <label style={{fontSize:13,fontWeight:700}}>Month
          <input type="month" min="2026-10" max={thisMonth} value={month} style={{...field,marginTop:5}} onChange={e=>setMonth(e.target.value)}/>
        </label>
        <label style={{fontSize:13,fontWeight:700}}>Branch
          <select aria-label="Profit branch filter" style={{...field,marginTop:5}} value={filter} onChange={e=>setFilter(e.target.value)}>
            <option value="ALL">Both branches (combined)</option><option value="JIND">Jind only</option><option value="KARNAL">Karnal only</option>
          </select>
        </label>
        <button type="button" style={action} onClick={()=>void load()} disabled={loading||busy}>{loading?'Refreshing…':'Refresh live figures'}</button>
      </div>
    </header>
    <div style={columns} aria-label="Monthly branch profit totals">
      <div style={card}><small style={{fontWeight:800,color:'#526783'}}>TOTAL INCOME • PAID TO BRANCH</small><h2 style={{margin:'8px 0'}}>{rupees(totals.income)}</h2></div>
      <div style={card}><small style={{fontWeight:800,color:'#526783'}}>TOTAL BRANCH EXPENSES</small><h2 style={{margin:'8px 0'}}>{rupees(totals.expense)}</h2></div>
      <div style={card}><small style={{fontWeight:800,color:'#526783'}}>NET BRANCH {totals.profit<0?'LOSS':'PROFIT'}</small><h2 style={{margin:'8px 0',color:totals.profit<0?'#bd263c':'#137a51'}}>{rupees(totals.profit)}</h2><small>{totals.income>=totals.expense?'Income covers recorded expenses':'Recorded expenses exceed booked income'}</small></div>
    </div>
    {message&&<p role="status" aria-live="polite" style={{padding:'12px 14px',margin:0,borderRadius:9,background:'#edf3ff',fontWeight:600}}>{message}</p>}
    <section style={card}>
      <h3 style={{margin:'0 0 12px'}}>Monthly performance • {filter==='ALL'?'Both branches':filter}</h3>
      <div style={{overflowX:'auto'}}><table style={{borderCollapse:'collapse',width:'100%',minWidth:850}}>
        <thead><tr>{['Branch','Income • Paid to Branch','Salary','Rent','Electricity','Other running costs','Total Expenses','Net Profit / Loss'].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead>
        <tbody>
          {selected.map(b=><tr key={b}>
            <td style={td}><b>{b}</b></td><td style={td}>{rupees(report[b].income)}</td><td style={td}>{rupees(report[b].byHead.SALARY)}</td>
            <td style={td}>{rupees(report[b].byHead.RENT)}</td><td style={td}>{rupees(report[b].byHead.ELECTRICITY)}</td>
            <td style={td}>{rupees(sum(['PETROL','PAPER','STATIONERY','MISC'].map(h=>report[b].byHead[h])))}</td>
            <td style={td}>{rupees(report[b].expense)}</td><td style={{...td,color:report[b].profit<0?'#bd263c':'#147853',fontWeight:800}}>{rupees(report[b].profit)}</td>
          </tr>)}
        </tbody>
        {filter==='ALL'&&<tfoot><tr style={{background:'#f3f6fc',fontWeight:800}}>
          <td style={td}>COMBINED</td><td style={td}>{rupees(totals.income)}</td><td style={td}>{rupees(headTotals.SALARY)}</td>
          <td style={td}>{rupees(headTotals.RENT)}</td><td style={td}>{rupees(headTotals.ELECTRICITY)}</td>
          <td style={td}>{rupees(sum(['PETROL','PAPER','STATIONERY','MISC'].map(h=>headTotals[h])))}</td>
          <td style={td}>{rupees(totals.expense)}</td><td style={{...td,color:totals.profit<0?'#bd263c':'#137a51'}}>{rupees(totals.profit)}</td>
        </tr></tfoot>}
      </table></div>
      <p style={{margin:'12px 0 0',fontSize:12,color:'#64748b'}}>All expense categories are itemized below. Income uses booking date in the chosen month and includes undelivered loads.</p>
    </section>
    <section style={card}>
      <h3 style={{margin:'0 0 4px'}}>Staff salaries • 4 worker slots</h3>
      <p style={{margin:'4px 0 13px',fontSize:13}}>Choose an expense branch and save each worker's monthly salary once. Existing salary entries can be edited below. More worker slots can be added when staff increases.</p>
      <label style={{display:'inline-block',marginBottom:12,fontSize:13,fontWeight:700}}>Expense branch
        <select aria-label="Branch for expense entry" style={{...field,marginTop:5}} value={draft.branch} onChange={e=>setDraft(d=>({...d,branch:e.target.value}))}>
          {branches.map(b=><option key={b} value={b}>{b}</option>)}
        </select>
      </label>
      <p style={{fontSize:12,margin:'0 0 10px',color:'#526783'}}>Salary records already saved for {draft.branch} in {month}: {monthlySalaryWorkers}</p>
      {workers.map((worker,index)=><div key={index} style={{display:'grid',gridTemplateColumns:'minmax(120px,0.65fr) minmax(150px,1.5fr) minmax(120px,1fr) auto',gap:9,marginBottom:9,alignItems:'center'}}>
        <span style={{fontWeight:700,fontSize:13}}>Worker {index+1}</span>
        <input aria-label={'Worker '+(index+1)+' name'} placeholder="Employee name" value={worker.name} style={field} onChange={e=>setWorkers(prev=>prev.map((w,i)=>i===index?{...w,name:e.target.value}:w))}/>
        <input aria-label={'Worker '+(index+1)+' monthly salary'} type="number" min="0" step="0.01" placeholder="Monthly salary ₹" value={worker.amount} style={field} onChange={e=>setWorkers(prev=>prev.map((w,i)=>i===index?{...w,amount:e.target.value}:w))}/>
        <button type="button" disabled={busy} style={action} onClick={()=>void saveWorker(index)}>Save</button>
      </div>)}
      <button type="button" onClick={()=>setWorkers(previous=>[...previous,blankWorker()])} style={{...action,background:'#e7ecfa',color:'#28487d'}}>+ Add Worker</button>
    </section>
    <section id="branch-finance-expense-form" style={card}>
      <h3 style={{margin:'0 0 6px'}}>{editing?'Edit saved expense':'Add rent, electricity or miscellaneous expense'}</h3>
      <p style={{fontSize:13,margin:'0 0 15px'}}>Petrol, paper, stationery and other expenses can be entered daily with a description. Salary edits also use this form.</p>
      <form onSubmit={saveExpense} style={columns}>
        <label style={{fontSize:13,fontWeight:700}}>Branch<select value={draft.branch} style={{...field,marginTop:5}} onChange={e=>setDraft(d=>({...d,branch:e.target.value}))}>{branches.map(b=><option key={b}>{b}</option>)}</select></label>
        <label style={{fontSize:13,fontWeight:700}}>Expense date<input required type="date" min={month+'-01'} max={month===thisMonth?todayIST():month+'-31'} value={draft.date} style={{...field,marginTop:5}} onChange={e=>setDraft(d=>({...d,date:e.target.value}))}/></label>
        <label style={{fontSize:13,fontWeight:700}}>Expense head<select value={draft.category} style={{...field,marginTop:5}} onChange={e=>setDraft(d=>({...d,category:e.target.value}))}>{(editing?allHeads:heads).map(([key,label])=><option value={key} key={key}>{label}</option>)}</select></label>
        <label style={{fontSize:13,fontWeight:700}}>{draft.category==='SALARY'?'Worker name':'Details / Remarks'}<input style={{...field,marginTop:5}} maxLength={160} placeholder={draft.category==='SALARY'?'Worker name':'e.g. petrol, photocopies, office supplies'} value={draft.description} onChange={e=>setDraft(d=>({...d,description:e.target.value}))}/></label>
        <label style={{fontSize:13,fontWeight:700}}>Amount (₹)<input required type="number" min="0.01" step="0.01" value={draft.amount} style={{...field,marginTop:5}} onChange={e=>setDraft(d=>({...d,amount:e.target.value}))}/></label>
        <div style={{display:'flex',alignItems:'end',gap:8,flexWrap:'wrap'}}><button disabled={busy} type="submit" style={action}>{busy?'Saving…':editing?'Update Expense':'Save Expense'}</button>{editing&&<button type="button" style={{...action,background:'#e9edf5',color:'#284064'}} onClick={()=>{setEditing('');setDraft(d=>({...blankDraft(),branch:d.branch,date:month===thisMonth?todayIST():month+'-01'}));}}>Cancel</button>}</div>
      </form>
    </section>
    <section style={card}>
      <h3 style={{margin:'0 0 12px'}}>Expense register • {visibleExpenses.length} entries</h3>
      <div style={{overflowX:'auto'}}><table style={{borderCollapse:'collapse',width:'100%',minWidth:720}}>
        <thead><tr>{['Date','Branch','Expense Head','Worker / Remarks','Amount','Actions'].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead>
        <tbody>{visibleExpenses.map(e=><tr key={e.id}>
          <td style={td}>{e.date}</td><td style={td}>{e.branch}</td><td style={td}>{labels[e.category]||e.category}</td><td style={td}>{e.description||'—'}</td><td style={{...td,fontWeight:700}}>{rupees(e.amount)}</td>
          <td style={td}><button type="button" onClick={()=>beginEdit(e)} disabled={busy} style={{...action,padding:'6px 9px'}}>Edit</button>{' '}<button type="button" onClick={()=>void remove(e)} disabled={busy} style={{...action,padding:'6px 9px',background:'#b73045'}}>Delete</button></td>
        </tr>)}
        {!visibleExpenses.length&&<tr><td colSpan={6} style={td}>No expenses recorded for this branch and month.</td></tr>}</tbody>
      </table></div>
      <h4 style={{margin:'20px 0 8px'}}>Category-wise expense totals</h4>
      <div style={columns}>{allHeads.map(([h,label])=><div key={h} style={{background:'#f6f8fd',padding:12,borderRadius:9,fontSize:13}}>{label}<strong style={{display:'block',fontSize:17,marginTop:4}}>{rupees(headTotals[h])}</strong></div>)}</div>
    </section>
  </section>;
}
