'use client';
import {useEffect,useMemo,useState} from 'react';
import {subscribeProfitSourceChanges} from '../lib/profitSync.js';

const number=new Intl.NumberFormat('en-IN',{maximumFractionDigits:2});
const rupees=new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0});
const cols={client:'Customer',clientGoods:'Customer / Goods',clientOrigin:'Customer / Origin',
  goods:'Goods',description:'Goods Description',origin:'Origin',exportClient:'Client'};
const customerViews=['client','clientGoods','clientOrigin'];
const goodsViews=['goods','description','origin'];
const gridHead={fontSize:12,fontWeight:850,color:'#24466d',padding:'10px 12px',background:'#e9f1fc',borderBottom:'1px solid #d5e1f1',textAlign:'left',whiteSpace:'nowrap'};
const gridCell={padding:'9px 12px',borderBottom:'1px solid #e2e9f2',fontSize:13,verticalAlign:'top'};
const selectStyle={border:'1px solid #cbd7e8',borderRadius:9,background:'#fff',padding:'9px 11px',color:'#173358',fontWeight:700,maxWidth:'100%'};
const actionStyle={padding:'9px 14px',border:'1px solid #b8cbe3',borderRadius:9,background:'#fff',color:'#1f4d83',fontWeight:800,cursor:'pointer'};
const normalized=v=>String(v||'').trim();
const fmtNumber=n=>number.format(n||0);
const money=n=>rupees.format(n||0);
const monthLabel=key=>new Intl.DateTimeFormat('en-IN',{month:'short',year:'numeric'}).format(new Date(key+'-01T12:00:00Z'));

