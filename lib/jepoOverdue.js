// JEPO overdue is a filtered view of saved Active AWBs, not a second copy.
// Use India calendar dates, not UTC hours, so the rule remains stable at midnight IST.
export const JEPO_OVERDUE_AFTER_DAYS=30;

function dateEpoch(value=''){
 const raw=String(value??'').trim().slice(0,10);
 const match=raw.match(/^(20\d{2})-(\d{2})-(\d{2})$/);
 if(!match)return null;
 const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]);
 const ms=Date.UTC(year,month-1,day);
 const parsed=new Date(ms);
 if(parsed.getUTCFullYear()!==year||parsed.getUTCMonth()+1!==month||parsed.getUTCDate()!==day)return null;
 return ms;
}

export function jepoTodayIst(value=new Date()){
 const date=value instanceof Date?value:new Date(value);
 if(!Number.isFinite(date.getTime()))return '';
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
 const p=key=>parts.find(x=>x.type===key)?.value||'';
 return p('year')+'-'+p('month')+'-'+p('day');
}

export function jepoDaysSinceBooking(bookingDate,today=jepoTodayIst()){
 const booked=dateEpoch(bookingDate),now=dateEpoch(today);
 if(booked===null||now===null||now<booked)return null;
 return Math.round((now-booked)/86400000);
}

export function jepoOverdueDays(row={},today=jepoTodayIst()){
 // A delivered scan/date removes the record from overdue automatically.
 if(String(row.status||'').toUpperCase()==='DELIVERED'||dateEpoch(row.deliveredOn)!==null)return null;
 const age=jepoDaysSinceBooking(row.bookingDate,today);
 return age!==null&&age>JEPO_OVERDUE_AFTER_DAYS?age-JEPO_OVERDUE_AFTER_DAYS:null;
}

// Place actively "Out for Delivery" overdue packets before all other statuses.
// Rank only verified tracking fields; do not guess delivery progress from
// booking dates or unrelated remarks.
export function jepoIsOutForDelivery(row={}){
 const values=[row.liveStatus,row.status,row.liveRemarks];
 return values.some(value=>{
  const status=String(value??'').toUpperCase().replace(/[_\-]+/g,' ').replace(/\s+/g,' ').trim();
  if(/\b(?:NOT|NEVER|NO LONGER) OUT (?:FOR|OF) DELIVERY\b/.test(status))return false;
  return /\bOUT (?:FOR|OF) DELIVERY\b/.test(status)
    || /^(?:OFD|OUT FOR DELIVERY)\b/.test(status);
 });
}
export function jepoOverdueRows(rows=[],today=jepoTodayIst()){
 return rows.filter(row=>jepoOverdueDays(row,today)!==null)
  .sort((a,b)=>Number(jepoIsOutForDelivery(b))-Number(jepoIsOutForDelivery(a))
    ||jepoOverdueDays(b,today)-jepoOverdueDays(a,today)
    ||String(a.awb||'').localeCompare(String(b.awb||'')));
}
