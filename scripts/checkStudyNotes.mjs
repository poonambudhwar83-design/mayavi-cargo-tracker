import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {STUDY_SUBJECTS,parseStudyEntry,studyTotals,pending} from '../lib/studyNotes.js';
assert.deepEqual(STUDY_SUBJECTS,[
 'Physics','Mathematics','Chemistry','Biology','Sociology','English','Hindi'
]);
assert.equal(pending(25,7),18);
assert.equal(pending(3,9),0);
const input={subject:'Physics',chapter:'Chapter 1',topic:'Motion',
  mcqTotal:'20',mcqDone:'12',theoryTotal:'10',theoryDone:'3'};
const a=parseStudyEntry(input);
assert.equal(a.chapter,'Chapter 1');
assert.equal(a.mcqTotal,20);
assert.equal(a.mcqDone,12);
assert.equal(a.theoryTotal,10);
assert.equal(a.theoryDone,3);
assert.deepEqual(studyTotals([a,{...a,topic:'Velocity',mcqTotal:5,mcqDone:5,
  theoryTotal:3,theoryDone:3}]),{
  topics:2,mcqTotal:25,mcqDone:17,mcqPending:8,
  theoryTotal:13,theoryDone:6,theoryPending:7
});
assert.throws(()=>parseStudyEntry({...input,subject:'Unknown'}),/valid subject/);
assert.throws(()=>parseStudyEntry({...input,chapter:' '}),/chapter/);
assert.throws(()=>parseStudyEntry({...input,topic:' '}),/topic/);
assert.throws(()=>parseStudyEntry({...input,mcqDone:21}),/cannot exceed/);
assert.throws(()=>parseStudyEntry({...input,theoryDone:11}),/cannot exceed/);
assert.throws(()=>parseStudyEntry({...input,mcqTotal:-1}),/whole number/);
assert.throws(()=>parseStudyEntry({...input,mcqTotal:1.5}),/whole number/);
assert.throws(()=>parseStudyEntry({...input,mcqTotal:100001}),/range/);
assert.deepEqual(parseStudyEntry({...input,mcqTotal:'',mcqDone:'',theoryTotal:'',theoryDone:''}),
  {subject:'Physics',chapter:'Chapter 1',topic:'Motion',mcqTotal:0,mcqDone:0,theoryTotal:0,theoryDone:0});
const nav=readFileSync('app/UnifiedDashboard.js','utf8');
assert.ok(nav.includes("selectedDashboard==='NOTES'\n      ?<StudyNotesDashboard/>"));
assert.ok(nav.includes("selectedDashboard==='ADMIN_NOTES'\n      ?<AdminNotesDashboard currentUser={session}/>"));
assert.ok(nav.includes('>NOTES</button>'));
assert.ok(nav.includes("setSelectedDashboard('ADMIN_NOTES')"));
const page=readFileSync('app/StudyNotesDashboard.js','utf8');
assert.ok(page.includes('<h1>NOTES</h1>'));
assert.ok(page.includes("const API='/api/study-notes'"));
assert.ok(page.includes('chapters.map(section=>'));
assert.ok(page.includes('pending(row.mcqTotal,row.mcqDone)'));
assert.ok(page.includes('pending(row.theoryTotal,row.theoryDone)'));
const api=readFileSync('app/api/study-notes/route.js','utf8');
assert.ok(api.includes('session.role!==\'admin\''));
assert.ok(api.includes('mayavi_study_notes'));
assert.ok(api.includes('CREATE TABLE IF NOT EXISTS'));
assert.ok(api.includes("method:" )===false);
assert.ok(api.includes('export async function GET(request)'));
assert.ok(api.includes('export async function POST(request)'));
assert.ok(api.includes('export async function PATCH(request)'));
assert.ok(api.includes('export async function DELETE(request)'));
console.log('NOTES seven subjects, chapter topics, question counts, admin access, CRUD and navigation tests passed.');
