'use client';
import {useEffect,useMemo,useState} from 'react';

const money=new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',minimumFractionDigits:2,maximumFractionDigits:2});
const number=new Intl.NumberFormat('en-IN',{maximumFractionDigits:2});
const cell={padding:'6px 9px',borderBottom:'1px solid #e3e9f2',fontSize:13,textAlign:'left',whiteSpace:'nowrap'};
const header={...cell,position:'sticky',top:0,zIndex:1,background:'#eaf1fd',fontWeight:800,color:'#18345b'};
const summary={background:'#fff',padding:16,border:'1px solid #dce6f1',borderRadius:12,flex:'1 1 190px'};
const SHIPMENT_CHARGE=1000; // Fixed once per master Export MAWB, not once per part shipment.
function showMoney(value){return value===null||!Number.isFinite(value)?'—':money.format(value)}
function showWeight(value){return value===null||!Number.isFinite(value)?'—':number.format(value)}
function profitFor(weight){
  const value=Number(weight);
  return weight===null||weight===''||!Number.isFinite(value)||value<=0?null:Math.round((value*6-SHIPMENT_CHARGE)*100)/100;
}
function exportCsv(rows){
  const columns=['MAWB No.','Company Name','Weight (kg)','Rate (INR/kg)','Shipment Charge (INR per MAWB)','Profit (INR)'];
  const data=rows.map(r=>[r.mawb,r.companyName||'',r.weight??'',r.weight===null?'':6,SHIPMENT_CHARGE,profitFor(r.weight)??'']);
  const csv=[columns,...data].map(items=>items.map(v=>{
    const raw=String(v??'');
    const safe=/^[=+@\-]/.test(raw)?"'"+raw:raw;
    return '"'+safe.replace(/"/g,'""')+'"';
  }).join(',')).join('\r\n');
  const url=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'}));
  const link=document.createElement('a');
  link.href=url;link.download='mayavi-export-profit-sheet.csv';
  document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url);
}
export default function ExportProfitSheet(){
  const [rows,setRows]=useState([]);
  const [loading,setLoading]=useState(true);
  const [message,setMessage]=useState('');
  const [companyFilter,setCompanyFilter]=useState('');
  const [search,setSearch]=useState('');
  const [lastLoaded,setLastLoaded]=useState('');
  useEffect(()=>{
    let active=true;
    async function load(){
      try{
        const response=await fetch('/api/export-profit',{credentials:'include',cache:'no-store'});
        const data=await response.json();
        if(!data.ok)throw new Error(data.error||'Could not load Export Profit Sheet.');
        if(active){
          setRows(data.rows||[]);
          setLastLoaded(new Date().toLocaleTimeString('en-IN'));
          setMessage('');
        }
      }catch(error){if(active)setMessage('Unable to load Export Profit Sheet: '+(error?.message||error))}
      finally{if(active)setLoading(false)}
    }
    load();
    const timer=setInterval(load,120000);
    return()=>{active=false;clearInterval(timer)};
  },[]);
  const companyOptions=useMemo(()=>[...new Set(rows.map(r=>String(r.companyName||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b)),[rows]);
  const filtered=useMemo(()=>rows.filter(row=>
    (!companyFilter||row.companyName===companyFilter)&&
    (!search||[row.mawb,row.companyName].join(' ').toLowerCase().includes(search.trim().toLowerCase()))
  ),[rows,companyFilter,search]);
  const totals=useMemo(()=>filtered.reduce((acc,r)=>{
    const p=profitFor(r.weight);
    acc.count++;
    acc.shipmentCharges+=SHIPMENT_CHARGE;
    if(p!==null){acc.weight+=Number(r.weight);acc.profit+=p;acc.valid++}
    return acc;
  },{count:0,weight:0,shipmentCharges:0,profit:0,valid:0}),[filtered]);
  return <main style={{padding:'20px clamp(12px,3vw,32px)',background:'#f5f8fc',minHeight:'75vh',color:'#122139'}}>
    <div style={{maxWidth:1500,margin:'auto'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:14,flexWrap:'wrap'}}>
        <div>
          <div style={{fontSize:12,letterSpacing:1.5,fontWeight:900,color:'#3464ae'}}>MAYAVI CARGO • ADMIN ONLY</div>
          <h1 style={{margin:'5px 0',fontSize:27}}>Export Profit Sheet</h1>
          <p style={{margin:'6px 0',color:'#52657f'}}>One row per Export MAWB • Profit = (Total Weight × ₹6/kg) − ₹1,000 shipment charge</p>
        </div>
        <button type="button" disabled={!filtered.length} onClick={()=>exportCsv(filtered)} style={{background:'#1952a5',color:'#fff',border:0,borderRadius:9,padding:'11px 15px',fontWeight:800,cursor:'pointer'}}>DOWNLOAD CSV</button>
      </div>
      <div style={{display:'flex',gap:12,flexWrap:'wrap',marginTop:16}}>
        <div style={summary}><small>EXPORT MAWBs</small><div style={{fontSize:23,fontWeight:900}}>{number.format(totals.count)}</div></div>
        <div style={summary}><small>TOTAL WEIGHT (KNOWN)</small><div style={{fontSize:23,fontWeight:900}}>{showWeight(totals.weight)} kg</div></div>
        <div style={summary}><small>SHIPMENT CHARGES ({totals.count} × ₹1,000)</small><div style={{fontSize:23,fontWeight:900}}>{showMoney(totals.shipmentCharges)}</div></div>
        <div style={summary}><small>TOTAL PROFIT (CALCULATED)</small><div style={{fontSize:23,fontWeight:900,color:totals.profit<0?'#b91c1c':'#14804b'}}>{showMoney(totals.profit)}</div><small>{totals.valid} of {totals.count} MAWBs calculated</small></div>
      </div>
      <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap',margin:'18px 0 12px'}}>
        <label htmlFor="export-profit-company" style={{fontSize:12,fontWeight:800}}>COMPANY</label>
        <select id="export-profit-company" value={companyFilter} onChange={e=>setCompanyFilter(e.target.value)} style={{padding:'10px',minWidth:170,border:'1px solid #cbd5e1',borderRadius:8,background:'#fff'}}>
          <option value="">All Companies</option>
          {companyOptions.map(name=><option key={name} value={name}>{name}</option>)}
        </select>
        <input type="search" aria-label="Search Export MAWB or company" placeholder="Search MAWB or company" value={search} onChange={e=>setSearch(e.target.value)} style={{padding:'10px',minWidth:220,border:'1px solid #cbd5e1',borderRadius:8}}/>
        {(companyFilter||search)&&<button type="button" onClick={()=>{setCompanyFilter('');setSearch('')}} style={{padding:10,background:'#fff',border:'1px solid #cbd5e1',borderRadius:8}}>CLEAR FILTERS</button>}
        <small style={{color:'#64748b',marginLeft:'auto'}}>Updated: {lastLoaded||'—'} • Checks every 2 minutes</small>
      </div>
      {message&&<p role="status" style={{background:'#eaf0fa',color:'#173e6f',padding:10,borderRadius:8}}>{message}</p>}
      <div style={{overflowX:'auto',background:'#fff',border:'1px solid #dae4f0',borderRadius:12}}>
        <table style={{width:'100%',borderCollapse:'separate',borderSpacing:0}}>
          <thead><tr>{['S.No.','MAWB No.','Company Name','Weight (kg)','Rate (₹/kg)','Shipment Charge (₹)','Profit (₹)'].map(label=><th key={label} style={header}>{label}</th>)}</tr></thead>
          <tbody>
            {filtered.map((row,index)=><tr key={row.mawb}>
              <td style={cell}>{index+1}</td>
              <td style={{...cell,fontWeight:800}}>{row.mawb}</td>
              <td style={cell}>{row.companyName||'—'}</td>
              <td style={cell}>{showWeight(row.weight)}</td>
              <td style={cell}>₹6.00</td>
              <td style={{...cell,fontWeight:800}}>{showMoney(SHIPMENT_CHARGE)}</td>
              <td style={{...cell,fontWeight:900,color:profitFor(row.weight)!==null&&profitFor(row.weight)<0?'#b91c1c':'#14804b'}}>{showMoney(profitFor(row.weight))}</td>
            </tr>)}
            {!filtered.length&&<tr><td colSpan={7} style={{padding:28,textAlign:'center',color:'#64748b'}}>{loading?'Loading Export shipments…':'No Export MAWB found.'}</td></tr>}
          </tbody>
          {filtered.length>0&&<tfoot><tr style={{background:'#eaf1fd',fontWeight:900}}>
            <td colSpan={3} style={cell}>TOTAL • {filtered.length} MAWBs</td>
            <td style={cell}>{showWeight(totals.weight)}</td>
            <td style={cell}>₹6.00 /kg</td>
            <td style={cell}>{showMoney(totals.shipmentCharges)}</td>
            <td style={{...cell,color:totals.profit<0?'#b91c1c':'#14804b'}}>{showMoney(totals.profit)}</td>
          </tr></tfoot>}
        </table>
      </div>
      <p style={{fontSize:12,color:'#52657f',marginTop:12}}>Rate is fixed at ₹6/kg for every Export MAWB. Each distinct master MAWB has a fixed ₹1,000 shipment charge, deducted ONCE even when the shipment has several parts. Profit = (Weight × ₹6) − ₹1,000; negative profit is displayed as a loss. Shipment-charge totals cover every displayed MAWB. If weight is missing, its profit stays blank and the total calculated profit includes only MAWBs with known weights; the total will update when the missing weights arrive. The company filter changes all displayed totals.</p>
    </div>
  </main>;
}
