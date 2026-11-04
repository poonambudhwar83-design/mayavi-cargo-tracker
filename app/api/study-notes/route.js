import { randomUUID } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { readSession } from '../../../lib/mayaviAuth.js';
import { parseStudyEntry } from '../../../lib/studyNotes.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const reply=(data,status=200)=>Response.json(data,{status,headers:{'cache-control':'no-store'}});
function database(){
  const url=process.env.DATABASE_URL||process.env.POSTGRES_URL||
    process.env.NEON_DATABASE_URL||process.env.DATABASE_URL_UNPOOLED||'';
  if(!url)throw Error('Mayavi database unavailable.');
  return neon(url);
}
async function adminOnly(request,sql){
  const session=readSession(request);
  if(!session)return {error:'Please log in to Mayavi.',status:401};
  if(session.role!=='admin')return {error:'Admin access only.',status:403};
  const users=await sql`SELECT role,is_active FROM mayavi_users
    WHERE lower(username)=${String(session.username||'').toLowerCase()} LIMIT 1`;
  if(users[0]?.role!=='admin'||!users[0]?.is_active)
    return {error:'Admin account is not active.',status:403};
  return {session};
}
async function ensureTable(sql){
  await sql`CREATE TABLE IF NOT EXISTS mayavi_study_notes (
    id TEXT PRIMARY KEY,
    subject TEXT NOT NULL,
    chapter TEXT NOT NULL,
    topic TEXT NOT NULL,
    mcq_total INTEGER NOT NULL DEFAULT 0,
    mcq_done INTEGER NOT NULL DEFAULT 0,
    theory_total INTEGER NOT NULL DEFAULT 0,
    theory_done INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT gudiya_mcq_valid CHECK (mcq_total>=0 AND mcq_done>=0 AND mcq_done<=mcq_total),
    CONSTRAINT gudiya_theory_valid CHECK (theory_total>=0 AND theory_done>=0 AND theory_done<=theory_total)
  )`;
  // Existing notes are preserved. Marks are optional and default to NULL.
  await sql`ALTER TABLE mayavi_study_notes
    ADD COLUMN IF NOT EXISTS total_marks NUMERIC(12,2)`;
  await sql`ALTER TABLE mayavi_study_notes
    ADD COLUMN IF NOT EXISTS marks_obtained NUMERIC(12,2)`;
  // Add-only migration. Existing questions and study scores are never reset.
  await sql`ALTER TABLE mayavi_study_notes
    ADD COLUMN IF NOT EXISTS incorrect_mcq_numbers TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE mayavi_study_notes
    ADD COLUMN IF NOT EXISTS incorrect_theory_numbers TEXT NOT NULL DEFAULT ''`;
  // Nullable, add-only: pre-existing notes remain ungraded, not zero-correct.
  await sql`ALTER TABLE mayavi_study_notes
    ADD COLUMN IF NOT EXISTS theory_corrected INTEGER`;
  // Separate, optional MCQ/Theory scoring; old combined totals remain untouched.
  await sql`ALTER TABLE mayavi_study_notes
    ADD COLUMN IF NOT EXISTS mcq_marks_total NUMERIC(12,2)`;
  await sql`ALTER TABLE mayavi_study_notes
    ADD COLUMN IF NOT EXISTS mcq_marks_obtained NUMERIC(12,2)`;
  await sql`ALTER TABLE mayavi_study_notes
    ADD COLUMN IF NOT EXISTS theory_marks_total NUMERIC(12,2)`;
  await sql`ALTER TABLE mayavi_study_notes
    ADD COLUMN IF NOT EXISTS theory_marks_obtained NUMERIC(12,2)`;
}
const format=row=>({
  id:row.id,subject:row.subject,chapter:row.chapter,topic:row.topic,
  mcqTotal:row.mcq_total,mcqDone:row.mcq_done,
  theoryTotal:row.theory_total,theoryDone:row.theory_done,
  theoryCorrected:row.theory_corrected===null?null:Number(row.theory_corrected),
  totalMarks:row.total_marks===null?null:Number(row.total_marks),
  marksObtained:row.marks_obtained===null?null:Number(row.marks_obtained),
  mcqMarksTotal:row.mcq_marks_total===null?null:Number(row.mcq_marks_total),
  mcqMarksObtained:row.mcq_marks_obtained===null?null:Number(row.mcq_marks_obtained),
  theoryMarksTotal:row.theory_marks_total===null?null:Number(row.theory_marks_total),
  theoryMarksObtained:row.theory_marks_obtained===null?null:Number(row.theory_marks_obtained),
  incorrectMcqNumbers:row.incorrect_mcq_numbers||'',
  incorrectTheoryNumbers:row.incorrect_theory_numbers||'',
  createdAt:row.created_at,
  updatedAt:row.updated_at
});
const validId=id=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id||'');
async function find(sql,id){
  const rows=await sql`SELECT * FROM mayavi_study_notes WHERE id=${id} LIMIT 1`;
  return rows.length?format(rows[0]):null;
}
function invalid(error){
  return reply({ok:false,error:String(error?.message||error)},400);
}
export async function GET(request){
  try{
    const sql=database(),auth=await adminOnly(request,sql);
    if(auth.error)return reply({ok:false,error:auth.error},auth.status);
    await ensureTable(sql);
    const rows=await sql`SELECT * FROM mayavi_study_notes ORDER BY created_at DESC LIMIT 5000`;
    return reply({ok:true,rows:rows.map(format)});
  }catch(e){console.error('study_notes_get',e?.message);return reply({ok:false,error:'Unable to load study records.'},503);}
}
export async function POST(request){
  try{
    const sql=database(),auth=await adminOnly(request,sql);
    if(auth.error)return reply({ok:false,error:auth.error},auth.status);
    let entry;try{entry=parseStudyEntry(await request.json().catch(()=>({})));}catch(e){return invalid(e);}
    await ensureTable(sql);
    const id=randomUUID();
    await sql`INSERT INTO mayavi_study_notes
      (id,subject,chapter,topic,mcq_total,mcq_done,theory_total,theory_done,
       total_marks,marks_obtained,incorrect_mcq_numbers,incorrect_theory_numbers,
       mcq_marks_total,mcq_marks_obtained,theory_marks_total,theory_marks_obtained,theory_corrected)
      VALUES (${id},${entry.subject},${entry.chapter},${entry.topic},
        ${entry.mcqTotal},${entry.mcqDone},${entry.theoryTotal},${entry.theoryDone},
        ${entry.totalMarks},${entry.marksObtained},
        ${entry.incorrectMcqNumbers},${entry.incorrectTheoryNumbers},
        ${entry.mcqMarksTotal},${entry.mcqMarksObtained},
        ${entry.theoryMarksTotal},${entry.theoryMarksObtained},${entry.theoryCorrected})`;
    return reply({ok:true,row:await find(sql,id)},201);
  }catch(e){console.error('study_notes_save',e?.message);return reply({ok:false,error:'Unable to save study record.'},503);}
}
export async function PATCH(request){
  try{
    const sql=database(),auth=await adminOnly(request,sql);
    if(auth.error)return reply({ok:false,error:auth.error},auth.status);
    const body=await request.json().catch(()=>({}));
    if(!validId(body.id))return invalid(Error('Invalid study record.'));
    let entry;try{entry=parseStudyEntry(body);}catch(e){return invalid(e);}
    await ensureTable(sql);
    const rows=await sql`UPDATE mayavi_study_notes SET subject=${entry.subject},
      chapter=${entry.chapter},topic=${entry.topic},mcq_total=${entry.mcqTotal},
      mcq_done=${entry.mcqDone},theory_total=${entry.theoryTotal},
      theory_done=${entry.theoryDone},theory_corrected=${entry.theoryCorrected},
      total_marks=${entry.totalMarks},
      marks_obtained=${entry.marksObtained},
      incorrect_mcq_numbers=${entry.incorrectMcqNumbers},
      incorrect_theory_numbers=${entry.incorrectTheoryNumbers},
      mcq_marks_total=${entry.mcqMarksTotal},
      mcq_marks_obtained=${entry.mcqMarksObtained},
      theory_marks_total=${entry.theoryMarksTotal},
      theory_marks_obtained=${entry.theoryMarksObtained},
      updated_at=NOW() WHERE id=${body.id}
      RETURNING id`;
    if(!rows.length)return reply({ok:false,error:'Study record not found.'},404);
    return reply({ok:true,row:await find(sql,body.id)});
  }catch(e){console.error('study_notes_patch',e?.message);return reply({ok:false,error:'Unable to update study record.'},503);}
}
export async function DELETE(request){
  try{
    const sql=database(),auth=await adminOnly(request,sql);
    if(auth.error)return reply({ok:false,error:auth.error},auth.status);
    const id=new URL(request.url).searchParams.get('id')||'';
    if(!validId(id))return invalid(Error('Invalid study record.'));
    await ensureTable(sql);
    const rows=await sql`DELETE FROM mayavi_study_notes WHERE id=${id} RETURNING id`;
    return rows.length?reply({ok:true}):reply({ok:false,error:'Study record not found.'},404);
  }catch(e){console.error('study_notes_delete',e?.message);return reply({ok:false,error:'Unable to delete study record.'},503);}
}
