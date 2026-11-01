'use client';
import { useEffect, useMemo, useState } from 'react';
import { confirmedPartArrival, masterKg, partKg } from '../lib/arrivalWeights.js';
import { confirmedExportHandoverDate, confirmedExportHandoverMonth } from '../lib/exportHandoverAccounting.js';

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
      return confirmedExportHandoverMonth(d)===month?[record]:[];
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
  const [goodsFilter,setGoodsFilter]=useState('');
  const [clientFilter,setClientFilter]=useState('');
  const [companyFilter,setCompanyFilter]=useState('');
  const clearFilters=()=>{
    setSearch('');setGoodsFilter('');setClientFilter('');setCompanyFilter('');
  };

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
  // Filter archived arrival parts separately while keeping totals in sync with
  // the exact records visible in the monthly table.
  const archivedRows=useMemo(()=>archiveVisibleRows(rows),[rows]);
  const filterOptions=useMemo(()=>{
    const distinct=read=>[...new Set(archivedRows.map(record=>String(read(record.data||{})||'').trim()).filter(Boolean))]
      .sort((a,b)=>a.localeCompare(b,undefined,{sensitivity:'base'}));
    return {
      goods:distinct(d=>d.goodsDescription||d.goods),
      clients:distinct(d=>d.clientName||d.client),
      companies:distinct(d=>d.companyName||d.companyType)
    };
  },[archivedRows]);
  const visible=useMemo(()=>{
    const normal=value=>String(value||'').trim().toLowerCase();
    const q=normal(search);
    return archivedRows.filter(r=>{
      const d=r.data||{};
      if(goodsFilter&&normal(d.goodsDescription||d.goods)!==normal(goodsFilter))return false;
      if(clientFilter&&normal(d.clientName||d.client)!==normal(clientFilter))return false;
      if(companyFilter&&normal(d.companyName||d.companyType)!==normal(companyFilter))return false;
      return !q||[r.awb,d.mawb,d.goodsDescription,d.goods,d.clientName,d.client,d.companyName,d.companyType,
        d.airlineName,d.origin,d.destination,d.flightNo,d.status].some(v=>normal(v).includes(q));
    });
  },[archivedRows,search,goodsFilter,clientFilter,companyFilter]);
  const totalWeight=useMemo(()=>visible.reduce((sum,r)=>sum+(weightValue(r.data||{},r.isArchivePart)||0),0),[visible]);
  const unknownWeights=useMemo(()=>visible.filter(r=>weightValue(r.data||{},r.isArchivePart)===null).length,[visible]);
  const clientCount=useMemo(()=>new Set(visible.map(r=>String(r.data?.clientName||r.data?.client||'').trim()).filter(Boolean)).size,[visible]);
  const arrivedCount=useMemo(()=>visible.filter(r=>/ARRIVED|DELIVERED/i.test(String(r.data?.status||''))).length,[visible]);

  if(loading&&!authorized)return <main className="loginShell"><section className="loginCard"><div className="eyebrow">MAYAVI CARGO</div><h1>Opening Monthly Records…</h1></section></main>;

  return <main style={{paddingBottom:24}}>
    <section className="hero">
      <div><div className="eyebrow">MAYAVI CARGO • ADMIN ARCHIVE</div><h1>Monthly Records Dashboard</h1><small style={{display:'inline-block',margin:'8px 0 0',padding:'5px 9px',background:'rgba(255,255,255,.15)',borderRadius:8,fontWeight:800}}>Goods • Client • Company filters available in table headings</small><p>Closed months are saved separately. Import follows confirmed Arrival Date; Export follows the recorded Handover YES date (IST). Split Import parts appear in their own arrival month.</p></div>
      <div className="userPanel"><button className="logoutBtn" onClick={()=>{window.location.href='/'}}>← LIVE DASHBOARD</button></div>
    </section>

    {!authorized?<div className="note">{note||'Admin authorization required.'}</div>:<>
      <section className="adminBar"><div><b>MONTH-END ARCHIVE</b><span>Each closed calendar month is archived automatically. Import follows verified Arrival Date; Export follows the actual Handover YES date in IST (not Departure Date). Pending handovers are not archived.</span></div></section>

      <section className="filters" style={{alignItems:'end'}}>
        <div><label>MONTH</label><select value={month} onChange={e=>{setMonth(e.target.value);clearFilters()}}>{months.length?months.map(m=><option key={m.key} value={m.key}>{String(m.label||m.key).toUpperCase()}</option>):<option value="">No closed month yet</option>}</select></div>
        <div><label>GOODS</label><select aria-label="Filter monthly records by goods" value={goodsFilter} onChange={e=>setGoodsFilter(e.target.value)}>
          <option value="">All Goods</option>{filterOptions.goods.map(g=><option key={g} value={g}>{g}</option>)}
        </select></div>
        <div><label>CLIENT NAME</label><select aria-label="Filter monthly records by client" value={clientFilter} onChange={e=>setClientFilter(e.target.value)}>
          <option value="">All Clients</option>{filterOptions.clients.map(c=><option key={c} value={c}>{c}</option>)}
        </select></div>
        <div><label>COMPANY NAME</label><select aria-label="Filter monthly records by company" value={companyFilter} onChange={e=>setCompanyFilter(e.target.value)}>
          <option value="">All Companies</option>{filterOptions.companies.map(c=><option key={c} value={c}>{c}</option>)}
        </select></div>
        <div><label>SEARCH</label><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="MAWB, goods, client, airline…"/></div>
        <button type="button" onClick={clearFilters}>CLEAR FILTERS</button>
        <button type="button" onClick={()=>loadMeta().catch(e=>setNote(e.message||'Refresh failed'))}>REFRESH MONTHS</button>
      </section>

      <section className="typeTabs">
        <button className={type==='IMPORT'?'active':''} onClick={()=>{setType('IMPORT');clearFilters()}}>IMPORT ({selectedMeta?.importCount||0})</button>
        <button className={type==='EXPORT'?'active':''} onClick={()=>{setType('EXPORT');clearFilters()}}>EXPORT ({selectedMeta?.exportCount||0})</button>
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
          <th>S.No.</th><th>Entry Date</th><th>MAWB</th>
          {type==='IMPORT'&&<th style={{minWidth:145}}>
            <div style={{display:'grid',gap:5}}>
              <span>Goods <span aria-hidden="true">▾</span></span>
              <select aria-label="Goods column filter" value={goodsFilter} onChange={e=>setGoodsFilter(e.target.value)} style={{minWidth:135,maxWidth:190,height:33,border:'1px solid #b2c7df',borderRadius:7,padding:'0 6px',background:'#fff',fontSize:12,fontWeight:700,color:'#26496f'}}>
                <option value="">All Goods</option>{filterOptions.goods.map(v=><option key={v} value={v}>{v}</option>)}
              </select>
            </div>
          </th>}
          <th style={{minWidth:145}}>
            <div style={{display:'grid',gap:5}}>
              <span>Client <span aria-hidden="true">▾</span></span>
              <select aria-label="Client column filter" value={clientFilter} onChange={e=>setClientFilter(e.target.value)} style={{minWidth:140,maxWidth:200,height:33,border:'1px solid #b2c7df',borderRadius:7,padding:'0 6px',background:'#fff',fontSize:12,fontWeight:700,color:'#26496f'}}>
                <option value="">All Clients</option>{filterOptions.clients.map(v=><option key={v} value={v}>{v}</option>)}
              </select>
            </div>
          </th>
          <th style={{minWidth:145}}>
            <div style={{display:'grid',gap:5}}>
              <span>Company <span aria-hidden="true">▾</span></span>
              <select aria-label="Company column filter" value={companyFilter} onChange={e=>setCompanyFilter(e.target.value)} style={{minWidth:140,maxWidth:200,height:33,border:'1px solid #b2c7df',borderRadius:7,padding:'0 6px',background:'#fff',fontSize:12,fontWeight:700,color:'#26496f'}}>
                <option value="">All Companies</option>{filterOptions.companies.map(v=><option key={v} value={v}>{v}</option>)}
              </select>
            </div>
          </th>
          <th>Entered By</th><th>Booking Date</th><th>Airline</th><th>Origin</th><th>Via</th><th>Destination</th><th>Bags/Pieces</th><th>Weight</th><th>Flight</th>
          {type==='EXPORT'&&<><th>Departure Date</th><th>Departure Time</th><th>Handover Date (IST)</th><th>Handover</th><th>Master Copy</th></>}
          <th>Arrival Date</th><th>Arrival Time</th>{type==='IMPORT'&&<><th>Mail</th><th>Customs Clear</th></>}<th>Status</th><th>Remarks</th>
        </tr></thead>
        <tbody>{visible.length?visible.map((record,index)=>{const r=record.data||{};return <tr key={record.archiveMonth+'-'+record.shipmentType+'-'+record.awb+'-'+(record.archivePartIndex??'master')}>
          <td><strong>{index+1}</strong></td><td>{formatDate(r.enteredAt)}</td><td><strong>{r.mawb||(`${String(record.awb).slice(0,3)}-${String(record.awb).slice(3)}`)}</strong></td>{type==='IMPORT'&&<td>{r.goodsDescription||r.goods||'—'}</td>}<td>{r.clientName||r.client||'—'}</td><td>{r.companyName||r.companyType||'—'}</td><td>{r.enteredBy||'—'}</td><td>{r.bookingDate||'—'}</td><td>{r.airlineName||'—'}</td><td>{r.origin||'—'}</td><td>{viaForRow(r)}</td><td>{r.destination||'—'}</td><td>{r.bags||r.pieces||'—'}</td><td>{weightValue(r,record.isArchivePart)!==null?`${weightValue(r,record.isArchivePart)} kg`:'—'}</td><td>{r.flightNo||'—'}</td>
          {type==='EXPORT'&&<><td>{r.departureDate||r.flightDate||'—'}</td><td>{formatTime(r.departureTime)}</td><td>{formatDate(confirmedExportHandoverDate(r))}</td><td>{r.handoverDone===true?'YES':'NO'}</td><td>{r.masterCopyReceived===true?'RECEIVED':'PENDING'}</td></>}
          <td>{r.arrivalDate||'—'}</td><td>{formatTime(r.arrivalTime)}</td>{type==='IMPORT'&&<><td>{r.mailSent===true?'YES':'NO'}</td><td>{r.customsCleared===true?'CLEARED':'PENDING'}</td></>}<td><span className={`badge ${statusTone(r.status)}`}>{r.status||'BOOKED'}</span></td><td>{r.remarks||'—'}</td>
        </tr>}):<tr><td className="empty" colSpan={24}>{(search||goodsFilter||clientFilter||companyFilter)?'No records match the selected filters.':month?'No '+type.toLowerCase()+' records in this month.':'No closed-month records yet.'}</td></tr>}</tbody>
      </table></section>
      <section className="tableSummary"><span>{visible.length} master{visible.length===1?'':'s'} shown</span><strong>Total recorded Weight: {totalWeight.toLocaleString(undefined,{maximumFractionDigits:2})} kg{unknownWeights>0?` • ${unknownWeights} row(s) without recorded weight`:''}</strong></section>
    </>}
  </main>;
}
