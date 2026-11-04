'use client';
import {useEffect,useMemo,useState} from 'react';

const API='/api/country-analysis';
const panel={background:'#fff',border:'1px solid #dbe4ef',borderRadius:15,padding:18,
  boxShadow:'0 4px 15px rgba(14,35,70,.05)'};
const action={border:'1px solid #cbd5e1',borderRadius:9,padding:'10px 13px',fontWeight:800,
  fontSize:12,cursor:'pointer',background:'#f8fafc',color:'#174178'};
const input={border:'1px solid #cbd5e1',borderRadius:9,padding:'9px 11px',background:'#fff',
  color:'#1e293b',minHeight:41,boxSizing:'border-box',maxWidth:'100%'};
const th={borderBottom:'1px solid #d5dfed',background:'#eaf1fd',padding:'10px 9px',fontSize:11,
  textAlign:'right',whiteSpace:'nowrap',color:'#213b62',position:'sticky',top:0,zIndex:2};
const td={borderBottom:'1px solid #e5eaf1',padding:'9px',fontSize:12,textAlign:'right',
  whiteSpace:'nowrap',fontVariantNumeric:'tabular-nums'};
const nf=new Intl.NumberFormat('en-IN',{maximumFractionDigits:2});
const numeric=n=>nf.format(Number(n||0));
const currentMonth=()=>{
  const now=new Date();
  return now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');
};
const monthLabel=ym=>{
  if(ym==='LATEST')return 'Select Month';
  const [y,m]=ym.split('-').map(Number);
  return new Date(y,m-1,1).toLocaleDateString('en-IN',{month:'long',year:'numeric'});
};
const stat=(label,value,unit='')=><div style={{background:'#f5f8ff',padding:'11px 14px',borderRadius:11,border:'1px solid #e0e9f6'}}>
  <div style={{fontSize:11,fontWeight:700,color:'#60718a',marginBottom:5}}>{label}</div>
  <div style={{fontSize:20,fontWeight:850,color:'#193c72',fontVariantNumeric:'tabular-nums'}}>{numeric(value)}{unit&&<span style={{fontSize:11,marginLeft:4}}>{unit}</span>}</div>
