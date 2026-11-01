// Accounting uses the ACTUAL Handover YES date (India time), not the flight's departure.
// The tracker handover deadline (-5 hours) is only used for legacy completed
// entries that lack a recorded action timestamp. Never count Handover NO.
function validCalendarDate(raw=''){
  const match=String(raw||'').trim().match(/^(20\d{2})-(\d{2})-(\d{2})(?:\D|$)/);
  if(!match)return '';
  const y=Number(match[1]),m=Number(match[2]),d=Number(match[3]);
  const check=new Date(Date.UTC(y,m-1,d));
  return check.getUTCFullYear()===y&&check.getUTCMonth()+1===m&&check.getUTCDate()===d
    ?match[1]+'-'+match[2]+'-'+match[3]:'';
}
function actionDateInIst(value){
  if(value===null||value===undefined||value==='')return '';
  const raw=String(value).trim();
  // Date-only fields are already calendar dates, not UTC instants.
  if(/^20\d{2}-\d{2}-\d{2}$/.test(raw))return validCalendarDate(raw);
  const date=new Date(raw);
  if(!Number.isFinite(date.getTime()))return '';
  const parts=new Intl.DateTimeFormat('en-CA',{
    timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'
  }).formatToParts(date);
  const valueOf=name=>parts.find(part=>part.type===name)?.value||'';
  return validCalendarDate(valueOf('year')+'-'+valueOf('month')+'-'+valueOf('day'));
}
export function confirmedExportHandoverDate(data={}){
  if(data.handoverDone!==true)return '';
  for(const timestamp of [data.handoverConfirmedAt,data.handoverUpdatedAt]){
    const confirmed=actionDateInIst(timestamp);
    if(confirmed)return confirmed;
  }
  // Old Handover YES records had no action timestamp. Use the displayed
  // handover deadline rather than assigning by departure or booking date.
  const existing=validCalendarDate(data.handoverTime);
  if(existing)return existing;
  const departure=validCalendarDate(data.departureDate||data.flightDate);
  const time=String(data.departureTime||'').trim();
  if(!departure||!/^([01]\d|2[0-3]):[0-5]\d/.test(time))return '';
  const utcDate=new Date(departure+'T'+time.slice(0,5)+':00Z');
  if(!Number.isFinite(utcDate.getTime()))return '';
  return new Date(utcDate.getTime()-5*60*60*1000).toISOString().slice(0,10);
}
export function confirmedExportHandoverMonth(data={}){
  return confirmedExportHandoverDate(data).slice(0,7);
}
