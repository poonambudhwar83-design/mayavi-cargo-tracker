'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import styles from './IGCSEProgressScanner.module.css';

const STORE='igcse_progress_scanner_v1';
const DEFAULT_SUBJECTS=['Mathematics','Biology','English'];
const DEFAULT_SOURCES=['Tuition','Save My Exams','Past Papers','School','Self Practice'];
const DOC_TYPES=[
  ['notes','Notes / Revision PDF'],
  ['questions','Question Paper'],
  ['marking','Marking Scheme'],
  ['answers','Student Handwritten Answers']
];

const STOP=new Set('the a an and or of to in on for with from is are was were be been being this that these those it its as at by if then than into about over under question answer mark marks award allow accept not no do does did can could may should would'.split(' '));

function uid(){return crypto.randomUUID?.()||Math.random().toString(36).slice(2)}
function clamp(n,a,b){return Math.max(a,Math.min(b,n))}
function normalizeText(s=''){return String(s).toLowerCase().replace(/[^a-z0-9%+\-./()\s]/g,' ').replace(/\s+/g,' ').trim()}
function tokens(s=''){return normalizeText(s).split(' ').filter(x=>x.length>3&&!STOP.has(x))}
function pct(a,b){return b?Math.round((Number(a||0)/Number(b))*1000)/10:0}
function avg(list=[]){return list.length?Math.round(list.reduce((a,b)=>a+b,0)/list.length*10)/10:0}

function splitBlocks(text=''){
  const clean=String(text||'').replace(/\r/g,'\n');
  const re=/(?:^|\n)\s*(\d{1,2}(?:\s*\([a-z]\))?(?:\s*\([ivx]+\))?)\s*[.)\-:]?\s*/gim;
  const hits=[...clean.matchAll(re)];
  if(!hits.length)return [{id:'Paper',text:clean.trim()}].filter(x=>x.text);
  return hits.map((m,i)=>({id:m[1].replace(/\s+/g,''),text:clean.slice(m.index+m[0].length,hits[i+1]?.index??clean.length).trim()})).filter(x=>x.text);
}
function maxMarksFrom(text=''){
  const patterns=[/\[(\d{1,2})\]/g,/\b(\d{1,2})\s*marks?\b/gi,/\bmax(?:imum)?\s*(\d{1,2})\b/gi];
  let found=[];
  for(const re of patterns)found.push(...[...String(text).matchAll(re)].map(m=>Number(m[1])));
  return found.length?Math.max(...found):0;
}
function keyPoints(ms=''){
  return String(ms||'').split(/\n|;/).map(x=>x.replace(/^\s*[•\-*–—]+\s*/,'').trim()).filter(x=>x.length>4).slice(0,18);
}
function overlapScore(answer='',point=''){
  const a=new Set(tokens(answer)), p=tokens(point);
  if(!p.length)return 0;
  let hit=0;
  p.forEach(t=>{if(a.has(t))hit++});
  return hit/p.length;
}
function draftGrade(msText='',answerText=''){
  const msBlocks=splitBlocks(msText), ansBlocks=splitBlocks(answerText);
  const ansMap=new Map(ansBlocks.map(x=>[x.id,x.text]));
  const fallback=answerText;
  return msBlocks.map((m,i)=>{
    const answer=ansMap.get(m.id)||ansBlocks[i]?.text||fallback;
    const points=keyPoints(m.text);
    let max=maxMarksFrom(m.text);
    if(!max)max=clamp(points.length||1,1,12);
    const pointScores=points.length?points.map(p=>overlapScore(answer,p)):[0];
    const strong=pointScores.filter(x=>x>=0.55).length;
    const partial=pointScores.filter(x=>x>=0.3&&x<0.55).length;
    const coverage=points.length?clamp((strong+partial*0.45)/Math.max(1,Math.min(points.length,max)),0,1):0;
    const awarded=clamp(Math.round(max*coverage),0,max);
    return {id:m.id||String(i+1),max,auto:awarded,awarded,coverage:Math.round(coverage*100),answerPreview:answer.slice(0,220),markingPreview:m.text.slice(0,220)};
  });
}

