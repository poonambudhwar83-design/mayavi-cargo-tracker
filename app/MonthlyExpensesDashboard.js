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
        {items.map(item=><tr key={item.label}><td style={{...td,color:'#314d70'}}>{item.label}</td>
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
const initialExpenses={rent:'0',office:'0',rooms:'0',misc:'0'};
export default function MonthlyExpensesDashboard(){
  const [month,setMonth]=useState(monthNow);
  const [record,setRecord]=useState(null);
  const [drafts,setDrafts]=useState(initialExpenses);
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
      setDrafts({rent:String(values.rent),office:String(values.office),
        rooms:String(values.rooms),misc:String(values.misc)});
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
    if(Object.values(dirty).some(Boolean)||Object.values(busy).some(Boolean))return;
    const poll=()=>{if(document.visibilityState!=='hidden')void load()};
    const timer=setInterval(poll,90000);
    return()=>clearInterval(timer);
  },[load,dirty,busy]);
  const metrics=useMemo(()=>record?calculateMonthlyExpenses({...record.values,
    ...Object.fromEntries(expenseHeads.map(head=>[head.key,Number(drafts[head.key]||0)]))
  }):null,[record,drafts]);
  function changeExpense(key,value){
    setDrafts(previous=>({...previous,[key]:value}));
    setDirty(previous=>({...previous,[key]:true}));
    setSaved(previous=>({...previous,[key]:false}));
  }
  async function saveExpense(key){
    if(busy[key]||loading||!month)return;
    const raw=String(drafts[key]??'').trim();
    if(raw===''||!/^\d+(?:\.\d{1,2})?$/.test(raw)||Number(raw)>999999999){
      setNote('Enter a valid non-negative amount for '+expenseHeads.find(x=>x.key===key)?.line+' (up to 2 decimals).');
      return;
    }
    setBusy(previous=>({...previous,[key]:true}));setNote('');
    try{
      const res=await fetch('/api/monthly-expenses',{method:'PATCH',credentials:'include',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({month,field:key,value:raw})});
      const result=await res.json();
      if(!res.ok||!result.ok)throw new Error(result.error||'Save failed.');
      const verifiedResponse=await fetch('/api/monthly-expenses?month='+encodeURIComponent(month)+'&view=expenses',
        {credentials:'include',cache:'no-store'});
      const verified=await verifiedResponse.json();
      if(!verifiedResponse.ok||!verified.ok||!verified.savedFields?.[key]||
        Number(verified[key])!==Number(result.value))
        throw new Error('Could not confirm saved '+key+' amount in database.');
      setDrafts(previous=>({...previous,[key]:String(result.value)}));
      setDirty(previous=>({...previous,[key]:false}));
      setSaved(previous=>({...previous,[key]:true}));
      setRecord(previous=>previous?{...previous,values:{...previous.values,[key]:result.value}}:previous);
      setNote('✓ SAVED TO DATABASE • '+expenseHeads.find(x=>x.key===key)?.line+': '+show(result.value));
    }catch(error){
      setSaved(previous=>({...previous,[key]:false}));
      setNote('Not saved: '+(error.message||'Unable to save the expense.'));
    }finally{setBusy(previous=>({...previous,[key]:false}));}
  }
  const income=record?[{label:'Import Gross Profit',value:record.values.importGross},
    {label:'Export Gross Profit (Export Profit Sheet total)',value:record.values.exportGross},
    {label:'Jind Branch — Amount Paid to Branch',value:record.values.jind},
    {label:'Karnal Branch — Amount Paid to Branch',value:record.values.karnal},
    {label:'Import — 15% Goods Charge Total',value:record.values.goods15}]:[];
  const expenses=record?[{label:'Salary — Cash Paid',value:record.values.salaryCash},
    {label:'Salary — Account Paid',value:record.values.salaryAccount},
    ...expenseHeads.map(head=>({label:head.line,value:Number(drafts[head.key]||0)}))]:[];
  const caption=new Date(Number(month.slice(0,4)),Number(month.slice(5))-1,1).toLocaleDateString('en-IN',{month:'long',year:'numeric'});
  return <main style={{background:'#f5f8fc',minHeight:'75vh',padding:'22px clamp(12px,3vw,32px)',color:'#183153'}}>
    <div style={{maxWidth:1140,margin:'auto'}}>
      <div style={{display:'flex',justifyContent:'space-between',gap:16,alignItems:'center',flexWrap:'wrap',marginBottom:18}}>
        <div><small style={{color:'#436899',fontWeight:900}}>MAYAVI • ADMIN ONLY</small>
          <h1 style={{margin:'7px 0 4px',fontSize:27}}>Monthly Expenses & Profit</h1>
          <p style={{margin:0,color:'#5d7189'}}>Income from existing Mayavi sheets minus Salary, Rent, Office, Rooms and Misc expenses.</p>
        </div>
        <label style={{display:'grid',gap:5,fontWeight:900,fontSize:12}}>SELECT MONTH
          <input type="month" min="2026-10" max={monthNow()} value={month}
            onChange={e=>{setMonth(e.target.value);setRecord(null);setDirty({});setSaved({});setBusy({});}}
            style={{...input,fontWeight:800}}/>
        </label>
      </div>
      {note&&<div role="status" style={{padding:12,background:'#e8f0fd',color:'#1e4b82',borderRadius:10,marginBottom:15,fontWeight:750,fontSize:13}}>{note}</div>}
      <section style={{marginBottom:16}}>
        <h2 style={{margin:'0 0 9px',fontSize:17}}>Monthly Expense Entries — {caption}</h2>
        <p style={{fontSize:12,color:'#64748b',margin:'0 0 12px'}}>Each expense has its own SAVE button and is stored separately by month. Changing one amount will not overwrite another.</p>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(225px,1fr))',gap:12}}>
          {expenseHeads.map(head=><div key={head.key} style={card}>
            <label htmlFor={'monthly-expense-'+head.key} style={{fontSize:12,fontWeight:900,color:'#365574'}}>{head.label}</label>
            <input id={'monthly-expense-'+head.key} type="number" min="0" max="999999999" step=".01"
              aria-label={'Monthly '+head.line} value={drafts[head.key]}
              disabled={loading||Boolean(busy[head.key])}
              onChange={e=>changeExpense(head.key,e.target.value)}
              style={{...input,display:'block',width:'100%',margin:'9px 0'}}/>
            <button type="button" disabled={loading||Boolean(busy[head.key])||!month}
              onClick={()=>void saveExpense(head.key)}
              style={{border:0,borderRadius:9,width:'100%',background:saved[head.key]?'#15803d':'#2056a1',
                color:'#fff',fontWeight:900,cursor:'pointer',fontSize:13,padding:'11px 14px'}}>
              {busy[head.key]?'SAVING…':saved[head.key]?'✓ SAVED':'SAVE'}
            </button>
            {dirty[head.key]&&<small style={{display:'block',marginTop:7,color:'#a16207',fontWeight:750}}>Unsaved changes</small>}
          </div>)}
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
          Jind and Karnal income matches their Amount Paid to Branch (including the Branch share of Extra Cost), not Total Booking Amount. Import Gross Profit sums completed Import rows; the 15% Goods Charge is added separately, excluding HH ₹340/bag. Export uses the current Export Profit Sheet Profit total. Salary expense is Cash Paid + Account Paid, once each. Rent, Office Expenses, Rooms Expenses and Miscellaneous are independently saved by month. Import/Export totals match the unfiltered monthly Profit Sheets.
        </p>
        {(record.source.import.completed<record.source.import.totalRows||record.source.export.completed<record.source.export.totalRows)&&
          <p style={{padding:11,borderRadius:9,background:'#fff6df',color:'#7c5300',fontSize:12,fontWeight:750}}>
            Some Profit Sheet rows are missing required inputs: Import {record.source.import.completed}/{record.source.import.totalRows}, Export {record.source.export.completed}/{record.source.export.totalRows}.
          </p>}
      </>}
    </div>
  </main>;
}
