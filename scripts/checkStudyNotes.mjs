import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {STUDY_SUBJECTS,parseStudyEntry,studyTotals,pending,theoryIncorrect,marksPercentage,chapterSerial,studyTopicNumber} from '../lib/studyNotes.js';
assert.deepEqual(STUDY_SUBJECTS,[
 'Physics','Mathematics','Chemistry','Biology','Sociology','English','Hindi'
]);
assert.equal(pending(25,7),18);
assert.equal(pending(3,9),0);
assert.equal(theoryIncorrect(18,12),6);
assert.equal(theoryIncorrect(18,null),null);
assert.equal(studyTopicNumber('Chapter 1',0), '1.1');
assert.equal(studyTopicNumber('Chapter 1 – Motion',1), '1.2');
assert.equal(studyTopicNumber('Chapter 1',2), '1.3');
assert.equal(studyTopicNumber('Chapter 2',0), '2.1');
assert.equal(studyTopicNumber('Ch 3: Physics',1), '3.2');
assert.equal(chapterSerial('Chapter 10',2),10);
assert.equal(studyTopicNumber('Introduction',0,4),'4.1');
assert.equal(studyTopicNumber('Chapter 11',0), '11.1');
const input={subject:'Physics',chapter:'Chapter 1',topic:'Motion',
  mcqTotal:'20',mcqDone:'12',theoryTotal:'10',theoryDone:'3'};
const a=parseStudyEntry(input);
assert.equal(a.chapter,'Chapter 1');
assert.equal(a.mcqTotal,20);
assert.equal(a.mcqDone,12);
assert.equal(a.theoryTotal,10);
assert.equal(a.theoryDone,3);
assert.equal(a.theoryCorrected,null);
assert.equal(theoryIncorrect(a.theoryDone,a.theoryCorrected),null);
assert.equal(a.totalMarks,null);
assert.equal(a.marksObtained,null);
assert.equal(a.mcqMarksTotal,null);
assert.equal(a.mcqMarksObtained,null);
assert.equal(a.theoryMarksTotal,null);
assert.equal(a.theoryMarksObtained,null);
const gradedTheory=parseStudyEntry({...input,theoryCorrected:2});
assert.equal(gradedTheory.theoryCorrected,2);
assert.equal(gradedTheory.theoryMarksTotal,null,'Theory marks stay blank until entered manually');
assert.equal(gradedTheory.theoryMarksObtained,null,'Corrected count must never auto-fill marks obtained');
assert.equal(gradedTheory.totalMarks,null);
assert.equal(gradedTheory.marksObtained,null);
assert.equal(theoryIncorrect(gradedTheory.theoryDone,gradedTheory.theoryCorrected),1);
assert.throws(()=>parseStudyEntry({...input,theoryCorrected:4}),/Theory corrected cannot exceed/);
const noScoreLoss=parseStudyEntry({...input,totalMarks:80,marksObtained:60,theoryCorrected:2});
assert.equal(noScoreLoss.totalMarks,80,'An older combined score must not be overwritten by corrected count');
assert.equal(noScoreLoss.marksObtained,60);
const manuallyScored=parseStudyEntry({...input,theoryCorrected:2,theoryMarksTotal:10,theoryMarksObtained:8});
assert.equal(manuallyScored.theoryMarksTotal,10);
assert.equal(manuallyScored.theoryMarksObtained,8);
const split=parseStudyEntry({...input,
  mcqMarksTotal:40,mcqMarksObtained:32,theoryMarksTotal:60,theoryMarksObtained:48});
assert.equal(split.totalMarks,100);
assert.equal(split.marksObtained,80);
assert.equal(marksPercentage(split.mcqMarksTotal,split.mcqMarksObtained),80);
assert.equal(marksPercentage(split.theoryMarksTotal,split.theoryMarksObtained),80);
assert.equal(marksPercentage(split.totalMarks,split.marksObtained),80);
const onlyMcq=parseStudyEntry({...input,mcqMarksTotal:20,mcqMarksObtained:15});
assert.equal(onlyMcq.totalMarks,20);
assert.equal(onlyMcq.marksObtained,15);
assert.equal(onlyMcq.theoryMarksTotal,null);
const convertLegacy=parseStudyEntry({...input,totalMarks:100,marksObtained:95,
  mcqMarksTotal:40,mcqMarksObtained:32,theoryMarksTotal:60,theoryMarksObtained:48});
