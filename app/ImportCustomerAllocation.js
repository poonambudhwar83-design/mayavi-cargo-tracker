'use client';
import {useEffect,useMemo,useState} from 'react';
import {groupedImportRowMonths,monthOptionsForRows,monthLabel} from '../lib/importCustomerMonth.js';

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
export default function ImportCustomerAllocation(){
  const [batches,setBatches]=useState([]),[batchId,setBatchId]=useState(''),[rows,setRows]=useState([]);
  const [fileName,setFileName]=useState(''),[sheetName,setSheetName]=useState('');
  const [book,setBook]=useState(null),[sheetIndex,setSheetIndex]=useState(0),[headerIndex,setHeaderIndex]=useState(0),[mapping,setMapping]=useState({});
  const [busy,setBusy]=useState(false),[status,setStatus]=useState(''),[filter,setFilter]=useState('');
  const [mode,setMode]=useState('MONTHLY'),[months,setMonths]=useState([]),[month,setMonth]=useState('');
  const [monthlyRows,setMonthlyRows]=useState([]),[monthlyBusy,setMonthlyBusy]=useState(false),[limited,setLimited]=useState(false);
  const [editMonth,setEditMonth]=useState('');
  const sheet=book?.sheets?.[sheetIndex];
  const editorMonths=useMemo(()=>monthOptionsForRows(rows),[rows]);
  const selectedEditorMonth=editorMonths.some(m=>m.key===editMonth)?editMonth:(editorMonths[0]?.key||'');
  const editorRows=useMemo(()=>groupedImportRowMonths(rows).filter(x=>x.month===selectedEditorMonth).map(x=>x.row),[rows,selectedEditorMonth]);
  const visibleRows=mode==='MONTHLY'?monthlyRows:editorRows;
  const calc=useMemo(()=>allocations(visibleRows),[visibleRows]);
  const displayed=useMemo(()=>visibleRows.filter(r=>!filter||[r.masterNo,r.customerName,r.description,r.flightNo].some(x=>String(x||'').toLowerCase().includes(filter.toLowerCase()))),[visibleRows,filter]);

  async function load(id=''){
    const res=await fetch('/api/import-customer-allocation'+(id?'?id='+encodeURIComponent(id):''),{credentials:'include',cache:'no-store'});
    const data=await res.json();if(!res.ok||!data.ok)throw Error(data.error||'Could not load saved imports.');
    setBatches(data.batches||[]);
    setBatchId(data.batch?.id||'');setRows(data.batch?.data_rows||[]);
    setFileName(data.batch?.file_name||'');setSheetName(data.batch?.sheet_name||'');
    setBook(null);
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
    setRows(current=>{
      const changed=current.find(r=>r.id===id);
      if(!changed)return current;
      // Master-level fields are shared across every client under that master.
      return current.map(r=>r.id===id||MASTER_FIELDS.includes(key)&&r.masterNo===changed.masterNo?{...r,[key]:value}:r);
    });
  }
  async function save(){
    if(!rows.length){setStatus('No customer rows to save.');return;}
    if(rows.some(r=>!String(r.masterNo||'').trim()||!String(r.customerName||'').trim())){setStatus('Each row needs a Master No and Customer Name.');return;}
    setBusy(true);setStatus('');
    try{
      const res=await fetch('/api/import-customer-allocation',{method:'PUT',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({id:batchId||undefined,fileName,sheetName,rows})});
      const data=await res.json();if(!res.ok||!data.ok)throw Error(data.error||'Save failed.');
      await load(data.id);await loadMonthly(month).catch(()=>{});setStatus(data.rowCount+' customer rows saved securely to Mayavi.');
    }catch(e){setStatus(e.message)}finally{setBusy(false)}
  }
  function download(){
    const labels=[...FIELDS.map(f=>f.label),'Duty/kg','Customer Duty','Customer EICI','Customer UT','Customer Freight','Revenue','Profit/Loss'];
    const lines=[labels.map(encodeCsv).join(',')];
    for(const r of displayed){
      const a=calc.calculated.get(r.id);
      lines.push([...KEYS.map(k=>r[k]),a?.perKg,a?.shares.duty,a?.shares.eici,a?.shares.ut,a?.shares.freight,a?.sales,a?.pl].map(encodeCsv).join(','));
    }
    const blob=new Blob(['\uFEFF'+lines.join('\r\n')],{type:'text/csv;charset=utf-8'});
    const url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download='mayavi-import-customer-profit-'+(mode==='MONTHLY'?month:selectedEditorMonth||'upload')+'.csv';anchor.click();URL.revokeObjectURL(url);
  }
  const stat=(label,value)=> <div style={{background:'#f6f9ff',border:'1px solid #dce6f5',borderRadius:10,padding:'12px 16px',minWidth:145}}><div style={{fontSize:11,color:'#53647a',fontWeight:800}}>{label}</div><b style={{display:'block',fontSize:19,marginTop:4,color:'#123966'}}>{value}</b></div>;
  return <main style={{padding:'18px clamp(12px,2.6vw,30px)',color:'#172b46',maxWidth:'100%',boxSizing:'border-box'}}>
    <h1 style={{fontSize:24,margin:'0 0 4px'}}>Import · Customer-wise Profit / Loss</h1>
    <p style={{fontSize:13,color:'#526378',margin:'0 0 16px'}}>One master, multiple customers. Duty, EICI, UT and Freight are allocated by customer weight. Monthly Records are based on Flight Date, not the Excel upload date.</p>
    <nav aria-label="Customer import views" style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:14}}>
      <button type="button" aria-current={mode==='MONTHLY'?'page':undefined} style={{...buttonStyle,background:mode==='MONTHLY'?'#2055a2':'#fff',color:mode==='MONTHLY'?'#fff':'#214f87'}} onClick={()=>{setMode('MONTHLY');setFilter('')}}>Monthly Records</button>
      <button type="button" aria-current={mode==='EDIT'?'page':undefined} style={{...buttonStyle,background:mode==='EDIT'?'#2055a2':'#fff',color:mode==='EDIT'?'#fff':'#214f87'}} onClick={()=>{setMode('EDIT');setFilter('')}}>Upload / Edit Excel</button>
    </nav>
    {mode==='MONTHLY'&&<section style={{display:'flex',gap:14,flexWrap:'wrap',alignItems:'center',padding:15,background:'#eaf3ff',border:'1px solid #cbdff7',borderRadius:12}}>
      <label style={{fontSize:13,fontWeight:850}}>Select Month
        <select aria-label="Import customer reporting month" value={month} disabled={monthlyBusy} onChange={e=>{setFilter('');void loadMonthly(e.target.value).catch(err=>setStatus(err.message))}} style={{...styleInput,minWidth:210,display:'block',marginTop:6}}>
          {!months.length&&<option value="">No saved months</option>}
          {months.map(m=><option key={m.key} value={m.key}>{m.label} · {m.customers} customers</option>)}
        </select>
      </label>
      <div style={{fontSize:13,color:'#2d4d75',flex:1,minWidth:220}}><strong>{monthLabel(month)}</strong><div>All saved Excel uploads in this month, grouped by flight date.</div></div>
      <button type="button" disabled={monthlyBusy} style={buttonStyle} onClick={()=>void loadMonthly(month).catch(err=>setStatus(err.message))}>{monthlyBusy?'Loading…':'Refresh Month'}</button>
    </section>}
    {mode==='EDIT'&&<div style={{display:'flex',gap:12,flexWrap:'wrap',alignItems:'center',padding:15,background:'#eff6ff',border:'1px solid #cddff9',borderRadius:12}}>
      <label style={{fontWeight:800,fontSize:13}}>Upload Excel (.xlsx) <input type="file" accept=".xlsx" disabled={busy} onChange={e=>{void upload(e.target.files?.[0]);e.target.value=''}} style={{display:'block',marginTop:7,maxWidth:265}}/></label>
      <label style={{fontWeight:800,fontSize:13}}>Saved imports
        <select style={{...styleInput,display:'block',minWidth:200,marginTop:7}} value={batchId} onChange={e=>{setBusy(true);void load(e.target.value).catch(err=>setStatus(err.message)).finally(()=>setBusy(false))}}>
          <option value="">New / Unsaved Upload</option>
          {batches.map(b=><option key={b.id} value={b.id}>{b.file_name} ({b.row_count} customers)</option>)}
        </select>
      </label>
      <button type="button" style={{...buttonStyle,background:'#175cd3',color:'#fff'}} disabled={busy||!rows.length} onClick={()=>void save()}>{busy?'Working…':'Save Customer Data'}</button>
      <button type="button" style={buttonStyle} disabled={!rows.length} onClick={download}>Download CSV</button>
      <button type="button" style={buttonStyle} disabled={!rows.length} onClick={()=>setRows(old=>[...old,{id:'manual-'+Date.now(),...Object.fromEntries(KEYS.map(k=>[k,MASTER_FIELDS.includes(k)?String(old[old.length-1]?.[k]||''):''])),masterNo:String(old[old.length-1]?.masterNo||'')}])}>+ Add Customer</button>
    </div>
    {mode==='MONTHLY'&&limited&&<p style={{fontSize:12,color:'#975111'}}>Monthly history includes the 250 most recently updated Excel uploads. Older uploads are preserved and can still be opened from Upload / Edit Excel.</p>}
    {status&&<p role="status" style={{padding:'10px 12px',borderRadius:8,background:'#fff9e6',border:'1px solid #ead4a6',fontSize:13}}>{status}</p>}
    {mode==='EDIT'&&book&&sheet&&<section style={{border:'1px solid #cfe0f3',padding:15,borderRadius:12,marginTop:14,background:'#fff'}}>
      <h2 style={{fontSize:17,margin:'0 0 10px'}}>Step 1 · Match Excel Columns</h2>
      <div style={{display:'flex',gap:10,flexWrap:'wrap',alignItems:'center'}}>
        <label>Worksheet <select value={sheetIndex} style={styleInput} onChange={e=>selectSheet(book,Number(e.target.value))}>{book.sheets.map((s,i)=><option key={i} value={i}>{s.sheet}</option>)}</select></label>
        <label>Header row <select value={headerIndex} style={styleInput} onChange={e=>{setHeaderIndex(Number(e.target.value));setRows([])}}>{sheet.rows.slice(0,30).map((r,i)=><option value={i} key={i}>Row {i+1} · {r.filter(Boolean).slice(0,3).join(' | ').slice(0,75)}</option>)}</select></label>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(210px,1fr))',gap:10,margin:'12px 0'}}>
        {FIELDS.map(f=><label key={f.key} style={{fontSize:12,fontWeight:800,color:'#334c69'}}>{f.label}
          <select style={{...styleInput,marginTop:4}} value={mapping[f.key]??''} onChange={e=>{setMapping(m=>({...m,[f.key]:e.target.value}));setRows([])}}>
            <option value="">— Not in Excel —</option>
            {(sheet.rows[headerIndex]||[]).map((h,i)=><option value={String(i)} key={i}>{String.fromCharCode(65+i)} · {h||'(blank)'}</option>)}
          </select>
        </label>)}
      </div>
      <button type="button" style={{...buttonStyle,background:'#0b8376',color:'#fff'}} onClick={prepare}>Step 2 · Prepare Customer Rows</button>
      <p style={{fontSize:12,color:'#526478'}}>Master fields in merged/blank customer rows will inherit the same master’s details. Correct the mappings whenever required; nothing is saved until you click Save Customer Data.</p>
    </section>}
    {mode==='EDIT'&&editorMonths.length>0&&<div style={{display:'flex',gap:12,flexWrap:'wrap',alignItems:'center',marginTop:14,padding:12,background:'#f2f7ff',border:'1px solid #d4e0ed',borderRadius:10}}>
      <label style={{fontSize:13,fontWeight:800}}>View/Edit Month <select value={selectedEditorMonth} onChange={e=>{setEditMonth(e.target.value);setFilter('')}} style={{...styleInput,minWidth:190,marginLeft:10}}>
        {editorMonths.map(m=><option key={m.key} value={m.key}>{m.label} · {m.customers} customers</option>)}
      </select></label>
      <span style={{fontSize:12,color:'#52657b'}}>Only {monthLabel(selectedEditorMonth)} is shown. Save Customer Data saves the entire Excel upload, including other months.</span>
    </div>}
    <h2 style={{margin:'17px 0 5px',fontSize:17}}>{mode==='MONTHLY'?'Monthly Profit / Loss · '+monthLabel(month):'Upload / Edit · '+monthLabel(selectedEditorMonth)}</h2>
    <div style={{display:'flex',flexWrap:'wrap',gap:10,margin:'12px 0'}}>
      {stat('Masters',calc.masters.size)}
      {stat('Customers',visibleRows.length)}
      {stat('Total Revenue','₹ '+money(calc.revenue))}
      {stat('Allocated Expenses','₹ '+money(calc.expense))}
      {stat('Total Profit / Loss','₹ '+money(calc.profit))}
    </div>
    {calc.invalid>0&&<p style={{color:'#a13519',fontSize:13,fontWeight:750}}>Profit/Loss not calculated for {calc.invalid} row(s): verify EIA Weight, Customer Weight and Rate.</p>}
    {calc.warnings.length>0&&<details style={{background:'#fff8e9',border:'1px solid #eed8a9',borderRadius:9,padding:12,marginBottom:12}}><summary style={{fontWeight:800,fontSize:13}}>{calc.warnings.length} master weight / amount warnings</summary><ul style={{fontSize:12}}>{calc.warnings.slice(0,60).map((w,i)=><li key={i}>{w}</li>)}</ul></details>}
    {visibleRows.length>0&&<label style={{display:'block',marginBottom:10,fontSize:13,fontWeight:750}}>Search master / customer <input type="search" value={filter} onChange={e=>setFilter(e.target.value)} placeholder="Master, customer, flight..." style={{...styleInput,width:280,marginLeft:10}}/></label>}
    <div style={{overflowX:'auto',maxWidth:'100%',border:'1px solid #d4e0ed',borderRadius:10,background:'#fff'}}>
      <table style={{borderCollapse:'collapse',fontSize:12,width:'max-content',minWidth:'100%'}}>
        <thead><tr style={{background:'#daeafa',color:'#173c64'}}>{['#',...FIELDS.map(f=>f.label),'Duty/kg','Customer Duty','Customer EICI','Customer UT','Customer Freight','Revenue','Profit / Loss',mode==='MONTHLY'?'Source Excel':''].map((h,i)=><th key={i} style={{borderBottom:'2px solid #adc8e2',padding:'9px 7px',textAlign:'left',whiteSpace:'nowrap'}}>{h}</th>)}</tr></thead>
        <tbody>{displayed.map((r,i)=>{const a=calc.calculated.get(r.id);return <tr key={r.id} style={{background:i%2?'#f8fbff':'white'}}>
          <td style={{padding:7}}>{i+1}</td>
          {FIELDS.map(f=><td key={f.key} style={{padding:'5px 3px',borderBottom:'1px solid #e5ebf2'}}>
            {mode==='EDIT'?<input aria-label={f.label+' for '+(r.customerName||r.masterNo)} title={MASTER_FIELDS.includes(f.key)?'This changes all customers under the same master.':undefined}
              style={{...styleInput,minWidth:['customerName','description'].includes(f.key)?175:f.key==='masterNo'?120:90}} value={r[f.key]??''} onChange={e=>edit(r.id,f.key,e.target.value)}/>:<span style={{display:'inline-block',padding:'5px 8px',minWidth:85}}>{r[f.key]||'—'}</span>}
          </td>)}
          <td style={{padding:'8px 10px'}}>{money(a?.perKg)}</td>
          {['duty','eici','ut','freight'].map(k=><td key={k} style={{padding:'8px 10px',textAlign:'right'}}>{money(a?.shares[k])}</td>)}
          <td style={{padding:'8px 10px',textAlign:'right'}}>{money(a?.sales)}</td>
          <td style={{padding:'8px 10px',textAlign:'right',fontWeight:850,color:a?.pl<0?'#b42318':'#087a4c'}}>{money(a?.pl)}</td>
          <td style={{padding:6}}>{mode==='EDIT'?<button type="button" style={{...buttonStyle,padding:'5px 8px',color:'#b42318'}} onClick={()=>setRows(old=>old.filter(x=>x.id!==r.id))}>Remove</button>:<span title={r._sheetName||''} style={{fontSize:11,color:'#52657b'}}>{r._fileName||'Saved import'}</span>}</td>
        </tr>})}</tbody>
      </table>
      {!displayed.length&&<p style={{padding:18,color:'#53657c'}}>{mode==='MONTHLY'?'No saved customer records for '+monthLabel(month)+'. Choose another month or use Upload / Edit Excel.':'No records for '+monthLabel(selectedEditorMonth)+'. Upload an Excel file or choose another month.'}</p>}
    </div>
    <p style={{fontSize:12,color:'#56687c',marginTop:12}}>Formula: Customer Cost = Master Total Cost ÷ EIA Weight × Customer Weight. Revenue = Customer Weight × Rate. Profit/Loss = Revenue − Customer Duty − Customer EICI − Customer UT − Customer Freight. Customer Bags are recorded for reference and can be used in later rules.</p>
  </main>;
}
