'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { checkEdChecksum } from '../lib/speedpostOcr.js';
import { createBookingPendingPdf } from '../lib/speedpostPendingPdf.js';
import { createSpeedPostPdf, createSpeedPostXlsx } from '../lib/speedpostExports.js';
import SpeedPostMonthlyProfit from './SpeedPostMonthlyProfit.js';
import {speedPostProfitRow} from '../lib/speedpostMonthlyProfit.js';
import { speedPostEntryDay, speedPostEntryMonth, speedPostCostSummary,
  speedPostGroupByEntryDay, speedPostGroupByEntryMonth } from '../lib/speedpostCostReports.js';

const API='/api/speedpost';
const MAX_BATCH_PHOTOS=20;
const PARALLEL_BATCH_OCR=2;
const card={border:'1px solid #dce5f1',borderRadius:14,padding:17,background:'#fff',boxShadow:'0 2px 8px rgba(15,23,42,.04)'};
const btn={border:0,borderRadius:8,padding:'10px 14px',background:'#2258ce',color:'#fff',fontWeight:800,cursor:'pointer'};
const input={width:'100%',boxSizing:'border-box',height:42,border:'1px solid #c8d4e3',borderRadius:8,padding:'7px 11px',fontSize:14};
const th={textAlign:'left',padding:'8px 5px',whiteSpace:'nowrap',color:'#334155',fontSize:11.5,borderBottom:'1px solid #dce4ef',background:'#f5f8fe'};
const td={padding:'7px 5px',fontSize:11.5,borderBottom:'1px solid #edf1f6',whiteSpace:'nowrap',verticalAlign:'top'};

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

function shipmentCountry(row){
  // Country-wise summaries must come from the tracked DESTINATION, not origin.
  const destination=String(row.destination||'').trim().toUpperCase();
  const explicit=String(row.destinationCountry||row.country||'').trim().toUpperCase();
  const countryText=destination+' '+explicit;
  if(/\b(UK|UNITED KINGDOM|ENGLAND|SCOTLAND|WALES|GREAT BRITAIN|GB|LEICESTER|LEICESTERSHIRE)\b/.test(countryText))return 'UK';
  if(/\b(USA|UNITED STATES(?: OF AMERICA)?|US)\b/.test(countryText))return 'USA';
  if(/\bCANADA\b/.test(countryText))return 'Canada';
  if(/\bAUSTRALIA\b/.test(countryText))return 'Australia';
  if(/\bNEW ZEALAND\b/.test(countryText))return 'New Zealand';
  if(/\b(UAE|UNITED ARAB EMIRATES|DUBAI|ABU DHABI)\b/.test(countryText))return 'UAE';
  // Do not invent a country from an unrecognized destination city.
  return explicit||'Unknown';
}
function weightSummary(rows){
  const unique=new Map();
  for(const row of rows){const ed=normalizeED(row.trackingNo);if(ed&&!unique.has(ed))unique.set(ed,row);}
  const countries=new Map(),months=new Map();
  let totalKg=0,totalRoundedKg=0,knownWeights=0;
  for(const row of unique.values()){
    const kg=weightInKg(row.weight);
    const roundedKg=billedWeightKg(row.weight);
    const country=shipmentCountry(row);
    const date=row.createdAt?new Date(row.createdAt):null;
    const month=date&&!Number.isNaN(date.getTime())?new Intl.DateTimeFormat('en-GB',{month:'long',year:'numeric',timeZone:'Asia/Kolkata'}).format(date):'Entry date unknown';
    for(const [map,key] of [[countries,country],[months,month]]){
      if(!map.has(key))map.set(key,{packets:0,knownWeights:0,kg:0,roundedKg:0});
      const group=map.get(key);group.packets++;
      if(kg!==null){group.kg+=kg;group.roundedKg+=roundedKg;group.knownWeights++;}
    }
    if(kg!==null){totalKg+=kg;totalRoundedKg+=roundedKg;knownWeights++;}
  }
  return {packets:unique.size,knownWeights,totalKg,totalRoundedKg,countries:[...countries].sort((a,b)=>a[0].localeCompare(b[0])),months:[...months].sort((a,b)=>a[0].localeCompare(b[0]))};
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
  // Total Cost (Tariff + Cash Cost) divided by the rounded/billed kilograms.
  // This is identical to the new Monthly Profit tab's Cost/kg.
  return speedPostProfitRow(row).costPerKg;
}
const rupeePerKg=new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',minimumFractionDigits:2,maximumFractionDigits:2});
function nowISTDate(){
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'})
    .format(new Date()).replace(/\//g,'-');
}
function formatEntryDate(value){
  if(!value)return '—';
  const d=new Date(value);
  if(Number.isNaN(d.getTime()))return '—';
  return new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'2-digit',year:'numeric',timeZone:'Asia/Kolkata'}).format(d);
}
function isDelivered(row){
  return row?.delivered===true||/^delivered$/i.test(String(row?.status||'').trim());
}
function statusBucket(row){
  if(isDelivered(row))return 'DELIVERED';
  const s=String(row?.status||'').trim().toLowerCase();
  if(!s||/pending|not found|not tracked|unavailable|verification|awaiting|unknown|no tracking|no information/.test(s))return 'PENDING';
  if(/dispatch|despatch|out for delivery|sent to export|forwarded|departed|sent abroad/.test(s))return 'DISPATCHED';
  if(/in transit|transit|on the way|arrived at|received at|reached|at sorting|at delivery office|at airport/.test(s))return 'IN_TRANSIT';
  return 'OTHER';
}
function formatValue(value){return value?String(value):'—'}
function field(row,key){
  const val=row?.[key];
  if(!val)return <span style={{color:'#94a3b8'}}>—</span>;
  const retained=Array.isArray(row.retainedFields)&&row.retainedFields.includes(key);
  return <span title={retained?'From last saved verified tracking response':undefined}>{val}{retained&&<small style={{display:'block',color:'#a16207'}}>previous check</small>}</span>;
}