assert.equal(convertLegacy.totalMarks,100);
assert.equal(convertLegacy.marksObtained,80);
assert.throws(()=>parseStudyEntry({...input,mcqMarksTotal:40}),/both MCQ/);
assert.throws(()=>parseStudyEntry({...input,theoryMarksObtained:5}),/both Theory/);
assert.throws(()=>parseStudyEntry({...input,mcqMarksTotal:10,mcqMarksObtained:11}),/MCQ Marks Obtained cannot exceed/);
assert.throws(()=>parseStudyEntry({...input,theoryMarksTotal:10,theoryMarksObtained:11}),/Theory Marks Obtained cannot exceed/);
assert.equal(a.incorrectMcqNumbers,'');
assert.equal(a.incorrectTheoryNumbers,'');
const incorrect=parseStudyEntry({...input,incorrectMcqNumbers:' 2, 5, 9 ',
  incorrectTheoryNumbers:' Q3, Q7 '});
assert.equal(incorrect.incorrectMcqNumbers,'2, 5, 9');
assert.equal(incorrect.incorrectTheoryNumbers,'Q3, Q7');
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
const mixed=studyTotals([score,split,onlyMcq]);
assert.equal(mixed.totalMarks,200);
assert.equal(mixed.marksObtained,162.5);
assert.equal(mixed.percentage,81.25);
assert.equal(mixed.mcqMarksTotal,60);
assert.equal(mixed.mcqMarksObtained,47);
assert.equal(mixed.mcqPercentage,78.33);
assert.equal(mixed.theoryMarksTotal,60);
assert.equal(mixed.theoryMarksObtained,48);
assert.equal(mixed.theoryPercentage,80);
assert.deepEqual(studyTotals([a,{...a,topic:'Velocity',mcqTotal:5,mcqDone:5,
  theoryTotal:3,theoryDone:3}]),{
  topics:2,mcqTotal:25,mcqDone:17,mcqPending:8,
  theoryTotal:13,theoryDone:6,theoryPending:7,theoryCorrected:0,theoryIncorrect:0,theoryGradedTopics:0,
  totalMarks:0,marksObtained:0,percentage:null,markedTopics:0,
  mcqMarksTotal:0,mcqMarksObtained:0,mcqPercentage:null,mcqMarkedTopics:0,
  theoryMarksTotal:0,theoryMarksObtained:0,theoryPercentage:null,theoryMarkedTopics:0
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
  {subject:'Physics',chapter:'Chapter 1',topic:'Motion',mcqTotal:0,mcqDone:0,theoryTotal:0,theoryDone:0,theoryCorrected:null,totalMarks:null,marksObtained:null,mcqMarksTotal:null,mcqMarksObtained:null,theoryMarksTotal:null,theoryMarksObtained:null,incorrectMcqNumbers:'',incorrectTheoryNumbers:''});
const nav=readFileSync('app/UnifiedDashboard.js','utf8');
assert.ok(nav.includes("selectedDashboard==='NOTES'\n      ?<StudyNotesDashboard/>"));
assert.ok(nav.includes("selectedDashboard==='ADMIN_NOTES'\n      ?<AdminNotesDashboard currentUser={session}/>"));
assert.ok(readFileSync('app/MayaviSidebar.js','utf8').includes("page('notes','Study Notes','NOTES')"));
assert.ok(nav.includes("setSelectedDashboard('ADMIN_NOTES')"));
const page=readFileSync('app/StudyNotesDashboard.js','utf8');
assert.ok(page.includes('<h1>NOTES</h1>'));
// The Add Topic editor has one horizontal, scrollable row; all original
// fields survive and neither incorrect-question-number input is duplicated.
assert.ok(page.includes('className={styles.compactEntryScroll}'));
assert.ok(page.includes('className={styles.compactEntryRow}'));
assert.equal(page.match(/Incorrect MCQ Question Numbers/g)?.length,1);
assert.equal(page.match(/Incorrect Theory Question Numbers/g)?.length,1);
for(const field of ['chapter','topic','mcqTotal','mcqDone','theoryTotal','theoryDone',
  'theoryCorrected','mcqMarksTotal','mcqMarksObtained',
  'theoryMarksTotal','theoryMarksObtained','incorrectMcqNumbers','incorrectTheoryNumbers']){
  assert.ok(page.includes('draft.'+field),'Keep NOTES column '+field);
}
const css=readFileSync('app/StudyNotesDashboard.module.css','utf8');
assert.ok(css.includes('.compactEntryRow{display:flex;align-items:flex-end;'));
assert.ok(css.includes('.compactEntryScroll{max-width:100%;overflow-x:auto;'));
assert.ok(!page.includes('className={styles.theoryCalculations}'));
assert.ok(!page.includes('className={styles.marksSection}'));
assert.ok(page.includes('Incorrect MCQ Question Numbers'));
assert.ok(page.includes('Incorrect Theory Question Numbers'));
assert.ok(page.includes('Theory Corrected'));
assert.ok(page.includes('Theory Attempted'));
assert.ok(page.includes('Theory Pending'));
assert.ok(page.includes('Theory Total Marks (manual)'));
assert.ok(page.includes('Theory Marks Obtained (manual)'));
assert.ok(page.includes('theoryCorrected:draft.theoryCorrected'));
assert.ok(page.includes("row.incorrectMcqNumbers||'—'"));
assert.ok(page.includes("row.incorrectTheoryNumbers||'—'"));
assert.ok(page.includes('MCQ Total Marks'));
assert.ok(page.includes('MCQ Marks Obtained'));
assert.ok(page.includes('Theory Total Marks'));
assert.ok(page.includes('Theory Marks Obtained'));
assert.ok(page.includes('Overall Marks'));
assert.ok(page.includes('<th>MCQ Marks</th>'));
assert.ok(page.includes('<th>Theory Total Marks</th>'));
assert.ok(page.includes('<th>Theory Marks Obtained</th>'));
assert.ok(page.includes('<th>Theory Corrected</th>'));
assert.ok(page.includes('<th>Theory Incorrect</th>'));
assert.ok(page.includes('theoryIncorrect(row.theoryDone,row.theoryCorrected)'));
assert.ok(page.includes('<th>Overall Marks</th>'));
assert.ok(page.includes('className={styles.pendingCard}'));
assert.ok(page.includes('className={styles.pendingCount}'));
assert.ok(page.includes('Total Marks'));
assert.ok(page.includes('Marks Obtained'));
assert.ok(page.includes('marksPercentage(row.totalMarks,row.marksObtained)'));
assert.ok(page.includes("totals.percentage.toFixed(2)+'%'"));
assert.ok(page.includes("const API='/api/study-notes'"));
assert.ok(page.includes('chapters.map(section=>'));
assert.ok(page.includes("studyTopicNumber(section.chapter,topicIndex,section.chapterIndex)"));
assert.ok(page.includes("a.createdAt||''"));
assert.ok(page.includes("section.topics.map((row,topicIndex)"));
assert.ok(page.includes('<th>No.</th>'));
assert.ok(!page.includes('row.serialNumber'),'Serial numbers are calculated, not manually stored');
assert.ok(page.includes('pending(row.mcqTotal,row.mcqDone)'));
assert.ok(page.includes('pending(row.theoryTotal,row.theoryDone)'));
const api=readFileSync('app/api/study-notes/route.js','utf8');
assert.ok(api.includes('session.role!==\'admin\''));
assert.ok(api.includes('mayavi_study_notes'));
assert.ok(api.includes('createdAt:row.created_at'),
  'Use immutable creation time so edits do not reorder topic serials');
assert.ok(api.includes('CREATE TABLE IF NOT EXISTS'));
assert.ok(api.includes('ADD COLUMN IF NOT EXISTS total_marks'));
assert.ok(api.includes('ADD COLUMN IF NOT EXISTS marks_obtained'));
assert.ok(api.includes('ADD COLUMN IF NOT EXISTS incorrect_mcq_numbers'));
assert.ok(api.includes('ADD COLUMN IF NOT EXISTS incorrect_theory_numbers'));
for(const field of ['mcq_marks_total','mcq_marks_obtained','theory_marks_total','theory_marks_obtained']){
  assert.ok(api.includes('ADD COLUMN IF NOT EXISTS '+field));
  assert.ok(api.includes(field+'='));
}
assert.ok(api.includes('ADD COLUMN IF NOT EXISTS theory_corrected'));
assert.ok(api.includes('theory_corrected=${entry.theoryCorrected}'));
assert.ok(api.includes('theoryCorrected:row.theory_corrected===null?null:Number(row.theory_corrected)'));
assert.ok(api.includes('incorrect_mcq_numbers=${entry.incorrectMcqNumbers}'));
assert.ok(api.includes('incorrect_theory_numbers=${entry.incorrectTheoryNumbers}'));
assert.ok(api.includes("incorrectMcqNumbers:row.incorrect_mcq_numbers||''"));
assert.ok(api.includes('total_marks='));
assert.ok(api.includes('marks_obtained='));
assert.ok(api.includes('totalMarks:row.total_marks===null?null:Number(row.total_marks)'));
assert.ok(api.includes("method:" )===false);
assert.ok(api.includes('export async function GET(request)'));
assert.ok(api.includes('export async function POST(request)'));
assert.ok(api.includes('export async function PATCH(request)'));
assert.ok(api.includes('export async function DELETE(request)'));
console.log('NOTES seven subjects, chapter topics, question counts, admin access, CRUD and navigation tests passed.');
