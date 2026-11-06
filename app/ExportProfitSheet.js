'use client';
import {useEffect,useMemo,useState} from 'react';
import { subscribeProfitSourceChanges } from '../lib/profitSync.js';
import {auditOnlyExportShipmentCharge} from '../lib/exportShipmentCharge.js';
import {EXPORT_BAG_CODES,EXPORT_BAG_CATEGORIES,exportCategorySummary,validateExportBagCount} from '../lib/exportCategoryBags.js';

const money=new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',minimumFractionDigits:2,maximumFractionDigits:2});
const number=new Intl.NumberFormat('en-IN',{maximumFractionDigits:2});
const cell={padding:'6px 9px',borderBottom:'1px solid #e3e9f2',fontSize:13,textAlign:'left',whiteSpace:'nowrap'};
const header={...cell,padding:'4px 5px',fontSize:11,lineHeight:1.15,whiteSpace:'normal',overflowWrap:'break-word',verticalAlign:'middle',maxWidth:130,position:'sticky',top:0,zIndex:1,background:'#eaf1fd',fontWeight:800,color:'#18345b'};
const summary={background:'#fff',padding:16,border:'1px solid #dce6f1',borderRadius:12,flex:'1 1 190px'};
// Consistent soft colours per client, without changing the client's original name.
function clientBadgeStyle(name=''){
  const label=String(name||'').trim();
  if(!label)return {};
  let hash=0;
  for(let i=0;i<label.length;i++)hash=(hash*31+label.toUpperCase().charCodeAt(i))%360;
  return {display:'inline-block',backgroundColor:`hsl(${hash} 76% 91%)`,color:`hsl(${hash} 65% 26%)`,border:`1px solid hsl(${hash} 55% 78%)`,borderRadius:7,padding:'5px 9px',fontWeight:850,whiteSpace:'nowrap'};
}
function showMoney(value){return value===null||!Number.isFinite(value)?'—':money.format(value)}
function showWeight(value){return value===null||!Number.isFinite(value)?'—':number.format(value)}
// The extra-category numeric zero is displayed as a dash; calculations remain numeric.
function showCategoryMoney(value){return value===null||value===undefined||Number(value)===0?'—':showMoney(value)}
function showCategoryCount(value){return !Number(value)?'—':number.format(value)}
function profitFor(row={}){
  const value=Number(row.weight);
  const rate=Number(row.rate)||6;
  return row.weight===null||row.weight===''||!Number.isFinite(value)||value<=0?null:Math.round((value*rate-auditOnlyExportShipmentCharge(row)+exportCategorySummary(row.categoryBags,row.clientName).netProfit)*100)/100;
}
function exportCsv(rows,month=''){
  const columns=['MAWB No.','Register','Client Name','Weight (kg)','Rate (INR/kg)','Shipment Charges (Audit, INR)',
    ...EXPORT_BAG_CODES.flatMap(code=>[EXPORT_BAG_CATEGORIES[code].label+' Bags',EXPORT_BAG_CATEGORIES[code].label+' Client Charge (INR)',EXPORT_BAG_CATEGORIES[code].label+' Deduction (INR)']),
    'Total Category Client Charges (INR)','Total Category Deductions (INR)','Extra Category Net Profit (INR)','Final Profit (INR)'];
  const data=rows.map(r=>{
    const categories=exportCategorySummary(r.categoryBags,r.clientName);
    return [r.mawb,r.register==='MASTER COPY RECEIVED'?'Master Copy Received':'Active',r.clientName||'',r.weight??'',r.rate??6,showCategoryMoney(r.auditAutoCharge?r.shipmentCharge:null),
      ...EXPORT_BAG_CODES.flatMap(code=>[showCategoryCount(categories.items[code].bags),showCategoryMoney(categories.items[code].clientCharge),showCategoryMoney(categories.items[code].deduction)]),
      showCategoryMoney(categories.clientCharge),showCategoryMoney(categories.deduction),showCategoryMoney(categories.netProfit),profitFor(r)??''];
  });
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
  const [categoryDrafts,setCategoryDrafts]=useState({});
  const [saving,setSaving]=useState({});
  useEffect(()=>{
    let active=true,requestSequence=0;
    async function load(){
      if(!active)return;
      const request=++requestSequence;
      try{
        const response=await fetch('/api/export-profit'+(period?'?month='+encodeURIComponent(period):''),{credentials:'include',cache:'no-store'});
        const data=await response.json();
        if(!data.ok)throw new Error(data.error||'Could not load Export Profit Sheet.');
        if(active&&request===requestSequence){
          setRows(data.rows||[]);
          setPeriodOptions(data.months||[]);
          setLastLoaded(new Date().toLocaleTimeString('en-IN'));
          setMessage('');
        }
      }catch(error){if(active&&request===requestSequence)setMessage('Unable to load Export Profit Sheet: '+(error?.message||error))}
      finally{if(active&&request===requestSequence)setLoading(false)}
    }
    const refresh=()=>{if(document.visibilityState!=='hidden')void load()};
    void load();
    const unsubscribe=subscribeProfitSourceChanges(refresh);
    const timer=setInterval(refresh,30000);
    return()=>{active=false;requestSequence++;clearInterval(timer);unsubscribe()};
  },[period]);
  async function saveCategoryBags(row,code,rawValue){
    const mawb=row.mawb,key=mawb+':'+code;
    if(saving[key])return;
    const bags=String(rawValue??'').trim()===''?0:validateExportBagCount(rawValue);
    if(bags===null){setMessage('Not saved for '+mawb+': '+EXPORT_BAG_CATEGORIES[code].label+' bag count must be a whole number between 0 and 100,000.');return;}
    if(bags===exportCategorySummary(row.categoryBags,row.clientName).items[code].bags){
      setCategoryDrafts(previous=>{const next={...previous};delete next[key];return next});return;
    }
    setSaving(previous=>({...previous,[key]:true}));setMessage('');
    try{
      const response=await fetch('/api/export-profit',{method:'PATCH',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({mawb,category:code,bags})});
      const data=await response.json();
      if(!response.ok||!data.ok)throw new Error(data.error||'Save failed.');
      setRows(previous=>previous.map(r=>r.mawb===mawb?{...r,categoryBags:data.categoryBags,manualBagCodes:data.manualBagCodes||[],auditAutoCodes:data.auditAutoCodes||[]}:r));
      setCategoryDrafts(previous=>{const next={...previous};delete next[key];return next});
      setMessage(mawb+' • '+EXPORT_BAG_CATEGORIES[code].label+' bags '+bags+' saved.');
    }catch(error){setMessage('Not saved for '+mawb+': '+(error?.message||error));}
    finally{setSaving(previous=>({...previous,[key]:false}));}
  }
  const clientOptions=useMemo(()=>[...new Set(rows.map(r=>String(r.clientName||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b)),[rows]);
  const filtered=useMemo(()=>rows.filter(row=>
    (!clientFilter||row.clientName===clientFilter)&&
    (!search||[row.mawb,row.clientName].join(' ').toLowerCase().includes(search.trim().toLowerCase()))
  ),[rows,clientFilter,search]);
  const syncedRegisters=useMemo(()=>({
    active:rows.filter(r=>r.register==='ACTIVE').length,
    completed:rows.filter(r=>r.register==='MASTER COPY RECEIVED').length
  }),[rows]);
  const totals=useMemo(()=>filtered.reduce((acc,r)=>{
    const p=profitFor(r);
    acc.count++;
    acc.rateSum+=Number(r.rate)||6;
    acc.shipmentCharges+=auditOnlyExportShipmentCharge(r);
    const extra=exportCategorySummary(r.categoryBags,r.clientName);
    for(const code of EXPORT_BAG_CODES){
      acc.categoryItems[code].bags+=extra.items[code].bags;
      acc.categoryItems[code].clientCharge+=extra.items[code].clientCharge;
      acc.categoryItems[code].deduction+=extra.items[code].deduction;
    }
    acc.categoryClientCharge+=extra.clientCharge;
    acc.categoryDeduction+=extra.deduction;
    acc.categoryProfit+=extra.netProfit;
    if(p!==null){acc.weight+=Number(r.weight);acc.profit+=p;acc.valid++}
    return acc;
  },{count:0,weight:0,rateSum:0,shipmentCharges:0,profit:0,valid:0,
    categoryItems:Object.fromEntries(EXPORT_BAG_CODES.map(code=>[code,{bags:0,clientCharge:0,deduction:0}])),
    categoryClientCharge:0,categoryDeduction:0,categoryProfit:0}),[filtered]);
  return <main style={{padding:'20px clamp(12px,3vw,32px)',background:'#f5f8fc',minHeight:'75vh',color:'#122139'}}>
    <div style={{maxWidth:1500,margin:'auto'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:14,flexWrap:'wrap'}}>
        <div>
          <div style={{fontSize:12,letterSpacing:1.5,fontWeight:900,color:'#3464ae'}}>MAYAVI CARGO • ADMIN ONLY</div>
          <h1 style={{margin:'5px 0',fontSize:27}}>Export Profit Sheet</h1>
          <p style={{margin:'6px 0',color:'#52657f'}}>October 2026 onward • Export Active + current-month Master Copy Received • DHL client ₹11/kg • Overseas client ₹7/kg • Others ₹6/kg</p>
        </div>
        <button type="button" disabled={!filtered.length} onClick={()=>exportCsv(filtered,period||periodOptions.at(-1)||'')} style={{background:'#1952a5',color:'#fff',border:0,borderRadius:9,padding:'11px 15px',fontWeight:800,cursor:'pointer'}}>DOWNLOAD CSV</button>
      </div>
      <div style={{display:'flex',gap:12,flexWrap:'wrap',marginTop:16}}>
        <div style={summary}><small>EXPORT MAWBs</small><div style={{fontSize:23,fontWeight:900}}>{number.format(totals.count)}</div><small>Synced: {syncedRegisters.active} Active + {syncedRegisters.completed} Master Copy Received</small></div>
        <div style={summary}><small>TOTAL WEIGHT (KNOWN)</small><div style={{fontSize:23,fontWeight:900}}>{showWeight(totals.weight)} kg</div></div>
        <div style={summary}><small>AUDIT SHIPMENT CHARGES • MATCHED ROWS ONLY</small><div style={{fontSize:23,fontWeight:900}}>{showCategoryMoney(totals.shipmentCharges)}</div></div>
        <div style={summary}><small>TOTAL PROFIT (INCLUDING EXTRA CATEGORIES)</small><div style={{fontSize:23,fontWeight:900,color:totals.profit<0?'#b91c1c':'#14804b'}}>{showMoney(totals.profit)}</div><small>{totals.valid} of {totals.count} MAWBs calculated</small></div>
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
        <small style={{color:'#64748b',marginLeft:'auto'}}>Updated: {lastLoaded||'—'} • Syncs master updates automatically • checks every 30 seconds</small>
      </div>
      {message&&<p role="status" style={{background:'#eaf0fa',color:'#173e6f',padding:10,borderRadius:8}}>{message}</p>}
      <div style={{overflowX:'auto',background:'#fff',border:'1px solid #dae4f0',borderRadius:12}}>
        <table style={{width:'100%',borderCollapse:'separate',borderSpacing:0}}>
          <thead><tr>{['S.No.','MAWB No.','Register','Client Name','Weight (kg)','Rate (₹/kg)','Shipment Charges (₹) • Audit Auto',
            ...EXPORT_BAG_CODES.flatMap(code=>[EXPORT_BAG_CATEGORIES[code].label+' Bags • Editable',EXPORT_BAG_CATEGORIES[code].label+' Client Charge (₹)',EXPORT_BAG_CATEGORIES[code].label+' Deduction (₹)']),
            'Total Client Charge (₹)','Total Deduction (₹)','Extra Net Profit (₹)','Final Profit (₹)'].map(label=><th key={label} style={header}>{label}</th>)}</tr></thead>
          <tbody>
            {filtered.map((row,index)=><tr key={row.mawb}>
              <td style={cell}>{index+1}</td>
              <td style={{...cell,fontWeight:800}}>{row.mawb}</td>
              <td style={cell}><span style={{padding:'4px 8px',fontSize:11,fontWeight:800,borderRadius:7,
                background:row.register==='MASTER COPY RECEIVED'?'#ecfdf5':'#fef9e9',
                color:row.register==='MASTER COPY RECEIVED'?'#047857':'#8b5e13'}}>
                {row.register==='MASTER COPY RECEIVED'?'Master Copy Received':'Active'}
              </span></td>
              <td style={cell}><span style={clientBadgeStyle(row.clientName)}>{row.clientName||'—'}</span></td>
              <td style={cell}>{showWeight(row.weight)}</td>
              <td style={cell}>{showMoney(Number(row.rate)||6)}</td>
              <td style={{...cell,color:'#99541c',fontWeight:800}} title={row.auditAutoCharge?'MAWB + client match; G&C, D, T, DT all blank in Data Analysis. X-ray + Shift + Loader + Co-loader.':'No qualifying matching Audit row'}>{showCategoryMoney(row.auditAutoCharge?row.shipmentCharge:null)}</td>
              {EXPORT_BAG_CODES.flatMap(code=>{
                const item=exportCategorySummary(row.categoryBags,row.clientName).items[code],key=row.mawb+':'+code;
                return [
                  <td key={key+':bags'} style={cell}><input type="number" min="0" max="100000" step="1" inputMode="numeric"
                    aria-label={EXPORT_BAG_CATEGORIES[code].label+' bags for '+row.mawb}
                    title={(row.auditAutoCodes||[]).includes(code)?'Auto from matching Audit Excel. Edit to lock only this field as manual.':'Editable category bags. Saved manual values are never overwritten by Audit uploads.'}
                    value={categoryDrafts[key]??(item.bags>0?String(item.bags):'')} placeholder="—" disabled={Boolean(saving[key])}
                    onChange={e=>setCategoryDrafts(previous=>({...previous,[key]:e.target.value}))}
                    onBlur={e=>void saveCategoryBags(row,code,e.target.value)}
                    onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur()}}
                    style={{border:'1px solid #93b5d9',borderRadius:7,padding:'7px 8px',width:80,fontWeight:800,background:saving[key]?'#edf2f7':'#fff'}}/>
                    {(row.auditAutoCodes||[]).includes(code)&&<small style={{display:'block',color:'#19705d',fontSize:10}}>AUTO</small>}
                    {(row.manualBagCodes||[]).includes(code)&&<small style={{display:'block',color:'#17427c',fontSize:10}}>MANUAL ✓</small>}</td>,
                  <td key={key+':charge'} style={{...cell,color:'#175c9e',fontWeight:800}}>{showCategoryMoney(item.clientCharge)}</td>,
                  <td key={key+':deduction'} style={{...cell,color:'#a33f36',fontWeight:800}}>{showCategoryMoney(item.deduction)}</td>
                ];
              })}
              <td style={{...cell,fontWeight:850}}>{showCategoryMoney(exportCategorySummary(row.categoryBags,row.clientName).clientCharge)}</td>
              <td style={{...cell,fontWeight:850}}>{showCategoryMoney(exportCategorySummary(row.categoryBags,row.clientName).deduction)}</td>
              <td style={{...cell,fontWeight:900,color:exportCategorySummary(row.categoryBags,row.clientName).netProfit<0?'#b91c1c':'#14804b'}}>{showCategoryMoney(exportCategorySummary(row.categoryBags,row.clientName).netProfit)}</td>
              <td style={{...cell,fontWeight:900,color:profitFor(row)!==null&&profitFor(row)<0?'#b91c1c':'#14804b'}}>{showMoney(profitFor(row))}</td>
            </tr>)}
            {!filtered.length&&<tr><td colSpan={8+EXPORT_BAG_CODES.length*3+3} style={{padding:28,textAlign:'center',color:'#64748b'}}>{loading?'Loading Export shipments…':'No Export MAWB found.'}</td></tr>}
          </tbody>
          {filtered.length>0&&<tfoot><tr style={{background:'#eaf1fd',fontWeight:900}}>
            <td colSpan={4} style={cell}>TOTAL • {filtered.length} MAWBs</td>
            <td style={cell}>{showWeight(totals.weight)}</td>
            <td style={cell} title="Sum of rates (not average)">{showMoney(totals.rateSum)}</td>
            <td style={cell}>{showCategoryMoney(totals.shipmentCharges)}</td>
            {EXPORT_BAG_CODES.flatMap(code=>[
              <td key={code+':bags'} style={cell}>{showCategoryCount(totals.categoryItems[code].bags)}</td>,
              <td key={code+':charge'} style={cell}>{showCategoryMoney(totals.categoryItems[code].clientCharge)}</td>,
              <td key={code+':deduction'} style={cell}>{showCategoryMoney(totals.categoryItems[code].deduction)}</td>
            ])}
            <td style={cell}>{showCategoryMoney(totals.categoryClientCharge)}</td>
            <td style={cell}>{showCategoryMoney(totals.categoryDeduction)}</td>
            <td style={{...cell,color:totals.categoryProfit<0?'#b91c1c':'#14804b'}}>{showCategoryMoney(totals.categoryProfit)}</td>
            <td style={{...cell,color:totals.profit<0?'#b91c1c':'#14804b'}}>{showMoney(totals.profit)}</td>
          </tr></tfoot>}
        </table>
      </div>
      <p style={{fontSize:12,color:'#52657f',marginTop:12}}>Shipment Charges are automatic only if Data Analysis matches BOTH full MAWB and client name, all G&C/D/T/DT Audit fields are genuinely blank, and X-ray/Shift/Loader/Co-loader contain valid amounts. Charge = X-ray + Shift + Loader + Co-loader (Tray excluded). No old fixed ₹2,600/₹2,500 charge or manual per-MAWB override is applied. Profit = (Weight × client rate) − qualifying Audit Shipment Charge + category net profit. D client charge ₹10,000/bag; T/DT client charge ₹6,000/bag; G&C client charge ₹300/bag for TPL/OVERSEAS, others ₹500/bag. G&C deduction ₹300/bag; D/T/DT deductions stay ₹6,000/bag provisionally. DHL client rate ₹11/kg, Overseas ₹7/kg, others ₹6/kg. Category zero values display as —, including totals and CSV, while stored calculations remain numeric. Blank category-bag inputs can be saved as zero without showing 0. Manual category bag edits remain locked from Audit overwrites. Month selection follows Export handover based on recorded Handover YES date in IST, not flight departure; missing weight means that MAWB profit is not calculated.</p>
    </div>
  </main>;
}
