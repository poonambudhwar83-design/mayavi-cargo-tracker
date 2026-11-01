// Shared import ETA ordering and six-hour pre-arrival mail clock.
// Arrival/deadline values are India Standard Time wall clocks, not browser-local.
const dateOk=x=>/^20\d{2}-\d{2}-\d{2}$/.test(String(x||''));
const clockOk=x=>/^([01]\d|2[0-3]):[0-5]\d$/.test(String(x||''));
const clock=x=>{
  const m=String(x||'').trim().match(/^(\d{1,2}):([0-5]\d)(?::[0-5]\d)?\s*(AM|PM)?$/i);
  if(!m)return'';
  let h=Number(m[1]);
  const ampm=String(m[3]||'').toUpperCase();
  if(ampm){if(h<1||h>12)return'';h=(h%12)+(ampm==='PM'?12:0);}
  if(h>23)return'';
  return String(h).padStart(2,'0')+':'+m[2];
};
export function importIstMoment(date='',time=''){
  const d=String(date||'').slice(0,10),t=clock(time);
  if(!dateOk(d)||!clockOk(t))return null;
  const stamp=Date.parse(d+'T'+t+':00Z');
  return Number.isFinite(stamp)&&new Date(stamp).toISOString().slice(0,10)===d?stamp:null;
}
export function importMailSixHoursBefore(date='',time=''){
  const moment=importIstMoment(date,time);
  return moment===null?'':new Date(moment-6*3600000).toISOString().slice(0,16).replace('T',' ');
}
// Use the same displayed date/time for chronological ordering. In particular,
// do not put every DEPARTED row before a flight arriving sooner merely because
// that flight currently reads MANIFESTED/BUILD UP.
export function importArrivalOrder(row={},airAsia=null){
  const transit=row._saudiaTransitEta;
  const planned=row._saudiaManifestPlan;
  const emirates=row._emiratesMasterEta;
  const date=row.arrivalDate||airAsia?.date||transit?.date||planned?.date||emirates?.date||'';
  const time=transit?.time||planned?.time||emirates?.time||row.arrivalTime||airAsia?.time||'';
  const moment=importIstMoment(date,time);
  return moment===null?Number.POSITIVE_INFINITY:moment;
}
