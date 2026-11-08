// Distinguish queue state from an actual verified JEPO shipment status.
// A missing first scan is not a carrier-provided "Pending" status.
export function jepoTrackingState(row={}){
 if(row.status==='DELIVERED')return 'DELIVERED';
 if(row.trackingError&&row.status==='PENDING')return 'RETRY_NEEDED';
 if(!row.checkedAt)return 'AWAITING_FIRST_CHECK';
 if(row.liveStatus)return 'LIVE_UPDATED';
 if(row.trackingError)return 'RETRY_NEEDED';
 return row.status==='PENDING'?'RETRY_NEEDED':'LIVE_UPDATED';
}
export function jepoTrackingStatusLabel(row={}){
 const state=jepoTrackingState(row);
 if(state==='AWAITING_FIRST_CHECK')return 'Awaiting First Check';
 if(state==='RETRY_NEEDED')return 'Retry Needed';
 return row.liveStatus||row.status||'Unknown';
}
export function jepoActiveRank(row={}){
 const state=jepoTrackingState(row);
 if(state==='RETRY_NEEDED')return 0;
 if(state==='LIVE_UPDATED')return 1;
 return 2;
}
export function sortJepoActiveRecords(rows=[]){
 return [...rows].sort((a,b)=>jepoActiveRank(a)-jepoActiveRank(b)
  ||String(b.bookingDate||'').localeCompare(String(a.bookingDate||''))
  ||String(b.checkedAt||'').localeCompare(String(a.checkedAt||''))
  ||String(a.awb||'').localeCompare(String(b.awb||'')));
}
