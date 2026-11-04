// Only a real dated JEPO delivery timeline event establishes delivery day.
// Missing or unparseable dates stay null; do not equate booking/refresh with delivery.
export function parseJepoDeliveryDate(input){
  const raw=String(input??'').trim();
  if(!raw)return null;
  const validated=(y,m,d)=>{
    y=Number(y);m=Number(m);d=Number(d);
    if(!(y>=2000&&y<=2100&&m>=1&&m<=12&&d>=1&&d<=31))return null;
    const date=new Date(Date.UTC(y,m-1,d));
    return date.getUTCFullYear()===y&&date.getUTCMonth()+1===m&&date.getUTCDate()===d?date.toISOString().slice(0,10):null;
  };
  let m=raw.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/);
  if(m)return validated(m[1],m[2],m[3]);
  const months={jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
  m=raw.match(/\b(\d{1,2})[\s./-]+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s,./-]+(20\d{2})\b/i);
  if(m)return validated(m[3],months[m[2].toLowerCase()],m[1]);
  m=raw.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s./-]+(\d{1,2}),?[\s./-]+(20\d{2})\b/i);
  if(m)return validated(m[3],months[m[1].toLowerCase()],m[2]);
  m=raw.match(/\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})\b/);
  if(m)return validated(m[3],m[2],m[1]); // Indian DD/MM/YYYY
  return null;
}
