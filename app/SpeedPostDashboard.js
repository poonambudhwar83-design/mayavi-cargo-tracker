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
function postalCost(row){
  const text=String(row?.tariff??'').trim().replace(/[₹,\s]/g,'').replace(/INR/ig,'');
  if(!/^\d+(?:\.\d+)?$/.test(text))return null;
  const amount=Number(text);
  return Number.isFinite(amount)&&amount>=0?amount:null;
}
// Aggregate by the date the record was FIRST entered in Mayavi, IST.
// Include both Active and Delivered exactly once; missing-cost packets are
// counted but excluded from confirmed totals.
function entryDateCostGroups(allRows){
  const groups=new Map();
  for(const row of allRows){
    const date=formatEntryDate(row.createdAt);
    if(date==='—')continue;
    if(!groups.has(date))groups.set(date,{totalPackets:0,completePackets:0,postal:0,cash:0});
    const group=groups.get(date);
    group.totalPackets++;
    const postal=postalCost(row),cash=cashCost(row);
    if(postal===null||cash===null)continue;
    group.completePackets++;
    group.postal+=postal;
    group.cash+=cash;
  }
  return groups;
}
function costPerKg(row){
  const kg=weightInKg(row?.weight);
  const total=Number(String(row?.tariff??'').replace(/[,₹\s]/g,''));
  if(!kg||!Number.isFinite(total)||total<0)return null;
  return total/kg;
}
const rupeePerKg=new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',minimumFractionDigits:2,maximumFractionDigits:2});
function formatEntryDate(value){
  if(!value)return '—';
  const d=new Date(value);
  if(Number.isNaN(d.getTime()))return '—';
  return new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'2-digit',year:'numeric',timeZone:'Asia/Kolkata'}).format(d);
}
function isDelivered(row){
  return row?.delivered===true||/^delivered$/i.test(String(row?.status||'').trim());
}
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
  const [duplicateBusy,setDuplicateBusy]=useState('');
  const [trackingNo,setTrackingNo]=useState('');
  const [busy,setBusy]=useState('');
  const [ocrBusy,setOcrBusy]=useState(false);
  const [ocrProgress,setOcrProgress]=useState('');
  const [message,setMessage]=useState('');
  const [loadError,setLoadError]=useState('');
  const [imageName,setImageName]=useState('');
  const [ocrCandidates,setOcrCandidates]=useState([]);
  const [senderName,setSenderName]=useState('');
  const [senderOcrStatus,setSenderOcrStatus]=useState('');
  const [senderSaving,setSenderSaving]=useState(false);
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

  const trackOne=useCallback(async(no,action='add')=>{
    const id=normalizeED(no);
    if(!id){setMessage('Enter a valid tracking number such as ED977951280IN.');return;}
    setBusy(id);
    setMessage(action==='add'?'Saving '+id+' first…':'Checking tracking for '+id+'…');
    try{
      const response=await fetch(API,{method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({trackingNo:id,action})});
      const result=await response.json();
      if(!response.ok||!result.ok)throw new Error(result.error||'Could not save ED record');
      if(result.row)setRows(old=>[result.row,...old.filter(r=>r.trackingNo!==id)]);
      setTrackingNo(id);
      if(result.duplicate===true){
        setSpeedPostTab(isDelivered(result.row)?'DELIVERED':'TRACKING');
        setMessage(id+' — DUPLICATE ED NUMBER! Existing packet highlighted; no extra row added.');
        return;
      }
      if(result.created===true){
        // ED number is safely persisted before the slow external lookup starts.
        setSpeedPostTab('TRACKING');
        setMessage(id+' saved in Mayavi. Fetching its tracking details…');
        try{
          const detailResponse=await fetch(API,{method:'POST',headers:{'content-type':'application/json'},
            body:JSON.stringify({trackingNo:id,action:'refresh'})});
          const details=await detailResponse.json();
          if(detailResponse.ok&&details.ok){
            if(details.row)setRows(old=>[details.row,...old.filter(r=>r.trackingNo!==id)]);
            if(isDelivered(details.row))setSpeedPostTab('DELIVERED');
            setMessage(details.trackingPending
              ?id+' saved. Tracking site did not return details yet; try REFRESH later.'
              :id+' saved with the latest available tracking details.');
          }else{
            setMessage(id+' saved successfully; tracking update pending: '+(details.error||'site unavailable'));
          }
        }catch(e){
          setMessage(id+' saved successfully; tracking update pending: '+(e.message||'site unavailable'));
        }
      }else if(result.trackingPending){
        setMessage(id+' is saved. Tracking data unavailable: '+(result.error||'please try again later'));
      }else{
        if(isDelivered(result.row))setSpeedPostTab('DELIVERED');
        setMessage(id+' — tracking refreshed. Existing data preserved.');
      }
    }catch(e){setMessage(id+' — '+(e.message||'Unable to save. Please retry.'));}
    finally{setBusy('');}
  },[]);
  async function saveSenderName(){
    const id=normalizeED(trackingNo),name=String(senderName||'').replace(/\s+/g,' ').trim();
    if(!id){setMessage('Confirm the ED tracking number before saving Sender Name.');return;}
    if(name.length<3){setMessage('Read or enter the sender name from FROM (not TO).');return;}
    setSenderSaving(true);
    try{
      const response=await fetch(API,{method:'PATCH',headers:{'content-type':'application/json'},
        body:JSON.stringify({trackingNo:id,action:'save-sender',senderName:name})});
      const result=await response.json().catch(()=>({}));
      if(!response.ok||!result.ok)throw new Error(result.error||'Sender could not be saved');
      setRows(old=>[result.row,...old.filter(r=>r.trackingNo!==id)]);
      setMessage('Sender Name '+name+' confirmed and saved on '+id+'.');
      setSenderOcrStatus('Sender confirmed and saved');
    }catch(e){setMessage(id+' — '+(e.message||'Sender save failed'));}
    finally{setSenderSaving(false);}
  }
  async function uploadImage(event){
    const file=event.target.files?.[0];
    if(!file)return;
    setImageName(file.name);
    setMessage('');
    setOcrCandidates([]);
    setSenderName('');
    setSenderOcrStatus('');
    if(file.size>8*1024*1024){setMessage('Please upload a photo below 8 MB.');return;}
    setOcrBusy(true);
    setOcrProgress('Locating the ED number next to the EMS slip…');
    try{
      const form=new FormData();
      form.append('photo',file);
      const response=await fetch('/api/speedpost/ocr',{method:'POST',body:form});
      const data=await response.json().catch(()=>({}));
      if(!response.ok||!data.ok)throw new Error(data.error||'OCR reading is temporarily unavailable.');
      // Separate OCR #2: FROM sender name. Never auto-save unreviewed names.
      const candidateName=String(data.senderName||'').trim().slice(0,100);
      setSenderName(candidateName);
      setSenderOcrStatus(candidateName
        ?'FROM sender name found — review spelling and click Confirm & Save Sender'
        :'FROM sender was not clear; enter it manually from the parcel photo');
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
  async function acknowledgeDuplicate(number){
    const id=normalizeED(number);
    if(!id)return;
    setDuplicateBusy(id);
    try{
      const response=await fetch(API,{method:'PATCH',headers:{'content-type':'application/json'},
        body:JSON.stringify({trackingNo:id,action:'acknowledge-duplicate'})});
      const result=await response.json();
      if(!response.ok||!result.ok)throw new Error(result.error||'Could not clear duplicate alert');
      setRows(old=>old.map(r=>r.trackingNo===id?result.row:r));
      setMessage('Duplicate warning acknowledged for '+id+'. Shipment remains saved.');
    }catch(e){setMessage(e.message||'Cannot acknowledge duplicate alert.');}
    finally{setDuplicateBusy('');}
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
  const activeRows=rows.filter(r=>!isDelivered(r));
  const deliveredRows=rows.filter(isDelivered);
  const duplicateRows=rows.filter(r=>r.duplicateAlert===true);
  const displayedRows=speedPostTab==='DELIVERED'?deliveredRows:activeRows;
  // Daily totals are calculated from ALL unique ED records so moving a
  // Delivered packet does not change its original booking-date total.
  const dateCostGroups=entryDateCostGroups(rows);
  return <main style={{padding:'18px min(4vw,36px) 35px',background:'#f4f7fc',minHeight:'70vh'}}>
    <style>{`
      @keyframes speedPostDuplicateBlink{
        0%,100%{background-color:#fff0ed;box-shadow:inset 0 0 0 1px #fecaca}
        50%{background-color:#ffaaaa;box-shadow:inset 0 0 0 2px #b91c1c}
      }
      .sp-duplicate-alert,.sp-duplicate-row{animation:speedPostDuplicateBlink 1.3s linear infinite}
      @media (prefers-reduced-motion:reduce){
        .sp-duplicate-alert,.sp-duplicate-row{animation:none;background-color:#fee2e2;outline:2px solid #b91c1c}
      }
    `}</style>
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
      <button type="button" role="tab" aria-selected={speedPostTab==='DELIVERED'} onClick={()=>setSpeedPostTab('DELIVERED')}
        style={{...btn,background:speedPostTab==='DELIVERED'?'#2258ce':'#fff',color:speedPostTab==='DELIVERED'?'#fff':'#1e40af',border:'1px solid #cbd8ef'}}>
        DELIVERED ({deliveredRows.length})
      </button>
    </div>
    {duplicateRows.length>0&&<div className="sp-duplicate-alert" role="alert" style={{...card,border:'2px solid #b91c1c',marginBottom:15}}>
      <strong style={{color:'#991b1b',fontSize:15}}>DUPLICATE ED ALERT — {duplicateRows.length} packet{duplicateRows.length===1?'':'s'}</strong>
      <div style={{fontSize:12,color:'#7f1d1d',marginTop:5,marginBottom:7}}>Same ED number entered again. Existing entries are highlighted in their Active / Delivered rows; no duplicate shipment was created.</div>
      <div style={{display:'flex',flexWrap:'wrap',gap:8}}>
        {duplicateRows.map(r=><div key={r.trackingNo} style={{display:'flex',gap:5,alignItems:'center',padding:7,borderRadius:8,background:'#fff'}}>
          <button type="button" style={{...btn,padding:'6px 8px',background:'#b91c1c',fontSize:12}}
            onClick={()=>setSpeedPostTab(isDelivered(r)?'DELIVERED':'TRACKING')}>{r.trackingNo} • VIEW ROW</button>
          <button type="button" style={{...btn,padding:'6px 8px',fontSize:11,background:'#fff',color:'#991b1b',border:'1px solid #fecaca'}}
            disabled={Boolean(duplicateBusy)} onClick={()=>acknowledgeDuplicate(r.trackingNo)}>{duplicateBusy===r.trackingNo?'WAIT…':'ACKNOWLEDGE'}</button>
        </div>)}
      </div>
    </div>}
    {(speedPostTab==='TRACKING'||speedPostTab==='DELIVERED')&&<>
    {speedPostTab==='TRACKING'&&<div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,300px),1fr))',gap:14,marginBottom:15}}>
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
      <section style={card}>
        <div style={{fontWeight:800,marginBottom:9,color:'#163c80'}}>3. Sender Name OCR — FROM section</div>
        <label htmlFor="speedpostSender" style={{fontSize:12,color:'#334155',display:'block',marginBottom:7}}>Sender Name (review the photo and correct spelling)</label>
        <input id="speedpostSender" type="text" value={senderName} onChange={e=>setSenderName(e.target.value)}
          style={{...input,marginBottom:9}} maxLength={100} placeholder="e.g. AJAY KUMAR"/>
        {senderOcrStatus&&<div role="status" style={{fontSize:12,color:'#475569',marginBottom:9}}>{senderOcrStatus}</div>}
        <button type="button" onClick={saveSenderName} style={{...btn,width:'100%',opacity:anythingBusy||senderSaving?.6:1}}
          disabled={anythingBusy||senderSaving}>{senderSaving?'SAVING…':'CONFIRM & SAVE SENDER'}</button>
        <div style={{fontSize:11,color:'#64748b',marginTop:9}}>OCR #1 reads the ED barcode sticker; OCR #2 reads Sender Name from FROM only. Save the ED number before confirming its sender. TO / consignee details are not used for Sender Name.</div>
      </section>
    </div>}
    {(message||loadError)&&<div role="status" style={{...card,marginBottom:14,color:loadError?'#a52a2a':'#1e40af',fontSize:13}}>{loadError||message}</div>}
    <section style={card}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:10,marginBottom:13}}>
        <div><h2 style={{fontSize:18,margin:'0 0 4px'}}>{speedPostTab==='DELIVERED'?'Delivered Speed Post Sheet':'Active Speed Post Sheet'}</h2><span style={{color:'#64748b',fontSize:12}}>{displayedRows.length} packets • {currentUser?.displayName||'Private access'}</span></div>
        <button style={{...btn,background:'#e7eefb',color:'#224f9b'}} onClick={load} disabled={anythingBusy}>RELOAD RECORDS</button>
      </div>
      <div style={{overflowX:'auto'}}>
        <table style={{borderCollapse:'collapse',width:'100%',minWidth:1690}}>
          <thead><tr>{['S.No.','Tracking No.','Sender Name','Entry Date','Entry-Date Total (₹)','Origin','Destination','Address','Tariff (INR)','Booking Date','Out for Delivery','Status','Weight','Rounded Weight (kg)','Cash Cost (₹)','Cost per kg (₹)','Last Updated','Actions'].map(label=><th key={label} style={th}>{label}</th>)}</tr></thead>
          <tbody>{displayedRows.length?displayedRows.map((r,i)=><tr key={r.trackingNo} className={r.duplicateAlert===true?'sp-duplicate-row':undefined}>
            <td style={td}>{i+1}</td>
            <td style={td}><strong>{r.trackingNo}</strong>{r.duplicateAlert===true&&<strong style={{display:'block',fontSize:10,color:'#991b1b'}}>DUPLICATE{Number(r.duplicateCount)>0?' ×'+r.duplicateCount:''}</strong>}</td>
            <td style={{...td,maxWidth:190,whiteSpace:'normal',overflowWrap:'anywhere'}}>{field(r,'senderName')}</td>
            <td style={td}>{formatEntryDate(r.createdAt)}</td>
            <td style={{...td,minWidth:180,whiteSpace:'normal'}}>
              {(()=>{
                const summary=dateCostGroups.get(formatEntryDate(r.createdAt));
                // A daily total belongs to only the FIRST visible row of its date.
                if(displayedRows.findIndex(item=>formatEntryDate(item.createdAt)===formatEntryDate(r.createdAt))!==i)return '—';
                if(!summary)return '—';
                return <div>
                  <strong style={{color:'#163c80'}}>{summary.completePackets?rupeePerKg.format(summary.postal+summary.cash):'—'}</strong>
                  <small style={{display:'block',color:summary.completePackets===summary.totalPackets?'#166534':'#a16207'}}>
                    {summary.completePackets}/{summary.totalPackets} packets costed{summary.completePackets===summary.totalPackets?'':' • PARTIAL'}
                  </small>
                  {summary.completePackets>0&&<small style={{display:'block',color:'#64748b'}}>
                    Postal {rupeePerKg.format(summary.postal)} + Cash {rupeePerKg.format(summary.cash)}
                  </small>}
                </div>;
              })()}
            </td>
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
              <button type="button" style={{...btn,padding:'7px 9px',fontSize:11}} onClick={()=>trackOne(r.trackingNo,'refresh')} disabled={anythingBusy}>{busy===r.trackingNo?'…':'REFRESH'}</button>
              <a href="https://www.trackparcel.in/" target="_blank" rel="noreferrer" style={{...btn,padding:'8px',fontSize:11,background:'#e4edfa',color:'#1d4ed8',textDecoration:'none'}}>TRACKPARCEL ↗</a>
              {r.duplicateAlert===true&&<button type="button" style={{...btn,padding:'7px 9px',fontSize:11,background:'#fef2f2',color:'#991b1b',border:'1px solid #fecaca'}} onClick={()=>acknowledgeDuplicate(r.trackingNo)} disabled={Boolean(duplicateBusy)}>CLEAR ALERT</button>}
              <button type="button" style={{...btn,padding:'7px 9px',fontSize:11,background:'#b91c1c'}} onClick={()=>remove(r.trackingNo)} disabled={anythingBusy}>DELETE</button>
            </div></td>
          </tr>):<tr><td colSpan={18} style={{...td,textAlign:'center',padding:28,color:'#64748b'}}>{speedPostTab==='DELIVERED'?'No parcels are marked Delivered yet.':'No active parcels. Add a new ED number above or check the Delivered tab.'}</td></tr>}</tbody>
        </table>
      </div>
      <p style={{fontSize:11,color:'#64748b',marginBottom:0}}>Entry-Date Total combines the postal and cash costs of ALL packets entered that day, across Active and Delivered. Only packets with both costs known count towards the amount; PARTIAL means some costs are still missing. Cash Cost beside Weight is rounded-up whole kilograms × ₹150. Scroll horizontally to view the right-hand columns. Address, weight, origin and destination are filled only when present on an ED-matched tracking result. “Previous check” means saved historical data; missing addresses are not guessed. Refresh each packet to check its details again.</p>
    </section>
    </>}
  </main>;
}
