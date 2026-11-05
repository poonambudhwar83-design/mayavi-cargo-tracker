'use client';
import {useEffect,useState} from 'react';

const API='/api/accounts/summary';
const panel={background:'#fff',border:'1px solid #dce5f0',borderRadius:14,padding:16,
  boxShadow:'0 3px 14px rgba(30,50,90,.04)'};
const input={border:'1px solid #cbd5e1',borderRadius:8,padding:'9px 10px',fontSize:12,
  minHeight:39,background:'#fff',color:'#152f50',width:'100%',boxSizing:'border-box'};
const button={border:'1px solid #c6d4e6',borderRadius:9,padding:'9px 13px',fontWeight:800,
  fontSize:12,cursor:'pointer',background:'#eef4ff',color:'#20509a'};
const money=n=>new Intl.NumberFormat('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(n)||0);
function monthLabel(value){
  if(value==='ALL')return 'All Dates';
  const [year,month]=value.split('-').map(Number);
  return new Date(year,month-1,1).toLocaleString('en-IN',{month:'long',year:'numeric'});
}
export default function AccountSummary({accounts=[],refresh=0}){
  const [open,setOpen]=useState(true);
  const [accountId,setAccountId]=useState('ALL'),[month,setMonth]=useState('ALL'),
    [party,setParty]=useState('ALL');
  const [data,setData]=useState({groups:[],entries:[],monthly:[],months:[],totals:{}});
  const [monthlyFocus,setMonthlyFocus]=useState('');
  const [loading,setLoading]=useState(false),[downloading,setDownloading]=useState(false);
  const [error,setError]=useState('');
  useEffect(()=>{
    if(!open)return;
    let active=true;
    setLoading(true);setError('');
    const params=new URLSearchParams({accountId,month,party});
    fetch(API+'?'+params,{credentials:'include',cache:'no-store'})
      .then(async response=>{
        const json=await response.json();
        if(!response.ok||!json.ok)throw Error(json.error||'Could not load summary.');
        return json;
      }).then(json=>{if(active)setData(json);})
      .catch(e=>{if(active)setError(e?.message||'Summary unavailable.');})
      .finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[open,accountId,month,party,refresh]);
  async function download(){
    if(downloading)return;
    setDownloading(true);setError('');
    try{
      const params=new URLSearchParams({accountId,month,party,download:'pdf'});
      const response=await fetch(API+'?'+params,{credentials:'include',cache:'no-store'});
      if(!response.ok){
        const result=await response.json().catch(()=>({}));
        throw Error(result.error||'PDF download failed.');
      }
      const blob=await response.blob();
      const href=URL.createObjectURL(blob);
      const name=response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1]||'Mayavi_Summary_of_Accounts.pdf';
      const link=document.createElement('a');
      link.href=href;link.download=name;document.body.appendChild(link);link.click();link.remove();
      setTimeout(()=>URL.revokeObjectURL(href),1500);
    }catch(e){setError(e?.message||'PDF download failed.');}
    finally{setDownloading(false);}
  }
  const groups=data.groups||[],entries=data.entries||[],totals=data.totals||{};
  const monthly=data.monthly||[];
  const focusedMonth=monthly.find(row=>row.month===monthlyFocus)||monthly[0];
  const fullTotals=monthly.reduce((a,row)=>({count:a.count+row.count,
    credit:a.credit+row.credit,debit:a.debit+row.debit,net:a.net+row.net}),
    {count:0,credit:0,debit:0,net:0});
  return <section style={{...panel,marginBottom:15,borderColor:'#b9cdea'}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:10}}>
      <div>
        <h2 style={{fontSize:18,margin:'0 0 4px',color:'#193f72'}}>SUMMARY OF ACCOUNTS</h2>
        <div style={{color:'#6b7f98',fontSize:11}}>Party-wise payments, receipts and every credit date across saved bank accounts.</div>
      </div>
      <button type="button" style={button} onClick={()=>setOpen(v=>!v)}>{open?'HIDE SUMMARY':'VIEW SUMMARY'}</button>
    </div>
    {open&&<>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))',gap:10,marginTop:15}}>
        <label style={{fontSize:11,fontWeight:800}}>BANK ACCOUNT
          <select style={input} value={accountId} onChange={e=>{setAccountId(e.target.value);setMonth('ALL');setParty('ALL');}}>
            <option value="ALL">All Bank Accounts</option>
            {accounts.map(a=><option key={a.id} value={a.id}>{a.holderName} — {a.bankName}</option>)}
          </select>
        </label>
        <label style={{fontSize:11,fontWeight:800}}>MONTH
          <select style={input} value={month} onChange={e=>{setMonth(e.target.value);setParty('ALL');}}>
            <option value="ALL">All Dates</option>
            {(data.months||[]).map(m=><option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
        </label>
        <label style={{fontSize:11,fontWeight:800}}>PARTY / PLATFORM
          <select style={input} value={party} onChange={e=>setParty(e.target.value)}>
            <option value="ALL">All Parties</option>
            {groups.map(g=><option key={g.party} value={g.party}>{g.party}</option>)}
          </select>
        </label>
        <div style={{display:'flex',alignItems:'end'}}>
          <button type="button" disabled={loading||downloading} onClick={download}
            style={{...button,width:'100%',background:'#176c56',borderColor:'#176c56',color:'#fff',opacity:(loading||downloading)?0.65:1}}>
            {downloading?'PREPARING PDF…':'↓ DOWNLOAD DETAILED PDF'}
          </button>
        </div>
      </div>
      {error&&<div role="alert" style={{marginTop:12,color:'#a22f3c',fontSize:12}}>{error}</div>}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:9,marginTop:13}}>
        {[[ 'TOTAL CREDIT',totals.credit,'#13734d'],['TOTAL DEBIT',totals.debit,'#9e3945'],
          ['NET MOVEMENT',totals.net,'#21578d'],['TRANSACTIONS',totals.count,null]].map(([label,value,color])=>
          <div key={label} style={{padding:12,background:'#f4f8fe',border:'1px solid #dce8f6',borderRadius:10}}>
            <div style={{fontSize:10,fontWeight:850,color:'#607b9b'}}>{label}</div>
            <div style={{fontSize:18,fontWeight:900,color:color||'#214a78',marginTop:3}}>
              {label==='TRANSACTIONS'?value||0:'₹'+money(value)}
            </div>
          </div>)}
      </div>

      <div style={{margin:'20px 0 9px',display:'flex',justifyContent:'space-between',gap:10,alignItems:'end',flexWrap:'wrap'}}>
        <div>
          <h3 style={{fontSize:16,margin:'0 0 4px',color:'#193f72'}}>MONTH-WISE SUMMARY</h3>
          <div style={{fontSize:11,color:'#64748b'}}>All months for the selected bank account(s). Credit and debit are added separately; latest month first.</div>
        </div>
      </div>
      <div style={{overflowX:'auto',border:'1px solid #dce6f3',borderRadius:10}}>
        <table style={{borderCollapse:'collapse',width:'100%',minWidth:680}}>
          <thead><tr>{['MONTH','ENTRIES','TOTAL CREDIT (₹)','TOTAL DEBIT (₹)','NET CREDIT − DEBIT (₹)'].map(h=>
            <th key={h} style={{padding:'10px 9px',textAlign:'left',fontSize:11,background:'#e8f1fc',color:'#294563'}}>{h}</th>)}</tr></thead>
          <tbody>
            {!loading&&!monthly.length&&<tr><td colSpan={5} style={{padding:16,textAlign:'center',fontSize:12,color:'#64748b'}}>No monthly transactions yet.</td></tr>}
            {monthly.map((row,i)=><tr key={row.month} style={{background:row.month===focusedMonth?.month?'#eaf3ff':i%2?'#f9fbff':'#fff',borderBottom:'1px solid #e5edf6'}}>
              <td style={{padding:9,fontSize:12,fontWeight:850}}>
                <button type="button" onClick={()=>setMonthlyFocus(row.month)} style={{border:0,background:'none',color:'#15579c',fontWeight:850,textDecoration:'underline',cursor:'pointer',padding:0}} title={'View '+monthLabel(row.month)+' platform breakdown'}>
                  {monthLabel(row.month)}
                </button>
              </td>
              <td style={{padding:9,fontSize:12}}>{row.count}</td>
              <td style={{padding:9,fontSize:12,color:'#16724f',fontWeight:750}}>₹{money(row.credit)}</td>
              <td style={{padding:9,fontSize:12,color:'#a6454f',fontWeight:750}}>₹{money(row.debit)}</td>
              <td style={{padding:9,fontSize:12,fontWeight:850}}>₹{money(row.net)}</td>
            </tr>)}
            {!!monthly.length&&<tr style={{background:'#daeafb',fontWeight:900}}>
              <td style={{padding:10,fontSize:12}}>ALL MONTHS TOTAL</td>
              <td style={{padding:10,fontSize:12}}>{fullTotals.count}</td>
              <td style={{padding:10,fontSize:12}}>₹{money(fullTotals.credit)}</td>
              <td style={{padding:10,fontSize:12}}>₹{money(fullTotals.debit)}</td>
              <td style={{padding:10,fontSize:12}}>₹{money(fullTotals.net)}</td>
            </tr>}
          </tbody>
        </table>
      </div>
      {!!focusedMonth&&<div style={{marginTop:14,padding:12,background:'#f8fbff',border:'1px solid #dce6f3',borderRadius:10}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:10,marginBottom:10}}>
          <h3 style={{fontSize:14,margin:0}}>Platform-wise Addition — {monthLabel(focusedMonth.month)}</h3>
          <label style={{fontSize:11,fontWeight:800,display:'grid',gap:4,minWidth:160}}>VIEW MONTH
            <select style={input} value={focusedMonth.month} onChange={e=>setMonthlyFocus(e.target.value)}>
              {monthly.map(m=><option key={m.month} value={m.month}>{monthLabel(m.month)}</option>)}
            </select>
          </label>
        </div>
        <div style={{overflowX:'auto'}}>
          <table style={{borderCollapse:'collapse',width:'100%',minWidth:640}}>
            <thead><tr>{['PLATFORM','ENTRIES','CREDIT (₹)','DEBIT (₹)','NET (₹)'].map(h=>
              <th key={h} style={{padding:'9px 8px',fontSize:11,textAlign:'left',background:'#eaf1fa',color:'#294563'}}>{h}</th>)}</tr></thead>
            <tbody>
              {focusedMonth.parties.map((row,i)=><tr key={row.party} style={{borderBottom:'1px solid #e1eaf5',background:i%2?'#f6f9ff':'#fff'}}>
                <td style={{padding:8,fontSize:12,fontWeight:800}}>{row.party}</td>
                <td style={{padding:8,fontSize:12}}>{row.count}</td>
                <td style={{padding:8,fontSize:12,color:'#16724f'}}>₹{money(row.credit)}</td>
                <td style={{padding:8,fontSize:12,color:'#a6454f'}}>₹{money(row.debit)}</td>
                <td style={{padding:8,fontSize:12,fontWeight:800}}>₹{money(row.net)}</td>
              </tr>)}
              <tr style={{background:'#dceafc',fontWeight:900}}>
                <td style={{padding:9,fontSize:12}}>MONTH TOTAL</td>
                <td style={{padding:9,fontSize:12}}>{focusedMonth.count}</td>
                <td style={{padding:9,fontSize:12}}>₹{money(focusedMonth.credit)}</td>
                <td style={{padding:9,fontSize:12}}>₹{money(focusedMonth.debit)}</td>
                <td style={{padding:9,fontSize:12}}>₹{money(focusedMonth.net)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>}
      <h3 style={{fontSize:14,margin:'20px 0 8px'}}>Platform totals for selected detail period</h3>
      <div style={{overflowX:'auto',marginTop:14}}>
        <table style={{borderCollapse:'collapse',width:'100%',minWidth:810}}>
          <thead><tr>{['PARTY / PLATFORM','ENTRIES','TOTAL CREDIT (₹)','TOTAL DEBIT (₹)','NET (₹)','LAST CREDIT DATE'].map(h=>
            <th key={h} style={{background:'#e9f1fc',padding:'10px 8px',fontSize:11,textAlign:'left',color:'#294563'}}>{h}</th>)}</tr></thead>
          <tbody>
            {groups.map(g=><tr key={g.party} style={{background:g.party===party?'#e8f3ff':'#fff',borderBottom:'1px solid #e7edf5'}}>
              <td style={{padding:'8px',fontSize:12,fontWeight:800}}>{g.party}</td>
              <td style={{padding:'8px',fontSize:12}}>{g.count}</td>
              <td style={{padding:'8px',fontSize:12,color:'#16724f'}}>{money(g.credit)}</td>
              <td style={{padding:'8px',fontSize:12,color:'#a6454f'}}>{money(g.debit)}</td>
              <td style={{padding:'8px',fontSize:12,fontWeight:800}}>{money(g.net)}</td>
              <td style={{padding:'8px',fontSize:12}}>{g.lastCreditDate||'—'}</td>
            </tr>)}
          </tbody>
        </table>
      </div>
      <div style={{display:'flex',justifyContent:'space-between',flexWrap:'wrap',gap:6,margin:'17px 0 8px'}}>
        <h3 style={{fontSize:14,margin:0}}>Date-wise transactions {party!=='ALL'?'— '+party:''}</h3>
        <div style={{fontSize:11,color:'#64748b'}}>{loading?'Loading…':entries.length+' saved entries'} | Latest date first</div>
      </div>
      <div style={{maxHeight:430,overflow:'auto',border:'1px solid #dfe8f4',borderRadius:10}}>
        <table style={{borderCollapse:'collapse',width:'100%',minWidth:1030}}>
          <thead><tr>{['DATE','PLATFORM','BANK','CREDIT (₹)','DEBIT (₹)','MODE','REMARKS','SOURCE'].map(h=>
            <th key={h} style={{background:'#e9f1fc',position:'sticky',top:0,zIndex:1,padding:10,fontSize:10,textAlign:'left',whiteSpace:'nowrap'}}>{h}</th>)}</tr></thead>
          <tbody>
            {!loading&&!entries.length&&<tr><td colSpan={8} style={{padding:18,fontSize:12,textAlign:'center',color:'#65768f'}}>No matching transactions in this period.</td></tr>}
            {entries.map((e,i)=><tr key={e.id} style={{background:i%2?'#f8fbff':'#fff',borderBottom:'1px solid #e9eef5'}}>
              <td style={{padding:8,fontSize:11,whiteSpace:'nowrap'}}>{e.date}</td>
              <td style={{padding:8,fontSize:11,fontWeight:800}}>{e.party}</td>
              <td style={{padding:8,fontSize:11}}>{e.bankName} ({e.accountNo})</td>
              <td style={{padding:8,fontSize:11,color:'#16724f'}}>{e.credit?money(e.credit):'—'}</td>
              <td style={{padding:8,fontSize:11,color:'#a6454f'}}>{e.debit?money(e.debit):'—'}</td>
              <td style={{padding:8,fontSize:11}}>{e.mode||'—'}</td>
              <td style={{padding:8,fontSize:11,overflowWrap:'anywhere'}}>{e.remarks||'—'}</td>
              <td style={{padding:8,fontSize:10,color:'#697d98'}}>{e.partySource}</td>
            </tr>)}
          </tbody>
        </table>
      </div>
      <div style={{fontSize:11,color:'#6c7d94',marginTop:9}}>
        Earlier entries without a Party use clear names found in Remarks; otherwise they show as Unclassified.
        Enter the Party / Platform on new or edited transactions for accurate reports.
      </div>
    </>}
  </section>;
}
