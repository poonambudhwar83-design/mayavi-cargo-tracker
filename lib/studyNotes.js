// Notes study tracker: one record per topic, with independent MCQ and
// Theory totals. No sample progress is ever created automatically.
export const STUDY_SUBJECTS=Object.freeze([
  'Physics','Mathematics','Chemistry','Biology','Sociology','English','Hindi'
]);
const MAX_QUESTIONS=100000;
const clean=(value,max)=>String(value??'').trim().slice(0,max);
export const pending=(total,done)=>Math.max(0,Number(total||0)-Number(done||0));
// Chapter 1 -> 1.1, 1.2, 1.3; Chapter 2 -> 2.1, 2.2 ...
// Non-numbered chapter headings use their position among the subject's chapters.
export function chapterSerial(chapter,fallback=1){
  const match=String(chapter||'').trim().match(/^(?:(?:chapter|ch)\.?\s*[-:#]?\s*)?(\d+)(?=$|[\s.:)\-–—])/i);
  const value=match?Number(match[1]):null;
  return Number.isSafeInteger(value)&&value>0?value:fallback;
}
export function studyTopicNumber(chapter,index,fallback=1){
  return chapterSerial(chapter,fallback)+'.'+(index+1);
}

// Unentered marks stay null, rather than being mistaken for a zero score.
// Percentage = Marks Obtained × 100 / Total Marks.
export function marksPercentage(totalMarks,marksObtained){
  const total=Number(totalMarks),obtained=Number(marksObtained);
  if(totalMarks===null||totalMarks===undefined||totalMarks===''||
    marksObtained===null||marksObtained===undefined||marksObtained===''||
    !Number.isFinite(total)||!Number.isFinite(obtained)||
    total<=0||obtained<0||obtained>total)return null;
  return Math.round((obtained*100/total+Number.EPSILON)*100)/100;
}
function marks(value,label){
  if(value===null||value===undefined||value==='')return null;
  const raw=String(value).trim();
  if(!/^\d+(?:\.\d{1,2})?$/.test(raw))throw Error(label+' must be a non-negative number (up to two decimal places).');
  const number=Number(raw);
  if(!Number.isFinite(number)||number>1000000)throw Error(label+' is out of range.');
  return number;
}
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
  const totalMarks=marks(body.totalMarks,'Total Marks');
  const marksObtained=marks(body.marksObtained,'Marks Obtained');
  if((totalMarks===null)!==(marksObtained===null))
    throw Error('Enter both Total Marks and Marks Obtained, or leave both blank.');
  if(totalMarks!==null&&(totalMarks===0?marksObtained!==0:marksObtained>totalMarks))
    throw Error('Marks Obtained cannot exceed Total Marks.');
  return {subject,chapter,topic,mcqTotal,mcqDone,theoryTotal,theoryDone,
    totalMarks,marksObtained};
}
export function studyTotals(rows=[]){
  const totals={topics:rows.length,mcqTotal:0,mcqDone:0,mcqPending:0,
    theoryTotal:0,theoryDone:0,theoryPending:0,
    totalMarks:0,marksObtained:0,percentage:null,markedTopics:0};
  for(const row of rows){
    totals.mcqTotal+=Number(row.mcqTotal||0);
    totals.mcqDone+=Number(row.mcqDone||0);
    totals.theoryTotal+=Number(row.theoryTotal||0);
    totals.theoryDone+=Number(row.theoryDone||0);
    if(marksPercentage(row.totalMarks,row.marksObtained)!==null){
      totals.totalMarks+=Number(row.totalMarks);
      totals.marksObtained+=Number(row.marksObtained);
      totals.markedTopics++;
    }
  }
  totals.mcqPending=pending(totals.mcqTotal,totals.mcqDone);
  totals.theoryPending=pending(totals.theoryTotal,totals.theoryDone);
  totals.percentage=totals.markedTopics?marksPercentage(totals.totalMarks,totals.marksObtained):null;
  return totals;
}
