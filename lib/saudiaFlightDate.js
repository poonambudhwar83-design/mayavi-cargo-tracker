// Official SAL Flight_Date may be 11/2/2026 12:00:00 AM (US month/day/year).
// Keep the calendar day from SAL; timezone conversion would shift its meaning.
const pad=v=>String(v).padStart(2,'0');
const months={JAN:1,FEB:2,MAR:3,APR:4,MAY:5,JUN:6,JUL:7,AUG:8,SEP:9,OCT:10,NOV:11,DEC:12};
export function normalizeSalFlightDate(value=''){
  const raw=String(value??'').trim().toUpperCase();
  if(!raw)return'';
  let y,m,d;
  let match=raw.match(/^(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})(?=\D|$)/);
  if(match){[,y,m,d]=match;}
  else{
    match=raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](20\d{2})(?=\D|$)/);
    if(match){m=match[1];d=match[2];y=match[3];}
    else{
      match=raw.match(/^(\d{1,2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{2}|\d{4})(?=\D|$)/);
      if(!match)return'';
      d=match[1];m=months[match[2]];
      y=match[3].length===2?'20'+match[3]:match[3];
    }
  }
  y=Number(y);m=Number(m);d=Number(d);
  const dt=new Date(Date.UTC(y,m-1,d));
  if(dt.getUTCFullYear()!==y||dt.getUTCMonth()!==m-1||dt.getUTCDate()!==d)return'';
  return y+'-'+pad(m)+'-'+pad(d);
}
