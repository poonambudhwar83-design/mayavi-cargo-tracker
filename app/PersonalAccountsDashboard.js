'use client';
import {useEffect,useMemo,useState} from 'react';
import {PERSONAL_ACCOUNT_FIELDS,PERSONAL_ACCOUNT_KEYS,guessAccountSheetHeader,accountRowsFromSheet} from '../lib/personalAccountsCore.js';

const ENDPOINT='/api/personal-accounts';
const inputStyle={boxSizing:'border-box',border:'1px solid #cbd5e1',borderRadius:7,padding:'7px 9px',background:'#fff',color:'#172b46',fontSize:13};
const buttonStyle={border:'1px solid #bfcee0',borderRadius:8,padding:'9px 12px',fontSize:12,fontWeight:800,background:'#fff',color:'#18416e',cursor:'pointer'};
const titleStyle={display:'block',fontSize:12,fontWeight:800,color:'#36516b',marginBottom:6};
const safeHtml=x=>String(x??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
async function asJson(response){
  const data=await response.json().catch(()=>({ok:false,error:'Mayavi returned an invalid response.'}));
  if(!response.ok||!data.ok)throw Error(data.error||'Request failed. Please try again.');
  return data;
}
export default function PersonalAccountsDashboard(){
  const [batches,setBatches]=useState([]),[batchId,setBatchId]=useState(''),[fileName,setFileName]=useState(''),[sheetName,setSheetName]=useState('');
  const [rows,setRows]=useState([]),[preview,setPreview]=useState(null),[sheetIndex,setSheetIndex]=useState(0),[headerIndex,setHeaderIndex]=useState(0),[mapping,setMapping]=useState({});
  const [busy,setBusy]=useState(false),[status,setStatus]=useState(''),[dirty,setDirty]=useState(false),[filter,setFilter]=useState('');
  const sheet=preview?.sheets?.[sheetIndex];
  const visible=useMemo(()=>{
    const term=filter.trim().toLowerCase();
    if(!term)return rows;
    return rows.filter(r=>PERSONAL_ACCOUNT_KEYS.some(k=>String(r[k]??'').toLowerCase().includes(term)));
  },[rows,filter]);
  const suggested=useMemo(()=>{
    if(!sheet)return [];
    try{return accountRowsFromSheet(sheet,headerIndex,mapping);}catch{return [];}
  },[sheet,headerIndex,mapping]);

  async function load(id=''){
    const data=await asJson(await fetch(ENDPOINT+(id?'?id='+encodeURIComponent(id):''),{cache:'no-store',credentials:'include'}));
    setBatches(data.batches||[]);
    setBatchId(data.batch?.id||'');
    setFileName(data.batch?.file_name||'');
    setSheetName(data.batch?.sheet_name||'');
    setRows(data.batch?.data_rows||[]);
    setDirty(false);
    return data.batch||null;
  }
  useEffect(()=>{void load().catch(err=>setStatus(err.message));},[]);
  function chooseSheet(book,index){
    const suggestion=guessAccountSheetHeader(book.sheets[index]);
    setSheetIndex(index);setHeaderIndex(suggestion.headerIndex);setMapping(suggestion.mapping);
  }
  async function upload(file){
    if(!file){setStatus('No file was selected. Please choose the actual bank statement from Files or Downloads.');return;}
    if(dirty){setStatus('Save your current changes before uploading another bank statement.');return;}
    if(file.size>4*1024*1024){setStatus('File is over 4 MB. Download a smaller statement range and upload again.');return;}
    setBusy(true);setStatus('Uploading '+file.name+' ('+Math.round(file.size/1024)+' KB)…');
    try{
      const form=new FormData();form.append('file',file);
      let response;
      try{response=await fetch(ENDPOINT,{method:'POST',credentials:'include',body:form});}
      catch(error){throw Error('Upload connection failed. Please check your internet connection and try again. '+String(error.message||error));}
      const data=await asJson(response);
      // Auto-save a new ledger only when the worksheet and bank columns can be
      // identified unambiguously. Other layouts keep the manual preview flow.
      const ranked=(data.sheets||[]).map((sheet,i)=>({sheet,index:i,match:guessAccountSheetHeader(sheet)}))
        .sort((a,b)=>b.match.score-a.match.score);
      const best=ranked[0];
      const m=best?.match?.mapping||{};
      const confident=Boolean(best&&m.date!==undefined&&m.details!==undefined&&
        (m.debit!==undefined||m.credit!==undefined)&&m.balance!==undefined&&
        best.match.score>=8&&(ranked.length===1||best.match.score>ranked[1].match.score));
      const prepared=confident?accountRowsFromSheet(best.sheet,best.match.headerIndex,m):[];
      const hasTransaction=prepared.some(r=>String(r.date||'').trim()&&
        (String(r.debit||'').trim()||String(r.credit||'').trim()));
      setPreview(data);
      if(best)chooseSheet(data,best.index);
      if(confident&&hasTransaction){
        const saved=await persist(prepared,'',data.fileName,best.sheet.sheet);
        setPreview(null);setFilter('');
        const remarks=prepared.filter(row=>String(row.remarks||'').trim()).length;
        setStatus('Excel imported automatically and saved in Mayavi: '+saved.rowCount+
          ' entries verified, including '+remarks+' existing Remarks. No extra Import & Save click needed.');
      }else{
        setStatus('Excel opened, but column mapping needs review. Check the preview and press Import & Save. No data has been saved yet.');
      }
    }catch(err){setStatus('File: '+file.name+' — '+err.message);}finally{setBusy(false);}
  }
  async function persist(nextRows,id,name,sourceSheet){
    const body={id:id||undefined,fileName:name,sheetName:sourceSheet,rows:nextRows};
    const saved=await asJson(await fetch(ENDPOINT,{method:'PUT',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify(body)}));
    const persisted=await load(saved.id);
    if(!persisted||persisted.id!==saved.id||persisted.data_rows?.length!==nextRows.length){
      throw Error('Database verification failed. Please reload saved records before continuing.');
    }
    return saved;
  }
  async function importSave(){
    if(!preview||!suggested.length){setStatus('No account entries prepared. Check the Excel header row and column matching.');return;}
    if(!['date','details','debit','credit','balance'].some(k=>mapping[k]!==undefined&&mapping[k]!=='')){
      setStatus('Please match the Excel columns before importing.');return;
    }
    if(dirty){setStatus('Save the current ledger first to avoid losing unsaved remarks or edits.');return;}
    setBusy(true);setStatus('');
    try{
      const data=await persist(suggested,'',preview.fileName,sheet.sheet);
      setPreview(null);setFilter('');
      setStatus('Saved & verified: '+data.rowCount+' entries imported into Personal Accounts. Remarks and changes can now be edited and saved.');
    }catch(err){setStatus('Import not confirmed: '+err.message);}finally{setBusy(false);}
  }
  async function saveChanges(){
    if(!batchId||!rows.length){setStatus('Open or import a saved account ledger first.');return;}
    setBusy(true);setStatus('');
    try{
      const data=await persist(rows,batchId,fileName,sheetName);
      setStatus('Saved & verified in Mayavi database: '+data.rowCount+' entries, including all Remarks.');
    }catch(err){setStatus('Save not confirmed: '+err.message);}finally{setBusy(false);}
  }
  function edit(id,key,value){
    setDirty(true);
    setRows(current=>current.map(r=>r.id===id?{...r,[key]:value}:r));
  }
  function addRow(){
    setDirty(true);
    setRows(current=>[...current,{id:'manual-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2),...Object.fromEntries(PERSONAL_ACCOUNT_KEYS.map(k=>[k,'']))}]);
  }
  function excelExport(){
    if(!batchId||dirty){setStatus('Save changes before downloading the Excel report.');return;}
    const a=document.createElement('a');a.href=ENDPOINT+'?id='+encodeURIComponent(batchId)+'&format=xlsx';
    a.download='personal-accounts.xlsx';document.body.appendChild(a);a.click();a.remove();
  }
  function printPdf(){
    if(!rows.length){setStatus('No saved records available to print.');return;}
    if(dirty){setStatus('Save changes before preparing your PDF.');return;}
    const popup=window.open('','_blank');
    if(!popup){setStatus('Please allow pop-ups for Mayavi to print/save this ledger as a PDF.');return;}
    const name=safeHtml(fileName||'Personal Accounts'),sub=safeHtml(sheetName);
    const body=rows.map(r=>'<tr>'+PERSONAL_ACCOUNT_KEYS.map(k=>'<td>'+safeHtml(r[k])+'</td>').join('')+'</tr>').join('');
    const html='<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Personal Accounts</title><style>'+
      '@page{size:A4 landscape;margin:10mm}body{font-family:Arial,"Noto Sans Devanagari",sans-serif;color:#182c42;font-size:10px}h1{font-size:20px;margin:0 0 5px}p{margin:0 0 14px;color:#51647b}table{border-collapse:collapse;width:100%;table-layout:fixed}thead{display:table-header-group}th,td{border:1px solid #cad6e3;padding:6px 5px;vertical-align:top;overflow-wrap:anywhere}th{background:#dfebf8;text-align:left;font-size:10px}tr{break-inside:avoid}tbody tr:nth-child(even){background:#f6f9fd}th:nth-child(1){width:10%}th:nth-child(2){width:28%}th:nth-child(3){width:11%}th:nth-child(4),th:nth-child(5),th:nth-child(6){width:10%}th:nth-child(7){width:21%}@media screen{body{padding:15px;max-width:1350px;margin:auto}}</style></head><body>'+
      '<h1>Personal Accounts</h1><p>'+name+(sub?' · '+sub:'')+' · '+rows.length+' entries</p>'+
      '<table><thead><tr>'+PERSONAL_ACCOUNT_FIELDS.map(f=>'<th>'+safeHtml(f.label)+'</th>').join('')+'</tr></thead><tbody>'+body+'</tbody></table></body></html>';
    popup.document.open();popup.document.write(html);popup.document.close();popup.focus();
    popup.setTimeout(()=>popup.print(),250);
    setStatus('PDF print view opened. Select "Save as PDF" in the print dialog.');
  }
  const th={borderBottom:'2px solid #b9d0e7',padding:'10px 9px',whiteSpace:'nowrap',textAlign:'left',background:'#dcebf9',color:'#173c64',position:'sticky',top:0,zIndex:1};
  const td={padding:'5px 5px',borderBottom:'1px solid #e4ebf3'};
  return <main style={{maxWidth:'100%',padding:'17px clamp(10px,2vw,28px)',boxSizing:'border-box',color:'#193048'}}>
    <h1 style={{fontSize:24,margin:'0 0 5px'}}>Personal Accounts</h1>
    <p style={{fontSize:13,color:'#566a80',margin:'0 0 15px'}}>Private admin ledger. Choose a bank statement from your device. Excel, CSV and ZIP are supported; matching transactions are saved automatically with existing Remarks. Export to Excel or PDF.</p>
    <section style={{display:'flex',gap:12,alignItems:'end',flexWrap:'wrap',padding:14,border:'1px solid #d3e1ef',background:'#f4f8ff',borderRadius:10}}>
      <label><span style={titleStyle}>Choose Bank File (.xlsx / .xls / .csv / .zip)</span><input aria-label="Choose personal accounts bank statement file" type="file" disabled={busy} onChange={e=>{const picked=e.currentTarget.files?.[0];e.currentTarget.value='';void upload(picked);}} style={{fontSize:12,maxWidth:265}}/></label>
      <label><span style={titleStyle}>Saved Accounts</span><select aria-label="Saved personal account ledger" value={batchId} disabled={busy} onChange={e=>{if(dirty&&!window.confirm('Discard unsaved changes?'))return;setBusy(true);setStatus('');setPreview(null);void load(e.target.value).catch(err=>setStatus(err.message)).finally(()=>setBusy(false));}} style={{...inputStyle,maxWidth:260,minWidth:180}}>
        {!batches.length&&<option value="">No saved ledgers yet</option>}
        {batches.map(b=><option key={b.id} value={b.id}>{b.file_name} ({b.row_count} entries)</option>)}
      </select></label>
      <button type="button" style={{...buttonStyle,background:'#175cd3',color:'#fff'}} disabled={busy||!batchId||!rows.length} onClick={()=>void saveChanges()}>{busy?'Working…':'Save Changes'}</button>
      <button type="button" style={buttonStyle} disabled={busy||!batchId||dirty} onClick={excelExport}>Download Excel</button>
      <button type="button" style={buttonStyle} disabled={busy||!batchId||dirty} onClick={printPdf}>PDF / Print</button>
      <button type="button" style={buttonStyle} disabled={busy||!batchId} onClick={addRow}>+ Add Entry</button>
      <span style={{fontSize:12,color:dirty?'#a15b07':'#177c4b',fontWeight:750}}>{dirty?'Unsaved edits — press Save Changes':batchId?'Saved in Mayavi':'Choose a bank statement to begin'}</span>
    </section>
    {status&&<p role="status" aria-live="polite" style={{fontSize:13,padding:'9px 12px',border:'1px solid #e8d8af',borderRadius:8,background:'#fffaf0',margin:'12px 0'}}>{status}</p>
    {preview&&sheet&&<section style={{marginTop:13,padding:14,border:'1px solid #bdd7ee',borderRadius:10,background:'#fff'}}>
      <h2 style={{fontSize:17,margin:'0 0 12px'}}>Review Bank File Columns · {preview.fileName}</h2>
      <div style={{display:'flex',gap:14,flexWrap:'wrap',marginBottom:13}}>
        <label><span style={titleStyle}>Worksheet</span><select value={sheetIndex} onChange={e=>chooseSheet(preview,Number(e.target.value))} style={inputStyle}>{preview.sheets.map((w,i)=><option key={i} value={i}>{w.sheet}</option>)}</select></label>
        <label><span style={titleStyle}>Header Row</span><select value={headerIndex} onChange={e=>{setHeaderIndex(Number(e.target.value));setMapping(guessAccountSheetHeader({rows:[sheet.rows[Number(e.target.value)]],sheet:sheet.sheet}).mapping)}} style={{...inputStyle,maxWidth:300}}>{sheet.rows.slice(0,40).map((r,i)=><option value={i} key={i}>Row {i+1} · {r.filter(Boolean).slice(0,4).join(' | ').slice(0,90)}</option>)}</select></label>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:10}}>
        {PERSONAL_ACCOUNT_FIELDS.map(f=><label key={f.key}><span style={titleStyle}>{f.label}</span><select value={mapping[f.key]??''} onChange={e=>setMapping(m=>({...m,[f.key]:e.target.value}))} style={{...inputStyle,width:'100%'}}>
          <option value="">— Empty / Not in Excel —</option>
          {(sheet.rows[headerIndex]||[]).map((name,i)=><option key={i} value={String(i)}>{i+1} · {name||'(blank)'}</option>)}
        </select></label>)}
      </div>
      {suggested.length>0&&<div style={{overflowX:'auto',marginTop:12,border:'1px solid #e2eaf4',borderRadius:7}}>
        <table style={{width:'100%',minWidth:760,borderCollapse:'collapse',fontSize:11}}>
          <thead><tr>{PERSONAL_ACCOUNT_FIELDS.map(f=><th key={f.key} style={{padding:'7px',background:'#eef5fc',borderBottom:'1px solid #d6e3ee',textAlign:'left'}}>{f.label}</th>)}</tr></thead>
          <tbody>{suggested.slice(0,5).map(r=><tr key={r.id}>{PERSONAL_ACCOUNT_FIELDS.map(f=><td key={f.key} style={{padding:'7px',borderBottom:'1px solid #edf2f8',maxWidth:220,overflowWrap:'anywhere'}}>{r[f.key]||'—'}</td>)}</tr>)}</tbody>
        </table>
      </div>}
      <div style={{display:'flex',gap:12,alignItems:'center',marginTop:13,flexWrap:'wrap'}}>
        <strong style={{fontSize:13}}>{suggested.length} entries ready · {suggested.filter(r=>String(r.remarks||'').trim()).length} with existing Remarks</strong>
        <button type="button" disabled={busy||!suggested.length} style={{...buttonStyle,color:'#fff',background:'#0d8278'}} onClick={()=>void importSave()}>Import & Save to Mayavi</button>
        <button type="button" style={buttonStyle} onClick={()=>setPreview(null)}>Cancel</button>
      </div>
      <p style={{fontSize:12,color:'#64758a',margin:'10px 0 0'}}>This saves a new ledger without deleting any existing saved accounts. Existing Excel Remarks and cell notes are included. If Remarks are blank, match your source Remarks column above before importing.</p>
    </section>}
    <div style={{display:'flex',flexWrap:'wrap',justifyContent:'space-between',alignItems:'center',gap:10,margin:'15px 0 8px'}}>
      <h2 style={{fontSize:17,margin:0}}>{fileName||'Saved Personal Accounts'} <span style={{fontSize:12,fontWeight:500,color:'#53657e'}}>({rows.length} entries)</span></h2>
      <input aria-label="Search personal accounts" placeholder="Search date, details, cheque, remarks…" value={filter} onChange={e=>setFilter(e.target.value)} style={{...inputStyle,width:280,maxWidth:'100%'}}/>
    </div>
    <div style={{overflowX:'auto',maxWidth:'100%',background:'#fff',border:'1px solid #d5e0ee',borderRadius:10,maxHeight:'72vh'}}>
      <table style={{borderCollapse:'separate',borderSpacing:0,fontSize:12,minWidth:1060,width:'100%'}}>
        <thead><tr>{PERSONAL_ACCOUNT_FIELDS.map(f=><th key={f.key} style={{...th,minWidth:f.key==='details'?240:f.key==='remarks'?260:f.key==='chequeNo'?120:95}}>{f.label}</th>)}</tr></thead>
        <tbody>{visible.map((r,i)=><tr key={r.id} style={{background:i%2?'#f8fbff':'white'}}>
          {PERSONAL_ACCOUNT_FIELDS.map(f=><td key={f.key} style={td}>
            {f.key==='remarks'?<textarea aria-label={'Remarks for '+(r.date||r.details||r.id)} rows={2} value={r.remarks||''} onChange={e=>edit(r.id,'remarks',e.target.value)} style={{...inputStyle,resize:'vertical',width:'100%',minWidth:250,fontFamily:'inherit'}} placeholder="Write remarks…"/>:
              <input aria-label={f.label+' for row '+(i+1)} value={r[f.key]??''} onChange={e=>edit(r.id,f.key,e.target.value)} style={{...inputStyle,width:'100%',minWidth:f.key==='details'?215:f.key==='chequeNo'?110:95}}/>}
          </td>)}
        </tr>)}</tbody>
      </table>
      {!visible.length&&<p style={{padding:18,fontSize:13,color:'#556b81'}}>{rows.length?'No matching records.':'Upload an Excel file and import it to see your personal account entries here.'}</p>}
    </div>
    <p style={{marginTop:10,fontSize:12,color:'#5b7086'}}>Balance stays as in your source bank file; it is not recalculated. Remarks remain editable and are included in both exports. Password-protected files must be unlocked locally before upload; never share your password. PDF / Print opens the browser's Save as PDF dialog.</p>
  </main>;
}
