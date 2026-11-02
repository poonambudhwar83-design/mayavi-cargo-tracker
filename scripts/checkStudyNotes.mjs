import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {STUDY_SUBJECTS,parseStudyEntry,studyTotals,pending,marksPercentage} from '../lib/studyNotes.js';
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
assert.equal(a.totalMarks,null);
assert.equal(a.marksObtained,null);
assert.equal(marksPercentage(100,85),85);
assert.equal(marksPercentage(60,42),70);
assert.equal(marksPercentage(70,49.5),70.71);
assert.equal(marksPercentage(null,null),null);
assert.equal(marksPercentage(0,0),null);
assert.equal(marksPercentage(10,11),null);
const score=parseStudyEntry({...input,totalMarks:'80',marksObtained:'67.5'});
assert.equal(score.totalMarks,80);
assert.equal(score.marksObtained,67.5);
assert.throws(()=>parseStudyEntry({...input,totalMarks:80,marksObtained:81}),/cannot exceed/);
assert.throws(()=>parseStudyEntry({...input,totalMarks:80,marksObtained:null}),/both/);
assert.throws(()=>parseStudyEntry({...input,totalMarks:null,marksObtained:50}),/both/);
assert.throws(()=>parseStudyEntry({...input,totalMarks:10,marksObtained:-1}),/non-negative/);
assert.throws(()=>parseStudyEntry({...input,totalMarks:10,marksObtained:1.555}),/decimal/);
const scoredTotals=studyTotals([
 parseStudyEntry({...input,totalMarks:50,marksObtained:40}),
 parseStudyEntry({...input,topic:'Topic 2',totalMarks:150,marksObtained:90}),
 a
]);
assert.equal(scoredTotals.totalMarks,200);
assert.equal(scoredTotals.marksObtained,130);
assert.equal(scoredTotals.percentage,65);
assert.equal(scoredTotals.markedTopics,2);
assert.deepEqual(studyTotals([a,{...a,topic:'Velocity',mcqTotal:5,mcqDone:5,
  theoryTotal:3,theoryDone:3}]),{
  topics:2,mcqTotal:25,mcqDone:17,mcqPending:8,
  theoryTotal:13,theoryDone:6,theoryPending:7,
  totalMarks:0,marksObtained:0,percentage:null,markedTopics:0
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
  {subject:'Physics',chapter:'Chapter 1',topic:'Motion',mcqTotal:0,mcqDone:0,theoryTotal:0,theoryDone:0,totalMarks:null,marksObtained:null});
const nav=readFileSync('app/UnifiedDashboard.js','utf8');
assert.ok(nav.includes("selectedDashboard==='NOTES'\n      ?<StudyNotesDashboard/>"));
assert.ok(nav.includes("selectedDashboard==='ADMIN_NOTES'\n      ?<AdminNotesDashboard currentUser={session}/>"));
assert.ok(nav.includes('>NOTES</button>'));
assert.ok(nav.includes("setSelectedDashboard('ADMIN_NOTES')"));
const page=readFileSync('app/StudyNotesDashboard.js','utf8');
assert.ok(page.includes('<h1>NOTES</h1>'));
assert.ok(page.includes('Total Marks'));
assert.ok(page.includes('Marks Obtained'));
assert.ok(page.includes('marksPercentage(row.totalMarks,row.marksObtained)'));
assert.ok(page.includes("totals.percentage.toFixed(2)+'%'"));
assert.ok(page.includes("const API='/api/study-notes'"));
assert.ok(page.includes('chapters.map(section=>'));
assert.ok(page.includes('pending(row.mcqTotal,row.mcqDone)'));
assert.ok(page.includes('pending(row.theoryTotal,row.theoryDone)'));
const api=readFileSync('app/api/study-notes/route.js','utf8');
assert.ok(api.includes('session.role!==\'admin\''));
assert.ok(api.includes('mayavi_study_notes'));
assert.ok(api.includes('CREATE TABLE IF NOT EXISTS'));
assert.ok(api.includes('ADD COLUMN IF NOT EXISTS total_marks'));
assert.ok(api.includes('ADD COLUMN IF NOT EXISTS marks_obtained'));
assert.ok(api.includes('total_marks='));
assert.ok(api.includes('marks_obtained='));
assert.ok(api.includes('totalMarks:row.total_marks===null?null:Number(row.total_marks)'));
assert.ok(api.includes("method:" )===false);
assert.ok(api.includes('export async function GET(request)'));
assert.ok(api.includes('export async function POST(request)'));
assert.ok(api.includes('export async function PATCH(request)'));
assert.ok(api.includes('export async function DELETE(request)'));
console.log('NOTES seven subjects, chapter topics, question counts, admin access, CRUD and navigation tests passed.');
