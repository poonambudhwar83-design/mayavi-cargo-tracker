'use client';
import { useEffect, useMemo, useState } from 'react';
import { confirmedPartArrival, masterKg, partKg } from '../lib/arrivalWeights.js';

function digits(v=''){return String(v||'').replace(/\D/g,'')}
function pad(v){return String(v).padStart(2,'0')}
function formatDate(value=''){
  if(!value)return'—';
  const d=new Date(value);
  if(Number.isFinite(d.getTime()))return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()}`;
  return String(value);
}
function formatTime(value=''){
  const s=String(value||'').trim();if(!s)return'—';
  if(/\b(?:AM|PM)\b/i.test(s))return s.toUpperCase();
  const m=s.match(/^(\d{1,2}):(\d{2})/);if(!m)return s;
  const h=Number(m[1]);return `${pad(h%12||12)}:${m[2]} ${h>=12?'PM':'AM'}`;
}
function weightValue(row={},isPart=false){
  // For split cargo, "350/1000" is 350 kg arrived, not 1000 kg booked.
  if(isPart)return partKg(row.weight);
  const isFractionalPart=(row.isPartLoad===true||row.partLoad===true||
    /PART ARRIVED|PART LOAD|PART SHIPMENT/i.test(String(row.status||'')))&&
    String(row.weight||'').includes('/');
  return isFractionalPart?partKg(row.weight):masterKg(row);
}
function archiveDateMonth(value=''){
  const s=String(value||'').trim();
  let m=s.match(/^(20\d{2})[-/](\d{1,2})[-/](\d{1,2})(?:\D|$)/);
  let y,mo,d;
  if(m){y=+m[1];mo=+m[2];d=+m[3];}
  else{m=s.match(/^(\d{1,2})[-/](\d{1,2})[-/](20\d{2})(?:\D|$)/);
    if(!m)return'';
    d=+m[1];mo=+m[2];y=+m[3];}
  const dt=new Date(Date.UTC(y,mo-1,d));
  return dt.getUTCFullYear()===y&&dt.getUTCMonth()+1===mo&&dt.getUTCDate()===d?y+'-'+pad(mo):'';
}
function archiveVisibleRows(records=[]){
  return records.flatMap(record=>{
    const d=record.data||{},month=record.archiveMonth;
    if(record.shipmentType==='EXPORT')
      return archiveDateMonth(d.departureDate||d.flightDate)===month?[record]:[];
    if(record.shipmentType!=='IMPORT')return[];
    const parts=Array.isArray(d.partShipments)?d.partShipments.filter(Boolean):[];
    // One MAWB can have part arrivals in two different calendar months.
    // Each part must show its own received pieces/weight and arrival date.
    const matches=parts.filter(p=>confirmedPartArrival(p)&&archiveDateMonth(p.arrivalDate)===month);
    if(matches.length)return matches.map((p,i)=>({...record,archivePartIndex:i,
      isArchivePart:true,data:{...d,...p,weight:p.weight??'',totalWeight:'',
        masterWeight:'',bags:p.pieces||p.bags||'',pieces:p.pieces||p.bags||'',
        arrivalDate:p.arrivalDate||'',arrivalTime:p.arrivalTime||'',
        mailSent:p.mailSent===true,customsCleared:p.customsCleared===true,
        remarks:p.remarks||d.remarks||''}}));
    // Never fall back to the full master for a shipment with individual
    // physical parts. Pending/estimated parts have no arrived weight yet.
    if(parts.length)return[];
    const split=(d.isPartLoad===true||d.partLoad===true||
      /PART ARRIVED|PART LOAD|PART SHIPMENT/i.test(String(d.status||'')))&&
      String(d.weight||'').includes('/');
    if(archiveDateMonth(d.arrivalDate)!==month)return[];
    return split?(confirmedPartArrival(d)?[{...record,isArchivePart:true}]:[]):[record];
  });
}
function viaForRow(row={}){
  const direct=String(row.via||row.transitAirport||row.routeVia||row.connectionAirport||row.hub||'').trim().toUpperCase();
  if(direct)return direct;
  const dep=String(row.departureDestination||'').trim().toUpperCase();
  if(dep&&dep!==String(row.destination||'').trim().toUpperCase())return dep;
  return String(row.origin||'').trim().toUpperCase()||'—';
}
function statusTone(status=''){
  const s=String(status||'').toUpperCase();
  if(s.includes('ARRIVED')||s.includes('DELIVER'))return'arrived';
  if(s.includes('DELAY')||s.includes('OFFLOAD'))return'delayed';
  if(s.includes('TRANSIT')||s.includes('DEPART')||s.includes('PART'))return'transit';
  return'booked';
}

export default function MonthlyDashboard(){
  const [loading,setLoading]=useState(true);
  const [authorized,setAuthorized]=useState(false);
  const [months,setMonths]=useState([]);
  const [month,setMonth]=useState('');
  const [type,setType]=useState('IMPORT');
  const [rows,setRows]=useState([]);
  const [note,setNote]=useState('');
  const [search,setSearch]=useState('');

  async function loadMeta(){
    const res=await fetch('/api/monthly-records',{cache:'no-store',credentials:'include'});
    const data=await res.json();
    if(!data.ok)throw new Error(data.error||'Monthly records could not be loaded.');
    setMonths(data.months||[]);
    setMonth(current=>current||(data.months?.[0]?.key||''));
    return data;
  }

  useEffect(()=>{let active=true;(async()=>{
    try{
      const authRes=await fetch('/api/auth',{cache:'no-store',credentials:'include'});
      const auth=await authRes.json();
      if(!active)return;
      if(!auth.authenticated){window.location.href='/';return}
      if(auth.session?.role!=='admin'){setNote('Monthly Records is available to Admin only.');setAuthorized(false);setLoading(false);return}
      setAuthorized(true);
      await loadMeta();
    }catch(e){if(active)setNote(e.message||'Monthly Records could not be opened.')}finally{if(active)setLoading(false)}
  })();return()=>{active=false}},[]);

  useEffect(()=>{if(!authorized||!month)return;let active=true;(async()=>{
    try{
      setLoading(true);
      const res=await fetch(`/api/monthly-records?month=${encodeURIComponent(month)}&type=${encodeURIComponent(type)}`,{cache:'no-store',credentials:'include'});
      const data=await res.json();
      if(!data.ok)throw new Error(data.error||'Monthly rows could not be loaded.');
      if(active){setRows(data.rows||[]);setMonths(data.months||[]);setNote('')}
    }catch(e){if(active)setNote(e.message||'Monthly rows could not be loaded.')}finally{if(active)setLoading(false)}
  })();return()=>{active=false}},[authorized,month,type]);

  const selectedMeta=months.find(m=>m.key===month);
  const visible=useMemo(()=>{
    const q=String(search||'').trim().toLowerCase();
    const dated=archiveVisibleRows(rows);
    if(!q)return dated;
    return dated.filter(r=>{
      const d=r.data||{};
      return [r.awb,d.mawb,d.clientName,d.client,d.companyName,d.airlineName,d.origin,d.destination,d.flightNo,d.status].some(v=>String(v||'').toLowerCase().includes(q));
    });
  },[rows,search]);
  const totalWeight=useMemo(()=>visible.reduce((sum,r)=>sum+(weightValue(r.data||{},r.isArchivePart)||0),0),[visible]);
  const unknownWeights=useMemo(()=>visible.filter(r=>weightValue(r.data||{},r.isArchivePart)===null).length,[visible]);
  const clientCount=useMemo(()=>new Set(visible.map(r=>String(r.data?.clientName||r.data?.client||'').trim()).filter(Boolean)).size,[visible]);
  const arrivedCount=useMemo(()=>visible.filter(r=>/ARRIVED|DELIVERED/i.test(String(r.data?.status||''))).length,[visible]);

  if(loading&&!authorized)return <main className="loginShell"><section className="loginCard"><div className="eyebrow">MAYAVI CARGO</div><h1>Opening Monthly Records…</h1></section></main>;

  return <main style={{paddingBottom:24}}>
    <section className="hero">
      <div><div className="eyebrow">MAYAVI CARGO • ADMIN ARCHIVE</div><h1>Monthly Records Dashboard</h1><p>Closed months are saved separately. Import uses Arrival Date; Export uses Departure Date. Split Import parts are shown in their own arrival month.</p></div>
      <div className="userPanel"><button className="logoutBtn" onClick={()=>{window.location.href='/'}}>← LIVE DASHBOARD</button></div>
    </section>

    {!authorized?<div className="note">{note||'Admin authorization required.'}</div>:<>
      <section className="adminBar"><div><b>MONTH-END ARCHIVE</b><span>Each closed calendar month is archived automatically. Import follows Arrival Date; Export follows Departure Date. Missing dates or missing source weights are not guessed.</span></div></section>

      <section className="filters" style={{alignItems:'end'}}>
        <div><label>MONTH</label><select value={month} onChange={e=>{setMonth(e.target.value);setSearch('')}}>{months.length?months.map(m=><option key={m.key} value={m.key}>{String(m.label||m.key).toUpperCase()}</option>):<option value="">No closed month yet</option>}</select></div>
        <div><label>SEARCH</label><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="MAWB, client, airline, origin…"/></div>
        <button onClick={()=>loadMeta().catch(e=>setNote(e.message||'Refresh failed'))}>REFRESH MONTHS</button>
      </section>

      <section className="typeTabs">
        <button className={type==='IMPORT'?'active':''} onClick={()=>setType('IMPORT')}>IMPORT ({selectedMeta?.importCount||0})</button>
        <button className={type==='EXPORT'?'active':''} onClick={()=>setType('EXPORT')}>EXPORT ({selectedMeta?.exportCount||0})</button>
      </section>

      <section className="stats">
        <div><b>{visible.length}</b><span>{type} MAWB</span></div>
        <div><b>{totalWeight.toLocaleString(undefined,{maximumFractionDigits:2})}</b><span>Total Weight kg</span></div>
        <div><b>{clientCount}</b><span>Clients</span></div>
        <div><b>{arrivedCount}</b><span>Arrived / Delivered</span></div>
        <div><b>{selectedMeta?.label||'Closed Month'}</b><span>Archive Month</span></div>
      </section>

      {note&&<div className="note">{note}</div>}
      <section className="tableWrap"><table>
        <thead><tr>
          <th>S.No.</th><th>Entry Date</th><th>MAWB</th>{type==='IMPORT'&&<th>Goods</th>}<th>Client</th><th>Company</th><th>Entered By</th><th>Booking Date</th><th>Airline</th><th>Origin</th><th>Via</th><th>Destination</th><th>Bags/Pieces</th><th>Weight</th><th>Flight</th>
          {type==='EXPORT'&&<><th>Departure Date</th><th>Departure Time</th><th>Handover</th><th>Master Copy</th></>}
          <th>Arrival Date</th><th>Arrival Time</th>{type==='IMPORT'&&<><th>Mail</th><th>Customs Clear</th></>}<th>Status</th><th>Remarks</th>
        </tr></thead>
        <tbody>{visible.length?visible.map((record,index)=>{const r=record.data||{};return <tr key={record.archiveMonth+'-'+record.shipmentType+'-'+record.awb+'-'+(record.archivePartIndex??'master')}>
          <td><strong>{index+1}</strong></td><td>{formatDate(r.enteredAt)}</td><td><strong>{r.mawb||(`${String(record.awb).slice(0,3)}-${String(record.awb).slice(3)}`)}</strong></td>{type==='IMPORT'&&<td>{r.goodsDescription||'—'}</td>}<td>{r.clientName||r.client||'—'}</td><td>{r.companyName||r.companyType||'—'}</td><td>{r.enteredBy||'—'}</td><td>{r.bookingDate||'—'}</td><td>{r.airlineName||'—'}</td><td>{r.origin||'—'}</td><td>{viaForRow(r)}</td><td>{r.destination||'—'}</td><td>{r.bags||r.pieces||'—'}</td><td>{weightValue(r,record.isArchivePart)!==null?`${weightValue(r,record.isArchivePart)} kg`:'—'}</td><td>{r.flightNo||'—'}</td>
          {type==='EXPORT'&&<><td>{r.departureDate||r.flightDate||'—'}</td><td>{formatTime(r.departureTime)}</td><td>{r.handoverDone===true?'YES':'NO'}</td><td>{r.masterCopyReceived===true?'RECEIVED':'PENDING'}</td></>}
          <td>{r.arrivalDate||'—'}</td><td>{formatTime(r.arrivalTime)}</td>{type==='IMPORT'&&<><td>{r.mailSent===true?'YES':'NO'}</td><td>{r.customsCleared===true?'CLEARED':'PENDING'}</td></>}<td><span className={`badge ${statusTone(r.status)}`}>{r.status||'BOOKED'}</span></td><td>{r.remarks||'—'}</td>
        </tr>}):<tr><td className="empty" colSpan={type==='IMPORT'?24:23}>{month?'No '+type.toLowerCase()+' records in this month.':'No closed-month records yet.'}</td></tr>}</tbody>
      </table></section>
      <section className="tableSummary"><span>{visible.length} master{visible.length===1?'':'s'} shown</span><strong>Total recorded Weight: {totalWeight.toLocaleString(undefined,{maximumFractionDigits:2})} kg{unknownWeights>0?` • ${unknownWeights} row(s) without recorded weight`:''}</strong></section>
    </>}
  </main>;
}
