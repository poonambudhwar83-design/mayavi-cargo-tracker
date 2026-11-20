'use client';
import {useEffect,useMemo,useState} from 'react';
import {groupedImportRowMonths,monthOptionsForRows,monthLabel} from '../lib/importCustomerMonth.js';
import {importMonthlyCustomerLedger} from '../lib/importCustomerLedger.js';

const FIELDS=[
  {key:'customerName',label:'Customer Name',aliases:['customer name','client name','consignee','customer','client']},
  {key:'masterNo',label:'Master No',aliases:['master no','master number','mawb','awb no','master awb','master']},
  {key:'flightDate',label:'Flight Date',aliases:['flight date','date of flight','departure date','arrival date']},
  {key:'flightNo',label:'Flight No',aliases:['flight no','flight number','flight']},
  {key:'eiaWeight',label:'EIA Weight (Master kg)',aliases:['eia weight','eia wt','master weight','mawb weight','total weight','eia kg']},
  {key:'origin',label:'Origin',aliases:['origin','from','airport of origin']},
  {key:'duty',label:'Master Duty',aliases:['total duty','duty amount','custom duty','customs duty','duty']},
  {key:'ut',label:'Master UT',aliases:['total ut','ut amount','ut charges','ut']},
  {key:'freight',label:'Master Freight',aliases:['total freight','freight amount','freight charges','freight']},
  {key:'eici',label:'Master EICI',aliases:['total eici','eici amount','eici charges','eici']},
  {key:'customerBags',label:'Customer Bags',aliases:['customer bags','client bags','no of bags','bags','pieces']},
  {key:'customerWeight',label:'Customer Weight (kg)',aliases:['customer weight','client weight','chargeable weight','customer wt','weight customer']},
  {key:'rate',label:'Rate / kg',aliases:['customer rate','rate per kg','selling rate','rate/kg','rate']},
  {key:'description',label:'Description',aliases:['goods description','commodity description','description','goods','commodity']}
];
const KEYS=FIELDS.map(f=>f.key);
const MASTER_FIELDS=['flightDate','flightNo','eiaWeight','origin','duty','ut','freight','eici'];
const COSTS=['duty','ut','freight','eici'];
const NUMBERS=['eiaWeight','duty','ut','freight','eici','customerBags','customerWeight','rate'];
const short=(v='')=>String(v??'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'');
const number=v=>{const s=String(v??'').replace(/[,₹$£\s]/g,'').trim();if(!s)return null;const n=Number(s);return Number.isFinite(n)?n:null;};
const money=v=>v==null||!Number.isFinite(v)?'—':Number(v).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
const styleInput={width:'100%',minWidth:90,boxSizing:'border-box',padding:'7px 8px',border:'1px solid #cbd5e1',borderRadius:6,fontSize:12,background:'#fff',color:'#15233a'};
const buttonStyle={border:'1px solid #cbd5e1',borderRadius:8,padding:'9px 14px',background:'white',color:'#16427a',fontWeight:750,cursor:'pointer'};
function fieldIndex(header,field){
  const h=short(header);if(!h)return -1;
  let best=-1;
  for(const alias of field.aliases){
    const a=short(alias);
    if(h===a)best=Math.max(best,5);
    else if(h.startsWith(a)||a.startsWith(h))best=Math.max(best,3);
  }
  // Avoid guessing that a generic Weight column is customer or master weight.
  return best;
}
function guess(sheet){
  const samples=sheet.rows.slice(0,30);
  let result={headerIndex:0,mapping:{},score:-1};
  samples.forEach((row,i)=>{
    const used=new Set(),mapping={};let score=0;
    for(const f of FIELDS){
      let winning=-1,value=0;
      row.forEach((heading,j)=>{
        if(used.has(j))return;
        const s=fieldIndex(heading,f);
        if(s>value){winning=j;value=s;}
      });
      if(winning>=0){mapping[f.key]=String(winning);used.add(winning);score+=value;}
    }
    if(score>result.score)result={headerIndex:i,mapping,score};
  });
  return result;
}
function toCustomerRows(sheet,headerIndex,mapping){
  if(!sheet)return[];
  const pick=(raw,key)=>mapping[key]===undefined||mapping[key]===''?'':String(raw[Number(mapping[key])]??'').trim();
  const all=[],masterData=new Map();let current='';
  for(let i=headerIndex+1;i<sheet.rows.length;i++){
    const raw=sheet.rows[i];
    const awb=pick(raw,'masterNo');
    if(awb)current=awb;
    if(!current)continue;
    if(!masterData.has(current))masterData.set(current,{});
    const data=masterData.get(current);
    for(const k of MASTER_FIELDS){const v=pick(raw,k);if(v!==''&&data[k]===undefined)data[k]=v;}
    const client=pick(raw,'customerName');
    if(!client||/^(grand\s+)?totals?$/i.test(client))continue;
    const item={id:'row-'+i,masterNo:current};
    for(const k of KEYS)if(k!=='masterNo')item[k]=pick(raw,k);
    all.push(item);
  }
  return all.map(x=>{const common=masterData.get(x.masterNo)||{};for(const k of MASTER_FIELDS)if(x[k]==='')x[k]=common[k]??'';return x;});
}
function allocations(rows){
  const masters=new Map();
  const warnings=[];
  rows.forEach(r=>{
    const no=String(r.masterNo||'').trim();
    if(!no)return;
    const masterKey=String(r._batchId||'')+'|'+no;
    if(!masters.has(masterKey))masters.set(masterKey,{no,rows:[],values:{}});
    const m=masters.get(masterKey);m.rows.push(r);
    for(const k of MASTER_FIELDS){
      const v=String(r[k]??'').trim();if(v==='')continue;
      if(m.values[k]===undefined)m.values[k]=v;
      else if(NUMBERS.includes(k)&&number(m.values[k])!==number(v))m.conflict=true;
    }
  });
  const calculated=new Map();let revenue=0,expense=0,profit=0,invalid=0;
  for(const m of masters.values()){
    const totalWeight=number(m.values.eiaWeight);
    const sumCustomer=m.rows.reduce((s,r)=>s+(number(r.customerWeight)||0),0);
    if(m.conflict)warnings.push('Master '+m.no+': repeated master expenses/weight differ; please check.');
    if(!totalWeight||totalWeight<=0)warnings.push('Master '+m.no+': EIA weight missing/zero, allocation cannot be calculated.');
    else if(sumCustomer>totalWeight+0.01)warnings.push('Master '+m.no+': total customer weight ('+sumCustomer+' kg) exceeds EIA weight ('+totalWeight+' kg).');
    else if(Math.abs(sumCustomer-totalWeight)>0.01)warnings.push('Master '+m.no+': '+(totalWeight-sumCustomer).toFixed(2)+' kg is not assigned to a customer.');
    for(const r of m.rows){
      const cw=number(r.customerWeight),rate=number(r.rate);
      const valid=totalWeight>0&&cw!==null&&cw>=0&&rate!==null;
      const sales=valid?cw*rate:null;
      const shares={};
      for(const k of COSTS)shares[k]=valid?(number(m.values[k])||0)*cw/totalWeight:null;
      const costs=valid?COSTS.reduce((s,k)=>s+shares[k],0):null;
      const pl=valid?sales-costs:null;
      calculated.set(r.id,{sales,shares,costs,pl,weight:totalWeight,perKg:totalWeight>0?(number(m.values.duty)||0)/totalWeight:null});
      if(valid){revenue+=sales;expense+=costs;profit+=pl;}else invalid++;
    }
  }
  return {masters,warnings,calculated,revenue,expense,profit,invalid};
}
const encodeCsv=v=>{const s=String(v??'');return '"'+(/^[=+@]/.test(s)?"'"+s:s).replace(/"/g,'""')+'"';};
export default function ImportCustomerAllocation({view='DATA'}){
  const [batches,setBatches]=useState([]),[batchId,setBatchId]=useState(''),[rows,setRows]=useState([]);
  const [fileName,setFileName]=useState(''),[sheetName,setSheetName]=useState('');
  const [book,setBook]=useState(null),[sheetIndex,setSheetIndex]=useState(0),[headerIndex,setHeaderIndex]=useState(0),[mapping,setMapping]=useState({});
  const [busy,setBusy]=useState(false),[status,setStatus]=useState(''),[filter,setFilter]=useState('');
  const mode=view==='SUMMARY'?'MONTHLY':'EDIT';
  const [months,setMonths]=useState([]),[month,setMonth]=useState('');
  const [monthlyRows,setMonthlyRows]=useState([]),[monthlyBusy,setMonthlyBusy]=useState(false),[limited,setLimited]=useState(false);
  const [editMonth,setEditMonth]=useState('');
  const [unsavedChanges,setUnsavedChanges]=useState(false);
  const sheet=book?.sheets?.[sheetIndex];
  const editorMonths=useMemo(()=>monthOptionsForRows(rows),[rows]);
  const selectedEditorMonth=editMonth==='ALL'||editorMonths.some(m=>m.key===editMonth)?editMonth:'ALL';
  const editorRows=useMemo(()=>selectedEditorMonth==='ALL'?rows:groupedImportRowMonths(rows).filter(x=>x.month===selectedEditorMonth).map(x=>x.row),[rows,selectedEditorMonth]);
  const visibleRows=mode==='MONTHLY'?monthlyRows:editorRows;
  const calc=useMemo(()=>allocations(visibleRows),[visibleRows]);
  const displayed=useMemo(()=>visibleRows.filter(r=>!filter||[r.masterNo,r.customerName,r.description,r.flightNo,r.origin].some(x=>String(x||'').toLowerCase().includes(filter.toLowerCase()))),[visibleRows,filter]);
  const customerLedger=useMemo(()=>{
    const all=importMonthlyCustomerLedger(visibleRows,calc.calculated);
    const term=filter.trim().toLowerCase();
    return term?all.filter(g=>[g.customerName,g.originText,g.descriptionText,...g.entries.flatMap(r=>[r.masterNo,r.flightDate])].some(x=>String(x||'').toLowerCase().includes(term))):all;
  },[mode,visibleRows,calc,filter]);
  const fixedCols=[{width:205,left:0},{width:145,left:205},{width:130,left:350}];
  const frozen=(index,header=false,odd=false)=>index<3?{position:'sticky',left:fixedCols[index].left,width:fixedCols[index].width,minWidth:fixedCols[index].width,maxWidth:fixedCols[index].width,background:header?'#daeafa':odd?'#f8fbff':'#fff',zIndex:header?5:2,boxSizing:'border-box',boxShadow:index===2?'3px 0 5px rgba(37,74,115,.12)':undefined}:{};


  async function load(id=''){
    const res=await fetch('/api/import-customer-allocation'+(id?'?id='+encodeURIComponent(id):''),{credentials:'include',cache:'no-store'});
    const data=await res.json();if(!res.ok||!data.ok)throw Error(data.error||'Could not load saved imports.');
    setBatches(data.batches||[]);
    setBatchId(data.batch?.id||'');setRows(data.batch?.data_rows||[]);
    setFileName(data.batch?.file_name||'');setSheetName(data.batch?.sheet_name||'');
    setBook(null);setUnsavedChanges(false);
    return data.batch||null;
  }
  async function loadMonthly(requested=''){
    setMonthlyBusy(true);
    try{
      const url='/api/import-customer-allocation?view=monthly'+(requested?'&month='+encodeURIComponent(requested):'');
      const response=await fetch(url,{credentials:'include',cache:'no-store'});
      const data=await response.json();
      if(!response.ok||!data.ok)throw Error(data.error||'Monthly records could not be loaded.');
      setMonths(data.months||[]);
      setMonth(data.month||'');
      setMonthlyRows(data.rows||[]);
      setLimited(Boolean(data.limitedToMostRecentBatches));
    }finally{setMonthlyBusy(false);}
  }
  useEffect(()=>{let active=true;(async()=>{
    const results=await Promise.allSettled([load(),loadMonthly()]);
    const failed=results.find(x=>x.status==='rejected');
    if(active&&failed)setStatus(failed.reason?.message||'Import data could not be loaded.');
  })();return()=>{active=false}},[]);
  function selectSheet(bookData,index){const found=guess(bookData.sheets[index]);setSheetIndex(index);setHeaderIndex(found.headerIndex);setMapping(found.mapping);setRows([]);}
  async function upload(file){
    if(!file)return;
    setBusy(true);setStatus('');
    try{
      const form=new FormData();form.append('file',file);
      const res=await fetch('/api/import-customer-allocation',{method:'POST',credentials:'include',body:form});
      const data=await res.json();if(!res.ok||!data.ok)throw Error(data.error||'Could not parse Excel.');
      setBook(data);setFileName(data.fileName);setSheetName(data.sheets[0].sheet);setBatchId('');selectSheet(data,0);
      setStatus('Excel read successfully. Verify the column mapping, then click Prepare Customer Rows.');
    }catch(e){setStatus(e.message)}finally{setBusy(false)}
  }
  function prepare(){
    const needed=['masterNo','customerName','customerWeight'];
    if(needed.some(k=>mapping[k]===undefined||mapping[k]==='')){setStatus('Map Master No, Customer Name and Customer Weight first.');return;}
    const extracted=toCustomerRows(sheet,headerIndex,mapping);
    setRows(extracted);setBatchId('');setSheetName(sheet.name||sheet.sheet||'');
    setStatus(extracted.length+' customer rows prepared from '+(sheet.name||sheet.sheet)+'. Check EIA weight, master costs and rates before saving.');
  }
  function edit(id,key,value){
    setUnsavedChanges(true);
    setRows(current=>{
      const changed=current.find(r=>r.id===id);
      if(!changed)return current;
      // Master-level fields are shared across every client under that master.
      return current.map(r=>r.id===id||MASTER_FIELDS.includes(key)&&r.masterNo===changed.masterNo?{...r,[key]:value}:r);
    });
  }
  async function save(){
    if(!rows.length){setStatus('No customer records to save.');return;}
    if(!batchId){setStatus('No saved record selected. Your existing data must be loaded before editing.');return;}
    if(rows.some(r=>!String(r.masterNo||'').trim()||!String(r.customerName||'').trim())){setStatus('Master No and Customer Name are required for each row.');return;}
    setBusy(true);setStatus('');
    try{
      const res=await fetch('/api/import-customer-allocation',{method:'PUT',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({id:batchId,fileName,sheetName,rows})});
      const data=await res.json().catch(()=>({ok:false,error:'Invalid save response from Mayavi.'}));
      if(!res.ok||!data.ok)throw new Error(data.error||'Save failed.');
      const stored=await load(data.id);
      if(!stored||stored.id!==data.id||!Array.isArray(stored.data_rows)||stored.data_rows.length!==rows.length){
        throw Error('Database verification failed. Please check saved records; do not overwrite the page.');
      }
      setUnsavedChanges(false);
      setStatus('Saved & verified in Mayavi database: '+data.rowCount+' customer records. Your changes are retained after refresh.');
      await loadMonthly(month).catch(()=>{});
    }catch(e){setStatus('Save not confirmed: '+String(e.message||e))}finally{setBusy(false)}
  }
  function download(){
    const lines=[];
    if(mode==='MONTHLY'){
      lines.push(['Customer Name','Origin','Description','Total Weight (kg)','Total Profit / Loss'].map(encodeCsv).join(','));
      for(const g of customerLedger)lines.push([g.customerName,g.originText,g.descriptionText,g.totalWeight,g.pendingProfitRows?'Pending / partial: '+g.totalProfit:g.totalProfit].map(encodeCsv).join(','));
    }else{
      lines.push([...FIELDS.map(f=>f.label),'Duty/kg','Customer Duty','Customer EICI','Customer UT','Customer Freight','Revenue','Profit/Loss'].map(encodeCsv).join(','));
      for(const r of displayed){
        const a=calc.calculated.get(r.id);
        lines.push([...KEYS.map(k=>r[k]),a?.perKg,a?.shares.duty,a?.shares.eici,a?.shares.ut,a?.shares.freight,a?.sales,a?.pl].map(encodeCsv).join(','));
      }
    }
    const blob=new Blob(['\uFEFF'+lines.join('\r\n')],{type:'text/csv;charset=utf-8'});
    const url=URL.createObjectURL(blob),anchor=document.createElement('a');
    anchor.href=url;
    anchor.download='mayavi-'+(mode==='MONTHLY'?'customer-summary-'+month:'import-customer-main-'+selectedEditorMonth)+'.csv';
    anchor.click();URL.revokeObjectURL(url);
  }
  
  return <main style={{padding:'18px clamp(12px,2.6vw,30px)',color:'#172b46',maxWidth:'100%',boxSizing:'border-box'}}>
    <h1 style={{fontSize:24,margin:'0 0 4px'}}>{mode==='MONTHLY'?'Import · Monthly Customer Summary':'Import · Customer-wise Profit / Loss (Main Data)'}</h1>
    <p style={{fontSize:13,color:'#526378',margin:'0 0 16px'}}>{mode==='MONTHLY'?'A separate, read-only customer summary calculated from the saved Import Customer P&L main data.':'Original Excel-loaded detailed customer records, saved in Mayavi. All original columns remain editable; choose All Months or a flight month.'}</p>
    {mode==='MONTHLY'&&<section style={{display:'flex',gap:14,flexWrap:'wrap',alignItems:'center',padding:15,background:'#eaf3ff',border:'1px solid #cbdff7',borderRadius:12}}>
      <label style={{fontSize:13,fontWeight:850}}>Select Month
        <select aria-label="Import customer reporting month" value={month} disabled={monthlyBusy} onChange={e=>{setFilter('');void loadMonthly(e.target.value).catch(err=>setStatus(err.message))}} style={{...styleInput,minWidth:210,display:'block',marginTop:6}}>
          {!months.length&&<option value="">No saved months</option>}
          {months.map(m=><option key={m.key} value={m.key}>{m.label} · {m.customers} customers</option>)}
        </select>
      </label>
      <div style={{fontSize:13,color:'#2d4d75',flex:1,minWidth:220}}><strong>{monthLabel(month)}</strong><div>Summary only — the complete Excel-loaded records remain in Import Customer P&L.</div></div>
      <button type="button" disabled={monthlyBusy} style={buttonStyle} onClick={()=>void loadMonthly(month).catch(err=>setStatus(err.message))}>{monthlyBusy?'Loading…':'Refresh Month'}</button>
      <button type="button" disabled={monthlyBusy||!monthlyRows.length} style={buttonStyle} onClick={download}>Download Month CSV</button>
    </section>}
    {mode==='EDIT'&&<div style={{display:'flex',gap:12,flexWrap:'wrap',alignItems:'center',padding:13,background:'#eff6ff',border:'1px solid #cddff9',borderRadius:10}}>
      <label style={{fontWeight:800,fontSize:13}}>Saved Customer Records
        <select style={{...styleInput,display:'block',minWidth:250,marginTop:6}} value={batchId} disabled={busy} onChange={e=>{if(unsavedChanges&&!window.confirm('Discard unsaved changes and open another saved record?'))return;setBusy(true);setStatus('');void load(e.target.value).catch(err=>setStatus(err.message)).finally(()=>setBusy(false))}}>
          {!batches.length&&<option value="">No saved records</option>}
          {batches.map(b=><option key={b.id} value={b.id}>{b.file_name} · {b.row_count} rows</option>)}
        </select>
      </label>
      <button type="button" style={{...buttonStyle,background:'#175cd3',color:'#fff'}} disabled={busy||!batchId||!rows.length} onClick={()=>void save()}>{busy?'Saving…':'Save Changes'}</button>
      <button type="button" style={buttonStyle} disabled={!rows.length} onClick={download}>Download CSV</button>
      <button type="button" style={buttonStyle} disabled={!rows.length} onClick={()=>{setUnsavedChanges(true);setRows(old=>[...old,{id:'manual-'+Date.now(),...Object.fromEntries(KEYS.map(k=>[k,MASTER_FIELDS.includes(k)?String(old[old.length-1]?.[k]||''):''])),masterNo:String(old[old.length-1]?.masterNo||'')}])}}>+ Add Customer</button>
      <span style={{fontSize:12,fontWeight:750,color:unsavedChanges?'#b45309':'#18724b'}}>{unsavedChanges?'Unsaved changes — press Save Changes':'Records stored in Mayavi database'}</span>
    </div>}
    {mode==='MONTHLY'&&limited&&<p style={{fontSize:12,color:'#975111'}}>Monthly history includes the 250 most recently updated Excel uploads. Older records are retained in the database.</p>}
    {status&&<p role="status" style={{padding:'10px 12px',borderRadius:8,background:'#fff9e6',border:'1px solid #ead4a6',fontSize:13}}>{status}</p>}
    {mode==='EDIT'&&rows.length>0&&<div style={{display:'flex',gap:12,flexWrap:'wrap',alignItems:'center',marginTop:14,padding:12,background:'#f2f7ff',border:'1px solid #d4e0ed',borderRadius:10}}>
      <label style={{fontSize:13,fontWeight:800}}>Flight Month <select value={selectedEditorMonth} onChange={e=>{setEditMonth(e.target.value);setFilter('')}} style={{...styleInput,minWidth:190,marginLeft:10}}>
        <option value="ALL">All Months · {rows.length} customer rows</option>
        {editorMonths.map(m=><option key={m.key} value={m.key}>{m.label} · {m.customers} rows</option>)}
      </select></label>
      <span style={{fontSize:12,color:'#52657b'}}>Original saved Excel data. Changes are retained in the same dataset after Save Changes.</span>
    </div>}
    <h2 style={{margin:'17px 0 5px',fontSize:17}}>{mode==='MONTHLY'?'Customer Summary · '+monthLabel(month):'Original Customer Data · '+(selectedEditorMonth==='ALL'?'All Months':monthLabel(selectedEditorMonth))}</h2>
    <p style={{margin:'7px 0 12px',fontSize:13,color:'#526780',fontWeight:700}}>{mode==='MONTHLY'?customerLedger.length+' Customers · '+visibleRows.length+' Entries':visibleRows.length+' Original Customer Rows · '+calc.masters.size+' Masters'}</p>
    {calc.invalid>0&&<p style={{color:'#a13519',fontSize:13,fontWeight:750}}>Profit/Loss not calculated for {calc.invalid} row(s): verify EIA Weight, Customer Weight and Rate.</p>}
    {calc.warnings.length>0&&<details style={{background:'#fff8e9',border:'1px solid #eed8a9',borderRadius:9,padding:12,marginBottom:12}}><summary style={{fontWeight:800,fontSize:13}}>{calc.warnings.length} master weight / amount warnings</summary><ul style={{fontSize:12}}>{calc.warnings.slice(0,60).map((w,i)=><li key={i}>{w}</li>)}</ul></details>}
    {visibleRows.length>0&&<label style={{display:'block',marginBottom:10,fontSize:13,fontWeight:750}}>Search Customer / Master / Origin / Description <input type="search" value={filter} onChange={e=>setFilter(e.target.value)} placeholder="Master, customer, flight..." style={{...styleInput,width:280,marginLeft:10}}/></label>}
    {mode==='MONTHLY'&&<div style={{overflowX:'auto',maxWidth:'100%',border:'1px solid #d4e0ed',borderRadius:10,background:'#fff'}}>
      <table style={{borderCollapse:'collapse',width:'100%',fontSize:13}}>
        <thead><tr style={{background:'#daeafa',color:'#173c64'}}>
          {['Customer Name','Origin','Description','Total Weight (kg)','Total Profit / Loss'].map((h,i)=><th key={h} style={{borderBottom:'2px solid #adc8e2',padding:'11px 10px',textAlign:i>=3?'right':'left',minWidth:i===0?160:i===2?210:115}}>{h}</th>)}
        </tr></thead>
        <tbody>{customerLedger.map((g,i)=><tr key={g.id} style={{background:i%2?'#f8fbff':'#fff'}}>
          <td style={{padding:'9px 10px',borderBottom:'1px solid #e2eaf4',fontWeight:750}}>{g.customerName}</td>
          <td style={{padding:'9px 10px',borderBottom:'1px solid #e2eaf4',maxWidth:210}}>{g.originText}</td>
          <td style={{padding:'9px 10px',borderBottom:'1px solid #e2eaf4',maxWidth:320}}>{g.descriptionText}</td>
          <td style={{padding:'9px 10px',borderBottom:'1px solid #e2eaf4',textAlign:'right',whiteSpace:'nowrap'}}>{money(g.totalWeight)}</td>
          <td style={{padding:'9px 10px',borderBottom:'1px solid #e2eaf4',textAlign:'right',whiteSpace:'nowrap',fontWeight:800,color:g.totalProfit<0?'#b42318':'#087a4c'}}>{g.validProfitRows?money(g.totalProfit):'Pending'}{g.pendingProfitRows>0&&<span style={{display:'block',fontSize:11,color:'#a15c18'}}>{g.pendingProfitRows} rows pending</span>}</td>
        </tr>)}</tbody>
      </table>
      {!customerLedger.length&&<p style={{padding:16,color:'#526780'}}>No saved customer data for {monthLabel(month)}.</p>}
    </div>}
    {mode==='EDIT'&&<div style={{overflowX:'auto',maxWidth:'100%',border:'1px solid #d4e0ed',borderRadius:10,background:'#fff'}}>
      <table style={{borderCollapse:'separate',borderSpacing:0,fontSize:12,width:'max-content',minWidth:'100%'}}>
        <thead><tr style={{background:'#daeafa',color:'#173c64'}}>{[...FIELDS.map(f=>f.label),'Duty/kg','Customer Duty','Customer EICI','Customer UT','Customer Freight','Revenue','Profit / Loss',''].map((h,i)=><th key={i} style={{borderBottom:'2px solid #adc8e2',padding:'9px 7px',textAlign:'left',whiteSpace:'nowrap',...frozen(i,true)}}>{h}</th>)}</tr></thead>
        <tbody>{displayed.map((r,i)=>{const a=calc.calculated.get(r.id);return <tr key={r.id} style={{background:i%2?'#f8fbff':'white'}}>
          {FIELDS.map((f,fieldIndex)=><td key={f.key} style={{padding:'5px 3px',borderBottom:'1px solid #e5ebf2',...frozen(fieldIndex,false,i%2===1)}}>
            <input aria-label={f.label+' for '+(r.customerName||r.masterNo)} title={MASTER_FIELDS.includes(f.key)?'This changes all customers under the same master.':undefined}
              style={{...styleInput,minWidth:['customerName','description'].includes(f.key)?175:f.key==='masterNo'?120:90}} value={r[f.key]??''} onChange={e=>edit(r.id,f.key,e.target.value)}/>
          </td>)}
          <td style={{padding:'8px 10px'}}>{money(a?.perKg)}</td>
          {['duty','eici','ut','freight'].map(k=><td key={k} style={{padding:'8px 10px',textAlign:'right'}}>{money(a?.shares[k])}</td>)}
          <td style={{padding:'8px 10px',textAlign:'right'}}>{money(a?.sales)}</td>
          <td style={{padding:'8px 10px',textAlign:'right',fontWeight:850,color:a?.pl<0?'#b42318':'#087a4c'}}>{money(a?.pl)}</td>
          <td style={{padding:6}}><button type="button" style={{...buttonStyle,padding:'5px 8px',color:'#b42318'}} onClick={()=>{setUnsavedChanges(true);setRows(old=>old.filter(x=>x.id!==r.id))}}>Remove</button></td>
        </tr>})}</tbody>
      </table>
      {!displayed.length&&<p style={{padding:18,color:'#53657c'}}>No saved records for {monthLabel(selectedEditorMonth)}. Choose another month.</p>}
    </div>}
    <p style={{fontSize:12,color:'#56687c',marginTop:12}}>Formula: Customer Cost = Master Total Cost ÷ EIA Weight × Customer Weight. Revenue = Customer Weight × Rate. Profit/Loss = Revenue − Customer Duty − Customer EICI − Customer UT − Customer Freight. Customer Bags are recorded for reference and can be used in later rules.</p>
  </main>;
}
