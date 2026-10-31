import { GET as runNormalRefresh } from '../refresh/route.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;

// Vercel cron schedules are UTC: 08:30, 08:45, 09:00 and 09:15 UTC
// correspond to 14:00, 14:15, 14:30 and 14:45 Asia/Kolkata.
// Ignore other 08:00–09:45 UTC invocations. The normal 2-hour
// all-airline refresh runs independently.
export async function GET(request){
  const parts=new Intl.DateTimeFormat('en-GB',{
    timeZone:'Asia/Kolkata',hour:'2-digit',
    minute:'2-digit',hourCycle:'h23'
  }).formatToParts(new Date());
  const hour=Number(parts.find(x=>x.type==='hour')?.value);
  const minute=Number(parts.find(x=>x.type==='minute')?.value);
  if(hour!==14||minute%15!==0){
    return Response.json({ok:true,skipped:true,reason:'Outside Saudia 14:00-15:00 IST window'});
  }
  return runNormalRefresh(request);
}
