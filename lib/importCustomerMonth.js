// Shared by the Mayavi Import Customer P&L editor and the monthly saved-records API.
// Flight Date (not upload date) determines the reporting month.
const monthNames=['January','February','March','April','May','June','July','August','September','October','November','December'];
const valid=(y,m,d)=>{
  if(y<2000||y>2100||m<1||m>12||d<1||d>31)return false;
  const actual=new Date(Date.UTC(y,m-1,d));
  return actual.getUTCFullYear()===y&&actual.getUTCMonth()===m-1&&actual.getUTCDate()===d;
};
const key=(y,m)=>String(y)+'-'+String(m).padStart(2,'0');
export function importFlightMonth(value){
  const s=String(value??'').trim();
  if(!s)return '';
  let m=s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s]|$)/);
  if(m){const y=+m[1],mo=+m[2],d=+m[3];return valid(y,mo,d)?key(y,mo):'';}
  // India-style workbook dates (day / month / year).
  m=s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:\s|$)/);
  if(m){const d=+m[1],mo=+m[2],y=+m[3];return valid(y,mo,d)?key(y,mo):'';}
  m=s.match(/^(\d{4})[-/.](\d{1,2})$/);
  if(m){const y=+m[1],mo=+m[2];return valid(y,mo,1)?key(y,mo):'';}
  // Excel's 1900 date system: cell date number returned by ExcelJS.
  if(/^\d{5}(?:\.\d+)?$/.test(s)){
    const serial=Number(s),timestamp=Date.UTC(1899,11,30)+Math.floor(serial)*86400000;
    const date=new Date(timestamp),y=date.getUTCFullYear(),mo=date.getUTCMonth()+1;
    return valid(y,mo,date.getUTCDate())?key(y,mo):'';
  }
  // Month-name formats such as 20 Nov 2026 and November 20, 2026.
  if(/[a-zA-Z]/.test(s)&&/\b20\d{2}\b/.test(s)){
    const t=Date.parse(s);
    if(Number.isFinite(t)){
      const date=new Date(t),y=date.getUTCFullYear(),mo=date.getUTCMonth()+1;
      return valid(y,mo,date.getUTCDate())?key(y,mo):'';
    }
  }
  return '';
}
export const UNDATED_MONTH='UNDATED';
export function monthLabel(month){
  if(month===UNDATED_MONTH)return 'Without Flight Date';
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month||'')))return 'Select Month';
  const [y,m]=month.split('-').map(Number);
  return monthNames[m-1]+' '+y;
}
export function sortMonthKeys(a,b){
  if(a===UNDATED_MONTH)return 1;
  if(b===UNDATED_MONTH)return -1;
  return b.localeCompare(a);
}
export function groupedImportRowMonths(rows){
  // One master has one flight date. Fill in blank date cells without modifying saved data.
  const known=new Map();
  for(const r of rows||[]){
    const master=String(r.masterNo||'').trim();
    const batch=String(r._batchId||'');
    const found=importFlightMonth(r.flightDate);
    if(master&&found&&!known.has(batch+'|'+master))known.set(batch+'|'+master,found);
  }
  return (rows||[]).map(r=>{
    const master=String(r.masterNo||'').trim();
    const batch=String(r._batchId||'');
    return {row:r,month:master?(known.get(batch+'|'+master)||UNDATED_MONTH):(importFlightMonth(r.flightDate)||UNDATED_MONTH)};
  });
}
export function monthOptionsForRows(rows){
  const months=new Map();
  for(const {month,row} of groupedImportRowMonths(rows)){
    if(!months.has(month))months.set(month,{key:month,label:monthLabel(month),customers:0,masters:new Set()});
    const stat=months.get(month);
    stat.customers++;
    stat.masters.add((row._batchId||'')+'|'+String(row.masterNo||''));
  }
  return [...months.values()].sort((a,b)=>sortMonthKeys(a.key,b.key)).map(x=>({key:x.key,label:x.label,customers:x.customers,masters:x.masters.size}));
}