export default function SpeedPostDashboard({currentUser}){
  const canViewProfit=currentUser?.role==='admin';
  const [rows,setRows]=useState([]);
  const [speedPostTab,setSpeedPostTab]=useState('TRACKING');
  const [selectedEntryDay,setSelectedEntryDay]=useState('LATEST');
  const [selectedEntryMonth,setSelectedEntryMonth]=useState('LATEST');
  const [duplicateBusy,setDuplicateBusy]=useState('');
  const [trackingNo,setTrackingNo]=useState('');

  const [busy,setBusy]=useState('');
  const [ocrBusy,setOcrBusy]=useState(false);
  const [ocrProgress,setOcrProgress]=useState('');
  const [message,setMessage]=useState('');
  const [loadError,setLoadError]=useState('');
  const [imageName,setImageName]=useState('');
  const [ocrCandidates,setOcrCandidates]=useState([]);
  const [photoRecipient,setPhotoRecipient]=useState({consigneeName:'',consigneeAddress:''});
  const [photoEdNeedsEntry,setPhotoEdNeedsEntry]=useState(false);
  const [photoHasBeenRead,setPhotoHasBeenRead]=useState(false);
  const [photoRecipientConfidence,setPhotoRecipientConfidence]=useState('unreadable');
  const [batchItems,setBatchItems]=useState([]);
  const [batchRunning,setBatchRunning]=useState(false);
  const [reviewBusy,setReviewBusy]=useState(false);
  const [rowDrafts,setRowDrafts]=useState({});
  const [rowSaving,setRowSaving]=useState('');
  const [exportStatus,setExportStatus]=useState('SHEET');
  const [historyIncomplete,setHistoryIncomplete]=useState(false);
  const fileRef=useRef(null);

  const load=useCallback(async()=>{
    try{
      const response=await fetch(API,{cache:'no-store'});
      const result=await response.json();
      if(!response.ok||!result.ok)throw new Error(result.error||'Cannot load records');
      setRows(result.rows||[]);
      setHistoryIncomplete(Boolean(result.hasMore));
      setLoadError('');
    }catch(e){setLoadError(e.message||'Unable to load saved Speed Post records.')}
  },[]);
  useEffect(()=>{load();const poll=setInterval(load,60*1000);return()=>clearInterval(poll);},[load]);

  const trackOne=useCallback(async(no,action='add',photoFields=null)=>{
    const id=normalizeED(no);
    if(!id){setMessage('Enter a valid tracking number such as ED977951280IN.');return;}
    setBusy(id);
    setMessage(action==='photo-add'?'Saving ED and consignee from photo…':action==='add'?'Saving '+id+' first…':'Checking tracking for '+id+'…');
    try{
      const response=await fetch(API,{method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({trackingNo:id,action,...(['photo-add','manual-save'].includes(action)?photoFields||{}:{})})});
      const result=await response.json();
      if(!response.ok||!result.ok)throw new Error(result.error||'Could not save ED record');
      if(result.row)setRows(old=>[result.row,...old.filter(r=>r.trackingNo!==id)]);
      setTrackingNo(id);
      
      if(result.duplicate===true){
        setSpeedPostTab(isDelivered(result.row)?'DELIVERED':'TRACKING');
        setMessage(id+' — DUPLICATE ED. '+(result.message||'Existing packet highlighted; no extra row added.')+(!result.row?.consigneeName?' Please enter the consignee name.':''));
        return;
      }
      if(result.created===true||result.manualSaved===true){
        // ED number is safely persisted before the slow external lookup starts.
        setSpeedPostTab(isDelivered(result.row)?'DELIVERED':'TRACKING');
        setMessage(id+' saved in Mayavi. Checking EMS and TrackParcel…');
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
  // Chrome/Android native Code-128 detection is faster for legible 1-D EMS barcodes.
  // Other browsers and unreadable barcodes continue to the dedicated OCR route.
  async function readEDBarcode(file){
    if(typeof window==='undefined'||!window.BarcodeDetector||!window.createImageBitmap)return'';
    let bitmap;
    try{
      const formats=await window.BarcodeDetector.getSupportedFormats?.()||[];
      const allowed=['code_128','code_39','codabar'].filter(x=>formats.includes(x));
      if(!allowed.length)return'';
      bitmap=await window.createImageBitmap(file);
      const reader=new window.BarcodeDetector({formats:allowed});
      const results=await reader.detect(bitmap);
      for(const result of results||[]){
        const ed=normalizeED(String(result.rawValue||'').replace(/[^A-Z0-9]/gi,''));
        if(ed&&checkEdChecksum(ed))return ed;
      }
      return'';
    }catch{return'';}
    finally{try{bitmap?.close?.()}catch{}}
  }
  function draftFor(row,field){
    return rowDrafts[row.trackingNo]?.[field]??String(row[field]||'');
  }
  function changeRowDraft(id,field,value){
    setRowDrafts(old=>({...old,[id]:{...(old[id]||{}),[field]:value}}));
  }
  async function saveConsigneeRow(row){
    const trackingNo=row.trackingNo;
    const consigneeName=draftFor(row,'consigneeName');
    setRowSaving(trackingNo);setMessage('Saving consignee name for '+trackingNo+'…');
    try{
      // Save ONLY the name. The address (if already stored) is untouched.
      const response=await fetch(API,{method:'PATCH',headers:{'content-type':'application/json'},
        body:JSON.stringify({trackingNo,action:'save-consignee-name',consigneeName})});
      const result=await response.json();
      if(!response.ok||!result.ok)throw Error(result.error||'Unable to save consignee name');
      if(result.row)setRows(old=>old.map(r=>r.trackingNo===trackingNo?result.row:r));
      setRowDrafts(old=>{const next={...old};delete next[trackingNo];return next;});
      setMessage(trackingNo+' — consignee name saved.');
    }catch(e){setMessage(trackingNo+' — '+(e.message||'Save failed'));}
    finally{setRowSaving('');}
  }
  function updateBatchItem(index,changes){
    setBatchItems(old=>old.map((x,i)=>index===i?{...x,...changes}:x));
  }
  async function saveBatchED(ed){
    const resp=await fetch(API,{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({action:'manual-save',trackingNo:ed})});
    const data=await resp.json().catch(()=>({}));
    if(!resp.ok||!data.ok)throw Error(data.error||'Could not save parcel');
    if(data.row)setRows(old=>[data.row,...old.filter(x=>x.trackingNo!==ed)]);
    return data;
  }
  async function saveReviewedBatch(index,item){
    if(batchRunning||reviewBusy)return;
    const ed=normalizeED(item.ed||'');
    if(!ed){updateBatchItem(index,{status:'review',error:'Enter the correct ED + 9 digits + IN.'});return;}
    setReviewBusy(true);
    updateBatchItem(index,{status:'saving',error:''});
    try{
      const data=await saveBatchED(ed);
      if(data.row)setRows(old=>[data.row,...old.filter(r=>r.trackingNo!==ed)]);
      updateBatchItem(index,{status:'saved',ed,
        error:'ED saved. Enter consignee name in the table row below.'});
    }catch(e){updateBatchItem(index,{status:'review',error:e.message||'Unable to save this ED'});}
    finally{setReviewBusy(false);}
  }
  async function uploadBatch(files){
    const queue=files.map((f,i)=>({index:i,name:f.name,status:'queued',ed:'',
      candidates:[],consigneeName:'',consigneeAddress:'',error:''}));
    setBatchItems(queue);
    setBatchRunning(true);
    setPhotoEdNeedsEntry(false);
    setPhotoHasBeenRead(false);
    setPhotoRecipientConfidence('unreadable');
    setOcrCandidates([]);
    setPhotoRecipient({consigneeName:'',consigneeAddress:''});
    setMessage('Reading ED numbers in '+files.length+' photos. Consignee name will be entered manually.');
    let next=0;
    const work=async()=>{
      while(next<files.length){
        const i=next++;
        const file=files[i];
        if(file.size>8*1024*1024||file.size<20){
          updateBatchItem(i,{status:'error',error:'Each photo must be 20 bytes to 8 MB.'});
          continue;
        }
        updateBatchItem(i,{status:'reading'});
        try{
          const barcode=await readEDBarcode(file);
          if(barcode){
            const resp=await fetch(API,{method:'POST',headers:{'content-type':'application/json'},
              body:JSON.stringify({action:'manual-save',trackingNo:barcode})});
            const saved=await resp.json();
            if(!resp.ok||!saved.ok)throw Error(saved.error||'Could not save barcode ED');
            if(saved.row)setRows(old=>[saved.row,...old.filter(x=>x.trackingNo!==barcode)]);
            updateBatchItem(i,{ed:barcode,status:'saved',
              error:'Barcode read and saved. Enter consignee name in its table row.'});
            continue;
          }
          const form=new FormData();form.append('photo',file);form.append('edOnly','1');
          const controller=new AbortController();
          const timer=setTimeout(()=>controller.abort(),68000);
          let resp;
          try{resp=await fetch('/api/speedpost/ocr',{method:'POST',body:form,signal:controller.signal});}
          finally{clearTimeout(timer);}
          const data=await resp.json().catch(()=>({}));
          if(!resp.ok||!data.ok)throw Error(data.error||'OCR unavailable');
          const candidates=Array.isArray(data.candidates)?data.candidates.filter(c=>normalizeED(c.number)):[];
          // Never prefill an ED that fails its UPU checksum. Keep uncertain
          // OCR candidates visible for review, but not as a tracking number.
          const ed=candidates.find(candidate=>candidate.checkDigitValid===true)?.number||'';
          const certain=candidates.length===1&&candidates[0].checkDigitValid===true;
          updateBatchItem(i,{ed,candidates,consigneeName:'',consigneeAddress:'',
            status:certain?'saving':'review',
            error:certain?'':'ED number missing or ambiguous. Review before saving.'});
          if(!certain)continue;
          const saved=await saveBatchED(ed);
          if(saved.row)setRows(old=>[saved.row,...old.filter(r=>r.trackingNo!==ed)]);
          updateBatchItem(i,{status:'saved',
            error:'ED saved. Enter consignee name manually in the table row.'});
          // Deliberately avoid a third-party tracking fetch inside this batch:
          // the ED + TO fields are saved first and tracking can be refreshed.
        }catch(e){
          updateBatchItem(i,{status:'error',error:e.message||'Photo could not be processed'});
        }
      }
    };
    try{await Promise.all(Array.from({length:Math.min(PARALLEL_BATCH_OCR,files.length)},()=>work()));}
    finally{
      setBatchRunning(false);
      setMessage('Bulk photo processing finished. Review any unclear EDs below; use individual REFRESH for live tracking.');
    }
  }
  async function uploadImage(event){
    const files=Array.from(event.target.files||[]);
    if(fileRef.current)fileRef.current.value='';
    if(!files.length)return;
    if(files.length>MAX_BATCH_PHOTOS){
      setMessage('Select at most '+MAX_BATCH_PHOTOS+' photos per upload.');
      return;
    }
    if(files.length>1){await uploadBatch(files);return;}
    setBatchItems([]);
    const file=files[0];
    setImageName(file.name);
    setMessage('');
    setOcrCandidates([]);
    setPhotoRecipient({consigneeName:'',consigneeAddress:''});
    setPhotoEdNeedsEntry(false);
    setPhotoHasBeenRead(false);
    setPhotoRecipientConfidence('unreadable');
    if(file.size>8*1024*1024){setMessage('Please upload a photo below 8 MB.');return;}
    setOcrBusy(true);
    setOcrProgress('Scanning ED barcode, then OCR if necessary…');
    try{
      const barcode=await readEDBarcode(file);
      if(barcode){
        setTrackingNo(barcode);
        setOcrProgress('Verified ED barcode: '+barcode);
        await trackOne(barcode,'manual-save',{});
        setMessage(barcode+' — ED barcode saved. Fill consignee name in this ED row.');
        return;
      }
      const form=new FormData();
      form.append('photo',file);
      form.append('edOnly','1');
      const controller=new AbortController();
      const timer=setTimeout(()=>controller.abort(),68000);
      let response;
      try{response=await fetch('/api/speedpost/ocr',{method:'POST',body:form,signal:controller.signal});}
      finally{clearTimeout(timer);}
      const data=await response.json().catch(()=>({}));
      if(!response.ok||!data.ok)throw new Error(data.error||'OCR reading is temporarily unavailable.');
      const candidates=Array.isArray(data.candidates)?data.candidates.filter(x=>normalizeED(x.number)):[];
      if(!candidates.length){
        setPhotoEdNeedsEntry(true);
        setTrackingNo('');
        setMessage('ED number could not be read. Please enter the printed ED number manually.');
        return;
      }
      setOcrCandidates(candidates);
      const verifiedCandidates=candidates.filter(candidate=>candidate.checkDigitValid===true);
      setPhotoEdNeedsEntry(verifiedCandidates.length===0);
      // OCR 2 and 5 look alike; an invalid ED is NEVER inserted into the
      // tracking input or silently saved. User can read the printed barcode.
      setTrackingNo(verifiedCandidates[0]?.number||'');
      if(candidates.length===1&&verifiedCandidates.length===1){
        setOcrProgress('ED found: '+candidates[0].number);
        await trackOne(candidates[0].number,'manual-save',{});
        setOcrCandidates([]);
        setMessage(candidates[0].number+' saved. Enter consignee name in its row.');
      }else{
        setMessage(verifiedCandidates.length?'Multiple ED readings found. Confirm the correct barcode number before saving.':'OCR found no checksum-valid ED. The suggested number may be wrong (for example 2 read as 5). Read and enter the printed ED number before saving.');
      }
    }catch(e){
      setMessage(e?.name==='AbortError'
        ?'Photo reading took too long. The scan has stopped; you can retry without refreshing the entire Mayavi dashboard.'
        :'EMS receipt OCR: '+(e.message||'Could not read the photo.')+' You may enter the ED number manually.');
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
  const anythingBusy=Boolean(busy||ocrBusy||batchRunning);
  // The database's immutable createdAt, converted to IST, defines the daily
  // page and monthly ledger. A later Delivered status doesn't change this date.
  const activeRows=rows.filter(r=>!isDelivered(r));
  const deliveredRows=rows.filter(isDelivered);
  const entryDays=speedPostGroupByEntryDay(rows);
  const entryMonths=speedPostGroupByEntryMonth(rows);
  const effectiveDay=selectedEntryDay==='LATEST'?entryDays[0]?.[0]||'':selectedEntryDay;
  const effectiveMonth=selectedEntryMonth==='LATEST'?entryMonths[0]?.[0]||'':selectedEntryMonth;
  const dayRows=entryDays.find(([day])=>day===effectiveDay)?.[1]||[];
  const monthRows=entryMonths.find(([month])=>month===effectiveMonth)?.[1]||[];
  const pageRows=speedPostTab==='DELIVERED'?deliveredRows:
    speedPostTab==='MONTHLY'?monthRows:dayRows;
  const pageLabel=speedPostTab==='DELIVERED'?'Delivered (All Dates)':
    speedPostTab==='MONTHLY'?'Monthly Entry Records '+effectiveMonth:
    'Entry Date '+effectiveDay;
  const duplicateRows=rows.filter(r=>r.duplicateAlert===true);
  const bookingPendingRows=rows.filter(r=>!String(r.bookingDate||'').trim());
  const actualStatuses=[...new Set(pageRows.map(r=>String(r.status||'Pending Tracking').trim()||'Pending Tracking'))].sort();
  // Status filters and downloads never leak records from another daily page.
  const displayedRows=(exportStatus==='SHEET'||exportStatus==='ALL'?pageRows:
    pageRows.filter(r=>exportStatus.startsWith('EXACT:')?
      String(r.status||'Pending Tracking').trim()===exportStatus.slice(6):
      statusBucket(r)===exportStatus))
    .slice().sort((a,b)=>(Date.parse(a.createdAt||0)||0)-(Date.parse(b.createdAt||0)||0));
  const downloadRows=displayedRows;
  const countStatus=value=>pageRows.filter(r=>statusBucket(r)===value).length;
  const filterLabel=exportStatus==='SHEET'||exportStatus==='ALL'?pageLabel:
    pageLabel+' '+(exportStatus.startsWith('EXACT:')?exportStatus.slice(6):
      ({DISPATCHED:'Dispatched',PENDING:'Pending Tracking',DELIVERED:'Delivered',
        IN_TRANSIT:'In Transit',OTHER:'Other Statuses'})[exportStatus]||exportStatus);
  const reportOptions={tariffOf:postalCost,cashOf:cashCost};
  const reportTotals=speedPostCostSummary(pageRows,reportOptions);
  const monthlyTotals=speedPostCostSummary(monthRows,reportOptions);
  const filteredTotals=speedPostCostSummary(displayedRows,reportOptions);
  const allTotals=speedPostCostSummary(rows,reportOptions);
  const monthDayGroups=speedPostGroupByEntryDay(monthRows);
  const currency=n=>rupeePerKg.format(n);
  function downloadStatusFile(format){
    if(!downloadRows.length){
      setMessage('No Speed Post packets match the selected status.');
      return;
    }
    try{
      const headers=['ED No.','Consignee Name','Destination','Entry Date','Booking Date','Status',
        'Delivered Date/Time','Origin','Actual Weight','Rounded Weight (kg)',
        'Tariff (INR)','Cash Cost (INR)','Total Cost (INR)',
        'Cost per kg (INR)','Tracking Address','Entered By'];
      const excelRows=downloadRows.map(r=>{
        const tariff=postalCost(r),cash=cashCost(r),cost=costPerKg(r),rounded=billedWeightKg(r.weight);
        return [r.trackingNo||'',r.consigneeName||'',destinationWithCountry(r),formatEntryDate(r.createdAt),
          r.bookingDate||'',r.status||'Pending Tracking',r.deliveredAtText||'',shortOrigin(r.origin),
          r.weight||'',rounded===null?'':rounded,tariff===null?'':tariff,cash===null?'':cash,
          tariff===null||cash===null?'':tariff+cash,
          cost===null?'':Number(cost.toFixed(2)),r.address||'',r.enteredBy||''];
      });
      const exportWeight=weightSummary(downloadRows);
      excelRows.push(['TOTAL '+downloadRows.length+' ENTRIES','','','','','',
        '','',Number(exportWeight.totalKg.toFixed(4)),exportWeight.totalRoundedKg,
        filteredTotals.tariff,filteredTotals.cash,filteredTotals.combined,
        averageCostPerKg===null?'':Number(averageCostPerKg.toFixed(2)),'','']);
      const pdfRows=downloadRows.map(r=>{
        const tariff=postalCost(r),cash=cashCost(r);
        return [r.trackingNo||'',r.consigneeName||'',formatEntryDate(r.createdAt),
          destinationWithCountry(r)||'—',r.status||'Pending Tracking',r.weight||'—',
          tariff===null?'—':String(tariff),cash===null?'—':String(cash),
          tariff===null||cash===null?'—':String(tariff+cash),
          r.deliveredAtText||'—'];
      });
      const label=filterLabel;
      const data=format==='pdf'?createSpeedPostPdf(pdfRows,label,filteredTotals):
        createSpeedPostXlsx(headers,excelRows);
      const ext=format==='pdf'?'pdf':'xlsx';
      const mime=format==='pdf'?'application/pdf':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      const url=URL.createObjectURL(new Blob([data],{type:mime}));
      const anchor=document.createElement('a');
      const date=nowISTDate();
      anchor.href=url;anchor.download='Mayavi_EMS_'+label.replace(/[^a-z0-9]+/gi,'_')+
        '_'+date+'.'+ext;
      document.body.appendChild(anchor);anchor.click();anchor.remove();
      setTimeout(()=>URL.revokeObjectURL(url),15000);
      setMessage(format.toUpperCase()+' downloaded: '+downloadRows.length+' parcels ('+label+').');
    }catch(error){setMessage('Download failed: '+(error?.message||'Unknown error'));}
  }

  const downloadPendingBookingPdf=()=>{
    if(!bookingPendingRows.length){
      setMessage('All recorded Speed Post EDs have a Booking Date.');
      return;
    }
    try{
      // Generate offline in the logged-in user's browser, without uploading
      // consignee names or stored tracking details to any new service.
      const pdf=createBookingPendingPdf(bookingPendingRows.map(r=>({
        trackingNo:r.trackingNo,
        consigneeName:r.consigneeName||'Not entered',
        entryDate:formatEntryDate(r.createdAt),
        enteredBy:r.enteredBy||'Not available',
        status:r.status||'Pending Tracking',
        weight:r.weight||'Not available',
        destination:destinationWithCountry(r)||'Not available'
      })));
      const url=URL.createObjectURL(new Blob([pdf],{type:'application/pdf'}));
      const link=document.createElement('a');
      link.href=url;
      const istDate=new Intl.DateTimeFormat('en-CA',{
        timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'
      }).format(new Date()).replace(/\//g,'-');
      link.download='Mayavi_SpeedPost_Booking_Not_Verified_'+istDate+'.pdf';
      document.body.appendChild(link);
      link.click();
      link.remove();
      // Delay revocation so mobile browsers can finish downloading the PDF.
      setTimeout(()=>URL.revokeObjectURL(url),15000);
      setMessage('PDF downloaded: '+bookingPendingRows.length+' ED entries without a verified Booking Date.');
    }catch(error){
      setMessage('PDF creation failed: '+(error?.message||'Unknown error'));
    }
  };
  const summary=weightSummary(displayedRows);
  const ratedRows=displayedRows.map(speedPostProfitRow).filter(r=>r.totalCost!==null);
  const ratedWeight=ratedRows.reduce((sum,r)=>sum+r.roundedWeight,0);
  const averageCostPerKg=ratedWeight>0?ratedRows.reduce((sum,r)=>sum+r.totalCost,0)/ratedWeight:null;
  return <main style={{padding:'8px min(2vw,16px) 18px',background:'#f4f7fc',minHeight:'70vh'}}>
    <style>{`
      @keyframes speedPostDuplicateBlink{
        0%,100%{background-color:#fff0ed;box-shadow:inset 0 0 0 1px #fecaca}
        50%{background-color:#ffaaaa;box-shadow:inset 0 0 0 2px #b91c1c}
      }
      .sp-duplicate-alert,.sp-duplicate-row{animation:speedPostDuplicateBlink 1.3s linear infinite}
      .sp-freeze-0,.sp-freeze-1,.sp-freeze-2,.sp-freeze-3,.sp-freeze-4{
        position:sticky;box-sizing:border-box;background:#fff;z-index:3
      }
      thead .sp-freeze-0,thead .sp-freeze-1,thead .sp-freeze-2,thead .sp-freeze-3,thead .sp-freeze-4{
        background:#f5f8fe;z-index:5
      }
      /* Exact sum of each fixed width equals the next column's left offset. */
      .sp-freeze-0{left:0;width:39px;min-width:39px;max-width:39px}
      .sp-freeze-1{left:39px;width:133px;min-width:133px;max-width:133px}
      .sp-freeze-2{left:172px;width:187px;min-width:187px;max-width:187px}
      .sp-freeze-3{left:359px;width:95px;min-width:95px;max-width:95px}
      .sp-freeze-4{left:454px;width:150px;min-width:150px;max-width:150px;border-right:1px solid rgba(148,163,184,.18);box-shadow:1px 0 3px rgba(30,50,80,.035)}
      .sp-duplicate-row .sp-freeze-0,.sp-duplicate-row .sp-freeze-1,.sp-duplicate-row .sp-freeze-2,
      .sp-duplicate-row .sp-freeze-3,.sp-duplicate-row .sp-freeze-4{
        animation:speedPostDuplicateBlink 1.3s linear infinite
      }
      @media (prefers-reduced-motion:reduce){
        .sp-duplicate-alert,.sp-duplicate-row{animation:none;background-color:#fee2e2;outline:2px solid #b91c1c}
      }
    `}</style>
    <section style={{...card,padding:'6px 10px',borderRadius:8,background:'linear-gradient(110deg,#173f91,#2a63c7)',color:'#fff',marginBottom:8}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,flexWrap:'wrap'}}>
        <h1 style={{margin:0,fontSize:17}}>Speed Post • EMS Tracking</h1>
        <span style={{fontSize:11}}>PRIVATE • Admin / Sonu</span>
      </div>
    </section>
    <div role="tablist" aria-label="Speed Post sections" style={{display:'flex',flexWrap:'wrap',gap:6,marginBottom:8}}>
      <button type="button" role="tab" aria-selected={speedPostTab==='TRACKING'} onClick={()=>{setSpeedPostTab('TRACKING');setExportStatus('SHEET');}}
        style={{...btn,padding:'7px 10px',fontSize:11,background:speedPostTab==='TRACKING'?'#2258ce':'#fff',color:speedPostTab==='TRACKING'?'#fff':'#1e40af',border:'1px solid #cbd8ef'}}>
        DAILY ENTRY PAGES
      </button>
      <button type="button" role="tab" aria-selected={speedPostTab==='DELIVERED'} onClick={()=>{setSpeedPostTab('DELIVERED');setExportStatus('SHEET');}}
        style={{...btn,padding:'7px 10px',fontSize:11,background:speedPostTab==='DELIVERED'?'#2258ce':'#fff',color:speedPostTab==='DELIVERED'?'#fff':'#1e40af',border:'1px solid #cbd8ef'}}>
        DELIVERED ({deliveredRows.length})
      </button>
      <button type="button" role="tab" aria-selected={speedPostTab==='MONTHLY'} onClick={()=>{setSpeedPostTab('MONTHLY');setExportStatus('SHEET');}}
        style={{...btn,padding:'7px 10px',fontSize:11,background:speedPostTab==='MONTHLY'?'#2258ce':'#fff',color:speedPostTab==='MONTHLY'?'#fff':'#1e40af',border:'1px solid #cbd8ef'}}>
        MONTHLY RECORDS
      </button>
      {canViewProfit&&<button type="button" role="tab" aria-selected={speedPostTab==='PROFIT'}
        onClick={()=>{setSpeedPostTab('PROFIT');setExportStatus('SHEET');}}
        style={{...btn,padding:'7px 10px',fontSize:11,background:speedPostTab==='PROFIT'?'#2258ce':'#fff',
          color:speedPostTab==='PROFIT'?'#fff':'#1e40af',border:'1px solid #cbd8ef'}}>
        MONTHLY PROFIT & COSTING
      </button>}
    </div>
    {canViewProfit&&speedPostTab==='PROFIT'&&<SpeedPostMonthlyProfit
      rows={monthRows} month={effectiveMonth} entryMonths={entryMonths}
      onSelectMonth={setSelectedEntryMonth} historyIncomplete={historyIncomplete}/>}
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
    {(speedPostTab==='TRACKING'||speedPostTab==='DELIVERED'||speedPostTab==='MONTHLY')&&<>
    {speedPostTab==='TRACKING'&&<section aria-label="Add Speed Post ED" style={{...card,padding:'8px 10px',borderRadius:9,marginBottom:8}}>
      <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
        <label htmlFor="spPhotoInput" style={{fontSize:12,fontWeight:800,color:'#163c80',whiteSpace:'nowrap'}}>Scan photo</label>
        <input id="spPhotoInput" ref={fileRef} type="file" accept="image/*" multiple onChange={uploadImage}
          disabled={anythingBusy} title="Upload one or up to 20 ED barcode photos"
          style={{fontSize:11,flex:'1 1 210px',minWidth:155,maxWidth:360}}/>
        <span style={{fontSize:11,color:'#64748b',whiteSpace:'nowrap'}}>or</span>
        <form onSubmit={e=>{e.preventDefault();trackOne(trackingNo,'manual-save',{});}}
          style={{display:'flex',alignItems:'center',gap:6,flex:'2 1 300px',minWidth:210}}>
          <label htmlFor="speedPostManualED" style={{fontSize:12,fontWeight:800,color:'#163c80',whiteSpace:'nowrap'}}>ED No.</label>
          <input id="speedPostManualED" style={{...input,height:34,minWidth:95,flex:1,textTransform:'uppercase',padding:'5px 8px',fontSize:12}}
            maxLength={18} value={trackingNo} onChange={e=>setTrackingNo(e.target.value.toUpperCase())}
            placeholder="ED977952461IN"/>
          <button type="submit" style={{...btn,padding:'8px 10px',fontSize:11,whiteSpace:'nowrap',opacity:anythingBusy?.6:1}}
            disabled={anythingBusy}>{anythingBusy?'WORKING…':'SAVE & TRACK'}</button>
        </form>
      </div>
      {(imageName||ocrBusy||batchItems.length>0)&&<div role="status" style={{fontSize:11,marginTop:5,color:'#305994'}}>
        {ocrBusy?ocrProgress||'Scanning ED…':batchItems.length?('Photos: '+batchItems.filter(x=>['saved','review','error'].includes(x.status)).length+'/'+batchItems.length+' checked'):imageName?'Last photo: '+imageName:''}
      </div>}
      {ocrCandidates.length>0&&<div style={{border:'1px solid #bfd3ef',borderRadius:7,padding:7,marginTop:6,background:'#f4f8ff'}}>
        <span style={{fontSize:11,fontWeight:700}}>Confirm the printed ED number:</span>
        <div style={{display:'flex',flexWrap:'wrap',gap:8,marginTop:4}}>
          {ocrCandidates.map(c=><label key={c.number} style={{display:'inline-flex',alignItems:'center',gap:4,fontSize:11}}>
            <input type="radio" name="speedpost-ocr-choice" checked={trackingNo===c.number} onChange={()=>setTrackingNo(c.number)}/>
            {c.number}{c.checkDigitValid?' ✓':' (verify)'}
          </label>)}
          <button type="button" style={{...btn,padding:'5px 8px',fontSize:11}} disabled={anythingBusy}
            onClick={async()=>{const n=normalizeED(trackingNo);if(n){setOcrCandidates([]);await trackOne(n,'manual-save',{})}}}>
            SAVE ED
          </button>
        </div>
      </div>}
    </section>}
    {batchItems.length>0&&<section style={{...card,marginBottom:14}}>
      <div style={{display:'flex',flexWrap:'wrap',justifyContent:'space-between',gap:10,marginBottom:12}}>
        <h2 style={{fontSize:17,margin:0}}>Multiple EMS photos ({batchItems.length})</h2>
        <strong style={{fontSize:12,color:batchRunning?'#1d4ed8':'#166534'}}>
          {batchRunning?'OCR PROCESSING — KEEP PAGE OPEN':'BATCH FINISHED'}
        </strong>
      </div>
      <div style={{maxHeight:470,overflowY:'auto',display:'grid',gap:8}}>
        {batchItems.map((item,i)=><div key={item.index} style={{background:'#f8faff',border:'1px solid #d9e3f3',borderRadius:8,padding:10}}>
          <div style={{display:'flex',justifyContent:'space-between',gap:8,flexWrap:'wrap'}}>
            <strong style={{fontSize:12,overflowWrap:'anywhere'}}>{i+1}. {item.name}</strong>
            <strong style={{fontSize:11,color:item.status==='error'?'#b91c1c':item.status==='saved'?'#15803d':'#1d4ed8'}}>
              {item.status==='queued'?'WAITING':item.status==='reading'?'READING ED':item.status==='saving'?'SAVING':item.status==='saved'?'SAVED':item.status==='duplicate'?'DUPLICATE ED':item.status==='review'?'ED REVIEW':'ERROR'}
            </strong>
          </div>
          {item.ed&&<div style={{fontSize:12,marginTop:5}}>ED: <strong>{item.ed}</strong></div>}
          {item.consigneeName&&<div style={{fontSize:12}}>Consignee: {item.consigneeName}</div>}
          
          {item.error&&<div style={{fontSize:11,color:item.status==='error'?'#b91c1c':'#92400e',marginTop:6}}>{item.error}</div>}
          {item.status==='review'&&<div style={{marginTop:8}}>
            <label style={{fontSize:11,display:'block',marginBottom:5}}>Verify ED number on photo #{i+1}</label>
            <input style={{...input,marginBottom:7}} maxLength={18}
              value={item.ed||''} onChange={e=>updateBatchItem(i,{ed:e.target.value.toUpperCase()})}
              placeholder="ED + 9 digits + IN"/>
            {item.candidates.length>1&&<div style={{display:'flex',flexWrap:'wrap',gap:5,marginBottom:7}}>
              {item.candidates.map(c=><button type="button" key={c.number}
                onClick={()=>updateBatchItem(i,{ed:c.number})}
                style={{...btn,padding:'5px 7px',fontSize:11,background:'#e4edfa',color:'#1e40af'}}>{c.number}</button>)}
            </div>}
            <button type="button" style={{...btn,fontSize:11,padding:'7px 10px'}}
              disabled={batchRunning||reviewBusy||!normalizeED(item.ed)}
              onClick={()=>saveReviewedBatch(i,item)}>SAVE VERIFIED ED</button>
          </div>}
        </div>)}
      </div>
      <div style={{fontSize:11,color:'#64748b',marginTop:10}}>Scanned EDs are saved individually. Enter only the consignee name manually in each row. Uncertain OCR numbers require confirmation.</div>
    </section>}
    {(message||loadError)&&<div role="status" style={{...card,marginBottom:14,color:loadError?'#a52a2a':'#1e40af',fontSize:13}}>{loadError||message}</div>}
    {speedPostTab==='TRACKING'&&<section aria-label="Entry date pages" style={{...card,marginBottom:10,padding:12}}>
      <div style={{display:'flex',flexWrap:'wrap',alignItems:'center',gap:9}}>
        <strong style={{fontSize:13,color:'#163c80'}}>ENTRY DATE • DAILY PAGE</strong>
        <select aria-label="Choose entry date page" value={effectiveDay} onChange={e=>{setSelectedEntryDay(e.target.value);setExportStatus('SHEET');}}
          style={{...input,width:'auto',minWidth:180,height:35,fontWeight:700}}>
          {entryDays.length?entryDays.map(([day,items])=><option key={day} value={day}>{day==='UNKNOWN'?'Date unavailable':day} • {items.length} entries</option>):<option value="">No entries yet</option>}
        </select>
        <span style={{fontSize:12,color:'#475569'}}>Original Entry Date used. Previously entered packets only; no re-entry required.</span>
      </div>
      <div style={{display:'flex',gap:5,flexWrap:'wrap',marginTop:9}}>
        {entryDays.slice(0,7).map(([day,items])=><button type="button" key={day}
          onClick={()=>{setSelectedEntryDay(day);setExportStatus('SHEET');}}
          style={{...btn,padding:'6px 9px',fontSize:11,
            background:effectiveDay===day?'#2258ce':'#eef4ff',color:effectiveDay===day?'#fff':'#1e40af'}}>
          {day} ({items.length})
        </button>)}
      </div>
    </section>}
    {speedPostTab==='MONTHLY'&&<section aria-label="Monthly entry records" style={{...card,marginBottom:10,padding:12}}>
      <div style={{display:'flex',flexWrap:'wrap',alignItems:'center',gap:10}}>
        <strong style={{color:'#173f91',fontSize:13}}>ENTRY-WISE MONTHLY RECORDS</strong>
        <select aria-label="Select entry month" value={effectiveMonth} onChange={e=>{setSelectedEntryMonth(e.target.value);setExportStatus('SHEET');}}
          style={{...input,width:'auto',height:35,minWidth:180,fontWeight:700}}>
          {entryMonths.length?entryMonths.map(([month,items])=><option key={month} value={month}>{month==='UNKNOWN'?'Date unavailable':month} • {items.length} entries</option>):<option value="">No entries yet</option>}
        </select>
        <span style={{fontSize:12,color:'#475569'}}>Delivery updates do not change the original Entry Date.</span>
      </div>
      <h3 style={{fontSize:13,margin:'14px 0 7px'}}>Entry-day breakdown • {effectiveMonth}</h3>
      <div style={{overflowX:'auto'}}>
        <table style={{borderCollapse:'collapse',width:'100%',minWidth:680,fontSize:12}}>
          <thead><tr>{['Entry Date','Packets','Tariff Total','Cash Cost Total','Combined Total'].map(label=><th style={th} key={label}>{label}</th>)}</tr></thead>
          <tbody>{monthDayGroups.map(([day,items])=>{const t=speedPostCostSummary(items,reportOptions);return <tr key={day}>
            <td style={td}>{day}</td><td style={td}>{t.packets}</td>
            <td style={td}>{currency(t.tariff)}</td><td style={td}>{currency(t.cash)}</td>
            <td style={{...td,fontWeight:700}}>{currency(t.combined)}</td>
          </tr>})}</tbody>
          <tfoot><tr style={{background:'#eaf2ff',fontWeight:900}}><td style={td}>MONTH TOTAL</td><td style={td}>{monthlyTotals.packets}</td><td style={td}>{currency(monthlyTotals.tariff)}</td><td style={td}>{currency(monthlyTotals.cash)}</td><td style={td}>{currency(monthlyTotals.combined)}</td></tr></tfoot>
        </table>
      </div>
    </section>}
    {speedPostTab==='DELIVERED'&&<p style={{fontSize:12,color:'#475569',margin:'0 0 10px'}}>All delivered ED packets are compiled in this single sheet across every Entry Date and month.</p>}
    <section style={{...card,padding:12,marginBottom:10}}>
      <h3 style={{margin:'0 0 8px',fontSize:14,color:'#163c80'}}>{pageLabel} • Financial Totals</h3>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))',gap:8}}>
        {[
          ['Entries',String(reportTotals.packets)],
          ['Tariff Total',currency(reportTotals.tariff)],
          ['Cash Cost Total',currency(reportTotals.cash)],
          ['Combined Total',currency(reportTotals.combined)]
        ].map(([name,value])=><div key={name} style={{background:'#f1f5fd',borderRadius:8,padding:'9px 10px'}}>
          <div style={{fontSize:11,color:'#475569'}}>{name}</div>
          <strong style={{fontSize:16,color:'#173f91'}}>{value}</strong>
        </div>)}
      </div>
      <p style={{fontSize:11,color:'#64748b',margin:'9px 0 0'}}>
        Missing Tariff: {reportTotals.tariffMissing} • Missing Cash Cost: {reportTotals.cashMissing} •
        Both available: {reportTotals.completePackets}. Combined Total adds available Tariff and Cash Cost amounts.
        Per-entry Total Cost stays blank until both amounts exist.
      </p>
    </section>
    <section style={card}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:10,marginBottom:12}}>
        <div><h2 style={{fontSize:18,margin:'0 0 4px'}}>{exportStatus==='SHEET'?pageLabel+' • Entry-wise Sheet':'EMS — '+filterLabel}</h2>
          <span style={{color:'#64748b',fontSize:12}}>{displayedRows.length} matching packets • {rows.length} saved records loaded • {currentUser?.displayName||'Private access'}</span>
        </div>
        <button type="button" style={{...btn,background:'#e7eefb',color:'#224f9b',padding:'8px 10px'}} onClick={load} disabled={anythingBusy}>RELOAD RECORDS</button>
      </div>
      <div style={{display:'flex',alignItems:'center',flexWrap:'wrap',gap:10,background:'#eef4ff',border:'2px solid #afc7f1',borderRadius:10,padding:'12px',marginBottom:12}}>
        <label htmlFor="emsStatusFilter" style={{fontSize:13,fontWeight:900,color:'#173f91'}}>FILTER EMS STATUS</label>
        <select id="emsStatusFilter" aria-label="Filter EMS sheet and download by shipment status"
          value={exportStatus} onChange={e=>setExportStatus(e.target.value)}
          style={{...input,flex:'1 1 260px',width:'auto',maxWidth:390,fontSize:13,fontWeight:700,border:'2px solid #719ce0'}}>
          <option value="SHEET">Current Page • All Statuses ({pageRows.length})</option>
          <option value="ALL">All Statuses On This Page ({pageRows.length})</option>
          <option value="DISPATCHED">Dispatched ({countStatus('DISPATCHED')})</option>
          <option value="PENDING">Pending Tracking / Verification ({countStatus('PENDING')})</option>
          <option value="IN_TRANSIT">In Transit ({countStatus('IN_TRANSIT')})</option>
          <option value="DELIVERED">Delivered ({countStatus('DELIVERED')})</option>
          <option value="OTHER">Other Statuses ({countStatus('OTHER')})</option>
          {actualStatuses.map(st=><option key={'EXACT:'+st} value={'EXACT:'+st}>Exact: {st} ({rows.filter(r=>String(r.status||'Pending Tracking').trim()===st).length})</option>)}
        </select>
        <button type="button" style={{...btn,background:'#fff',color:'#173f91',border:'1px solid #a8bfdc',padding:'9px 11px'}}
          onClick={()=>setExportStatus('SHEET')} disabled={exportStatus==='SHEET'}>CLEAR FILTER</button>
        <strong style={{fontSize:13,color:'#173f91'}}>{displayedRows.length} PACKETS FOUND</strong>
      </div>
      <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center',marginBottom:12}}>
        <span style={{fontSize:12,fontWeight:700,color:'#475569'}}>Download filtered packets:</span>
        <button type="button" style={{...btn,padding:'8px 10px',fontSize:11}}
          disabled={!downloadRows.length} onClick={()=>downloadStatusFile('pdf')}>
          PDF ({downloadRows.length})
        </button>
        <button type="button" style={{...btn,padding:'8px 10px',fontSize:11,background:'#167046'}}
          disabled={!downloadRows.length} onClick={()=>downloadStatusFile('xlsx')}>
          EXCEL ({downloadRows.length})
        </button>
        <button type="button" title="Separate report: ED entries without a Booking Date, independent of status filter"
          style={{...btn,padding:'8px 10px',background:'#fff7ed',color:'#9a3412',border:'1px solid #fbbf24',fontSize:11}}
          disabled={!bookingPendingRows.length} onClick={downloadPendingBookingPdf}>
          BOOKING PENDING PDF ({bookingPendingRows.length})
        </button>
      </div>
      {historyIncomplete&&<p role="alert" style={{color:'#9a3412',fontWeight:700,fontSize:12}}>More than 5,000 saved EMS packets exist. This screen shows the newest 5,000; contact the administrator for a full archive.</p>}
      <div style={{overflowX:'auto'}}>
        <table style={{borderCollapse:'separate',borderSpacing:0,width:'100%',minWidth:2600}}>
          <thead><tr>{[
            'S.No.','Tracking No.','Consignee Name','Entry Date','Destination',
            'Booking Date','Tracking Address','Tariff (INR)','Cash Cost (₹)',
            'Total Cost (₹)','Cost per kg (₹)','Status',
            'Origin','Weight','Rounded Weight (kg)','Last Updated','Actions'
          ].map((label,index)=><th key={label} className={index<5?'sp-freeze-'+index:undefined}
            style={{...th,...(index<5?{padding:'8px 4px'}:{})}}>{index===3?
              <><span style={{display:'block'}}>Entry Date</span><small style={{display:'block',fontSize:10,fontWeight:600,marginTop:2}}>Entered By</small></>
              :label}</th>)}</tr></thead>
          <tbody>{displayedRows.length?displayedRows.map((r,i)=><tr key={r.trackingNo} className={r.duplicateAlert===true?'sp-duplicate-row':undefined}>
            <td className="sp-freeze-0" style={{...td,padding:'7px 4px'}}>{i+1}</td>
            <td className="sp-freeze-1" style={{...td,padding:'7px 4px'}}><strong>{r.trackingNo}</strong>
              {r.duplicateAlert===true&&<strong style={{display:'block',fontSize:10,color:'#991b1b'}}>DUPLICATE{Number(r.duplicateCount)>0?' ×'+r.duplicateCount:''}</strong>}
            </td>
            <td className="sp-freeze-2" style={{...td,padding:'6px 3px'}}>
              <div style={{display:'flex',alignItems:'center',gap:3}}>
                <input aria-label={'Consignee Name for '+r.trackingNo} maxLength={100}
                  style={{...input,height:30,minWidth:0,flex:1,padding:'4px 4px',fontSize:11}}
                  value={draftFor(r,'consigneeName')} placeholder="Consignee Name"
                  onChange={e=>changeRowDraft(r.trackingNo,'consigneeName',e.target.value)}/>
                {(!String(r.consigneeName||'').trim()||
                  draftFor(r,'consigneeName')!==String(r.consigneeName||''))&&
                  <button type="button" title="Save consignee name" style={{...btn,padding:'7px 5px',fontSize:10}}
                    disabled={Boolean(rowSaving||anythingBusy)||
                      draftFor(r,'consigneeName')===String(r.consigneeName||'')}
                    onClick={()=>saveConsigneeRow(r)}>{rowSaving===r.trackingNo?'…':'SAVE'}</button>}
              </div>
            </td>
            <td className="sp-freeze-3" style={{...td,padding:'7px 4px'}}>
              <span style={{display:'block'}}>{formatEntryDate(r.createdAt)}</span>
              <small title={'Entered By: '+String(r.enteredBy||'—')}
                style={{display:'block',fontSize:10,color:'#475569',marginTop:3,overflowWrap:'anywhere'}}>
                By: {String(r.enteredBy||'—').trim()||'—'}
              </small>
            </td>
            <td className="sp-freeze-4" style={{...td,padding:'7px 4px',overflow:'hidden',textOverflow:'ellipsis'}}
              title={destinationWithCountry(r)}>{destinationWithCountry(r)||'—'}</td>

            <td style={td}>{field(r,'bookingDate')}</td>
            <td style={{...td,maxWidth:230,minWidth:155,whiteSpace:'normal',overflowWrap:'anywhere'}}>{field(r,'address')}</td>
            <td style={td}>{r.tariff?<span>₹{field(r,'tariff')}</span>:'—'}</td>
            <td style={{...td,fontWeight:800,color:'#166534'}}>{cashCost(r)===null?'—':rupeePerKg.format(cashCost(r))}</td>
            <td style={{...td,fontWeight:800,color:'#163c80'}}>{postalCost(r)===null||cashCost(r)===null?'—':rupeePerKg.format(postalCost(r)+cashCost(r))}</td>
            <td style={{...td,fontWeight:700}}>{costPerKg(r)===null?'—':rupeePerKg.format(costPerKg(r))+'/kg'}</td>
            <td style={td}><strong style={{color:/delivered/i.test(r.status||'')?'#15803d':/out for delivery/i.test(r.status||'')?'#1d4ed8':'#334155'}}>{formatValue(r.status)}</strong>{/^delivered$/i.test(String(r.status||''))&&<small style={{display:'block',color:'#64748b',marginTop:4}}>Date / Time: {r.deliveredAtText||'Not yet verified'}</small>}</td>
            <td style={td}>{shortOrigin(r.origin)||'—'}</td>
            <td style={td}>{field(r,'weight')}{weightInKg(r.weight)&&!/\bkg\b/i.test(String(r.weight||''))&&<small style={{display:'block',color:'#64748b'}}> {weightInKg(r.weight).toLocaleString('en-IN',{maximumFractionDigits:4})} kg</small>}</td>
            <td style={{...td,fontWeight:700}}>{billedWeightKg(r.weight)===null?'—':billedWeightKg(r.weight)+' kg'}</td>
            <td style={td}>{field(r,'lastUpdated')}<small style={{display:'block',color:'#64748b',marginTop:4}}>{r.lastChecked?'Checked '+new Date(r.lastChecked).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}):''}</small></td>
            <td style={td}><div style={{display:'flex',gap:6}}>
              <button type="button" style={{...btn,padding:'7px 9px',fontSize:11}} onClick={()=>trackOne(r.trackingNo,'refresh')} disabled={anythingBusy}>{busy===r.trackingNo?'…':'REFRESH'}</button>
              <a href="https://www.trackparcel.in/" target="_blank" rel="noreferrer" style={{...btn,padding:'8px',fontSize:11,background:'#e4edfa',color:'#1d4ed8',textDecoration:'none'}}>TRACKPARCEL ↗</a>
              {r.duplicateAlert===true&&<button type="button" style={{...btn,padding:'7px 9px',fontSize:11,background:'#fef2f2',color:'#991b1b',border:'1px solid #fecaca'}} onClick={()=>acknowledgeDuplicate(r.trackingNo)} disabled={Boolean(duplicateBusy)}>CLEAR ALERT</button>}
              <button type="button" style={{...btn,padding:'7px 9px',fontSize:11,background:'#b91c1c'}} onClick={()=>remove(r.trackingNo)} disabled={anythingBusy}>DELETE</button>
            </div></td>
          </tr>):<tr><td colSpan={17} style={{...td,textAlign:'center',padding:28,color:'#64748b'}}>{exportStatus!=='SHEET'?'No packets match this page’s status filter.':speedPostTab==='DELIVERED'?'No Delivered parcels yet.':speedPostTab==='MONTHLY'?'No entries in this month.':'No packets for this Entry Date. Select another date or add a new ED.'}</td></tr>}</tbody>
        <tfoot><tr style={{background:'#eaf2ff',fontWeight:900,color:'#153866'}}>
            <td colSpan={7} style={{...td,padding:'10px 6px'}}>TOTAL • {displayedRows.length} ENTRIES</td>
            <td style={td}>{currency(filteredTotals.tariff)}</td>
            <td style={td}>{currency(filteredTotals.cash)}</td>
            <td style={td}>{currency(filteredTotals.combined)}</td>
            <td style={td}>{averageCostPerKg===null?'—':currency(averageCostPerKg)+'/kg'}</td>
            <td colSpan={2} style={td}></td>
            <td style={td}>{summary.totalKg.toLocaleString('en-IN',{maximumFractionDigits:4})} kg</td>
            <td style={td}>{summary.totalRoundedKg.toLocaleString('en-IN')} kg</td>
            <td colSpan={2} style={td}></td>
          </tr></tfoot>
          </table>
      </div>

      <div style={{marginTop:13,padding:12,background:'#eef4ff',borderRadius:9}}>
         <strong style={{fontSize:13}}>FILTERED ENTRIES TOTAL ({displayedRows.length})</strong>
         <div style={{display:'flex',flexWrap:'wrap',gap:18,marginTop:7,fontSize:12}}>
           <span>Tariff: <b>{currency(filteredTotals.tariff)}</b></span>
           <span>Cash Cost: <b>{currency(filteredTotals.cash)}</b></span>
           <span>Combined: <b>{currency(filteredTotals.combined)}</b></span>
         </div>
       </div>
       <div style={{marginTop:14,borderTop:'1px solid #dce4ef',paddingTop:12}}>
        <h3 style={{fontSize:15,margin:'0 0 8px'}}>{exportStatus==='SHEET'?(speedPostTab==='DELIVERED'?'Delivered Sheet Weight Summary':'Current Sheet Weight Summary'):'Filtered Weight Summary'}</h3>
        <div style={{fontSize:13,fontWeight:700,marginBottom:12}}>Grand Total: {summary.packets} parcels • {summary.totalKg.toLocaleString('en-IN',{maximumFractionDigits:4})} kg actual weight • {summary.totalRoundedKg.toLocaleString('en-IN')} kg total rounded weight • {summary.packets-summary.knownWeights} missing weight</div>
        <div style={{display:'flex',flexWrap:'wrap',gap:16}}>
          {[[ 'Country-wise totals',summary.countries ]].map(([heading,groups])=>
            <div key={heading} style={{flex:'1 1 280px',minWidth:0}}>
              <h4 style={{fontSize:13,margin:'0 0 6px'}}>{heading}</h4>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                <thead><tr><th style={th}>{heading.startsWith('Country')?'Country':'Entry month'}</th><th style={th}>Parcels</th><th style={th}>Weight (kg)</th><th style={th}>Rounded Weight (kg)</th><th style={th}>Missing weight</th></tr></thead>
                <tbody>{groups.map(([name,g])=><tr key={name}><td style={td}>{name}</td><td style={td}>{g.packets}</td><td style={td}>{g.kg.toLocaleString('en-IN',{maximumFractionDigits:4})}</td><td style={td}>{g.roundedKg.toLocaleString('en-IN')}</td><td style={td}>{g.packets-g.knownWeights}</td></tr>)}</tbody>
              </table>
            </div>)}
        </div>
        <p style={{fontSize:11,color:'#64748b'}}>Actual weight and rounded billing weight are totaled separately. Each parcel's rounded weight is rounded UP to the next whole kg, matching Cash Cost. Missing weights are excluded from kg totals, not treated as zero. Country not verified is grouped as Unknown. Current and Delivered sheets are counted separately. Entry-date Monthly Records are now available, using the original date even after delivery.</p>
      </div>
      <section aria-label="All entries grand totals" style={{marginTop:15,border:'2px solid #cbd8ef',borderRadius:10,padding:12,background:'#f8faff'}}>
        <h3 style={{fontSize:15,margin:'0 0 8px',color:'#173f91'}}>ALL ENTRIES • GRAND TOTAL (Active + Delivered)</h3>
        <div style={{display:'flex',gap:14,flexWrap:'wrap',fontSize:12}}>
          <span>Packets: <strong>{allTotals.packets}</strong></span>
          <span>Tariff: <strong>{currency(allTotals.tariff)}</strong></span>
          <span>Cash Cost: <strong>{currency(allTotals.cash)}</strong></span>
          <span>Combined Total: <strong>{currency(allTotals.combined)}</strong></span>
        </div>
        <p style={{fontSize:11,margin:'7px 0 0',color:'#64748b'}}>Missing Tariff: {allTotals.tariffMissing} • Missing Cash Cost: {allTotals.cashMissing} • Both available: {allTotals.completePackets}. Every ED is counted once, including Delivered entries.</p>
      </section>
      <p style={{fontSize:11,color:'#64748b',marginBottom:0}}>Only the Consignee Name is editable and saved in the same row. ED No., Name, Entry Date and Destination stay visible while scrolling. Total Cost is Tariff + Cash Cost. Cost per kg is Total Cost ÷ Rounded Weight (kg), and no separate Tariff minus Cash column is shown. Both amounts must be available for an individual Total Cost. Cash Cost beside Weight is rounded-up whole kilograms × ₹150. Scroll horizontally to view the right-hand columns. Address, weight, origin and destination are filled only when present on an ED-matched tracking result. “Previous check” means saved historical data; missing addresses are not guessed. Refresh each packet to check its details again.</p>
    </section>
    </>}
  </main>;
}
