'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

const API='/api/speedpost';
const card={border:'1px solid #dce5f1',borderRadius:14,padding:17,background:'#fff',boxShadow:'0 2px 8px rgba(15,23,42,.04)'};
const btn={border:0,borderRadius:8,padding:'10px 14px',background:'#2258ce',color:'#fff',fontWeight:800,cursor:'pointer'};
const input={width:'100%',boxSizing:'border-box',height:42,border:'1px solid #c8d4e3',borderRadius:8,padding:'7px 11px',fontSize:14};
const th={textAlign:'left',padding:'13px 11px',whiteSpace:'nowrap',color:'#334155',fontSize:12,borderBottom:'1px solid #dce4ef',background:'#f5f8fe'};
const td={padding:'12px 10px',fontSize:12,borderBottom:'1px solid #edf1f6',whiteSpace:'nowrap',verticalAlign:'top'};

function normalizeED(value=''){
  const s=String(value||'').toUpperCase().replace(/\s+|-/g,'');
  return /^ED\d{9}IN$/.test(s)?s:'';
}
function readED(text=''){
  const s=String(text||'').toUpperCase();
  const normalized=s.replace(/[^A-Z0-9]/g,'');
  const candidates=[...normalized.matchAll(/ED[0-9OQILSBZ]{9}I[NM]/g)];
  for(const hit of candidates){
    const mid=hit[0].slice(2,11).replace(/[OQ]/g,'0').replace(/[IL]/g,'1').replace(/S/g,'5').replace(/B/g,'8').replace(/Z/g,'2');
    const candidate='ED'+mid+'IN';
    if(normalizeED(candidate))return candidate;
  }
  return'';
}
function shortOrigin(value=''){
  const origin=String(value||'').trim();
  if(!origin)return '';
  if(/^NEW DELHI(?:\b|,| -)/i.test(origin)||/^DELHI FOREIGN POST(?:\b|,| -)/i.test(origin))return 'New Delhi';
  return origin;
}
function destinationWithCountry(row={}){
  const place=String(row.destination||'').trim();
  if(!place)return '';
  const country=String(row.destinationCountry||row.country||'').toUpperCase().trim();
  const map={'UNITED KINGDOM':'UK','ENGLAND':'UK','SCOTLAND':'UK','WALES':'UK','GREAT BRITAIN':'UK','UK':'UK','GB':'UK','UNITED STATES':'USA','UNITED STATES OF AMERICA':'USA','US':'USA','USA':'USA','CANADA':'CANADA','CA':'CANADA'};
  const area=place.toUpperCase();
  const short=map[country]||(['LEICESTERSHIRE','LEICESTER'].includes(area)?'UK':'');
  if(!short||place.toUpperCase().endsWith('('+short+')'))return place;
  return place+' ('+short+')';
}
function weightInKg(raw){
  const text=String(raw??'').trim().replace(/,/g,'');
  const m=text.match(/^(\d+(?:\.\d+)?)\s*(kg|kgs|kgm|kilograms?|g|gm|gms|grams?)$/i);
  if(!m)return null;
  const amount=Number(m[1]);
  if(!Number.isFinite(amount)||amount<=0)return null;
  const unit=m[2].toLowerCase();
  return unit.startsWith('k')?amount:amount/1000;
}
// Cash cost uses billed whole kilograms: any fraction rounds UP.
const CASH_RATE_PER_KG=150;
function billedWeightKg(weight){
  const kg=weightInKg(weight);
  if(kg===null)return null;
  return Math.max(1,Math.ceil(kg-1e-9));
}
function cashCost(row){
  const billedKg=billedWeightKg(row?.weight);
  return billedKg===null?null:billedKg*CASH_RATE_PER_KG;
}
function costPerKg(row){
  const kg=weightInKg(row?.weight);
  const total=Number(String(row?.tariff??'').replace(/[,₹\s]/g,''));
  if(!kg||!Number.isFinite(total)||total<0)return null;
  return total/kg;
}
const rupeePerKg=new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',minimumFractionDigits:2,maximumFractionDigits:2});
function formatValue(value){return value?String(value):'—'}
function field(row,key){
  const val=row?.[key];
  if(!val)return <span style={{color:'#94a3b8'}}>—</span>;
  const retained=Array.isArray(row.retainedFields)&&row.retainedFields.includes(key);
  return <span title={retained?'From last saved verified tracking response':undefined}>{val}{retained&&<small style={{display:'block',color:'#a16207'}}>previous check</small>}</span>;
}

