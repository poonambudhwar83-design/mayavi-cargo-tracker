'use client';

import { useEffect, useMemo, useState } from 'react';
import styles from './AdminNotesDashboard.module.css';
import AdminPaymentsDashboard from './AdminPaymentsDashboard.js';

const API='/api/admin-notes';
const nowIST=()=>new Date(Date.now()+330*60000).toISOString().slice(0,10);
const empty=kind=>({kind,date:nowIST(),venue:'',person:'',purpose:'',topic:'',remarks:''});
const showDate=s=>s?s.split('-').reverse().join('/'):'—';

function shareText(text) {
  // The user chooses WhatsApp recipients. No automatic broadcasts.
  window.open('https://wa.me/?text='+encodeURIComponent(text),'_blank','noopener,noreferrer');
}
export default function AdminNotesDashboard({currentUser}) {
  const [section,setSection]=useState('MEETING');
  const [notes,setNotes]=useState([]);
  const [loaded,setLoaded]=useState(false);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [editing,setEditing]=useState('');
  const [draft,setDraft]=useState(()=>empty('MEETING'));

  useEffect(()=>{
    let live=true;
    (async()=>{
      try {
        const res=await fetch(API,{credentials:'include',cache:'no-store'});
        const data=await res.json();
        if(!res.ok||!data.ok)throw new Error(data.error||'Could not load notes.');
        if(live)setNotes(data.rows||[]);
      } catch(e){if(live)setMessage(e.message||'Unable to load notes.')}
      finally{if(live)setLoaded(true)}
    })();
    return ()=>{live=false};
  },[]);

  const kind=section==='DAILY_UPDATE'?'DAILY_UPDATE':'MEETING';
  const records=useMemo(()=>notes.filter(x=>x.kind===kind).sort((a,b)=>
    String(b.date||'').localeCompare(String(a.date||'')) ||
    String(b.createdAt||'').localeCompare(String(a.createdAt||''))),[notes,kind]);

  function switchTo(next){
    setSection(next);setEditing('');setDraft(empty(next==='DAILY_UPDATE'?'DAILY_UPDATE':'MEETING'));setMessage('');
  }
  function startNew(){setEditing('new');setDraft(empty(kind));setMessage('')}
  function edit(row){
    setEditing(row.id);
    setDraft({kind,date:row.date||nowIST(),venue:row.venue||'',person:row.person||'',
      purpose:row.purpose||'',topic:row.topic||'',remarks:row.remarks||''});
    setMessage('');
  }
  function change(field,value){setDraft(d=>({...d,[field]:value}))}
  async function save(event){
    event.preventDefault();
    if(busy||!editing)return;
    const id=editing;
    setBusy(true);setMessage('');
    try {
      const res=await fetch(API,{method:id==='new'?'POST':'PATCH',credentials:'include',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({...draft,...(id==='new'?{}:{id})})});
      const data=await res.json();
      if(!res.ok||!data.ok)throw new Error(data.error||'Unable to save.');
      setNotes(rows=>id==='new'?[data.row,...rows]:rows.map(r=>r.id===id?data.row:r));
      setEditing('');setDraft(empty(kind));
      setMessage('Saved successfully.');
    }catch(e){setMessage(e.message||'Save failed.')}finally{setBusy(false)}
  }
  async function remove(row){
    if(!window.confirm('Delete this '+(row.kind==='MEETING'?'meeting':'daily update')+'?'))return;
    setBusy(true);setMessage('');
    try {
      const res=await fetch(API+'?id='+encodeURIComponent(row.id),{method:'DELETE',credentials:'include'});
      const data=await res.json();
      if(!res.ok||!data.ok)throw new Error(data.error||'Unable to delete.');
      setNotes(rows=>rows.filter(x=>x.id!==row.id));if(editing===row.id)setEditing('');
      setMessage('Deleted.');
    }catch(e){setMessage(e.message||'Delete failed.')}finally{setBusy(false)}
  }

  function shareOne(row) {
    shareText('MAYAVI — DAILY UPDATE\nDate: '+showDate(row.date)+'\nTopic: '+row.topic+'\nRemarks: '+(row.remarks||'—'));
  }
  function shareAll() {
    if(!records.length)return;
    const contents=['MAYAVI — DAILY UPDATES'];
    records.forEach(row=>contents.push(
      '\nDate: '+showDate(row.date)+'\nTopic: '+row.topic+'\nRemarks: '+(row.remarks||'—')));
    shareText(contents.join('\n'));
  }
  function formRow() {
    const actions=<div className={styles.tableActions}>
      <button type="submit" disabled={busy}>Save</button>
      <button type="button" disabled={busy} onClick={()=>setEditing('')}>Cancel</button>
    </div>;
    return kind==='MEETING'?<tr className={styles.editingRow}>
      <td><input aria-label="Meeting date" type="date" required value={draft.date} onChange={e=>change('date',e.target.value)}/></td>
      <td><input aria-label="Venue" placeholder="Venue" maxLength={250} value={draft.venue} onChange={e=>change('venue',e.target.value)}/></td>
      <td><input aria-label="Person to meet" placeholder="Person to meet" required maxLength={250} value={draft.person} onChange={e=>change('person',e.target.value)}/></td>
      <td><textarea aria-label="Agenda or purpose" placeholder="Agenda / Purpose" required rows={2} value={draft.purpose} onChange={e=>change('purpose',e.target.value)}/></td>
      <td>{actions}</td>
    </tr>:<tr className={styles.editingRow}>
      <td><input aria-label="Update date" type="date" required value={draft.date} onChange={e=>change('date',e.target.value)}/></td>
      <td><input aria-label="Topic" placeholder="Topic" required maxLength={250} value={draft.topic} onChange={e=>change('topic',e.target.value)}/></td>
      <td><textarea aria-label="Remarks" placeholder="Remarks" rows={2} value={draft.remarks} onChange={e=>change('remarks',e.target.value)}/></td>
      <td>{actions}</td>
    </tr>;
  }

  return <main className={styles.page}>
    <header className={styles.header}>
      <div>
        <div className={styles.eyebrow}>MAYAVI CARGO • ADMIN PRIVATE</div>
        <h1>Meetings, Daily Updates &amp; Payments</h1>
        <p>Simple registers for your daily administrative work.</p>
        <small>Admin: {currentUser?.displayName||'Admin'} • Saved in Mayavi</small>
      </div>
      <div className={styles.headerActions}>
        <button type="button" className={section==='MEETING'?styles.selectedTab:styles.secondaryButton} onClick={()=>switchTo('MEETING')}>MEETINGS</button>
        <button type="button" className={section==='DAILY_UPDATE'?styles.selectedTab:styles.secondaryButton} onClick={()=>switchTo('DAILY_UPDATE')}>DAILY UPDATES</button>
        <button type="button" className={section==='PAYMENTS'?styles.selectedTab:styles.secondaryButton} onClick={()=>switchTo('PAYMENTS')}>PAYMENTS</button>
      </div>
    </header>

    {section==='PAYMENTS'?<AdminPaymentsDashboard currentUser={currentUser}/>:<>
      <div className={styles.simpleToolbar}>
        <div><h2>{kind==='MEETING'?'Meetings':'Daily Updates'}</h2><small>{records.length} saved records</small></div>
        <div className={styles.simpleButtons}>
          {kind==='DAILY_UPDATE'&&<button type="button" className={styles.shareButton} disabled={!records.length} onClick={shareAll}>Share All Remarks</button>}
          <button type="button" className={styles.addButton} onClick={startNew} disabled={busy}>+ Add {kind==='MEETING'?'Meeting':'Daily Update'}</button>
        </div>
      </div>
      {message&&<div className={styles.message} role="status">{message}</div>}
      <form onSubmit={save}>
        <div className={styles.simpleTableWrap}>
          <table>
            {kind==='MEETING'?<thead><tr><th>Date</th><th>Venue</th><th>Person to Meet</th><th>Agenda / Purpose</th><th>Actions</th></tr></thead>:
              <thead><tr><th>Date</th><th>Topic</th><th>Remarks</th><th>Actions</th></tr></thead>}
            <tbody>
              {editing==='new'&&formRow()}
              {records.map(row=>editing===row.id?<tr key={row.id} className={styles.editingRow}>
                {kind==='MEETING'?<>
                  <td><input aria-label="Meeting date" required type="date" value={draft.date} onChange={e=>change('date',e.target.value)}/></td>
                  <td><input aria-label="Venue" maxLength={250} value={draft.venue} onChange={e=>change('venue',e.target.value)}/></td>
                  <td><input aria-label="Person to meet" required maxLength={250} value={draft.person} onChange={e=>change('person',e.target.value)}/></td>
                  <td><textarea aria-label="Agenda or purpose" required rows={2} value={draft.purpose} onChange={e=>change('purpose',e.target.value)}/></td>
                </>:<>
                  <td><input aria-label="Update date" required type="date" value={draft.date} onChange={e=>change('date',e.target.value)}/></td>
                  <td><input aria-label="Topic" required maxLength={250} value={draft.topic} onChange={e=>change('topic',e.target.value)}/></td>
                  <td><textarea aria-label="Remarks" rows={2} value={draft.remarks} onChange={e=>change('remarks',e.target.value)}/></td>
                </>}
                <td><div className={styles.tableActions}><button type="submit" disabled={busy}>Save</button><button type="button" disabled={busy} onClick={()=>setEditing('')}>Cancel</button></div></td>
              </tr>:<tr key={row.id}>
                <td>{showDate(row.date)}</td>
                {kind==='MEETING'?<>
                  <td>{row.venue||'—'}</td><td>{row.person||'—'}</td><td className={styles.longCell}>{row.purpose||'—'}</td>
                </>:<><td>{row.topic||'—'}</td><td className={styles.longCell}>{row.remarks||'—'}</td></>}
                <td><div className={styles.tableActions}>
                  <button type="button" disabled={busy} onClick={()=>edit(row)}>Edit</button>
                  {kind==='DAILY_UPDATE'&&<button type="button" className={styles.shareButton} onClick={()=>shareOne(row)}>Share Remarks</button>}
                  <button type="button" className={styles.deleteButton} disabled={busy} onClick={()=>remove(row)}>Delete</button>
                </div></td>
              </tr>)}
              {!loaded&&<tr><td colSpan={kind==='MEETING'?5:4} className={styles.tableEmpty}>Loading…</td></tr>}
              {loaded&&!records.length&&editing!=='new'&&<tr><td colSpan={kind==='MEETING'?5:4} className={styles.tableEmpty}>No records yet. Add the first entry above.</td></tr>}
            </tbody>
          </table>
        </div>
      </form>
      {kind==='DAILY_UPDATE'&&<p className={styles.shareHint}>Share Remarks opens WhatsApp with the update text. You choose the person or group to send it to; Mayavi does not automatically message everyone.</p>}
    </>}
  </main>;
}