</div>;
export default function CountryLoadAnalysisDashboard(){
  const [flow,setFlow]=useState('IMPORT');
  const [month,setMonth]=useState('LATEST');
  const [country,setCountry]=useState('ALL');
  const [search,setSearch]=useState('');
  const [refresh,setRefresh]=useState(0);
  const [result,setResult]=useState({rows:[],files:[],months:[],countries:[],totals:{}});
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(true);
  const [downloadBusy,setDownloadBusy]=useState('');
  const [file,setFile]=useState(null);
  const [uploadMonth,setUploadMonth]=useState(currentMonth);
  const [notice,setNotice]=useState('');
  const [advanced,setAdvanced]=useState(false);
  const [mapping,setMapping]=useState({courier:'',weight:'',bags:'',country:'',date:''});
  useEffect(()=>{
    let active=true;
    setLoading(true);
    const url=API+'?flow='+flow+'&month='+encodeURIComponent(month)+'&country='+encodeURIComponent(country);
    fetch(url,{credentials:'include',cache:'no-store'})
      .then(async res=>{const json=await res.json();if(!res.ok||!json.ok)throw Error(json.error||'Could not load analysis.');return json;})
      .then(data=>{if(active){setResult(data);if(month==='LATEST'&&data.month&&data.month!=='LATEST')setMonth(data.month);}})
      .catch(e=>{if(active){setNotice(e.message||'Cannot open analysis.');setResult({rows:[],files:[],months:[],countries:[],totals:{}});}})
      .finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[flow,month,country,refresh]);
  const entries=useMemo(()=>{
    const q=search.trim().toLowerCase();
    return (result.rows||[]).filter(row=>!q||row.courierName.toLowerCase().includes(q))
      .slice().sort((a,b)=>Number(b.totalWeight||0)-Number(a.totalWeight||0)||a.courierName.localeCompare(b.courierName));
  },[search,result.rows]);
  const sectors=result.sectors||[];
  const selectedFile=(result.files||[]).find(f=>f.flow===flow&&(f.coveredMonths||[]).includes(month));
  const existingFile=(result.files||[]).find(f=>f.flow===flow&&f.month===uploadMonth);
  function switchFlow(next){setFlow(next);setMonth('LATEST');setCountry('ALL');setSearch('');setNotice('');}
  async function upload(event){
    event.preventDefault();
    if(!file){setNotice('First select an Excel file.');return;}
    if(!uploadMonth){setNotice('Choose month for the Excel file.');return;}
    if(existingFile&&!window.confirm('A '+flow+' Excel is already saved for '+monthLabel(uploadMonth)+'. Use the new workbook as the active version? The earlier uploaded file will not count twice.'))return;
    setBusy(true);setNotice('');
    try{
      const form=new FormData();
      form.append('flow',flow);form.append('month',uploadMonth);form.append('file',file);
      form.append('mapping',JSON.stringify(mapping));
      const res=await fetch(API,{method:'POST',credentials:'include',body:form});
      const data=await res.json();
      if(!res.ok||!data.ok)throw Error(data.error||'Could not save Excel.');
      setNotice('Excel saved successfully. Courier-wise weight summary updated.');
      setFile(null);
      const fileInput=document.getElementById('country-analysis-excel');
      if(fileInput)fileInput.value='';
      setCountry('ALL');setMonth(uploadMonth);setRefresh(n=>n+1);
    }catch(e){setNotice(e?.message||'Excel upload failed.');}
    finally{setBusy(false);}
  }
  async function download(kind){
    setDownloadBusy(kind);setNotice('');
    try{
      const url=API+'?flow='+flow+'&month='+encodeURIComponent(month)+'&country='+encodeURIComponent(country)+'&download='+kind;
      const res=await fetch(url,{credentials:'include',cache:'no-store'});
      if(!res.ok){const err=await res.json().catch(()=>({}));throw Error(err.error||'Download failed.');}
      const blob=await res.blob();
      const disposition=res.headers.get('content-disposition')||'';
      const name=disposition.match(/filename="([^"]+)"/i)?.[1]||('Mayavi_'+flow+'_'+kind+(kind==='pdf'?'.pdf':'.xlsx'));
      const href=URL.createObjectURL(blob);
      const a=document.createElement('a');a.href=href;a.download=name;document.body.appendChild(a);
      a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(href),1500);
    }catch(e){setNotice(e?.message||'Excel download failed.');}
    finally{setDownloadBusy('');}
  }
  return <main style={{background:'#f3f6fc',minHeight:'calc(100vh - 70px)',padding:'20px clamp(12px,2.3vw,32px)',color:'#192f50'}}>
    <header style={{marginBottom:16,display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:14,flexWrap:'wrap'}}>
      <div>
        <div style={{fontSize:11,textTransform:'uppercase',letterSpacing:2,fontWeight:900,color:'#52719d'}}>MAYAVI 360 • ADMIN ANALYTICS</div>
        <h1 style={{fontSize:'clamp(22px,3vw,29px)',margin:'5px 0',color:'#17355d'}}>Other Courier — Load Analysis</h1>
        <p style={{margin:'5px 0 0',fontSize:13,color:'#61728c'}}>Import and Export • Courier-by-origin/sector load (kg) • Month-wise analysis</p>
      </div>
      <span style={{border:'1px solid #d1e2ff',background:'#eaf2ff',color:'#2452a3',padding:'8px 11px',
        borderRadius:30,fontSize:11,fontWeight:800}}>Saved in Mayavi Backend</span>
    </header>
    <div style={{display:'flex',gap:9,flexWrap:'wrap',marginBottom:17}}>
      {['IMPORT','EXPORT'].map(value=><button key={value} type="button" onClick={()=>switchFlow(value)}
        style={{...action,background:flow===value?'#234d98':'#fff',color:flow===value?'#fff':'#234d98',minWidth:140}}>
        {value==='IMPORT'?'IMPORT ANALYSIS':'EXPORT ANALYSIS'}
      </button>)}
    </div>
    <div style={{...panel,marginBottom:16,padding:'13px 16px',background:'#f1f6ff',borderColor:'#bfd2f3'}}>
      <div style={{display:'flex',alignItems:'center',gap:16,flexWrap:'wrap',justifyContent:'space-between'}}>
        <label style={{display:'grid',gap:6,fontSize:13,fontWeight:900,color:'#183e77',flex:'1 1 215px',maxWidth:360}}>
          SELECT MONTH — {flow} REPORT
          <select style={{...input,width:'100%',maxWidth:'100%',fontSize:15,fontWeight:850,border:'2px solid #9dbbe8'}}
            value={month} onChange={e=>{setMonth(e.target.value);setCountry('ALL');setSearch('');}}>
            {month==='LATEST'&&<option value="LATEST">{loading?'Loading saved months…':'No saved month yet'}</option>}
            {(result.months||[]).map(m=><option value={m} key={m}>{monthLabel(m)}</option>)}
          </select>
        </label>
        <div style={{fontSize:12,color:'#476688',flex:'2 1 250px'}}>
          <strong>{month==='LATEST'?'Select a saved month':monthLabel(month)+' '+flow+' report'}</strong>
          <div style={{marginTop:3}}>Reports use each Excel row's actual FLT DATE, not the workbook upload month. Select the month to see only its loads, separately for Import and Export.</div>
        </div>
      </div>
    </div>
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(285px,1fr))',gap:14,marginBottom:16}}>
      <section style={panel}>
        <h2 style={{fontSize:16,margin:'0 0 6px'}}>Upload {flow} Excel</h2>
        <p style={{fontSize:12,margin:'0 0 13px',color:'#63748b'}}>
          Upload .xlsx Excel data once. Every shipment is grouped by its actual FLT DATE in the file, even when the upload contains dates from different months.
        </p>
        <form onSubmit={upload}>
          <div style={{display:'flex',gap:10,flexWrap:'wrap',alignItems:'end'}}>
            <label style={{display:'grid',gap:5,fontSize:11,fontWeight:800}}>REPORT MONTH
              <input style={input} type="month" value={uploadMonth} onChange={e=>setUploadMonth(e.target.value)} required/>
            </label>
            <label style={{display:'grid',gap:5,flex:'1 1 180px',fontSize:11,fontWeight:800}}>EXCEL FILE
              <input id="country-analysis-excel" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={e=>setFile(e.target.files?.[0]||null)} style={{...input,width:'100%',fontSize:12,padding:7}} required/>
            </label>
          </div>
          <div style={{fontSize:11,marginTop:9,color:'#687b95'}}>
            Auto-detects CourierCoName, Bags, Weight, Origin and FLT DATE. For missing/invalid flight dates only, the selected upload month is used. Maximum 3 MB / 40,000 entries.
          </div>
          <button type="button" onClick={()=>setAdvanced(v=>!v)}
            style={{border:0,padding:'9px 0',background:'none',color:'#2258ac',fontSize:11,fontWeight:800,cursor:'pointer'}}>
            {advanced?'− Hide column mapping':'+ My Excel has different column headings'}
          </button>
          {advanced&&<div style={{display:'grid',gridTemplateColumns:'repeat(2,minmax(0,1fr))',gap:8,
            padding:10,background:'#f5f8fd',borderRadius:10,marginBottom:10}}>
            {Object.entries({courier:'Courier header',weight:'Weight header',bags:'Bags header',country:'Origin / Sector header',date:'Flight/Load Date header'}).map(([key,title])=>
              <label key={key} style={{display:'grid',gap:4,fontSize:11,fontWeight:750}}>
                {title}<input value={mapping[key]} onChange={e=>setMapping(v=>({...v,[key]:e.target.value}))}
                  placeholder="Exact Excel heading" style={{...input,minWidth:0,width:'100%'}}/>
              </label>)}
            <div style={{gridColumn:'1 / -1',fontSize:11,color:'#728097'}}>Enter exact column headings from the Excel header row, not column letters.</div>
          </div>}
          <button type="submit" disabled={busy||!file} style={{...action,marginTop:9,width:'100%',background:'#2160b1',color:'#fff',opacity:busy?0.7:1}}>
            {busy?'SAVING EXCEL IN BACKEND…':'UPLOAD & SAVE '+flow+' EXCEL'}
          </button>
        </form>
      </section>
      <section style={panel}>
        <h2 style={{fontSize:16,margin:'0 0 12px'}}>View & Download {flow} Data</h2>
        <div style={{display:'flex',gap:9,flexWrap:'wrap',marginBottom:12}}>
          <label style={{display:'grid',gap:4,fontSize:11,fontWeight:800,flex:'1 1 130px'}}>ORIGIN / SECTOR
            <select style={{...input,width:'100%'}} value={country} onChange={e=>setCountry(e.target.value)}>
              <option value="ALL">All Origins</option>
              {(result.countries||[]).map(c=><option value={c} key={c}>{c}</option>)}
            </select>
          </label>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))',gap:8}}>
          <button type="button" disabled={!!downloadBusy||loading||!result.rows?.length} onClick={()=>download('summary')} style={action}>
            {downloadBusy==='summary'?'PREPARING…':'↓ COURIER SUMMARY — EXCEL'}
          </button>
          <button type="button" disabled={!!downloadBusy||loading||!result.rows?.length} onClick={()=>download('pdf')}
            style={{...action,background:'#eaf0ff',color:'#214b95',borderColor:'#a9c0ed'}}>
            {downloadBusy==='pdf'?'PREPARING PDF…':'↓ COURIER SUMMARY — PDF'}
          </button>
          <button type="button" disabled={!!downloadBusy||!result.rows?.length} onClick={()=>download('details')} style={action}>
            {downloadBusy==='details'?'PREPARING…':'↓ COMPLETE DATA'}
          </button>
          <button type="button" disabled={!!downloadBusy||!selectedFile} onClick={()=>download('original')} style={action}>
            {downloadBusy==='original'?'PREPARING…':'↓ ORIGINAL EXCEL'}
          </button>
        </div>
        <p style={{fontSize:11,color:'#71819a',margin:'12px 0 0'}}>
          Excel and PDF courier summaries contain the same selected month's totals, 35–40 kg load, above-40 kg load, and origin-wise breakdown. Original source Excel remains available (it can contain entries from other months).
        </p>
      </section>
    </div>
    {!!notice&&<div role="status" style={{padding:'11px 14px',marginBottom:15,borderRadius:10,background:'#edf4ff',
      border:'1px solid #d3e2ff',fontSize:12,color:'#1c4d85'}}>{notice}</div>}
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(145px,1fr))',gap:9,marginBottom:16}}>
      {stat('Couriers',result.totals?.couriers||0)}
      {stat('Total Load',result.totals?.totalWeight||0,'kg')}
      {stat('Average',result.totals?.avgBagKg||0,'kg/bag')}
      {stat('35–40 kg/bag',result.totals?.from35To40||0,'kg')}
      {stat('More than 40 kg/bag',result.totals?.over40||0,'kg')}
    </div>
    <section style={{...panel,padding:'15px 11px',marginBottom:16}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,flexWrap:'wrap',margin:'0 6px 13px'}}>
        <div><h2 style={{fontSize:16,margin:0}}>{flow} — Courier & Origin-Wise Load Summary</h2>
          <div style={{color:'#6c7e95',fontSize:11,marginTop:4}}>{flow} • {monthLabel(month)} only • Sorted highest to lowest total load (kg)</div>
        </div>
        <input style={{...input,width:230}} value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search courier…"/>
      </div>
      <div style={{overflowX:'auto',maxHeight:'min(65vh,620px)',borderRadius:8,border:'1px solid #e1e8f1'}}>
        <table style={{borderCollapse:'separate',borderSpacing:0,minWidth:Math.max(720,620+sectors.length*120),width:'100%'}}>
          <thead><tr>
            {['Courier Name','Total Load (kg)','35–40 kg (load)','More than 40 kg (load)',...sectors.map(sector=>sector.name+' (kg)'),'Average kg / bag'].map((label,i)=>
              <th key={label} style={{...th,textAlign:i?'right':'left',left:i===0?0:undefined,zIndex:i===0?3:2}}>{label}</th>)}
          </tr></thead>
          <tbody>
            {loading&&<tr><td colSpan={5+sectors.length} style={{padding:30,textAlign:'center',color:'#7186a2'}}>Loading saved analysis…</td></tr>}
            {!loading&&!entries.length&&<tr><td colSpan={5+sectors.length} style={{padding:30,textAlign:'center',color:'#7186a2'}}>
              No Excel records for this filter. Upload an Import or Export workbook to begin.
            </td></tr>}
            {!loading&&entries.map((r,i)=><tr key={r.courierName} style={{background:i%2?'#f8faff':'#fff'}}>
              <td style={{...td,textAlign:'left',fontWeight:800,position:'sticky',left:0,background:i%2?'#f8faff':'#fff',color:'#233f69'}}>{r.courierName}</td>
              {[r.totalWeight,r.from35To40,r.over40,...sectors.map(sector=>r.sectorLoads?.[sector.name]||0),r.avgBagKg].map((v,j)=>
                <td key={j} style={{...td,fontWeight:j===0?900:500,color:j===0?'#174c89':undefined}}>{numeric(v)}</td>)}
            </tr>)}
          </tbody>
          {!loading&&entries.length>0&&!search.trim()&&<tfoot><tr style={{background:'#e8f0fc'}}>
            <td style={{...td,textAlign:'left',fontWeight:900,position:'sticky',left:0,background:'#e8f0fc'}}>GRAND TOTAL</td>
            {[result.totals?.totalWeight||0,result.totals?.from35To40||0,result.totals?.over40||0,
              ...sectors.map(sector=>sector.totalWeight||0),result.totals?.avgBagKg||0].map((v,i)=>
              <td key={i} style={{...td,fontWeight:900}}>{numeric(v)}</td>)}
          </tr></tfoot>}
        </table>
      </div>
      <p style={{fontSize:11,color:'#697e98',margin:'10px 7px 0'}}>Each sector column shows total kg loaded by that courier from that origin, such as HKG, JFK or DOH. 
        35–40 kg includes shipments averaging more than 35 through 40 kg/bag; More than 40 kg means strictly above 40 kg/bag. Courier average = total load ÷ total bags.
      </p>
    </section>
    <section style={panel}>
      <h2 style={{fontSize:15,margin:'0 0 11px'}}>Stored Monthly Workbooks</h2>
      <div style={{overflowX:'auto'}}>
        <table style={{borderCollapse:'collapse',width:'100%',minWidth:630}}>
          <thead><tr>{['Month','Type','Active File','Saved On'].map(h=>
            <th key={h} style={{...th,textAlign:'left',position:'static'}}>{h}</th>)}</tr></thead>
          <tbody>{(result.files||[]).filter(f=>f.flow===flow).sort((a,b)=>b.month.localeCompare(a.month)).map(f=>
            <tr key={f.id}>{[monthLabel(f.month),f.flow,f.fileName,
              new Date(f.uploadedAt).toLocaleDateString('en-IN')].map((v,i)=>
              <td key={i} style={{...td,textAlign:'left',whiteSpace:i===2?'normal':'nowrap'}}>{v}</td>)}</tr>)}
          </tbody>
        </table>
        {!(result.files||[]).some(f=>f.flow===flow)&&<p style={{fontSize:12,color:'#75839c'}}>No {flow} files saved yet.</p>}
      </div>
    </section>
  </main>;
}