export default function SpeedPostDashboard({currentUser}){
  const [rows,setRows]=useState([]);
  const [speedPostTab,setSpeedPostTab]=useState('TRACKING');
  const [trackingNo,setTrackingNo]=useState('');
  const [busy,setBusy]=useState('');
  const [ocrBusy,setOcrBusy]=useState(false);
  const [ocrProgress,setOcrProgress]=useState('');
  const [message,setMessage]=useState('');
  const [loadError,setLoadError]=useState('');
  const [imageName,setImageName]=useState('');
  const [ocrCandidates,setOcrCandidates]=useState([]);
  const fileRef=useRef(null);

  const load=useCallback(async()=>{
    try{
      const response=await fetch(API,{cache:'no-store'});
      const result=await response.json();
      if(!response.ok||!result.ok)throw new Error(result.error||'Cannot load records');
      setRows(result.rows||[]);
      setLoadError('');
    }catch(e){setLoadError(e.message||'Unable to load saved Speed Post records.')}
  },[]);
  useEffect(()=>{load();},[load]);

  const trackOne=useCallback(async(no)=>{
    const id=normalizeED(no);
    if(!id){setMessage('Enter a valid tracking number such as ED977951280IN.');return;}
    setBusy(id);
    setMessage('Checking '+id+' individually on TrackParcel and MySpeedPost…');
    try{
      const response=await fetch(API,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({trackingNo:id})});
      const result=await response.json();
      if(!response.ok||!result.ok)throw new Error(result.error||'Tracking unavailable');
      setRows(old=>[result.row,...old.filter(r=>r.trackingNo!==id)]);
      setTrackingNo(id);
      setMessage(id+' — latest available ED-matched tracking details saved. Fields not shown by the websites remain blank.');
    }catch(e){setMessage(id+' — '+(e.message||'Tracking unavailable')+'. Existing saved data remains unchanged.');}
    finally{setBusy('');}
  },[]);

  async function uploadImage(event){
    const file=event.target.files?.[0];
    if(!file)return;
    setImageName(file.name);
    setMessage('');
    setOcrCandidates([]);
    if(file.size>8*1024*1024){setMessage('Please upload a photo below 8 MB.');return;}
    setOcrBusy(true);
    setOcrProgress('Locating the ED number next to the EMS slip…');
    try{
      const form=new FormData();
      form.append('photo',file);
      const response=await fetch('/api/speedpost/ocr',{method:'POST',body:form});
      const data=await response.json().catch(()=>({}));
      if(!response.ok||!data.ok)throw new Error(data.error||'OCR reading is temporarily unavailable.');
      const candidates=Array.isArray(data.candidates)?data.candidates.filter(x=>normalizeED(x.number)):[];
      if(!candidates.length){
        setMessage(data.message||'ED number was not readable. Please upload a closer photo of the EMS slip.');
        return;
      }
      setOcrCandidates(candidates);
      setTrackingNo(candidates[0].number);
      if(data.autoSelect===true&&candidates.length===1){
        setOcrProgress('ED number found by the EMS label: '+candidates[0].number);
        await trackOne(candidates[0].number);
        setOcrCandidates([]);
      }else{
        setMessage('Found possible ED numbers near the EMS slip. Please check the number printed beside EMS before tracking.');
      }
    }catch(e){
      setMessage('EMS receipt OCR: '+(e.message||'Could not read the photo.')+' You may enter the ED number manually.');
    }finally{
      setOcrBusy(false);setOcrProgress('');
      if(fileRef.current)fileRef.current.value='';
    }
  }
  async function remove(trackingNoToRemove){
    if(!window.confirm('Remove '+trackingNoToRemove+' from the private Speed Post dashboard?'))return;
    setBusy(trackingNoToRemove);
    try{
      const response=await fetch(API,{method:'DELETE',headers:{'content-type':'application/json'},body:JSON.stringify({trackingNo:trackingNoToRemove})});
      const result=await response.json();
      if(!response.ok||!result.ok)throw new Error(result.error||'Remove failed');
      setRows(old=>old.filter(r=>r.trackingNo!==trackingNoToRemove));
      setMessage(trackingNoToRemove+' removed from private Speed Post records.');
    }catch(e){setMessage(e.message||'Remove failed.')}
    finally{setBusy('');}
  }
  const anythingBusy=Boolean(busy||ocrBusy);
  const cashRows=rows.map(r=>({row:r,billedKg:billedWeightKg(r.weight),cash:cashCost(r)}));
  const validCashRows=cashRows.filter(item=>item.cash!==null);
  const cashGrandTotal=validCashRows.reduce((sum,item)=>sum+item.cash,0);
  const totalBilledKg=validCashRows.reduce((sum,item)=>sum+item.billedKg,0);
  return <main style={{padding:'18px min(4vw,36px) 35px',background:'#f4f7fc',minHeight:'70vh'}}>
    <section style={{...card,background:'linear-gradient(110deg,#173f91,#2a63c7)',color:'#fff',marginBottom:15}}>
      <div style={{fontSize:11,letterSpacing:1.4,fontWeight:800,opacity:.82}}>MAYAVI • PRIVATE</div>
      <h1 style={{margin:'6px 0 9px',fontSize:24}}>India Speed Post Tracking</h1>
      <p style={{margin:0,fontSize:13}}>Visible to Admin and Sonu only • Photos processed privately and not stored • Separate from Air Cargo MAWBs</p>
    </section>
    <div role="tablist" aria-label="Speed Post sections" style={{display:'flex',flexWrap:'wrap',gap:9,marginBottom:15}}>
      <button type="button" role="tab" aria-selected={speedPostTab==='TRACKING'} onClick={()=>setSpeedPostTab('TRACKING')}
        style={{...btn,background:speedPostTab==='TRACKING'?'#2258ce':'#fff',color:speedPostTab==='TRACKING'?'#fff':'#1e40af',border:'1px solid #cbd8ef'}}>
        EMS TRACKING
      </button>
      <button type="button" role="tab" aria-selected={speedPostTab==='CASH_COST'} onClick={()=>setSpeedPostTab('CASH_COST')}
        style={{...btn,background:speedPostTab==='CASH_COST'?'#2258ce':'#fff',color:speedPostTab==='CASH_COST'?'#fff':'#1e40af',border:'1px solid #cbd8ef'}}>
        CASH COST (₹150/KG)
      </button>
    </div>
    {speedPostTab==='TRACKING'&&<>
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,300px),1fr))',gap:14,marginBottom:15}}>
      <section style={card}>
        <div style={{fontWeight:800,marginBottom:9,color:'#163c80'}}>1. Upload receipt / photo</div>
        <input ref={fileRef} type="file" accept="image/*" onChange={uploadImage} disabled={anythingBusy} style={input}/>
        <div style={{color:'#64748b',fontSize:12,marginTop:9}}>Upload the entire parcel photo; OCR focuses first near the printed <strong>EMS slip</strong> for ED + 9 digits + IN. If unclear, upload a close-up of the EMS slip.</div>
        {imageName&&<div style={{fontSize:11,marginTop:7,color:'#475569'}}>Selected: {imageName}</div>}
        {ocrBusy&&<div role="status" style={{color:'#1d4ed8',fontSize:12,marginTop:8}}>{ocrProgress||'Reading the EMS slip…'}</div>}
        {ocrCandidates.length>0&&<div style={{border:'1px solid #bfd3ef',borderRadius:9,padding:10,marginTop:12,background:'#f4f8ff'}}><strong style={{fontSize:12}}>Check the ED number printed near EMS:</strong>{ocrCandidates.map(c=><label key={c.number} style={{display:'flex',alignItems:'center',gap:7,fontSize:13,marginTop:8}}><input type="radio" name="speedpost-ocr-choice" checked={trackingNo===c.number} onChange={()=>setTrackingNo(c.number)}/>{c.number}<small style={{color:c.checkDigitValid?'#15803d':'#a16207'}}>{c.checkDigitValid?'check digit valid':'verify digits'}</small></label>)}<button type="button" style={{...btn,marginTop:10,padding:'8px 12px',fontSize:12}} disabled={anythingBusy} onClick={async()=>{const n=normalizeED(trackingNo);if(n){setOcrCandidates([]);await trackOne(n)}}}>CONFIRM & TRACK</button></div>}
      </section>
      <section style={card}>
        <div style={{fontWeight:800,marginBottom:9,color:'#163c80'}}>2. Track & save consignment</div>
        <form onSubmit={e=>{e.preventDefault();trackOne(trackingNo);}}>
          <input style={{...input,textTransform:'uppercase',marginBottom:9}} maxLength={18} value={trackingNo} onChange={e=>setTrackingNo(e.target.value.toUpperCase())} placeholder="ED977951280IN"/>
          <button style={{...btn,opacity:anythingBusy?.6:1,width:'100%'}} disabled={anythingBusy} type="submit">{anythingBusy?'WORKING…':'TRACK & SAVE →'}</button>
        </form>
        <div style={{fontSize:11,color:'#64748b',marginTop:9}}>Each ED number is checked individually on <a href="https://www.trackparcel.in/" target="_blank" rel="noreferrer">TrackParcel ↗</a>. Existing MySpeedPost tariff and booking fields are retained where available. Both are third-party services.</div>
      </section>
    </div>
    {(message||loadError)&&<div role="status" style={{...card,marginBottom:14,color:loadError?'#a52a2a':'#1e40af',fontSize:13}}>{loadError||message}</div>}
    <section style={card}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:10,marginBottom:13}}>
        <div><h2 style={{fontSize:18,margin:'0 0 4px'}}>Saved Speed Post Consignments</h2><span style={{color:'#64748b',fontSize:12}}>{rows.length} tracking numbers • {currentUser?.displayName||'Private access'}</span></div>
        <button style={{...btn,background:'#e7eefb',color:'#224f9b'}} onClick={load} disabled={anythingBusy}>RELOAD RECORDS</button>
      </div>
      <div style={{overflowX:'auto'}}>
        <table style={{borderCollapse:'collapse',width:'100%',minWidth:1350}}>
          <thead><tr>{['S.No.','Tracking No.','Origin','Destination','Address','Tariff (INR)','Booking Date','Out for Delivery','Status','Weight','Rounded Weight (kg)','Cash Cost (₹)','Cost per kg (₹)','Last Updated','Actions'].map(label=><th key={label} style={th}>{label}</th>)}</tr></thead>
          <tbody>{rows.length?rows.map((r,i)=><tr key={r.trackingNo}>
            <td style={td}>{i+1}</td>
            <td style={td}><strong>{r.trackingNo}</strong></td>
            <td style={td}>{shortOrigin(r.origin)||'—'}</td>
            <td style={td}>{destinationWithCountry(r)||'—'}</td>
            <td style={{...td,maxWidth:260,minWidth:180,whiteSpace:'normal',overflowWrap:'anywhere'}}>{field(r,'address')}</td>
            <td style={td}>{r.tariff?<span>₹{field(r,'tariff')}</span>:'—'}</td>
            <td style={td}>{field(r,'bookingDate')}</td>
            <td style={td}>{r.outForDelivery?'YES'+(r.outForDeliveryAt?' • '+r.outForDeliveryAt:''):r.delivered?'COMPLETED':'—'}</td>
            <td style={td}><strong style={{color:/delivered/i.test(r.status||'')?'#15803d':/out for delivery/i.test(r.status||'')?'#1d4ed8':'#334155'}}>{formatValue(r.status)}</strong></td>
            <td style={td}>{field(r,'weight')}{weightInKg(r.weight)&&!/\bkg\b/i.test(String(r.weight||''))&&<small style={{display:'block',color:'#64748b'}}> {weightInKg(r.weight).toLocaleString('en-IN',{maximumFractionDigits:4})} kg</small>}</td>
            <td style={{...td,fontWeight:700}}>{billedWeightKg(r.weight)===null?'—':billedWeightKg(r.weight)+' kg'}</td>
            <td style={{...td,fontWeight:800,color:'#166534'}}>{cashCost(r)===null?'—':rupeePerKg.format(cashCost(r))}</td>
            <td style={{...td,fontWeight:700}}>{costPerKg(r)===null?'—':rupeePerKg.format(costPerKg(r))+'/kg'}</td>
            <td style={td}>{field(r,'lastUpdated')}<small style={{display:'block',color:'#64748b',marginTop:4}}>{r.lastChecked?'Checked '+new Date(r.lastChecked).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}):''}</small></td>
            <td style={td}><div style={{display:'flex',gap:6}}>
              <button type="button" style={{...btn,padding:'7px 9px',fontSize:11}} onClick={()=>trackOne(r.trackingNo)} disabled={anythingBusy}>{busy===r.trackingNo?'…':'REFRESH'}</button>
              <a href="https://www.trackparcel.in/" target="_blank" rel="noreferrer" style={{...btn,padding:'8px',fontSize:11,background:'#e4edfa',color:'#1d4ed8',textDecoration:'none'}}>TRACKPARCEL ↗</a>
              <button type="button" style={{...btn,padding:'7px 9px',fontSize:11,background:'#b91c1c'}} onClick={()=>remove(r.trackingNo)} disabled={anythingBusy}>DELETE</button>
            </div></td>
          </tr>):<tr><td colSpan={15} style={{...td,textAlign:'center',padding:28,color:'#64748b'}}>Upload a receipt or enter an ED tracking number to add your first Speed Post consignment.</td></tr>}</tbody>
        </table>
      </div>
      <p style={{fontSize:11,color:'#64748b',marginBottom:0}}>Cash Cost appears beside Weight: rounded-up whole kilograms × ₹150. Scroll horizontally to view the right-hand columns. Address, weight, origin and destination are filled only when present on an ED-matched tracking result. “Previous check” means saved historical data; missing addresses are not guessed. Refresh each packet to check its details again.</p>
    </section>
    </>}
    {speedPostTab==='CASH_COST'&&<section style={card}>
      <div style={{display:'flex',flexWrap:'wrap',justifyContent:'space-between',gap:12,alignItems:'center',marginBottom:14}}>
        <div>
          <h2 style={{margin:'0 0 4px',fontSize:19}}>Speed Post Cash Cost</h2>
          <div style={{fontSize:12,color:'#64748b'}}>Every started kilogram is charged at ₹150. Calculated from each packet's saved weight.</div>
        </div>
        <button style={{...btn,background:'#e7eefb',color:'#224f9b'}} onClick={load} disabled={anythingBusy}>RELOAD RECORDS</button>
      </div>
      {loadError&&<p role="alert" style={{color:'#b91c1c',fontSize:13}}>{loadError}</p>}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:10,marginBottom:18}}>
        <div style={{padding:14,background:'#f1f5fd',borderRadius:10}}>
          <div style={{fontSize:12,color:'#64748b'}}>Total cash cost</div>
          <strong style={{fontSize:24,color:'#163c80'}}>{rupeePerKg.format(cashGrandTotal)}</strong>
        </div>
        <div style={{padding:14,background:'#f1f5fd',borderRadius:10}}>
          <div style={{fontSize:12,color:'#64748b'}}>Rounded billable weight</div>
          <strong style={{fontSize:24,color:'#163c80'}}>{totalBilledKg.toLocaleString('en-IN')} kg</strong>
        </div>
        <div style={{padding:14,background:'#f1f5fd',borderRadius:10}}>
          <div style={{fontSize:12,color:'#64748b'}}>Packets with weight / missing weight</div>
          <strong style={{fontSize:24,color:'#163c80'}}>{validCashRows.length} / {cashRows.length-validCashRows.length}</strong>
        </div>
      </div>
      <div style={{overflowX:'auto'}}>
        <table style={{borderCollapse:'collapse',width:'100%',minWidth:740}}>
          <thead><tr>{['S.No.','ED Tracking Number','Actual Weight','Weight in kg','Rounded Weight (kg)','Cash Rate','Total Cash Cost'].map(label=><th key={label} style={th}>{label}</th>)}</tr></thead>
          <tbody>{cashRows.length?cashRows.map(({row,billedKg,cash},i)=><tr key={row.trackingNo}>
            <td style={td}>{i+1}</td>
            <td style={td}><strong>{row.trackingNo}</strong></td>
            <td style={td}>{field(row,'weight')}</td>
            <td style={td}>{weightInKg(row.weight)===null?'—':weightInKg(row.weight).toLocaleString('en-IN',{maximumFractionDigits:4})+' kg'}</td>
            <td style={td}><strong>{billedKg===null?'—':billedKg+' kg'}</strong></td>
            <td style={td}>₹150 / kg</td>
            <td style={td}>{cash===null?<button type="button" style={{...btn,background:'#e7eefb',color:'#1d4ed8',fontSize:11,padding:'7px 10px'}} onClick={()=>{setTrackingNo(row.trackingNo);setSpeedPostTab('TRACKING');}}>WEIGHT MISSING — TRACK</button>:<strong style={{color:'#166534'}}>{rupeePerKg.format(cash)}</strong>}</td>
          </tr>):<tr><td colSpan={7} style={{...td,textAlign:'center',padding:25,color:'#64748b'}}>No Speed Post packets have been saved yet.</td></tr>}</tbody>
        </table>
      </div>
      <p style={{margin:'14px 0 0',fontSize:12,color:'#475569'}}>Formula: <strong>Cash Cost = ceil(weight in kg) × ₹150.</strong> Examples: 4750 g → 5 kg → ₹750; 9710 g → 10 kg → ₹1,500. Exact whole kilograms are not rounded further. Missing or invalid weight has no calculated cost.</p>
    </section>}
  </main>;
}
