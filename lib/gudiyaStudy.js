// Gudiya Study Tracker: one record per topic, with independent MCQ and
// Theory totals. No sample progress is ever created automatically.
export const STUDY_SUBJECTS=Object.freeze([
  'Physics','Mathematics','Chemistry','Biology','Sociology','English','Hindi'
]);
const MAX_QUESTIONS=100000;
const clean=(value,max)=>String(value??'').trim().slice(0,max);
export const pending=(total,done)=>Math.max(0,Number(total||0)-Number(done||0));
function count(value,label){
  if(value===''||value===null||value===undefined)return 0;
  if(typeof value!=='number'&&typeof value!=='string')throw Error(label+' must be a number.');
  const raw=String(value).trim();
  if(!/^\d+$/.test(raw))throw Error(label+' must be a whole number.');
  const number=Number(raw);
  if(!Number.isSafeInteger(number)||number<0||number>MAX_QUESTIONS)throw Error(label+' is out of range.');
  return number;
}
export function parseStudyEntry(body={}){
  const subject=clean(body.subject,30),chapter=clean(body.chapter,120),topic=clean(body.topic,180);
  if(!STUDY_SUBJECTS.includes(subject))throw Error('Select a valid subject.');
  if(!chapter)throw Error('Enter the chapter name.');
  if(!topic)throw Error('Enter the topic name.');
  const mcqTotal=count(body.mcqTotal,'Total MCQs');
  const mcqDone=count(body.mcqDone,'MCQs completed');
  const theoryTotal=count(body.theoryTotal,'Total theory questions');
  const theoryDone=count(body.theoryDone,'Theory completed');
  if(mcqDone>mcqTotal)throw Error('MCQs completed cannot exceed total MCQs.');
  if(theoryDone>theoryTotal)throw Error('Theory completed cannot exceed total theory questions.');
  return {subject,chapter,topic,mcqTotal,mcqDone,theoryTotal,theoryDone};
}
export function studyTotals(rows=[]){
  const totals={topics:rows.length,mcqTotal:0,mcqDone:0,mcqPending:0,
    theoryTotal:0,theoryDone:0,theoryPending:0};
  for(const row of rows){
    totals.mcqTotal+=Number(row.mcqTotal||0);
    totals.mcqDone+=Number(row.mcqDone||0);
    totals.theoryTotal+=Number(row.theoryTotal||0);
    totals.theoryDone+=Number(row.theoryDone||0);
  }
  totals.mcqPending=pending(totals.mcqTotal,totals.mcqDone);
  totals.theoryPending=pending(totals.theoryTotal,totals.theoryDone);
  return totals;
}
