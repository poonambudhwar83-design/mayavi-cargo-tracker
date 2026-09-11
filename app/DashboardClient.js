'use client';
import { useEffect, useMemo, useState } from 'react';
import { airlineForMawb, CONFIGURED_PREFIXES } from '../lib/airlines.js';

const KEY='mayavi_v3_shipments';
const TWO_HOURS=2*60*60*1000;
function normalize(v=''){const d=String(v).replace(/\D/g,'');return d.length===11?`${d.slice(0,3)}-${d.slice(3)}`:''}
function digits(v=''){return String(v).replace(/\D/g,'')}
function pad(v){return String(v).padStart(2,'0')}
function cleanWeight(v=''){return String(v||'').replace(/\s*(kg|kgs|kilograms?)\s*$/i,'').trim()}
function weightForTotal(row={}){
  const direct=Number(row.totalWeight);if(Number.isFinite(direct)&&direct>0)return direct;
  const s=cleanWeight(row.weight).replace(/,/g,'').trim();if(!s)return 0;
  const parts=s.split('/').map(x=>Number(String(x).replace(/[^0-9.\-]/g,''))).filter(Number.isFinite);
  return parts.length?(parts.length>1?parts.at(-1):parts[0]):0;
}
function normalizeFlightNo(mawb='',value=''){
  const n=normalize(mawb),f=String(value||'').trim().replace(/\s+/g,'').toUpperCase();
  if(n.startsWith('065-')&&/^\d{1,4}$/.test(f))return`SV${f}`;
  return f;
}
function formatTime12(value=''){
  const s=String(value||'').trim();if(!s)return'';
  if(/\b(?:AM|PM)\b/i.test(s))return s.replace(/\b(am|pm)\b/i,m=>m.toUpperCase());
  const m=s.match(/^(\d{1,2}):([0-5]\d)$/);if(!m)return s;
  const h=Number(m[1]);if(h<0||h>23)return s;
  return `${pad(h%12||12)}:${m[2]} ${h>=12?'PM':'AM'}`;
}
function dateTimeValue(date='',time=''){
  const dm=String(date).match(/^(\d{4})-(\d{2})-(\d{2})$/),tm=String(time).match(/^(\d{1,2}):(\d{2})/);
  if(!dm||!tm)return null;
  const d=new Date(Number(dm[1]),Number(dm[2])-1,Number(dm[3]),Number(tm[1]),Number(tm[2]),0,0);
  return Number.isFinite(d.getTime())?d:null;
}
function previousDate(date=''){
  const m=String(date||'').match(/^(20\d{2})-(\d{2})-(\d{2})$/);if(!m)return false;
  const now=new Date(),today=`${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
  return String(date)<today;
}
function mailTimeFrom(date='',time=''){
  const d=dateTimeValue(date,time);if(!d)return'';
  d.setHours(d.getHours()-5);
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${formatTime12(`${pad(d.getHours())}:${pad(d.getMinutes())}`)}`;
}
function businessStatus(raw='',timingStatus='',arrivalDate='',mawb=''){
  const s=String(raw||'').toUpperCase();
  if(s.includes('PART ARRIVED'))return'PART ARRIVED';
  if(s.includes('ARRIVED')||s.includes('DELIVER')||s.includes('DESTINATION')||s.includes('LANDED')||s.includes('RCF'))return'ARRIVED';
  if(s.includes('DELAY')||s.includes('LATE'))return'DELAYED';
  if(s.includes('IN TRANSIT')||s.includes('TRANSIT')||s.includes('DEPART')||s.includes('AIRBORNE')||s.includes('IN FLIGHT')||s==='DEP')return'IN TRANSIT';
  if(timingStatus==='EARLY'||s.includes('EARLY'))return'EARLY ARRIVAL';
  if(timingStatus==='DELAYED')return'DELAYED';
  return'BOOKED';
}
function tone(status=''){
  const s=String(status).toUpperCase();
  if(s.includes('PART ARRIVED'))return'transit';
  if(s.includes('ARRIVED'))return'arrived';
  if(s.includes('TRANSIT')||s.includes('DEPART')||s.includes('AIRBORNE')||s.includes('IN FLIGHT'))return'transit';
  if(s.includes('DELAY'))return'delayed';
  if(s.includes('EARLY'))return'early';
  return'booked';
}
function decorateTiming(existing={},incoming={}){
  const merged={...existing,...incoming};
  const shipmentType=merged.shipmentType==='EXPORT'?'EXPORT':'IMPORT';
  const rowMawb=normalize(incoming.mawb||existing.mawb||existing.awb||'');
  const kuwaitDetailsOnly=rowMawb.startsWith('229-');
  const scheduledArrivalDate=kuwaitDetailsOnly?'':(incoming.scheduledArrivalDate||existing.scheduledArrivalDate||incoming.arrivalDate||existing.arrivalDate||'');
  const scheduledArrivalTime=kuwaitDetailsOnly?'':(incoming.scheduledArrivalTime||existing.scheduledArrivalTime||incoming.arrivalTime||existing.arrivalTime||'');
  const arrivalDate=kuwaitDetailsOnly?'':(incoming.arrivalDate||existing.arrivalDate||'');
  const arrivalTime=kuwaitDetailsOnly?'':(incoming.arrivalTime||existing.arrivalTime||'');
  const planned=dateTimeValue(scheduledArrivalDate,scheduledArrivalTime),current=dateTimeValue(arrivalDate,arrivalTime);
  let timingDeltaMinutes=null,timingStatus='';
  if(planned&&current){
    timingDeltaMinutes=Math.round((current-planned)/60000);
    timingStatus=timingDeltaMinutes>60?'DELAYED':timingDeltaMinutes<-60?'EARLY':'ON TIME';
  }
  const status=businessStatus(incoming.status||existing.status||'',timingStatus,arrivalDate,incoming.mawb||existing.mawb||existing.awb||'');
  const flightNo=normalizeFlightNo(rowMawb,incoming.flightNo||incoming.flight||existing.flightNo||existing.flight||'');
  const bookingDate=incoming.bookingDate||existing.bookingDate||'';
  const bookingTime=incoming.bookingTime||existing.bookingTime||'';
  const mailTime=shipmentType==='IMPORT'?mailTimeFrom(arrivalDate,arrivalTime):'';
  const mailSent=shipmentType==='IMPORT'?merged.mailSent===true:undefined;
  const customsCleared=shipmentType==='IMPORT'?merged.customsCleared===true:undefined;
  const masterCopyReceived=shipmentType==='EXPORT'?merged.masterCopyReceived===true:undefined;
  return {...merged,flightNo,bookingDate,bookingTime,destination:kuwaitDetailsOnly?'':(merged.destination||''),shipmentType,scheduledArrivalDate,scheduledArrivalTime,arrivalDate,arrivalTime,arrivalIsActual:kuwaitDetailsOnly?false:Boolean(merged.arrivalIsActual),timingDeltaMinutes,timingStatus,status,mailTime,mailSent,customsCleared,masterCopyReceived};
}
function clientStyle(name=''){
  const s=String(name||'').trim();if(!s)return{};
  let h=0;for(let i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))%360;
  return {backgroundColor:`hsl(${h} 75% 92%)`,color:`hsl(${h} 48% 28%)`,borderColor:`hsl(${h} 55% 76%)`};
}
function officialUrl(row={}){
  const n=normalize(row.mawb),airline=airlineForMawb(n);
  if(n.startsWith('514-'))return 'https://airarabia-g9.ibsplc.aero/icargoneoportal/app/main/#/app';
  return airline?.url||row.officialTracker||'';
}
function openOfficial(row={}){
  const n=normalize(row.mawb),url=officialUrl(row);if(!url)return;
  if(n.startsWith('514-')){try{navigator.clipboard?.writeText(digits(n)).catch(()=>{})}catch{}}
  window.open(url,'_blank','noopener,noreferrer');
}
function dbToRow(record={}){
  const d=record.data||{};
  return decorateTiming({}, {...d,
    mawb:normalize(d.mawb||d.awb||record.awb),clientName:d.clientName??d.client??'',
    airlineName:d.airlineName??d.airline??'',carrierCode:d.carrierCode??d.airlineCode??'',
    flightNo:d.flightNo??d.flight??'',pieces:d.pieces??d.bags??'',bags:d.bags??d.pieces??'',weight:cleanWeight(d.weight),
    bookingDate:d.bookingDate||'',shipmentType:d.shipmentType==='EXPORT'?'EXPORT':'IMPORT',officialTracker:d.officialTracker||d.sourceUrl||'',
    enteredBy:d.enteredBy||'',enteredByUsername:d.enteredByUsername||'',enteredAt:d.enteredAt||'',
    mailSent:d.shipmentType==='EXPORT'?undefined:d.mailSent===true,customsCleared:d.shipmentType==='EXPORT'?undefined:d.customsCleared===true,
    masterCopyReceived:d.shipmentType==='EXPORT'?d.masterCopyReceived===true:undefined,
    lastChecked:d.lastChecked||record.tracking_checked_at||record.updated_at||'',_dbUpdatedAt:record.updated_at||''
  });
}
function withoutMeta(row={}){const {_dbUpdatedAt,...clean}=row;return clean}
function isCustomsArchived(row={}){return row.shipmentType!=='EXPORT'&&row.mailSent===true&&row.customsCleared===true}
function isExportArchived(row={}){return row.shipmentType==='EXPORT'&&row.masterCopyReceived===true}
function isPartArrived(row={}){return String(row.status||'').toUpperCase().includes('PART ARRIVED')}
function priorityValue(row={}){
  const s=String(row.status||'').toUpperCase();
  if(s.includes('DELAY'))return 0;
  if(s.includes('PART ARRIVED')||s.includes('IN TRANSIT')||s.includes('TRANSIT')||s.includes('DEPART')||s.includes('AIRBORNE')||s.includes('IN FLIGHT'))return 1;
  return 2;
}
function sortPriority(list=[]){return [...list].sort((a,b)=>{const p=priorityValue(a)-priorityValue(b);if(p)return p;return (Date.parse(b.lastChecked||b._dbUpdatedAt||0)||0)-(Date.parse(a.lastChecked||a._dbUpdatedAt||0)||0)})}
function uniq(rows,key){return [...new Set(rows.map(r=>String(r?.[key]||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b))}

export default function DashboardClient({isAdmin=false,currentUser=null,onLogout=null}){
  const [rows,setRows]=useState([]),[mawb,setMawb]=useState(''),[client,setClient]=useState(''),[busy,setBusy]=useState(false),[note,setNote]=useState(''),[loaded,setLoaded]=useState(false),[shared,setShared]=useState(false),[activeTab,setActiveTab]=useState('IMPORT');
  const [adminView,setAdminView]=useState('ACTIVE'),[clientFilter,setClientFilter]=useState(''),[originFilter,setOriginFilter]=useState(''),[destinationFilter,setDestinationFilter]=useState('');
  const employeeName=String(currentUser?.displayName||'').trim();
  const employeeUsername=String(currentUser?.username||'').trim();
  async function persistRows(list,markEntry=false){
    const clean=list.filter(x=>normalize(x?.mawb)).map(withoutMeta);if(!clean.length)return[];
    const res=await fetch('/api/shipments',{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({rows:clean,markEntry})});
    const data=await res.json();if(!data.ok)throw new Error(data.error||'Shared database save failed.');return data.rows||[];
  }
  async function persistRow(row,markEntry=false){return persistRows([row],markEntry)}
  useEffect(()=>{
    let active=true;
    (async()=>{
      let local=[];
      try{local=JSON.parse(localStorage.getItem(KEY)||'[]').map(x=>decorateTiming({}, {...x,mawb:normalize(x?.mawb||x?.awb),shipmentType:x?.shipmentType==='EXPORT'?'EXPORT':'IMPORT'})).filter(x=>x.mawb)}catch{}
      try{
        const res=await fetch('/api/shipments',{cache:'no-store',credentials:'include'});const data=await res.json();if(!data.ok)throw new Error(data.error||'Shared database unavailable');
        const server=(data.rows||[]).map(dbToRow).filter(x=>x.mawb);const map=new Map(server.map(x=>[digits(x.mawb),x]));const migrate=[];
        for(const l of local){
          const key=digits(l.mawb),s=map.get(key);
          if(!s){map.set(key,l);migrate.push(l);continue}
          const lt=Date.parse(l.lastChecked||l._dbUpdatedAt||0)||0,st=Date.parse(s.lastChecked||s._dbUpdatedAt||0)||0;
          if(lt>st)map.set(key,l);
        }
        const merged=[...map.values()].sort((a,b)=>(Date.parse(b.lastChecked||b._dbUpdatedAt||0)||0)-(Date.parse(a.lastChecked||a._dbUpdatedAt||0)||0));
        if(!active)return;setRows(merged);setShared(true);setLoaded(true);localStorage.setItem(KEY,JSON.stringify(merged.map(withoutMeta)));if(migrate.length)persistRows(migrate).catch(()=>{});
      }catch(e){if(!active)return;setRows(local);setLoaded(true);setShared(false);setNote(`Shared database unavailable — showing this browser backup only. ${e.message||''}`)}
    })();
    return()=>{active=false};
  },[isAdmin]);
  useEffect(()=>{if(typeof window!=='undefined'&&loaded)localStorage.setItem(KEY,JSON.stringify(rows.map(withoutMeta)))},[rows,loaded]);
  useEffect(()=>{const id=setInterval(()=>window.location.reload(),TWO_HOURS);return()=>clearInterval(id)},[]);
  useEffect(()=>{setClientFilter('');setOriginFilter('');setDestinationFilter('')},[activeTab,adminView]);

  const tabRows=useMemo(()=>rows.filter(r=>(r.shipmentType==='EXPORT'?'EXPORT':'IMPORT')===activeTab),[rows,activeTab]);
  const dashboardRows=useMemo(()=>{
    if(activeTab==='EXPORT'){
      if(isAdmin&&adminView==='CLEARED')return tabRows.filter(isExportArchived);
      return tabRows.filter(r=>!isExportArchived(r));
    }
    if(isAdmin&&adminView==='CLEARED')return tabRows.filter(isCustomsArchived);
    return tabRows.filter(r=>!isCustomsArchived(r)||isPartArrived(r));
  },[tabRows,activeTab,isAdmin,adminView]);
  const customsFilterMode=isAdmin&&activeTab==='IMPORT'&&adminView==='CLEARED';
  const filterOptions=useMemo(()=>({clients:uniq(dashboardRows,'clientName'),origins:uniq(dashboardRows,'origin'),destinations:uniq(dashboardRows,'destination')}),[dashboardRows]);
  const visibleRows=useMemo(()=>sortPriority(customsFilterMode?dashboardRows.filter(r=>(!clientFilter||r.clientName===clientFilter)&&(!originFilter||r.origin===originFilter)&&(!destinationFilter||r.destination===destinationFilter)):dashboardRows),[dashboardRows,customsFilterMode,clientFilter,originFilter,destinationFilter]);
  const totalWeight=useMemo(()=>visibleRows.reduce((sum,r)=>sum+weightForTotal(r),0),[visibleRows]);
  const stats=useMemo(()=>({
    total:visibleRows.length,
    booked:visibleRows.filter(x=>x.status==='BOOKED').length,
    transit:visibleRows.filter(x=>x.status==='IN TRANSIT'||x.status==='PART ARRIVED').length,
    arrived:visibleRows.filter(x=>x.status==='ARRIVED').length,
    attention:visibleRows.filter(x=>x.status==='DELAYED'||x.status==='EARLY ARRIVAL').length
  }),[visibleRows]);
  async function track(one){
    const n=normalize(one);if(!n)throw new Error('Enter valid 11-digit MAWB.');
    const res=await fetch('/api/track',{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({mawb:n})});const data=await res.json();
    if(!data.ok){const err=new Error(data.trackingError||data.apiError||data.error||'Tracking failed');err.payload=data;throw err}return {...data.shipment,provider:data.provider||data.shipment?.source||''};
  }
  async function saveAndShow(next,successText){
    setRows(r=>[next,...r.filter(x=>normalize(x.mawb)!==normalize(next.mawb))]);
    try{await persistRow(next,true);setShared(true);setNote(`${successText} • Saved for everyone.`);return true}catch(e){setShared(false);setNote(`${successText} • Shared save failed: ${e.message||e}`);return false}
  }
  async function add(){
    const n=normalize(mawb),clientName=String(client||'').trim();
    if(!n){setNote('Please enter valid 11-digit MAWB.');return}
    if(!clientName){setNote('Client Name is mandatory. Please enter the client name before adding the MAWB.');return}
    const airline=airlineForMawb(n);if(!airline){setNote(`Prefix ${n.slice(0,3)} is not mapped yet.`);return}
    const existing=rows.find(x=>normalize(x.mawb)===n);if(existing){setNote(`${n} is already fixed in ${existing.shipmentType||'IMPORT'} dashboard. Admin can move it if required.`);return}
    const enteredAt=new Date().toISOString();
    const base=decorateTiming({}, {mawb:n,shipmentType:activeTab,clientName,enteredBy:employeeName,enteredByUsername:employeeUsername,enteredAt,airlineName:airline.name,status:'BOOKED',officialTracker:airline.url||'',mailSent:activeTab==='IMPORT'?false:undefined,customsCleared:activeTab==='IMPORT'?false:undefined,masterCopyReceived:activeTab==='EXPORT'?false:undefined,lastChecked:enteredAt});
    setRows(r=>[base,...r.filter(x=>normalize(x.mawb)!==n)]);
    setMawb('');setClient('');setBusy(true);setNote(`${n} added. Fetching live ${airline.name} details…`);
    try{await persistRow(base,true);setShared(true)}catch(e){setShared(false);setNote(`${n} added locally; shared save failed: ${e.message||e}`)}
    try{
      const s=await track(n);
      const next=decorateTiming(base,{...s,shipmentType:activeTab,clientName,enteredBy:employeeName,enteredByUsername:employeeUsername,enteredAt,mailSent:activeTab==='IMPORT'?false:undefined,customsCleared:activeTab==='IMPORT'?false:undefined,masterCopyReceived:activeTab==='EXPORT'?base.masterCopyReceived===true:undefined,lastChecked:new Date().toISOString(),trackingError:'',manualHint:''});
      setRows(r=>r.map(x=>normalize(x.mawb)===n?next:x));
      try{await persistRow(next);setShared(true);setNote(`${n} live details filled and saved.`)}catch(e){setShared(false);setNote(`${n} live details filled locally; shared save failed: ${e.message||e}`)}
    }catch(e){
      const p=e.payload||{};
      const next=decorateTiming(base,{trackingError:e.message,manualHint:p.manualHint||'',officialTracker:airline.url||p.officialTracker||base.officialTracker,lastChecked:new Date().toISOString()});
      setRows(r=>r.map(x=>normalize(x.mawb)===n?next:x));
      try{await persistRow(next)}catch{}
      setNote(`${n} saved. Live tracking will retry; use REFRESH if details stay blank.`)
    }finally{setBusy(false)}
  }
  async function refreshByMawb(value){
    const index=rows.findIndex(x=>normalize(x.mawb)===normalize(value)),row=rows[index];if(!row)return;setNote(`Refreshing ${row.mawb}…`);
    let next;
    try{
      const s=await track(row.mawb);
      next=decorateTiming(row,{...s,shipmentType:row.shipmentType,clientName:row.clientName,enteredBy:row.enteredBy,enteredByUsername:row.enteredByUsername,enteredAt:row.enteredAt,mailSent:row.shipmentType==='IMPORT'?row.mailSent===true:undefined,customsCleared:row.shipmentType==='IMPORT'?row.customsCleared===true:undefined,masterCopyReceived:row.shipmentType==='EXPORT'?row.masterCopyReceived===true:undefined,lastChecked:new Date().toISOString(),trackingError:'',manualHint:''});
      setRows(r=>r.map((x,i)=>i===index?next:x));
    }catch(e){
      const p=e.payload||{};
      const retained=decorateTiming(row,{status:row.status||'BOOKED',officialTracker:airlineForMawb(row.mawb)?.url||p.officialTracker||row.officialTracker,manualHint:p.manualHint||row.manualHint,trackingError:e.message,lastChecked:new Date().toISOString()});
      setRows(r=>r.map((x,i)=>i===index?retained:x));
      setNote('Auto refresh had an issue; last verified details and status were retained.');
      return;
    }
    try{await persistRow(next);setShared(true);setNote(`${row.mawb} refreshed and shared.`)}
    catch(e){setShared(false);setNote(`${row.mawb} refreshed. Live details retained; shared save needs a valid login session.`)}
  }
  async function refreshAll(){setBusy(true);try{await Promise.allSettled(visibleRows.map(r=>refreshByMawb(r.mawb)))}finally{setBusy(false)}}
  async function setMail(value,sent){
    const index=rows.findIndex(x=>normalize(x.mawb)===normalize(value)),row=rows[index];if(!row||row.shipmentType==='EXPORT')return;
    const next={...row,mailSent:sent,mailUpdatedAt:new Date().toISOString()};setRows(r=>r.map((x,i)=>i===index?next:x));
    try{await persistRow(next);setShared(true);setNote(`${row.mawb}: Mail marked ${sent?'YES':'NO'} and saved.${sent&&next.customsCleared?(isPartArrived(next)?' PART ARRIVED stays in Active and also appears in Customs Cleared.':' Moved to Customs Cleared view for admin.') :''}`)}catch(e){setShared(false);setNote(`Mail status save failed: ${e.message||e}`)}
  }
  async function setCustomsClear(value,cleared){
    const index=rows.findIndex(x=>normalize(x.mawb)===normalize(value)),row=rows[index];if(!row||row.shipmentType==='EXPORT')return;
    const next={...row,customsCleared:cleared,customsClearedAt:cleared?new Date().toISOString():'',customsClearedBy:cleared?employeeName:''};
    setRows(r=>r.map((x,i)=>i===index?next:x));
    try{
      await persistRow(next);setShared(true);
      if(cleared&&next.mailSent&&isPartArrived(next))setNote(`${row.mawb}: PART ARRIVED remains in Active Masters and is also kept in Customs Cleared.`);
      else if(cleared&&next.mailSent)setNote(`${row.mawb}: Customs cleared and Mail YES — removed from employee dashboard and kept in Admin Customs Cleared.`);
      else if(cleared)setNote(`${row.mawb}: Customs cleared marked. It will leave employee dashboard after Mail is YES, except while status is PART ARRIVED.`);
      else setNote(`${row.mawb}: Customs clear mark removed.`);
    }catch(e){setShared(false);setNote(`Customs clear status save failed: ${e.message||e}`)}
  }
  async function setMasterCopyReceived(value,received){
    const index=rows.findIndex(x=>normalize(x.mawb)===normalize(value)),row=rows[index];if(!row||row.shipmentType!=='EXPORT')return;
    const next={...row,masterCopyReceived:received,masterCopyReceivedAt:received?new Date().toISOString():'',masterCopyReceivedBy:received?(employeeName||'User'):''};
    setRows(r=>r.map((x,i)=>i===index?next:x));
    try{await persistRow(next);setShared(true);setNote(`${row.mawb}: Master Copy Received marked ${received?'YES':'NO'} and saved.${received?' Moved to Export Customs Cleared masters.':' Returned to Active Export masters.'}`)}
    catch(e){setRows(r=>r.map((x,i)=>i===index?row:x));setShared(false);setNote(`Master Copy Received save failed: ${e.message||e}`)}
  }
  async function editClientName(value){
    if(!isAdmin)return;
    const index=rows.findIndex(x=>normalize(x.mawb)===normalize(value)),row=rows[index];if(!row)return;
    const current=String(row.clientName||'').trim();
    const entered=window.prompt(`Change client name for ${row.mawb}`,current);if(entered===null)return;
    const clientName=String(entered||'').trim();if(!clientName){setNote('Client name cannot be blank.');return}
    if(clientName===current){setNote(`${row.mawb}: Client name unchanged.`);return}
    const next={...row,clientName,client:clientName,clientUpdatedAt:new Date().toISOString(),clientUpdatedBy:employeeName||'Admin'};
    setRows(r=>r.map((x,i)=>i===index?next:x));
    try{await persistRow(next);setShared(true);setNote(`${row.mawb}: Client changed from ${current||'—'} to ${clientName} by admin.`)}
    catch(e){setRows(r=>r.map((x,i)=>i===index?row:x));setShared(false);setNote(`Client name change failed: ${e.message||e}`)}
  }
  async function moveShipment(value){
    if(!isAdmin)return;const index=rows.findIndex(x=>normalize(x.mawb)===normalize(value)),row=rows[index];if(!row)return;
    const target=row.shipmentType==='EXPORT'?'IMPORT':'EXPORT';
    const next=decorateTiming(row,{...row,shipmentType:target,mailSent:target==='IMPORT'?false:undefined,mailUpdatedAt:target==='IMPORT'?row.mailUpdatedAt:undefined,customsCleared:target==='IMPORT'?false:undefined,customsClearedAt:target==='IMPORT'?'':undefined,customsClearedBy:target==='IMPORT'?'':undefined,masterCopyReceived:target==='EXPORT'?false:undefined,masterCopyReceivedAt:target==='EXPORT'?'':undefined,masterCopyReceivedBy:target==='EXPORT'?'':undefined,lastChecked:row.lastChecked||new Date().toISOString()});
    setRows(r=>r.map((x,i)=>i===index?next:x));
    try{await persistRow(next);setShared(true);setNote(`${row.mawb} moved to ${target}.`)}catch(e){setShared(false);setNote(`Could not move shipment: ${e.message||e}`)}
  }
  async function remove(value){
    if(!isAdmin)return;const index=rows.findIndex(x=>normalize(x.mawb)===normalize(value)),row=rows[index];if(!row)return;
    if(!window.confirm(`Delete ${row.mawb} from the shared tracker?`))return;
    try{const res=await fetch(`/api/shipments?awb=${encodeURIComponent(row.mawb)}`,{method:'DELETE',credentials:'include'});const data=await res.json();if(!data.ok)throw new Error(data.error||'Delete failed');setRows(r=>r.filter((_,i)=>i!==index));setShared(true);setNote(`${row.mawb} deleted by admin.`)}catch(e){setNote(`Delete blocked: ${e.message||e}`)}
  }
  return <main>
    <section className="hero"><div><div className="eyebrow">MAYAVI CARGO • V4.3 • {isAdmin?'ADMIN':'EMPLOYEE'}</div><h1>{isAdmin?'Admin MAWB Dashboard':'Employee MAWB Dashboard'}</h1><p>Backend refresh every 2 hours • In Transit and Delayed masters stay at the top • live status automatically changes to Booked, In Transit, Part Arrived, Arrived, Delayed or Early Arrival • every new MAWB records the employee who entered it.</p></div><div className="userPanel"><div className="version">{employeeName||'User'} • {shared?'SHARED ✓':'LOCAL'}</div>{onLogout&&<button className="logoutBtn" onClick={onLogout}>LOGOUT</button>}</div></section>
    {isAdmin&&<section className="adminBar"><div><b>ADMIN ACCESS</b><span>Import Customs Cleared masters and Export Master Copy Received masters are stored separately. PART ARRIVED import masters remain visible in both until fully arrived.</span></div></section>}
    <section className="typeTabs"><button className={activeTab==='IMPORT'?'active':''} onClick={()=>{setActiveTab('IMPORT');setAdminView('ACTIVE')}}>IMPORT</button><button className={activeTab==='EXPORT'?'active':''} onClick={()=>{setActiveTab('EXPORT');setAdminView('ACTIVE')}}>EXPORT</button></section>
    {isAdmin&&<section className="adminViews"><button className={adminView==='ACTIVE'?'active':''} onClick={()=>setAdminView('ACTIVE')}>ACTIVE MASTERS</button><button className={adminView==='CLEARED'?'active':''} onClick={()=>setAdminView('CLEARED')}>CUSTOMS CLEARED ({activeTab==='IMPORT'?tabRows.filter(isCustomsArchived).length:tabRows.filter(isExportArchived).length})</button></section>}
    <section className="stats"><div><b>{stats.total}</b><span>{isAdmin&&adminView==='CLEARED'?'Cleared':activeTab} MAWB</span></div><div><b>{stats.booked}</b><span>Booked</span></div><div><b>{stats.transit}</b><span>In Transit</span></div><div><b>{stats.arrived}</b><span>Arrived</span></div><div><b>{stats.attention}</b><span>Delayed / Early</span></div></section>
    {(!isAdmin||adminView==='ACTIVE')&&<section className="entry"><div><label>{activeTab} MAWB NUMBER</label><input value={mawb} onChange={e=>setMawb(e.target.value)} placeholder="e.g. 157-12345678" onKeyDown={e=>e.key==='Enter'&&add()}/></div><div><label>CLIENT NAME *</label><input required value={client} onChange={e=>setClient(e.target.value)} placeholder="Required client name" onKeyDown={e=>e.key==='Enter'&&add()}/></div><button disabled={busy} onClick={add}>{busy?'TRACKING…':`ADD TO ${activeTab}`}</button><button className="secondary" disabled={busy||!visibleRows.length} onClick={refreshAll}>REFRESH {activeTab}</button></section>}
    {note&&<div className="note">{note}</div>}
    {customsFilterMode&&<section className="filters"><div><label>ORIGIN</label><select value={originFilter} onChange={e=>setOriginFilter(e.target.value)}><option value="">All Origins</option>{filterOptions.origins.map(v=><option key={v} value={v}>{v}</option>)}</select></div><div><label>DESTINATION</label><select value={destinationFilter} onChange={e=>setDestinationFilter(e.target.value)}><option value="">All Destinations</option>{filterOptions.destinations.map(v=><option key={v} value={v}>{v}</option>)}</select></div><button onClick={()=>{setClientFilter('');setOriginFilter('');setDestinationFilter('')}}>CLEAR FILTERS</button></section>}
    <section className="tableWrap"><table><thead><tr><th>MAWB</th><th>{customsFilterMode?<div style={{display:'grid',gap:'6px',minWidth:'140px'}}><span>Client</span><select value={clientFilter} onChange={e=>setClientFilter(e.target.value)} style={{height:'30px',border:'1px solid #cbd5e1',borderRadius:'7px',background:'#fff',padding:'0 7px',fontSize:'11px',fontWeight:700,color:'#475569'}}><option value="">All Clients</option>{filterOptions.clients.map(v=><option key={v} value={v}>{v}</option>)}</select></div>:'Client'}</th><th>Entered By</th><th>Airline</th><th>Origin</th><th>Destination</th><th>Flight</th><th>Bags/Pieces</th><th>Weight</th><th>Booking Date</th><th>Arrival Date</th><th>Arrival Time</th>{activeTab==='IMPORT'&&<><th>Mail Time (-5h)</th><th>Mail</th><th>Customs Clear</th></>}{activeTab==='EXPORT'&&(!isAdmin||adminView==='ACTIVE')&&<th>Master Copy Received</th>}<th>Status</th><th>Action</th></tr></thead><tbody>{visibleRows.length?visibleRows.map(r=><tr key={r.mawb}><td><strong>{r.mawb}</strong>{r.trackingError&&<small className="err">Backend will retry automatically</small>}</td><td onClick={()=>isAdmin&&editClientName(r.mawb)} title={isAdmin?'Click client name to edit':''} style={isAdmin?{cursor:'pointer'}:undefined}>{r.clientName?<span className="clientChip" style={clientStyle(r.clientName)}>{r.clientName}</span>:'—'}</td><td>{r.enteredBy?<span className="employeeChip">{r.enteredBy}</span>:'—'}</td><td>{r.airlineName||'—'}</td><td>{r.origin||'—'}</td><td>{r.destination||'—'}</td><td>{normalizeFlightNo(r.mawb,r.flightNo)||'—'}</td><td>{r.bags||r.pieces||'—'}</td><td>{r.weight?`${r.weight} kg`:'—'}</td><td>{r.bookingDate||'—'}</td><td>{r.arrivalDate||'—'}</td><td>{formatTime12(r.arrivalTime)||'—'}</td>{activeTab==='IMPORT'&&<><td><strong className="mailTime">{r.mailTime||mailTimeFrom(r.arrivalDate,r.arrivalTime)||'—'}</strong></td><td><div className="mailChoice"><button className={`mailBtn yes ${r.mailSent===true?'selected':''}`} onClick={()=>setMail(r.mawb,true)}>YES</button><button className={`mailBtn no ${r.mailSent!==true?'selected':''}`} onClick={()=>setMail(r.mawb,false)}>NO</button></div></td><td><label className={`customsToggle ${r.customsCleared?'checked':''}`}><input type="checkbox" checked={r.customsCleared===true} onChange={e=>setCustomsClear(r.mawb,e.target.checked)}/><span>{r.customsCleared?'CLEARED':'PENDING'}</span></label></td></>}{activeTab==='EXPORT'&&(!isAdmin||adminView==='ACTIVE')&&<td><div className="mailChoice"><button className={`mailBtn yes ${r.masterCopyReceived===true?'selected':''}`} onClick={()=>setMasterCopyReceived(r.mawb,true)}>YES</button><button className={`mailBtn no ${r.masterCopyReceived!==true?'selected':''}`} onClick={()=>setMasterCopyReceived(r.mawb,false)}>NO</button></div></td>}<td><span className={`badge ${tone(r.status)}`}>{businessStatus(r.status,r.timingStatus,r.arrivalDate,r.mawb)}</span></td><td><div className="actions"><button className="refreshBtn" onClick={()=>refreshByMawb(r.mawb)}>REFRESH</button>{officialUrl(r)&&<a className={`trackLink ${r.trackingError?'urgent':''}`} href={officialUrl(r)} target="_blank" rel="noreferrer" onClick={e=>{if(normalize(r.mawb).startsWith('514-')){e.preventDefault();openOfficial(r);setNote(`${digits(r.mawb)} copied. Air Arabia opened.`)}}}>{normalize(r.mawb).startsWith('514-')?'COPY + OFFICIAL ↗':'OFFICIAL TRACK ↗'}</a>}{isAdmin&&<button className="moveBtn" onClick={()=>moveShipment(r.mawb)}>MOVE TO {activeTab==='IMPORT'?'EXPORT':'IMPORT'}</button>}{isAdmin&&<button className="removeBtn" onClick={()=>remove(r.mawb)}>DELETE</button>}</div></td></tr>):<tr><td colSpan={activeTab==='IMPORT'?17:(isAdmin&&adminView==='CLEARED'?14:15)} className="empty">{isAdmin&&adminView==='CLEARED'?(activeTab==='IMPORT'?'No customs-cleared masters match these filters.':'No export masters with Master Copy Received yet.'):`No ${activeTab.toLowerCase()} MAWB added yet.`}</td></tr>}</tbody></table></section>
    {customsFilterMode&&<section className="tableSummary"><span>{visibleRows.length} master{visibleRows.length===1?'':'s'} shown</span><strong>Total Weight: {totalWeight.toLocaleString(undefined,{maximumFractionDigits:2})} kg</strong></section>}
    <footer>{CONFIGURED_PREFIXES.length} airline prefixes • Shared Neon storage • In Transit / Delayed masters first • Import Customs Clear archive • Export Master Copy Received archive • 2-hour backend refresh</footer>
  </main>
}