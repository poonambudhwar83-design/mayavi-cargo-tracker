import { GET as runNormalRefresh } from '../refresh/route.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;

// Vercel schedules in UTC. The wider UTC cron window safely spans India's
// 02:00, 02:15, 02:30, and 02:45 overnight checks. Other invocations
// (01:30, 01:45, 03:00 and 03:15 IST) are intentionally skipped here.
// The normal 2-hour all-airline refresh is a separate cron job.
export async function GET(request){
  const parts=new Intl.DateTimeFormat('en-GB',{
    timeZone:'Asia/Kolkata',hour:'2-digit',
    minute:'2-digit',hourCycle:'h23'
  }).formatToParts(new Date());
  const hour=Number(parts.find(x=>x.type==='hour')?.value);
  const minute=Number(parts.find(x=>x.type==='minute')?.value);
  if(hour!==2||minute%15!==0){
    return Response.json({ok:true,skipped:true,reason:'Outside Saudia 02:00-03:00 IST window'});
  }
  return runNormalRefresh(request);
}
