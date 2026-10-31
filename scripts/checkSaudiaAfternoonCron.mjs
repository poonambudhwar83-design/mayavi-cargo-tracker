import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const config=JSON.parse(readFileSync('vercel.json','utf8'));
const cron=config.crons.find(x=>x.path==='/api/cron/saudia');
const globalCron=config.crons.find(x=>x.path==='/api/cron/refresh');
assert.equal(cron?.schedule,'*/15 8-9 * * *','Saudia special 15-minute UTC window must cover 14–15 IST');
assert.equal(globalCron?.schedule,'0 */2 * * *','Main cargo auto-refresh must remain 2-hourly');

const route=readFileSync('app/api/cron/saudia/route.js','utf8');
assert.ok(route.includes("timeZone:'Asia/Kolkata'"),'Enforce IST, not server-local time');
assert.ok(route.includes('if(hour!==14||minute%15!==0)'), 'Do not run Saudia special refresh outside 14–15 IST');

const observed=[];
for(const utcHour of [8,9]){
  for(const minute of [0,15,30,45]){
    const at=new Date(Date.UTC(2026,9,31,utcHour,minute));
    const parts=new Intl.DateTimeFormat('en-GB',{
      timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',hourCycle:'h23'
    }).formatToParts(at);
    const localHour=Number(parts.find(x=>x.type==='hour')?.value);
    const localMinute=Number(parts.find(x=>x.type==='minute')?.value);
    if(localHour===14&&localMinute%15===0)
      observed.push(String(localHour).padStart(2,'0')+':'+String(localMinute).padStart(2,'0'));
  }
}
assert.deepEqual(observed,['14:00','14:15','14:30','14:45']);
console.log('Saudia cron IST window: 14:00/14:15/14:30/14:45, plus unchanged 2-hour global refresh.');