async function imageToCanvas(file){
  const url=URL.createObjectURL(file);
  try{
    const img=new Image();
    await new Promise((res,rej)=>{img.onload=res;img.onerror=rej;img.src=url});
    const scale=Math.max(1,Math.min(2.4,2200/Math.max(img.width,img.height)));
    const c=document.createElement('canvas');c.width=Math.round(img.width*scale);c.height=Math.round(img.height*scale);
    c.getContext('2d').drawImage(img,0,0,c.width,c.height);
    return c;
  }finally{URL.revokeObjectURL(url)}
}
function preprocess(canvas){
  const c=document.createElement('canvas');c.width=canvas.width;c.height=canvas.height;
  const x=c.getContext('2d');x.drawImage(canvas,0,0);
  const im=x.getImageData(0,0,c.width,c.height),d=im.data;
  for(let i=0;i<d.length;i+=4){
    const g=0.299*d[i]+0.587*d[i+1]+0.114*d[i+2];
    const v=g<190?Math.max(0,(g-85)*1.65):Math.min(255,220+(g-190)*0.6);
    d[i]=d[i+1]=d[i+2]=v;
  }
  x.putImageData(im,0,0);return c;
}
async function pdfCanvases(file,setProgress){
  const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/'+pdfjs.version+'/pdf.worker.min.mjs';
  const data=new Uint8Array(await file.arrayBuffer());
  const pdf=await pdfjs.getDocument({data}).promise;
  const canvases=[];
  for(let i=1;i<=pdf.numPages;i++){
    setProgress?.('Rendering PDF page '+i+' of '+pdf.numPages);
    const page=await pdf.getPage(i),vp=page.getViewport({scale:2.1});
    const c=document.createElement('canvas');c.width=Math.floor(vp.width);c.height=Math.floor(vp.height);
    await page.render({canvasContext:c.getContext('2d'),viewport:vp}).promise;
    canvases.push(c);
  }
  return canvases;
}
async function scanDocument(file,kind,setProgress){
  const {createWorker,PSM}=await import('tesseract.js');
  const worker=await createWorker('eng',1,{logger:m=>{if(m.status)setProgress?.(m.status+' '+(m.progress?Math.round(m.progress*100)+'%':''))}});
  await worker.setParameters({preserve_interword_spaces:'1',user_defined_dpi:'300',tessedit_pageseg_mode:PSM.SPARSE_TEXT});
  try{
    const pages=file.type==='application/pdf'?await pdfCanvases(file,setProgress):[await imageToCanvas(file)];
    const out=[];
    for(let i=0;i<pages.length;i++){
      setProgress?.('Scanning page '+(i+1)+' of '+pages.length);
      const primary=preprocess(pages[i]);
      let a=await worker.recognize(primary);
      if(kind==='answers'&&(a.data.confidence||0)<68){
        await worker.setParameters({tessedit_pageseg_mode:PSM.SINGLE_BLOCK});
        const b=await worker.recognize(pages[i]);
        if((b.data.confidence||0)>(a.data.confidence||0))a=b;
        await worker.setParameters({tessedit_pageseg_mode:PSM.SPARSE_TEXT});
      }
      out.push({page:i+1,text:a.data.text||'',confidence:Math.round(a.data.confidence||0)});
    }
    return {text:out.map(x=>'--- Page '+x.page+' ---\n'+x.text).join('\n'),pages:out,confidence:Math.round(avg(out.map(x=>x.confidence)))};
  }finally{await worker.terminate()}
}

