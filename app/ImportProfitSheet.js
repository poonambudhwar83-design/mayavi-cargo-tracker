'use client';
import {useEffect,useMemo,useState} from 'react';
import { subscribeProfitSourceChanges } from '../lib/profitSync.js';
import {proteinHandlingRate} from '../lib/importProteinDeduction.js';
import {importFreightRegion,importFreightRate,importTotalCost,importNetProfit,importExcessProfit,importProfitIncludingExcess,importProteinGoodsChargePerBag} from '../lib/importFreightCost.js';

const money=new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',minimumFractionDigits:2,maximumFractionDigits:2});
const quantity=new Intl.NumberFormat('en-IN',{maximumFractionDigits:2});
const cell={padding:'5px 6px',borderBottom:'1px solid #e3e9f2',whiteSpace:'nowrap',textAlign:'left',fontSize:12};
const header={...cell,padding:'3px 4px',fontSize:11,lineHeight:1.15,whiteSpace:'normal',overflowWrap:'break-word',verticalAlign:'middle',maxWidth:115,background:'#eaf1fd',position:'sticky',top:0,zIndex:2,fontWeight:800,color:'#18345b'};
const inputStyle={width:92,boxSizing:'border-box',border:'1px solid #b6c5db',borderRadius:6,padding:'5px 6px',fontSize:12,fontWeight:700,background:'#fff',color:'#122139'};
const summaryCard={background:'#fff',padding:16,border:'1px solid #dce6f1',borderRadius:12,flex:'1 1 150px',minWidth:130};
// Colour is for easy visual recognition; the category text stays visible too.
const goodsColors={
  HH:{row:'#eff6ff',badge:'#dbeafe',text:'#1e40af'},
  PROTEIN:{row:'#f5f3ff',badge:'#ede9fe',text:'#5b21b6'},
  CLOTHES:{row:'#fff7ed',badge:'#ffedd5',text:'#9a3412'},
  BATTERY:{row:'#fff1f2',badge:'#ffe4e6',text:'#9f1239'}
};
// Active Masters take priority over goods category row backgrounds.
// Goods remain recognizable by the coloured Goods dropdown.
const activeMasterColor={row:'#dcfce7',border:'#16a34a',badge:'#bbf7d0',text:'#166534'};
const DRIVER_EXPENSE_PER_MAWB=2600;
const dataNumber=value=>value===null||value===undefined||value===''?null:Number(value);
function figures(row={}){
  const kg=dataNumber(row.weight);
  const rawExtra=dataNumber(row.excessWeight);
  const excessWeight=rawExtra!==null&&Number.isFinite(rawExtra)&&rawExtra>=0?rawExtra:null;
  // Duty is a per-part expense. Other master charges retain their allocation.
  const duty=dataNumber(row.totalDuty);
  const allocation=Number.isFinite(Number(row.allocationRatio))?Number(row.allocationRatio):1;
  const rate=dataNumber(row.rate);
  const eici=kg===null?null:15*kg;
  const bags=dataNumber(row.bags);
  const averageWeightPerBag=kg!==null&&Number.isFinite(kg)&&bags!==null&&Number.isFinite(bags)&&bags>0?kg/bags:null;
  const category=String(row.goodsCategory||'').toUpperCase();
  const origin=String(row.origin||'').trim().toUpperCase();
  // Protein bag charges come from the shipment's original origin,
  // never Via or destination. JFK now follows all other USA origins.
  const isHkgOrigin=/(^|[^A-Z0-9])(HKG|HONG[ -]?KONG)($|[^A-Z0-9])/.test(origin);
  const chargePerBag=category==='HH'?(isHkgOrigin?1500:340):
    category==='CLOTHES'||category==='BATTERY'?1500:
    category==='PROTEIN'?importProteinGoodsChargePerBag(origin):null;
  // Battery is charged on actual bags in each physical part, not a master override.
  const goodsCharge=bags===null||chargePerBag===null?null:bags*chargePerBag;
  const dutyPerKg=kg>0&&duty!==null?duty/kg:null;
  // Profit is earned at the manually entered selling rate per kg, never a fixed tariff.
  // Do not show a misleading profit until all the required inputs are available.
  // Canada, Germany and USA departures: ₹80/kg; DXB and all others: ₹50/kg.
  // Keep this handling deduction separate from existing airport freight costs.
  const proteinDeduction=category==='PROTEIN'&&kg!==null?proteinHandlingRate(origin)*kg:0;
  // Freight is ONLY for Protein. Clothes/HH/Battery/other goods pay no
  // origin freight, even when they depart DXB, Canada, USA or Germany.
  // USA includes JFK; no origin freight can be applied twice.
  const freightRegion=importFreightRegion(origin,category);
  const freightRate=importFreightRate(origin,category);
  const freightCharge=kg===null?null:Math.round(freightRate*kg*100)/100;
  const dxbFreightDeduction=freightRegion==='DXB'?freightCharge:0;
  const usaFreightDeduction=freightRegion==='USA'?freightCharge:0;
  const canadaFreightDeduction=freightRegion==='CANADA'?freightCharge:0;
  const germanyFreightDeduction=freightRegion==='GERMANY'?freightCharge:0;
  const siibDeduction=category==='CLOTHES'&&kg!==null?30*kg:0;
  // Driver expense is set ONCE for the master; distribute it proportionally
  // across physical rows to avoid charging it repeatedly for every part.
  const masterDriverExpense=dataNumber(row.driverExpense)??DRIVER_EXPENSE_PER_MAWB;
  const driverExpense=Math.round(masterDriverExpense*allocation*100)/100;
  // Total Cost includes genuine freight, duty, handling, driver and goods
  // expenses, but NO extra 15% Goods Charge for any goods or client.
  const totalCost=importTotalCost({duty,eici,driverExpense,goodsCharge,freightCharge,proteinDeduction,siibDeduction});
  const baseProfit=importNetProfit(rate,kg,totalCost);
  const excessProfit=importExcessProfit(rate,excessWeight);
  const profit=importProfitIncludingExcess(baseProfit,excessProfit);
  const profitPerKg=profit===null||kg===null||kg<=0?null:profit/kg;
  return {kg,excessWeight,excessProfit,baseProfit,bags,averageWeightPerBag,duty,rate,eici,goodsCharge,chargePerBag,totalCost,dutyPerKg,proteinDeduction,freightRegion,freightRate,freightCharge,dxbFreightDeduction,usaFreightDeduction,canadaFreightDeduction,germanyFreightDeduction,siibDeduction,driverExpense,profit,profitPerKg};
}
function displayMoney(value){return value===null||!Number.isFinite(value)?'—':money.format(value)}
function totalCostDetails(n){
  if(n.totalCost===null)return 'Enter Weight, Bags, Goods and Total Duty to calculate Total Cost.';
  return [
    'Duty: '+displayMoney(n.duty),
    'EICI: '+displayMoney(n.eici),
    'Driver: '+displayMoney(n.driverExpense),
    'Goods Charge: '+displayMoney(n.goodsCharge),
    n.freightRate>0?'Freight '+n.freightRegion+' (₹'+n.freightRate+'/kg): '+displayMoney(n.freightCharge):null,
    n.proteinDeduction>0?'Protein Deduction: '+displayMoney(n.proteinDeduction):null,
    n.siibDeduction>0?'Clothes Deduction: '+displayMoney(n.siibDeduction):null,
    'Total Cost: '+displayMoney(n.totalCost)
  ].filter(Boolean).join(' • ');
}
function displayAmount(value){return value===null||!Number.isFinite(value)?'—':quantity.format(value)}
function downloadCsv(rows,month=''){
  const columns=['MAWB','Client','Goods','Origin','Total Bags','Average Weight per Bag (kg)','Total Weight (kg)','Excess Weight (kg; no additional cost)','Total Duty','Duty per kg','Rate (INR/kg)','EICI (15 x kg)','Goods Charge (HH HKG 1500/bag; HH other 340/bag; Protein DXB 3000/bag; Protein USA incl JFK, Canada, Germany 1800/bag; Protein other origins 1500/bag; Clothes and Battery 1500/bag)','Profit (Rate x Weight - Total Cost + Excess Profit)','Excess Profit (Excess Weight x Rate; no costs)','DXB Protein Freight (173 x kg)','USA Protein Freight (410 x kg; includes JFK)','Canada Protein Freight (450 x kg)','Germany Protein Freight (322 x kg)','Total Cost (includes all expenses)','Driver Expense (INR; editable per MAWB; default 2600)','Profit per kg (Profit / Total Weight)','Protein / Clothes Deduction (Protein Canada Germany USA 80 x kg, other origins including DXB 50 x kg; Clothes 30 x kg)','Average Weight per Bag (kg)'];
  const values=rows.map(row=>{
    const n=figures(row);
    return [row.mawb,row.clientName,row.goodsCategory||'',row.origin||'',row.bags,n.averageWeightPerBag,row.weight,row.excessWeight??'',row.totalDuty,n.dutyPerKg,row.rate,n.eici,n.goodsCharge,n.profit,n.excessProfit??'',n.dxbFreightDeduction,n.usaFreightDeduction,n.canadaFreightDeduction,n.germanyFreightDeduction,n.totalCost,n.driverExpense,n.profitPerKg,['PROTEIN','CLOTHES'].includes(String(row.goodsCategory||'').toUpperCase())&&n.kg!==null?n.proteinDeduction+n.siibDeduction:'',n.averageWeightPerBag];
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
    let active=true,requestSequence=0;
    async function load(){
      if(!active)return;
      const request=++requestSequence;
      try{
        const response=await fetch('/api/import-profit'+(period?'?month='+encodeURIComponent(period):''),{credentials:'include',cache:'no-store'});
        const data=await response.json();
        if(!data.ok)throw new Error(data.error||'Could not open profit sheet.');
        if(active&&request===requestSequence){setRows(data.rows||[]);setPeriodOptions(data.months||[]);setLastLoaded(new Date().toLocaleTimeString('en-IN'));setMessage(current=>current.startsWith('Unable to load')?'':current)}
      }catch(error){if(active&&request===requestSequence)setMessage('Unable to load Import Profit Sheet: '+(error?.message||error))}
      finally{if(active&&request===requestSequence)setLoading(false)}
    }
    const refresh=()=>{if(document.visibilityState!=='hidden')void load()};
    void load();
    // Re-read live MAWB masters after saves, when revisiting, and every 30 seconds.
    const unsubscribe=subscribeProfitSourceChanges(refresh);
    const timer=setInterval(refresh,30000);
    return()=>{active=false;requestSequence++;clearInterval(timer);unsubscribe()};
  },[period]);
  function effective(row){
    const masterDraft=drafts[row.mawb]||{};
    const partDraft=drafts[row.rowKey||row.mawb]||{};
    return {...row,...masterDraft,
      ...(Object.prototype.hasOwnProperty.call(partDraft,'totalDuty')?{totalDuty:partDraft.totalDuty}:{}),
      ...(Object.prototype.hasOwnProperty.call(partDraft,'excessWeight')?{excessWeight:partDraft.excessWeight}:{})};
  }
  async function save(mawb,field,value,rowKey=''){
    const perPart=field==='totalDuty'||field==='excessWeight';
    const draftKey=perPart?rowKey:mawb;
    if(!draftKey){setMessage('Refresh the sheet to enter financial details for this part.');return;}
    const key=draftKey+':'+field;
    if(saving[key])return;
    const current=rows.find(row=>perPart?row.rowKey===rowKey:row.mawb===mawb);
    if(current&&String(current[field]??'')===String(value??'')){
      setDrafts(previous=>{const next={...previous},fields={...(next[draftKey]||{})};delete fields[field];if(Object.keys(fields).length)next[draftKey]=fields;else delete next[draftKey];return next});
      return;
    }
    setSaving(previous=>({...previous,[key]:true}));
    setMessage('');
    try{
      const response=await fetch('/api/import-profit',{method:'PATCH',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({mawb,field,value,...(perPart?{rowKey}:{})})});
      const data=await response.json();
      if(!data.ok)throw new Error(data.error||'Save failed');
      setRows(previous=>previous.map(row=>(perPart?row.rowKey===rowKey:row.mawb===mawb)?{...row,[field]:data.value}:row));
      setDrafts(previous=>{const next={...previous},fields={...(next[draftKey]||{})};if(String(fields[field]??'')===String(value??''))delete fields[field];if(Object.keys(fields).length)next[draftKey]=fields;else delete next[draftKey];return next});
      setMessage(mawb+(perPart&&current?.partLabel?' • '+current.partLabel:'')+' • '+({totalDuty:'Total Duty',excessWeight:'Excess Weight',rate:'Rate',goodsCategory:'Goods',goodsChargeOverride:'Goods Charge Override',driverExpense:'Driver Expense'}[field]||field)+' saved.');
    }catch(error){setMessage('Not saved for '+mawb+(perPart&&current?.partLabel?' • '+current.partLabel:'')+': '+(error?.message||error))}
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
    let bags=0,weight=0,excessWeight=0,excessProfit=0,duty=0,eici=0,goodsCharge=0,proteinClothesDeduction=0,cost=0,driverExpense=0,profit=0,completed=0,dutyKnown=0,rateSum=0,rateKnown=0,dutyPerKgSum=0,dutyPerKgKnown=0,completedWeight=0,averageWeightTotal=0,averageBagsTotal=0;
    for(const row of filtered){
      const n=figures(row);
      bags+=Number(row.bags)||0;
      weight+=n.kg||0;
      excessWeight+=n.excessWeight||0;
      if(n.excessProfit!==null)excessProfit+=n.excessProfit;
      if(n.averageWeightPerBag!==null){averageWeightTotal+=n.kg;averageBagsTotal+=n.bags;}
      if(n.eici!==null)eici+=n.eici;
      if(n.goodsCharge!==null)goodsCharge+=n.goodsCharge;
      proteinClothesDeduction+=n.proteinDeduction+n.siibDeduction;
      if(n.duty!==null){duty+=n.duty;dutyKnown++}
      if(n.dutyPerKg!==null){dutyPerKgSum+=n.dutyPerKg;dutyPerKgKnown++}
      if(n.rate!==null){rateSum+=n.rate;rateKnown++}
      if(n.totalCost!==null)cost+=n.totalCost;
      driverExpense+=n.driverExpense;
      if(n.profitPerKg!==null){profit+=n.profit;completedWeight+=n.kg;completed++}
    }
    return {bags,weight,excessWeight,excessProfit,duty,eici,goodsCharge,proteinClothesDeduction,cost,driverExpense,profit,completed,dutyKnown,rateSum,rateKnown,dutyPerKgSum,dutyPerKgKnown,completedWeight,averageWeightPerBag:averageBagsTotal>0?averageWeightTotal/averageBagsTotal:null};
  },[filtered]);
  return <main style={{padding:'20px clamp(12px,3vw,32px)',background:'#f5f8fc',minHeight:'75vh',color:'#122139'}}>
    <div style={{maxWidth:1650,margin:'auto'}}>
      <div style={{display:'flex',justifyContent:'space-between',gap:14,alignItems:'center',flexWrap:'wrap'}}>
        <div>
          <div style={{fontSize:12,letterSpacing:1.5,fontWeight:900,color:'#3464ae'}}>MAYAVI CARGO • ADMIN ONLY</div>
          <h1 style={{margin:'5px 0',fontSize:27}}>Import Profit Sheet</h1>
          <p style={{margin:'6px 0',color:'#52657f'}}>Current month matches Import Active + this month's Customs Cleared register. Split shipments appear as separate physical rows with the same MAWB. Duty is entered independently for each physical part; Battery Goods Charge is ₹1,500 × bags per part; Driver Expense remains master-level and is allocated.</p>
        </div>
        <button onClick={()=>downloadCsv(filtered,period||periodOptions.at(-1)||'')} disabled={!filtered.length} style={{background:'#1952a5',color:'#fff',border:0,borderRadius:9,padding:'11px 15px',fontWeight:800,cursor:'pointer'}}>DOWNLOAD CSV</button>
      </div>
      <div style={{display:'flex',gap:12,flexWrap:'wrap',marginTop:16}}>
        <div style={summaryCard}><small>IMPORT ROWS / PARTS</small><div style={{fontSize:23,fontWeight:900}}>{displayAmount(filtered.length)}</div></div>
        <div style={summaryCard}><small>TOTAL BAGS</small><div style={{fontSize:23,fontWeight:900}}>{displayAmount(totals.bags)}</div></div>
        <div style={summaryCard}><small>TOTAL WEIGHT</small><div style={{fontSize:23,fontWeight:900}}>{displayAmount(totals.weight)} kg</div></div>
        <div style={{...summaryCard,borderLeft:'4px solid #059669'}}><small>EXCESS WEIGHT (NO COST)</small><div style={{fontSize:23,fontWeight:900,color:'#047857'}}>{displayAmount(totals.excessWeight)} kg</div></div>
        <div style={{...summaryCard,borderLeft:'4px solid #059669'}}><small>EXCESS PROFIT</small><div style={{fontSize:23,fontWeight:900,color:'#047857'}}>{displayMoney(totals.excessProfit)}</div></div>
        <div style={summaryCard}><small>DUTY ENTERED</small><div style={{fontSize:23,fontWeight:900}}>{displayMoney(totals.duty)}</div></div>
        <div style={summaryCard}><small>PROFIT (COMPLETED ENTRIES)</small><div style={{fontSize:23,fontWeight:900,color:totals.profit<0?'#b91c1c':'#167144'}}>{displayMoney(totals.profit)}</div><small>{totals.completed} of {filtered.length} entries calculated</small></div>
      </div>
      <div style={{display:'flex',flexWrap:'wrap',gap:12,justifyContent:'space-between',alignItems:'center',margin:'18px 0 12px'}}>
        <div style={{display:'flex',flexWrap:'wrap',gap:9,alignItems:'center'}}>
          <label htmlFor="import-profit-period" style={{fontSize:12,fontWeight:800}}>PROFIT MONTH</label>
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
        <small style={{color:'#64748b'}}>Updated: {lastLoaded||'—'} • Active + cleared part rows refresh automatically • checks every 30 seconds</small>
      </div>
      <div style={{display:'flex',gap:10,flexWrap:'wrap',alignItems:'center',margin:'4px 0 10px'}}>
        <span style={{background:activeMasterColor.badge,color:activeMasterColor.text,border:'1px solid '+activeMasterColor.border,fontSize:12,fontWeight:900,padding:'4px 9px',borderRadius:6}}>ACTIVE MASTER (light green row)</span>
        <small style={{fontWeight:800,color:'#52657f'}}>OTHER ROWS / GOODS COLOURS:</small>
        {Object.entries(goodsColors).map(([type,style])=><span key={type} style={{background:style.badge,color:style.text,fontSize:12,fontWeight:800,padding:'4px 9px',borderRadius:6}}>{type==='HH'?'HH':type==='PROTEIN'?'Protein':type==='BATTERY'?'Battery':'Clothes'}</span>)}
      </div>
      {rows.some(row=>row.legacyMasterDuty!==''&&row.totalDuty==='')&&<p role="note" style={{padding:'9px 12px',background:'#fff7ed',color:'#92400e',border:'1px solid #fed7aa',borderRadius:8}}>Previously entered master Duty is preserved but not copied to split shipments. Please enter the actual Duty separately for each physical part.</p>}
      {message&&<p role="status" style={{padding:'9px 12px',background:'#eaf0fa',borderRadius:8,color:'#173e6f'}}>{message}</p>}
      <div style={{overflowX:'auto',background:'#fff',border:'1px solid #dae4f0',borderRadius:12}}>
        <table style={{width:'100%',borderCollapse:'separate',borderSpacing:0}}>
          <thead><tr>
            {['S.No.','MAWB','Client','Goods','Bags (Total)','Avg kg / Bag','Weight (kg)','Excess Weight (kg)','Total Duty (₹)','Duty/kg (₹)','Rate (₹/kg)','EICI 15 × kg','Goods Charge (₹)','Profit (₹)','Excess Profit (₹)','Total Cost (₹)','Driver Expense (₹)','Profit per kg (₹/kg)','Protein / Clothes Deduction (₹)','Average Weight per Bag (kg)'].map(label=><th key={label} style={header}>
              {label==='Client'?<div style={{display:'flex',flexDirection:'column',alignItems:'flex-start',gap:5,minWidth:145}}><span>Client {clientFilter?'▾':'↕'}</span><select aria-label="Filter by client in Import Profit Client column" value={clientFilter} onChange={e=>setClientFilter(e.target.value)} style={{padding:'6px 7px',width:'100%',maxWidth:190,border:'1px solid #b4c6e1',borderRadius:6,color:'#173e6f',fontSize:12,fontWeight:700,background:'#fff',cursor:'pointer'}}><option value="">All Clients</option>{clientOptions.map(client=><option key={client} value={client}>{client}</option>)}</select></div>:label==='Rate (₹/kg)'?<button type="button" aria-label="Sort by rate ascending or descending" title="Tap to sort rate (ascending / descending / original)" onClick={()=>setRateSort(current=>current===''?'asc':current==='asc'?'desc':'')} style={{border:0,padding:0,font:'inherit',fontWeight:800,color:'inherit',background:'transparent',cursor:'pointer',whiteSpace:'nowrap'}}>Rate (₹/kg) {rateSort==='asc'?'▲':rateSort==='desc'?'▼':'↕'}</button>:label}
            </th>)}
          </tr></thead>
          <tbody>
            {filtered.map((row,index)=>{
              const n=figures(row);
              const active=row.isActiveMaster===true;
              return <tr key={row.rowKey||row.mawb} title={active?'Import Active — physical part not customs cleared':'Customs Cleared — physical part'} style={{background:active?activeMasterColor.row:(goodsColors[String(row.goodsCategory||'').toUpperCase()]?.row||'#fff')}}>
                <td style={{...cell,borderLeft:active?'4px solid '+activeMasterColor.border:'4px solid transparent',paddingLeft:4}}>{index+1}</td>
                <td style={{...cell,fontWeight:800}} title={row.partLabel?'Physical '+row.partLabel+' of '+row.mawb:row.mawb}>{row.mawb}</td>
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
                    <option value="BATTERY">Battery</option>
                  </select>
                </td>
                <td style={cell}>{displayAmount(dataNumber(row.bags))}</td>
                <td style={{...cell,fontWeight:800}} title="Total weight divided by total master bags; also shown in the final column">{displayAmount(n.averageWeightPerBag)}</td>
                <td style={{...cell,fontWeight:700}}>{displayAmount(n.kg)}</td>
                <td style={{...cell,background:'#edfff5'}}>
                  <input title="Extra actual kg above MAWB weight. No additional costs; saved per physical part."
                    aria-label={'Excess Weight for '+row.mawb+(row.partLabel?' '+row.partLabel:'')}
                    type="number" inputMode="decimal" min="0" step="0.01"
                    value={row.excessWeight??''}
                    onChange={e=>setDrafts(previous=>({...previous,[row.rowKey]:{...(previous[row.rowKey]||{}),excessWeight:e.target.value}}))}
                    onBlur={e=>save(row.mawb,'excessWeight',e.target.value,row.rowKey)}
                    onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur()}}
                    disabled={Boolean(saving[row.rowKey+':excessWeight'])}
                    placeholder="Extra kg" style={{...inputStyle,width:90,borderColor:'#34d399'}}/>
                </td>
                {['totalDuty'].map(field=><td key={field} style={cell}><input title="Duty for this physical part only; other parts of the same MAWB are independent" aria-label={'Total Duty for '+row.mawb+(row.partLabel?' '+row.partLabel:'')} type="number" min="0" step="any" value={row[field]??''} onChange={e=>setDrafts(previous=>({...previous,[row.rowKey]:{...(previous[row.rowKey]||{}),[field]:e.target.value}}))} onBlur={e=>save(row.mawb,field,e.target.value,row.rowKey)} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur()}} disabled={Boolean(saving[row.rowKey+':'+field])} placeholder="Part duty" style={inputStyle}/></td>)}
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
                <td title={[n.proteinDeduction>0?'Protein handling deduction: '+displayMoney(n.proteinDeduction):'',n.dxbFreightDeduction>0?'DXB freight ₹173/kg: '+displayMoney(n.dxbFreightDeduction):'',n.usaFreightDeduction>0?'USA freight ₹410/kg: '+displayMoney(n.usaFreightDeduction):'',n.canadaFreightDeduction>0?'Canada freight ₹450/kg: '+displayMoney(n.canadaFreightDeduction):'',n.germanyFreightDeduction>0?'Germany freight ₹322/kg: '+displayMoney(n.germanyFreightDeduction):'',n.siibDeduction>0?'Clothes SIIB ₹30/kg deduction: '+displayMoney(n.siibDeduction):'','Driver expense: '+displayMoney(n.driverExpense),n.excessProfit!==null?'Excess Profit (no cost): +'+displayMoney(n.excessProfit):''].filter(Boolean).join(' • ')} style={{...cell,fontWeight:900,color:n.profit===null?'#64748b':n.profit<0?'#b91c1c':'#14804b'}}>{displayMoney(n.profit)}{n.dxbFreightDeduction>0&&<span style={{marginLeft:5,fontSize:10,color:'#7c3aed'}}>DXB</span>}{n.usaFreightDeduction>0&&<span style={{marginLeft:5,fontSize:10,color:'#0369a1'}}>USA</span>}{n.canadaFreightDeduction>0&&<span style={{marginLeft:5,fontSize:10,color:'#2563eb'}}>CAN</span>}{n.germanyFreightDeduction>0&&<span style={{marginLeft:5,fontSize:10,color:'#047857'}}>GER</span>}</td>
                <td style={{...cell,fontWeight:900,color:'#047857',background:'#edfff5'}} title="Excess Profit = Excess Weight × Rate. No extra EICI, Duty, Freight, Goods, Driver or Protein / Clothes costs. Included in Profit.">{displayMoney(n.excessProfit)}</td>
                <td title={totalCostDetails(n)} style={{...cell,fontWeight:800}}>{displayMoney(n.totalCost)}{n.freightRate>0&&<small style={{display:'block',color:'#64748b'}}>Freight: ₹{n.freightRate}/kg included</small>}</td>
                <td style={{...cell,fontWeight:800,color:'#9a3412'}} title="Master MAWB Driver Expense (default ₹2,600); divided proportionately across physical part rows">
                  <input aria-label={'Driver Expense for '+row.mawb} type="number" inputMode="decimal" min="0" step="0.01" placeholder="2600" value={row.driverExpense??DRIVER_EXPENSE_PER_MAWB}
                    onChange={e=>setDrafts(previous=>({...previous,[row.mawb]:{...(previous[row.mawb]||{}),driverExpense:e.target.value}}))}
                    onBlur={e=>save(row.mawb,'driverExpense',e.target.value)} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur()}}
                    disabled={Boolean(saving[row.mawb+':driverExpense'])} style={{...inputStyle,width:110,color:'#9a3412'}}/>
                </td>
                <td style={{...cell,fontWeight:800,color:n.profitPerKg===null?'#64748b':n.profitPerKg<0?'#b91c1c':'#14804b'}}>{displayMoney(n.profitPerKg)}</td>
                <td style={{...cell,fontWeight:800,color:'#9a3412'}} title="Already deducted from Profit: Protein ₹80/kg for Canada/Germany/USA origins, ₹50/kg otherwise (including DXB); Clothes ₹30 × weight">{['PROTEIN','CLOTHES'].includes(String(row.goodsCategory||'').toUpperCase())&&n.kg!==null?displayMoney(n.proteinDeduction+n.siibDeduction):'—'}</td>
                <td style={{...cell,fontWeight:800}} title="Total master weight divided by total bags">{displayAmount(n.averageWeightPerBag)}</td>
              </tr>
            })}
            {!filtered.length&&<tr><td colSpan={20} style={{padding:28,textAlign:'center',color:'#64748b'}}>{loading?'Loading existing Import shipments…':'No Import MAWB found.'}</td></tr>}
          </tbody>
          {filtered.length>0&&<tfoot><tr style={{background:'#eaf1fd',fontWeight:900}}>
            <td colSpan={4} style={cell}>TOTAL • {filtered.length} MAWB rows / physical parts</td>
            <td style={cell}>{displayAmount(totals.bags)}</td>
            <td style={{...cell,fontWeight:800}} title="Combined weight divided by combined bags for valid shipments">{displayAmount(totals.averageWeightPerBag)}</td>
            <td style={cell}>{displayAmount(totals.weight)}</td>
            <td style={{...cell,color:'#047857',fontWeight:900}}>{displayAmount(totals.excessWeight)}</td>
            <td style={cell}>{displayMoney(totals.duty)}</td>
            <td style={cell}>{totals.dutyPerKgKnown?displayMoney(totals.dutyPerKgSum):'—'}</td>
            <td style={cell}>{totals.rateKnown?displayMoney(totals.rateSum):'—'}</td>
            <td style={cell}>{displayMoney(totals.eici)}</td>
            <td style={cell}>{displayMoney(totals.goodsCharge)}</td>
            <td style={{...cell,color:totals.profit<0?'#b91c1c':'#14804b'}}>{displayMoney(totals.profit)}</td>
            <td style={{...cell,color:'#047857',fontWeight:900}}>{displayMoney(totals.excessProfit)}</td>
            <td style={cell}>{displayMoney(totals.cost)}</td>
            <td style={{...cell,color:'#9a3412'}}>{displayMoney(totals.driverExpense)}</td>
            <td style={{...cell,color:totals.profit<0?'#b91c1c':'#14804b'}} title="Total profit divided by the weight of rows with calculated profit">{totals.completedWeight>0?displayMoney(totals.profit/totals.completedWeight):'—'}</td>
            <td style={{...cell,color:'#9a3412'}} title="Combined Protein (₹50/kg) and Clothes (₹30/kg) deductions already applied to Profit">{displayMoney(totals.proteinClothesDeduction)}</td>
            <td style={{...cell,fontWeight:800}} title="Total weight ÷ total bags for entries with valid bag and weight values (weighted average)">{displayAmount(totals.averageWeightPerBag)}</td>
          </tr></tfoot>}
        </table>
      </div>
      <p style={{fontSize:12,color:'#52657f',marginTop:12}}>
        Excess Weight is entered separately for each physical row. Excess Profit = Excess Weight × Rate, without any extra cost, and is added to Profit. MAWB original Weight, Duty, Bags, EICI, Freight, Goods Charge and Driver Expense remain unchanged. A split MAWB does not duplicate excess weight between parts. Total Profit = (Rate × Original Weight) − Total Cost + Excess Profit.{' '} MAWB may appear multiple times when Import tracking shows separate physical parts. The current month's Profit Sheet includes the live Active register and only Customs Cleared parts arriving this month. Older monthly periods show confirmed parts dated to that month. Each row uses its own bags and weight. Duty is stored separately for every physical part and changes only that part's Profit and Duty/kg. Previous master-level duty records are preserved, but not duplicated across split rows. Battery Goods Charge is calculated automatically as ₹1,500 × the physical part's number of bags. Driver Expense remains master-level and is allocated to the physical parts by shipment weight. <strong>Driver Expense</strong> inputs still edit the master amount (the calculations show each part's allocated share).{' '}
        Duty/kg = Total Duty ÷ Total Weight • EICI = ₹15 × Total Weight • Goods Charge = HH originating from HKG (Hong Kong) ₹1,500/bag, HH from other origins ₹340/bag, Protein from DXB ₹3,000/bag, Protein from USA (including JFK), Canada or Germany ₹1,800/bag, Protein from other known origins ₹1,500/bag, or Clothes ₹1,500/bag; Battery ₹1,500/bag (automatic) • Total Cost = DXB/Canada/USA/Germany origin freight (if applicable) + EICI + Driver Expense + Goods Charge + Protein/Clothes Deduction + Total Duty. Freight rates per kg: DXB ₹173, Canada ₹450, USA including JFK ₹410, Germany ₹322. Freight is charged ONLY when Goods is Protein; Clothes, HH, Battery and all other commodities have zero origin freight. Protein handling remains ₹80/kg for Canada/Germany/USA origins and ₹50/kg for DXB/other origins, while Clothes SIIB remains ₹30/kg. Driver Expense defaults to ₹2,600 per master MAWB and is allocated across physical parts without duplication. No additional 15% Goods Charge is deducted for any shipment. Origin determines freight, not transit (Via) or destination. <strong>Profit = (Rate × Weight) − Total Cost.</strong> Total Cost remains blank until Duty, Goods, Weight and Bags are available; Profit additionally requires Rate. Rate is the selling rate per kg. Total Cost remains blank until Duty, Goods, Weight and Bags are available; Profit additionally requires Rate. Profit per kg = Profit ÷ Total Weight (kg); the footer Profit per kg = Total calculated Profit ÷ Total Weight of entries with calculated profit (not the sum of individual per-kg figures). Rate can be entered manually with decimals (up to 4 places); the ▲/▼ controls change it by ₹0.01. The footer adds each numeric column, including the entered Rate and Duty/kg values (these are sums, not average rates). Import Active rows are highlighted with a light green row and green left border. Customs Cleared rows retain their goods-based colours. Profit rows mirror the same MAWB and physical-part row count as the source registers; each part retains its own weight and bags. Blank amounts are excluded. Totals respect the selected Arrival Month, Client, Goods and search filters. Past months before October 2026 are excluded; arrivals must be confirmed, not estimated.
      </p>
    </div>
  </main>;
}
