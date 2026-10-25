'use client';
import {useEffect,useMemo,useState} from 'react';

const money=new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',minimumFractionDigits:2,maximumFractionDigits:2});
const quantity=new Intl.NumberFormat('en-IN',{maximumFractionDigits:2});
const cell={padding:'5px 6px',borderBottom:'1px solid #e3e9f2',whiteSpace:'nowrap',textAlign:'left',fontSize:12};
const header={...cell,background:'#eaf1fd',position:'sticky',top:0,zIndex:2,fontWeight:800,color:'#18345b'};
const inputStyle={width:92,boxSizing:'border-box',border:'1px solid #b6c5db',borderRadius:6,padding:'5px 6px',fontSize:12,fontWeight:700,background:'#fff',color:'#122139'};
const summaryCard={background:'#fff',padding:16,border:'1px solid #dce6f1',borderRadius:12,flex:'1 1 150px',minWidth:130};
// Colour is for easy visual recognition; the category text stays visible too.
const goodsColors={
  HH:{row:'#eff6ff',badge:'#dbeafe',text:'#1e40af'},
  PROTEIN:{row:'#f5f3ff',badge:'#ede9fe',text:'#5b21b6'},
  CLOTHES:{row:'#fff7ed',badge:'#ffedd5',text:'#9a3412'}
};
// Active Masters take priority over goods category row backgrounds.
// Goods remain recognizable by the coloured Goods dropdown.
const activeMasterColor={row:'#dcfce7',border:'#16a34a',badge:'#bbf7d0',text:'#166534'};
const dataNumber=value=>value===null||value===undefined||value===''?null:Number(value);
function figures(row={}){
  const kg=dataNumber(row.weight);
  const duty=dataNumber(row.totalDuty);
  const rate=dataNumber(row.rate);
  const eici=kg===null?null:15*kg;
  const bags=dataNumber(row.bags);
  const category=String(row.goodsCategory||'').toUpperCase();
  const origin=String(row.origin||'').trim().toUpperCase();
  // Base goods charge depends on the origin airport, not transit (Via).
  const isDxbOrigin=/(^|[^A-Z0-9])(DXB|DUBAI)($|[^A-Z0-9])/.test(origin);
  const isJfkOrigin=/(^|[^A-Z0-9])JFK($|[^A-Z0-9])/.test(origin);
  // Canadian origin names and airport codes only; a Canadian destination or
  // transit stop does not trigger the Import Protein freight deduction.
  const isCanadaOrigin=/(^|[^A-Z0-9])(CANADA|CANADIAN|TORONTO|VANCOUVER|MONTREAL|MONTRÉAL|CALGARY|EDMONTON|OTTAWA|WINNIPEG|HALIFAX|QUEBEC|QUÉBEC|VICTORIA|SASKATOON|REGINA|YYZ|YVR|YUL|YYC|YEG|YOW|YWG|YHZ|YQB|YYJ|YXE|YQR|YKF|YHM|YXX|YQG|YQM|YYT|YXS|YQT|YQR)($|[^A-Z0-9])/.test(origin);
  const isGermanyOrigin=/(^|[^A-Z0-9])(GERMANY|DEUTSCHLAND|FRANKFURT|MUNICH|MUENCHEN|MÜNCHEN|BERLIN|DUSSELDORF|DÜSSELDORF|HAMBURG|STUTTGART|COLOGNE|KOELN|KÖLN|HANOVER|HANNOVER|NUREMBERG|NUERNBERG|NÜRNBERG|LEIPZIG|DRESDEN|BREMEN|FRA|MUC|BER|DUS|HAM|STR|CGN|HAJ|NUE|LEJ|DRS|BRE|FMO|FKB|HHN)($|[^A-Z0-9])/.test(origin);
  // If Protein origin is missing, do not assume the cheaper other-origin tariff.
  const chargePerBag=category==='HH'?340:category==='CLOTHES'?1500:
    category==='PROTEIN'?(origin?(isDxbOrigin||isJfkOrigin?3000:1500):null):null;
  const goodsCharge=bags===null||chargePerBag===null?null:bags*chargePerBag;
  const totalCost=kg===null||duty===null||goodsCharge===null?null:duty+eici+goodsCharge;
  const dutyPerKg=kg>0&&duty!==null?duty/kg:null;
  // Profit is earned at the manually entered selling rate per kg, never a fixed tariff.
  // Do not show a misleading profit until all the required inputs are available.
  const proteinDeduction=category==='PROTEIN'&&kg!==null?50*kg:0;
  // Dubai freight applies ONLY when the original departure airport is DXB
  // (not when the shipment merely transits through Dubai).
  const dxbFreightDeduction=category==='PROTEIN'&&isDxbOrigin&&kg!==null?185*kg:0;
  // JFK-specific freight applies only to Protein whose master shipment origin is JFK.
  const jfkFreightDeduction=category==='PROTEIN'&&isJfkOrigin&&kg!==null?450*kg:0;
  const canadaFreightDeduction=category==='PROTEIN'&&isCanadaOrigin&&kg!==null?400*kg:0;
  const germanyFreightDeduction=category==='PROTEIN'&&isGermanyOrigin&&kg!==null?330*kg:0;
  const siibDeduction=category==='CLOTHES'&&kg!==null?30*kg:0;
  const profit=totalCost===null||rate===null?null:(rate*kg)-eici-duty-goodsCharge-proteinDeduction-dxbFreightDeduction-jfkFreightDeduction-canadaFreightDeduction-germanyFreightDeduction-siibDeduction;
  const profitPerKg=profit===null||kg===null||kg<=0?null:profit/kg;
  return {kg,bags,duty,rate,eici,goodsCharge,chargePerBag,totalCost,dutyPerKg,proteinDeduction,dxbFreightDeduction,jfkFreightDeduction,canadaFreightDeduction,germanyFreightDeduction,siibDeduction,profit,profitPerKg};
}
function displayMoney(value){return value===null||!Number.isFinite(value)?'—':money.format(value)}
function displayAmount(value){return value===null||!Number.isFinite(value)?'—':quantity.format(value)}
function downloadCsv(rows,month=''){
  const columns=['MAWB','Arrival Date','Client','Goods','Origin','Total Bags','Total Weight (kg)','Total Duty','Duty per kg','Rate (INR/kg)','EICI (15 x kg)','Goods Charge (HH 340, Protein JFK/DXB 3000, Protein other origins 1500, Clothes 1500 per bag)','Protein Deduction (50 x kg)','DXB Protein Freight (185 x kg)','JFK Protein Freight (450 x kg)','Canada Protein Freight (400 x kg)','Germany Protein Freight (330 x kg)','Clothes SIIB (30 x kg)','Total Cost (before special deductions)','Profit (Rate x Weight - EICI - Duty - Goods Charge - Protein Deduction - DXB Freight - JFK Freight - Canada Freight - Germany Freight - SIIB)','Profit per kg (Profit / Total Weight)'];
  const values=rows.map(row=>{
    const n=figures(row);
    return [row.mawb,row.arrivalDate||'',row.clientName,row.goodsCategory||'',row.origin||'',row.bags,row.weight,row.totalDuty,n.dutyPerKg,row.rate,n.eici,n.goodsCharge,n.proteinDeduction,n.dxbFreightDeduction,n.jfkFreightDeduction,n.canadaFreightDeduction,n.germanyFreightDeduction,n.siibDeduction,n.totalCost,n.profit,n.profitPerKg];
  });
  const csv=[columns,...values].map(items=>items.map(item=>{
    const raw=String(item??'');
    const safe=/^[=+@\-]/.test(raw)?"'"+raw:raw;
    return '"'+safe.replace(/"/g,'""')+'"';
  }).join(',')).join('\r\n');
  const url=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8;'}));
  const link=document.createElement('a');link.href=url;link.download='mayavi-import-profit-'+(month||'monthly')+'.csv';
  document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url);
}
export default function ImportProfitSheet(){
  const [rows,setRows]=useState([]);
  const [drafts,setDrafts]=useState({});
  const [saving,setSaving]=useState({});
  const [loading,setLoading]=useState(true);
  const [message,setMessage]=useState('');
  const [search,setSearch]=useState('');
  const [clientFilter,setClientFilter]=useState('');
  const [goodsFilter,setGoodsFilter]=useState('');
  const [rateSort,setRateSort]=useState('');
  const [period,setPeriod]=useState('');
  const [periodOptions,setPeriodOptions]=useState([]);
  const [lastLoaded,setLastLoaded]=useState('');
  useEffect(()=>{
    let active=true;
    async function load(){
      try{
        const response=await fetch('/api/import-profit'+(period?'?month='+encodeURIComponent(period):''),{credentials:'include',cache:'no-store'});
        const data=await response.json();
        if(!data.ok)throw new Error(data.error||'Could not open profit sheet.');
        if(active){setRows(data.rows||[]);setPeriodOptions(data.months||[]);setLastLoaded(new Date().toLocaleTimeString('en-IN'));setMessage(current=>current.startsWith('Unable to load')?'':current)}
      }catch(error){if(active)setMessage('Unable to load Import Profit Sheet: '+(error?.message||error))}
      finally{if(active)setLoading(false)}
    }
    load();
    const timer=setInterval(load,120000);
    return()=>{active=false;clearInterval(timer)};
  },[period]);
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
      setMessage(mawb+' • '+({totalDuty:'Total Duty',rate:'Rate',goodsCategory:'Goods'}[field]||field)+' saved.');
    }catch(error){setMessage('Not saved for '+mawb+': '+(error?.message||error))}
    finally{setSaving(previous=>({...previous,[key]:false}))}
  }
  const clientOptions=useMemo(()=>[...new Set(rows.map(r=>String(r.clientName||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b)),[rows]);
  const goodsOptions=useMemo(()=>[...new Set(rows.map(r=>String((drafts[r.mawb]?.goodsCategory??r.goodsCategory)||'').trim().toUpperCase()).filter(Boolean))].sort(),[rows,drafts]);
  const filtered=useMemo(()=>{
    const results=rows.map(effective).filter(row=>
      (!clientFilter||String(row.clientName||'').trim()===clientFilter)&&
      (!goodsFilter||String(row.goodsCategory||'').trim().toUpperCase()===goodsFilter)&&
      (!search||[row.mawb,row.clientName,row.goodsDescription].join(' ').toLowerCase().includes(search.trim().toLowerCase()))
    );
    if(rateSort)results.sort((a,b)=>{
      const aRate=figures(a).rate,bRate=figures(b).rate;
      if(aRate===null)return bRate===null?0:1;
      if(bRate===null)return -1;
      return rateSort==='asc'?aRate-bRate:bRate-aRate;
    });
    return results;
  },[rows,drafts,search,clientFilter,goodsFilter,rateSort]);
  const totals=useMemo(()=>{
    let bags=0,weight=0,duty=0,eici=0,goodsCharge=0,cost=0,profit=0,completed=0,dutyKnown=0,rateSum=0,rateKnown=0,dutyPerKgSum=0,dutyPerKgKnown=0,completedWeight=0;
    for(const row of filtered){
      const n=figures(row);
      bags+=Number(row.bags)||0;
      weight+=n.kg||0;
      if(n.eici!==null)eici+=n.eici;
      if(n.goodsCharge!==null)goodsCharge+=n.goodsCharge;
      if(n.duty!==null){duty+=n.duty;dutyKnown++}
      if(n.dutyPerKg!==null){dutyPerKgSum+=n.dutyPerKg;dutyPerKgKnown++}
      if(n.rate!==null){rateSum+=n.rate;rateKnown++}
      if(n.totalCost!==null)cost+=n.totalCost;
      if(n.profitPerKg!==null){profit+=n.profit;completedWeight+=n.kg;completed++}
    }
    return {bags,weight,duty,eici,goodsCharge,cost,profit,completed,dutyKnown,rateSum,rateKnown,dutyPerKgSum,dutyPerKgKnown,completedWeight};
  },[filtered]);
  return <main style={{padding:'20px clamp(12px,3vw,32px)',background:'#f5f8fc',minHeight:'75vh',color:'#122139'}}>
    <div style={{maxWidth:1650,margin:'auto'}}>
      <div style={{display:'flex',justifyContent:'space-between',gap:14,alignItems:'center',flexWrap:'wrap'}}>
        <div>
          <div style={{fontSize:12,letterSpacing:1.5,fontWeight:900,color:'#3464ae'}}>MAYAVI CARGO • ADMIN ONLY</div>
          <h1 style={{margin:'5px 0',fontSize:27}}>Import Profit Sheet</h1>
          <p style={{margin:'6px 0',color:'#52657f'}}>Monthly profit from October 2026 onward • Only confirmed arrivals during the selected month • One master MAWB counted once (including part shipments).</p>
        </div>
        <button onClick={()=>downloadCsv(filtered,period||periodOptions.at(-1)||'')} disabled={!filtered.length} style={{background:'#1952a5',color:'#fff',border:0,borderRadius:9,padding:'11px 15px',fontWeight:800,cursor:'pointer'}}>DOWNLOAD CSV</button>
      </div>
      <div style={{display:'flex',gap:12,flexWrap:'wrap',marginTop:16}}>
        <div style={summaryCard}><small>IMPORT MAWBs</small><div style={{fontSize:23,fontWeight:900}}>{displayAmount(filtered.length)}</div></div>
        <div style={summaryCard}><small>TOTAL BAGS</small><div style={{fontSize:23,fontWeight:900}}>{displayAmount(totals.bags)}</div></div>
        <div style={summaryCard}><small>TOTAL WEIGHT</small><div style={{fontSize:23,fontWeight:900}}>{displayAmount(totals.weight)} kg</div></div>
        <div style={summaryCard}><small>DUTY ENTERED</small><div style={{fontSize:23,fontWeight:900}}>{displayMoney(totals.duty)}</div></div>
        <div style={summaryCard}><small>PROFIT (COMPLETED ENTRIES)</small><div style={{fontSize:23,fontWeight:900,color:totals.profit<0?'#b91c1c':'#167144'}}>{displayMoney(totals.profit)}</div><small>{totals.completed} of {filtered.length} entries calculated</small></div>
      </div>
      <div style={{display:'flex',flexWrap:'wrap',gap:12,justifyContent:'space-between',alignItems:'center',margin:'18px 0 12px'}}>
        <div style={{display:'flex',flexWrap:'wrap',gap:9,alignItems:'center'}}>
          <label htmlFor="import-profit-period" style={{fontSize:12,fontWeight:800}}>ARRIVAL MONTH</label>
          <select id="import-profit-period" aria-label="Import profit arrival month" value={period||periodOptions.at(-1)||''} onChange={e=>{setPeriod(e.target.value);setRows([]);setLoading(true);setDrafts({});setClientFilter('');setGoodsFilter('');setSearch('')}} style={{padding:'11px 12px',minWidth:155,border:'1px solid #cbd5e1',borderRadius:8,background:'#fff',fontWeight:700}}>
            {periodOptions.map(key=><option key={key} value={key}>{new Date(key+'-01T12:00:00').toLocaleDateString('en-IN',{month:'long',year:'numeric'})}</option>)}
          </select>
          <label htmlFor="import-profit-client-filter" style={{fontSize:12,fontWeight:800}}>CLIENT</label>
          <select id="import-profit-client-filter" aria-label="Filter Import Profit Sheet by Client" value={clientFilter} onChange={e=>setClientFilter(e.target.value)}
            style={{padding:'11px 12px',minWidth:175,border:'1px solid #cbd5e1',borderRadius:8,background:'#fff',fontWeight:700}}>
            <option value="">All Clients ({clientOptions.length})</option>
            {clientOptions.map(client=><option key={client} value={client}>{client}</option>)}
          </select>
          <label htmlFor="import-profit-goods-filter" style={{fontSize:12,fontWeight:800}}>GOODS</label>
          <select id="import-profit-goods-filter" aria-label="Filter Import Profit Sheet by Goods" value={goodsFilter} onChange={e=>setGoodsFilter(e.target.value)}
            style={{padding:'11px 12px',minWidth:130,border:'1px solid #cbd5e1',borderRadius:8,background:'#fff',fontWeight:700}}>
            <option value="">All Goods</option>
            {goodsOptions.map(goods=><option key={goods} value={goods}>{goods==='HH'?'HH':goods==='PROTEIN'?'Protein':goods==='CLOTHES'?'Clothes':goods}</option>)}
          </select>
          <input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search MAWB, client, goods" style={{padding:'11px 12px',minWidth:'min(260px,100%)',border:'1px solid #cbd5e1',borderRadius:8}}/>
          {(clientFilter||goodsFilter||search)&&<button type="button" onClick={()=>{setClientFilter('');setGoodsFilter('');setSearch('')}} style={{border:'1px solid #b8c6db',borderRadius:8,background:'#fff',padding:'11px'}}>CLEAR FILTERS</button>}
        </div>
        <small style={{color:'#64748b'}}>Updated: {lastLoaded||'—'} • Automatically checks Import every 2 minutes</small>
      </div>
      <div style={{display:'flex',gap:10,flexWrap:'wrap',alignItems:'center',margin:'4px 0 10px'}}>
        <span style={{background:activeMasterColor.badge,color:activeMasterColor.text,border:'1px solid '+activeMasterColor.border,fontSize:12,fontWeight:900,padding:'4px 9px',borderRadius:6}}>ACTIVE MASTER (light green row)</span>
        <small style={{fontWeight:800,color:'#52657f'}}>OTHER ROWS / GOODS COLOURS:</small>
        {Object.entries(goodsColors).map(([type,style])=><span key={type} style={{background:style.badge,color:style.text,fontSize:12,fontWeight:800,padding:'4px 9px',borderRadius:6}}>{type==='HH'?'HH':type==='PROTEIN'?'Protein':'Clothes'}</span>)}
      </div>
      {message&&<p role="status" style={{padding:'9px 12px',background:'#eaf0fa',borderRadius:8,color:'#173e6f'}}>{message}</p>}
      <div style={{overflowX:'auto',background:'#fff',border:'1px solid #dae4f0',borderRadius:12}}>
        <table style={{width:'100%',borderCollapse:'separate',borderSpacing:0}}>
          <thead><tr>
            {['S.No.','MAWB','Arrival Date','Client','Goods','Bags (Total)','Weight (kg)','Total Duty (₹)','Duty/kg (₹)','Rate (₹/kg)','EICI 15 × kg','Goods Charge (₹)','Total Cost (₹)','Profit (₹)','Profit per kg (₹/kg)'].map(label=><th key={label} style={header}>
              {label==='Rate (₹/kg)'?<button type="button" aria-label="Sort by rate ascending or descending" title="Tap to sort rate (ascending / descending / original)" onClick={()=>setRateSort(current=>current===''?'asc':current==='asc'?'desc':'')} style={{border:0,padding:0,font:'inherit',fontWeight:800,color:'inherit',background:'transparent',cursor:'pointer',whiteSpace:'nowrap'}}>Rate (₹/kg) {rateSort==='asc'?'▲':rateSort==='desc'?'▼':'↕'}</button>:label}
            </th>)}
          </tr></thead>
          <tbody>
            {filtered.map((row,index)=>{
              const n=figures(row);
              const active=row.isActiveMaster===true;
              return <tr key={row.mawb} title={active?'Import Active Masters — not fully customs cleared':'Not in Import Active Masters'} style={{background:active?activeMasterColor.row:(goodsColors[String(row.goodsCategory||'').toUpperCase()]?.row||'#fff')}}>
                <td style={{...cell,borderLeft:active?'4px solid '+activeMasterColor.border:'4px solid transparent',paddingLeft:4}}>{index+1}</td>
                <td style={{...cell,fontWeight:800}}>{row.mawb}{active&&<small style={{marginLeft:6,padding:'2px 5px',background:activeMasterColor.badge,color:activeMasterColor.text,borderRadius:4,fontWeight:800,fontSize:10}}>ACTIVE</small>}</td>
                <td style={cell}>{row.arrivalDate||'—'}</td>
                <td style={cell}>{row.clientName||'—'}</td>
                <td style={cell}>
                  <select aria-label={'Goods for '+row.mawb} value={row.goodsCategory||''}
                    onChange={e=>{const value=e.target.value;
                      setDrafts(previous=>({...previous,[row.mawb]:{...(previous[row.mawb]||{}),goodsCategory:value}}));
                      void save(row.mawb,'goodsCategory',value);
                    }}
                    disabled={Boolean(saving[row.mawb+':goodsCategory'])}
                    title={row.goodsDescription||'Choose goods type'}
                    style={{...inputStyle,width:108,background:goodsColors[String(row.goodsCategory||'').toUpperCase()]?.badge||'#fff',color:goodsColors[String(row.goodsCategory||'').toUpperCase()]?.text||'#122139',borderColor:goodsColors[String(row.goodsCategory||'').toUpperCase()]?.text||'#b6c5db'}}>
                    <option value="">Select Goods</option>
                    <option value="HH">HH</option>
                    <option value="PROTEIN">Protein</option>
                    <option value="CLOTHES">Clothes</option>
                  </select>
                </td>
                <td style={cell}>{displayAmount(dataNumber(row.bags))}</td>
                <td style={{...cell,fontWeight:700}}>{displayAmount(n.kg)}</td>
                {['totalDuty'].map(field=><td key={field} style={cell}><input aria-label={'Total Duty for '+row.mawb} type="number" min="0" step="any" value={row[field]??''} onChange={e=>setDrafts(previous=>({...previous,[row.mawb]:{...(previous[row.mawb]||{}),[field]:e.target.value}}))} onBlur={e=>save(row.mawb,field,e.target.value)} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur()}} disabled={Boolean(saving[row.mawb+':'+field])} placeholder="Enter duty" style={inputStyle}/></td>)}
                <td style={cell}>{n.dutyPerKg===null?'—':money.format(n.dutyPerKg)}</td>
                {['rate'].map(field=><td key={field} style={cell}>
                  <div style={{display:'flex',alignItems:'center',gap:2}}>
                    <input aria-label={'Rate for '+row.mawb} type="number" inputMode="decimal" min="0" step="0.01" value={row[field]??''}
                      onChange={e=>setDrafts(previous=>({...previous,[row.mawb]:{...(previous[row.mawb]||{}),[field]:e.target.value}}))}
                      onBlur={e=>save(row.mawb,field,e.target.value)}
                      onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur()}}
                      disabled={Boolean(saving[row.mawb+':'+field])}
                      placeholder="Enter rate" style={{...inputStyle,width:83}}/>
                    <div style={{display:'flex',flexDirection:'column',gap:1}}>
                      {[0.01,-0.01].map(delta=><button key={delta} type="button" title={delta>0?'Increase rate by ₹0.01':'Decrease rate by ₹0.01'} aria-label={(delta>0?'Increase':'Decrease')+' rate for '+row.mawb}
                        disabled={Boolean(saving[row.mawb+':'+field])}
                        onPointerDown={e=>e.preventDefault()}
                        onClick={()=>{
                          const next=(Math.max(0,Math.round(((Number(row[field])||0)+delta)*100)/100)).toFixed(2);
                          setDrafts(previous=>({...previous,[row.mawb]:{...(previous[row.mawb]||{}),[field]:next}}));
                          void save(row.mawb,field,next);
                        }}
                        style={{border:'1px solid #cbd5e1',borderRadius:4,background:'#f8fafc',color:'#23456a',height:16,minWidth:20,fontSize:10,lineHeight:'12px',cursor:'pointer',padding:0}}>{delta>0?'▲':'▼'}</button>)}
                    </div>
                  </div>
                </td>)}
                <td style={cell}>{displayMoney(n.eici)}</td>
                <td style={{...cell,fontWeight:800}}>{displayMoney(n.goodsCharge)}<small style={{display:'block',color:'#64748b'}}>{n.chargePerBag===null?(String(row.goodsCategory||'').toUpperCase()==='PROTEIN'&&!String(row.origin||'').trim()?'Origin needed':'Select goods to calculate'):money.format(n.chargePerBag)+'/bag'}</small></td>
                <td style={{...cell,fontWeight:800}}>{displayMoney(n.totalCost)}</td>
                <td title={[n.proteinDeduction>0?'Protein ₹50/kg deduction: '+displayMoney(n.proteinDeduction):'',n.dxbFreightDeduction>0?'Dubai freight ₹185/kg deduction: '+displayMoney(n.dxbFreightDeduction):'',n.jfkFreightDeduction>0?'JFK freight ₹450/kg deduction: '+displayMoney(n.jfkFreightDeduction):'',n.canadaFreightDeduction>0?'Canada freight ₹400/kg deduction: '+displayMoney(n.canadaFreightDeduction):'',n.germanyFreightDeduction>0?'Germany freight ₹330/kg deduction: '+displayMoney(n.germanyFreightDeduction):'',n.siibDeduction>0?'Clothes SIIB ₹30/kg deduction: '+displayMoney(n.siibDeduction):''].filter(Boolean).join(' • ')} style={{...cell,fontWeight:900,color:n.profit===null?'#64748b':n.profit<0?'#b91c1c':'#14804b'}}>{displayMoney(n.profit)}{n.dxbFreightDeduction>0&&<span style={{marginLeft:5,fontSize:10,color:'#7c3aed'}}>DXB</span>}{n.jfkFreightDeduction>0&&<span style={{marginLeft:5,fontSize:10,color:'#0369a1'}}>JFK</span>}{n.canadaFreightDeduction>0&&<span style={{marginLeft:5,fontSize:10,color:'#2563eb'}}>CAN</span>}{n.germanyFreightDeduction>0&&<span style={{marginLeft:5,fontSize:10,color:'#047857'}}>GER</span>}</td>
                <td style={{...cell,fontWeight:800,color:n.profitPerKg===null?'#64748b':n.profitPerKg<0?'#b91c1c':'#14804b'}}>{displayMoney(n.profitPerKg)}</td>
              </tr>
            })}
            {!filtered.length&&<tr><td colSpan={15} style={{padding:28,textAlign:'center',color:'#64748b'}}>{loading?'Loading existing Import shipments…':'No Import MAWB found.'}</td></tr>}
          </tbody>
          {filtered.length>0&&<tfoot><tr style={{background:'#eaf1fd',fontWeight:900}}>
            <td colSpan={5} style={cell}>TOTAL • {filtered.length} MAWBs</td>
            <td style={cell}>{displayAmount(totals.bags)}</td>
            <td style={cell}>{displayAmount(totals.weight)}</td>
            <td style={cell}>{displayMoney(totals.duty)}</td>
            <td style={cell}>{totals.dutyPerKgKnown?displayMoney(totals.dutyPerKgSum):'—'}</td>
            <td style={cell}>{totals.rateKnown?displayMoney(totals.rateSum):'—'}</td>
            <td style={cell}>{displayMoney(totals.eici)}</td>
            <td style={cell}>{displayMoney(totals.goodsCharge)}</td>
            <td style={cell}>{displayMoney(totals.cost)}</td>
            <td style={{...cell,color:totals.profit<0?'#b91c1c':'#14804b'}}>{displayMoney(totals.profit)}</td>
            <td style={{...cell,color:totals.profit<0?'#b91c1c':'#14804b'}} title="Total profit divided by the weight of rows with calculated profit">{totals.completedWeight>0?displayMoney(totals.profit/totals.completedWeight):'—'}</td>
          </tr></tfoot>}
        </table>
      </div>
      <p style={{fontSize:12,color:'#52657f',marginTop:12}}>
        Duty/kg = Total Duty ÷ Total Weight • EICI = ₹15 × Total Weight • Goods Charge = HH ₹340/bag, Protein originating from JFK or DXB ₹3,000/bag, Protein from other known origins ₹1,500/bag, or Clothes ₹1,500/bag • Total Cost = Duty + EICI + Goods Charge • Profit = (Manual Rate × Total Weight) − EICI − Total Duty − Goods Charge − (₹50 × Total Weight for Protein only) − (₹185 × Total Weight for Protein originating from DXB/Dubai only) − (₹450 × Total Weight for Protein originating from JFK only) − (₹400 × Total Weight for Protein originating from Canada, including Canadian airports such as YYZ/YVR/YUL/YYC) − (₹330 × Total Weight for Protein originating from Germany, including German airports such as FRA/MUC/BER/DUS) − (₹30 × Total Weight for Clothes as SIIB). DXB, JFK, Canada and Germany refer to shipment Origin, not an intermediate Via stop or the destination. Total Cost remains the original Duty + EICI + Goods Charge; special deductions apply to Profit only. Rate is the selling rate per kg. Total Cost remains blank until Duty, Goods, Weight and Bags are available; Profit additionally requires Rate. Profit per kg = Profit ÷ Total Weight (kg); the footer Profit per kg = Total calculated Profit ÷ Total Weight of entries with calculated profit (not the sum of individual per-kg figures). Rate can be entered manually with decimals (up to 4 places); the ▲/▼ controls change it by ₹0.01. The footer adds each numeric column, including the entered Rate and Duty/kg values (these are sums, not average rates). Active Import Masters are highlighted with a light green row and green left border. Cleared rows retain their goods-based colours. Blank amounts are excluded. Totals respect the selected Arrival Month, Client, Goods and search filters. Past months before October 2026 are excluded; arrivals must be confirmed, not estimated.
      </p>
    </div>
  </main>;
}
