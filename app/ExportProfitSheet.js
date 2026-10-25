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
function profitFor(row={}){
  const value=Number(row.weight);
  const rate=Number(row.rate)||6;
  return row.weight===null||row.weight===''||!Number.isFinite(value)||value<=0?null:Math.round((value*rate-SHIPMENT_CHARGE)*100)/100;
}
function exportCsv(rows,month=''){
  const columns=['MAWB No.','Handover Date','Client Name','Weight (kg)','Rate (INR/kg)','Shipment Charge (INR per MAWB)','Profit (INR)'];
  const data=rows.map(r=>[r.mawb,r.handoverDate||'',r.clientName||'',r.weight??'',r.rate??6,SHIPMENT_CHARGE,profitFor(r)??'']);
  const csv=[columns,...data].map(items=>items.map(v=>{
    const raw=String(v??'');
    const safe=/^[=+@\-]/.test(raw)?"'"+raw:raw;
    return '"'+safe.replace(/"/g,'""')+'"';
  }).join(',')).join('\r\n');
  const url=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'}));
  const link=document.createElement('a');
  link.href=url;link.download='mayavi-export-profit-'+(month||'monthly')+'.csv';
  document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url);
}
export default function ExportProfitSheet(){
  const [rows,setRows]=useState([]);
  const [loading,setLoading]=useState(true);
  const [message,setMessage]=useState('');
  const [clientFilter,setClientFilter]=useState('');
  const [period,setPeriod]=useState('');
  const [periodOptions,setPeriodOptions]=useState([]);
  const [search,setSearch]=useState('');
  const [lastLoaded,setLastLoaded]=useState('');
  useEffect(()=>{
    let active=true;
    async function load(){
      try{
        const response=await fetch('/api/export-profit'+(period?'?month='+encodeURIComponent(period):''),{credentials:'include',cache:'no-store'});
        const data=await response.json();
        if(!data.ok)throw new Error(data.error||'Could not load Export Profit Sheet.');
        if(active){
          setRows(data.rows||[]);
          setPeriodOptions(data.months||[]);
          setLastLoaded(new Date().toLocaleTimeString('en-IN'));
          setMessage('');
        }
      }catch(error){if(active)setMessage('Unable to load Export Profit Sheet: '+(error?.message||error))}
      finally{if(active)setLoading(false)}
    }
    load();
    const timer=setInterval(load,120000);
    return()=>{active=false;clearInterval(timer)};
  },[period]);
  const clientOptions=useMemo(()=>[...new Set(rows.map(r=>String(r.clientName||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b)),[rows]);
  const filtered=useMemo(()=>rows.filter(row=>
    (!clientFilter||row.clientName===clientFilter)&&
    (!search||[row.mawb,row.clientName].join(' ').toLowerCase().includes(search.trim().toLowerCase()))
  ),[rows,clientFilter,search]);
  const totals=useMemo(()=>filtered.reduce((acc,r)=>{
    const p=profitFor(r);
    acc.count++;
    acc.rateSum+=Number(r.rate)||6;
    acc.shipmentCharges+=SHIPMENT_CHARGE;
    if(p!==null){acc.weight+=Number(r.weight);acc.profit+=p;acc.valid++}
    return acc;
  },{count:0,weight:0,rateSum:0,shipmentCharges:0,profit:0,valid:0}),[filtered]);
  return <main style={{padding:'20px clamp(12px,3vw,32px)',background:'#f5f8fc',minHeight:'75vh',color:'#122139'}}>
    <div style={{maxWidth:1500,margin:'auto'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:14,flexWrap:'wrap'}}>
        <div>
          <div style={{fontSize:12,letterSpacing:1.5,fontWeight:900,color:'#3464ae'}}>MAYAVI CARGO • ADMIN ONLY</div>
          <h1 style={{margin:'5px 0',fontSize:27}}>Export Profit Sheet</h1>
          <p style={{margin:'6px 0',color:'#52657f'}}>October 2026 onward • By handover month • DHL client ₹19/kg • Overseas client ₹7/kg • Others ₹6/kg • Less ₹1,000 per MAWB</p>
        </div>
        <button type="button" disabled={!filtered.length} onClick={()=>exportCsv(filtered,period||periodOptions.at(-1)||'')} style={{background:'#1952a5',color:'#fff',border:0,borderRadius:9,padding:'11px 15px',fontWeight:800,cursor:'pointer'}}>DOWNLOAD CSV</button>
      </div>
      <div style={{display:'flex',gap:12,flexWrap:'wrap',marginTop:16}}>
        <div style={summary}><small>EXPORT MAWBs</small><div style={{fontSize:23,fontWeight:900}}>{number.format(totals.count)}</div></div>
        <div style={summary}><small>TOTAL WEIGHT (KNOWN)</small><div style={{fontSize:23,fontWeight:900}}>{showWeight(totals.weight)} kg</div></div>
        <div style={summary}><small>SHIPMENT CHARGES ({totals.count} × ₹1,000)</small><div style={{fontSize:23,fontWeight:900}}>{showMoney(totals.shipmentCharges)}</div></div>
        <div style={summary}><small>TOTAL PROFIT (CALCULATED)</small><div style={{fontSize:23,fontWeight:900,color:totals.profit<0?'#b91c1c':'#14804b'}}>{showMoney(totals.profit)}</div><small>{totals.valid} of {totals.count} MAWBs calculated</small></div>
      </div>
      <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap',margin:'18px 0 12px'}}>
        <label htmlFor="export-profit-period" style={{fontSize:12,fontWeight:800}}>HANDOVER MONTH</label>
        <select id="export-profit-period" aria-label="Export profit handover month" value={period||periodOptions.at(-1)||''} onChange={e=>{setPeriod(e.target.value);setRows([]);setLoading(true);setClientFilter('');setSearch('')}} style={{padding:'10px',minWidth:155,border:'1px solid #cbd5e1',borderRadius:8,background:'#fff',fontWeight:700}}>
          {periodOptions.map(key=><option key={key} value={key}>{new Date(key+'-01T12:00:00').toLocaleDateString('en-IN',{month:'long',year:'numeric'})}</option>)}
        </select>
        <label htmlFor="export-profit-client" style={{fontSize:12,fontWeight:800}}>CLIENT</label>
        <select id="export-profit-client" value={clientFilter} onChange={e=>setClientFilter(e.target.value)} style={{padding:'10px',minWidth:170,border:'1px solid #cbd5e1',borderRadius:8,background:'#fff'}}>
          <option value="">All Clients</option>
          {clientOptions.map(name=><option key={name} value={name}>{name}</option>)}
        </select>
        <input type="search" aria-label="Search Export MAWB or client" placeholder="Search MAWB or client" value={search} onChange={e=>setSearch(e.target.value)} style={{padding:'10px',minWidth:220,border:'1px solid #cbd5e1',borderRadius:8}}/>
        {(clientFilter||search)&&<button type="button" onClick={()=>{setClientFilter('');setSearch('')}} style={{padding:10,background:'#fff',border:'1px solid #cbd5e1',borderRadius:8}}>CLEAR FILTERS</button>}
        <small style={{color:'#64748b',marginLeft:'auto'}}>Updated: {lastLoaded||'—'} • Checks every 2 minutes</small>
      </div>
      {message&&<p role="status" style={{background:'#eaf0fa',color:'#173e6f',padding:10,borderRadius:8}}>{message}</p>}
      <div style={{overflowX:'auto',background:'#fff',border:'1px solid #dae4f0',borderRadius:12}}>
        <table style={{width:'100%',borderCollapse:'separate',borderSpacing:0}}>
          <thead><tr>{['S.No.','MAWB No.','Handover Date','Client Name','Weight (kg)','Rate (₹/kg)','Shipment Charge (₹)','Profit (₹)'].map(label=><th key={label} style={header}>{label}</th>)}</tr></thead>
          <tbody>
            {filtered.map((row,index)=><tr key={row.mawb}>
              <td style={cell}>{index+1}</td>
              <td style={{...cell,fontWeight:800}}>{row.mawb}</td>
              <td style={cell}>{row.handoverDate||'—'}</td>
              <td style={cell}>{row.clientName||'—'}</td>
              <td style={cell}>{showWeight(row.weight)}</td>
              <td style={cell}>{showMoney(Number(row.rate)||6)}</td>
              <td style={{...cell,fontWeight:800}}>{showMoney(SHIPMENT_CHARGE)}</td>
              <td style={{...cell,fontWeight:900,color:profitFor(row)!==null&&profitFor(row)<0?'#b91c1c':'#14804b'}}>{showMoney(profitFor(row))}</td>
            </tr>)}
            {!filtered.length&&<tr><td colSpan={8} style={{padding:28,textAlign:'center',color:'#64748b'}}>{loading?'Loading Export shipments…':'No Export MAWB found.'}</td></tr>}
          </tbody>
          {filtered.length>0&&<tfoot><tr style={{background:'#eaf1fd',fontWeight:900}}>
            <td colSpan={4} style={cell}>TOTAL • {filtered.length} MAWBs</td>
            <td style={cell}>{showWeight(totals.weight)}</td>
            <td style={cell} title="Sum of rates (not average)">{showMoney(totals.rateSum)}</td>
            <td style={cell}>{showMoney(totals.shipmentCharges)}</td>
            <td style={{...cell,color:totals.profit<0?'#b91c1c':'#14804b'}}>{showMoney(totals.profit)}</td>
          </tr></tfoot>}
        </table>
      </div>
      <p style={{fontSize:12,color:'#52657f',marginTop:12}}>DHL clients earn ₹19/kg; Overseas clients earn ₹7/kg; other clients earn ₹6/kg. Profit = (Weight × client rate) − ₹1,000. Every distinct Export MAWB has a fixed ₹1,000 shipment charge deducted once even for part shipments. October 2026 is the first month; the sheet is organized by the handover deadline (5 hours before departure), or by recorded handover time if the deadline is unavailable. The Rate footer adds the rate entries and is not an average. Negative profit is displayed as a loss. Shipment-charge totals cover every displayed MAWB. If weight is missing, its profit stays blank and the total calculated profit includes only MAWBs with known weights; the total will update when the missing weights arrive. The selected month and client filter change all displayed totals.</p>
    </div>
  </main>;
}
