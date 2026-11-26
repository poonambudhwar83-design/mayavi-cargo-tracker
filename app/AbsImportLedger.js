'use client';
import {useEffect,useState} from 'react';
const API='/api/abs-import-ledger';
const money=v=>Number(v||0).toLocaleString('en-IN',{style:'currency',currency:'INR',minimumFractionDigits:2});
const qty=v=>v===null?'—':Number(v||0).toLocaleString('en-IN',{maximumFractionDigits:4});
const awb=v=>String(v||'').replace(/^(\d{3})(\d{8})$/,'$1-$2');
const date=v=>String(v||'').split('-').reverse().join('-');
const card={background:'#fff',border:'1px solid #dce5ee',borderRadius:12,padding:16,marginBottom:16};
const button={background:'#2055a2',color:'#fff',border:0,borderRadius:8,padding:'10px 14px',fontWeight:700,cursor:'pointer'};
const input={padding:'9px 10px',border:'1px solid #aebfd1',borderRadius:7,maxWidth:'100%'};
const cell={padding:'9px 10px',borderBottom:'1px solid #e2e8f0',whiteSpace:'nowrap',textAlign:'left'};
const heading={...cell,background:'#eaf1fb',color:'#163c68'};
function Table({headers,rows,empty}){
  return <div style={{overflowX:'auto'}}><table style={{borderCollapse:'collapse',width:'100%',fontSize:13}}><thead><tr>{headers.map(h=><th key={h} style={heading}>{h}</th>)}</tr></thead><tbody>{rows.map((r,i)=><tr key={i}>{r.map((v,j)=><td key={j} style={cell}>{v}</td>)}</tr>)}{!rows.length&&<tr><td style={cell} colSpan={headers.length}>{empty}</td></tr>}</tbody></table></div>;
}
function Summary({t}){
  return <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))',gap:12,marginBottom:16}}>{[['Total billed',money(t.billed)],['Total received',money(t.received)],['Outstanding',money(t.outstanding)],['Advance / credit',money(t.advance)],['MAWBs',t.mawbs]].map(([name,value])=><div key={name} style={{...card,marginBottom:0}}><div style={{fontSize:12,color:'#47627d'}}>{name}</div><strong style={{fontSize:20,color:'#153b65'}}>{value}</strong></div>)}</div>;
}
export default function AbsImportLedger({view}){
  const [data,setData]=useState(null),[error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  const [selected,setSelected]=useState([]),[search,setSearch]=useState('');
  const [payment,setPayment]=useState({date:'',mode:'ACCOUNT',amount:'',remarks:''}),[receiptId,setReceiptId]=useState('');
  async function load(){
    const r=await fetch(API,{credentials:'include',cache:'no-store'}),j=await r.json();
    if(!r.ok||!j.ok)throw Error(j.error||'Unable to load ledger');
    setData(j);setPayment(p=>({...p,date:p.date||j.today}));
    setSelected(old=>old.filter(k=>j.candidates.some(m=>m.entryKey===k)));
    return j;
  }
  useEffect(()=>{load().catch(e=>setError(e.message));},[]);
  async function refresh(){setError('');try{await load();}catch(e){setError(e.message);}}
  async function post(body){
    const r=await fetch(API,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),j=await r.json();
    if(!r.ok||!j.ok)throw Error(j.error||'Unable to save');
    return j;
  }
  async function importSelected(){
    setBusy(true);setError('');setMessage('');
    try{const j=await post({action:'IMPORT',awbs:selected});setSelected([]);setMessage(j.added+' cleared entries imported.');await load();}catch(e){setError(e.message);}finally{setBusy(false);}
  }
  async function savePayment(e){
    e.preventDefault();setBusy(true);setError('');setMessage('');
    const id=receiptId||crypto.randomUUID();setReceiptId(id);
    try{await post({action:'RECEIPT',id,...payment});setReceiptId('');setPayment(p=>({...p,amount:'',remarks:''}));setMessage('Payment saved and verified.');await load();}catch(e){setError(e.message);}finally{setBusy(false);}
  }
  const candidates=(data?.candidates||[]).filter(m=>!search||m.awb.includes(search.replace(/\D/g,'')));
  const selectable=candidates.filter(m=>m.amount!==null).map(m=>m.entryKey);
  return <main style={{padding:'18px clamp(10px,3vw,32px)',background:'#f5f8fc',color:'#172b42',minHeight:300}}>
    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,flexWrap:'wrap',marginBottom:12}}><h2 style={{margin:0}}>ABS • {view==='LEDGER'?'Client Ledger':'Client Balance'}</h2><button style={button} disabled={busy} onClick={refresh}>Refresh</button></div>
    <p style={{fontSize:13,color:'#47627d'}}>ABS only • Manual setup until 02 Dec 2026 • Auto-import of new customs-cleared MAWBs / parts from 03 Dec 2026. Historical receipts and selected MAWBs must be entered once; old ledger records are not copied into this new ledger.</p>
    {error&&<p role="alert" style={{color:'#a21c22'}}>{error}</p>}{message&&<p role="status" style={{color:'#167344'}}>{message}</p>}
    {!data?<p>Loading ABS ledger…</p>:<>
      <Summary t={data.totals}/>
      {view==='LEDGER'?<>
        <section style={card}><h3 style={{marginTop:0}}>Import MAWBs from Import Profit Sheet</h3><p style={{fontSize:13}}>Select customs-cleared ABS masters or individual cleared parts. Each physical entry is billed once, using its saved weight and rate. Missing rates must be entered in Import Profit Sheet.</p>
          <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:12}}><input style={input} placeholder="Search MAWB" value={search} onChange={e=>setSearch(e.target.value)}/><button style={button} disabled={busy||!selectable.length} onClick={()=>setSelected(old=>[...new Set([...old,...selectable])].slice(0,500))}>Select visible</button><button style={button} disabled={busy||!selected.length} onClick={()=>setSelected([])}>Clear selection</button><button style={button} disabled={busy||!selected.length} onClick={importSelected}>Import selected ({selected.length})</button></div>
          <Table headers={['Select','MAWB','Part','Arrival','Cleared','Billed kg','Rate/kg','Amount']} rows={candidates.map(m=>[<input type="checkbox" aria-label={'Select '+awb(m.awb)} checked={selected.includes(m.entryKey)} disabled={m.amount===null||busy} onChange={e=>setSelected(old=>e.target.checked?[...new Set([...old,m.entryKey])].slice(0,500):old.filter(k=>k!==m.entryKey))}/>,awb(m.awb),m.partLabel||'Full',date(m.arrivalDate),date(m.clearanceDate),qty(m.weight),m.rate===null?'Rate missing':money(m.rate),m.amount===null?'Pending rate':money(m.amount)])} empty="No eligible unimported ABS MAWBs."/>
        </section>
        <section style={card}><h3 style={{marginTop:0}}>Add lump-sum payment received</h3><p style={{fontSize:13}}>Record each bank or cash receipt only once, including past receipts for the selected historical MAWBs. No MAWB allocation is required.</p>
          <form onSubmit={savePayment} style={{display:'flex',gap:12,alignItems:'end',flexWrap:'wrap'}}>{[['Payment date','date','date'],['Amount (INR)','amount','number'],['Reference / remarks','remarks','text']].map(([label,key,type])=><label key={key} style={{display:'grid',gap:5,fontSize:12}}>{label}<input style={input} required={key!=='remarks'} type={type} min={key==='amount'?'0.01':undefined} step={key==='amount'?'0.01':undefined} max={key==='date'?data.today:undefined} value={payment[key]} onChange={e=>setPayment(p=>({...p,[key]:e.target.value}))}/></label>)}<label style={{display:'grid',gap:5,fontSize:12}}>Mode<select style={input} value={payment.mode} onChange={e=>setPayment(p=>({...p,mode:e.target.value}))}><option value="ACCOUNT">Bank / Account</option><option value="CASH">Cash</option></select></label><button style={button} disabled={busy} type="submit">Save payment</button></form>
        </section>
        <section style={card}><h3 style={{marginTop:0}}>Running ledger • oldest first</h3><Table headers={['Date','Type','MAWB / Payment','Weight kg','Rate','Debit','Credit','Balance','Remarks / Source']} rows={data.rows.map(r=>[date(r.date),r.type,r.type==='MAWB'?awb(r.reference)+(r.partLabel?' • '+r.partLabel:''):r.reference,r.type==='MAWB'?qty(r.weight):'—',r.type==='MAWB'?money(r.rate):'—',r.debit?money(r.debit):'—',r.credit?money(r.credit):'—',money(r.balance),r.remarks||r.source||''])} empty="No entries yet."/></section>
      </>:<>
        <section style={card}><h3 style={{marginTop:0}}>Client-wise balance</h3><Table headers={['Client','MAWBs','Billed kg','Total billed','Cash received','Bank received','Total received','Net balance']} rows={[[ 'ABS',data.totals.mawbs,qty(data.totals.weight),money(data.totals.billed),money(data.totals.cash),money(data.totals.account),money(data.totals.received),money(data.totals.balance)]]} empty="No balance yet."/><p style={{fontSize:13}}>Positive balance = amount due; negative balance = advance. Payments are not assumed to settle individual MAWBs.</p></section>
        <section style={card}><h3 style={{marginTop:0}}>Billed MAWBs</h3><Table headers={['Date','MAWB','Part','Billed kg','Rate','Billed amount','Source']} rows={data.invoices.map(i=>[date(i.date),awb(i.awb),i.part_label||'Full',qty(i.weight),money(i.rate),money(i.amount),i.source])} empty="No imported MAWBs yet."/></section>
        <section style={card}><h3 style={{marginTop:0}}>Amount received history</h3><Table headers={['Date','Mode','Amount','Reference / remarks']} rows={data.receipts.map(r=>[date(r.date),r.mode,money(r.amount),r.remarks])} empty="No receipts yet."/></section>
      </>}
    </>}
  </main>;
}
