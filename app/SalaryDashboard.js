'use client';
import {useCallback,useEffect,useMemo,useState} from 'react';
import {salaryRowTotals,salaryTotals,SALARY_COMPANIES} from '../lib/salaryMath.js';

const money=new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:2});
const input={width:'100%',minWidth:95,boxSizing:'border-box',padding:'8px 9px',border:'1px solid #c9d7e6',borderRadius:8,background:'#fff',fontSize:13,color:'#122139'};
const button={border:0,borderRadius:8,padding:'10px 14px',fontWeight:800,cursor:'pointer'};
const cell={padding:'8px 10px',borderBottom:'1px solid #e3eaf2',fontSize:13,whiteSpace:'nowrap'};
const show=value=>money.format(Number(value)||0);
const currentMonth=()=>{const today=new Date();return String(today.getFullYear())+'-'+String(today.getMonth()+1).padStart(2,'0');};
export default function SalaryDashboard(){
  const [month,setMonth]=useState(currentMonth);
  const [rows,setRows]=useState([]);
  const [drafts,setDrafts]=useState({});
  const [name,setName]=useState('');
  const [company,setCompany]=useState('');
  const [companyFilter,setCompanyFilter]=useState('');
  const [employeeSearch,setEmployeeSearch]=useState('');
  const [editing,setEditing]=useState(null);
  const [baseSalary,setBaseSalary]=useState('');
  const [busy,setBusy]=useState({});
  const [saved,setSaved]=useState({});
  const [adding,setAdding]=useState(false);
  const [loading,setLoading]=useState(true);
  const [message,setMessage]=useState('');
  const load=useCallback(async ()=>{
    setLoading(true);setMessage('');setDrafts({});setEditing(null);setSaved({});
    try{
      const res=await fetch('/api/salary?month='+encodeURIComponent(month),{cache:'no-store',credentials:'include'});
      const data=await res.json();
      if(!res.ok||!data.ok)throw new Error(data.error||'Unable to load salary details.');
      setRows(data.rows||[]);
      setSaved(Object.fromEntries((data.rows||[]).filter(row=>row.updatedAt).map(row=>[row.id,true])));
    }catch(error){setRows([]);setMessage(error.message||'Could not load Salary page.');}
    finally{setLoading(false);}
  },[month]);
  useEffect(()=>{void load()},[load]);
  const shown=useMemo(()=>rows.map(row=>({...row,...(drafts[row.id]||{})})),[rows,drafts]);
  const visible=useMemo(()=>shown.filter(row=>
    (!companyFilter||row.companyName===companyFilter)&&
    (!employeeSearch||String(row.employeeName||'').toLowerCase().includes(employeeSearch.trim().toLowerCase()))
  ),[shown,companyFilter,employeeSearch]);
  const total=useMemo(()=>salaryTotals(visible),[visible]);
  function edit(id,field,value){setDrafts(previous=>({...previous,[id]:{...(previous[id]||{}),[field]:value}}));setSaved(previous=>({...previous,[id]:false}));}
  function beginEdit(row){setEditing(row.id);setSaved(previous=>({...previous,[row.id]:false}));setDrafts(previous=>({...previous,[row.id]:{...(previous[row.id]||{}),employeeName:row.employeeName,companyName:row.companyName||'',salaryAmount:row.salaryAmount}}));setMessage('');}
  function cancelEdit(id){setEditing(null);setSaved(previous=>({...previous,[id]:Boolean(rows.find(row=>row.id===id)?.updatedAt)}));setDrafts(previous=>{const next={...previous},draft={...(next[id]||{})};delete draft.employeeName;delete draft.companyName;delete draft.salaryAmount;if(Object.keys(draft).length)next[id]=draft;else delete next[id];return next;});}
  async function addEmployee(e){
    e.preventDefault();if(adding)return;setAdding(true);setMessage('');
    try{
      const res=await fetch('/api/salary',{method:'POST',credentials:'include',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'add_employee',employeeName:name,companyName:company,salaryAmount:baseSalary})});
      const data=await res.json();if(!res.ok||!data.ok)throw new Error(data.error||'Could not add employee.');
      setName('');setCompany('');setBaseSalary('');await load();setMessage(data.message);
    }catch(error){setMessage(error.message||'Could not add employee.');}finally{setAdding(false);}
  }
  async function saveRow(row){
    if(busy[row.id])return;const editProfile=editing===row.id;setBusy(p=>({...p,[row.id]:true}));setMessage('');
    try{
      const res=await fetch('/api/salary',{method:'POST',credentials:'include',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'save_month',employeeId:row.id,month,
          salaryAmount:row.salaryAmount,cashPaid:row.cashPaid,accountPaid:row.accountPaid,
          editProfile,employeeName:row.employeeName,companyName:row.companyName})});
      const data=await res.json();if(!res.ok||!data.ok)throw new Error(data.error||'Save failed.');
      setRows(previous=>previous.map(r=>r.id===row.id?{...r,...data.row,updatedAt:new Date().toISOString()}:r));
      setDrafts(previous=>{const next={...previous};delete next[row.id];return next});
      if(editProfile)setEditing(null);
      setSaved(previous=>({...previous,[row.id]:true}));
      setMessage(data.message);
    }catch(error){setMessage(row.employeeName+': '+(error.message||'Save failed.'));}
    finally{setBusy(p=>({...p,[row.id]:false}));}
  }
  const monthTitle=useMemo(()=>{const [year,m]=month.split('-').map(Number);
    return new Date(year,m-1,1).toLocaleDateString('en-IN',{month:'long',year:'numeric'});
  },[month]);
  return <main style={{minHeight:'75vh',background:'#f4f8ff',padding:'20px clamp(12px,3vw,32px)',color:'#142642'}}>
    <div style={{maxWidth:1250,margin:'auto'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:12}}>
        <div><small style={{fontWeight:900,color:'#315b98',letterSpacing:1.1}}>MAYAVI CARGO • ADMIN ONLY</small>
          <h1 style={{margin:'6px 0',fontSize:26}}>Salary Calculator</h1>
          <p style={{color:'#5a6e84',margin:'4px 0'}}>Simple monthly salary entries • Cash + Account = Total Paid • No TDS or deductions</p>
        </div>
        <label style={{display:'grid',gap:4,fontSize:12,fontWeight:900}}>SALARY MONTH
          <input type="month" aria-label="Salary month" min="2020-01" max="2100-12" value={month} onChange={e=>{setEditing(null);setMonth(e.target.value)}} style={{...input,minWidth:190,fontWeight:800}}/>
        </label>
      </div>
      <form onSubmit={addEmployee} style={{display:'flex',alignItems:'end',flexWrap:'wrap',gap:10,background:'#fff',border:'1px solid #d9e5f4',borderRadius:12,padding:16,marginTop:18}}>
        <label style={{flex:'2 1 200px',display:'grid',gap:5,fontSize:12,fontWeight:800}}>EMPLOYEE NAME
          <input value={name} onChange={e=>setName(e.target.value)} required maxLength={100} placeholder="Enter employee name" style={input}/>
        </label>
        <label style={{flex:'1 1 180px',display:'grid',gap:5,fontSize:12,fontWeight:800}}>COMPANY NAME
          <select aria-label="Company Name" value={company} onChange={e=>setCompany(e.target.value)} required style={{...input,minWidth:155}}>
            <option value="">Select company</option>
            {SALARY_COMPANIES.map(value=><option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label style={{flex:'1 1 180px',display:'grid',gap:5,fontSize:12,fontWeight:800}}>MONTHLY SALARY (₹)
          <input type="number" step="0.01" min="0" max="999999999" value={baseSalary} onChange={e=>setBaseSalary(e.target.value)} required placeholder="e.g. 25000" style={input}/>
        </label>
        <button type="submit" disabled={adding} style={{...button,background:'#2056a1',color:'#fff',minHeight:38}}>{adding?'ADDING…':'+ ADD EMPLOYEE'}</button>
      </form>
      <p style={{fontSize:12,color:'#54708c'}}>Employees are added only once and shown in every month. Use EDIT to change an employee's name, company and default salary; existing saved monthly payments are preserved. You can also change each month's salary independently. Select September 2026 to enter older salary payments.</p>
      <section aria-label="Salary filters" style={{display:'flex',flexWrap:'wrap',alignItems:'end',gap:10,background:'#fff',padding:12,borderRadius:12,border:'1px solid #d9e5f4'}}>
        <label style={{display:'grid',gap:5,minWidth:180,fontSize:12,fontWeight:800}}>FILTER BY COMPANY
          <select aria-label="Filter salaries by company" value={companyFilter} onChange={e=>setCompanyFilter(e.target.value)} style={{...input,minWidth:175}}>
            <option value="">All Companies</option>
            {SALARY_COMPANIES.map(value=><option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label style={{display:'grid',gap:5,flex:'1 1 190px',maxWidth:300,fontSize:12,fontWeight:800}}>SEARCH EMPLOYEE
          <input type="search" aria-label="Search salary employees" value={employeeSearch}
            onChange={e=>setEmployeeSearch(e.target.value)} placeholder="Employee name" style={input}/>
        </label>
        <button type="button" onClick={()=>{setCompanyFilter('');setEmployeeSearch('')}}
          style={{...button,background:'#e8effa',color:'#2056a1',minHeight:38}}>CLEAR FILTERS</button>
        <small style={{color:'#55718b',fontWeight:700}}>{visible.length} of {shown.length} employees shown</small>
      </section>
      {message&&<p role="status" style={{background:'#eaf2ff',borderRadius:8,padding:'10px 12px',fontSize:13,fontWeight:700,color:'#1d4678'}}>{message}</p>}
      <section style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:10,margin:'17px 0'}} aria-label="Monthly salary totals">
        {[
          ['MONTHLY SALARY',total.monthlySalary],
          ['TOTAL CASH',total.cash],
          ['TOTAL ACCOUNT',total.account],
          ['TOTAL PAID',total.totalPaid],
          ['BALANCE',total.balance]
        ].map(([label,value])=><div key={label} style={{background:'#fff',padding:15,borderRadius:12,border:'1px solid #dce7f4'}}>
          <small style={{fontWeight:900,color:'#45607f'}}>{label}</small>
          <div style={{fontSize:21,fontWeight:900,marginTop:5,color:label==='BALANCE'&&value<0?'#b91c1c':'#174b87'}}>{show(value)}</div>
        </div>)}
      </section>
      <div style={{overflowX:'auto',border:'1px solid #dae5f1',borderRadius:12,background:'#fff'}}>
        <table style={{width:'100%',borderCollapse:'collapse',minWidth:1080}}>
          <thead><tr style={{background:'#eaf2ff',color:'#233d60'}}>
            {['S.No.','Employee Name','Company Name','Monthly Salary (₹)','Cash Paid (₹)','Account Paid (₹)','Total Paid (₹)','Balance (₹)','Save'].map(label=><th key={label} style={{...cell,textAlign:'left',fontSize:12}}>{label}</th>)}
          </tr></thead>
          <tbody>
            {visible.map((row,index)=>{
              const values=salaryRowTotals(row);
              return <tr key={row.id} style={{background:index%2?'#fafcff':'#fff'}}>
                <td style={cell}>{index+1}</td>
                <td style={{...cell,fontWeight:800}}>{editing===row.id
                  ?<input aria-label="Edit Employee Name" value={row.employeeName} maxLength={100}
                    onChange={e=>edit(row.id,'employeeName',e.target.value)} style={{...input,minWidth:150}}/>
                  :row.employeeName}</td>
                <td style={cell}>{editing===row.id
                  ?<select aria-label={'Edit Company Name for '+row.employeeName}
                    value={row.companyName||''} onChange={e=>edit(row.id,'companyName',e.target.value)} style={{...input,minWidth:160}}>
                    <option value="">Select company</option>
                    {SALARY_COMPANIES.map(value=><option key={value} value={value}>{value}</option>)}
                  </select>
                  :<span style={{fontWeight:800,color:'#174b87'}}>{row.companyName||'Not selected'}</span>}
                </td>
                {['salaryAmount','cashPaid','accountPaid'].map(field=><td key={field} style={cell}>
                  <input type="number" min="0" max="999999999" step="0.01" aria-label={row.employeeName+' '+field}
                    value={row[field]??''} onChange={e=>edit(row.id,field,e.target.value)}
                    style={{...input,width:120}}/>
                </td>)}
                <td style={{...cell,fontWeight:900,color:'#17623e'}}>{values?show(values.totalPaid):'—'}</td>
                <td style={{...cell,fontWeight:800,color:values&&values.balance<0?'#b91c1c':'#42566e'}}>{values?show(values.balance):'—'}</td>
                <td style={cell}><div style={{display:'flex',gap:6,alignItems:'center'}}>
                  <button type="button" disabled={Boolean(busy[row.id])} onClick={()=>void saveRow(row)}
                    style={{...button,background:saved[row.id]&&editing!==row.id?'#15803d':'#2056a1',color:'#fff',padding:'8px 12px',minWidth:110,transition:'background .2s ease'}}>{busy[row.id]?'SAVING…':editing===row.id?'SAVE CHANGES':saved[row.id]?'✓ SAVED':'SAVE'}</button>
                  {editing===row.id
                    ?<button type="button" disabled={Boolean(busy[row.id])} onClick={()=>cancelEdit(row.id)}
                      style={{...button,background:'#e7edf4',color:'#263b56',padding:'8px 12px'}}>CANCEL</button>
                    :<button type="button" disabled={Boolean(busy[row.id])} onClick={()=>beginEdit(row)}
                      style={{...button,background:'#e6effe',color:'#174b87',padding:'8px 12px'}}>EDIT</button>}
                </div></td>
              </tr>;
            })}
            {!visible.length&&<tr><td colSpan={9} style={{textAlign:'center',padding:28,color:'#64748b'}}>{loading?'Loading employees…':shown.length?'No employees match the selected filters.':'No employees added. Use Add Employee above.'}</td></tr>}
          </tbody>
          {visible.length>0&&<tfoot><tr style={{background:'#dceafe',fontWeight:900}}>
            <td style={cell} colSpan={3}>TOTAL • {visible.length} employees • {monthTitle}</td>
            <td style={cell}>{show(total.monthlySalary)}</td>
            <td style={cell}>{show(total.cash)}</td>
            <td style={cell}>{show(total.account)}</td>
            <td style={cell}>{show(total.totalPaid)}</td>
            <td style={cell}>{show(total.balance)}</td>
            <td style={cell}>—</td>
          </tr></tfoot>}
        </table>
      </div>
      <p style={{fontSize:12,color:'#64748b'}}>Total Paid = Cash Paid + Account Paid. Balance = Monthly Salary − Total Paid. A negative balance indicates payment above the entered salary. Cash, Account, Total Paid and Balance totals reflect the selected company and employee filters. Every month's saved entries are kept separately in Mayavi's shared database; no TDS, PF or other deduction is calculated.</p>
    </div>
  </main>;
}
