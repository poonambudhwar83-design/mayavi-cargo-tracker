'use client';
import {useEffect,useMemo,useState} from 'react';
import {TRANSACTION_MODES} from '../lib/accountLedger.js';

const API='/api/accounts';
const panel={background:'#fff',border:'1px solid #dce5f0',borderRadius:14,padding:17,
  boxShadow:'0 3px 14px rgba(30,50,90,.04)'};
const input={border:'1px solid #cbd5e1',borderRadius:8,padding:'9px 10px',fontSize:13,
  minHeight:39,background:'#fff',color:'#152f50',boxSizing:'border-box',width:'100%'};
const button={border:'1px solid #c6d4e6',borderRadius:9,padding:'9px 13px',fontWeight:800,
  fontSize:12,cursor:'pointer',background:'#eef4ff',color:'#20509a'};
const th={background:'#ecf3fe',padding:'10px 9px',color:'#294563',fontSize:11,
  whiteSpace:'nowrap',textAlign:'left',borderBottom:'1px solid #cfdaeb',position:'sticky',top:0,zIndex:1};
const td={padding:'8px 9px',borderBottom:'1px solid #e6ebf1',fontSize:12,whiteSpace:'nowrap'};
const nf=new Intl.NumberFormat('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
const cash=value=>nf.format(Number(value)||0);
const blankAccount=()=>({holderName:'',accountNo:'',bankName:'',openingBalance:'0'});
function localDay(){
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const get=type=>parts.find(part=>part.type===type)?.value||'';
  return get('year')+'-'+get('month')+'-'+get('day');
}
const blankEntry=()=>({date:localDay(),credit:'',debit:'',mode:'',remarks:''});
const monthLabel=value=>{
  if(value==='ALL')return 'All Dates';
  const [year,month]=String(value).split('-').map(Number);
  return new Date(year,month-1,1).toLocaleString('en-IN',{month:'long',year:'numeric'});
};
function summary(label,value){
  return <div style={{background:'#f3f7fe',borderRadius:11,padding:'12px 14px',border:'1px solid #dce6f7',minWidth:140}}>
    <div style={{fontSize:11,color:'#677d9b',fontWeight:750}}>{label}</div>
    <div style={{fontSize:20,fontWeight:900,color:'#1b426e',marginTop:4,fontVariantNumeric:'tabular-nums'}}>₹{cash(value)}</div>
  </div>;
}
function field(label,value,onChange,type='text',props={}){
  return <label style={{display:'grid',gap:5,fontSize:11,fontWeight:800,color:'#3e526d',minWidth:160,flex:'1 1 190px'}}>
    {label}<input {...props} style={input} type={type} value={value}
      onChange={e=>onChange(e.target.value)}/>
  </label>;
}
function toAccountDraft(account){
  return {holderName:account.holderName||'',bankName:account.bankName||'',
    accountNo:account.accountNo||'',openingBalance:String(account.openingBalance??0)};
}
export default function AccountDashboard(){
  const [data,setData]=useState({accounts:[],selectedAccount:null,entries:[],months:[]});
  const [accountId,setAccountId]=useState('');
  const [month,setMonth]=useState('ALL');
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState('');
  const [refresh,setRefresh]=useState(0);
  const [creating,setCreating]=useState(false);
  const [accountDraft,setAccountDraft]=useState(blankAccount);
  const [editAccount,setEditAccount]=useState(false);
  const [entryDraft,setEntryDraft]=useState(blankEntry);
  const [editId,setEditId]=useState('');
  const [editDraft,setEditDraft]=useState(blankEntry);
  const [downloadBusy,setDownloadBusy]=useState(false);
  const [search,setSearch]=useState('');
  const selected=data.selectedAccount;
  useEffect(()=>{
    let active=true;
    setLoading(true);
    const params=new URLSearchParams({month});
    if(accountId)params.set('accountId',accountId);
    fetch(API+'?'+params,{credentials:'include',cache:'no-store'})
      .then(async response=>{const json=await response.json();
        if(!response.ok||!json.ok)throw Error(json.error||'Unable to read account records.');
        return json;})
      .then(json=>{if(active){
        setData(json);
        if(!accountId&&json.selectedAccount)setAccountId(json.selectedAccount.id);
      }})
      .catch(e=>{if(active)setNotice(e?.message||'Unable to read accounts.');})
      .finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[accountId,month,refresh]);
  const shown=useMemo(()=>{
    const q=search.toLowerCase().trim();
    return q?data.entries.filter(r=>(r.remarks||'').toLowerCase().includes(q)||(r.mode||'').toLowerCase().includes(q)||String(r.date).includes(q)):data.entries;
  },[data.entries,search]);
  function switchAccount(id){
    setAccountId(id);setMonth('ALL');setEditAccount(false);setCreating(false);
    setEditId('');setNotice('');setSearch('');
  }
  async function request(body,method='POST'){
    const result=await fetch(API,{method,credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const json=await result.json();
    if(!result.ok||!json.ok)throw Error(json.error||'Changes could not be saved.');
    return json;
  }
  async function createAccount(event){
    event.preventDefault();if(busy)return;
    setBusy(true);setNotice('');
    try{
      const saved=await request({...accountDraft,action:'create_account'});
      setCreating(false);setAccountDraft(blankAccount());setAccountId(saved.accountId);setMonth('ALL');
      setRefresh(n=>n+1);setNotice(saved.message||'Account saved.');
    }catch(e){setNotice(e.message||'Unable to create bank account.');}
    finally{setBusy(false);}
  }
  async function saveAccount(event){
    event.preventDefault();if(busy||!selected)return;
    setBusy(true);setNotice('');
    try{
      const saved=await request({...accountDraft,accountId:selected.id,action:'update_account'},'PATCH');
      setEditAccount(false);setRefresh(n=>n+1);setNotice(saved.message||'Account updated.');
    }catch(e){setNotice(e.message||'Unable to update bank account.');}
    finally{setBusy(false);}
  }
  async function saveEntry(event){
    event.preventDefault();if(busy||!selected)return;
    setBusy(true);setNotice('');
    try{
      const saved=await request({...entryDraft,accountId:selected.id,action:'add_entry'});
      setEntryDraft(blankEntry());setMonth('ALL');setRefresh(n=>n+1);
      setNotice(saved.message||'Transaction saved.');
    }catch(e){setNotice(e.message||'Unable to save transaction.');}
    finally{setBusy(false);}
  }
  function startEdit(row){
    setEditId(row.id);
    setEditDraft({date:row.date,credit:row.credit?String(row.credit):'',
      debit:row.debit?String(row.debit):'',mode:row.mode||'',remarks:row.remarks||''});
    setNotice('');
  }
  async function updateEntry(event){
    event.preventDefault();if(busy||!selected||!editId)return;
    setBusy(true);setNotice('');
    try{
      const saved=await request({...editDraft,accountId:selected.id,entryId:editId,action:'update_entry'},'PATCH');
      setEditId('');setRefresh(n=>n+1);setNotice(saved.message||'Transaction updated.');
    }catch(e){setNotice(e.message||'Unable to edit transaction.');}
    finally{setBusy(false);}
  }
  async function deleteEntry(row){
    if(!selected||busy||!window.confirm('Delete the selected transaction? Balances will be recalculated.'))return;
    setBusy(true);setNotice('');
    try{
      const params=new URLSearchParams({entryId:row.id,accountId:selected.id});
      const response=await fetch(API+'?'+params,{method:'DELETE',credentials:'include'});
      const result=await response.json();
      if(!response.ok||!result.ok)throw Error(result.error||'Cannot delete transaction.');
      setEditId('');setRefresh(n=>n+1);setNotice(result.message||'Transaction deleted.');
    }catch(e){setNotice(e.message||'Unable to delete transaction.');}
    finally{setBusy(false);}
  }
  async function download(){
    if(!selected||downloadBusy)return;
    setDownloadBusy(true);setNotice('');
    try{
      const params=new URLSearchParams({accountId:selected.id,month,download:'excel'});
      const response=await fetch(API+'?'+params,{cache:'no-store',credentials:'include'});
      if(!response.ok){
        const result=await response.json().catch(()=>({}));
        throw Error(result.error||'Could not download Excel.');
      }
      const blob=await response.blob(),href=URL.createObjectURL(blob),
        name=response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1]||'Mayavi_Account.xlsx';
      const a=document.createElement('a');
      a.href=href;a.download=name;document.body.appendChild(a);a.click();a.remove();
      setTimeout(()=>URL.revokeObjectURL(href),1500);
    }catch(e){setNotice(e.message||'Excel download failed.');}
    finally{setDownloadBusy(false);}
  }
  return <main style={{minHeight:'calc(100vh - 75px)',background:'#f3f6fc',padding:'20px clamp(12px,2.6vw,30px)',color:'#1c395e'}}>
    <header style={{display:'flex',justifyContent:'space-between',gap:14,alignItems:'center',flexWrap:'wrap',marginBottom:17}}>
      <div>
        <div style={{fontSize:11,letterSpacing:2,color:'#587ca8',fontWeight:900}}>MAYAVI • ADMIN FINANCE</div>
        <h1 style={{fontSize:29,margin:'4px 0'}}>ACCOUNT</h1>
        <p style={{margin:'5px 0 0',fontSize:13,color:'#71829b'}}>Bank-wise Credit / Debit ledger with Mode of Transaction and Remarks. Every entry is saved in Mayavi backend.</p>
      </div>
      <button type="button" style={{...button,background:'#1d58a2',color:'#fff'}} onClick={()=>{
        setCreating(v=>!v);setEditAccount(false);setAccountDraft(blankAccount());setNotice('');
      }}>{creating?'CANCEL NEW ACCOUNT':'+ ADD BANK ACCOUNT'}</button>
    </header>
    {creating&&<form onSubmit={createAccount} style={{...panel,marginBottom:15,borderColor:'#97b8ed'}}>
      <h2 style={{fontSize:16,margin:'0 0 13px'}}>New Bank Account</h2>
      <div style={{display:'flex',flexWrap:'wrap',gap:12}}>
        {field('NAME OF ACCOUNT HOLDER',accountDraft.holderName,v=>setAccountDraft(a=>({...a,holderName:v})))}
        {field('ACCOUNT NO.',accountDraft.accountNo,v=>setAccountDraft(a=>({...a,accountNo:v})))}
        {field('BANK NAME',accountDraft.bankName,v=>setAccountDraft(a=>({...a,bankName:v})))}
        {field('OPENING BALANCE (₹)',accountDraft.openingBalance,v=>setAccountDraft(a=>({...a,openingBalance:v})))}
      </div>
      <button type="submit" style={{...button,background:'#1c5ca8',color:'#fff',marginTop:14}} disabled={busy}>
        {busy?'SAVING…':'SAVE BANK ACCOUNT'}
      </button>
    </form>}
    <section style={{...panel,marginBottom:15}}>
      <div style={{display:'flex',alignItems:'end',gap:11,flexWrap:'wrap',marginBottom:15}}>
        <label style={{fontSize:11,fontWeight:850,display:'grid',gap:5,flex:'1 1 220px'}}>
          SELECT ACCOUNT
          <select style={input} value={selected?.id||''} onChange={e=>switchAccount(e.target.value)}>
            {!data.accounts.length&&<option value="">No bank accounts yet</option>}
            {data.accounts.map(a=><option key={a.id} value={a.id}>{a.holderName} — {a.bankName} ({a.accountNo})</option>)}
          </select>
        </label>
        {!!selected&&<button type="button" style={button} onClick={()=>{
          setEditAccount(v=>!v);setAccountDraft(toAccountDraft(selected));
        }}>{editAccount?'CANCEL EDIT':'EDIT ACCOUNT DETAILS'}</button>}
      </div>
      {!selected&&!loading&&<p style={{fontSize:13,color:'#667d99',margin:0}}>Add your first bank account above to start recording transactions.</p>}
      {!!selected&&(editAccount
        ?<form onSubmit={saveAccount}>
          <div style={{display:'flex',flexWrap:'wrap',gap:12}}>
            {field('NAME OF ACCOUNT HOLDER',accountDraft.holderName,v=>setAccountDraft(a=>({...a,holderName:v})))}
            {field('ACCOUNT NO.',accountDraft.accountNo,v=>setAccountDraft(a=>({...a,accountNo:v})))}
            {field('BANK NAME',accountDraft.bankName,v=>setAccountDraft(a=>({...a,bankName:v})))}
            {field('OPENING BALANCE (₹)',accountDraft.openingBalance,v=>setAccountDraft(a=>({...a,openingBalance:v})))}
          </div>
          <button type="submit" disabled={busy} style={{...button,marginTop:14,background:'#1d58a2',color:'#fff'}}>SAVE CHANGES</button>
        </form>
        :<div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(170px,1fr))',gap:10}}>
          {[['NAME OF ACCOUNT HOLDER',selected.holderName],
            ['ACCOUNT NO.',selected.accountNo],
            ['BANK NAME',selected.bankName],
            ['OPENING BALANCE','₹'+cash(selected.openingBalance)]].map(([key,value])=>
            <div key={key} style={{border:'1px solid #e0e9f5',borderRadius:9,padding:11,background:'#f9fbff'}}>
              <div style={{fontSize:10,fontWeight:900,color:'#687b99',marginBottom:5}}>{key}</div>
              <div style={{fontSize:14,fontWeight:750,overflowWrap:'anywhere'}}>{value}</div>
            </div>)}
        </div>)}
    </section>
    {!!selected&&<>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(170px,1fr))',gap:10,marginBottom:15}}>
        {summary('TOTAL CREDIT',selected.totalCredit)}
        {summary('TOTAL DEBIT',selected.totalDebit)}
        {summary('CURRENT BALANCE',selected.balance)}
      </div>
      <form onSubmit={saveEntry} style={{...panel,marginBottom:15}}>
        <h2 style={{fontSize:16,margin:'0 0 5px'}}>Add Transaction</h2>
        <p style={{margin:'0 0 11px',color:'#697e97',fontSize:11}}>Enter an amount under either Credit or Debit. Balance will update automatically.</p>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(155px,1fr))',gap:10}}>
          {field('DATE',entryDraft.date,v=>setEntryDraft(a=>({...a,date:v})),'date',{required:true})}
          {field('CREDIT (₹)',entryDraft.credit,v=>setEntryDraft(a=>({...a,credit:v})),'text',{placeholder:'0.00',inputMode:'decimal'})}
          {field('DEBIT (₹)',entryDraft.debit,v=>setEntryDraft(a=>({...a,debit:v})),'text',{placeholder:'0.00',inputMode:'decimal'})}
          <label style={{display:'grid',gap:5,fontSize:11,fontWeight:800,color:'#3e526d',minWidth:160,flex:'1 1 190px'}}>
            MODE OF TRANSACTION
            <select required style={input} value={entryDraft.mode} onChange={e=>setEntryDraft(a=>({...a,mode:e.target.value}))}>
              <option value="">Select mode</option>
              {TRANSACTION_MODES.map(mode=><option key={mode} value={mode}>{mode}</option>)}
            </select>
          </label>
          {field('REMARKS',entryDraft.remarks,v=>setEntryDraft(a=>({...a,remarks:v})),'text',{placeholder:'Transaction details'})}
        </div>
        <button disabled={busy} style={{...button,marginTop:12,background:'#1d58a2',color:'#fff'}} type="submit">
          {busy?'SAVING…':'+ SAVE ENTRY'}
        </button>
      </form>
      <section style={{...panel,padding:'14px 10px'}}>
        <div style={{display:'flex',gap:12,flexWrap:'wrap',justifyContent:'space-between',alignItems:'end',padding:'0 6px 14px'}}>
          <div>
            <h2 style={{fontSize:17,margin:'0 0 4px'}}>Account Statement</h2>
            <div style={{fontSize:11,color:'#72839c'}}>Balance reflects all earlier transactions, even when viewing one month.</div>
          </div>
          <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'end'}}>
            <label style={{display:'grid',gap:3,fontSize:11,fontWeight:800}}>MONTH
              <select style={{...input,minWidth:140}} value={month} onChange={e=>{setMonth(e.target.value);setEditId('');}}>
                <option value="ALL">All Dates</option>
                {data.months.map(m=><option key={m} value={m}>{monthLabel(m)}</option>)}
              </select>
            </label>
            <label style={{display:'grid',gap:3,fontSize:11,fontWeight:800}}>SEARCH REMARKS
              <input style={{...input,width:180}} value={search} onChange={e=>setSearch(e.target.value)} placeholder="Filter by mode/remark/date"/>
            </label>
            <button type="button" disabled={downloadBusy} style={{...button,background:'#e3f2ee',color:'#176447'}}
              onClick={download}>{downloadBusy?'PREPARING…':'↓ DOWNLOAD EXCEL'}</button>
          </div>
        </div>
        {notice&&<div role="status" style={{margin:'0 6px 10px',padding:'10px 12px',background:'#eef5ff',
          color:'#26528a',fontSize:12,border:'1px solid #d4e5ff',borderRadius:9}}>{notice}</div>}
        <div style={{overflowX:'auto',maxHeight:'min(70vh,680px)',border:'1px solid #dfe8f4',borderRadius:10}}>
          <table style={{borderCollapse:'separate',borderSpacing:0,width:'100%',minWidth:1050}}>
            <thead><tr>{['DATE ↓ (LATEST FIRST)','CREDIT (₹)','DEBIT (₹)','MODE OF TRANSACTION','BALANCE (₹)','REMARKS','ACTIONS'].map((title,i)=>
              <th key={title} style={{...th,textAlign:[1,2,4].includes(i)?'right':'left'}}>{title}</th>)}</tr></thead>
            <tbody>
              {loading&&<tr><td colSpan={7} style={{padding:25,textAlign:'center',color:'#74859e'}}>Loading saved ledger…</td></tr>}
              {!loading&&!shown.length&&<tr><td colSpan={7} style={{padding:25,textAlign:'center',color:'#74859e'}}>
                No transactions for this selection.
              </td></tr>}
              {!loading&&shown.map((r,i)=><tr key={r.id} style={{background:i%2?'#f9fbff':'#fff'}}>
                {editId===r.id?<>
                  <td style={td}><input form="edit-bank-entry" type="date" value={editDraft.date} onChange={e=>setEditDraft(a=>({...a,date:e.target.value}))}
                    style={{...input,width:145}}/></td>
                  <td style={td}><input form="edit-bank-entry" inputMode="decimal" value={editDraft.credit}
                    onChange={e=>setEditDraft(a=>({...a,credit:e.target.value}))} style={{...input,width:105,textAlign:'right'}} placeholder="0.00"/></td>
                  <td style={td}><input form="edit-bank-entry" inputMode="decimal" value={editDraft.debit}
                    onChange={e=>setEditDraft(a=>({...a,debit:e.target.value}))} style={{...input,width:105,textAlign:'right'}} placeholder="0.00"/></td>
                  <td style={td}><select form="edit-bank-entry" required style={{...input,minWidth:140}} value={editDraft.mode} onChange={e=>setEditDraft(a=>({...a,mode:e.target.value}))}>
                    <option value="">Select mode</option>
                    {TRANSACTION_MODES.map(mode=><option key={mode} value={mode}>{mode}</option>)}
                  </select></td>
                  <td style={{...td,textAlign:'right',fontWeight:800,color:'#1a5b9f'}}>{cash(r.balance)}</td>
                  <td style={td}><input form="edit-bank-entry" style={{...input,minWidth:225}} value={editDraft.remarks}
                    onChange={e=>setEditDraft(a=>({...a,remarks:e.target.value}))}/></td>
                  <td style={td}>
                    <form id="edit-bank-entry" onSubmit={updateEntry} style={{display:'flex',gap:6}}>
                      <button type="submit" disabled={busy} style={{...button,background:'#1c5ea7',color:'#fff',padding:'8px 9px'}}>SAVE</button>
                      <button type="button" disabled={busy} style={{...button,padding:'8px 9px'}} onClick={()=>setEditId('')}>CANCEL</button>
                    </form>
                  </td>
                </>:<>
                  <td style={{...td,fontWeight:700}}>{r.date}</td>
                  <td style={{...td,textAlign:'right',color:'#167d59',fontWeight:r.credit?800:400}}>{r.credit?cash(r.credit):'—'}</td>
                  <td style={{...td,textAlign:'right',color:'#b35554',fontWeight:r.debit?800:400}}>{r.debit?cash(r.debit):'—'}</td>
                  <td style={{...td,color:'#475569',fontWeight:650}}>{r.mode||'—'}</td>
                  <td style={{...td,textAlign:'right',fontWeight:900,color:Number(r.balance)<0?'#b33d43':'#214e86'}}>{cash(r.balance)}</td>
                  <td style={{...td,whiteSpace:'normal',minWidth:220,overflowWrap:'anywhere'}}>{r.remarks||'—'}</td>
                  <td style={td}>
                    <div style={{display:'flex',gap:6}}>
                      <button disabled={busy} type="button" style={{...button,padding:'7px 10px'}} onClick={()=>startEdit(r)}>EDIT</button>
                      <button disabled={busy} type="button" style={{...button,padding:'7px 10px',color:'#a02b3d',background:'#fff7f8'}}
                        onClick={()=>deleteEntry(r)}>DELETE</button>
                    </div>
                  </td>
                </>}
              </tr>)}
            </tbody>
          </table>
        </div>
        <div style={{fontSize:11,color:'#7a8ba4',padding:'10px 5px 0'}}>
          {shown.length} entries visible. Latest transaction date first. Running balances are still calculated in chronological order, including earlier transactions.
        </div>
      </section>
    </>}
    {!selected&&notice&&<div role="status" style={{background:'#ecf3fd',padding:13,borderRadius:9}}>{notice}</div>}
  </main>;
}
