'use client';
import {useEffect,useMemo,useState} from 'react';

const money=new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',minimumFractionDigits:2,maximumFractionDigits:2});
const quantity=new Intl.NumberFormat('en-IN',{maximumFractionDigits:2});
const cell={padding:'10px 9px',borderBottom:'1px solid #e3e9f2',whiteSpace:'nowrap',textAlign:'left',fontSize:13};
const header={...cell,background:'#eaf1fd',position:'sticky',top:0,zIndex:2,fontWeight:800,color:'#18345b'};
const inputStyle={width:112,boxSizing:'border-box',border:'1px solid #b6c5db',borderRadius:7,padding:'8px',fontWeight:700,background:'#fff',color:'#122139'};
const summaryCard={background:'#fff',padding:16,border:'1px solid #dce6f1',borderRadius:12,flex:'1 1 150px',minWidth:130};
const dataNumber=value=>value===null||value===undefined||value===''?null:Number(value);
function figures(row={}){
  const kg=dataNumber(row.weight);
  const duty=dataNumber(row.totalDuty);
  const eici=kg===null?null:16*kg;
  const charge14=kg===null?null:14*kg;
  const totalCost=kg===null||duty===null?null:duty+eici+charge14;
  const dutyPerKg=kg>0&&duty!==null?duty/kg:null;
  const profit=totalCost===null?null:58*kg-totalCost;
  return {kg,duty,eici,charge14,totalCost,dutyPerKg,profit};
}
function displayMoney(value){return value===null||!Number.isFinite(value)?'—':money.format(value)}
function displayAmount(value){return value===null||!Number.isFinite(value)?'—':quantity.format(value)}
function downloadCsv(rows){
  const columns=['MAWB','Client','Total Bags','Total Weight (kg)','Total Duty','Duty per kg','Rate','EICI (16 x kg)','14 x kg','Total Cost','Profit (58 x kg - Total Cost)'];
  const values=rows.map(row=>{
    const n=figures(row);
    return [row.mawb,row.clientName,row.bags,row.weight,row.totalDuty,n.dutyPerKg,row.rate,n.eici,n.charge14,n.totalCost,n.profit];
  });
  const csv=[columns,...values].map(items=>items.map(item=>{
    const raw=String(item??'');
    const safe=/^[=+@\-]/.test(raw)?"'"+raw:raw;
    return '"'+safe.replace(/"/g,'""')+'"';
  }).join(',')).join('\r\n');
  const url=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8;'}));
  const link=document.createElement('a');link.href=url;link.download='mayavi-import-profit-sheet.csv';
  document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url);
}
export default function ImportProfitSheet(){
  const [rows,setRows]=useState([]);
  const [drafts,setDrafts]=useState({});
  const [saving,setSaving]=useState({});
  const [loading,setLoading]=useState(true);
  const [message,setMessage]=useState('');
  const [search,setSearch]=useState('');
  const [lastLoaded,setLastLoaded]=useState('');
  useEffect(()=>{
    let active=true;
    async function load(){
      try{
        const response=await fetch('/api/import-profit',{credentials:'include',cache:'no-store'});
        const data=await response.json();
        if(!data.ok)throw new Error(data.error||'Could not open profit sheet.');
        if(active){setRows(data.rows||[]);setLastLoaded(new Date().toLocaleTimeString('en-IN'));setMessage(current=>current.startsWith('Unable to load')?'':current)}
      }catch(error){if(active)setMessage('Unable to load Import Profit Sheet: '+(error?.message||error))}
      finally{if(active)setLoading(false)}
    }
    load();
    const timer=setInterval(load,120000);
    return()=>{active=false;clearInterval(timer)};
  },[]);
  function effective(row){
    return {...row,...(drafts[row.mawb]||{})};
  }
  async function save(mawb,field,value){
    const key=mawb+':'+field;
    if(saving[key])return;
    const current=rows.find(row=>row.mawb===mawb);
    if(current&&String(current[field]??'')===String(value??'')){
      setDrafts(previous=>{const next={...previous},fields={...(next[mawb]||{})};delete fields[field];if(Object.keys(fields).length)next[mawb]=fields;else delete next[mawb];return next});
      return;
    }
    setSaving(previous=>({...previous,[key]:true}));
    setMessage('');
    try{
      const response=await fetch('/api/import-profit',{method:'PATCH',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({mawb,field,value})});
      const data=await response.json();
      if(!data.ok)throw new Error(data.error||'Save failed');
      setRows(previous=>previous.map(row=>row.mawb===mawb?{...row,[field]:data.value}:row));
      setDrafts(previous=>{const next={...previous},fields={...(next[mawb]||{})};if(String(fields[field]??'')===String(value??''))delete fields[field];if(Object.keys(fields).length)next[mawb]=fields;else delete next[mawb];return next});
      setMessage(mawb+' • '+(field==='totalDuty'?'Total Duty':'Rate')+' saved.');
    }catch(error){setMessage('Not saved for '+mawb+': '+(error?.message||error))}
    finally{setSaving(previous=>({...previous,[key]:false}))}
  }
  const filtered=useMemo(()=>rows.map(effective).filter(row=>!search||[row.mawb,row.clientName].join(' ').toLowerCase().includes(search.trim().toLowerCase())),[rows,drafts,search]);
  const totals=useMemo(()=>{
    let bags=0,weight=0,duty=0,eici=0,charge14=0,cost=0,profit=0,completed=0;
    for(const row of filtered){
      const n=figures(row);
      bags+=Number(row.bags)||0;
      weight+=n.kg||0;
      if(n.eici!==null)eici+=n.eici;
      if(n.charge14!==null)charge14+=n.charge14;
      if(n.totalCost!==null){duty+=n.duty;cost+=n.totalCost;profit+=n.profit;completed++}
    }
    return {bags,weight,duty,eici,charge14,cost,profit,completed};
  },[filtered]);
  return <main style={{padding:'20px clamp(12px,3vw,32px)',background:'#f5f8fc',minHeight:'75vh',color:'#122139'}}>
    <div style={{maxWidth:1650,margin:'auto'}}>
      <div style={{display:'flex',justifyContent:'space-between',gap:14,alignItems:'center',flexWrap:'wrap'}}>
        <div>
          <div style={{fontSize:12,letterSpacing:1.5,fontWeight:900,color:'#3464ae'}}>MAYAVI CARGO • ADMIN ONLY</div>
          <h1 style={{margin:'5px 0',fontSize:27}}>Import Profit Sheet</h1>
          <p style={{margin:'6px 0',color:'#52657f'}}>One row per MAWB. Total weight and bags sync from Import automatically, including part shipments.</p>
        </div>
        <button onClick={()=>downloadCsv(filtered)} disabled={!filtered.length} style={{background:'#1952a5',color:'#fff',border:0,borderRadius:9,padding:'11px 15px',fontWeight:800,cursor:'pointer'}}>DOWNLOAD CSV</button>
      </div>
      <div style={{display:'flex',gap:12,flexWrap:'wrap',marginTop:16}}>
        <div style={summaryCard}><small>IMPORT MAWBs</small><div style={{fontSize:23,fontWeight:900}}>{displayAmount(filtered.length)}</div></div>
        <div style={summaryCard}><small>TOTAL BAGS</small><div style={{fontSize:23,fontWeight:900}}>{displayAmount(totals.bags)}</div></div>
        <div style={summaryCard}><small>TOTAL WEIGHT</small><div style={{fontSize:23,fontWeight:900}}>{displayAmount(totals.weight)} kg</div></div>
        <div style={summaryCard}><small>DUTY ENTERED</small><div style={{fontSize:23,fontWeight:900}}>{displayMoney(totals.duty)}</div></div>
        <div style={summaryCard}><small>PROFIT (COMPLETED ENTRIES)</small><div style={{fontSize:23,fontWeight:900,color:totals.profit<0?'#b91c1c':'#167144'}}>{displayMoney(totals.profit)}</div><small>{totals.completed} of {filtered.length} entries calculated</small></div>
      </div>
      <div style={{display:'flex',flexWrap:'wrap',gap:12,justifyContent:'space-between',alignItems:'center',margin:'18px 0 12px'}}>
        <input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Filter by MAWB or client name" style={{padding:'11px 12px',minWidth:'min(300px,100%)',border:'1px solid #cbd5e1',borderRadius:8}}/>
        <small style={{color:'#64748b'}}>Updated: {lastLoaded||'—'} • Automatically checks Import every 2 minutes</small>
      </div>
      {message&&<p role="status" style={{padding:'9px 12px',background:'#eaf0fa',borderRadius:8,color:'#173e6f'}}>{message}</p>}
      <div style={{overflowX:'auto',background:'#fff',border:'1px solid #dae4f0',borderRadius:12}}>
        <table style={{width:'100%',borderCollapse:'separate',borderSpacing:0}}>
          <thead><tr>
            {['S.No.','MAWB','Client','Bags (Total)','Weight (kg)','Total Duty (₹)','Duty/kg (₹)','Rate (₹)','EICI 16 × kg','14 × kg','Total Cost (₹)','Profit (₹)'].map(label=><th key={label} style={header}>{label}</th>)}
          </tr></thead>
          <tbody>
            {filtered.map((row,index)=>{
              const n=figures(row);
              return <tr key={row.mawb}>
                <td style={cell}>{index+1}</td>
                <td style={{...cell,fontWeight:800}}>{row.mawb}</td>
                <td style={cell}>{row.clientName||'—'}</td>
                <td style={cell}>{displayAmount(dataNumber(row.bags))}</td>
                <td style={{...cell,fontWeight:700}}>{displayAmount(n.kg)}</td>
                {['totalDuty'].map(field=><td key={field} style={cell}><input aria-label={'Total Duty for '+row.mawb} type="number" min="0" step="any" value={row[field]??''} onChange={e=>setDrafts(previous=>({...previous,[row.mawb]:{...(previous[row.mawb]||{}),[field]:e.target.value}}))} onBlur={e=>save(row.mawb,field,e.target.value)} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur()}} disabled={Boolean(saving[row.mawb+':'+field])} placeholder="Enter duty" style={inputStyle}/></td>)}
                <td style={cell}>{n.dutyPerKg===null?'—':money.format(n.dutyPerKg)}</td>
                {['rate'].map(field=><td key={field} style={cell}><input aria-label={'Rate for '+row.mawb} type="number" min="0" step="any" value={row[field]??''} onChange={e=>setDrafts(previous=>({...previous,[row.mawb]:{...(previous[row.mawb]||{}),[field]:e.target.value}}))} onBlur={e=>save(row.mawb,field,e.target.value)} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur()}} disabled={Boolean(saving[row.mawb+':'+field])} placeholder="Enter rate" style={inputStyle}/></td>)}
                <td style={cell}>{displayMoney(n.eici)}</td>
                <td style={cell}>{displayMoney(n.charge14)}</td>
                <td style={{...cell,fontWeight:800}}>{displayMoney(n.totalCost)}</td>
                <td style={{...cell,fontWeight:900,color:n.profit===null?'#64748b':n.profit<0?'#b91c1c':'#14804b'}}>{displayMoney(n.profit)}</td>
              </tr>
            })}
            {!filtered.length&&<tr><td colSpan={12} style={{padding:28,textAlign:'center',color:'#64748b'}}>{loading?'Loading existing Import shipments…':'No Import MAWB found.'}</td></tr>}
          </tbody>
          {filtered.length>0&&<tfoot><tr style={{background:'#eaf1fd',fontWeight:900}}>
            <td colSpan={3} style={cell}>TOTAL</td>
            <td style={cell}>{displayAmount(totals.bags)}</td>
            <td style={cell}>{displayAmount(totals.weight)}</td>
            <td style={cell}>{displayMoney(totals.duty)}</td>
            <td style={cell}>{totals.weight>0?displayMoney(totals.duty/totals.weight):'—'}</td>
            <td style={cell}>—</td>
            <td style={cell}>{displayMoney(totals.eici)}</td>
            <td style={cell}>{displayMoney(totals.charge14)}</td>
            <td style={cell}>{displayMoney(totals.cost)}</td>
            <td style={{...cell,color:totals.profit<0?'#b91c1c':'#14804b'}}>{displayMoney(totals.profit)}</td>
          </tr></tfoot>}
        </table>
      </div>
      <p style={{fontSize:12,color:'#52657f',marginTop:12}}>
        Duty/kg = Total Duty ÷ Total Weight • EICI = 16 × Total Weight • Other charge = 14 × Total Weight • Total Cost = Duty + EICI + Other charge • Profit = (58 × Total Weight) − Total Cost. Rate is manual and informational. Total Cost and Profit remain blank until duty is entered.
      </p>
    </div>
  </main>;
}