function dimensionLabel(row,view){
  switch(view){
    case 'clientGoods':return row.client+' / '+row.goods;
    case 'clientOrigin':return row.client+' / '+row.origin;
    case 'goods':return row.goods;
    case 'description':return row.description;
    case 'origin':return row.origin;
    case 'exportClient':case 'client':default:return row.client;
  }
}
function aggregate(rows){
  const result={weight:0,bags:0,profit:0,missingProfit:0,missingWeight:0,records:0,awbSet:new Set()};
  for(const row of rows){
    if(row.weight===null||row.weight===undefined||!Number.isFinite(Number(row.weight)))result.missingWeight++;
    else result.weight+=Number(row.weight);
    result.bags+=Number(row.bags)||0;
    if(Object.prototype.hasOwnProperty.call(row,'profit')){
      if(row.profit===null||!Number.isFinite(Number(row.profit)))result.missingProfit++;
      else result.profit+=Number(row.profit);
    }
    result.awbSet.add(row.awb);
    result.records++;
  }
  return {...result,mawbs:result.awbSet.size};
}
function groupPivot(rows,months,view){
  const groups=new Map();
  for(const row of rows){
    const key=dimensionLabel(row,view);
    if(!groups.has(key))groups.set(key,{label:key,monthly:new Map(),all:[]});
    const g=groups.get(key);
    if(!g.monthly.has(row.month))g.monthly.set(row.month,[]);
    g.monthly.get(row.month).push(row);
    g.all.push(row);
  }
  return [...groups.values()].map(g=>({
    label:g.label,totals:aggregate(g.all),
    months:new Map(months.map(m=>[m,aggregate(g.monthly.get(m)||[])]))
  }));
}
function escapedCsv(value){
  const raw=String(value??'');
  const safe=/^[=+@\-]/.test(raw)?"'"+raw:raw;
  return '"'+safe.replace(/"/g,'""')+'"';
}
function downloadExcel(rows,months,view,kind){
  const fields=[cols[view],'Total Weight (kg)',...(kind==='import'?['Total Bags','Total Calculated Profit (INR)','Profit Pending Rows']:['Total MAWBs'])];
  for(const month of months){
    fields.push(month+' Weight (kg)');
    if(kind==='import')fields.push(month+' Bags',month+' Calculated Profit (INR)',month+' Profit Pending Rows');
    else fields.push(month+' MAWBs');
  }
  const lines=[fields];
  for(const g of rows){
    const out=[g.label,g.totals.weight];
    if(kind==='import')out.push(g.totals.bags,g.totals.missingProfit?'':g.totals.profit,g.totals.missingProfit);
    else out.push(g.totals.mawbs);
    for(const month of months){
      const m=g.months.get(month);
      out.push(m.weight);
      if(kind==='import')out.push(m.bags,m.missingProfit?'':m.profit,m.missingProfit);
      else out.push(m.mawbs);
    }
    lines.push(out);
  }
  const content='\uFEFF'+lines.map(row=>row.map(escapedCsv).join(',')).join('\r\n');
  const href=URL.createObjectURL(new Blob([content],{type:'text/csv;charset=utf-8'}));
  const link=document.createElement('a');link.href=href;
  link.download='mayavi-'+kind+'-monthly-'+view+'-comparison.csv';
  document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(href);
}
function cellDescription(v,kind,hasData){
  if(!hasData)return <span style={{color:'#95a3b8'}}>—</span>;
  return <>
    <div style={{fontWeight:800,whiteSpace:'nowrap',color:'#18395f'}}>{fmtNumber(v.weight)} kg</div>
    {kind==='import'?<>
      <div style={{fontSize:11,color:'#64748b'}}>{fmtNumber(v.bags)} bags</div>
      <div style={{fontSize:12,fontWeight:800,color:v.profit<0?'#b42318':'#13734e'}}>{money(v.profit)}{v.missingProfit?' *':''}</div>
      {v.missingProfit>0?<div style={{fontSize:10,color:'#b45309'}}>{v.missingProfit} profit pending</div>:null}
    </>:<div style={{fontSize:11,color:'#64748b'}}>{v.mawbs} MAWBs</div>}
  </>;
}
export default function MonthlyComparisonDashboard({kind='import',section='customer'}){
  const isImport=kind==='import';
  const available=isImport?(section==='goods'?goodsViews:customerViews):['exportClient'];
  const [view,setView]=useState(available[0]);
  const [rows,setRows]=useState([]);
  const [months,setMonths]=useState([]);
  const [year,setYear]=useState('ALL');
  const [client,setClient]=useState('');
  const [goods,setGoods]=useState('');
  const [origin,setOrigin]=useState('');
  const [search,setSearch]=useState('');
  const [sort,setSort]=useState('weight');
  const [loading,setLoading]=useState(true);
  const [lastLoaded,setLastLoaded]=useState('');
  const [message,setMessage]=useState('');
  useEffect(()=>{
    let active=true,seq=0;
    const load=async()=>{
      const request=++seq;
      try{
        const response=await fetch('/api/monthly-comparison?type='+kind,{credentials:'include',cache:'no-store'});
        const json=await response.json();
        if(!response.ok||!json.ok)throw new Error(json.error||'Comparison report unavailable');
        if(active&&request===seq){
          setRows(Array.isArray(json.rows)?json.rows:[]);
          setMonths(Array.isArray(json.months)?json.months:[]);
          setLastLoaded(new Date().toLocaleTimeString('en-IN'));
          setMessage('');
        }
      }catch(e){if(active&&request===seq)setMessage(e?.message||'Could not load monthly comparison.');}
      finally{if(active&&request===seq)setLoading(false);}
    };
    const refresh=()=>{if(document.visibilityState!=='hidden')void load();};
    void load();
    const cancel=subscribeProfitSourceChanges(refresh);
    const interval=setInterval(refresh,60000);
    return()=>{active=false;seq++;clearInterval(interval);cancel();};
  },[kind]);
  const unique=field=>[...new Set(rows.map(r=>normalized(r[field])).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  const clients=useMemo(()=>unique('client'),[rows]);
  const origins=useMemo(()=>unique('origin'),[rows]);
  const goodsOptions=useMemo(()=>unique('goods'),[rows]);
  const years=useMemo(()=>[...new Set(months.map(m=>m.slice(0,4)))],[months]);
  const shownMonths=useMemo(()=>months.filter(m=>year==='ALL'||m.startsWith(year)),[months,year]);
  const filtered=useMemo(()=>rows.filter(r=>
    (year==='ALL'||r.month.startsWith(year))&&
    (!client||r.client===client)&&
    (!origin||r.origin===origin)&&
    (!isImport||!goods||r.goods===goods)&&
    (!search||[r.client,r.goods,r.description,r.origin,r.awb].join(' ').toLowerCase().includes(search.toLowerCase().trim()))
  ),[rows,year,client,origin,goods,search,isImport]);
  const pivot=useMemo(()=>{
    const grouped=groupPivot(filtered,shownMonths,view);
    grouped.sort((a,b)=>sort==='alpha'?a.label.localeCompare(b.label):
      sort==='profit'?b.totals.profit-a.totals.profit||a.label.localeCompare(b.label):
      b.totals.weight-a.totals.weight||a.label.localeCompare(b.label));
    return grouped;
  },[filtered,shownMonths,view,sort]);
  const overall=useMemo(()=>aggregate(filtered),[filtered]);
  const overallMonths=useMemo(()=>new Map(shownMonths.map(m=>[m,aggregate(filtered.filter(r=>r.month===m))])),[filtered,shownMonths]);
  const groupLabel=kind==='export'?'Export Client Comparison':section==='goods'?'Import Goods Comparison':'Import Customer Comparison';
  return <main className="mayavi-monthly-report" style={{padding:'20px clamp(10px,3vw,30px)',background:'#f5f8fc',color:'#172f4a',minHeight:'70vh'}}>
    <style>{`@media print{@page{size:A4 landscape;margin:9mm}body *{visibility:hidden!important}.mayavi-monthly-report,.mayavi-monthly-report *{visibility:visible!important}.mayavi-monthly-report{position:absolute!important;left:0;top:0;width:100%;padding:0!important;background:#fff!important}.mayavi-comparison-actions,.mayavi-comparison-filters{display:none!important}.mayavi-comparison-table{overflow:visible!important}table{font-size:9px!important}th,td{padding:4px!important}}`}</style>
    <div style={{maxWidth:1800,margin:'auto'}}>
      <div style={{display:'flex',justifyContent:'space-between',gap:12,flexWrap:'wrap',alignItems:'center'}}>
        <div><div style={{fontSize:11,color:'#4273b5',letterSpacing:1.2,fontWeight:900}}>MAYAVI CARGO • ADMIN ONLY</div>
          <h1 style={{fontSize:25,margin:'4px 0'}}>{groupLabel}</h1>
          <p style={{fontSize:12,color:'#64748b',margin:'3px 0'}}>From September 2026 onwards • {isImport?'Import Customs Cleared only, grouped by Arrival Date; profit uses the Import Profit Sheet formula':'Export Customs Cleared only, grouped by Handover Date'} • Updates from saved records automatically.</p>
        </div>
        <div className="mayavi-comparison-actions" style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
          <button type="button" onClick={()=>downloadExcel(pivot,shownMonths,view,kind)} disabled={!pivot.length} style={{...actionStyle,background:'#165e4b',color:'#fff',borderColor:'#165e4b',opacity:pivot.length?1:.5}}>Excel / CSV</button>
          <button type="button" onClick={()=>window.print()} disabled={!pivot.length} style={{...actionStyle,opacity:pivot.length?1:.5}}>Print / Save PDF</button>
        </div>
      </div>
      <div className="mayavi-comparison-actions" style={{display:'flex',gap:7,flexWrap:'wrap',marginTop:15}}>
        {available.map(option=><button type="button" key={option} onClick={()=>setView(option)} style={{...actionStyle,background:view===option?'#2159ab':'#fff',color:view===option?'#fff':'#245487',borderColor:view===option?'#2159ab':'#d4dfef'}}>{cols[option]}</button>)}
      </div>
      <div className="mayavi-comparison-filters" style={{display:'flex',gap:9,flexWrap:'wrap',alignItems:'center',margin:'17px 0'}}>
        <label style={{fontSize:12,fontWeight:800}}>Year <select aria-label="Report year" style={selectStyle} value={year} onChange={e=>setYear(e.target.value)}><option value="ALL">All years</option>{years.map(y=><option key={y} value={y}>{y}</option>)}</select></label>
        <label style={{fontSize:12,fontWeight:800}}>Customer <select aria-label="Filter customer" style={selectStyle} value={client} onChange={e=>setClient(e.target.value)}><option value="">All customers</option>{clients.map(v=><option key={v}>{v}</option>)}</select></label>
        {isImport?<label style={{fontSize:12,fontWeight:800}}>Goods <select aria-label="Filter goods" style={selectStyle} value={goods} onChange={e=>setGoods(e.target.value)}><option value="">All goods</option>{goodsOptions.map(v=><option key={v}>{v}</option>)}</select></label>:null}
        <label style={{fontSize:12,fontWeight:800}}>Origin <select aria-label="Filter origin" style={selectStyle} value={origin} onChange={e=>setOrigin(e.target.value)}><option value="">All origins</option>{origins.map(v=><option key={v}>{v}</option>)}</select></label>
        <label style={{fontSize:12,fontWeight:800}}>Sort <select aria-label="Sort comparison" style={selectStyle} value={sort} onChange={e=>setSort(e.target.value)}><option value="weight">Highest load</option>{isImport?<option value="profit">Highest profit</option>:null}<option value="alpha">A–Z</option></select></label>
        <input aria-label="Search MAWB, client or description" placeholder="Search client, goods, MAWB…" style={{...selectStyle,minWidth:180}} value={search} onChange={e=>setSearch(e.target.value)}/>
        <button type="button" style={actionStyle} onClick={()=>{setYear('ALL');setClient('');setGoods('');setOrigin('');setSearch('');}}>Clear filters</button>
      </div>
      <div style={{display:'flex',gap:10,flexWrap:'wrap',marginBottom:15}}>
        {[['TOTAL LOAD',fmtNumber(overall.weight)+' kg'],['MAWBs',fmtNumber(overall.mawbs)],...(isImport?[['BAGS',fmtNumber(overall.bags)],['CALCULATED PROFIT',money(overall.profit)]]:[])].map(([label,value])=>
          <div key={label} style={{flex:'1 1 160px',border:'1px solid #d8e4f2',borderRadius:12,padding:15,background:'#fff'}}>
            <div style={{fontSize:11,fontWeight:850,color:'#687a94'}}>{label}</div><div style={{fontSize:20,fontWeight:900,marginTop:6,color:label==='CALCULATED PROFIT'?'#14734d':'#15345b'}}>{value}</div>
          </div>)}
      </div>
      {isImport&&overall.missingProfit>0?<p style={{color:'#98580e',fontSize:12,marginBottom:12}}>* Profit is incomplete for {overall.missingProfit} physical row(s) because Duty, Rate, Weight or Bags are missing. These are excluded from the profit sum, but their available load is counted.</p>:null}
      {message?<p role="alert" style={{color:'#b42318',fontWeight:800}}>{message}</p>:null}
      {loading?<p>Loading monthly comparison…</p>:null}
      {!loading&&!filtered.length?<p style={{padding:18,background:'#fff',borderRadius:10}}>No recorded shipments match the selected filters and accounting months.</p>:null}
      <div className="mayavi-comparison-table" style={{overflowX:'auto',borderRadius:12,background:'#fff',border:'1px solid #d7e2f1'}}>
        <table style={{borderCollapse:'separate',borderSpacing:0,width:'100%',minWidth:Math.max(670,190+shownMonths.length*165)}}>
          <thead><tr><th style={{...gridHead,position:'sticky',left:0,zIndex:3,minWidth:165}}>{cols[view]}</th>
            {shownMonths.map(month=><th key={month} style={gridHead}>{monthLabel(month)}</th>)}
            <th style={{...gridHead,background:'#dbeafe'}}>ALL MONTHS</th>
          </tr></thead>
          <tbody>
            {pivot.map(g=><tr key={g.label}>
              <td style={{...gridCell,fontWeight:850,color:'#19518e',background:'#fff',position:'sticky',left:0,zIndex:1,overflowWrap:'anywhere',minWidth:165}}>{g.label}</td>
              {shownMonths.map(month=><td key={month} style={gridCell}>{cellDescription(g.months.get(month),kind,g.months.get(month).records>0)}</td>)}
              <td style={{...gridCell,background:'#eff7ff'}}>{cellDescription(g.totals,kind,true)}</td>
            </tr>)}
            {filtered.length>0?<tr>
              <td style={{...gridCell,fontWeight:900,background:'#dbeafe',position:'sticky',left:0}}>GRAND TOTAL</td>
              {shownMonths.map(month=><td key={month} style={{...gridCell,background:'#edf5ff'}}>{cellDescription(overallMonths.get(month),kind,overallMonths.get(month).records>0)}</td>)}
              <td style={{...gridCell,background:'#dbeafe'}}>{cellDescription(overall,kind,true)}</td>
            </tr>:null}
          </tbody>
        </table>
      </div>
      <p style={{fontSize:12,color:'#64748b',marginTop:11}}>Data refreshed {lastLoaded||'when opened'} • Unique MAWB counts are not doubled when an Import shipment has multiple physical parts. Report calculations never change source entries.</p>
    </div>
  </main>;
}
