import { randomUUID } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { readSession } from '../../../lib/mayaviAuth.js';
import { STUDY_SUBJECTS, chapterSerial } from '../../../lib/studyNotes.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const reply=(data,status=200)=>Response.json(data,{status,headers:{'cache-control':'no-store'}});
function database(){
  const url=process.env.DATABASE_URL||process.env.POSTGRES_URL||
    process.env.NEON_DATABASE_URL||process.env.DATABASE_URL_UNPOOLED||'';
  if(!url)throw Error('Mayavi database unavailable.');
  return neon(url);
}
async function notesAccess(request,sql,readOnly=false){
  const session=readSession(request);
  if(!session)return {error:'Please log in to Mayavi.',status:401};
  const [user]=await sql`SELECT role,is_active,branch_scope,session_version FROM mayavi_users
    WHERE lower(username)=${String(session.username||'').toLowerCase()} LIMIT 1`;
  if(!user?.is_active||Number(user.session_version)!==Number(session.sessionVersion))
    return {error:'Session is no longer active.',status:403};
  if(session.role==='admin'&&user.role==='admin'&&!user.branch_scope)
    return {session};
  if(readOnly&&session.role==='employee'&&user.role==='employee'&&
    session.username==='joya'&&session.branchScope==='STUDY_NOTES'&&user.branch_scope==='STUDY_NOTES')
    return {session};
  return {error:'Admin access only. Joya has read-only Notes access.',status:403};
}
async function ensureChapters(sql){
  await sql`CREATE TABLE IF NOT EXISTS mayavi_study_chapters (
    id TEXT PRIMARY KEY,
    subject TEXT NOT NULL,
    chapter_number INTEGER NOT NULL CHECK (chapter_number BETWEEN 1 AND 500),
    title TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(subject,chapter_number),
    UNIQUE(subject,title)
  )`;
}
// Register existing chapter headings using their ORIGINAL creation order,
// rather than alphabetic sorting (which changed Physics Ch 1 to Ch 2).
// No study-note row is renamed, moved, overwritten or deleted.
async function preserveExistingChapters(sql){
  const registered=await sql`SELECT subject,chapter_number,title
    FROM mayavi_study_chapters ORDER BY subject,chapter_number`;
  const legacy=await sql`SELECT subject,chapter,MIN(created_at) AS first_seen
    FROM mayavi_study_notes GROUP BY subject,chapter
    ORDER BY subject,MIN(created_at)`;
  const assigned=new Map();
  for(const row of registered){
    if(!assigned.has(row.subject))assigned.set(row.subject,{numbers:new Set(),names:new Set()});
    assigned.get(row.subject).numbers.add(Number(row.chapter_number));
    assigned.get(row.subject).names.add(row.title.trim().toLowerCase());
  }
  const reserved=new Map();
  // Reserve explicit chapter numbers before giving titles without numbers
  // a sequential slot. "CH 2" must stay chapter 2.
  for(const row of legacy){
    if(!reserved.has(row.subject))reserved.set(row.subject,new Set());
    const explicit=chapterSerial(row.chapter,0);
    if(explicit>=1&&explicit<=500)reserved.get(row.subject).add(explicit);
  }
  for(const row of legacy){
    const subject=row.subject,title=String(row.chapter||'').trim();
    if(!STUDY_SUBJECTS.includes(subject)||!title)continue;
    if(!assigned.has(subject))assigned.set(subject,{numbers:new Set(),names:new Set()});
    const current=assigned.get(subject);
    if(current.names.has(title.toLowerCase()))continue;
    const requested=chapterSerial(title,0);
    let num=requested>=1&&requested<=500&&!current.numbers.has(requested)?requested:0;
    if(!num){
      const keep=reserved.get(subject)||new Set();
      for(let n=1;n<=500;n++){
        if(!current.numbers.has(n)&&!keep.has(n)){num=n;break;}
      }
    }
    if(!num)continue;
    await sql`INSERT INTO mayavi_study_chapters(id,subject,chapter_number,title)
      VALUES (${randomUUID()},${subject},${num},${title})
      ON CONFLICT DO NOTHING`;
    current.numbers.add(num);current.names.add(title.toLowerCase());
  }
}
const formatted=row=>({id:row.id,subject:row.subject,
  number:Number(row.chapter_number),title:row.title});
export async function GET(request){
  try{
    const sql=database(),auth=await notesAccess(request,sql,true);
    if(auth.error)return reply({ok:false,error:auth.error},auth.status);
    if(auth.session.role==='admin'){
      await ensureChapters(sql);
      await preserveExistingChapters(sql);
    }
    const rows=await sql`SELECT id,subject,chapter_number,title
      FROM mayavi_study_chapters ORDER BY subject,chapter_number`;
    return reply({ok:true,chapters:rows.map(formatted)});
  }catch(e){console.error('study_chapters_get',e?.message);
    return reply({ok:false,error:'Unable to load chapters.'},503);}
}
export async function POST(request){
  try{
    const sql=database(),auth=await notesAccess(request,sql);
    if(auth.error)return reply({ok:false,error:auth.error},auth.status);
    const body=await request.json().catch(()=>({}));
    const subject=String(body.subject||'').trim();
    const number=Number(body.number);
    const title=String(body.title||'').trim().slice(0,120)||
      (Number.isInteger(number)?'Chapter '+number:'');
    if(!STUDY_SUBJECTS.includes(subject)||!Number.isInteger(number)||
      number<1||number>500||!title)
      return reply({ok:false,error:'Choose subject, chapter number (1–500) and chapter name.'},400);
    await ensureChapters(sql);await preserveExistingChapters(sql);
    const existing=await sql`SELECT id,subject,chapter_number,title
      FROM mayavi_study_chapters
      WHERE subject=${subject} AND
        (chapter_number=${number} OR lower(title)=lower(${title})) LIMIT 1`;
    if(existing.length)return reply({ok:false,
      error:'This chapter number or name already exists. Select it from the Chapter dropdown.'},409);
    const id=randomUUID();
    await sql`INSERT INTO mayavi_study_chapters(id,subject,chapter_number,title)
      VALUES (${id},${subject},${number},${title})`;
    return reply({ok:true,chapter:{id,subject,number,title}},201);
  }catch(e){console.error('study_chapters_save',e?.message);
    return reply({ok:false,error:'Unable to save chapter.'},503);}
}
