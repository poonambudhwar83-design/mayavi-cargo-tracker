'use client';

import { useEffect, useMemo, useState } from 'react';
import { STUDY_SUBJECTS, studyTotals, pending, theoryIncorrect, marksPercentage, studyTopicNumber } from '../lib/studyNotes.js';
import styles from './StudyNotesDashboard.module.css';

const API='/api/study-notes';
const blank=()=>({chapter:'',topic:'',mcqTotal:'',mcqDone:'',theoryTotal:'',theoryDone:'',theoryCorrected:'',totalMarks:'',marksObtained:'',
  mcqMarksTotal:'',mcqMarksObtained:'',theoryMarksTotal:'',theoryMarksObtained:'',
  incorrectMcqNumbers:'',incorrectTheoryNumbers:''});
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
  const theoryPreviewTotal=draft.theoryMarksTotal;
  const theoryPreviewObtained=draft.theoryMarksObtained;
  // Attempted and corrected counts do not write or prefill theory marks.
  const hasSplitDraft=['mcqMarksTotal','mcqMarksObtained','theoryMarksTotal','theoryMarksObtained']
    .some(field=>draft[field]!=='');
  const combinedDraftTotal=hasSplitDraft
    ?Number(draft.mcqMarksTotal||0)+Number(theoryPreviewTotal||0):draft.totalMarks;
  const combinedDraftObtained=hasSplitDraft
    ?Number(draft.mcqMarksObtained||0)+Number(theoryPreviewObtained||0):draft.marksObtained;
  const previewIncorrect=theoryIncorrect(draft.theoryDone,draft.theoryCorrected);
  const chapters=useMemo(()=>{
    const map=new Map();
    for(const row of filtered){
      const key=row.chapter.trim();
      if(!map.has(key))map.set(key,[]);
      map.get(key).push(row);
    }
    return [...map].sort((a,b)=>a[0].localeCompare(b[0],undefined,{numeric:true,sensitivity:'base'}))
      .map(([chapter,topics],chapterIndex)=>({
        chapter,chapterIndex:chapterIndex+1,
        // Original entry order: editing a topic must NOT change its 1.1/1.2 number.
        topics:topics.sort((a,b)=>
          (Date.parse(a.createdAt||'')||0)-(Date.parse(b.createdAt||'')||0)||
          a.topic.localeCompare(b.topic,undefined,{numeric:true,sensitivity:'base'})),
        totals:studyTotals(topics)
      }));
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
      theoryCorrected:row.theoryCorrected===null||row.theoryCorrected===undefined?'':String(row.theoryCorrected),
      totalMarks:row.totalMarks===null?'':String(row.totalMarks),
      marksObtained:row.marksObtained===null?'':String(row.marksObtained),
      mcqMarksTotal:row.mcqMarksTotal===null||row.mcqMarksTotal===undefined?'':String(row.mcqMarksTotal),
      mcqMarksObtained:row.mcqMarksObtained===null||row.mcqMarksObtained===undefined?'':String(row.mcqMarksObtained),
      theoryMarksTotal:row.theoryMarksTotal===null||row.theoryMarksTotal===undefined?'':String(row.theoryMarksTotal),
      theoryMarksObtained:row.theoryMarksObtained===null||row.theoryMarksObtained===undefined?'':String(row.theoryMarksObtained),
      incorrectMcqNumbers:row.incorrectMcqNumbers||'',
      incorrectTheoryNumbers:row.incorrectTheoryNumbers||''});
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
      theoryCorrected:draft.theoryCorrected===''?null:number(draft.theoryCorrected),
      totalMarks:draft.totalMarks===''?null:draft.totalMarks,
      marksObtained:draft.marksObtained===''?null:draft.marksObtained,
      mcqMarksTotal:draft.mcqMarksTotal===''?null:draft.mcqMarksTotal,
      mcqMarksObtained:draft.mcqMarksObtained===''?null:draft.mcqMarksObtained,
      theoryMarksTotal:draft.theoryMarksTotal===''?null:draft.theoryMarksTotal,
      theoryMarksObtained:draft.theoryMarksObtained===''?null:draft.theoryMarksObtained,
      ...(editId?{id:editId}:{})};
    if([payload.mcqTotal,payload.mcqDone,payload.theoryTotal,payload.theoryDone]
      .some(x=>!Number.isInteger(x)||x<0||x>100000)){
      setMessage('Please enter valid whole-number counts.');return;
    }
    if(payload.theoryCorrected!==null&&(!Number.isInteger(payload.theoryCorrected)||payload.theoryCorrected<0||payload.theoryCorrected>payload.theoryDone)){
      setMessage('Theory Corrected must be between 0 and Theory Attempted.');return;
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
    for(const [label,total,obtained] of [
      ['MCQ',draft.mcqMarksTotal,draft.mcqMarksObtained],
      ['Theory',draft.theoryMarksTotal,draft.theoryMarksObtained]
    ]){
      if((total==='')!==(obtained==='')){
        setMessage('Enter both '+label+' Total Marks and Marks Obtained.');return;
      }
      if(total!==''&&(
        !/^\d+(?:\.\d{1,2})?$/.test(total)||
        !/^\d+(?:\.\d{1,2})?$/.test(obtained)||
        Number(obtained)>Number(total)||Number(total)>1000000)){
        setMessage('Check '+label+' marks: Obtained must not exceed Total.');return;
      }
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
        <p>Chapter-wise study record. Topics are numbered automatically (1.1, 1.2, 1.3…).</p>
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
      <div className={styles.pendingCard}><span>MCQs PENDING</span><b>{totals.mcqPending}</b></div>
      <div><span>THEORY ATTEMPTED</span><b>{totals.theoryDone} / {totals.theoryTotal}</b></div>
      <div><span>THEORY CORRECTED</span><b>{totals.theoryGradedTopics?totals.theoryCorrected:'—'}</b></div>
      <div><span>THEORY INCORRECT</span><b>{totals.theoryGradedTopics?totals.theoryIncorrect:'—'}</b></div>
      <div className={styles.pendingCard}><span>THEORY PENDING</span><b>{totals.theoryPending}</b></div>
      <div><span>MCQ MARKS</span><b>{totals.mcqMarkedTopics?totals.mcqMarksObtained+' / '+totals.mcqMarksTotal+' ('+totals.mcqPercentage.toFixed(2)+'%)':'—'}</b></div>
      <div><span>THEORY MARKS</span><b>{totals.theoryMarkedTopics?totals.theoryMarksObtained+' / '+totals.theoryMarksTotal+' ('+totals.theoryPercentage.toFixed(2)+'%)':'—'}</b></div>
      <div><span>MARKS OBTAINED / TOTAL</span><b>{totals.markedTopics?totals.marksObtained+' / '+totals.totalMarks:'—'}</b></div>
      <div><span>PERCENTAGE</span><b>{totals.percentage===null?'—':totals.percentage.toFixed(2)+'%'}</b></div>
    </section>
    <section className={styles.formPanel}>
      <h2>{editId?'Edit Topic':'Add Topic'} <span>· {friendly(subject)}</span></h2>
      <form onSubmit={save}>
        {/* A single scrollable row replaces the repeated stacked count,
            formula and marks panels. Every saved field remains editable. */}
        <div className={styles.compactEntryScroll} aria-label="Topic details — scroll horizontally for all columns" tabIndex={0}>
          <div className={styles.compactEntryRow}>
            <label className={styles.compactChapter}>Chapter
              <input value={draft.chapter} maxLength={120} required
                onChange={e=>update('chapter',e.target.value)} placeholder="Chapter 1"/>
            </label>
            <label className={styles.compactTopic}>Topic
              <input value={draft.topic} maxLength={180} required
                onChange={e=>update('topic',e.target.value)} placeholder="Topic name"/>
            </label>
            {[
              ['mcqTotal','MCQ Total'],['mcqDone','MCQ Done']
            ].map(([field,label])=><label className={styles.compactNumber} key={field}>{label}
              <input type="number" inputMode="numeric" min="0" max="100000" step="1"
                placeholder="0" value={draft[field]} onChange={e=>update(field,e.target.value)}/>
            </label>)}
            <div className={styles.compactCalculated} title="MCQ Total minus MCQ Done">
              <span>MCQ Pending</span><output className={styles.pendingCount}>{pending(draft.mcqTotal,draft.mcqDone)}</output>
            </div>
            <label className={styles.compactWrong}>Incorrect MCQ Question Numbers
              <input type="text" maxLength={600} placeholder="e.g. 2, 5, 9"
                value={draft.incorrectMcqNumbers}
                onChange={e=>update('incorrectMcqNumbers',e.target.value)}/>
            </label>
            {[
              ['theoryTotal','Total Theory Questions'],['theoryDone','Theory Attempted'],
              ['theoryCorrected','Theory Corrected']
            ].map(([field,label])=><label className={styles.compactNumber} key={field}>{label}
              <input type="number" inputMode="numeric" min="0" max="100000" step="1"
                placeholder="0" value={draft[field]} onChange={e=>update(field,e.target.value)}/>
            </label>)}
            <div className={styles.compactCalculated} title="Theory Total minus Attempted">
              <span>Theory Pending</span><output className={styles.pendingCount}>{pending(draft.theoryTotal,draft.theoryDone)}</output>
            </div>
            <div className={styles.compactCalculated} title="Theory Attempted minus Corrected">
              <span>Theory Incorrect</span><output>{previewIncorrect===null?'—':previewIncorrect}</output>
            </div>
            <label className={styles.compactWrong}>Incorrect Theory Question Numbers
              <input type="text" maxLength={600} placeholder="e.g. 3, 7"
                value={draft.incorrectTheoryNumbers}
                onChange={e=>update('incorrectTheoryNumbers',e.target.value)}/>
            </label>
            <label className={styles.compactMarks}>MCQ Total Marks
              <input type="number" inputMode="decimal" min="0" max="1000000" step="0.01"
                placeholder="Manual" value={draft.mcqMarksTotal}
                onChange={e=>update('mcqMarksTotal',e.target.value)}/>
            </label>
            <label className={styles.compactMarks}>MCQ Marks Obtained
              <input type="number" inputMode="decimal" min="0" max="1000000" step="0.01"
                placeholder="Manual" value={draft.mcqMarksObtained}
                onChange={e=>update('mcqMarksObtained',e.target.value)}/>
            </label>
            <div className={styles.compactCalculated}><span>MCQ %</span>
              <output>{marksPercentage(draft.mcqMarksTotal,draft.mcqMarksObtained)===null?'—':
                marksPercentage(draft.mcqMarksTotal,draft.mcqMarksObtained).toFixed(2)+'%'}</output>
            </div>
            <label className={styles.compactMarks}>Theory Total Marks (manual)
              <input type="number" inputMode="decimal" min="0" max="1000000" step="0.01"
                placeholder="Manual" value={draft.theoryMarksTotal}
                onChange={e=>update('theoryMarksTotal',e.target.value)}/>
            </label>
            <label className={styles.compactMarks}>Theory Marks Obtained (manual)
              <input type="number" inputMode="decimal" min="0" max="1000000" step="0.01"
                placeholder="Manual" value={draft.theoryMarksObtained}
                onChange={e=>update('theoryMarksObtained',e.target.value)}/>
            </label>
            <div className={styles.compactCalculated}><span>Theory %</span>
              <output>{marksPercentage(theoryPreviewTotal,theoryPreviewObtained)===null?'—':
                marksPercentage(theoryPreviewTotal,theoryPreviewObtained).toFixed(2)+'%'}</output>
            </div>
            <div className={styles.compactCalculated}><span>Overall Marks</span>
              <output>{hasSplitDraft||draft.totalMarks!==''?combinedDraftObtained+' / '+combinedDraftTotal:'—'}</output>
            </div>
            <div className={styles.compactCalculated}><span>Overall %</span>
              <output>{marksPercentage(combinedDraftTotal,combinedDraftObtained)===null?'—':
                marksPercentage(combinedDraftTotal,combinedDraftObtained).toFixed(2)+'%'}</output>
            </div>
          </div>
        </div>
        {draft.totalMarks!==''&&
          <p className={styles.compactLegacyHint}>{hasSplitDraft
            ?'Existing overall marks will be updated from the manually entered MCQ/Theory marks when saved.'
            :'Existing overall marks remain saved: '+draft.marksObtained+' / '+draft.totalMarks+'.'}</p>}
        <div className={styles.actions}>
          <button type="submit" disabled={busy}>{busy?'Saving…':editId?'Save Changes':'+ Save Topic'}</button>
          {editId&&<button type="button" className={styles.cancel} disabled={busy} onClick={reset}>Cancel</button>}
          <small>All details are in one row. Scroll sideways for more columns; Theory marks remain manual and saved question numbers stay editable.</small>
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
          <small>{section.topics.length} topics • <span className={styles.pendingCount}>MCQ pending {section.totals.mcqPending}</span> • <span className={styles.pendingCount}>Theory pending {section.totals.theoryPending}</span>
            {section.totals.percentage!==null?' • Marks '+section.totals.marksObtained+'/'+section.totals.totalMarks+' ('+section.totals.percentage.toFixed(2)+'%)':''}</small>
        </div>
        <div className={styles.tableWrap}><table>
          <thead><tr><th>No.</th><th>Topic</th><th>MCQ Done / Total</th><th>MCQ Pending</th>
            <th>Theory Total</th><th>Theory Attempted</th><th>Theory Pending</th>
            <th>Theory Corrected</th><th>Theory Incorrect</th>
            <th>Incorrect MCQ Nos.</th><th>Incorrect Theory Nos.</th>
            <th>MCQ Marks</th><th>MCQ %</th><th>Theory Total Marks</th><th>Theory Marks Obtained</th><th>Theory %</th>
            <th>Overall Marks</th><th>Overall %</th><th>Actions</th></tr></thead>
          <tbody>{section.topics.map((row,topicIndex)=><tr key={row.id}>
            <td className={styles.serial}>{studyTopicNumber(section.chapter,topicIndex,section.chapterIndex)}</td>
            <td className={styles.topic}>{row.topic}</td>
            <td>{row.mcqDone} / {row.mcqTotal}</td>
            <td className={styles.pendingCount}>{pending(row.mcqTotal,row.mcqDone)}</td>
            <td>{row.theoryTotal}</td>
            <td>{row.theoryDone}</td>
            <td className={styles.pendingCount}>{pending(row.theoryTotal,row.theoryDone)}</td>
            <td>{row.theoryCorrected===null||row.theoryCorrected===undefined?'—':row.theoryCorrected}</td>
            <td>{theoryIncorrect(row.theoryDone,row.theoryCorrected)===null?'—':theoryIncorrect(row.theoryDone,row.theoryCorrected)}</td>
            <td className={styles.questionNumbers}>{row.incorrectMcqNumbers||'—'}</td>
            <td className={styles.questionNumbers}>{row.incorrectTheoryNumbers||'—'}</td>
            <td>{row.mcqMarksTotal===null||row.mcqMarksTotal===undefined?'—':row.mcqMarksObtained+' / '+row.mcqMarksTotal}</td>
            <td>{marksPercentage(row.mcqMarksTotal,row.mcqMarksObtained)===null?'—':marksPercentage(row.mcqMarksTotal,row.mcqMarksObtained).toFixed(2)+'%'}</td>
            <td>{row.theoryMarksTotal===null||row.theoryMarksTotal===undefined?'—':row.theoryMarksTotal}</td>
            <td>{row.theoryMarksObtained===null||row.theoryMarksObtained===undefined?'—':row.theoryMarksObtained}</td>
            <td>{marksPercentage(row.theoryMarksTotal,row.theoryMarksObtained)===null?'—':marksPercentage(row.theoryMarksTotal,row.theoryMarksObtained).toFixed(2)+'%'}</td>
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
