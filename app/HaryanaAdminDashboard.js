'use client';

import {useEffect,useMemo,useState} from 'react';
import {statusLabel} from '../lib/branchLoads.js';

const money=value=>Number(value||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
const kg=value=>Number(String(value||0).split('/')[0]||0).toLocaleString('en-IN',{maximumFractionDigits:3});
const dash=value=>value===null||value===undefined||String(value).trim()===''?'—':String(value);
const date=value=>value?String(value).slice(0,10).split('-').reverse().join('/'):'—';
const pill={padding:'8px 13px',border:'1px solid #cbd5e1',borderRadius:9,background:'#fff',fontWeight:750,cursor:'pointer',color:'#1e3a5f'};
const cell={padding:'9px 11px',borderBottom:'1px solid #e2e8f0',whiteSpace:'nowrap',verticalAlign:'top'};
const card={border:'1px solid #dce4f1',borderRadius:14,background:'#fff',padding:'14px 16px'};
const scroll={maxWidth:'100%',overflowX:'auto',border:'1px solid #e2e8f0',borderRadius:12,background:'#fff'};
const heading={background:'#f0f5ff',color:'#1e3a5f',fontSize:12,textTransform:'uppercase',letterSpacing:'.025em',textAlign:'left',position:'sticky',top:0};
const rupees=value=>'₹'+money(value);
function Table({headers,rows,empty='No records found'}){
  return <div style={scroll}><table style={{borderCollapse:'collapse',minWidth:'100%',fontSize:12}}>
    <thead style={heading}><tr>{headers.map(h=><th key={h} style={cell}>{h}</th>)}</tr></thead>
    <tbody>{rows.length?rows.map((r,i)=><tr key={r.key||i} style={{background:i%2?'#f8fafc':'#fff'}}>{r.cells.map((v,j)=><td key={j} style={cell}>{v}</td>)}</tr>):
    <tr><td style={{...cell,textAlign:'center',padding:26}} colSpan={headers.length}>{empty}</td></tr>}</tbody>
  </table></div>;
}
export default function HaryanaAdminDashboard(){
  const [tab,setTab]=useState('BRANCHES');
  const [sheet,setSheet]=useState('ACTIVE');
  const [branch,setBranch]=useState('ALL');
  const [search,setSearch]=useState('');
  const [data,setData]=useState({branchLoads:[],activeMasters:[]});
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [updatedAt,setUpdatedAt]=useState('');
  useEffect(()=>{
    let active=true;
    async function refresh(){
      try{
        const res=await fetch('/api/haryana-admin',{credentials:'include',cache:'no-store'});
        const payload=await res.json();
        if(!res.ok||!payload.ok)throw new Error(payload.error||'Data unavailable');
        if(active){setData({branchLoads:payload.branchLoads||[],activeMasters:payload.activeMasters||[]});setUpdatedAt(payload.updatedAt);setError('');}
      }catch(e){if(active)setError(e.message||'Unable to refresh data.');}
      finally{if(active)setLoading(false);}
    }
    void refresh();
    const timer=setInterval(()=>void refresh(),60000);
    return()=>{active=false;clearInterval(timer);};
  },[]);
  async function refresh(){
    setLoading(true);
    try{
      const res=await fetch('/api/haryana-admin',{credentials:'include',cache:'no-store'});
      const p=await res.json();if(!res.ok||!p.ok)throw new Error(p.error||'Unable to refresh.');
      setData({branchLoads:p.branchLoads||[],activeMasters:p.activeMasters||[]});
      setUpdatedAt(p.updatedAt);setError('');
    }catch(e){setError(e.message||'Unable to refresh.');}finally{setLoading(false);}
  }
  const list=useMemo(()=>data.branchLoads.filter(r=>(branch==='ALL'||r.branch===branch)&&
    (sheet==='SUMMARY'||(sheet==='DELIVERED'?r.status==='DELIVERED':r.status!=='DELIVERED'))&&
    [r.branch,r.date,r.destination,r.service,r.commodity,r.trackingNo,r.remarks,r.createdBy,r.confirmationNo].join(' ').toLowerCase().includes(search.toLowerCase())),[data.branchLoads,branch,sheet,search]);
  const masters=useMemo(()=>data.activeMasters.filter(r=>[r.mawb,r.airline,r.client,r.company,r.goods,r.origin,r.destination,r.flightNo,r.status].join(' ').toLowerCase().includes(search.toLowerCase())),[data.activeMasters,search]);
  const totals=useMemo(()=>list.reduce((a,r)=>({
    weight:a.weight+Number(r.weight||0),amount:a.amount+Number(r.amount||0),
    received:a.received+Number(r.received||0),balance:a.balance+Number(r.balance||0),
    jepo:a.jepo+Number(r.totalJepo||0),branch:a.branch+Number(r.paidToBranch||0)
  }),{weight:0,amount:0,received:0,balance:0,jepo:0,branch:0}),[list]);
  const summary=useMemo(()=>{
    const map=new Map();
    for(const r of list){
      const key=r.date+'|'+r.branch;
      const x=map.get(key)||{key,date:r.date,branch:r.branch,count:0,weight:0,amount:0,received:0,jepo:0,branchAmount:0};
      x.count++;x.weight+=Number(r.weight||0);x.amount+=Number(r.amount||0);x.received+=Number(r.received||0);
      x.jepo+=Number(r.totalJepo||0);x.branchAmount+=Number(r.paidToBranch||0);map.set(key,x);
    }
    return [...map.values()].sort((a,b)=>b.date.localeCompare(a.date)||a.branch.localeCompare(b.branch));
  },[list]);
  const branchRows=list.map(r=>({key:r.id,cells:[
    r.branch,date(r.date),kg(r.weight),rupees(r.rate),rupees(r.amount),rupees(r.received),rupees(r.balance),
    rupees(r.jepoRate),rupees(r.paidToJepo),rupees(r.paidToBranch),rupees(r.extraCost),rupees(r.totalJepo),
    dash(r.destination),dash(r.service),dash(r.commodity),dash(r.bottleCount),dash(r.trackingNo),
    statusLabel(r.status),dash(r.createdBy),dash(r.updatedBy),dash(r.remarks),
    dash(r.confirmationMode),dash(r.confirmationNo),dash(r.confirmationName),dash(r.confirmationDecision)
  ]}));
  const masterRows=masters.map(r=>({key:r.mawb,cells:[
    <strong key="awb">{r.mawb}</strong>,dash(r.client),dash(r.airline),dash(r.goods),dash(r.company),
    dash(r.origin),dash(r.via),dash(r.destination),dash(r.flightNo),date(r.flightDate),
    dash(r.weight),dash(r.bags),dash(r.status),date(r.bookingDate),
    date(r.departureDate)+' '+dash(r.departureTime),
    date(r.arrivalDate)+' '+dash(r.arrivalTime),dash(r.enteredBy),
    r.parts.length?<details key="parts"><summary>{r.parts.length} active part(s)</summary>{r.parts.map((p,i)=><div key={i} style={{padding:5}}>Part {i+1}: {dash(p.bags)} bags / {dash(p.weight)} kg / {dash(p.flightNo)} / {date(p.arrivalDate)} {dash(p.arrivalTime)} / {dash(p.status)}</div>)}</details>:'—',
    dash(r.remarks)
  ]}));
  return <main style={{padding:'18px clamp(12px,3vw,32px)',background:'#f5f7fc',minHeight:'85vh',fontFamily:'Arial,sans-serif',color:'#15263b'}}>
    <header style={{display:'flex',justifyContent:'space-between',gap:15,alignItems:'center',flexWrap:'wrap',marginBottom:16}}>
      <div><div style={{fontSize:11,fontWeight:800,color:'#64748b',letterSpacing:2}}>MAYAVI • SECURE VIEWER</div>
      <h1 style={{margin:'6px 0',fontSize:25}}>Haryana Admin Dashboard</h1>
      <p style={{margin:'0',color:'#64748b',fontSize:13}}>Live, read-only access to Jind &amp; Karnal and Import Active Masters.</p></div>
      <button type="button" style={pill} onClick={refresh} disabled={loading}>{loading?'Loading…':'Refresh data'}</button>
    </header>
    <nav aria-label="Haryana Admin tabs" style={{display:'flex',gap:9,flexWrap:'wrap',marginBottom:16}}>
      <button style={{...pill,background:tab==='BRANCHES'?'#1d4ed8':'#fff',color:tab==='BRANCHES'?'#fff':'#1e3a5f'}} onClick={()=>{setTab('BRANCHES');setSearch('');}}>JIND &amp; KARNAL DATA</button>
      <button style={{...pill,background:tab==='MASTERS'?'#1d4ed8':'#fff',color:tab==='MASTERS'?'#fff':'#1e3a5f'}} onClick={()=>{setTab('MASTERS');setSearch('');}}>IMPORT ACTIVE MASTERS</button>
    </nav>
    {error&&<p role="alert" style={{color:'#b91c1c',fontWeight:700}}>{error}</p>}
    {updatedAt&&<p style={{fontSize:12,color:'#64748b'}}>Last updated: {new Date(updatedAt).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',hour12:false})} IST</p>}
    <section style={{display:'flex',gap:10,flexWrap:'wrap',marginBottom:14,alignItems:'center'}}>
      {tab==='BRANCHES'&&<>
        <label>Branch <select value={branch} onChange={e=>setBranch(e.target.value)} style={{padding:9,borderRadius:8,marginLeft:8}}><option value="ALL">Both branches</option><option value="JIND">Jind</option><option value="KARNAL">Karnal</option></select></label>
        <div style={{display:'flex',gap:7}}>
          {['ACTIVE','DELIVERED','SUMMARY'].map(x=><button type="button" key={x} style={{...pill,background:sheet===x?'#dbeafe':'#fff'}} onClick={()=>setSheet(x)}>{x==='ACTIVE'?'Active Loads':x==='DELIVERED'?'Delivered':'Daily Summary'}</button>)}
        </div>
      </>}
      <input type="search" placeholder={tab==='MASTERS'?'Search MAWB, client, airline…':'Search loads, dates, tracking…'} value={search} onChange={e=>setSearch(e.target.value)} style={{padding:10,border:'1px solid #cbd5e1',borderRadius:9,minWidth:220,flex:'1 1 230px'}}/>
    </section>
    {tab==='BRANCHES'?<>
      <div style={{display:'flex',gap:10,flexWrap:'wrap',marginBottom:14}}>
        {[['Loads',list.length],['Weight (kg)',kg(totals.weight)],['Total Amount',rupees(totals.amount)],['Received',rupees(totals.received)],['Balance',rupees(totals.balance)],['Paid to JEPO',rupees(totals.jepo)],['Paid to Branch',rupees(totals.branch)]].map(([label,value])=><div key={label} style={{...card,flex:'1 1 130px'}}><div style={{fontSize:11,color:'#64748b'}}>{label}</div><strong style={{fontSize:18}}>{value}</strong></div>)}
      </div>
      {sheet==='SUMMARY'?<Table headers={['Date','Branch','Loads','Weight (kg)','Total Amount','Received','Total JEPO','Paid to Branch']} rows={summary.map(r=>({key:r.key,cells:[date(r.date),r.branch,r.count,kg(r.weight),rupees(r.amount),rupees(r.received),rupees(r.jepo),rupees(r.branchAmount)]}))}/>:
      <Table headers={['Branch','Date','Load (kg)','Rate/kg','Amount','Received','Balance','JEPO Rate/kg','Paid to JEPO','Paid to Branch','Extra Cost','Total JEPO','Destination','Service','Commodity','Bottles','Tracking No.','Status','Entered By','Updated By','Remarks','Payment Mode','UTR / Confirmation No.','Confirmation Name','Admin Decision']} rows={branchRows}/>}
    </>:<>
      <div style={{...card,display:'inline-block',marginBottom:14}}><span style={{fontSize:12,color:'#64748b'}}>Active Import Masters </span><strong style={{fontSize:21}}>{masters.length}</strong></div>
      <Table headers={['MAWB','Client','Airline','Goods','Company','Origin','Via','Destination','Flight','Flight Date','Weight (kg)','Bags','Status','Booking Date','Departure (IST)','Arrival (IST)','Entered By','Part Loads','Remarks']} rows={masterRows} empty="No active import masters found."/>
    </>}
    <p style={{fontSize:12,color:'#64748b',marginTop:18}}>View only • No editing, deletion, approval, or cargo refresh permissions.</p>
  </main>;
}
