'use client';

import { useEffect, useMemo, useState } from 'react';
import { STUDY_SUBJECTS, studyTotals, pending, marksPercentage } from '../lib/studyNotes.js';
import styles from './StudyNotesDashboard.module.css';

const API='/api/study-notes';
const blank=()=>({chapter:'',topic:'',mcqTotal:'',mcqDone:'',theoryTotal:'',theoryDone:'',totalMarks:'',marksObtained:''});
const number=v=>v===''?0:Number(v);
const friendly=subject=>subject==='Mathematics'?'Maths':subject;

export default function StudyNotesDashboard(){
  const [subject,setSubject]=useState('Physics');
  const [rows,setRows]=useState([]);
  const [draft,setDraft]=useState(blank);
  const [editId,setEditId]=useState('');
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(true);
  const [message,setMessage]=useState('');
  useEffect(()=>{
    let active=true;
    (async()=>{
      try{
        const response=await fetch(API,{credentials:'include',cache:'no-store'});
        const data=await response.json();
        if(!response.ok||!data.ok)throw Error(data.error||'Unable to load notes.');
        if(active)setRows(data.rows||[]);
      }catch(e){if(active)setMessage(e?.message||'Unable to load notes.')}
      finally{if(active)setLoading(false);}
    })();
    return()=>{active=false};
  },[]);

  const filtered=useMemo(()=>rows.filter(row=>row.subject===subject),[rows,subject]);
  const totals=useMemo(()=>studyTotals(filtered),[filtered]);
  const chapters=useMemo(()=>{
    const map=new Map();
    for(const row of filtered){
      const key=row.chapter.trim();
      if(!map.has(key))map.set(key,[]);
      map.get(key).push(row);
    }
    return [...map].sort((a,b)=>a[0].localeCompare(b[0],undefined,{numeric:true,sensitivity:'base'}))
      .map(([chapter,topics])=>({chapter,topics:topics.sort((a,b)=>a.topic.localeCompare(b.topic,undefined,{numeric:true,sensitivity:'base'})),totals:studyTotals(topics)}));
  },[filtered]);

  function choose(next){
    setSubject(next);
    setEditId('');
    setDraft(blank());
    setMessage('');
  }
  function update(field,value){setDraft(old=>({...old,[field]:value}));}
  function edit(row){
    setSubject(row.subject);setEditId(row.id);
    setDraft({chapter:row.chapter,topic:row.topic,mcqTotal:String(row.mcqTotal),
      mcqDone:String(row.mcqDone),theoryTotal:String(row.theoryTotal),theoryDone:String(row.theoryDone),
      totalMarks:row.totalMarks===null?'':String(row.totalMarks),
      marksObtained:row.marksObtained===null?'':String(row.marksObtained)});
    setMessage('Editing '+row.topic+'.');
    window.scrollTo({top:0,behavior:'smooth'});
  }
  function reset(){setEditId('');setDraft(blank());setMessage('');}
  async function save(event){
    event.preventDefault();
    if(busy)return;
    setMessage('');
    const payload={...draft,subject,mcqTotal:number(draft.mcqTotal),
      mcqDone:number(draft.mcqDone),theoryTotal:number(draft.theoryTotal),
      theoryDone:number(draft.theoryDone),
      totalMarks:draft.totalMarks===''?null:draft.totalMarks,
      marksObtained:draft.marksObtained===''?null:draft.marksObtained,
      ...(editId?{id:editId}:{})};
    if([payload.mcqTotal,payload.mcqDone,payload.theoryTotal,payload.theoryDone]
      .some(x=>!Number.isInteger(x)||x<0||x>100000)){
      setMessage('Please enter valid whole-number counts.');return;
    }
    if(payload.mcqDone>payload.mcqTotal||payload.theoryDone>payload.theoryTotal){
      setMessage('Completed questions cannot exceed total questions.');return;
    }
    if((draft.totalMarks==='')!==(draft.marksObtained==='')){
      setMessage('Enter both Total Marks and Marks Obtained, or leave both blank.');return;
    }
    if(draft.totalMarks!==''&&(
      !/^\d+(?:\.\d{1,2})?$/.test(draft.totalMarks)||
      !/^\d+(?:\.\d{1,2})?$/.test(draft.marksObtained)||
      Number(draft.totalMarks)>1000000||
      Number(draft.marksObtained)>Number(draft.totalMarks))){
      setMessage('Marks must be valid and Marks Obtained cannot exceed Total Marks.');return;
    }
    setBusy(true);
    try{
      const response=await fetch(API,{method:editId?'PATCH':'POST',
        credentials:'include',headers:{'content-type':'application/json'},
        body:JSON.stringify(payload)});
      const data=await response.json();
      if(!response.ok||!data.ok)throw Error(data.error||'Unable to save notes.');
      setRows(old=>editId?old.map(row=>row.id===editId?data.row:row):[data.row,...old]);
      setDraft(blank());setEditId('');setMessage('Saved successfully.');
    }catch(e){setMessage(e?.message||'Unable to save notes.');}
    finally{setBusy(false);}
  }
  async function remove(row){
    if(!window.confirm('Delete this topic from Notes?'))return;
    setBusy(true);setMessage('');
    try{
      const response=await fetch(API+'?id='+encodeURIComponent(row.id),{method:'DELETE',credentials:'include'});
      const data=await response.json();
      if(!response.ok||!data.ok)throw Error(data.error||'Unable to delete.');
      setRows(old=>old.filter(item=>item.id!==row.id));
      if(editId===row.id){setEditId('');setDraft(blank());}
      setMessage('Topic removed.');
    }catch(e){setMessage(e?.message||'Unable to delete.');}
    finally{setBusy(false);}
  }

  return <main className={styles.page}>
    <header className={styles.heading}>
      <div>
        <small>PRIVATE • ADMIN</small>
        <h1>NOTES</h1>
        <p>Chapter-wise study record. Add each topic and update question counts whenever needed.</p>
      </div>
    </header>
    <nav className={styles.subjects} aria-label="Study subjects">
      {STUDY_SUBJECTS.map(item=><button type="button" key={item}
        className={subject===item?styles.selected:''}
        aria-pressed={subject===item} onClick={()=>choose(item)}>{friendly(item)}</button>)}
    </nav>
    <section className={styles.stats} aria-label="Selected subject summary">
      <div><span>TOPICS</span><b>{totals.topics}</b></div>
      <div><span>MCQs DONE</span><b>{totals.mcqDone} / {totals.mcqTotal}</b></div>
      <div><span>MCQs PENDING</span><b>{totals.mcqPending}</b></div>
      <div><span>THEORY DONE</span><b>{totals.theoryDone} / {totals.theoryTotal}</b></div>
      <div><span>THEORY PENDING</span><b>{totals.theoryPending}</b></div>
      <div><span>MARKS OBTAINED / TOTAL</span><b>{totals.markedTopics?totals.marksObtained+' / '+totals.totalMarks:'—'}</b></div>
      <div><span>PERCENTAGE</span><b>{totals.percentage===null?'—':totals.percentage.toFixed(2)+'%'}</b></div>
    </section>
    <section className={styles.formPanel}>
      <h2>{editId?'Edit Topic':'Add Topic'} <span>· {friendly(subject)}</span></h2>
      <form onSubmit={save}>
        <div className={styles.textFields}>
          <label>Chapter<input value={draft.chapter} maxLength={120} required
            onChange={e=>update('chapter',e.target.value)} placeholder="e.g. Chapter 1 – Motion"/></label>
          <label>Topic<input value={draft.topic} maxLength={180} required
            onChange={e=>update('topic',e.target.value)} placeholder="e.g. Speed and Velocity"/></label>
        </div>
        <div className={styles.countFields}>
          {[
            ['mcqTotal','MCQ Total'],['mcqDone','MCQ Done'],
            ['theoryTotal','Theory Total'],['theoryDone','Theory Done']
          ].map(([field,label])=><label key={field}>{label}
            <input type="number" inputMode="numeric" min="0" max="100000" step="1"
              placeholder="0" value={draft[field]} onChange={e=>update(field,e.target.value)}/>
          </label>)}
        </div>
        <div className={styles.marksFields}>
          <label>Total Marks
            <input type="number" inputMode="decimal" min="0" max="1000000" step="0.01"
              placeholder="e.g. 100" value={draft.totalMarks}
              onChange={e=>update('totalMarks',e.target.value)}/>
          </label>
          <label>Marks Obtained
            <input type="number" inputMode="decimal" min="0" max="1000000" step="0.01"
              placeholder="e.g. 85" value={draft.marksObtained}
              onChange={e=>update('marksObtained',e.target.value)}/>
          </label>
          <div className={styles.percentagePreview}><small>PERCENTAGE</small>
            <b>{marksPercentage(draft.totalMarks,draft.marksObtained)===null?
              '—':marksPercentage(draft.totalMarks,draft.marksObtained).toFixed(2)+'%'}</b>
          </div>
        </div>
        <div className={styles.actions}>
          <button type="submit" disabled={busy}>{busy?'Saving…':editId?'Save Changes':'+ Save Topic'}</button>
          {editId&&<button type="button" className={styles.cancel} disabled={busy} onClick={reset}>Cancel</button>}
          <small>Pending counts are calculated automatically.</small>
        </div>
      </form>
    </section>
    {message&&<p role="status" className={styles.message}>{message}</p>}
    <section className={styles.chapters}>
      <h2>{friendly(subject)} <span>{chapters.length} chapters</span></h2>
      {loading?<p className={styles.empty}>Loading saved notes…</p>:
      !chapters.length?<p className={styles.empty}>No topics yet. Add the first topic above.</p>:
      chapters.map(section=><article className={styles.chapter} key={section.chapter}>
        <div className={styles.chapterHeading}>
          <h3>{section.chapter}</h3>
          <small>{section.topics.length} topics • MCQ pending {section.totals.mcqPending} • Theory pending {section.totals.theoryPending}
            {section.totals.percentage!==null?' • Marks '+section.totals.marksObtained+'/'+section.totals.totalMarks+' ('+section.totals.percentage.toFixed(2)+'%)':''}</small>
        </div>
        <div className={styles.tableWrap}><table>
          <thead><tr><th>Topic</th><th>MCQ Done / Total</th><th>MCQ Pending</th>
            <th>Theory Done / Total</th><th>Theory Pending</th>
            <th>Marks Obtained / Total</th><th>Percentage</th><th>Actions</th></tr></thead>
          <tbody>{section.topics.map(row=><tr key={row.id}>
            <td className={styles.topic}>{row.topic}</td>
            <td>{row.mcqDone} / {row.mcqTotal}</td>
            <td>{pending(row.mcqTotal,row.mcqDone)}</td>
            <td>{row.theoryDone} / {row.theoryTotal}</td>
            <td>{pending(row.theoryTotal,row.theoryDone)}</td>
            <td>{row.totalMarks===null||row.totalMarks===undefined?'—':row.marksObtained+' / '+row.totalMarks}</td>
            <td>{marksPercentage(row.totalMarks,row.marksObtained)===null?'—':marksPercentage(row.totalMarks,row.marksObtained).toFixed(2)+'%'}</td>
            <td><div className={styles.rowActions}>
              <button type="button" disabled={busy} onClick={()=>edit(row)}>Edit</button>
              <button type="button" className={styles.delete} disabled={busy}
                onClick={()=>remove(row)}>Delete</button>
            </div></td>
          </tr>)}</tbody>
        </table></div>
      </article>)}
    </section>
  </main>;
}
