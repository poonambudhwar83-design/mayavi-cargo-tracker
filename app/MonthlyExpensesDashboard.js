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
export default function MonthlyExpensesDashboard(){
  const [month,setMonth]=useState(monthNow);
  const [record,setRecord]=useState(null);
  const [rent,setRent]=useState('0');
  const [office,setOffice]=useState('0');
  const [changed,setChanged]=useState(false);
  const [saved,setSaved]=useState(false);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [note,setNote]=useState('');
  const load=useCallback(async ()=>{
    setLoading(true);
    try{
      // Expense inputs load separately, so Rent can always be saved even if
      // the Import, Export or Salary profit feeds are temporarily unavailable.
      const expensesResponse=await fetch('/api/monthly-expenses?month='+encodeURIComponent(month)+'&view=expenses',
        {cache:'no-store',credentials:'include'});
      const expenses=await expensesResponse.json();
      if(!expensesResponse.ok||!expenses.ok)
        throw new Error(expenses.error||'Unable to load saved Rent and Office Expenses.');
      setRent(String(expenses.rent));setOffice(String(expenses.office));
      setSaved(Boolean(expenses.updatedAt));setChanged(false);
      try{
        const response=await fetch('/api/monthly-expenses?month='+encodeURIComponent(month),
          {cache:'no-store',credentials:'include'});
        const data=await response.json();
        if(!response.ok||!data.ok)throw new Error(data.error||'Unable to load profit figures.');
        setRecord(data);setNote('');
      }catch(error){
        setRecord(null);
        setNote('Rent and Office Expenses are available to edit. Profit totals could not be loaded: '+(error.message||error));
      }
    }catch(error){setRecord(null);setNote(error.message||'Unable to load monthly expense details.');}
    finally{setLoading(false);}
  },[month]);
  useEffect(()=>{void load()},[load]);
  useEffect(()=>{
    if(changed||busy)return;
    const poll=()=>{if(document.visibilityState!=='hidden')void load()};
    const timer=setInterval(poll,90000);
    return()=>clearInterval(timer);
  },[load,changed,busy]);
  const metrics=useMemo(()=>record?calculateMonthlyExpenses({...record.values,
    rent:rent===''?NaN:Number(rent),office:office===''?NaN:Number(office)}):null,[record,rent,office]);
  async function save(){
    if(busy||!month)return;
    if(rent.trim()===''||office.trim()===''||Number(rent)<0||Number(office)<0){
      setNote('Enter a valid Rent and Office Expenses amount. Use 0 if there is no expense.');
      return;
    }
    setBusy(true);setNote('');
    try{
      const res=await fetch('/api/monthly-expenses',{method:'PATCH',credentials:'include',
        headers:{'content-type':'application/json'},body:JSON.stringify({month,rent,office})});
      const result=await res.json();
      if(!res.ok||!result.ok)throw new Error(result.error||'Could not save expenses.');
      // Read the saved values back from Neon, independently of Income feeds.
      const verifyResponse=await fetch('/api/monthly-expenses?month='+encodeURIComponent(month)+'&view=expenses',
        {cache:'no-store',credentials:'include'});
      const verified=await verifyResponse.json();
      if(!verifyResponse.ok||!verified.ok)throw new Error(verified.error||'Could not verify saved Rent.');
      if(Number(verified.rent)!==Number(result.rent)||Number(verified.office)!==Number(result.office))
        throw new Error('Saved values are not confirmed. Please try again.');
      setRent(String(verified.rent));setOffice(String(verified.office));
      setRecord(previous=>previous?{...previous,values:{...previous.values,
        rent:verified.rent,office:verified.office},updatedAt:verified.updatedAt}:previous);
      setSaved(true);setChanged(false);
      setNote('✓ SAVED TO DATABASE • Rent: '+show(verified.rent)+' • Office Expenses: '+show(verified.office));
    }catch(error){setSaved(false);setNote(error.message||'Could not save monthly expenses.');}
    finally{setBusy(false);}
  }
  const income=record?[{label:'Import Gross Profit',value:record.values.importGross},
    {label:'Export Gross Profit (Export Profit Sheet total)',value:record.values.exportGross},
    {label:'Jind Branch — Total Booking Amount',value:record.values.jind},
    {label:'Karnal Branch — Total Booking Amount',value:record.values.karnal},
    {label:'Import — 15% Goods Charge Total',value:record.values.goods15}]:[];
  const expenses=record?[{label:'Salary — Cash Paid',value:record.values.salaryCash},
    {label:'Salary — Account Paid',value:record.values.salaryAccount},
    {label:'Rent',value:Number(rent)||0},{label:'Office Expenses',value:Number(office)||0}]:[];
  const caption=new Date(Number(month.slice(0,4)),Number(month.slice(5))-1,1).toLocaleDateString('en-IN',{month:'long',year:'numeric'});
  return <main style={{background:'#f5f8fc',minHeight:'75vh',padding:'22px clamp(12px,3vw,32px)',color:'#183153'}}>
    <div style={{maxWidth:1140,margin:'auto'}}>
      <div style={{display:'flex',justifyContent:'space-between',gap:16,alignItems:'center',flexWrap:'wrap',marginBottom:18}}>
        <div><small style={{color:'#436899',fontWeight:900}}>MAYAVI • ADMIN ONLY</small>
          <h1 style={{margin:'7px 0 4px',fontSize:27}}>Monthly Expenses & Profit</h1>
          <p style={{margin:0,color:'#5d7189'}}>Income from existing Mayavi sheets minus monthly salary payments, rent and office expenses.</p>
        </div>
        <label style={{display:'grid',gap:5,fontWeight:900,fontSize:12}}>SELECT MONTH
          <input type="month" min="2026-10" max={monthNow()} value={month}
            onChange={e=>{setMonth(e.target.value);setRecord(null);setChanged(false);setSaved(false);}}
            style={{...input,fontWeight:800}}/>
        </label>
      </div>
      {note&&<div role="status" style={{padding:12,background:'#e8f0fd',color:'#1e4b82',borderRadius:10,marginBottom:15,fontWeight:750,fontSize:13}}>{note}</div>}
      <section style={{...card,marginBottom:16}}>
        <h2 style={{margin:'0 0 7px',fontSize:17}}>Enter Monthly Expenses — {caption}</h2>
        <p style={{margin:'0 0 14px',color:'#536d87',fontSize:13}}>Enter Rent and Office Expenses here, then click SAVE. Amounts update the profit calculation instantly and are stored separately for each month.</p>
        <div style={{display:'flex',gap:12,flexWrap:'wrap',alignItems:'end'}}>
          <label style={{display:'grid',gap:5,fontSize:12,fontWeight:800}}>RENT (₹)
            <input type="number" aria-label="Monthly Rent" min="0" max="999999999" step=".01" value={rent}
              onChange={e=>{setRent(e.target.value);setChanged(true);setSaved(false);}} style={input}/>
          </label>
          <label style={{display:'grid',gap:5,fontSize:12,fontWeight:800}}>OFFICE EXPENSES (₹)
            <input type="number" aria-label="Monthly Office Expenses" min="0" max="999999999" step=".01" value={office}
              onChange={e=>{setOffice(e.target.value);setChanged(true);setSaved(false);}} style={input}/>
          </label>
          <button type="button" disabled={busy||loading||!month} onClick={()=>void save()}
            style={{border:0,borderRadius:9,background:saved?'#15803d':'#2056a1',color:'#fff',cursor:'pointer',fontSize:13,fontWeight:900,padding:'11px 18px',minHeight:42}}>
            {busy?'SAVING…':saved?'✓ SAVED':'SAVE RENT & OFFICE EXPENSES'}
          </button>
        </div>
        {changed&&<small style={{display:'block',marginTop:9,color:'#9a3412',fontWeight:800}}>Unsaved changes — click SAVE to store these amounts for {caption}.</small>}
      </section>
      {loading&&!record&&<div style={card}>Loading monthly figures…</div>}
      {record&&metrics&&<>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:12,marginBottom:17}}>
          {[['TOTAL INCOME',metrics.totalIncome,'#1e4e87'],['TOTAL EXPENSES',metrics.totalExpenses,'#9a3412'],['FINAL PROFIT',metrics.finalProfit,metrics.finalProfit<0?'#b91c1c':'#167144']].map(([label,value,color])=>
            <div key={label} style={card}><small style={{fontWeight:900,color:'#546b87'}}>{label}</small>
              <div style={{fontSize:23,fontWeight:900,color,marginTop:6,wordBreak:'break-word'}}>{show(value)}</div>
              <small style={{color:'#6b7f94'}}>{caption}</small></div>)}
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,430px),1fr))',gap:14}}>
          <ItemsTable title="INCOME" items={income} total={metrics.totalIncome} color="#e5f5eb"/>
          <ItemsTable title="EXPENSES" items={expenses} total={metrics.totalExpenses} color="#fff0df"/>
        </div>

        <div style={{...card,marginTop:16,background:metrics.finalProfit<0?'#fff1f2':'#eefaf3',display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:12}}>
          <strong style={{fontSize:16}}>FINAL PROFIT = TOTAL INCOME − TOTAL EXPENSES</strong>
          <strong style={{fontSize:24,color:metrics.finalProfit<0?'#b91c1c':'#166534'}}>{show(metrics.finalProfit)}</strong>
        </div>
        <p style={{fontSize:12,color:'#60738a',lineHeight:1.7}}>
          Import Gross Profit sums only completed Import Profit rows; the 15% Goods Charge is added separately, exactly as requested, and excludes ordinary HH ₹340/bag. Export uses the current Export Profit Sheet Profit total (there is no separate Export Gross Profit column). Branch amounts are monthly booking amounts (Weight × Rate), not branch net profit. Salary expense is Cash Paid + Account Paid, once each; monthly budgeted salary ({show(record.values.salaryBudget)}) is informational and is not deducted again. Rent and Office Expenses are saved by month. Import/Export totals match the original sheets' unfiltered monthly values, excluding incomplete profit rows.
        </p>
        {(record.source.import.completed<record.source.import.totalRows||record.source.export.completed<record.source.export.totalRows)&&
          <p style={{padding:11,borderRadius:9,background:'#fff6df',color:'#7c5300',fontSize:12,fontWeight:750}}>
            Some Profit Sheet rows are missing required inputs and are not included in Gross Profit totals: Import {record.source.import.completed}/{record.source.import.totalRows}, Export {record.source.export.completed}/{record.source.export.totalRows}.
          </p>}
      </>}
    </div>
  </main>;
}