export default function IGCSEProgressScanner(){
  const [data,setData]=useState({subjects:DEFAULT_SUBJECTS,sources:DEFAULT_SOURCES,attempts:[]});
  const [subject,setSubject]=useState(DEFAULT_SUBJECTS[0]);
  const [source,setSource]=useState(DEFAULT_SOURCES[0]);
  const [docs,setDocs]=useState({});
  const [scanState,setScanState]=useState({});
  const [grading,setGrading]=useState([]);
  const [title,setTitle]=useState('');
  const [topic,setTopic]=useState('');
  const [notice,setNotice]=useState('Upload PDFs/photos. Handwritten answers get a second OCR pass when confidence is low.');
  const importRef=useRef(null);

  useEffect(()=>{try{const raw=localStorage.getItem(STORE);if(raw){const parsed=JSON.parse(raw);setData(parsed);setSubject(parsed.subjects?.[0]||DEFAULT_SUBJECTS[0]);setSource(parsed.sources?.[0]||DEFAULT_SOURCES[0])}}catch{}},[]);
  useEffect(()=>{try{localStorage.setItem(STORE,JSON.stringify(data))}catch{}},[data]);

  const subjectAttempts=useMemo(()=>data.attempts.filter(x=>x.subject===subject),[data.attempts,subject]);
  const overall=useMemo(()=>pct(data.attempts.reduce((a,x)=>a+x.score,0),data.attempts.reduce((a,x)=>a+x.max,0)),[data.attempts]);
  const subjectPct=useMemo(()=>pct(subjectAttempts.reduce((a,x)=>a+x.score,0),subjectAttempts.reduce((a,x)=>a+x.max,0)),[subjectAttempts]);

  async function onFile(kind,file){
    if(!file)return;
    setDocs(d=>({...d,[kind]:{fileName:file.name,text:'',confidence:0,pages:[]}}));
    setScanState(s=>({...s,[kind]:'Starting scan…'}));
    try{
      const result=await scanDocument(file,kind,msg=>setScanState(s=>({...s,[kind]:msg})));
      setDocs(d=>({...d,[kind]:{fileName:file.name,...result}}));
      setScanState(s=>({...s,[kind]:'Done · OCR confidence '+result.confidence+'%'}));
      setNotice(kind==='answers'&&result.confidence<70?'Handwriting confidence is low. Please review the extracted answer text before final marks.':'Scan completed.');
    }catch(e){
      setScanState(s=>({...s,[kind]:'Scan failed'}));
      setNotice('Scanner error: '+(e?.message||e));
    }
  }
  function buildDraft(){
    if(!docs.marking?.text||!docs.answers?.text){setNotice('Marking Scheme and Student Answers are required for draft marking.');return}
    const rows=draftGrade(docs.marking.text,docs.answers.text);
    setGrading(rows);
    setNotice('Draft marks prepared. Review low-confidence OCR and adjust any question mark before saving.');
  }
  function updateAward(id,value){setGrading(g=>g.map(x=>x.id===id?{...x,awarded:clamp(Number(value||0),0,x.max)}:x))}
  function saveAttempt(){
    if(!grading.length){setNotice('Create draft marking first.');return}
    const score=grading.reduce((a,x)=>a+Number(x.awarded||0),0),max=grading.reduce((a,x)=>a+Number(x.max||0),0);
    const attempt={id:uid(),date:new Date().toISOString(),subject,source,title:title||'Untitled assessment',topic,score,max,percentage:pct(score,max),questions:grading,ocr:{marking:docs.marking?.confidence||0,answers:docs.answers?.confidence||0}};
    setData(d=>({...d,attempts:[attempt,...d.attempts]}));setNotice('Assessment saved to progress history.');setTitle('');setTopic('');
  }
  function addSubject(){const name=prompt('Subject name');if(name&&!data.subjects.includes(name)){setData(d=>({...d,subjects:[...d.subjects,name]}));setSubject(name)}}
  function addSource(){const name=prompt('New source/tab name');if(name&&!data.sources.includes(name)){setData(d=>({...d,sources:[...d.sources,name]}));setSource(name)}}
  function resetAssessment(){setDocs({});setScanState({});setGrading([]);setTitle('');setTopic('');setNotice('New assessment ready.')}
  function exportData(){
    const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='igcse-progress-backup.json';a.click();URL.revokeObjectURL(url);
  }
  function importData(file){if(!file)return;const r=new FileReader();r.onload=()=>{try{const v=JSON.parse(r.result);if(Array.isArray(v.subjects)&&Array.isArray(v.attempts)){setData(v);setNotice('Backup imported.')}}catch{setNotice('Invalid backup file.')}};r.readAsText(file)}

  return <main className={styles.shell}>
    <header className={styles.hero}>
      <div><div className={styles.eyebrow}>IGCSE STUDY PROGRESS • HANDWRITING-FIRST SCANNER</div><h1>Progress Scanner & Marking Dashboard</h1><p>Scan notes, question papers, marking schemes and handwritten answer scripts. Keep every subject and practice source separate, then track marks and percentages over time.</p></div>
      <div className={styles.heroStats}><div><b>{overall}%</b><span>Overall</span></div><div><b>{data.attempts.length}</b><span>Saved attempts</span></div><button onClick={exportData}>Backup</button><button onClick={()=>importRef.current?.click()}>Restore</button><input ref={importRef} hidden type="file" accept=".json" onChange={e=>importData(e.target.files?.[0])}/></div>
    </header>

    <section className={styles.subjectBar}>
      <div className={styles.subjectButtons}>{data.subjects.map(s=><button key={s} className={s===subject?styles.active:''} onClick={()=>setSubject(s)}>{s}</button>)}<button onClick={addSubject}>+ Subject</button></div>
      <div className={styles.sourceButtons}>{data.sources.map(s=><button key={s} className={s===source?styles.activeSource:''} onClick={()=>setSource(s)}>{s}</button>)}<button onClick={addSource}>+ Tab</button></div>
    </section>

    <section className={styles.summary}>
      <div><span>{subject}</span><b>{subjectPct}%</b><small>Subject average</small></div>
      <div><span>{source}</span><b>{subjectAttempts.filter(x=>x.source===source).length}</b><small>Attempts in this tab</small></div>
      <div><span>OCR rule</span><b>Review &gt; Guess</b><small>Low-confidence handwriting is flagged</small></div>
    </section>

    <section className={styles.card}>
      <div className={styles.cardTitle}><div><h2>1. New assessment</h2><p>Question paper + marking scheme + handwritten answers are the core set. Notes are optional reference material.</p></div><button onClick={resetAssessment}>New / Clear</button></div>
      <div className={styles.metaGrid}><label>Assessment title<input value={title} onChange={e=>setTitle(e.target.value)} placeholder="e.g. Biology Transport Topical"/></label><label>Topic / chapter<input value={topic} onChange={e=>setTopic(e.target.value)} placeholder="e.g. Transport in Humans"/></label></div>
      <div className={styles.uploadGrid}>
        {DOC_TYPES.map(([kind,label])=><label key={kind} className={styles.uploadBox}>
          <strong>{label}</strong><span>{docs[kind]?.fileName||'Upload PDF, JPG, PNG or WEBP'}</span>
          <input type="file" accept=".pdf,image/*" onChange={e=>onFile(kind,e.target.files?.[0])}/>
          <em>{scanState[kind]||''}</em>
          {docs[kind]?.text&&<details><summary>Review OCR text</summary><textarea value={docs[kind].text} onChange={e=>setDocs(d=>({...d,[kind]:{...d[kind],text:e.target.value}}))}/></details>}
        </label>)}
      </div>
      <div className={styles.actionRow}><button className={styles.primary} onClick={buildDraft}>Create Draft Marks</button><span>{notice}</span></div>
    </section>

    <section className={styles.card}>
      <div className={styles.cardTitle}><div><h2>2. Question-wise marking</h2><p>Auto marks are a draft. You can correct any mark before it becomes part of progress history.</p></div>{grading.length>0&&<button className={styles.primary} onClick={saveAttempt}>Save Result</button>}</div>
      {grading.length?<div className={styles.gradeList}>{grading.map(q=><article key={q.id} className={styles.gradeRow}>
        <div className={styles.qid}>Q {q.id}</div><div className={styles.gradeBody}><div className={styles.cover}><span>Mark-scheme coverage</span><div><i style={{width:q.coverage+'%'}}></i></div><b>{q.coverage}%</b></div><details><summary>Compare extracted answer with marking scheme</summary><div className={styles.compare}><p><b>Student:</b> {q.answerPreview||'No OCR text found'}</p><p><b>Mark scheme:</b> {q.markingPreview||'No marking text found'}</p></div></details></div>
        <label className={styles.markBox}>Marks<input type="number" min="0" max={q.max} value={q.awarded} onChange={e=>updateAward(q.id,e.target.value)}/><span>/ {q.max}</span></label>
      </article>)}</div>:<div className={styles.empty}>No draft marking yet.</div>}
      {grading.length>0&&<div className={styles.totalLine}><b>Total {grading.reduce((a,x)=>a+Number(x.awarded||0),0)} / {grading.reduce((a,x)=>a+Number(x.max||0),0)}</b><strong>{pct(grading.reduce((a,x)=>a+Number(x.awarded||0),0),grading.reduce((a,x)=>a+Number(x.max||0),0))}%</strong></div>}
    </section>

    <section className={styles.card}>
      <div className={styles.cardTitle}><div><h2>3. {subject} progress</h2><p>Separate history for each subject; filter further using the source tabs above.</p></div></div>
      <div className={styles.history}>
        {subjectAttempts.filter(x=>x.source===source).length?subjectAttempts.filter(x=>x.source===source).map(a=><article key={a.id}><div><b>{a.title}</b><span>{a.topic||'General'} • {new Date(a.date).toLocaleDateString()}</span></div><div className={styles.score}><b>{a.score}/{a.max}</b><strong>{a.percentage}%</strong></div></article>):<div className={styles.empty}>No saved attempt in {source} yet.</div>}
      </div>
    </section>

    <footer className={styles.foot}>Scanner v1 uses high-resolution PDF rendering, image cleanup and a second handwriting OCR pass on low-confidence answer pages. Any unclear reading is kept reviewable instead of silently guessing.</footer>
  </main>
}
