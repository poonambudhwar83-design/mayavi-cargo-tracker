'use client';

import { useEffect, useMemo, useState } from 'react';
import { STUDY_SUBJECTS, STUDY_SOURCES, studyTotals, pending, theoryIncorrect, mcqIncorrect, mcqAccuracy, marksPercentage, studyTopicNumber, chapterSerial } from '../lib/studyNotes.js';
import styles from './StudyNotesDashboard.module.css';

const API='/api/study-notes';
const CHAPTERS_API='/api/study-chapters';
const blank=()=>({chapter:'',topic:'',source:'',mcqAttempted:'',mcqCorrected:'',mcqTotal:'',mcqDone:'',theoryTotal:'',theoryDone:'',theoryCorrected:'',totalMarks:'',marksObtained:'',
  mcqMarksTotal:'',mcqMarksObtained:'',theoryMarksTotal:'',theoryMarksObtained:'',
  incorrectMcqNumbers:'',incorrectTheoryNumbers:''});
const number=v=>v===''?0:Number(v);
const friendly=subject=>subject==='Mathematics'?'Maths':subject;

export default function StudyNotesDashboard(){
  const [subject,setSubject]=useState('Physics');
  const [rows,setRows]=useState([]);
  const [chapterRegistry,setChapterRegistry]=useState([]);
  const [showNewChapter,setShowNewChapter]=useState(false);
  const [chapterNumber,setChapterNumber]=useState('1');
  const [chapterTitle,setChapterTitle]=useState('');
  const [sourceSelection,setSourceSelection]=useState('');
  const [otherSource,setOtherSource]=useState('');
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
        const chapterResponse=await fetch(CHAPTERS_API,{credentials:'include',cache:'no-store'});
        const chapterData=await chapterResponse.json();
        if(!chapterResponse.ok||!chapterData.ok)
          throw Error(chapterData.error||'Unable to load chapters.');
        if(active){
          setChapterRegistry(chapterData.chapters||[]);
          const first=(chapterData.chapters||[]).find(x=>x.subject==='Physics');
          if(first)setDraft(old=>old.chapter?old:{...old,chapter:first.title});
        }
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
    for(const c of chapterRegistry.filter(c=>c.subject===subject)){
      map.set(c.title.trim(),{chapter:c.title.trim(),chapterIndex:c.number,topics:[]});
    }
    // Newly created chapters can exist before their first subtopic.
    // Legacy chapters are never hidden even if the registry is unavailable.
    for(const row of filtered){
      const key=row.chapter.trim();
      if(!map.has(key))map.set(key,{
        chapter:key,chapterIndex:chapterSerial(key,map.size+1),topics:[]});
      map.get(key).topics.push(row);
    }
    return [...map.values()]
      .sort((a,b)=>a.chapterIndex-b.chapterIndex||
        a.chapter.localeCompare(b.chapter,undefined,{numeric:true}))
      .map(section=>{
        const topics=section.topics.sort((a,b)=>
          (Date.parse(a.createdAt||'')||0)-(Date.parse(b.createdAt||'')||0)||
          a.topic.localeCompare(b.topic,undefined,{numeric:true}));
        const topicOrder={};
        for(const row of topics){
          const key=row.topic.trim().toLowerCase();
          if(topicOrder[key]===undefined)topicOrder[key]=Object.keys(topicOrder).length;
        }
        return {...section,topics,topicOrder,totals:studyTotals(topics)};
      });
  },[filtered,chapterRegistry,subject]);

  function choose(next){
    setSubject(next);
    setEditId('');
    const first=chapterRegistry.find(c=>c.subject===next);
    setDraft({...blank(),chapter:first?.title||''});
    setSourceSelection('');setOtherSource('');setShowNewChapter(false);
    setMessage('');
  }
  function update(field,value){setDraft(old=>({...old,[field]:value}));}
  function edit(row){
    setSubject(row.subject);setEditId(row.id);
    setSourceSelection(STUDY_SOURCES.includes(row.source)?row.source:row.source?'Other':'');
    setOtherSource(STUDY_SOURCES.includes(row.source)?'':row.source||'');
    setDraft({chapter:row.chapter,topic:row.topic,source:row.source||'',
      mcqAttempted:row.mcqAttempted==null?'':String(row.mcqAttempted),
      mcqCorrected:row.mcqCorrected==null?'':String(row.mcqCorrected),
      mcqTotal:String(row.mcqTotal),
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
  function reset(){
    setEditId('');setDraft(old=>({...blank(),chapter:old.chapter}));
    setSourceSelection('');setOtherSource('');setMessage('');
  }
  function newSubtopic(){
    if(editId){setEditId('');}
    setDraft(old=>({...blank(),chapter:old.chapter}));
    setSourceSelection('');setOtherSource('');
    setMessage('Ready to add another subtopic to this chapter.');
  }
  async function createChapter(){
    if(busy)return;
    const number=Number(chapterNumber);
    if(!Number.isInteger(number)||number<1||number>500){
      setMessage('Enter a valid chapter number (1–500).');return;
    }
    setBusy(true);setMessage('');
    try{
      const response=await fetch(CHAPTERS_API,{method:'POST',credentials:'include',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({subject,number,title:chapterTitle})});
      const data=await response.json();
      if(!response.ok||!data.ok)throw Error(data.error||'Unable to add chapter.');
      setChapterRegistry(old=>[...old,data.chapter]);
      setDraft(old=>({...old,chapter:data.chapter.title,topic:''}));
      setShowNewChapter(false);setChapterTitle('');
      setMessage('Chapter '+number+' added. Add its first subtopic below.');
    }catch(e){setMessage(e?.message||'Unable to add chapter.');}
    finally{setBusy(false);}
  }
  async function save(event){
    event.preventDefault();
    if(busy)return;
    setMessage('');
    const payload={...draft,subject,source:draft.source.trim(),
      mcqAttempted:draft.mcqAttempted===''?null:number(draft.mcqAttempted),
      mcqCorrected:draft.mcqCorrected===''?null:number(draft.mcqCorrected),
      mcqTotal:number(draft.mcqTotal),
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
    if(!payload.chapter.trim()||!payload.topic.trim()||(!editId&&!payload.source)){
      setMessage('Select a chapter, enter the subtopic and choose a source.');return;
    }
    if(payload.mcqCorrected!==null&&
      (payload.mcqAttempted===null||payload.mcqCorrected>payload.mcqAttempted)){
      setMessage('MCQ Corrected cannot exceed MCQ Attempted.');return;
    }
    if([payload.mcqAttempted,payload.mcqCorrected].some(x=>
      x!==null&&(!Number.isInteger(x)||x<0||x>100000))){
      setMessage('MCQ Attempted / Corrected must be valid whole numbers.');return;
    }
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
      setDraft({...blank(),chapter:payload.chapter,topic:payload.topic});
      setSourceSelection('');setOtherSource('');
      setEditId('');setMessage('Saved. The chapter and subtopic are selected for the next source.');
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
      if(editId===row.id){setEditId('');setDraft({...blank(),chapter:row.chapter});}
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
      <div className={styles.formHeading}>
        <h2>{editId?'Edit Subtopic':'Add Subtopic'} <span>· {friendly(subject)}</span></h2>
        <button type="button" className={styles.chapterAddButton} disabled={busy}
          onClick={()=>{
            const occupied=new Set(chapterRegistry.filter(c=>c.subject===subject).map(c=>c.number));
            let next=1;while(occupied.has(next))next++;
            setChapterNumber(String(next));setChapterTitle('');setShowNewChapter(old=>!old);
          }}>+ Add Chapter</button>
      </div>
      {showNewChapter&&<div className={styles.newChapterFields}>
        <label>Chapter No.
          <input type="number" min="1" max="500" step="1" value={chapterNumber}
            onChange={e=>setChapterNumber(e.target.value)} placeholder="1, 2, 3"/>
        </label>
        <label>Chapter Name (optional)
          <input value={chapterTitle} maxLength={120} onChange={e=>setChapterTitle(e.target.value)}
            placeholder="e.g. Physical Quantities"/>
        </label>
        <button type="button" disabled={busy} onClick={createChapter}>Save Chapter</button>
      </div>}
      <form onSubmit={save}>
        <div className={styles.noteIdentity}>
          <label>Chapter
            <select value={draft.chapter} required
              onChange={e=>setDraft(old=>({...old,chapter:e.target.value,topic:''}))}>
              <option value="">Select Chapter</option>
              {chapters.map(section=><option key={section.chapter} value={section.chapter}>
                {'Chapter '+section.chapterIndex+' · '+section.chapter}
              </option>)}
            </select>
          </label>
          <label>Subtopic
            <input list="study-subtopic-choices" value={draft.topic} maxLength={180}
              required onChange={e=>update('topic',e.target.value)}
              placeholder="e.g. 1.1 Measurement"/>
            <datalist id="study-subtopic-choices">
              {[...new Set((chapters.find(c=>c.chapter===draft.chapter)?.topics||[])
                .map(x=>x.topic))].map(x=><option key={x} value={x}/>)}
            </datalist>
          </label>
          <label>Source
            <select value={sourceSelection} required={!editId} onChange={e=>{
              const next=e.target.value;
              setSourceSelection(next);setOtherSource('');
              update('source',next==='Other'?'':next);
            }}>
              <option value="">Select Source</option>
              {STUDY_SOURCES.map(x=><option key={x} value={x}>{x}</option>)}
            </select>
          </label>
          {sourceSelection==='Other'&&<label>Other Source Name
            <input value={otherSource} required maxLength={120}
              onChange={e=>{setOtherSource(e.target.value);update('source',e.target.value);}}
              placeholder="Type your source name"/>
          </label>}
        </div>
        <h3 className={styles.notesTypeHeading}>MCQs</h3>
        <div className={styles.compactEntryScroll} aria-label="MCQ entries" tabIndex={0}>
          <div className={styles.compactEntryRow}>
            <label className={styles.compactPair}>MCQ Done / Total
              <span className={styles.pairInputs}>
                <input type="number" inputMode="numeric" min="0" max="100000" step="1"
                  title="MCQ Done" placeholder="Done" value={draft.mcqDone}
                  onChange={e=>update('mcqDone',e.target.value)}/>
                <span>/</span>
                <input type="number" inputMode="numeric" min="0" max="100000" step="1"
                  title="MCQ Total" placeholder="Total" value={draft.mcqTotal}
                  onChange={e=>update('mcqTotal',e.target.value)}/>
              </span>
            </label>
            <div className={styles.compactCalculated}><span>MCQ Pending</span>
              <output className={styles.pendingCount}>{pending(draft.mcqTotal,draft.mcqDone)}</output>
            </div>
            {[
              ['mcqAttempted','MCQ Attempted'],['mcqCorrected','MCQ Corrected']
            ].map(([field,label])=><label className={styles.compactNumber} key={field}>{label}
              <input type="number" min="0" max="100000" step="1" inputMode="numeric"
                placeholder="—" value={draft[field]} onChange={e=>update(field,e.target.value)}/>
            </label>)}
            <div className={styles.compactCalculated}><span>MCQ Incorrect</span>
              <output>{mcqIncorrect(draft.mcqAttempted,draft.mcqCorrected)===null?'—':
                mcqIncorrect(draft.mcqAttempted,draft.mcqCorrected)}</output>
            </div>
            <label className={styles.compactWrong}>Incorrect MCQ Question Numbers
              <input type="text" maxLength={600} placeholder="e.g. 2, 5, 9"
                value={draft.incorrectMcqNumbers}
                onChange={e=>update('incorrectMcqNumbers',e.target.value)}/>
            </label>
            <div className={styles.compactCalculated}><span>MCQ %</span>
              <output>{mcqAccuracy(draft.mcqAttempted,draft.mcqCorrected)===null?'—':
                mcqAccuracy(draft.mcqAttempted,draft.mcqCorrected).toFixed(2)+'%'}</output>
            </div>
          </div>
        </div>
        <h3 className={styles.notesTypeHeading}>Theory</h3>
        <div className={styles.compactEntryScroll} aria-label="Theory entries" tabIndex={0}>
          <div className={styles.compactEntryRow}>
            {[
              ['theoryTotal','Total Theory Questions'],['theoryDone','Theory Attempted'],
              ['theoryCorrected','Theory Corrected']
            ].map(([field,label])=><label className={styles.compactNumber} key={field}>{label}
              <input type="number" inputMode="numeric" min="0" max="100000" step="1"
                placeholder="0" value={draft[field]} onChange={e=>update(field,e.target.value)}/>
            </label>)}
            <div className={styles.compactCalculated}><span>Theory Pending</span>
              <output className={styles.pendingCount}>{pending(draft.theoryTotal,draft.theoryDone)}</output>
            </div>
            <div className={styles.compactCalculated}><span>Theory Incorrect</span>
              <output>{previewIncorrect===null?'—':previewIncorrect}</output>
            </div>
            <label className={styles.compactWrong}>Incorrect Theory Question Numbers
              <input type="text" maxLength={600} placeholder="e.g. 3, 7"
                value={draft.incorrectTheoryNumbers}
                onChange={e=>update('incorrectTheoryNumbers',e.target.value)}/>
            </label>
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
          </div>
        </div>
        <details className={styles.legacyMarksDetails}>
          <summary>Previously saved MCQ / Overall Marks (optional)</summary>
          <div className={styles.legacyMarksFields}>
            {[
              ['mcqMarksTotal','MCQ Total Marks'],['mcqMarksObtained','MCQ Marks Obtained'],
              ['totalMarks','Total Marks'],['marksObtained','Marks Obtained']
            ].map(([field,label])=><label key={field}>{label}
              <input type="number" inputMode="decimal" min="0" max="1000000" step="0.01"
                placeholder="Manual" value={draft[field]}
                onChange={e=>update(field,e.target.value)}/>
            </label>)}
            <div>Overall Marks: {hasSplitDraft||draft.totalMarks!==''?combinedDraftObtained+' / '+combinedDraftTotal:'—'}</div>
            <div>Overall %: {marksPercentage(combinedDraftTotal,combinedDraftObtained)===null?'—':
              marksPercentage(combinedDraftTotal,combinedDraftObtained).toFixed(2)+'%'}</div>
          </div>
        </details>
        <div className={styles.actions}>
          <button type="submit" disabled={busy}>{busy?'Saving…':editId?'Save Changes':'+ Save Subtopic / Source'}</button>
          {editId&&<button type="button" className={styles.cancel} disabled={busy} onClick={reset}>Cancel</button>}
          <button type="button" className={styles.cancel} disabled={busy} onClick={newSubtopic}>+ New Subtopic</button>
          <small>Select the same subtopic again for another source. The selected chapter stays unchanged.</small>
        </div>
      </form>
    </section>
    {message&&<p role="status" className={styles.message}>{message}</p>}
    <section className={styles.chapters}>
      <h2>{friendly(subject)} <span>{chapters.length} chapters</span></h2>
      {loading?<p className={styles.empty}>Loading saved notes…</p>:
      !chapters.length?<p className={styles.empty}>No chapters yet. Use + Add Chapter above.</p>:
      chapters.map(section=><article className={styles.chapter} key={section.chapter}>
        <div className={styles.chapterHeading}>
          <h3>Chapter {section.chapterIndex} · {section.chapter}</h3>
          <small>{Object.keys(section.topicOrder).length} subtopics • {section.topics.length} source entries •
            <span className={styles.pendingCount}> MCQ pending {section.totals.mcqPending}</span> •
            <span className={styles.pendingCount}> Theory pending {section.totals.theoryPending}</span>
            {section.totals.percentage!==null?' • Marks '+section.totals.marksObtained+'/'+section.totals.totalMarks+' ('+section.totals.percentage.toFixed(2)+'%)':''}
          </small>
        </div>
        {!section.topics.length?<p className={styles.empty}>No subtopics in this chapter yet. Select it above to add one.</p>:<>
          <h4 className={styles.resultSubheading}>MCQs</h4>
          <div className={styles.tableWrap}><table>
            <thead><tr>
              <th>No.</th><th>Subtopic</th><th>Source</th>
              <th>MCQ Done / Total</th><th>MCQ Pending</th>
              <th>MCQ Attempted</th><th>MCQ Corrected</th>
              <th>MCQ Incorrect</th><th>Incorrect MCQ Nos.</th><th>MCQ %</th>
              <th>Actions</th>
            </tr></thead>
            <tbody>{section.topics.map((row,topicIndex)=><tr key={row.id}>
              <td className={styles.serial}>{studyTopicNumber(section.chapter,
                section.topicOrder[row.topic.trim().toLowerCase()],section.chapterIndex)}</td>
              <td className={styles.topic}>{row.topic}</td>
              <td className={styles.sourceCell}>{row.source||'—'}</td>
              <td>{row.mcqDone} / {row.mcqTotal}</td>
              <td className={styles.pendingCount}>{pending(row.mcqTotal,row.mcqDone)}</td>
              <td>{row.mcqAttempted===null||row.mcqAttempted===undefined?'—':row.mcqAttempted}</td>
              <td>{row.mcqCorrected===null||row.mcqCorrected===undefined?'—':row.mcqCorrected}</td>
              <td>{mcqIncorrect(row.mcqAttempted,row.mcqCorrected)===null?'—':
                mcqIncorrect(row.mcqAttempted,row.mcqCorrected)}</td>
              <td className={styles.questionNumbers}>{row.incorrectMcqNumbers||'—'}</td>
              <td>{mcqAccuracy(row.mcqAttempted,row.mcqCorrected)===null?'—':
                mcqAccuracy(row.mcqAttempted,row.mcqCorrected).toFixed(2)+'%'}</td>
              <td><div className={styles.rowActions}>
                <button type="button" disabled={busy} onClick={()=>edit(row)}>Edit</button>
                <button type="button" className={styles.delete} disabled={busy}
                  onClick={()=>remove(row)}>Delete</button>
              </div></td>
            </tr>)}</tbody>
          </table></div>
          <h4 className={styles.resultSubheading}>Theory</h4>
          <div className={styles.tableWrap}><table>
            <thead><tr>
              <th>No.</th><th>Subtopic</th><th>Source</th>
              <th>Theory Total</th><th>Theory Attempted</th><th>Theory Pending</th>
              <th>Theory Corrected</th><th>Theory Incorrect</th><th>Incorrect Theory Nos.</th>
              <th>Theory Total Marks</th><th>Theory Marks Obtained</th><th>Theory %</th>
              <th>Overall Marks</th><th>Overall %</th>
            </tr></thead>
            <tbody>{section.topics.map((row,topicIndex)=><tr key={row.id}>
              <td className={styles.serial}>{studyTopicNumber(section.chapter,
                section.topicOrder[row.topic.trim().toLowerCase()],section.chapterIndex)}</td>
              <td className={styles.topic}>{row.topic}</td>
              <td className={styles.sourceCell}>{row.source||'—'}</td>
              <td>{row.theoryTotal}</td>
              <td>{row.theoryDone}</td>
              <td className={styles.pendingCount}>{pending(row.theoryTotal,row.theoryDone)}</td>
              <td>{row.theoryCorrected===null||row.theoryCorrected===undefined?'—':row.theoryCorrected}</td>
              <td>{theoryIncorrect(row.theoryDone,row.theoryCorrected)===null?'—':
                theoryIncorrect(row.theoryDone,row.theoryCorrected)}</td>
              <td className={styles.questionNumbers}>{row.incorrectTheoryNumbers||'—'}</td>
              <td>{row.theoryMarksTotal===null||row.theoryMarksTotal===undefined?'—':row.theoryMarksTotal}</td>
              <td>{row.theoryMarksObtained===null||row.theoryMarksObtained===undefined?'—':row.theoryMarksObtained}</td>
              <td>{marksPercentage(row.theoryMarksTotal,row.theoryMarksObtained)===null?'—':
                marksPercentage(row.theoryMarksTotal,row.theoryMarksObtained).toFixed(2)+'%'}</td>
              <td>{row.totalMarks===null||row.totalMarks===undefined?'—':
                row.marksObtained+' / '+row.totalMarks}</td>
              <td>{marksPercentage(row.totalMarks,row.marksObtained)===null?'—':
                marksPercentage(row.totalMarks,row.marksObtained).toFixed(2)+'%'}</td>
            </tr>)}</tbody>
          </table></div>
        </>}
      </article>)}
    </section>
  </main>;
}
