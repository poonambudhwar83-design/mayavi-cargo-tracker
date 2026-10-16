// Scope airline lookups to visible Active Masters and recently completed
// Customs Cleared masters. This does not change any airline adapter or records.
const WINDOW_MS=72*60*60*1000;

function isImport(value=''){
  const type=String(value||'IMPORT').trim().toUpperCase();
  return type!=='EXPORT'&&type!=='OTHER_COUNTRIES';
}

function timeMs(value,{endOfIstDay=false}={}){
  const raw=String(value||'').trim();
  if(!raw)return NaN;
  if(/^20\d{2}-\d{2}-\d{2}$/.test(raw)){
    // A date-only fallback means the entire named IST day is eligible.
    return Date.parse(raw+(endOfIstDay?'T23:59:59+05:30':'T00:00:00+05:30'));
  }
  const ms=Date.parse(raw);
  return Number.isFinite(ms)?ms:NaN;
}

function partList(row={}){
  return Array.isArray(row.partShipments)?row.partShipments.filter(p=>p&&typeof p==='object'):[];
}

// Imports appear in Customs Cleared when marked cleared; split loads may
// still have uncleared physical parts even if an older part has cleared.
export function isActiveMaster(row={}){
  if(!isImport(row.shipmentType)){
    return !(row.handoverDone===true&&row.masterCopyReceived===true);
  }
  const parts=partList(row);
  if(parts.some(p=>typeof p.customsCleared==='boolean')){
    return parts.some(p=>p.customsCleared!==true);
  }
  return row.customsCleared!==true;
}

function clearedMilestoneMs(row={}){
  if(isImport(row.shipmentType)){
    const stamps=[timeMs(row.customsClearedAt)];
    for(const p of partList(row)){
      if(p.customsCleared===true)stamps.push(timeMs(p.customsClearedAt));
    }
    const valid=stamps.filter(Number.isFinite);
    if(valid.length)return Math.max(...valid);
    return timeMs(row.arrivalDate,{endOfIstDay:true});
  }
  // Export enters Customs Cleared only when both YES and copy receipt exist.
  const stamps=[timeMs(row.masterCopyReceivedAt),timeMs(row.handoverUpdatedAt)].filter(Number.isFinite);
  if(stamps.length)return Math.max(...stamps);
  return timeMs(row.departureDate||row.flightDate,{endOfIstDay:true});
}

export function refreshScope(row={},now=new Date()){
  const epoch=now instanceof Date?now.getTime():Number(now);
  if(!Number.isFinite(epoch))return 'SKIP';
  if(isActiveMaster(row))return 'ACTIVE';
  const clearedAt=clearedMilestoneMs(row);
  return Number.isFinite(clearedAt)&&clearedAt>=epoch-WINDOW_MS&&clearedAt<=epoch
    ?'CLEARED_RECENT':'SKIP';
}
